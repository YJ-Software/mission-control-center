import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/login'

/**
 * Human-in-the-loop prompts on /talk: ask_user questions.
 *
 * The Gateway always sent these events to MCC, but the browser dispatched only
 * `chat` events and nothing rendered a prompt, so an agent's ask_user never
 * reached the chat and the run sat blocked until the question timed out.
 *
 * The questions are raised straight through the Gateway RPC (`question.request`)
 * over MCC's own /ws bridge rather than by coaxing a model into calling the
 * tool, so the spec is deterministic. The answer is then checked on the
 * Gateway side, not just in the DOM.
 *
 * Approvals cannot be covered this way: the Gateway delivers an
 * `*.approval.requested` event to every approval client EXCEPT the connection
 * that raised it, and a request sent through /ws is raised on MCC's own
 * Gateway connection — the one the panel listens on. In real use approvals
 * come from an agent runtime or plugin, never from MCC itself.
 */

const SESSION_KEY = 'agent:main:main'
const PROMPT_TIMEOUT_MS = 120_000

/** Send one Gateway RPC through MCC's /ws bridge from inside the logged-in page. */
async function gatewayRpc<T = unknown>(page: Page, method: string, params: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    ({ method, params }) =>
      new Promise<T>((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/ws`)
        const id = `e2e-${Math.random().toString(36).slice(2)}`
        const timer = setTimeout(() => {
          ws.close()
          reject(new Error(`RPC timeout: ${method}`))
        }, 150_000)
        ws.onopen = () => ws.send(JSON.stringify({ type: 'req', id, method, params }))
        ws.onmessage = (ev) => {
          let msg: { type?: string; id?: string; ok?: boolean; payload?: unknown; error?: { message?: string } }
          try {
            msg = JSON.parse(String(ev.data))
          } catch {
            return
          }
          if (msg.type !== 'res' || msg.id !== id) return
          clearTimeout(timer)
          ws.close()
          if (msg.ok) resolve(msg.payload as T)
          else reject(new Error(msg.error?.message ?? `RPC ${method} failed`))
        }
        ws.onerror = () => {
          clearTimeout(timer)
          reject(new Error(`WebSocket error during ${method}`))
        }
      }),
    { method, params },
  )
}

async function openTalk(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/talk`)
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 })
}

test.describe('chat interactions on /talk', () => {
  test('answers an ask_user question and the Gateway records the answer', async ({ loggedInPage: page, baseURL }) => {
    await openTalk(page, baseURL!)
    const questionText = `E2E ${Date.now()}: where should this deploy?`
    const { id } = await gatewayRpc<{ id: string }>(page, 'question.request', {
      questions: [
        {
          questionId: 'deploy_target',
          header: 'Target',
          question: questionText,
          options: [{ label: 'Staging' }, { label: 'Production', description: 'live traffic' }],
        },
      ],
      sessionKey: SESSION_KEY,
      timeoutMs: PROMPT_TIMEOUT_MS,
    })

    const panel = page.getByTestId('chat-interaction-panel')
    try {
      await expect(panel.getByText(questionText)).toBeVisible({ timeout: 15_000 })
      await panel.getByRole('button', { name: /Production/ }).click()
      await panel.getByRole('button', { name: /^送出$|^Submit$|^提交$/ }).click()
      await expect(panel).toBeHidden({ timeout: 15_000 })

      // question.get wraps the record: { question: QuestionRecord }
      const { question } = await gatewayRpc<{
        question: { status: string; answers?: { answers: Record<string, string[]> } }
      }>(page, 'question.get', { id })
      expect(question.status).toBe('answered')
      expect(question.answers?.answers.deploy_target).toEqual(['Production'])
    } finally {
      await gatewayRpc(page, 'question.resolve', { id, cancel: true }).catch(() => {})
    }
  })

  test('skip cancels the question instead of leaving it pending', async ({ loggedInPage: page, baseURL }) => {
    await openTalk(page, baseURL!)
    const questionText = `E2E ${Date.now()}: skip me`
    const { id } = await gatewayRpc<{ id: string }>(page, 'question.request', {
      questions: [
        { questionId: 'skip_me', header: 'Skip', question: questionText, options: [{ label: 'A' }, { label: 'B' }] },
      ],
      sessionKey: SESSION_KEY,
      timeoutMs: PROMPT_TIMEOUT_MS,
    })
    const panel = page.getByTestId('chat-interaction-panel')
    try {
      await expect(panel.getByText(questionText)).toBeVisible({ timeout: 15_000 })
      await panel.getByRole('button', { name: /^略過$|^Skip$|^跳过$/ }).click()
      await expect(panel).toBeHidden({ timeout: 15_000 })
      const { question } = await gatewayRpc<{ question: { status: string } }>(page, 'question.get', { id })
      expect(question.status).toBe('cancelled')
    } finally {
      await gatewayRpc(page, 'question.resolve', { id, cancel: true }).catch(() => {})
    }
  })
})
