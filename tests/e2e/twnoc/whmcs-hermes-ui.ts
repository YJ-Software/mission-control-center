import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, type Request, type Response } from '@playwright/test'
import { onHermes } from '../hermes/target'

type Redact = (value: string) => string

export async function verifyLiveMccPassword(page: Page, evidence: string) {
  const result = { disclosureOpened: false, passwordFieldVisible: false, passwordPopulated: false, passwordMatches: false }
  const password = page.locator('#mcc-auth-password:visible')
  try {
    // The deploy WebSocket delivers the credential once, to this page.
    const disclosure = page.locator('details:has(#mcc-auth-password)')
    await disclosure.locator('> summary').filter({ hasText: '進階：自行以 SSH 通道連線' }).click({ timeout: 10_000 })
    result.disclosureOpened = true
    await password.waitFor({ state: 'visible', timeout: 10_000 })
    result.passwordFieldVisible = true

    let actualHash: string | undefined
    await expect.poll(async () => {
      const value = await password.inputValue({ timeout: 1_000 })
      if (value) actualHash = createHash('sha256').update(value).digest('hex')
      return !!actualHash
    }, { timeout: 15_000 }).toBe(true)
    result.passwordPopulated = true

    const expectedHash = await onHermes<string | null>(`
import hashlib, json
from pathlib import Path
from dotenv import dotenv_values
password = dotenv_values(Path.home() / '.mission-control/.env.local').get('AUTH_PASSWORD')
print(json.dumps(hashlib.sha256(password.encode()).hexdigest() if password else None))
`)
    result.passwordMatches = !!expectedHash && actualHash === expectedHash
  } catch (error) {
    // Playwright errors can include rendered values. Record only the error class.
    Object.assign(result, { errorType: error instanceof Error ? error.name : 'unknown' })
  }
  writeFileSync(join(evidence, 'deploying-password.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  return result.passwordMatches
}

function safeUrl(value: string) {
  const url = new URL(value)
  const keys = [...new Set(url.searchParams.keys())]
  return url.origin + url.pathname + (keys.length ? '?' + keys.map(key => encodeURIComponent(key) + '=[REDACTED]').join('&') : '')
}

async function screenshot(page: Page, path: string) {
  const configured = ['WHMCS_PASSWORD', 'E2E_REBUILD_PASSWORD', 'TEST_TELEGRAM_BOT_TOKEN', 'AUTH_PASSWORD']
    .map(key => process.env[key])
    .filter((value): value is string => !!value)
  try {
    await page.evaluate(configured => {
      const dashboardPassword = document.querySelector<HTMLInputElement>('#mcc-auth-password')?.value
      const secrets = dashboardPassword ? [...configured, dashboardPassword] : configured
      const sensitive = /[?&](?:sig|jti|exp|token)=|\b\d{6,}:[A-Za-z0-9_-]{20,}\b/i
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? ''
        if (sensitive.test(text) || secrets.some(secret => text.includes(secret))) {
          node.parentElement?.setAttribute('data-e2e-sensitive', '')
        }
      }
    }, configured)
    await page.screenshot({
      path,
      timeout: 12_000,
      mask: [page.locator('input, textarea, pre, code, [contenteditable], [data-e2e-sensitive], [data-role="user"], [data-role="assistant"]')],
    })
    return true
  } catch {
    return false
  }
}

async function verifyBundle(page: Page) {
  const control = page.locator('#btn-download-all-passwords')
  if (!await control.isVisible()) return { offered: false, downloaded: false, includesMcc: false }
  const pending = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null)
  await control.click({ timeout: 8_000 })
  const download = await pending
  if (!download) return { offered: true, downloaded: false, includesMcc: false }
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  try {
    if (stream) {
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    }
    const content = Buffer.concat(chunks).toString('utf8')
    return { offered: true, downloaded: true, includesMcc: /Mission Control(?: Center)?|任務管制中心|\bMCC\b/i.test(content) }
  } finally {
    await download.delete()
  }
}

