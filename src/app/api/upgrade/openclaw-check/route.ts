import { NextResponse } from 'next/server'
import { isUpdateAvailable } from '@/lib/version-compare'
import { readInstalledOpenclawVersion } from '@/lib/openclaw/installed-version'
import { fetchManifest, getConfiguredManifestUrl } from '@/lib/upgrade/manager'
import { getVersionInfo } from '@/lib/version'
import { validatedForMcc, validationStatus, type ValidationStatus } from '@/lib/release-validation'

/**
 * Would upgrading OpenClaw to `target` leave this MCC on a validated
 * combination? Uses the manifest entry for the RUNNING MCC version. A
 * manifest we cannot fetch is 'unknown' — never a false warning.
 */
async function openclawTargetValidation(target: string): Promise<{ mccVersion: string; validated: string[] | null; status: ValidationStatus }> {
  const { mccVersion } = getVersionInfo()
  try {
    const url = getConfiguredManifestUrl()
    if (!url) return { mccVersion, validated: null, status: 'unknown' }
    const v = validatedForMcc(await fetchManifest(url), mccVersion)
    return { mccVersion, validated: v?.openclaw ?? null, status: validationStatus(v, 'openclaw', target) }
  } catch {
    return { mccVersion, validated: null, status: 'unknown' }
  }
}

async function readLatestVersion(): Promise<{ version: string; publishedAt: string | null }> {
  const res = await fetch('https://registry.npmjs.org/openclaw/latest', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`)
  const data = (await res.json()) as { version?: string; time?: string }
  if (typeof data.version !== 'string') throw new Error('npm response missing version')
  return { version: data.version, publishedAt: typeof data.time === 'string' ? data.time : null }
}

export async function GET() {
  try {
    const current = await readInstalledOpenclawVersion()
    if (!current) {
      return NextResponse.json({
        installed: false,
        current: null,
        latest: null,
        hasUpdate: false,
        installCommand: 'npm install -g openclaw@latest',
      })
    }
    const latest = await readLatestVersion()
    const hasUpdate = isUpdateAvailable(current, latest.version)
    const validation = hasUpdate ? await openclawTargetValidation(latest.version) : null
    return NextResponse.json({
      installed: true,
      current,
      latest: latest.version,
      latestPublishedAt: latest.publishedAt,
      hasUpdate,
      validation,
      installCommand: `npm install -g openclaw@${latest.version}`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
