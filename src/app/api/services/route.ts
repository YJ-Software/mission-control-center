import { NextResponse } from 'next/server'
import { getServicesStatus, getTailscaleStatus, getOpenClawVersionInfo, getOpencliVersionInfo } from '@/lib/services-status'

export async function GET() {
  try {
    const services = getServicesStatus()
    const tailscale = getTailscaleStatus()
    const [openclawVersion, opencliVersion] = await Promise.all([
      getOpenClawVersionInfo(),
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
