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
import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'
import { getTmpDir, getDateVars } from './utils'
import { mergeReports } from './merge-reports'
import { convertToHtml } from './html-converter'

export type ProgressCallback = (step: string, detail: string) => void

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

  // Step 6: Clean old files
  onProgress?.('cleanup', '清理舊檔案...')
  cleanOldFiles(tmpDir, 7)
  if (publicDir && existsSync(publicDir)) {
    cleanOldFiles(publicDir, 30)
  }

  return {
    markdownPath: mergeResult.outputPath,
    htmlPath,
    date: dateHyphen,
  }
}