async function followBroker(source: Page, evidence: string, name: string, redact: Redact) {
  const sourceUrl = source.url()
  const link = source.locator('a[href*="open-mcc.php"]:visible').first()
  if (!await link.isVisible()) return { source: safeUrl(sourceUrl), offered: false, loggedIn: false }
  const context = source.context()
  const appIds = new Set<string>()
  const chain: {
    method: string
    url: string
    status?: number
    location?: string
    networkError?: string
  }[] = []
  const requests = new Map<Request, (typeof chain)[number]>()
  const findAppIds = (value: string) => {
    for (const id of value.matchAll(/\b(?:hermes|openclaw)-svc-[\w-]+/gi)) appIds.add(id[0])
  }
  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest() || request.resourceType() !== 'document') return
    findAppIds(request.url())
    const entry = { method: request.method(), url: safeUrl(request.url()) }
    requests.set(request, entry)
    chain.push(entry)
  }
  const onResponse = (response: Response) => {
    const entry = requests.get(response.request())
    if (!entry) return
    entry.status = response.status()
    const location = response.headers().location
    if (location) {
      const absolute = new URL(location, response.url()).href
      findAppIds(absolute)
      entry.location = safeUrl(absolute)
    }
  }
  const onFailure = (request: Request) => {
    const entry = requests.get(request)
    if (entry) entry.networkError = redact(request.failure()?.errorText ?? 'unknown')
  }

  let tab = source
  let lastError: string | undefined
  let settingsStatus: number | undefined
  let healthStatus: number | undefined
  let backend: string | undefined
  let passwordPrompt = false
  let pageVisible = false
  let brokerMessage: string | undefined
  const startedAt = new Date().toISOString()
  context.on('request', onRequest)
  context.on('response', onResponse)
  context.on('requestfailed', onFailure)
  try {
    if (await link.getAttribute('target') === '_blank') {
      const popup = source.waitForEvent('popup', { timeout: 30_000 })
      const [openedPage] = await Promise.all([popup, link.click({ timeout: 15_000 })])
      tab = openedPage
    } else {
      await link.click({ timeout: 15_000 })
    }
    await tab.waitForLoadState('domcontentloaded', { timeout: 30_000 })
    await tab.waitForURL(url => /^\/(talk|dashboard|login)(\/|$)/.test(url.pathname), { timeout: 25_000 }).catch(() => {})
    passwordPrompt = await tab.locator('input[type="password"]:visible').count() > 0
    const final = new URL(tab.url())
    if (final.protocol === 'https:' && /^\/(talk|dashboard)(\/|$)/.test(final.pathname)) {
      const [settings, health] = await Promise.all([
        tab.request.get(new URL('/api/settings', final).href, { timeout: 12_000, maxRedirects: 0 }),
        tab.request.get(new URL('/api/health', final).href, { timeout: 12_000, maxRedirects: 0 }),
      ])
      settingsStatus = settings.status()
      healthStatus = health.status()
      backend = (await health.json().catch(() => null))?.backend?.kind
      const app = tab.locator('textarea:visible, a[href="/talk"]:visible').first()
      await app.waitFor({ timeout: 12_000 }).catch(() => {})
      pageVisible = await app.isVisible()
    } else {
      const text = await tab.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
      if (/尚未完成部署/.test(text)) brokerMessage = '尚未完成部署'
      else if (/502 Bad Gateway/i.test(text)) brokerMessage = '502 Bad Gateway'
      else if (/503 Service (?:Temporarily )?Unavailable/i.test(text)) brokerMessage = '503 Service Unavailable'
    }
  } catch (error) {
    // Playwright action errors can contain signed URLs and rendered field values.
    lastError = error instanceof Error ? error.name : 'unknown'
  } finally {
    context.off('request', onRequest)
    context.off('response', onResponse)
    context.off('requestfailed', onFailure)
  }
  const final = safeUrl(tab.url())
  const screenshotSaved = await screenshot(tab, join(evidence, name + '-broker.png'))
  if (tab !== source) await tab.close()
  else if (tab.url() !== sourceUrl) await source.goto(sourceUrl).catch(() => {})
  return {
    source: safeUrl(sourceUrl), offered: true, startedAt, finishedAt: new Date().toISOString(), chain, final, appIds: [...appIds],
    settingsStatus, healthStatus, backend, passwordPrompt, pageVisible, brokerMessage, lastError, screenshotSaved,
    loggedIn: settingsStatus === 200 && healthStatus === 200 && backend === 'hermes' && pageVisible && !passwordPrompt,
  }
}

