import { db } from '@/lib/db'
import { morningReportTopics, morningReportFormatTemplate, morningReportConfig } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_FORMAT_TEMPLATE,
  DEFAULT_TOPIC_TEMPLATES,
  DEFAULT_FINALIZE_MESSAGE,
  DEFAULT_PODCAST_MESSAGE,
  DEFAULT_PODCAST_HARVEST_MESSAGE,
  DEFAULT_FINALIZE_HTML,
  DEFAULT_PODCAST_SCRIPT,
  DEFAULT_PODCAST_POLISH,
} from './default-templates'
import { recordTemplateVersion } from './template-versions'

/**
 * Load default templates into the database.
 * Updates the format template and all topic templates that have defaults.
 */
export function loadDefaultTemplates() {
  let topicsUpdated = 0

  for (const [topicId, template] of Object.entries(DEFAULT_TOPIC_TEMPLATES)) {
    // This rewrites every topic in one click, so capturing the outgoing text
    // is what makes the action undoable.
    const prev = db.select().from(morningReportTopics)
      .where(eq(morningReportTopics.id, topicId)).get()?.template
    recordTemplateVersion({
      scope: 'topic',
      refId: topicId,
      content: template,
      previous: prev ?? undefined,
      origin: 'reset-default',
    })
    db.update(morningReportTopics)
      .set({ template })
      .where(eq(morningReportTopics.id, topicId))
      .run()
    topicsUpdated++
  }

  const prevFormat = db.select().from(morningReportFormatTemplate)
    .where(eq(morningReportFormatTemplate.id, 1)).get()?.content
  recordTemplateVersion({
    scope: 'format',
    refId: 'format',
    content: DEFAULT_FORMAT_TEMPLATE,
    previous: prevFormat ?? undefined,
    origin: 'reset-default',
  })
  db.insert(morningReportFormatTemplate)
    .values({ id: 1, content: DEFAULT_FORMAT_TEMPLATE })
    .onConflictDoUpdate({
      target: morningReportFormatTemplate.id,
      set: { content: DEFAULT_FORMAT_TEMPLATE },
    })
    .run()

  const templateConfigs: Record<string, string> = {
    finalizeMessageTemplate: DEFAULT_FINALIZE_MESSAGE,
    podcastMessageTemplate: DEFAULT_PODCAST_MESSAGE,
    podcastHarvestMessageTemplate: DEFAULT_PODCAST_HARVEST_MESSAGE,
    finalizeHtmlTemplate: DEFAULT_FINALIZE_HTML,
    podcastScriptTemplate: DEFAULT_PODCAST_SCRIPT,
    podcastPolishTemplate: DEFAULT_PODCAST_POLISH,
  }
  for (const [key, value] of Object.entries(templateConfigs)) {
    const prev = db.select().from(morningReportConfig)
      .where(eq(morningReportConfig.key, key)).get()?.value
    recordTemplateVersion({
      scope: 'config',
      refId: key,
      content: value,
      previous: prev,
      origin: 'reset-default',
    })
    db.insert(morningReportConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: morningReportConfig.key, set: { value } })
      .run()
  }

  return {
    success: true,
    topicsUpdated,
    formatUpdated: true,
    templatesReset: Object.keys(templateConfigs).length,
  }
}
