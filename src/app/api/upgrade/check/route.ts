import { NextResponse } from 'next/server'
import { fetchManifest, getConfiguredManifestUrl, pickArtifact } from '@/lib/upgrade/manager'
import { getVersionInfo, parseMccVersion } from '@/lib/version'
import { isUpdateAvailable } from '@/lib/version-compare'
import { agentRuntimeKind } from '@/lib/agent-runtime'
import { readInstalledOpenclawVersion } from '@/lib/openclaw/installed-version'
import { validatedOf, validationStatus, type Backend, type ValidationStatus } from '@/lib/release-validation'

// Always evaluate this route on each call. Without this Next.js may
// statically cache the response, masking new releases until the server
// restarts.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const url = new URL(request.url)
  const overrideUrl = url.searchParams.get('url')
  const manifestUrl = overrideUrl?.trim() || getConfiguredManifestUrl()
  if (!manifestUrl) {
    return NextResponse.json(
      { error: 'no manifest URL configured (set UPGRADE_MANIFEST_URL env or ?url=…)' },
      { status: 400 },
    )
  }

  try {
    const manifest = await fetchManifest(manifestUrl)
    const info = getVersionInfo()
    // Compare semver, not the display string — display contains the openclaw
    // prefix (e.g. "2026.6.1-v0.3.52") which would break the per-segment cmp.
    const latestMcc = manifest.latest.mccVersion || parseMccVersion(manifest.latest.version)
    const hasUpdate = isUpdateAvailable(info.mccVersion, latestMcc)
    const artifact = pickArtifact(manifest)
    // Is the NEW release validated against the backend running here? Only
    // matters when there's actually an update to offer — the UI only shows
    // this when hasUpdate is true, and computing it means spawning
    // `openclaw --version`, which the header would otherwise do on every
    // 5-minute poll even with nothing new to install.
    // Hermes has no local version reader until the native-install recon (P4),
    // so it reports 'unknown' rather than guessing.
    const backend: Backend = agentRuntimeKind() === 'hermes' ? 'hermes' : 'openclaw'
    let validation: { backend: Backend; localVersion: string | null; validated: string[] | null; status: ValidationStatus } | null = null
    if (hasUpdate) {
      const localVersion = backend === 'openclaw' ? await readInstalledOpenclawVersion() : null
      const validatedAll = validatedOf(manifest.latest)
      validation = {
        backend,
        localVersion,
        validated: validatedAll?.[backend] ?? null,
        status: validationStatus(validatedAll, backend, localVersion),
      }
    }
    return NextResponse.json({
      current: info.version,
      currentMcc: info.mccVersion,
      latest: manifest.latest.version,
      latestMcc,
      validation,
      hasUpdate,
      releaseDate: manifest.latest.releaseDate || null,
      notes: manifest.latest.notes || null,
      artifact: artifact
        ? { url: artifact.url, sha256: artifact.sha256 || null, size: artifact.size || null }
        : null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