export async function verifyHermesWhmcsUi(
  page: Page,
  { deployListUrl, priorHermesDeployIds }: { deployListUrl: string; priorHermesDeployIds: string[] },
  evidence: string,
  redact: Redact,
) {
  const persist = (name: string, value: unknown) =>
    writeFileSync(join(evidence, name + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  const report: Record<string, unknown> = {}
  const checks = { panelPassed: false, deployingBrokerPassed: false, detailsBrokerPassed: false }
  try {
    const features = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('input, textarea, code, pre')]
      const commands = fields.flatMap(el => {
        if (!el.getClientRects().length) return []
        const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent
        return value?.split(/\r?\n/).filter(line => /\bssh\s/.test(line)) ?? []
      })
      const accounts = (lines: string[]) => [...new Set(lines.flatMap(line => {
        const match = line.match(/\bssh\s+.*?\b(hermes|openclaw|root|mcc-tunnel)@/i)
        return match ? [match[1]] : []
      }))]
      const sshAccounts = accounts(commands)
      const tunnelAccounts = accounts(commands.filter(line => /(?:^|\s)-[A-Za-z]*L\s*[^\r\n]*:3737\b/.test(line)))
      const vpnOffered = [...document.querySelectorAll('button, a')].some(el =>
        el.getClientRects().length && /設定\s*VPN/.test(el.textContent ?? ''))
      return { sshAccounts, tunnelAccounts, vpnOffered }
    })
    const panelScreenshot = await screenshot(page, join(evidence, 'deploying-panel.png'))
    const bundle = await verifyBundle(page).catch(() => ({ offered: true, downloaded: false, includesMcc: false }))
    checks.panelPassed = features.tunnelAccounts.includes('hermes') && bundle.includesMcc
    Object.assign(report, { ...features, panelScreenshot, bundle })
    persist('whmcs-ui', report)

    // Carry forward the WHMCS cookies from before the first broker login.
    const context = page.context()
    const fresh = await context.browser()!.newContext({ storageState: await context.storageState() })
    try {
      const deployId = new URL(page.url()).searchParams.get('id')
      const deploying = await followBroker(page, evidence, 'deploying', redact)
      persist('deploying-broker', deploying)
      checks.deployingBrokerPassed = deploying.loggedIn
      const details = await fresh.newPage()
      await details.goto(deployListUrl)
      const rows = await details.locator('tr[data-href*="deploy-info.php"]').filter({ hasText: /hermes/i })
        .evaluateAll(elements => elements.map(el => {
          const url = new URL(el.getAttribute('data-href')!, location.href)
          return { href: url.href, id: url.searchParams.get('id') }
        }))
      // The deploy form POST can leave deploying.php without an id in the URL.
      const newRows = rows.filter(row => row.id && !priorHermesDeployIds.includes(row.id))
      const row = rows.find(row => deployId && row.id === deployId) ?? (newRows.length === 1 ? newRows[0] : undefined)
      if (!row) {
        persist('deploy-info-broker', { offered: false, loggedIn: false, reason: 'matching deployment details row missing' })
        return checks
      }
      await details.goto(row.href)
      report.detailsScreenshot = await screenshot(details, join(evidence, 'deploy-info-panel.png'))
      const deployInfo = await followBroker(details, evidence, 'deploy-info', redact)
      persist('deploy-info-broker', deployInfo)
      checks.detailsBrokerPassed = deployInfo.loggedIn
    } finally {
      await fresh.close()
    }
  } catch (error) {
    report.errorType = error instanceof Error ? error.name : 'unknown'
  } finally {
    persist('whmcs-ui', report)
  }
  return checks
}
