import { NextResponse } from 'next/server'
import { fetchManifest, getConfiguredManifestUrl, pickArtifact } from '@/lib/upgrade/manager'
import { getVersionInfo } from '@/lib/version'

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
    const current = getVersionInfo().version
    const hasUpdate = compareSemver(manifest.latest.version, current) > 0
    const artifact = pickArtifact(manifest)
    return NextResponse.json({
      current,
      latest: manifest.latest.version,
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
