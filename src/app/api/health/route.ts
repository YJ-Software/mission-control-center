import { NextResponse } from 'next/server'
import { getVersionInfo } from '@/lib/version'

export async function GET() {
  const { version, mccVersion, openclawVersion, commit, buildTime } = getVersionInfo()
  return NextResponse.json({
    status: 'ok',
    version,
    mccVersion,
    openclawVersion,
    commit,
    buildTime,
  })
}
