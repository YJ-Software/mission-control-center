import { NextRequest, NextResponse } from 'next/server'
import { db, initDb } from '@/lib/db'
import {
  morningReportTopics,
  morningReportConfig,
  morningReportRuns,
  morningReportRunTopics,
  morningReportFormatTemplate,
} from '@/lib/schema'
import { eq, desc, asc } from 'drizzle-orm'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { getTmpDir, getDateVars } from '@/lib/morning-report/utils'
import { generatePrompts } from '@/lib/morning-report/prompt-generator'
import { finalize } from '@/lib/morning-report/finalize'
import { generatePodcast } from '@/lib/morning-report/podcast'
import { triggerTopicExecution } from '@/lib/morning-report/openclaw'
import { syncCronJobs } from '@/lib/morning-report/sync-cron'
import { cronList, cronRuns } from '@/lib/morning-report/cron-cli'
import { startTunnel, stopTunnel, getTunnelStatus, startTunnelStream } from '@/lib/morning-report/tunnel'
import { createJob, getJob, updateJob, findLatestForDate } from '@/lib/morning-report/podcast-jobs'

initDb()

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  try {
    // --- topics list ---
    if (type === 'topics') {
      const topics = db
        .select()
        .from(morningReportTopics)
        .orderBy(asc(morningReportTopics.sortOrder))
        .all()
      return NextResponse.json(topics)
    }

    // --- single topic ---
    if (type === 'topic') {
      const id = searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
      const topic = db
        .select()
        .from(morningReportTopics)
        .where(eq(morningReportTopics.id, id))
        .get()
      if (!topic) return NextResponse.json({ error: 'not found' }, { status: 404 })
      return NextResponse.json(topic)
    }

    // --- report list (default when no type or type=reports) ---
    if (type === 'reports' || !type) {
      const tmpDir = getTmpDir()
      if (!existsSync(tmpDir)) {
        return NextResponse.json([])
      }
      const pattern = /^morning-report-(\d{8})\.(html|md)$/
      const reports = readdirSync(tmpDir)
        .filter((f) => pattern.test(f))
        .map((f) => {
          const match = f.match(pattern)!
          const raw = match[1] // yyyyMMdd
          const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
          const filePath = join(tmpDir, f)
          const size = statSync(filePath).size
          return { filename: f, date, size, format: match[2] }
        })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 50)
      return NextResponse.json(reports)
    }

    // --- single report by date ---
    if (type === 'report') {
      const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0]
      const { today } = getDateVars(new Date(dateParam + 'T00:00:00'))
      const tmpDir = getTmpDir()

      const htmlPath = join(tmpDir, `morning-report-${today}.html`)
      if (existsSync(htmlPath)) {
        const content = readFileSync(htmlPath, 'utf-8')
        return NextResponse.json({ content, format: 'html', date: dateParam })
      }

      const mdPath = join(tmpDir, `morning-report-${today}.md`)
      if (existsSync(mdPath)) {
        const content = readFileSync(mdPath, 'utf-8')
        return NextResponse.json({ content, format: 'md', date: dateParam })
      }

      return NextResponse.json({ content: null, date: dateParam })
    }

    // --- podcast audio ---
    if (type === 'podcast') {
      const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0]
      const { today } = getDateVars(new Date(dateParam + 'T00:00:00'))
      const tmpDir = getTmpDir()

      for (const ext of ['mp3', 'opus'] as const) {
        const audioPath = join(tmpDir, `morning-report-${today}.${ext}`)
        if (existsSync(audioPath)) {
          const data = readFileSync(audioPath)
          const contentType = ext === 'mp3' ? 'audio/mpeg' : 'audio/opus'
          return new Response(data, {
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(data.length),
            },
          })
        }
      }
      return NextResponse.json({ error: 'podcast not found' }, { status: 404 })
    }

    // --- async podcast generation status ---
    // Companion to POST ?action=podcast which returns 202 + jobId.
    // Cron agents poll this to find out when the podcast is done and
    // collect the tunnel URL, instead of holding open a long curl.
    if (type === 'podcast-status') {
      const jobId = searchParams.get('jobId')
      if (!jobId) {
        return NextResponse.json({ error: 'jobId required' }, { status: 400 })
      }
      const job = getJob(jobId)
      if (!job) {
        return NextResponse.json({ error: 'job not found or expired' }, { status: 404 })
      }
      return NextResponse.json(job)
    }

    // --- podcast-result (harvest) ---
    // The harvest cron job fires N minutes after the podcast trigger and
    // calls this endpoint with just a date — no jobId. Returns:
    //   { ready, status, tunnelUrl, audioUrl, error }
    // Strategy:
    //   1. Look up the latest in-memory job for that date — gives status,
    //      progress, tunnelUrl when generation finished within this process.
    //   2. Fallback: if the dashboard restarted after the trigger, the job
    //      map is empty, but the mp3 may still exist in publicDir. Build
    //      tunnelUrl from the live tunnel + token if so.
    if (type === 'podcast-result') {
      const dateParam = searchParams.get('date') || new Date().toISOString().slice(0, 10)
      const job = findLatestForDate(dateParam)

      // Fallback file probe — covers dashboard restarts and lost in-memory state.
      const cfgRows = db.select().from(morningReportConfig).all()
      const cfgMap: Record<string, string> = {}
      for (const row of cfgRows) cfgMap[row.key] = row.value
      const publicDir = cfgMap['publicDir'] || join(os.homedir(), 'morning-report/public')
      const { today } = getDateVars(new Date(dateParam + 'T00:00:00'))
      const audioFile = `morning-report-${today}.mp3`
      const audioFsPath = join(publicDir, audioFile)
      const audioFileExists = existsSync(audioFsPath)

      const tunnel = getTunnelStatus()
      let tunnelUrl: string | undefined = job?.tunnelUrl
      if (!tunnelUrl && audioFileExists && tunnel.active && tunnel.url && tunnel.token) {
        tunnelUrl = `${tunnel.url}/${audioFile}?token=${tunnel.token}`
      }

      // ready iff the mp3 actually exists OR job reports done with an audioPath
      const ready = audioFileExists || (job?.status === 'done' && !!job.audioPath)
      const status = job?.status ?? (ready ? 'done' : 'unknown')
      const error = job?.error

      return NextResponse.json({
        date: dateParam,
        ready,
        status,
        tunnelUrl,
        audioUrl: ready ? `/api/morning-report?type=podcast&date=${dateParam}` : undefined,
        progress: job?.progress,
        error,
        // help operator distinguish "nothing happened today" from "failed"
        source: job ? 'in-memory-job' : (audioFileExists ? 'public-dir-fallback' : 'none'),
      })
    }

    // --- default templates ---
    if (type === 'default-templates') {
      const {
        DEFAULT_FINALIZE_MESSAGE,
        DEFAULT_PODCAST_MESSAGE,
        DEFAULT_PODCAST_HARVEST_MESSAGE,
        DEFAULT_FINALIZE_HTML,
        DEFAULT_PODCAST_SCRIPT,
        DEFAULT_PODCAST_POLISH,
      } = await import('@/lib/morning-report/default-templates')
      return NextResponse.json({
        finalizeMessageTemplate: DEFAULT_FINALIZE_MESSAGE,
        podcastMessageTemplate: DEFAULT_PODCAST_MESSAGE,
        podcastHarvestMessageTemplate: DEFAULT_PODCAST_HARVEST_MESSAGE,
        finalizeHtmlTemplate: DEFAULT_FINALIZE_HTML,
        podcastScriptTemplate: DEFAULT_PODCAST_SCRIPT,
        podcastPolishTemplate: DEFAULT_PODCAST_POLISH,
      })
    }

    // --- config ---
    if (type === 'config') {
      const rows = db.select().from(morningReportConfig).all()
      const config: Record<string, string> = {}
      for (const row of rows) {
        config[row.key] = row.value
      }
      return NextResponse.json(config)
    }

    // --- runs ---
    if (type === 'runs') {
      const runs = db
        .select()
        .from(morningReportRuns)
        .orderBy(desc(morningReportRuns.id))
        .limit(30)
        .all()
      return NextResponse.json(runs)
    }

    // --- models list from openclaw.json ---
    // OpenClaw 2026.4+ keeps the full model catalog under
    // `models.providers[*].models[]`. Earlier versions (and some legacy
    // installs) used `agents.defaults.models` — we read both and merge,
    // so this works across upgrades without a config migration.
    if (type === 'models') {
      const byId = new Map<string, { id: string; name: string }>()
      let defaultModel = ''
      try {
        const ocPath = join(require('os').homedir(), '.openclaw', 'openclaw.json')
        if (existsSync(ocPath)) {
          const oc = JSON.parse(readFileSync(ocPath, 'utf-8'))
          defaultModel = oc?.agents?.defaults?.model?.primary || ''

          // Primary source: models.providers[*].models[]
          const providers = oc?.models?.providers ?? {}
          for (const [pname, pcfg] of Object.entries(providers) as [string, any][]) {
            const entries = Array.isArray(pcfg?.models) ? pcfg.models : []
            for (const m of entries) {
              const modelId = typeof m === 'string' ? m : (m?.id || m?.model)
              if (!modelId) continue
              const fullId = modelId.includes('/') ? modelId : `${pname}/${modelId}`
              const alias = typeof m === 'object' ? m?.alias : undefined
              byId.set(fullId, {
                id: fullId,
                name: alias ? `${fullId} (${alias})` : fullId,
              })
            }
          }

          // Legacy source: agents.defaults.models (pre-2026.4 shape). Merge in
          // any entries we haven't already picked up.
          const agentModels = oc?.agents?.defaults?.models ?? {}
          for (const [fullId, meta] of Object.entries(agentModels) as [string, any][]) {
            if (byId.has(fullId)) continue
            const alias = meta?.alias
            byId.set(fullId, {
              id: fullId,
              name: alias ? `${fullId} (${alias})` : fullId,
            })
          }
        }
      } catch { /* ignore */ }
      const models = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id))
      return NextResponse.json({ models, defaultModel })
    }

    // --- format template ---
    if (type === 'format-template') {
      const row = db
        .select()
        .from(morningReportFormatTemplate)
        .where(eq(morningReportFormatTemplate.id, 1))
        .get()
      return NextResponse.json({ content: row?.content ?? '' })
    }

    // --- cron execution history ---
    if (type === 'cron-runs') {
      try {
        const allJobs = await cronList()
        const mrJobs = allJobs.filter(j => j.id.startsWith('mr-'))

        const allEntries: any[] = []
        await Promise.all(mrJobs.map(async (job) => {
          try {
            const entries = await cronRuns(job.id, 20)
            for (const entry of entries) {
              allEntries.push({
                jobId: entry.jobId || job.id,
                jobName: job.name,
                status: entry.status || 'unknown',
                summary: entry.summary || '',
                error: entry.error,
                runAtMs: entry.runAtMs || entry.ts,
                durationMs: entry.durationMs || 0,
                model: entry.model || '',
                provider: entry.provider || '',
                usage: entry.usage,
              })
            }
          } catch { /* ignore per-job errors */ }
        }))
        allEntries.sort((a, b) => (b.runAtMs || 0) - (a.runAtMs || 0))

        return NextResponse.json(allEntries)
      } catch {
        return NextResponse.json([])
      }
    }

    // --- tunnel status ---
    if (type === 'tunnel-status') {
      return NextResponse.json(getTunnelStatus())
    }

    return NextResponse.json({ error: 'unknown type' }, { status: 400 })
  } catch (err: any) {
    console.error('[morning-report GET]', err)
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  try {
    // --- config ---
    if (type === 'config') {
      const body = (await req.json()) as Record<string, string>
      for (const [key, value] of Object.entries(body)) {
        db.insert(morningReportConfig)
          .values({ key, value })
          .onConflictDoUpdate({ target: morningReportConfig.key, set: { value } })
          .run()
      }
      // Sync to OpenClaw cron jobs after config change
      await syncCronJobs()
      return NextResponse.json({ ok: true })
    }

    // --- format template ---
    if (type === 'format-template') {
      const { content } = (await req.json()) as { content: string }
      db.insert(morningReportFormatTemplate)
        .values({ id: 1, content, updatedAt: Math.floor(Date.now() / 1000) })
        .onConflictDoUpdate({
          target: morningReportFormatTemplate.id,
          set: { content, updatedAt: Math.floor(Date.now() / 1000) },
        })
        .run()
      return NextResponse.json({ ok: true })
    }

    // --- default: update topic ---
    const body = await req.json()
    const { id, ...fields } = body as Record<string, any>
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

    const update: Record<string, any> = {}
    const allowedFields = [
      'name',
      'emoji',
      'enabled',
      'sortOrder',
      'template',
      'cronTime',
      'timeoutSeconds',
      'outputFilename',
      'model',
      'deliveryMode',
    ]
    for (const key of allowedFields) {
      if (key in fields) {
        // SQLite needs integer for boolean fields
        if (key === 'enabled') {
          update[key] = fields[key] ? 1 : 0
        } else {
          update[key] = fields[key]
        }
      }
    }
    update.updatedAt = Math.floor(Date.now() / 1000)

    db.update(morningReportTopics)
      .set(update)
      .where(eq(morningReportTopics.id, id))
      .run()

    // Sync to OpenClaw cron jobs after topic update
    try {
      await syncCronJobs()
    } catch (e) {
      console.warn('syncCronJobs failed but DB is updated:', e)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[morning-report PUT]', err)
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  try {
    // --- create topic ---
    if (action === 'create-topic') {
      const body = await req.json()
      const { id, name, emoji, template, cronTime, timeoutSeconds, outputFilename } = body

      if (!id || !name) {
        return NextResponse.json({ error: 'id and name required' }, { status: 400 })
      }

      // Get max sortOrder + 1
      const existing = db
        .select()
        .from(morningReportTopics)
        .orderBy(desc(morningReportTopics.sortOrder))
        .limit(1)
        .get()
      const nextOrder = (existing?.sortOrder ?? -1) + 1

      db.insert(morningReportTopics)
        .values({
          id,
          name,
          emoji: emoji ?? '📰',
          template: template ?? '',
          cronTime: cronTime ?? '0 8',
          timeoutSeconds: timeoutSeconds ?? 600,
          outputFilename: outputFilename ?? '',
          sortOrder: nextOrder,
          enabled: 1,
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .run()

      return NextResponse.json({ ok: true, id })
    }

    // --- generate prompts ---
    if (action === 'generate-prompts') {
      const result = generatePrompts()
      return NextResponse.json(result)
    }

    // --- run single topic ---
    if (action === 'run-topic') {
      const topicId = searchParams.get('id')
      if (!topicId) return NextResponse.json({ error: 'missing id' }, { status: 400 })

      const topic = db
        .select()
        .from(morningReportTopics)
        .where(eq(morningReportTopics.id, topicId))
        .get()
      if (!topic) return NextResponse.json({ error: 'topic not found' }, { status: 404 })

      // Generate prompts and find the matching one
      const prompts = generatePrompts()
      const matched = prompts.results.find((r) => r.topicId === topicId)
      if (!matched) {
        return NextResponse.json({ error: 'prompt not generated for this topic' }, { status: 400 })
      }

      const result = await triggerTopicExecution(topicId, matched.promptPath, {
        timeout: topic.timeoutSeconds ?? 600,
      })
      return NextResponse.json(result)
    }

    // --- run all topics ---
    if (action === 'run-all') {
      const { dateHyphen } = getDateVars()
      // Create a run record
      const runResult = db
        .insert(morningReportRuns)
        .values({
          date: dateHyphen,
          status: 'running',
          startedAt: Math.floor(Date.now() / 1000),
        })
        .run()
      const runId = Number(runResult.lastInsertRowid)

      // Generate prompts
      const prompts = generatePrompts()

      // Trigger all topics
      const results = []
      for (const p of prompts.results) {
        // Create run-topic record
        db.insert(morningReportRunTopics)
          .values({
            runId,
            topicId: p.topicId,
            status: 'running',
            startedAt: Math.floor(Date.now() / 1000),
          })
          .run()

        const result = await triggerTopicExecution(p.topicId, p.promptPath)
        results.push({ topicId: p.topicId, ...result })
      }

      // Update run status
      db.update(morningReportRuns)
        .set({ status: 'completed', completedAt: Math.floor(Date.now() / 1000) })
        .where(eq(morningReportRuns.id, runId))
        .run()

      return NextResponse.json({ runId, results })
    }

    // --- finalize ---
    if (action === 'finalize') {
      const result = await finalize()
      const response: any = { ...result }

      if (result.htmlPath) {
        // Auto-start tunnel if not running
        let tunnel = getTunnelStatus()
        if (!tunnel.active) {
          try {
            const cfgRows = db.select().from(morningReportConfig).all()
            const cfgMap: Record<string, string> = {}
            for (const row of cfgRows) cfgMap[row.key] = row.value
            const publicDir = cfgMap['publicDir'] || join(os.homedir(), 'morning-report/public')
            await startTunnel(publicDir)
            tunnel = getTunnelStatus()
          } catch (err) {
            console.error('[finalize] Failed to auto-start tunnel:', err)
          }
        }

        if (tunnel.active && tunnel.url && tunnel.token) {
          const htmlFilename = result.htmlPath.split('/').pop()
          response.tunnelUrl = `${tunnel.url}/${htmlFilename}?token=${tunnel.token}`
        }
      }

      return NextResponse.json(response)
    }

    // --- podcast (async) ---
    // Returns 202 + jobId immediately; the actual generation runs in the
    // background. Callers poll GET ?type=podcast-status&jobId=… for state.
    // Sync mode (`&wait=1`) is preserved for the in-app UI which holds an
    // open fetch and shows a progress spinner.
    if (action === 'podcast') {
      const dateParam = searchParams.get('date')
      const date = dateParam ? new Date(dateParam + 'T00:00:00') : undefined
      const wait = searchParams.get('wait') === '1'

      const buildTunnelUrl = async (audioPath: string | undefined) => {
        if (!audioPath) return undefined
        let tunnel = getTunnelStatus()
        if (!tunnel.active) {
          try {
            const cfgRows = db.select().from(morningReportConfig).all()
            const cfgMap: Record<string, string> = {}
            for (const row of cfgRows) cfgMap[row.key] = row.value
            const publicDir = cfgMap['publicDir'] || join(os.homedir(), 'morning-report/public')
            await startTunnel(publicDir)
            tunnel = getTunnelStatus()
          } catch (err) {
            console.error('[podcast] Failed to auto-start tunnel:', err)
          }
        }
        if (tunnel.active && tunnel.url && tunnel.token) {
          const audioFilename = audioPath.split('/').pop()
          return `${tunnel.url}/${audioFilename}?token=${tunnel.token}`
        }
        return undefined
      }

      if (wait) {
        const result = await generatePodcast(date)
        const response: any = { ...result }
        const tunnelUrl = await buildTunnelUrl(result.audioPath)
        if (tunnelUrl) response.tunnelUrl = tunnelUrl
        return NextResponse.json(response)
      }

      const job = createJob()
      // Fire and forget — track lifecycle into the job store. Errors here
      // must NEVER bubble up; they're meant for the GET status endpoint.
      ;(async () => {
        updateJob(job.jobId, { status: 'running' })
        try {
          const result = await generatePodcast(date, (stage, message) => {
            updateJob(job.jobId, { progress: { stage, message } })
          })
          const tunnelUrl = await buildTunnelUrl(result.audioPath)
          updateJob(job.jobId, {
            status: 'done',
            finishedAt: Date.now(),
            audioPath: result.audioPath,
            audioUrl: result.audioPath ? `/api/morning-report?type=podcast&date=${(dateParam || new Date().toISOString().split('T')[0])}` : undefined,
            tunnelUrl,
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[podcast] job failed:', message)
          updateJob(job.jobId, {
            status: 'error',
            finishedAt: Date.now(),
            error: message,
          })
        }
      })()

      return NextResponse.json(
        {
          jobId: job.jobId,
          status: job.status,
          statusUrl: `/api/morning-report?type=podcast-status&jobId=${job.jobId}`,
        },
        { status: 202 },
      )
    }

    // --- reorder topics (batch update sortOrder + cronTime) ---
    if (action === 'reorder-topics') {
      const body = await req.json()
      const { topics: ordered, startTime } = body as {
        topics: { id: string; sortOrder: number; cronTime: string }[]
        startTime?: string
      }
      for (const t of ordered) {
        db.update(morningReportTopics)
          .set({ sortOrder: t.sortOrder, cronTime: t.cronTime })
          .where(eq(morningReportTopics.id, t.id))
          .run()
      }
      // Save startTime to config if provided
      if (startTime) {
        db.insert(morningReportConfig)
          .values({ key: 'startTime', value: startTime })
          .onConflictDoUpdate({ target: morningReportConfig.key, set: { value: startTime } })
          .run()
      }
      // Sync to OpenClaw cron jobs
      const syncResult = await syncCronJobs()
      return NextResponse.json({ ok: true, ...syncResult })
    }

    // --- tunnel start (SSE stream with auto-install, or background mode) ---
    if (action === 'tunnel-start') {
      const configRows = db.select().from(morningReportConfig).all()
      const configMap: Record<string, string> = {}
      for (const row of configRows) configMap[row.key] = row.value
      const publicDir = configMap['publicDir'] || join(os.homedir(), 'morning-report/public')

      // Background mode: non-streaming, for auto-start on enable
      if (searchParams.get('mode') === 'background') {
        try {
          const result = await startTunnel(publicDir)
          return NextResponse.json({ ok: true, ...result })
        } catch (err: any) {
          return NextResponse.json({ error: err.message }, { status: 500 })
        }
      }

      const stream = startTunnelStream(publicDir)
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // --- tunnel stop ---
    if (action === 'tunnel-stop') {
      stopTunnel()
      return NextResponse.json({ ok: true })
    }

    // --- sync cron jobs to OpenClaw ---
    if (action === 'sync-cron') {
      const result = await syncCronJobs()
      return NextResponse.json(result)
    }

    // --- bootstrap: first-time setup ---
    if (action === 'bootstrap') {
      const { loadDefaultTemplates } = await import('@/lib/morning-report/load-defaults')

      // Default topic definitions
      const defaultTopics = [
        { id: 'ai', name: 'AI 科技', emoji: '🤖' },
        { id: 'stocks', name: '股市動態', emoji: '📈' },
        { id: 'crypto', name: '加密貨幣', emoji: '₿' },
        { id: 'social', name: '社群熱點', emoji: '🔥' },
        { id: 'arxiv', name: '論文精選', emoji: '📄' },
        { id: 'geo', name: '國際情勢', emoji: '🌍' },
      ]

      // Create topics if they don't exist
      const now = Math.floor(Date.now() / 1000)
      for (let i = 0; i < defaultTopics.length; i++) {
        const t = defaultTopics[i]
        const existing = db.select().from(morningReportTopics).where(eq(morningReportTopics.id, t.id)).get()
        if (!existing) {
          db.insert(morningReportTopics).values({
            id: t.id,
            name: t.name,
            emoji: t.emoji,
            template: '',
            cronTime: `${i * 5} 8`,
            timeoutSeconds: 600,
            outputFilename: '',
            sortOrder: i,
            enabled: 1,
            createdAt: now,
            updatedAt: now,
          }).run()
        }
      }

      // Load default templates into the newly created topics
      const templateResult = loadDefaultTemplates()

      // Enable morning report + podcast
      const configEntries: Record<string, string> = {
        enabled: 'true',
        finalizeEnabled: 'true',
        podcastEnabled: 'true',
      }
      for (const [key, value] of Object.entries(configEntries)) {
        db.insert(morningReportConfig)
          .values({ key, value })
          .onConflictDoUpdate({ target: morningReportConfig.key, set: { value } })
          .run()
      }

      // Sync cron jobs
      await syncCronJobs()

      return NextResponse.json({
        ok: true,
        topicsCreated: defaultTopics.length,
        ...templateResult,
      })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('[morning-report POST]', err)
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }

  try {
    db.delete(morningReportTopics).where(eq(morningReportTopics.id, id)).run()
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[morning-report DELETE]', err)
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
