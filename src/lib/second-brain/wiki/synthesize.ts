/**
 * Phase 3: scheduled synthesis run.
 *
 * Triggered by a cron entry (interval + model both configurable in DB
 * settings: wiki.synthesisCron, wiki.synthesisModel) or manually via the
 * Wiki tab "Synthesize now" button.
 *
 *   1. Find recent sources/ files (last 7 days, configurable later).
 *   2. Spawn an agent with a prompt instructing it to wiki_apply
 *      create_synthesis pages drawing from those sources.
 *   3. Run wiki compile + wiki lint.
 *   4. Render reports/*.md plus the new syntheses/ index into a single
 *      HTML page and copy into the morning-report publicDir so the
 *      already-running cloudflared quick tunnel serves it.
 *   5. Compose a token-protected URL and announce via the OpenClaw
 *      Gateway (whichever channel is the operator's "main" — same path
 *      as the morning-report podcast notify).
 */

import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import {
  readFileSync, writeFileSync, copyFileSync,
  existsSync, mkdirSync, readdirSync, statSync,
} from 'fs'
import { join } from 'path'
import os from 'os'
import { db } from '@/lib/db'
import { settings, morningReportConfig } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'
import { startTunnel, getTunnelStatus } from '@/lib/morning-report/tunnel'
import { lint as wikiLint, compile as wikiCompile } from './cli'

const execFileAsync = promisify(execFile)

const WIKI_VAULT = join(os.homedir(), '.openclaw', 'wiki', 'main')

function getSetting(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value ?? ''
}
function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
function getMrConfig(key: string): string {
  return db.select().from(morningReportConfig).where(eq(morningReportConfig.key, key)).all()[0]?.value ?? ''
}

/** List source files modified within the last `daysBack` days, oldest first. */
function recentSources(daysBack = 7): string[] {
  const dir = join(WIKI_VAULT, 'sources')
  if (!existsSync(dir)) return []
  const cutoff = Date.now() - daysBack * 86400_000
  const out: { path: string; mtime: number }[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const p = join(dir, name)
    try {
      const s = statSync(p)
      if (s.mtimeMs >= cutoff) out.push({ path: p, mtime: s.mtimeMs })
    } catch { /* skip */ }
  }
  out.sort((a, b) => a.mtime - b.mtime)
  return out.map((x) => x.path)
}

const SYNTHESIS_PROMPT = (sourceList: string) => `\
你是 OpenClaw 知識編輯。任務：從 memory-wiki 最近 ingest 的 sources 編出一批 synthesis。

## 規則
1. 讀取下列 source 檔案，必要時用 wiki_get 工具讀單一頁面確認 frontmatter
2. 找 2~5 個跨多份 source 的共通主題（人物、產品、趨勢、事件）
3. 每個主題用 \`wiki_apply\` 工具，op="create_synthesis"，寫一頁進去：
   - title: 簡潔有意義的標題
   - body: 整理過的觀點（不超過 800 字），不要重複原文，只寫整合後的論點
   - sourceIds: 列出引用的 source ID（從 source 頁的 frontmatter 抽，例如 source.morning-report-20260428）
   - claims: 至少 2 條結構化主張，附 confidence (0-1) 與 evidence (sourceId)
   - questions: 還沒搞清楚的 2~3 個問題
4. 跨 source 找矛盾時填 contradictions
5. 寫完所有 synthesis 之後，呼叫 wiki_lint 跑一次健康檢查（用 wiki_lint 工具）
6. 最後用一句話回報你寫了哪幾個 synthesis 標題

## 候選 sources（${sourceList.split('\\n').length} 份）

${sourceList}

開始。完成後就停。
`

/** Build a single combined HTML page out of `WIKI/reports/*.md` plus a
 *  fresh "Latest syntheses" listing. Lightweight regex md-to-html;
 *  matches morning-report's fallback path. */
