import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeClient } from '../../../scripts/e2e/twnoc/lib/gramjs-client.mjs'
import { openDeployForm } from './whmcs-form'

const evidence = process.env.HERMES_E2E_RUN
const run = process.env.HERMES_E2E_DEPLOY
const deployTimeout = 20 * 60_000
const telegramEndpoint = /\/ajax\/hermes-telegram-setup\.php$/

function redact(raw: string) {
  let safe = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !/PASSWORD|SECRET|TOKEN|API_KEY|API_PASS|API_HASH|USER_SESSION/i.test(key)) continue
    safe = safe.replaceAll(value, '[REDACTED]').replaceAll(encodeURIComponent(value), '[REDACTED]')
  }
  return safe
    .replace(/((?:[a-z][\w-]*(?:key|token|secret|password)|password|secret|token|api[_-]?key)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;<>]+(?![^\s]))/gi, '$1[REDACTED]')
    .replace(/\b(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\s+[A-Za-z0-9+/=]+/g, '[REDACTED SSH KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED BOT TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]+(?:…|\.\.\.)?/g, '[REDACTED KEY]')
    .replace(/\bk_[0-9a-f]{10,}\b/gi, '[REDACTED KEY ID]')
}

function put(name: string, content: string | object) {
  writeFileSync(join(evidence!, name), typeof content === 'string' ? redact(content) : JSON.stringify(content, null, 2) + '\n', { mode: 0o600 })
}

async function pageFeatures(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => el.getClientRects().length > 0
    return {
      page: location.pathname.split('/').at(-1),
      mccPassword: Array.from(document.querySelectorAll('#mcc-auth-password')).some(shown),
      mccInfo: /Mission Control Center|任務管制中心|\bMCC\b/i.test(document.body.innerText.replace(/TASK \[[\s\S]*/, '')),
      broker: Array.from(document.querySelectorAll('a[href*="open-mcc.php"]')).some(shown),
      controls: Array.from(document.querySelectorAll('button, a.btn, input'))
        .filter(shown)
        .map(el => el instanceof HTMLInputElement
          ? { id: el.id, name: el.name, type: el.type, placeholder: el.placeholder }
          : { id: el.id, label: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) }),
    }
  })
}

async function configureTelegram(page: Page) {
  const { TG_API_ID, TG_API_HASH, TG_USER_SESSION, TEST_TELEGRAM_BOT_TOKEN } = process.env
  const client = makeClient({ apiId: TG_API_ID!, apiHash: TG_API_HASH!, session: TG_USER_SESSION! })
  let userId: string
  try {
    await client.connect()
    userId = (await client.getMe()).id.toString()
    if (!/^\d+$/.test(userId)) throw new Error('Telegram test account ID must be numeric')
  } finally {
    await client.disconnect()
  }

  let startedAt: string | undefined
  let start: number | undefined
  let status: number | null = null
  let durationMs: number | null = null
  const recordRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && telegramEndpoint.test(new URL(request.url()).pathname)) {
      startedAt = new Date().toISOString()
      start = performance.now()
    }
  }
  page.on('request', recordRequest)
  try {
    const token = page.locator('input[id*="token" i]:visible, input[name*="token" i]:visible').first()
    const allowedUsers = page.locator('input[id*="allowed" i]:visible, input[name*="allowed" i]:visible').first()
    await token.fill(TEST_TELEGRAM_BOT_TOKEN!)
    await allowedUsers.fill(userId)
    const button = page.locator('button[id*="configure" i]:visible')
      .or(page.getByRole('button', { name: /^設定(?:\s*Telegram)?$/i })).first()
    const pending = page.waitForResponse(response =>
      response.request().method() === 'POST' && telegramEndpoint.test(new URL(response.url()).pathname),
    { timeout: 75_000 })
    const [response] = await Promise.all([pending, button.click()])
    status = response.status()
    const body = await response.text()
    durationMs = start === undefined ? null : Math.round(performance.now() - start)
    put('telegram-wizard-response.txt', body)
    expect(response.ok(), 'Hermes Telegram AJAX response').toBe(true)
    const result = JSON.parse(body)
    expect(result.success ?? result.ok ?? result.status === 'success', 'Hermes Telegram application response').toBe(true)
  } finally {
    page.off('request', recordRequest)
    if (durationMs === null && start !== undefined) durationMs = Math.round(performance.now() - start)
    put('telegram-wizard.json', { startedAt, durationMs, status })
  }
}

test.skip(!evidence || !/^[12]$/.test(run ?? ''), 'Set HERMES_E2E_RUN and select deployment 1 or 2')
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('WHMCS Hermes deploy and first-deploy Telegram wizard in the same browser session', async ({ page }) => {
  test.setTimeout(45 * 60_000)
  mkdirSync(evidence!, { recursive: true, mode: 0o700 })
  let logUrl: string | undefined
  let logSize = 0
  const saveLog = (body: string) => {
    // The polling endpoint returns the accumulated log. An older response may finish later.
    if (body.length < logSize || !body) return
    logSize = body.length
    put(`deploy${run}.log`, body)
  }
  let status: { status?: string; resolved_version?: string; requested_version?: string } = {}
  const startedAt = new Date().toISOString()
  const captureResponse = async (response: import('@playwright/test').Response) => {
    const path = new URL(response.url()).pathname
    if (path.endsWith('/ajax/get-deploy-logs.php') && response.ok()) {
      logUrl = response.url()
      const body = await response.text().catch(() => '')
      saveLog(body)
    }
    if (path.endsWith('/ajax/check-deploy-status.php') && response.ok()) {
      status = await response.json().catch(() => status)
    }
  }

  let succeeded = false
  let uiStatus: string | undefined
  try {
    await openDeployForm(page, 'hermes')
    if (!process.env.E2E_REBUILD_PASSWORD) throw new Error('Set E2E_REBUILD_PASSWORD')
    // Opening the form may acknowledge earlier deploys in this page. Only
    // collect polling responses after the form for the new deploy has opened.
    page.on('response', captureResponse)
    await page.getByRole('button', { name: /開始部署/ }).click()
    await expect(page).toHaveURL(/\/deploying\.php\b/)
    const success = page.locator('.label-success').filter({ hasText: '成功' })
    const failure = page.locator('.label-danger').filter({ hasText: /失敗|錯誤/ })
    await expect(success.or(failure).first()).toBeVisible({ timeout: deployTimeout })
    succeeded = await success.isVisible()
    uiStatus = (await (succeeded ? success : failure).first().innerText()).trim()
  } finally {
    page.off('response', captureResponse)
    if (logUrl) {
      const response = await page.request.get(logUrl, { timeout: 15_000 }).catch(() => undefined)
      if (response?.ok()) saveLog(await response.text())
    }
    put(`deploy${run}-page.json`, await pageFeatures(page))
    put(`deploy${run}-result.json`, {
      startedAt, finishedAt: new Date().toISOString(), succeeded, uiStatus, polledStatus: status.status,
      resolvedVersion: status.resolved_version, requestedVersion: status.requested_version,
      hasLog: logSize > 0,
    })
  }
  expect(succeeded, 'WHMCS Hermes deployment succeeded').toBe(true)

  if (run === '1') {
    // Leave the original PHP session open while the operator verifies MCC through SSH.
    await expect.poll(() => existsSync(join(evidence!, 'start-telegram')), {
      timeout: 15 * 60_000, intervals: [1_000],
    }).toBe(true)
    await configureTelegram(page)
  }
})
