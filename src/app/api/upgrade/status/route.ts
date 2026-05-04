import { NextResponse } from 'next/server'
import { getInstallInfo, getConfiguredManifestUrl } from '@/lib/upgrade/manager'
import { getVersionInfo } from '@/lib/version'

export async function GET() {
  const info = getInstallInfo()
  const v = getVersionInfo()
  return NextResponse.json({
    mode: info.mode,
    prefix: info.prefix,
    state: info.state,
    service: info.service,
    current: {
      version: v.version,
      commit: v.commit,
      buildTime: v.buildTime,
    },
    manifestUrl: getConfiguredManifestUrl() || null,
  })
}
