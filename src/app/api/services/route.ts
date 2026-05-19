import { NextResponse } from 'next/server'
import { getServicesStatus, getTailscaleStatus, getOpenClawVersionInfo } from '@/lib/services-status'

export async function GET() {
  try {
    const services = getServicesStatus()
    const tailscale = getTailscaleStatus()
    const openclawVersion = await getOpenClawVersionInfo()
    return NextResponse.json({ services, tailscale, openclawVersion })
  } catch (err) {
    return NextResponse.json(
      { services: [], tailscale: null, openclawVersion: null, error: String(err) },
      { status: 500 },
    )
  }
}
