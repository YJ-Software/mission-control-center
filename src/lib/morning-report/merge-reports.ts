import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { morningReportTopics } from '@/lib/schema'
import { eq, asc } from 'drizzle-orm'
import { getTmpDir, getDateVars } from './utils'

export async function mergeReports(date?: Date) {
  const now = date ?? new Date()
  const { today, dateHyphen } = getDateVars(now)
  const tmpDir = getTmpDir()

  // Ensure tmpDir exists
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true })
  }

  // Read enabled topics from DB ordered by sortOrder
  const topics = db
    .select()
    .from(morningReportTopics)
    .where(eq(morningReportTopics.enabled, 1))
    .orderBy(asc(morningReportTopics.sortOrder))
    .all()

  // Build TOC and content sections
  const tocLines: string[] = []
  const sections: string[] = []

  for (const topic of topics) {
    const emoji = topic.emoji ?? '📰'
    const heading = `${emoji} ${topic.name}`
    const anchor = topic.id

    tocLines.push(`- [${heading}](#${anchor})`)

    // Resolve output filename: replace ${TODAY} with today's date string
    const filename = (topic.outputFilename ?? '').replace(/\$\{TODAY\}/g, today)
    const filePath = join(tmpDir, filename)

    let content: string
    if (filename && existsSync(filePath)) {
      content = readFileSync(filePath, 'utf-8')
    } else {
      content = `> ⚠️ 此段落尚未生成`
    }

    sections.push(`## ${heading} {#${anchor}}\n\n${content}`)
  }

  // Combine TOC and sections
  const toc = tocLines.join('\n')
  const body = sections.join('\n\n---\n\n')
  const merged = `# 🌅 晨報 ${dateHyphen}\n\n${toc}\n\n---\n\n${body}\n`

  // Write merged file
  const outputPath = join(tmpDir, `morning-report-${today}.md`)
  writeFileSync(outputPath, merged, 'utf-8')

  return {
    outputPath,
    topicCount: topics.length,
    date: dateHyphen,
  }
}
