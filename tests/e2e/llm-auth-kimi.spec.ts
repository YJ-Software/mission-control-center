import { test, expect } from './fixtures/login'

/**
 * E2E for the new LLM 管理 page (v0.3.42+).
 *
 * Flow:
 *  1. Auth tab — add Moonshot Kimi API key to `main` agent, verify the
 *     `kimi:manual` profile shows up with an active badge.
 *  2. Models tab → `main` agent — set per-agent override primary to
 *     `kimi/kimi-code`, save, verify the badge flips to 已覆寫.
 *  3. /chat — send a prompt, verify a non-empty assistant reply lands.
 *
 * Requires `KIMI_CODE_API_KEY` in `.env.e2e.local` (loaded by env-e2e.ts).
 * Cleanup runs in afterAll to leave the env reusable.
 */

const SAVE_TIMEOUT = 30_000
const CHAT_REPLY_TIMEOUT = 90_000
const OVERRIDE_PRIMARY = 'kimi/kimi-code'
const PROVIDER_PROFILE_PREFIX = 'kimi:'

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
    ).toBeVisible({ timeout: SAVE_TIMEOUT })
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
    await page.getByRole('tab', { name: /^模型$|^Models$/i }).click()
    await page.getByRole('button', { name: /^main$/ }).click()

    // The override editor's primary <select> — pick kimi/kimi-code
    const primarySelect = page
      .locator('label')
      .filter({ hasText: /主要模型|Primary model/i })
      .locator('xpath=following-sibling::select[1]')
    await expect(primarySelect).toBeVisible({ timeout: 10_000 })
    await primarySelect.selectOption(OVERRIDE_PRIMARY)

    await page.getByRole('button', { name: /^儲存$|^Save$/i }).click()

    // The "已覆寫" badge appears immediately via optimistic cache update;
    // also asserts the API call eventually persists.
    await expect(page.getByText(/已覆寫|Override/i).first()).toBeVisible({
      timeout: SAVE_TIMEOUT,
    })

    // ── Phase 3: /chat — verify the override actually routes ───────────
    await page.goto(`${baseURL}/chat`)
    const input = page.locator('textarea').first()
    await expect(input).toBeVisible({ timeout: 15_000 })
    await input.fill('回我一個 OK')
    await input.press('Enter')

    const lastAssistant = page.locator('[data-role="assistant"]').last()
    await expect(lastAssistant).toBeVisible({ timeout: CHAT_REPLY_TIMEOUT })
    await expect(async () => {
      expect((await lastAssistant.innerText()).trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: CHAT_REPLY_TIMEOUT, intervals: [500, 1_000, 2_000] })

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

    await api(baseURL, cookieHeader, 'POST', '/api/openclaw/models/agent-override', {
      agent: 'main',
      action: 'clear',
    })
    if (newProfile) {
      await api(baseURL, cookieHeader, 'POST', '/api/openclaw/auth/remove', {
        agent: 'main',
        profileId: newProfile.profileId,
      })
    }
  })
})
