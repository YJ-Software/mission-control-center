import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'
import { createNotification } from '@/lib/notifications'
import { getTmpDir, getDateVars } from './utils'
import { findOpenclawBin } from './openclaw'
import { recordCitedUrls, pruneNewsArticles } from './news-store'
import { mergeReports } from './merge-reports'
import { convertToHtml } from './html-converter'

export type ProgressCallback = (step: string, detail: string) => void

/**
 * Tell someone when a topic produced nothing.
 *
 * A topic whose agent never ran leaves a "⚠️ 此段落尚未生成" placeholder and no
 * other trace — the report still publishes and the podcast still records, so
 * the only signal is a human reading the page. Both channels here are
 * best-effort and deliberately independent of the finalize cron job's announce
 * template, which installs are free to customise (and have).
 */
export function alertMissingTopics(
  missing: { id: string; name: string }[],
  dateHyphen: string,
): void {
  if (missing.length === 0) return

  const title = `晨報有 ${missing.length} 個主題未產出`
  const body = `${dateHyphen}：${missing.map((t) => t.name).join('、')}`

  try {
    createNotification({
      type: 'system',
      severity: 'warning',
      title,
      body,
      // One bell entry per day — re-running finalize must not stack toasts.
      dedupKey: `morning-report-missing-${dateHyphen}`,
    })
  } catch (err) {
    console.warn('[morning-report] missing-topic notification failed:', (err as Error).message)
  }

  try {
    execFileSync(findOpenclawBin(), ['announce', '--message', `⚠️ ${title}\n\n${body}`], {
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn('[morning-report] missing-topic announce failed:', (err as Error).message)
  }
}

function getConfigMap(): Record<string, string> {
  const rows = db.select().from(morningReportConfig).all()
  const map: Record<string, string> = {}
  for (const row of rows) {
    map[row.key] = row.value
  }
  return map
}

function cleanOldFiles(dir: string, maxDays: number) {
  if (!existsSync(dir)) return
  const now = Date.now()
  const maxAge = maxDays * 24 * 60 * 60 * 1000

  for (const file of readdirSync(dir)) {
    const filePath = join(dir, file)
    try {
      const stat = statSync(filePath)
      if (stat.isFile() && now - stat.mtimeMs > maxAge) {
        unlinkSync(filePath)
      }
    } catch {
      // skip files that can't be stat'd
    }
  }
}

export async function finalize(date?: Date, onProgress?: ProgressCallback) {
  const now = date ?? new Date()
  const { today, dateHyphen } = getDateVars(now)
  const tmpDir = getTmpDir()

  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true })
  }

  // Read config from DB
  const config = getConfigMap()
  const publicDir = config.publicDir ?? ''
  const obsidianDir = config.obsidianDir ?? ''

  // Step 1: Merge reports
  onProgress?.('merging', '合併各主題報告...')
  const mergeResult = await mergeReports(now)

  // Step 2: Convert to HTML
  onProgress?.('converting', '轉換為 HTML...')
  const html = convertToHtml(mergeResult.outputPath, now)

  // Step 3: Write HTML to tmpDir
  const htmlFilename = `morning-report-${today}.html`
  const htmlPath = join(tmpDir, htmlFilename)
  writeFileSync(htmlPath, html, 'utf-8')

  // Step 4: Copy HTML to publicDir if it exists
  if (publicDir) {
    onProgress?.('publishing', `發布到 ${publicDir}...`)
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true })
    }
    copyFileSync(htmlPath, join(publicDir, htmlFilename))
  }

  // Step 5: Copy merged MD to obsidianDir if configured
  if (obsidianDir) {
    onProgress?.('archiving', `歸檔到 Obsidian ${obsidianDir}...`)
    if (!existsSync(obsidianDir)) {
      mkdirSync(obsidianDir, { recursive: true })
    }
    copyFileSync(mergeResult.outputPath, join(obsidianDir, `${dateHyphen}.md`))
  }

  // Step 5.4: Write every cited link back to the ledger. This is what makes
  // dedup outlive tmp/ and stay correct no matter which source found the link.
  onProgress?.('recording', '記錄引用來源...')
  const cited = recordCitedUrls(mergeResult.outputPath, dateHyphen)

  // Step 5.5: Surface any topic that produced nothing. Runs after the report
  // is published so a failure here can never withhold a report that is ready.
  if (mergeResult.missingTopics.length > 0) {
    const names = mergeResult.missingTopics.map((t) => t.name).join('、')
    onProgress?.('warning', `${mergeResult.missingTopics.length} 個主題未產出：${names}`)
    alertMissingTopics(mergeResult.missingTopics, dateHyphen)
  }

  // Step 6: Clean old files
  onProgress?.('cleanup', '清理舊檔案...')
  cleanOldFiles(tmpDir, 7)
  pruneNewsArticles()
  if (publicDir && existsSync(publicDir)) {
    cleanOldFiles(publicDir, 30)
  }

  return {
    markdownPath: mergeResult.outputPath,
    htmlPath,
    date: dateHyphen,
    missingTopics: mergeResult.missingTopics,
    citedUrls: cited.recorded,
  }
}
