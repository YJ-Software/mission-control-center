import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import * as wiki from '@/lib/second-brain/wiki/cli'
import { detect } from '@/lib/second-brain/wiki/setup'

const execFileAsync = promisify(execFile)

function getSetting(key: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value ?? ''
}

function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  if (type === 'detect') {
    return NextResponse.json(await detect())
  }

  if (type === 'status') {
    try {
      const s = await wiki.status()
      return NextResponse.json(s)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: message, configured: false }, { status: 200 })
    }
  }

  if (type === 'settings') {
    return NextResponse.json({
      dualWrite: getSetting('wiki.dualWrite') === 'true',
      synthesisCron: getSetting('wiki.synthesisCron') || '0 3 * * 0',
      synthesisModel: getSetting('wiki.synthesisModel') || '',
      tunnelUrl: getSetting('wiki.lastTunnelUrl') || '',
      localReportUrl: getSetting('wiki.lastLocalReportUrl') || '',
      lastSynthesisAt: getSetting('wiki.lastSynthesisAt') || '',
    })
  }

  if (type === 'synthesis-progress') {
    const startedAt = getSetting('wiki.lastSynthesisStartedAt')
    const finishedAt = getSetting('wiki.lastSynthesisFinishedAt')
    const stage = getSetting('wiki.lastSynthesisStage')
    return NextResponse.json({
      stage,
      message: getSetting('wiki.lastSynthesisMessage'),
      startedAt,
      finishedAt,
      error: getSetting('wiki.lastSynthesisError'),
      // running iff started but not finished and not in 'error' state
      running: !!startedAt && !finishedAt && stage !== 'error' && stage !== 'done',
    })
  }

  if (type === 'report') {
    // Serve the rendered wiki report HTML directly from the MCC dashboard.
    // Used when a cloudflared quick tunnel can't start (test machines, no
    // tunnel installed). The dashboard's auth cookie gates access here.
    const dateParam = searchParams.get('date') || new Date().toISOString().slice(0, 10)
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const candidates = [
      path.join(os.homedir(), 'morning-report', 'public', `wiki-report-${dateParam}.html`),
      path.join(os.tmpdir(), 'wiki-reports', `wiki-report-${dateParam}.html`),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const html = fs.readFileSync(p, 'utf-8')
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
    }
    return NextResponse.json({ error: `report not found for ${dateParam}` }, { status: 404 })
  }

  if (type === 'search') {
    const q = searchParams.get('q') || ''
    if (!q.trim()) return NextResponse.json({ error: 'q required' }, { status: 400 })
    return NextResponse.json(await wiki.search(q))
  }

  if (type === 'lint') {
    return NextResponse.json(await wiki.lint())
  }

  return NextResponse.json({ error: 'unknown type' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'ingest') {
    const body = await req.json().catch(() => ({})) as { target?: string }
    const target = body.target?.trim()
    if (!target) return NextResponse.json({ error: 'target required' }, { status: 400 })

    // The bundled openclaw 2026.4.x CLI mis-handles URL inputs (treats them
    // as file paths). Fetch URLs server-side, write a clean local md file,
    // then hand the path to wiki ingest.
    //
    // Two-tier extraction:
    //   1. defuddle parse <url> --md   → readability-style cleaned markdown
    //      (preferred — matches what the link-capture skill uses)
    //   2. raw fetch + frontmatter     → fallback when defuddle isn't on PATH
    let actualTarget = target
    let tempCleanup: string | null = null
    if (/^https?:\/\//i.test(target)) {
      const tmpDir = join(os.tmpdir(), 'wiki-url-fetch')
      mkdirSync(tmpDir, { recursive: true })
      const slug = target.replace(/^https?:\/\//i, '').replace(/[^a-z0-9-]+/gi, '-').slice(0, 80)
      const tmpPath = join(tmpDir, `${slug}-${Date.now()}.md`)

      let used: 'defuddle' | 'raw' | null = null
      try {
        // Try defuddle first.
        await execFileAsync('defuddle', ['parse', target, '--md', '-o', tmpPath], {
          timeout: 60_000,
        })
        used = 'defuddle'
      } catch {
        // Fall back to raw fetch.
      }
      if (used !== 'defuddle') {
        try {
          const res = await fetch(target, {
            headers: { 'User-Agent': 'Mission-Control-Wiki-Ingest/1.0' },
            signal: AbortSignal.timeout(30_000),
          })
          if (!res.ok) {
            return NextResponse.json({ ok: false, error: `URL fetch failed: HTTP ${res.status}` }, { status: 502 })
          }
          const html = await res.text()
          const md = `---\nsource_url: ${target}\nfetched_at: ${new Date().toISOString()}\nextractor: raw\n---\n\n${html}\n`
          writeFileSync(tmpPath, md, 'utf-8')
          used = 'raw'
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return NextResponse.json({ ok: false, error: `URL fetch error: ${message}` }, { status: 502 })
        }
      }
      actualTarget = tmpPath
      tempCleanup = tmpPath
      console.log(`[wiki] URL ingest via ${used}: ${target} → ${tmpPath}`)
    }

    const result = await wiki.ingest(actualTarget)
    // tempCleanup intentionally left in place — wiki ingest may copy/symlink
    // and we don't want to race the cleanup. /tmp survives just fine.
    void tempCleanup
    if (!result.ok) return NextResponse.json(result, { status: 500 })
    return NextResponse.json(result)
  }

  if (action === 'compile') {
    return NextResponse.json(await wiki.compile())
  }

  if (action === 'settings') {
    const body = await req.json() as {
      dualWrite?: boolean
      synthesisCron?: string
      synthesisModel?: string
    }
    let cronChanged = false
    if (typeof body.dualWrite === 'boolean') {
      setSetting('wiki.dualWrite', body.dualWrite ? 'true' : 'false')
    }
    if (typeof body.synthesisCron === 'string') {
      const prev = getSetting('wiki.synthesisCron')
      setSetting('wiki.synthesisCron', body.synthesisCron)
      if (body.synthesisCron !== prev) cronChanged = true
    }
    if (typeof body.synthesisModel === 'string') {
      setSetting('wiki.synthesisModel', body.synthesisModel)
    }
    if (cronChanged) {
      try {
        const { syncWikiCronJob } = await import('@/lib/second-brain/wiki/sync-cron')
        const result = await syncWikiCronJob()
        return NextResponse.json({ ok: true, cron: result })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ ok: true, cron: { ok: false, error: message } })
      }
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'sync-cron') {
    const { syncWikiCronJob } = await import('@/lib/second-brain/wiki/sync-cron')
    return NextResponse.json(await syncWikiCronJob())
  }

  if (action === 'synthesize-now') {
    // Kicks off Phase-3 synthesis in background; returns immediately like
    // morning-report's async podcast. Polling endpoint can be added later;
    // for v1 we just fire-and-forget and report via Telegram on completion.
    const { runSynthesis } = await import('@/lib/second-brain/wiki/synthesize')
    runSynthesis().catch((err: unknown) => {
      console.error('[wiki] synthesis run failed:', err)
    })
    return NextResponse.json({ ok: true, message: 'synthesis started in background' }, { status: 202 })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
