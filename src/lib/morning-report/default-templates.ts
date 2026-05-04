/**
 * Default templates bundled with the project.
 * Templates are stored as individual MD files in data/morning-report/default-templates/
 * and loaded at runtime.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const TEMPLATES_DIR = join(process.cwd(), 'data', 'morning-report', 'default-templates')

function loadTemplate(filename: string): string {
  return readFileSync(join(TEMPLATES_DIR, filename), 'utf-8')
}

export const DEFAULT_FORMAT_TEMPLATE = loadTemplate('_format.md')

const TOPIC_FILES = ['ai', 'stocks', 'crypto', 'social', 'arxiv', 'geo'] as const

export const DEFAULT_TOPIC_TEMPLATES: Record<string, string> = Object.fromEntries(
  TOPIC_FILES.map(id => [id, loadTemplate(`${id}.md`)])
)

export const DEFAULT_FINALIZE_MESSAGE = loadTemplate('_finalize-message.md')
export const DEFAULT_PODCAST_MESSAGE = loadTemplate('_podcast-message.md')
export const DEFAULT_PODCAST_HARVEST_MESSAGE = loadTemplate('_podcast-harvest-message.md')
export const DEFAULT_FINALIZE_HTML = loadTemplate('_finalize-html.html')
export const DEFAULT_PODCAST_SCRIPT = loadTemplate('_podcast-script.md')
export const DEFAULT_PODCAST_POLISH = loadTemplate('_podcast-polish.md')
