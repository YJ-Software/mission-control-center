import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/login'
import { approvalCommand, approvalFixture, approvalPrompt, approvalSize, manualApprovals, removeApprovalFixture, restoreApprovals, waitForHermesApi } from './approvals'
import { hermesApi, native, requireHermes } from './target'

type ChatFrame = { runId: string; sessionKey: string; state?: string; data?: { phase: string; name: string } }

test.beforeEach(async ({ request, baseURL }) => requireHermes(request, baseURL))

async function openChat(page: Page, session: string) {
  await page.evaluate((key) => localStorage.setItem('chat-page-session', key), session)
  const frames: ChatFrame[] = []
  page.on('websocket', ws => {
    if (new URL(ws.url()).pathname !== '/ws') return
    ws.on('framereceived', ({ payload }) => {
      const frame = JSON.parse(payload.toString())
      if (frame.event === 'chat' && frame.payload?.sessionKey === session) frames.push(frame.payload)
    })
  })
  await page.goto('/chat')
  await expect(page.locator('textarea')).toBeEnabled({ timeout: 20_000 })
  return frames
}

async function send(page: Page, prompt: string) {
  const input = page.locator('textarea')
  await input.fill(prompt)
  await input.press('Enter')
  await expect(page.locator('[data-role="user"]').filter({ hasText: prompt })).toBeVisible()
}

test('sends and streams a real reply after the API key repair', async ({ loggedInPage: page }) => {
  const session = `mcc-e2e-send-${randomUUID()}`
  const marker = `HERMES_STREAM_${session.slice(-8)}`
  const frames = await openChat(page, session)
  try {
    await send(page, `Start your reply with ${marker}, then explain in a short paragraph how rainbows form. Do not use tools.`)
    await expect(page.locator('[data-role="assistant"][data-state="complete"]').filter({ hasText: marker }))
      .toBeVisible({ timeout: 90_000 })
    const final = frames.find(frame => frame.state === 'final')
    expect(final).toBeDefined()
    expect(frames.filter(frame => frame.runId === final!.runId && frame.state === 'delta').length).toBeGreaterThan(0)
  } finally {
    await page.close()
    await native('DELETE', `/api/sessions/${session}`)
    await setTimeout(1_000)
    const sessions = await native<{ data: { id: string }[] }>('GET', '/api/sessions?limit=200&offset=0')
    expect(sessions.data.some(row => row.id === session), 'streaming fixture stays deleted').toBe(false)
  }
})

test('stops a live Hermes tool run from the composer', async ({ loggedInPage: page }) => {
  const session = `mcc-e2e-stop-${randomUUID()}`
  const frames = await openChat(page, session)
  let runId: string | undefined
  try {
    await send(page, 'Use the terminal tool to run exactly: sleep 45. Wait for it to finish before replying.')
    await expect.poll(() => {
      runId = frames.find(frame => frame.data?.phase === 'start' && frame.data.name === 'terminal')?.runId
      return runId
    }, { timeout: 60_000 }).toBeTruthy()
    const stop = page.getByRole('button', { name: '中斷', exact: true })
    await stop.click()
    await expect.poll(() => frames.some(frame => frame.runId === runId && frame.state === 'aborted'),
      { timeout: 25_000 }).toBe(true)
    await expect(stop).toBeHidden()
    expect((await native<{ status: string }>('GET', `/v1/runs/${runId}`)).status).toBe('cancelled')
  } finally {
    if (runId && !frames.some(frame => ['final', 'error', 'aborted'].includes(frame.state ?? ''))) {
      await hermesApi('POST', `/v1/runs/${runId}/stop`, {})
    }
    await hermesApi('DELETE', `/api/sessions/${session}`)
  }
})

test('allows once and denies real Hermes tool approvals in the UI', async ({ loggedInPage: page }) => {
  test.setTimeout(5 * 60_000)
  const snapshot = await manualApprovals()
  try {
    await waitForHermesApi()
    for (const { button, size } of [{ button: '允許一次', size: 1 }, { button: '拒絕', size: 0 }]) {
      await test.step(button, async () => {
        const session = `mcc-e2e-approval-${randomUUID()}`
        const path = await approvalFixture()
        try {
          const frames = await openChat(page, session)
          await send(page, approvalPrompt(path))
          const panel = page.getByTestId('chat-interaction-panel')
          const command = panel.locator('pre')
          const reply = page.locator('[data-role="assistant"][data-state="complete"]')
          await expect(command.or(reply).first()).toBeVisible({ timeout: 90_000 })
          expect(await command.isVisible(), 'Hermes must request approval before completing').toBe(true)
          const shownCommand = (await command.innerText()).trim()
          expect(shownCommand === approvalCommand(path), 'approval is limited to the test fixture').toBe(true)
          expect(await approvalSize(path)).toBe(0)
          await panel.getByRole('button', { name: button, exact: true }).click()
          await expect(panel).toBeHidden()
          await expect(reply).toBeVisible({ timeout: 90_000 })
          const final = frames.find(frame => frame.state === 'final')
          expect(final).toBeDefined()
          expect((await native<{ status: string }>('GET', `/v1/runs/${final!.runId}`)).status).toBe('completed')
          expect(await approvalSize(path)).toBe(size)
          console.log(`Hermes approval ${button}: completed, fixture ${size} byte(s)`)
        } finally {
          await removeApprovalFixture(path)
          await hermesApi('DELETE', `/api/sessions/${session}`)
        }
      })
    }
  } finally {
    await restoreApprovals(snapshot)
  }
})
