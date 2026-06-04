import { NextResponse } from 'next/server'
import { fetchManifest, getConfiguredManifestUrl, pickArtifact } from '@/lib/upgrade/manager'
import { getVersionInfo, parseMccVersion } from '@/lib/version'

// Always evaluate this route on each call. Without this Next.js may
// statically cache the response, masking new releases until the server
// restarts.
export const dynamic = 'force-dynamic'
export const revalidate = 0

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

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
    const hasUpdate = compareSemver(latestMcc, info.mccVersion) > 0
    const artifact = pickArtifact(manifest)
    return NextResponse.json({
      current: info.version,
      currentMcc: info.mccVersion,
      latest: manifest.latest.version,
      latestMcc,
      openclawVersion: manifest.latest.openclawVersion || null,
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
