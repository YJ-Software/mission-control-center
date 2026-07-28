import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { morningReportTopics, morningReportFormatTemplate, morningReportConfig } from '@/lib/schema'
import { eq, asc } from 'drizzle-orm'
import { getGeneratedDir, getTmpDir, getDateVars, substituteVars } from './utils'
import {
  getRecentlyCitedUrls,
  getCandidatesForFeeds,
  backfillCitedUrlsFromReports,
  type CandidateRow,
} from './news-store'

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

/** Days of citation history shown to the agent when the operator hasn't said. */
const DEFAULT_DEDUP_DAYS = 14

/**
 * Build the do-not-repeat block from the citation ledger.
 *
 * This used to be assembled by regexing yesterday's files out of tmp/, which
 * saw exactly one day back, went blank whenever tmp was cleaned at seven days,
 * and matched raw strings — so the same article carrying `?utm_source=rss`
 * read as new. The ledger has none of those limits.
 */
function buildCitedUrlsBlock(urls: string[], days: number): string {
  if (urls.length === 0) return ''

  return (
    '\n\n---\n\n' +
    `## ⛔ 近 ${days} 日已使用的 URL（禁止重複引用）\n\n` +
    `以下 URL 已在近 ${days} 日的晨報中使用，**嚴禁再次引用**。` +
    '若搜尋到相同 URL，請跳過並尋找其他來源：\n\n' +
    '```\n' +
    urls.join('\n') +
    '\n```\n'
  )
}

/** Most candidates a topic's prompt will carry. */
const MAX_CANDIDATES = 30
/** How far back a candidate stays worth offering. */
const CANDIDATE_WINDOW_DAYS = 3

export type SourceMode = 'search' | 'feed' | 'feed+search'

function parseFeedIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Render the linked sources into the prompt.
 *
 * The wording differs by mode and is generated rather than authored, so it
 * can't drift out of step with what the topic is actually configured to do.
 *
 * The `feed` case says two things deliberately, because they are easy to
 * conflate: don't go looking for *other* stories, but do open each of these
 * and read them. RSS carries a title and a sentence — an agent told only "use
 * these sources" will happily paraphrase the summary and call it a report.
 */
export function buildSourceBlock(mode: SourceMode, candidates: CandidateRow[]): string {
  if (mode === 'search' || candidates.length === 0) return ''

  const list = candidates
    .map((c) => {
      const when = c.publishedAt
        ? new Date(c.publishedAt * 1000).toISOString().slice(0, 10)
        : ''
      const meta = [c.host, when].filter(Boolean).join('，')
      return `- ${c.title || c.url}\n  ${c.url}\n  （${meta}）`
    })
    .join('\n')

  const instruction = mode === 'feed'
    ? '**本主題只能使用以下來源撰寫，不要自行搜尋其他新聞。**\n' +
      '但你**必須實際開啟以下每一個連結、閱讀全文**再撰寫——以下的摘要只是索引，' +
      '直接改寫摘要不算完成。\n' +
      '若這些素材不足以支撐完整報告，請就現有素材撰寫，並在段落結尾註明素材不足。'
    : '**這些不是全部素材。**請先評估以下來源，並實際開啟連結閱讀全文。\n' +
      '接著你**必須另外自行搜尋**，補齊這份清單沒有涵蓋到的角度——' +
      '**即使以上素材看起來已經足夠，仍然要搜尋**。\n' +
      '這些來源通常只來自少數幾個關鍵字，會有明顯的盲區；' +
      '最終報告必須同時包含清單內與你自行搜尋到的內容。'

  return (
    '\n\n---\n\n' +
    '## 📥 指定新聞來源\n\n' +
    `以下為系統預先蒐集、且確認未在近期晨報出現過的文章（共 ${candidates.length} 則）。\n\n` +
    instruction + '\n\n' +
    list + '\n'
  )
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
 * 6. Read recently cited URLs from the ledger for deduplication
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

  // 6. Pull recently cited URLs from the ledger for dedup
  const dedupDays = Number(config.dedupDays) > 0
    ? Number(config.dedupDays)
    : DEFAULT_DEDUP_DAYS
  // An install upgrading into the ledger has nothing in it yet. Seed from the
  // reports the previous mechanism read, so the first run after upgrading
  // still knows what yesterday used. No-ops once the ledger has anything.
  backfillCitedUrlsFromReports(tmpDir, dedupDays)
  const prevUrls = getRecentlyCitedUrls(dedupDays)
  const prevUrlsBlock = buildCitedUrlsBlock(prevUrls, dedupDays)

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
    let topicContent = substituteVars(topic.template || '', topicVars)

    const mode = (topic.sourceMode || 'search') as SourceMode
    const feedIds = parseFeedIds(topic.feedIds)
    const candidates = mode === 'search' || feedIds.length === 0
      ? []
      : getCandidatesForFeeds(feedIds, {
          limit: MAX_CANDIDATES,
          withinDays: CANDIDATE_WINDOW_DAYS,
        })
    const sourceBlock = buildSourceBlock(mode, candidates)

    // A template can place the sources itself with {{FEED_ARTICLES}}; without
    // the marker the block is appended, so templates written before any of
    // this existed keep working untouched.
    let appendSourceBlock = sourceBlock
    if (topicContent.includes('{{FEED_ARTICLES}}')) {
      topicContent = topicContent.replaceAll('{{FEED_ARTICLES}}', sourceBlock.trimStart())
      appendSourceBlock = ''
    }

    // Combine: FORMAT + prev URLs block + sources + separator + topic content
    const fullPrompt =
      formatContent + prevUrlsBlock + appendSourceBlock + '\n\n---\n\n' + topicContent

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
