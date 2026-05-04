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

/**
 * Apply an upgrade.
 *
 * Two input modes:
 *   - application/octet-stream (body = tarball bytes)   (direct upload)
 *     Optional header: x-expected-sha256
 *   - application/json with { url, sha256? }            (download & apply)
 *
 * On success, the response is flushed and then a detached `systemctl --user
 * restart` subprocess is scheduled — the current process is about to be
 * killed. Clients should poll /api/health to detect the new version.
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

  let tarballPath: string | null = null
  let expectedSha256: string | undefined

  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { url?: string; sha256?: string }
      if (!body.url) {
        return NextResponse.json({ error: 'missing url' }, { status: 400 })
      }
      expectedSha256 = body.sha256
      tarballPath = await downloadArtifact(body.url)
    } else {
      const headerSha = request.headers.get('x-expected-sha256')
      if (headerSha) expectedSha256 = headerSha
      tarballPath = await streamToTempFile(request)
    }

    const result = await applyUpgrade({ tarballPath, expectedSha256 })

    // Schedule the restart AFTER building the response. The subprocess sleeps
    // a couple of seconds so Next.js has time to flush the response before
    // SIGTERM arrives.
    scheduleServiceRestart(info.service)

    return NextResponse.json({
      ok: true,
      version: result.version,
      versionDir: result.versionDir,
      restarting: true,
    })
  } catch (err) {
    if (tarballPath) {
      try {
        cleanupTempTarball(tarballPath)
      } catch {
        try { await unlink(tarballPath) } catch {}
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
