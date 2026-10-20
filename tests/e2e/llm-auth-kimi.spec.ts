import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/login'
import { sendChatTurnOnCurrentPage } from './utils/chat-turn'

/**
 * E2E for the new LLM 管理 page (v0.3.42+).
 *
 * Flow:
 *  1. Auth tab — add Moonshot Kimi API key to `main` agent, verify the
 *     `kimi:manual` profile shows up with an active badge.
 *  2. Models tab → `main` agent — set per-agent override primary to the
 *     Kimi coding model, save, verify the badge flips to 已覆寫.
 *  3. /chat — send a prompt, verify a non-empty assistant reply lands.
 *
 * Requires `KIMI_CODE_API_KEY` in `.env.e2e.local` (loaded by env-e2e.ts).
 * Cleanup runs in afterAll to leave the env reusable.
 */

const SAVE_TIMEOUT = 30_000
// POST /api/openclaw/models/agent-override spawns several `openclaw config`
// CLIs (read, set, verify — with one retry); measured 15.7 s on 2026.10.5.
const OVERRIDE_SAVE_TIMEOUT = 90_000
// The login job installs/consents the provider plugin before pasting the key,
// and that phase alone varies with the OpenClaw release: measured on 2026.9.6,
// plugin consent 21.2s + paste-api-key 9.0s + provider registration 6.2s =
// 36.3s, which failed a 30s wait although the job succeeded. The dialog itself
// has no client-side timeout (it follows the job's SSE stream to `end`), so
// only this spec's patience was wrong.
const LOGIN_JOB_TIMEOUT = 120_000
const CHAT_REPLY_TIMEOUT = 90_000
// The Kimi coding model's id depends on the installed kimi provider plugin:
// 2026.9.6 renamed `kimi-code` to `kimi-for-coding` (the old id survives only
// as a runtime alias in the plugin manifest's modelIdNormalization, so it is
// no longer offered in the picker). Take whichever the picker actually lists,
// newest name first.
const OVERRIDE_PRIMARY_CANDIDATES = ['kimi/kimi-for-coding', 'kimi/kimi-code']
const PROVIDER_PROFILE_PREFIX = 'kimi:'

/**
 * provider/model that answered the user message containing `tag`, read from the
 * chat.history response /chat loads (OpenClaw stamps every assistant message
 * with the provider/model that actually answered). A non-empty reply alone
 * proves nothing about routing: the default model answers just as well.
 */
