import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_FINALIZE_MESSAGE,
  DEFAULT_PODCAST_MESSAGE,
  DEFAULT_FINALIZE_HTML,
  DEFAULT_PODCAST_SCRIPT,
  DEFAULT_PODCAST_POLISH,
} from './default-templates'

const DEFAULTS: Record<string, string> = {
  finalizeMessageTemplate: DEFAULT_FINALIZE_MESSAGE,
  podcastMessageTemplate: DEFAULT_PODCAST_MESSAGE,
  finalizeHtmlTemplate: DEFAULT_FINALIZE_HTML,
  podcastScriptTemplate: DEFAULT_PODCAST_SCRIPT,
  podcastPolishTemplate: DEFAULT_PODCAST_POLISH,
}

/**
 * Get a template value from DB config, falling back to bundled default.
 */
export function getTemplate(key: keyof typeof DEFAULTS): string {
  const row = db.select().from(morningReportConfig)
    .where(eq(morningReportConfig.key, key))
    .get()
  return row?.value || DEFAULTS[key]
}

/**
 * Get the default (bundled) template for a given key.
 */
export function getDefaultTemplate(key: keyof typeof DEFAULTS): string {
  return DEFAULTS[key]
}

export type TemplateKey = keyof typeof DEFAULTS

/**
 * Parse podcast script template into intro/transition/outro sections.
 */
export function parsePodcastScript(script: string): {
  intro: string
  transition: string
  outro: string
} {
  const sections: Record<string, string> = {}
  let currentSection = ''

  for (const line of script.split('\n')) {
    const heading = line.match(/^## (.+)/)
    if (heading) {
      currentSection = heading[1].trim()
      sections[currentSection] = ''
    } else if (currentSection) {
      sections[currentSection] += line + '\n'
    }
  }

  return {
    intro: (sections['開場白'] ?? '').trim(),
    transition: (sections['轉場'] ?? '').trim(),
    outro: (sections['結語'] ?? '').trim(),
  }
}
