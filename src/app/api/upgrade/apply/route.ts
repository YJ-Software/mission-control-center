import { NextResponse } from 'next/server'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  applyUpgrade,
  cleanupTempTarball,
  downloadArtifact,
  getInstallInfo,
  scheduleServiceRestart,
} from '@/lib/upgrade/manager'
import { startJob, type PhaseSpec } from '@/lib/jobs/runner'
import type { JobKind, TriggerSource } from '@/lib/jobs/types'

export const dynamic = 'force-dynamic'

// Next.js 16 caps form-data body size at 10MB by default. Release tarballs
// routinely exceed that, so the UI sends the tarball as a raw-bytes body
// (Content-Type: application/octet-stream) and we stream it to disk.
async function streamToTempFile(request: Request): Promise<string> {
  if (!request.body) throw new Error('missing request body')
  const tmpPath = path.join(
    process.env.TMPDIR || '/tmp',
    `mission-control-upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tar.gz`,
  )
  const sink = createWriteStream(tmpPath)
  const reader = request.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await new Promise<void>((resolve, reject) => {
          sink.write(value, (err) => (err ? reject(err) : resolve()))
        })
      }
    }
  } finally {
    await new Promise<void>((resolve) => sink.end(() => resolve()))
  }
  return tmpPath
}

const VALID_SOURCES: TriggerSource[] = ['header-button', 'settings-card', 'quick-action', 'cron', 'api']

/**
 * Apply an upgrade — now returns a jobId; the actual work runs via the job
 * runner so the UI can stream logs via /system-log.
 *
 * Two input modes:
 *   - application/octet-stream (body = tarball bytes) — direct upload
 *     Optional header: x-expected-sha256
 *   - application/json with { url, sha256?, triggeredBy? } — download & apply
 */
export async function POST(request: Request) {
  const info = getInstallInfo()
  if (info.mode !== 'release') {
    return NextResponse.json(
      {
        error: `upgrade requires release-mode install (current mode: ${info.mode})`,
        mode: info.mode,
      },
      { status: 409 },
    )
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    let kind: JobKind = 'upgrade-mcc-tarball'
    let label = 'Upgrade Mission Control (tarball upload)'
    let triggeredBy: TriggerSource = 'settings-card'
    const phases: PhaseSpec[] = []

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { url?: string; sha256?: string; triggeredBy?: string }
      if (!body.url) {
        return NextResponse.json({ error: 'missing url' }, { status: 400 })
      }
      const url = body.url
      const expectedSha256 = body.sha256
      if (body.triggeredBy && VALID_SOURCES.includes(body.triggeredBy as TriggerSource)) {
        triggeredBy = body.triggeredBy as TriggerSource
      }
      kind = 'upgrade-mcc'
      label = 'Upgrade Mission Control (manifest)'

      let downloadedPath: string | null = null
      phases.push({
        name: 'download artifact',
        inline: async (log) => {
          try {
            log('stdout', `downloading ${url}…`)
            downloadedPath = await downloadArtifact(url)
            log('stdout', `downloaded → ${downloadedPath}`)
            return 0
          } catch (err) {
            log('stderr', err instanceof Error ? err.message : String(err))
            return 1
          }
        },
      })
      phases.push({
        name: 'apply upgrade',
        inline: async (log, ctx) => {
          if (!downloadedPath) {
            log('stderr', 'no tarball — download phase failed')
            return 1
          }
          try {
            log('stdout', 'extracting + swapping symlink…')
            const result = await applyUpgrade({ tarballPath: downloadedPath, expectedSha256 })
            ctx.setExpectedVersion(result.version)
            log('stdout', `staged v${result.version} at ${result.versionDir}`)
            return 0
          } catch (err) {
            log('stderr', err instanceof Error ? err.message : String(err))
            try { cleanupTempTarball(downloadedPath); } catch { try { await unlink(downloadedPath) } catch {} }
            return 1
          }
        },
      })
    } else {
      const headerSha = request.headers.get('x-expected-sha256') || undefined
      const headerSource = request.headers.get('x-triggered-by') || ''
      if (VALID_SOURCES.includes(headerSource as TriggerSource)) {
        triggeredBy = headerSource as TriggerSource
      }
      // Body must be consumed before we can return — stream synchronously.
      const tarballPath = await streamToTempFile(request)

      phases.push({
        name: 'apply uploaded tarball',
        inline: async (log, ctx) => {
          try {
            log('stdout', `applying ${tarballPath}`)
            const result = await applyUpgrade({ tarballPath, expectedSha256: headerSha })
            ctx.setExpectedVersion(result.version)
            log('stdout', `staged v${result.version} at ${result.versionDir}`)
            return 0
          } catch (err) {
            log('stderr', err instanceof Error ? err.message : String(err))
            try { cleanupTempTarball(tarballPath); } catch { try { await unlink(tarballPath) } catch {} }
            return 1
          }
        },
      })
    }

    const service = info.service
    phases.push({
      name: `restart service (${service})`,
      inline: async (log) => {
        log('stdout', `scheduling restart in 2s — service: ${service}`)
        log('system', 'this process will be replaced; log resumes after restart')
        scheduleServiceRestart(service)
        return 0
      },
    })

    const meta = startJob({
      kind,
      label,
      triggeredBy,
      phases,
      restartingBeforeLastPhase: true,
    })

    return NextResponse.json({
      ok: true,
      jobId: meta.id,
      restarting: true,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
