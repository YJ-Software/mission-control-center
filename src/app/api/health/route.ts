import { NextResponse } from 'next/server'
import { getVersionInfo } from '@/lib/version'
import { getBackendInfo } from '@/lib/agent-runtime/backend-info'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { version, mccVersion, commit, buildTime } = getVersionInfo()
  const backend = await getBackendInfo()
  return NextResponse.json({
    status: 'ok', version, mccVersion, commit, buildTime, backend,
    openclawVersion: backend.kind === 'openclaw' ? backend.version : null,
  })
}
