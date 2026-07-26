import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { morningReportTemplateVersions } from '@/lib/schema'
import { and, eq, desc, sql } from 'drizzle-orm'

/**
 * Edit history for operator-editable templates.
 *
 * Three storage locations feed this: per-topic prompts, the shared FORMAT
 * block, and the message/HTML/script templates in morning_report_config.
 * `scope` distinguishes them; `refId` picks one out.
 *
 * Capture happens server-side on purpose. The templates are also rewritten by
 * `loadDefaultTemplates()` (the "還原預設" button, which rewrites *every* topic
 * at once) and could be written by the CLI or a cron-driven call — hooking the
 * client mutation would miss all of those, and the bulk reset is precisely the
 * case where history matters most.
 */

export type TemplateScope = 'topic' | 'format' | 'config'

/** How a version came to exist. `baseline` is the pre-existing value captured
 *  the first time a ref is versioned — see recordTemplateVersion. */
export type VersionOrigin = 'baseline' | 'save' | 'reset-default' | 'restore'

/** Versions kept per ref. Plain text a few KB each; this is a spam bound, not
 *  a space concern. */
const MAX_VERSIONS_PER_REF = 50

export interface TemplateVersionRow {
  id: number
  scope: string
  refId: string
  content: string
  contentHash: string
  origin: string
  note: string | null
  createdAt: number
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function newestVersion(scope: TemplateScope, refId: string): TemplateVersionRow | undefined {
  return db
    .select()
    .from(morningReportTemplateVersions)
    .where(and(
      eq(morningReportTemplateVersions.scope, scope),
      eq(morningReportTemplateVersions.refId, refId),
    ))
    .orderBy(desc(morningReportTemplateVersions.id))
    .limit(1)
    .get() as TemplateVersionRow | undefined
}

function insert(
  scope: TemplateScope,
  refId: string,
  content: string,
  origin: VersionOrigin,
  note?: string,
): void {
  db.insert(morningReportTemplateVersions)
    .values({ scope, refId, content, contentHash: hash(content), origin, note: note ?? null })
    .run()
}

/** Drop everything past the newest MAX_VERSIONS_PER_REF for this ref. */
function prune(scope: TemplateScope, refId: string): void {
  db.run(sql`
    DELETE FROM morning_report_template_versions
     WHERE scope = ${scope} AND ref_id = ${refId}
       AND id NOT IN (
         SELECT id FROM morning_report_template_versions
          WHERE scope = ${scope} AND ref_id = ${refId}
          ORDER BY id DESC
          LIMIT ${MAX_VERSIONS_PER_REF}
       )
  `)
}

export interface RecordVersionInput {
  scope: TemplateScope
  refId: string
  /** The content being saved. */
  content: string
  /** What the template held immediately before this write, when the caller can
   *  cheaply read it. Used only to seed the baseline (see below). */
  previous?: string
  origin?: VersionOrigin
  note?: string
}

/**
 * Record a version, if there is anything new to record.
 *
 * Two behaviours worth knowing:
 *
 * - **Baseline seeding.** History stores what a template *became*, so the
 *   newest row is always the current value. On its own that loses the original
 *   the first time someone edits a template they didn't write — the exact
 *   moment they're most likely to want it back. So when a ref has no history
 *   yet, the pre-edit content is written first as a `baseline` version.
 *
 * - **No-op saves are ignored.** Re-saving unchanged text (a stray click, a
 *   sync that rewrites every field) matches the newest hash and is dropped, so
 *   the list stays meaningful.
 *
 * Never throws: losing a history entry must not fail the save it accompanies.
 */
export function recordTemplateVersion(input: RecordVersionInput): void {
  const { scope, refId, content, previous, origin = 'save', note } = input
  try {
    const latest = newestVersion(scope, refId)

    if (!latest && previous !== undefined && previous !== '' && previous !== content) {
      insert(scope, refId, previous, 'baseline')
    }

    if (latest?.contentHash === hash(content)) return

    insert(scope, refId, content, origin, note)
    prune(scope, refId)
  } catch (err) {
    console.warn('[template-versions] failed to record version:', (err as Error).message)
  }
}

/**
 * Origin a client is allowed to claim.
 *
 * Only 'restore' — 'baseline' and 'reset-default' describe server-side events
 * and are set by the code paths that cause them, so a caller can't mislabel an
 * ordinary edit as one.
 */
export function callerOrigin(value: unknown): VersionOrigin {
  return value === 'restore' ? 'restore' : 'save'
}

/** Newest-first history for one template. */
export function listTemplateVersions(
  scope: TemplateScope,
  refId: string,
  limit = MAX_VERSIONS_PER_REF,
): TemplateVersionRow[] {
  return db
    .select()
    .from(morningReportTemplateVersions)
    .where(and(
      eq(morningReportTemplateVersions.scope, scope),
      eq(morningReportTemplateVersions.refId, refId),
    ))
    .orderBy(desc(morningReportTemplateVersions.id))
    .limit(limit)
    .all() as TemplateVersionRow[]
}

/** One version by id, for loading an older revision into the editor. */
export function getTemplateVersion(id: number): TemplateVersionRow | undefined {
  return db
    .select()
    .from(morningReportTemplateVersions)
    .where(eq(morningReportTemplateVersions.id, id))
    .get() as TemplateVersionRow | undefined
}
