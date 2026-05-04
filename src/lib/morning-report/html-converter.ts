import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { format } from 'date-fns'
import { getDateVars } from './utils'
import { getTemplate } from './template-helpers'

/**
 * Check if pandoc is available on the system.
 */
function hasPandoc(): boolean {
  try {
    execSync('which pandoc', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Convert markdown to HTML using pandoc.
 */
function markdownToHtmlPandoc(markdown: string): string {
  return execSync('pandoc -f markdown -t html', {
    input: markdown,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * Fallback: convert markdown to HTML using regex.
 */
function markdownToHtmlRegex(markdown: string): string {
  let html = markdown

  // Headings (order matters: ### before ## before #)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+?)(?:\s*\{#[\w-]+\})?$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>')

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')

  // List items: wrap consecutive <li> in <ul>
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>')
  // Wrap consecutive <li> lines in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>\n$1</ul>\n')

  // Paragraphs: wrap remaining non-tag lines separated by double newlines
  const blocks = html.split(/\n\n+/)
  html = blocks
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      // Don't wrap lines that already start with an HTML tag
      if (/^<(?:h[1-6]|ul|ol|li|blockquote|hr|p|div|section|table)/.test(trimmed)) {
        return trimmed
      }
      // Don't wrap if it's just whitespace
      if (!trimmed.replace(/\s/g, '')) return ''
      return `<p>${trimmed}</p>`
    })
    .join('\n\n')

  return html
}

/**
 * Extract h2 headings and their content, wrapping each in a section div.
 */
function wrapSections(html: string): { toc: string; content: string } {
  const tocItems: string[] = []

  // Split by <h2> tags
  const parts = html.split(/(?=<h2>)/g)
  const sections: string[] = []
  let sectionIndex = 0

  for (const part of parts) {
    const h2Match = part.match(/<h2>(.+?)<\/h2>/)
    if (h2Match) {
      const heading = h2Match[1].trim()
      const id = `section-${sectionIndex}`
      tocItems.push(`<li><a href="#${id}">${heading}</a></li>`)

      // Replace the h2 with one that has an id, wrap in section
      const sectionContent = part.replace(
        /<h2>(.+?)<\/h2>/,
        `<h2 id="${id}">$1</h2>`
      )
      sections.push(`<section class="section" id="${id}">\n${sectionContent}\n</section>`)
      sectionIndex++
    } else {
      // Content before the first h2 (like h1 title) — include as-is
      if (part.trim()) {
        sections.push(part)
      }
    }
  }

  const toc = `<ul>\n${tocItems.join('\n')}\n</ul>`
  const content = sections.join('\n\n')

  return { toc, content }
}

/**
 * Convert a merged markdown report to a full styled HTML page.
 */
export function convertToHtml(markdownPath: string, date?: Date): string {
  const now = date ?? new Date()
  const { dateHyphen } = getDateVars(now)
  const dateEnglish = format(now, 'MMMM d, yyyy')
  const generatedAt = format(now, 'yyyy-MM-dd HH:mm:ss')

  const markdown = readFileSync(markdownPath, 'utf-8')

  // Convert markdown to HTML
  let rawHtml: string
  if (hasPandoc()) {
    rawHtml = markdownToHtmlPandoc(markdown)
  } else {
    rawHtml = markdownToHtmlRegex(markdown)
  }

  // Wrap h2 sections and build TOC
  const { toc, content } = wrapSections(rawHtml)

  // Substitute template variables
  const html = getTemplate('finalizeHtmlTemplate')
    .replace(/\{\{DATE_HYPHEN\}\}/g, dateHyphen)
    .replace(/\{\{DATE_ENGLISH\}\}/g, dateEnglish)
    .replace(/\{\{TOC\}\}/g, toc)
    .replace(/\{\{CONTENT\}\}/g, content)
    .replace(/\{\{GENERATED_AT\}\}/g, generatedAt)

  return html
}
