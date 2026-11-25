import { NextResponse } from 'next/server'
import { getServicesStatus, getTailscaleStatus, getOpenClawVersionInfo, getOpencliVersionInfo } from '@/lib/services-status'

import { getBackendCapabilities } from '@/lib/agent-runtime/selection'

export async function GET() {
  try {
    const services = await getServicesStatus()
    const tailscale = getTailscaleStatus()
    const [openclawVersion, opencliVersion] = await Promise.all([
      getBackendCapabilities().service.upgrade ? getOpenClawVersionInfo() : null,
      getOpencliVersionInfo(),
    ])
    return NextResponse.json({ services, tailscale, openclawVersion, opencliVersion })
  } catch (err) {
    return NextResponse.json(
      { services: [], tailscale: null, openclawVersion: null, opencliVersion: null, error: String(err) },
      { status: 500 },
    )
  }
}