function renderReportsHtml(): string {
  const reportsDir = join(WIKI_VAULT, 'reports')
  const synthesesDir = join(WIKI_VAULT, 'syntheses')

  const md2html = (md: string): string => {
    let h = md
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    h = h.replace(/^## (.+?)(?:\s*\{#[\w-]+\})?$/gm, '<h2>$1</h2>')
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>')
    h = h.replace(/^---$/gm, '<hr>')
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    h = h.replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    h = h.split(/\n\n+/).map((b) => /^<(h\d|ul|hr|blockquote|p)/.test(b.trim()) ? b : `<p>${b}</p>`).join('\n')
    return h
  }

  const sections: string[] = []

  if (existsSync(reportsDir)) {
    for (const name of readdirSync(reportsDir).filter((n) => n.endsWith('.md')).sort()) {
      try {
        const md = readFileSync(join(reportsDir, name), 'utf-8')
        sections.push(`<section class="report"><h2>📋 ${name}</h2>${md2html(md)}</section>`)
      } catch { /* skip */ }
    }
  }

  if (existsSync(synthesesDir)) {
    const items = readdirSync(synthesesDir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => ({ n, mtime: statSync(join(synthesesDir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)

    if (items.length) {
      const list = items.map((x) =>
        `<li><strong>${x.n.replace(/\.md$/, '')}</strong> <span class="muted">(${new Date(x.mtime).toISOString().slice(0, 10)})</span></li>`
      ).join('\n')
      sections.unshift(`<section class="latest"><h2>📝 最新 syntheses (top 10)</h2><ul>${list}</ul></section>`)
    }
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  return `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>OpenClaw Wiki Report — ${ts}</title>
  <style>
    body { font-family: -apple-system, "Helvetica Neue", Arial, "Microsoft JhengHei", sans-serif;
           max-width: 880px; margin: 2rem auto; padding: 0 1.5rem; color: #222; line-height: 1.6; }
    h1 { border-bottom: 2px solid #000; padding-bottom: 0.4rem; }
    h2 { margin-top: 2rem; color: #003366; }
    code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
    section { margin-bottom: 2.5rem; }
    .muted { color: #888; font-size: 0.85em; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>📚 OpenClaw Wiki Report</h1>
  <p class="muted">Generated ${ts} — ${sections.length} sections</p>
  ${sections.join('\n')}
</body>
</html>`
}

/** Each step writes a {stage, message} pair into MCC settings so the UI
 *  can show "last run reached step X". Stages map to a fixed order so
 *  the UI can render a simple step indicator without reading the message. */
const SYNTHESIS_STAGES = [
  'preparing',          // gathering recent sources
  'agent-running',      // openclaw agent invocation
  'compile',            // wiki compile
  'lint',               // wiki lint
  'render-html',        // build report html
  'publish',            // copy to publicDir + tunnel
  'announce',           // openclaw announce
  'done',
] as const
type SynthesisStage = typeof SYNTHESIS_STAGES[number] | 'error'

function progress(stage: SynthesisStage, message: string): void {
  setSetting('wiki.lastSynthesisStage', stage)
  setSetting('wiki.lastSynthesisMessage', message)
  console.log(`[wiki-synthesis] ${stage}: ${message}`)
}

/** Run an agent to create synthesis pages, then build the report and publish. */
export async function runSynthesis(): Promise<{
  ok: boolean
  syntheses?: number
  reportUrl?: string
  error?: string
}> {
  setSetting('wiki.lastSynthesisStartedAt', new Date().toISOString())
  setSetting('wiki.lastSynthesisFinishedAt', '')
  setSetting('wiki.lastSynthesisError', '')
  progress('preparing', '掃描最近 7 天的 sources...')

  const sources = recentSources(7)
  if (sources.length === 0) {
    progress('error', 'no recent sources to synthesize')
    setSetting('wiki.lastSynthesisError', 'no recent sources to synthesize')
    setSetting('wiki.lastSynthesisFinishedAt', new Date().toISOString())
    return { ok: false, error: 'no recent sources to synthesize' }
  }

  // 1. Run agent
  const bin = findOpenclawBin()
  const sessionId = `wiki-synthesis-${Date.now()}`
  const prompt = SYNTHESIS_PROMPT(sources.map((p) => `- ${p}`).join('\n'))
  const model = getSetting('wiki.synthesisModel').trim()
  // --no-color is a TOP-LEVEL openclaw flag, not an `agent` subcommand flag.
  // Order: openclaw --no-color agent ...
  const args = ['--no-color', 'agent', '--session-id', sessionId, '--message', prompt]
  if (model) args.push('--model', model)

  progress('agent-running', `agent 正在處理 ${sources.length} 份 sources（10–30 分鐘）`)
  try {
    await execFileAsync(bin, args, {
      timeout: 30 * 60_000,           // 30 min hard cap
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[wiki-synthesis] agent failed:', message)
    progress('error', `agent failed: ${message.slice(0, 200)}`)
    setSetting('wiki.lastSynthesisError', message)
    setSetting('wiki.lastSynthesisFinishedAt', new Date().toISOString())
    return { ok: false, error: `agent run failed: ${message}` }
  }

  // 2. Compile + lint (compile is also auto-triggered, but be explicit).
  progress('compile', '重新編譯 indexes 與 dashboards')
  await wikiCompile().catch(() => undefined)
  progress('lint', '跑 lint 找矛盾與低信心 claims')
  const lintResult = await wikiLint().catch(() => ({ ok: false, output: '' }))
  if (lintResult.ok) console.log('[wiki-synthesis] lint OK')

  // 3. Build & publish HTML report.
  progress('render-html', '產生 report HTML')
  const today = new Date().toISOString().slice(0, 10)
  const html = renderReportsHtml()
  const tmpDir = join(os.tmpdir(), 'wiki-reports')
  mkdirSync(tmpDir, { recursive: true })
  const localHtml = join(tmpDir, `wiki-report-${today}.html`)
  writeFileSync(localHtml, html, 'utf-8')

  // Reuse morning-report's quick tunnel + publicDir so we don't proliferate
  // tunnels. publicDir lives at ~/morning-report/public by default.
  const publicDir = getMrConfig('publicDir')
    || join(os.homedir(), 'morning-report/public')
  if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })
  const remoteName = `wiki-report-${today}.html`
  copyFileSync(localHtml, join(publicDir, remoteName))

  progress('publish', '上傳到 publicDir + 啟動 cloudflare tunnel')
  let tunnel = getTunnelStatus()
  if (!tunnel.active) {
    try {
      await startTunnel(publicDir)
      tunnel = getTunnelStatus()
    } catch (err) {
      console.warn('[wiki-synthesis] tunnel start failed:', (err as Error).message)
    }
  }

  let reportUrl = ''
  if (tunnel.active && tunnel.url && tunnel.token) {
    reportUrl = `${tunnel.url}/${remoteName}?token=${tunnel.token}`
  }
  // Always also publish a dashboard-local URL so we have a working link
  // even when no cloudflared tunnel is installed (e.g. test machines).
  const localUrl = `/api/second-brain/wiki?type=report&date=${today}`

  // 4. Persist run state.
  setSetting('wiki.lastSynthesisAt', new Date().toISOString())
  setSetting('wiki.lastTunnelUrl', reportUrl)
  setSetting('wiki.lastLocalReportUrl', localUrl)

  // 5. Notify (best-effort) via OpenClaw announce — same channel as morning report.
  if (reportUrl) {
    progress('announce', '透過 OpenClaw 推送 report URL')
    try {
      execFileSync(bin, [
        'announce',
        '--message',
        `📚 Wiki 週報已產出\n\n最近 ${sources.length} 份 sources 編成 synthesis、lint 完成\n\n查看：${reportUrl}`,
      ], { timeout: 30_000 })
    } catch (err) {
      console.warn('[wiki-synthesis] announce failed:', (err as Error).message)
    }
  }

  // 6. Count generated syntheses for return.
  let count = 0
  try {
    count = readdirSync(join(WIKI_VAULT, 'syntheses')).filter((n) => n.endsWith('.md')).length
  } catch { /* */ }

  progress('done', `完成 — ${count} 份 syntheses，report URL${reportUrl ? ' 已產生' : ' 未產生（tunnel 未啟動）'}`)
  setSetting('wiki.lastSynthesisFinishedAt', new Date().toISOString())
  return { ok: true, syntheses: count, reportUrl }
}
