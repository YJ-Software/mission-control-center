import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { morningReportTopics, morningReportFormatTemplate, morningReportConfig } from '@/lib/schema'
import { eq, asc } from 'drizzle-orm'
import { getGeneratedDir, getTmpDir, getDateVars, substituteVars } from './utils'

interface PromptResult {
  topicId: string
  promptPath: string
  outputPath: string
}

interface GeneratePromptsOutput {
  date: string
  promptCount: number
  results: PromptResult[]
}

/**
 * Extract all URLs from previous day's report files for deduplication.
 * Scans the tmp/ directory for files matching `morning-report-*-{prevDate}.md`.
 */
function extractPrevDayUrls(tmpDir: string, prevDate: string): string[] {
  if (!existsSync(tmpDir)) return []

  const urls = new Set<string>()
  const urlRegex = /https?:\/\/[^\s)]+/g

  try {
    const files = readdirSync(tmpDir).filter(
      (f) => f.startsWith('morning-report-') && f.includes(prevDate) && f.endsWith('.md')
    )

    for (const file of files) {
      const content = readFileSync(join(tmpDir, file), 'utf-8')
      const matches = content.match(urlRegex)
      if (matches) {
        for (const url of matches) {
          urls.add(url)
        }
      }
    }
  } catch {
    // If directory reading fails, just return empty
  }

  return Array.from(urls).sort()
}

/**
 * Build a dedup block to append to prompts, warning the model not to reuse
 * URLs from the previous day's reports.
 */
function buildPrevUrlsBlock(urls: string[]): string {
  if (urls.length === 0) return ''

  return (
    '\n\n---\n\n' +
    '## ⛔ 前日已使用的 URL（禁止重複引用）\n\n' +
    '以下 URL 已在昨日晨報中使用，**嚴禁再次引用**。' +
    '若搜尋到相同 URL，請跳過並尋找其他來源：\n\n' +
    '```\n' +
    urls.join('\n') +
    '\n```\n'
  )
}

/**
 * Compute previous day's date string in yyyyMMdd format.
 */
function getPrevDate(today: string): string {
  const y = parseInt(today.slice(0, 4), 10)
  const m = parseInt(today.slice(4, 6), 10) - 1
  const d = parseInt(today.slice(6, 8), 10)
  const prev = new Date(y, m, d - 1)
  const py = prev.getFullYear().toString()
  const pm = (prev.getMonth() + 1).toString().padStart(2, '0')
  const pd = prev.getDate().toString().padStart(2, '0')
  return `${py}${pm}${pd}`
}

/**
 * Generate prompt files for all enabled morning report topics.
 *
 * Replaces the bash `generate-prompts.sh` script:
 * 1. Compute date variables (TODAY, DATE_HYPHEN, YEAR)
 * 2. Ensure generated/ and tmp/ directories exist
 * 3. Read config from DB (morningReportConfig)
 * 4. Read format template from DB (morningReportFormatTemplate, id=1)
 * 5. Read enabled topics from DB (morningReportTopics, enabled=1, ordered by sortOrder)
 * 6. Extract previous day URLs from existing reports for deduplication
 * 7. Substitute variables in format template
 * 8. For each topic: combine format + topic template with substituted vars,
 *    write to generated/cron-NN-topicId.md
 * 9. Return summary of generated prompts
 */
export function generatePrompts(date?: Date): GeneratePromptsOutput {
  const generatedDir = getGeneratedDir()
  const tmpDir = getTmpDir()

  // 1. Date variables
  const { today, dateHyphen, year } = getDateVars(date)

  // 2. Ensure directories exist
  mkdirSync(generatedDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })

  // 3. Read config from DB
  const configRows = db.select().from(morningReportConfig).all()
  const config: Record<string, string> = {}
  for (const row of configRows) {
    config[row.key] = row.value
  }

  // 4. Read format template from DB
  const formatRow = db
    .select()
    .from(morningReportFormatTemplate)
    .where(eq(morningReportFormatTemplate.id, 1))
    .get()
  const formatTemplate = formatRow?.content ?? ''

  // 5. Read enabled topics ordered by sortOrder
  const topics = db
    .select()
    .from(morningReportTopics)
    .where(eq(morningReportTopics.enabled, 1))
    .orderBy(asc(morningReportTopics.sortOrder))
    .all()

  const topicTotal = topics.length

  // 6. Extract previous day's URLs for dedup
  const prevDate = getPrevDate(today)
  const prevUrls = extractPrevDayUrls(tmpDir, prevDate)
  const prevUrlsBlock = buildPrevUrlsBlock(prevUrls)

  // 7. Build base variable map
  const baseVars: Record<string, string> = {
    TODAY: today,
    DATE_HYPHEN: dateHyphen,
    YEAR: year,
    TMP_DIR: tmpDir,
    LANGUAGE: config.language || '繁體中文',
    TOPIC_TOTAL: String(topicTotal),
  }

  // Substitute vars in format template
  const formatContent = substituteVars(formatTemplate, baseVars)

  // Write _FORMAT.md for reference
  writeFileSync(join(generatedDir, '_FORMAT.md'), formatContent, 'utf-8')

  // Write _prev_urls.txt for reference
  if (prevUrls.length > 0) {
    writeFileSync(
      join(generatedDir, '_prev_urls.txt'),
      prevUrls.join('\n'),
      'utf-8'
    )
  }

  // 8. Generate per-topic prompts
  const results: PromptResult[] = []

  for (const [index, topic] of topics.entries()) {
    const topicIndex = index + 1
    const outputFilename = substituteVars(topic.outputFilename || '', { TODAY: today })
    const outputPath = join(tmpDir, outputFilename)

    // Per-topic variables
    const topicVars: Record<string, string> = {
      ...baseVars,
      TOPIC_NAME: topic.name,
      TOPIC_EMOJI: topic.emoji || '📰',
      TOPIC_INDEX: String(topicIndex),
      OUTPUT_FILE: outputPath,
    }

    // Substitute vars in topic template
    const topicContent = substituteVars(topic.template || '', topicVars)

    // Combine: FORMAT + prev URLs block + separator + topic content
    const fullPrompt =
      formatContent + prevUrlsBlock + '\n\n---\n\n' + topicContent

    const promptFilename = `cron-${String(topicIndex).padStart(2, '0')}-${topic.id}.md`
    const promptPath = join(generatedDir, promptFilename)
    writeFileSync(promptPath, fullPrompt, 'utf-8')

    results.push({
      topicId: topic.id,
      promptPath,
      outputPath,
    })
  }

  return {
    date: dateHyphen,
    promptCount: results.length,
    results,
  }
}
