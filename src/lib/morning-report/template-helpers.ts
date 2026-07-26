import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_FINALIZE_MESSAGE,
  DEFAULT_PODCAST_MESSAGE,
  DEFAULT_PODCAST_HARVEST_MESSAGE,
  DEFAULT_FINALIZE_HTML,
  DEFAULT_PODCAST_SCRIPT,
  DEFAULT_PODCAST_POLISH,
} from './default-templates'

const DEFAULTS = {
  finalizeMessageTemplate: DEFAULT_FINALIZE_MESSAGE,
  podcastMessageTemplate: DEFAULT_PODCAST_MESSAGE,
  // Was missing here while sync-cron already called getTemplate() for it, so
  // the bundled fallback resolved to undefined and the subsequent .replace()
  // would throw on any install whose config row was empty.
  podcastHarvestMessageTemplate: DEFAULT_PODCAST_HARVEST_MESSAGE,
  finalizeHtmlTemplate: DEFAULT_FINALIZE_HTML,
  podcastScriptTemplate: DEFAULT_PODCAST_SCRIPT,
  podcastPolishTemplate: DEFAULT_PODCAST_POLISH,
} satisfies Record<string, string>

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
 * Editable templates stored in morning_report_config that ship no bundled
 * default — their fallback is written inline at the call site. They still need
 * history: an override with no recorded origin is exactly the kind of thing
 * that sits in a database for months with nobody able to say what it replaced.
 */
const UNBUNDLED_TEMPLATE_KEYS = ['generatePromptsMessageTemplate']

/**
 * Does this morning_report_config key hold an editable template?
 *
 * Driven off DEFAULTS so adding a bundled template automatically gives it edit
 * history. Most config keys are scalars (cron expressions, model ids) and are
 * deliberately not versioned.
 */
export function isVersionedTemplateKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULTS, key)
    || UNBUNDLED_TEMPLATE_KEYS.includes(key)
}

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
