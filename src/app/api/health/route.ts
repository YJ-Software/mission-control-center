import { NextResponse } from 'next/server'
import { getVersionInfo } from '@/lib/version'

export async function GET() {
  const { version, commit, buildTime } = getVersionInfo()
  return NextResponse.json({
    status: 'ok',
    version,
    commit,
    buildTime,
  })
}
