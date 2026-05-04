/** Sync the wiki-synthesis cron job to OpenClaw based on DB settings.
 *  Mirrors morning-report's sync-cron pattern but with a single job. */

import { cronList, cronAdd, cronRemove } from '@/lib/morning-report/cron-cli'
import { db } from '@/lib/db'
import { settings, morningReportConfig } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const JOB_NAME = '📚 Wiki synthesis'

function getSetting(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value ?? ''
}
function getMrConfig(key: string): string {
  return db.select().from(morningReportConfig).where(eq(morningReportConfig.key, key)).all()[0]?.value ?? ''
}

/** Convert "0 3 * * 0" → minute/hour/etc — passes through unchanged. */
function normalizeCron(expr: string): string {
  return (expr || '0 3 * * 0').trim()
}

export async function syncWikiCronJob(): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const cronExpr = normalizeCron(getSetting('wiki.synthesisCron'))
  const baseUrl = getMrConfig('missionControlUrl') || 'http://localhost:3737'

  // Job message: tell the agent to fire the async endpoint and report back.
  const message = `使用 exec 工具執行以下指令觸發 Wiki synthesis：
curl -fsS -X POST '${baseUrl}/api/second-brain/wiki?action=synthesize-now'

回應應該是 \`{"ok":true,"message":"synthesis started in background"}\`，HTTP 202。
回報已啟動。實際 synthesis 完成（10-30 分鐘）後 dashboard 會自動 announce report URL。`

  // Find & remove existing wiki synthesis job
  let existing
  try {
    existing = await cronList()
  } catch (err) {
    return { ok: false, error: `cronList failed: ${(err as Error).message}` }
  }

  const old = existing.filter((j) => j.name === JOB_NAME)
  for (const j of old) {
    try { await cronRemove(j.id) } catch { /* ignore */ }
  }

  await cronAdd({
    name: JOB_NAME,
    description: '由 Mission Control 管理 — Wiki synthesis 排程觸發。請從 Dashboard 設定，不要手動改。',
    cron: cronExpr,
    tz: 'Asia/Taipei',
    session: 'isolated',
    message,
    timeoutSeconds: 180,             // exec the curl is fast; actual work is async
    enabled: true,
    announce: false,                 // don't announce on trigger; runSynthesis announces on completion
    noDeliver: true,
    wake: 'now',
  })

  return { ok: true, created: true }
}

export async function removeWikiCronJob(): Promise<void> {
  try {
    const existing = await cronList()
    for (const j of existing.filter((x) => x.name === JOB_NAME)) {
      await cronRemove(j.id).catch(() => undefined)
    }
  } catch { /* ignore */ }
}
