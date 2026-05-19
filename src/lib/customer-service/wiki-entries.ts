import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as wiki from '@/lib/second-brain/wiki/cli'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'

const execFileP = promisify(execFile)

export interface WikiEntrySummary {
  id: string
  title: string
  status: string
  sourceType: string
  updatedAt: string
  filename: string
}

export interface WikiEntryDetail extends WikiEntrySummary {
  content: string
  frontmatter: Record<string, string>
}

/**
 * Slugify a title into a filename-safe identifier. Mirrors openclaw's
 * convention: keep CJK characters, replace whitespace + punctuation with `-`,
 * collapse runs of `-`, trim leading/trailing `-`.
 */
export function slugify(title: string): string {
  return title
    .trim()
    .replace(/[\s／\\/，。、：；！？「」『』（）()\[\]{}<>"'`~!@#$%^&*+=|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
}

async function getVaultPath(): Promise<string> {
  const s = await wiki.status()
  if (!s.vaultPath) throw new Error('wiki vault not configured — run openclaw wiki init first')
  return s.vaultPath
}

function sourcesDir(vaultPath: string): string {
  return join(vaultPath, 'sources')
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

/**
 * Parse frontmatter from a markdown file. Returns `{}` if no frontmatter.
 * Simple `key: value` parser — doesn't handle nested YAML, which is fine
 * because wiki source pages use flat keys only.
 */
function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { fm: {}, body: content }
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
    if (m) fm[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return { fm, body: match[2] }
}

function renderFrontmatter(fm: Record<string, string>): string {
  const lines = Object.entries(fm).map(([k, v]) => {
    // Quote values containing colons or starting with special chars to keep
    // YAML happy (openclaw reads its own frontmatter back).
    const needsQuote = /[:#]/.test(v) || /^\s|\s$/.test(v)
    return `${k}: ${needsQuote ? JSON.stringify(v) : v}`
  })
  return `---\n${lines.join('\n')}\n---\n`
}

function renderManualPage(fm: Record<string, string>, content: string): string {
  return `${renderFrontmatter(fm)}\n# ${fm.title}\n\n## Source\n- Type: \`manual\`\n- Updated: ${fm.updatedAt}\n\n## Content\n${content.trim()}\n`
}

function extractContent(body: string): string {
  // The manual page format has "## Content\n<actual content>". Pull just the
  // content section back out so editing round-trips cleanly. If we don't find
  // the marker, fall back to the whole body so we don't lose data from pages
  // that were ingested differently.
  const idx = body.indexOf('## Content')
  if (idx === -1) return body.trim()
  return body.slice(idx + '## Content'.length).trim()
}

export async function listEntries(): Promise<WikiEntrySummary[]> {
  const dir = sourcesDir(await getVaultPath())
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  const entries: WikiEntrySummary[] = []
  for (const filename of files) {
    const full = join(dir, filename)
    try {
      const content = readFileSync(full, 'utf-8')
      const { fm } = parseFrontmatter(content)
      const id = fm.id || `source.${basename(filename, '.md')}`
      entries.push({
        id,
        title: fm.title || basename(filename, '.md'),
        status: fm.status || 'active',
        sourceType: fm.sourceType || 'unknown',
        updatedAt: fm.updatedAt || statSync(full).mtime.toISOString(),
        filename,
      })
    } catch {
      // skip unreadable file
    }
  }
  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return entries
}

async function findEntryFile(filename: string): Promise<string> {
  const dir = sourcesDir(await getVaultPath())
  // Hard-block path traversal: filename must be a single basename ending in .md
  if (filename.includes('/') || filename.includes('\\') || !filename.endsWith('.md')) {
    throw new Error('invalid filename')
  }
  const full = join(dir, filename)
  if (!existsSync(full)) throw new Error(`entry not found: ${filename}`)
  return full
}

export async function getEntry(filename: string): Promise<WikiEntryDetail> {
  const full = await findEntryFile(filename)
  const raw = readFileSync(full, 'utf-8')
  const { fm, body } = parseFrontmatter(raw)
  return {
    id: fm.id || `source.${basename(filename, '.md')}`,
    title: fm.title || basename(filename, '.md'),
    status: fm.status || 'active',
    sourceType: fm.sourceType || 'unknown',
    updatedAt: fm.updatedAt || statSync(full).mtime.toISOString(),
    filename,
    content: extractContent(body),
    frontmatter: fm,
  }
}

async function compileWiki(): Promise<void> {
  // Refresh wiki indexes (entities/concepts) after a source mutation. Best
  // effort — index drift would just delay search visibility, not break it.
  try {
    const bin = findOpenclawBin()
    await execFileP(bin, ['wiki', 'compile'], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
  } catch {
    // ignore — surface via lint UI later
  }
}

export async function createEntry(title: string, content: string): Promise<WikiEntrySummary> {
  const t = title.trim()
  if (!t) throw new Error('title required')
  const slug = slugify(t)
  if (!slug) throw new Error('title produced empty slug — use alphanumeric characters')

  const vaultPath = await getVaultPath()
  const dir = sourcesDir(vaultPath)
  ensureDir(dir)

  const filename = `${slug}.md`
  const full = join(dir, filename)
  if (existsSync(full)) throw new Error(`an entry with this title already exists (${filename})`)

  const now = new Date().toISOString()
  const fm: Record<string, string> = {
    pageType: 'source',
    id: `source.${slug}`,
    title: t,
    sourceType: 'manual',
    ingestedAt: now,
    updatedAt: now,
    status: 'active',
  }
  writeFileSync(full, renderManualPage(fm, content), 'utf-8')
  await compileWiki()
  return {
    id: fm.id,
    title: t,
    status: 'active',
    sourceType: 'manual',
    updatedAt: now,
    filename,
  }
}

export async function updateEntry(
  filename: string,
  patch: { title?: string; content?: string; status?: string },
): Promise<WikiEntryDetail> {
  const full = await findEntryFile(filename)
  const raw = readFileSync(full, 'utf-8')
  const { fm } = parseFrontmatter(raw)

  if (patch.title !== undefined) fm.title = patch.title.trim()
  if (patch.status !== undefined) fm.status = patch.status
  fm.updatedAt = new Date().toISOString()

  const newContent = patch.content !== undefined ? patch.content : extractContent(parseFrontmatter(raw).body)
  writeFileSync(full, renderManualPage(fm, newContent), 'utf-8')
  await compileWiki()
  return getEntry(filename)
}

export async function deleteEntry(filename: string): Promise<void> {
  const full = await findEntryFile(filename)
  unlinkSync(full)
  await compileWiki()
}