async function replyRoute(page: Page, baseURL: string, tag: string): Promise<string> {
  let onFrame: ((f: { payload: string | Buffer }) => void) | undefined
  const route = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no chat.history reply to ${tag}`)), 30_000)
    onFrame = (f) => {
      let j: { type?: string; payload?: { messages?: unknown } } | undefined
      try { j = JSON.parse(String(f.payload)) } catch { return }
      const msgs = j?.type === 'res' ? j.payload?.messages : undefined
      if (!Array.isArray(msgs)) return
      type Msg = { role?: string; content?: unknown; provider?: string; model?: string }
      const list = msgs as Msg[]
      const asked = list.findIndex((m) => m.role === 'user' && JSON.stringify(m.content ?? '').includes(tag))
      if (asked < 0) return
      // The last assistant message of the turn (a tool-using turn has several).
      const turn = list.slice(asked + 1)
      const end = turn.findIndex((m) => m.role === 'user')
      const reply = (end < 0 ? turn : turn.slice(0, end)).filter((m) => m.role === 'assistant').pop()
      if (!reply) return
      clearTimeout(timer)
      resolve(`${reply.provider}/${reply.model}`)
    }
  })
  page.on('websocket', (ws) => ws.on('framereceived', onFrame!))
  await page.goto(`${baseURL}/chat`)
  return route
}

async function api(
  baseURL: string,
  cookies: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) {
  const r = await fetch(`${baseURL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

test.describe('LLM 管理 — kimi auth + per-agent override + chat', () => {
  test('end-to-end on main agent', async ({ loggedInPage: page, baseURL }) => {
    const apiKey = process.env.KIMI_CODE_API_KEY
    if (!apiKey) throw new Error('KIMI_CODE_API_KEY not set in .env.e2e.local')
    if (!baseURL) throw new Error('baseURL undefined')

    // ── Phase 1: Auth tab — add kimi profile ───────────────────────────
    await page.goto(`${baseURL}/llm-auth`)
    await page.getByRole('tab', { name: /^認證$|^Auth$/i }).click()

    const mainCard = page
      .locator('div.rounded-lg')
      .filter({ has: page.locator('span.font-mono', { hasText: /^main$/ }) })
    await expect(mainCard).toBeVisible({ timeout: 10_000 })

    await mainCard.getByRole('button', { name: /新增模型|Add Model/i }).click()

    // Login modal — pick provider, enter key, submit
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Moonshot Kimi/i }).click()
    // kimi only supports api-key, so no method picker; the password input
    // appears immediately.
    await dialog.locator('input[type="password"]').fill(apiKey)
    await dialog.getByRole('button', { name: /^開始$|^Start$/i }).click()

    // Wait for success banner
    await expect(
      dialog.getByText(/登入成功|Login successful/i),
    ).toBeVisible({ timeout: LOGIN_JOB_TIMEOUT })
    await dialog.getByRole('button', { name: /^完成$|^Done$/i }).click()

    // Verify the kimi:* profile row is now visible in main agent's list
    // with an active status badge.
    const newProfileRow = mainCard
      .locator('div')
      .filter({ hasText: PROVIDER_PROFILE_PREFIX })
      .filter({ has: page.locator('text=/active/i') })
      .first()
    await expect(newProfileRow).toBeVisible({ timeout: 10_000 })

    // ── Phase 2: Models tab → main agent — override primary ────────────
    // The override editor's primary <select> — pick the Kimi coding model
    const primarySelect = page
      .locator('label')
      .filter({ hasText: /主要模型|Primary model/i })
      .locator('xpath=following-sibling::select[1]')
    // The model list is fetched once when the tab mounts and is not polled.
    // Right after the login, OpenClaw is still hot-reloading the config (17s
    // measured 2026-10-06 on 2026.9.8 under load), so a list fetched in that
    // window has no kimi models and never will. Re-open the tab until it does.
    await expect(async () => {
      await page.goto(`${baseURL}/llm-auth`)
      await page.getByRole('tab', { name: /^模型$|^Models$/i }).click()
      await page.getByRole('button', { name: /^main$/ }).click()
      await expect(primarySelect).toBeVisible({ timeout: 10_000 })
      await expect(primarySelect.locator('option[value^="kimi/"]').first()).toBeAttached({ timeout: 10_000 })
    }).toPass({ timeout: LOGIN_JOB_TIMEOUT, intervals: [2_000, 5_000] })
    const offered = await primarySelect.locator('option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    )
    const overridePrimary = OVERRIDE_PRIMARY_CANDIDATES.find((id) => offered.includes(id))
    if (!overridePrimary) {
      throw new Error(`no Kimi coding model in the picker; offered: ${offered.filter((v) => v.startsWith('kimi/')).join(', ') || '(none)'}`)
    }
    await primarySelect.selectOption(overridePrimary)

    // The 已覆寫 badge below is an optimistic cache update — it shows before the
    // server has written anything. 2026-10-21 (OpenClaw 2026.10.5) the spec
    // left for /chat while this POST was still running; the override landed
    // ~18 s after chat.send, the turn went to the default yuanjhen model, and
    // the spec passed. Wait for the real save.
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/api/openclaw/models/agent-override') && r.request().method() === 'POST',
      { timeout: OVERRIDE_SAVE_TIMEOUT },
    )
    await page.getByRole('button', { name: /^儲存$|^Save$/i }).click()
    const saved = await saveResponse
    expect(saved.status(), `override save failed: ${await saved.text()}`).toBe(200)

    await expect(page.getByText(/已覆寫|Override/i).first()).toBeVisible({
      timeout: SAVE_TIMEOUT,
    })

    // ── Phase 3: /chat — verify the override actually routes ───────────
    await page.goto(`${baseURL}/chat`)
    const tag = `kimi-route-${Date.now()}`
    await sendChatTurnOnCurrentPage(page, `回我一個 OK (${tag})`, { timeout: CHAT_REPLY_TIMEOUT })
    const route = await replyRoute(page, baseURL, tag)
    // Compare the provider only: the plugin may normalise the model id
    // (kimi-code → kimi-for-coding).
    expect(route.split('/')[0], `chat turn was answered by ${route}, not the ${overridePrimary} override`).toBe('kimi')

    // ── Cleanup: clear override + remove kimi profile so the env stays
    // idempotent across re-runs. Auth cookie is on `page.context()`. ────
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    // Find the freshly-added profile id so we don't accidentally delete a
    // pre-existing kimi profile.
    const agents = await api(baseURL, cookieHeader, 'GET', '/api/openclaw/auth/agents')
    const mainAgent = (agents.body as { agents: { id: string; profiles: { profileId: string }[] }[] }).agents.find(
      (a) => a.id === 'main',
    )
    const newProfile = mainAgent?.profiles.find((p) =>
      p.profileId.startsWith(PROVIDER_PROFILE_PREFIX),
    )

    // Both cleanup calls are ASSERTED. A silently-failing cleanup leaves the
    // agent pinned to a kimi model with no kimi credential, and every later
    // spec in the run then dies on `No API key found for provider "kimi"` —
    // which reads as a dozen unrelated failures instead of one cleanup bug.
    const cleared = await api(
      baseURL,
      cookieHeader,
      'POST',
      '/api/openclaw/models/agent-override',
      { agent: 'main', action: 'clear' },
    )
    expect(cleared.status, `override clear failed: ${JSON.stringify(cleared.body)}`).toBe(200)

    if (newProfile) {
      const removed = await api(baseURL, cookieHeader, 'POST', '/api/openclaw/auth/remove', {
        agent: 'main',
        profileId: newProfile.profileId,
      })
      expect(removed.status, `profile remove failed: ${JSON.stringify(removed.body)}`).toBe(200)
    }

    // And verify the env is actually back to baseline, not merely that the
    // calls returned 200.
    const after = await api(baseURL, cookieHeader, 'GET', '/api/openclaw/auth/agents')
    const mainAfter = (
      after.body as { agents: { id: string; profiles: { profileId: string }[] }[] }
    ).agents.find((a) => a.id === 'main')
    expect(
      mainAfter?.profiles.filter((p) => p.profileId.startsWith(PROVIDER_PROFILE_PREFIX)) ?? [],
    ).toHaveLength(0)

    // The override must really be gone, not merely "cleared" with a 200.
    // 2026-10-06: after a full-suite run on OpenClaw 2026.9.8 the config still
    // held agents.entries.main.model = kimi/kimi-for-coding with no kimi key,
    // so every later chat on `main` failed — and it did not reproduce when this
    // spec ran alone. Fail here, with the config in the message, if it recurs.
    const overrides = await api(baseURL, cookieHeader, 'GET', '/api/openclaw/models/overrides')
    const mainOverride = (
      overrides.body as { agents: { id: string; model?: { primary?: string } | null }[] }
    ).agents.find((a) => a.id === 'main')?.model
    expect(
      mainOverride?.primary ?? null,
      `main agent still pinned after cleanup: ${JSON.stringify(overrides.body)}`,
    ).toBeNull()
  })
})
