/**
 * Default templates bundled with the project.
 * Source lives in `data/morning-report/default-templates/`.
 *
 * In release builds we also copy these into `assets/morning-report/default-templates/`,
 * because release install/upgrade scripts replace `data/` with a symlink to the
 * user state dir — that symlink would otherwise nuke the bundled templates.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ASSETS_DIR = join(process.cwd(), 'assets', 'morning-report', 'default-templates')
const DATA_DIR = join(process.cwd(), 'data', 'morning-report', 'default-templates')

function loadTemplate(filename: string): string {
  const fromAssets = join(ASSETS_DIR, filename)
  if (existsSync(fromAssets)) return readFileSync(fromAssets, 'utf-8')
  return readFileSync(join(DATA_DIR, filename), 'utf-8')
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
