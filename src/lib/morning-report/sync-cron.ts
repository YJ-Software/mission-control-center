import { db } from '@/lib/db'
import { morningReportTopics, morningReportConfig } from '@/lib/schema'
import { asc, eq } from 'drizzle-orm'
import { getOpenClawDefaultModel, getGeneratedDir } from './utils'
import { join } from 'path'
import { cronList, cronAdd, cronRemove, type CronJobInfo } from './cron-cli'
import { getTemplate } from './template-helpers'

function getConfigValue(key: string): string {
  const row = db.select().from(morningReportConfig).where(eq(morningReportConfig.key, key)).get()
  return row?.value ?? ''
}

/**
 * Sync morning report topics to OpenClaw cron jobs via CLI.
 *
 * Strategy: delete-then-recreate all morning report jobs (name starts with "🌅").
 * The Gateway assigns UUIDs on creation, so we can't rely on stable IDs.
 * Since these jobs are fully system-managed, recreating is safe and ensures
 * no duplicates accumulate.
 */
export async function syncCronJobs() {
  const topics = db.select().from(morningReportTopics).orderBy(asc(morningReportTopics.sortOrder)).all()

  const masterEnabled = getConfigValue('enabled') === 'true'
  const finalizeEnabled = getConfigValue('finalizeEnabled') !== 'false' // default true
  const podcastEnabled = getConfigValue('podcastEnabled') !== 'false' // default true

  const globalModel = getConfigValue('cronModel') || getOpenClawDefaultModel() || 'zai/glm-5'
  const tgChatId = getConfigValue('tgChatId')
  const baseUrl = getConfigValue('missionControlUrl') || 'http://localhost:3737'
  const generatedDir = getGeneratedDir()

  // Fetch existing jobs from Gateway
  let existingJobs: CronJobInfo[] = []
  try {
    existingJobs = await cronList()
  } catch (err) {
    console.warn('[sync-cron] Failed to list cron jobs:', err)
    return { synced: 0, error: 'Failed to list cron jobs from Gateway' }
  }

  // Delete ALL existing morning report jobs (identified by 🌅 name prefix)
  const mrJobs = existingJobs.filter(j => j.name?.startsWith('🌅'))
  if (mrJobs.length > 0) {
    console.log(`[sync-cron] Removing ${mrJobs.length} existing morning report jobs...`)
    for (const j of mrJobs) {
      try {
        await cronRemove(j.id)
      } catch {
        // Ignore removal errors
      }
    }
  }

  // Recreate all desired jobs
  const description = '此任務由晨報系統管理，不建議手動變更，手動變更的設定會被系統改寫。'
  let created = 0

  async function addJob(
    name: string,
    cronExpr: string,
    enabled: boolean,
    message: string,
    timeout: number,
    jobModel?: string,
    delivery?: { announce?: boolean; noDeliver?: boolean; channel?: string; to?: string },
  ) {
    const effectiveModel = jobModel || globalModel
    await cronAdd({
      name,
      description,
      cron: cronExpr,
      tz: 'Asia/Taipei',
      session: 'isolated',
      message,
      model: effectiveModel,
      timeoutSeconds: timeout,
      enabled,
      announce: delivery?.noDeliver ? false : true,
      noDeliver: delivery?.noDeliver,
      channel: delivery?.channel ?? (tgChatId ? 'telegram' : 'last'),
      to: delivery?.to ?? (tgChatId || undefined),
      wake: 'now',
    })
    created++
  }

  // Build delivery base
  const baseDelivery = tgChatId
    ? { announce: true, channel: 'telegram', to: tgChatId }
    : { announce: true, channel: 'last' as const }

  // Generate-prompts job: configurable minutes before first enabled topic
  if (topics.length > 0) {
    const gpInterval = parseInt(getConfigValue('interval') || '5', 10) || 5
    const gpModel = getConfigValue('generatePromptsModel') || undefined
    const gpMessageTemplate = getConfigValue('generatePromptsMessageTemplate')
    const gpMessage = gpMessageTemplate || `使用 exec 工具執行以下指令來生成晨報 prompts：\ncurl -s -X POST '${baseUrl}/api/morning-report?action=generate-prompts'\n回報產生了幾個 prompt 檔案。`

    const enabledTopics = topics.filter(t => t.enabled)
    const firstCron = (enabledTopics.length > 0 ? enabledTopics[0].cronTime : topics[0].cronTime) ?? '0 8'
    const [firstMin, firstHour] = firstCron.split(' ').map(Number)
    let promptMin = firstMin - gpInterval
    let promptHour = firstHour
    if (promptMin < 0) { promptMin += 60; promptHour-- }
    if (promptHour < 0) promptHour = 23

    await addJob(
      '🌅 晨報 generate-prompts',
      `${promptMin} ${promptHour} * * *`,
      masterEnabled,
      gpMessage,
      180,
      gpModel,
      { announce: true, noDeliver: true },
    )
  }

  // Topic jobs
  for (const [index, topic] of topics.entries()) {
    const cronExpr = `${topic.cronTime ?? '0 8'} * * *`
    const mode = topic.deliveryMode || 'none'
    const topicDelivery = mode === 'none'
      ? { announce: true, noDeliver: true }
      : mode === 'announce'
        ? baseDelivery
        : { announce: false, noDeliver: true } // webhook — handled by OpenClaw
    const promptFilename = `cron-${String(index + 1).padStart(2, '0')}-${topic.id}.md`
    const promptPath = join(generatedDir, promptFilename)
    await addJob(
      `🌅 晨報(${topic.sortOrder + 1}/${topics.length}) ${topic.name}`,
      cronExpr,
      masterEnabled && !!topic.enabled,
      `讀取並嚴格執行以下 prompt 檔案中的完整指令：\n\n\`${promptPath}\`\n\n請先讀取該檔案的完整內容，然後按照檔案中的所有指示執行（包括搜尋新聞、整理內容、寫入指定的輸出檔）。`,
      topic.timeoutSeconds ?? 600,
      topic.model || '',
      topicDelivery,
    )
  }

  // Finalize & podcast jobs
  if (topics.length > 0) {
    const interval = Number(getConfigValue('interval')) || 5
    const enabledTopics = topics.filter(t => t.enabled)
    const lastCron = enabledTopics.length > 0
      ? (enabledTopics[enabledTopics.length - 1].cronTime ?? '0 8')
      : (topics[0].cronTime ?? '0 8')
    const [lastMin, lastHour] = lastCron.split(' ').map(Number)

    let finMin = lastMin + interval
    let finHour = lastHour
    if (finMin >= 60) { finMin -= 60; finHour++ }
    if (finHour >= 24) finHour = 0

    const finalizeModel = getConfigValue('finalizeModel') || ''
    const podcastModel = getConfigValue('podcastModel') || ''

    await addJob(
      '🌅 晨報 finalize',
      `${finMin} ${finHour} * * *`,
      masterEnabled && finalizeEnabled,
      getTemplate('finalizeMessageTemplate').replace(/\$\{BASE_URL\}/g, baseUrl),
      600,
      finalizeModel,
      baseDelivery,
    )

    let podMin = lastMin + interval * 2
    let podHour = lastHour
    if (podMin >= 60) { podMin -= 60; podHour++ }
    if (podHour >= 24) podHour = 0

    // Trigger model: separate from podcastModel (which controls the
    // server-side polish step). Lets operator pick a cheap small model
    // for the cron agent without dropping polish quality. Falls back to
    // podcastModel for backwards compat when not set.
    const podcastTriggerModel = getConfigValue('podcastTriggerModel') || podcastModel
    await addJob(
      '🌅 晨報 podcast',
      `${podMin} ${podHour} * * *`,
      masterEnabled && podcastEnabled,
      getTemplate('podcastMessageTemplate').replace(/\$\{BASE_URL\}/g, baseUrl),
      // Trigger-only agent finishes in seconds. Keep timeout modest so a
      // hung agent doesn't sit around — the harvest job picks up the URL.
      120,
      podcastTriggerModel,
      // No-deliver: trigger agent only logs that it fired; harvest agent is
      // the one that announces the URL to the user channel.
      { announce: true, noDeliver: true },
    )

    // Harvest job — runs one more `interval` step after the podcast trigger
    // to collect the result and announce the URL. Slot fits naturally in
    // the topic-spacing grid (interval × 3 from last topic). Cleanly
    // separates "fire" from "report" so a slow-generation run never times
    // out the agent.
    let harvestMin = lastMin + interval * 3
    let harvestHour = lastHour
    while (harvestMin >= 60) { harvestMin -= 60; harvestHour++ }
    if (harvestHour >= 24) harvestHour = 0
    const podcastHarvestEnabled = getConfigValue('podcastHarvestEnabled') !== 'false'
    const harvestTemplate = getTemplate('podcastHarvestMessageTemplate')
      .replace(/\$\{BASE_URL\}/g, baseUrl)

    // Harvest is its own curl-wrapper agent — separate model knob lets the
    // operator pick a cheap model without affecting the podcast trigger or
    // the server-side polish step. Falls back to podcastModel for backwards
    // compatibility with installs that haven't set the new key.
    const podcastHarvestModel = getConfigValue('podcastHarvestModel') || podcastModel
    await addJob(
      '🌅 晨報 podcast 收割',
      `${harvestMin} ${harvestHour} * * *`,
      masterEnabled && podcastEnabled && podcastHarvestEnabled,
      harvestTemplate,
      120,
      podcastHarvestModel,
      baseDelivery,  // ← this one DOES announce to the user channel
    )

    // Write computed cron times back to config so frontend can display them
    const setConfig = (key: string, value: string) => {
      db.insert(morningReportConfig)
        .values({ key, value })
        .onConflictDoUpdate({ target: morningReportConfig.key, set: { value } })
        .run()
    }
    setConfig('finalizeCron', `${finMin} ${finHour}`)
    setConfig('podcastCron', `${podMin} ${podHour}`)
    setConfig('podcastHarvestCron', `${harvestMin} ${harvestHour}`)
  }

  console.log(`[sync-cron] Done: removed ${mrJobs.length}, created ${created}`)
  return { synced: created, removed: mrJobs.length }
}
