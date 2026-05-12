import { NextRequest, NextResponse } from 'next/server'
import {
  getTailscaleInfo,
  getHttpsStatus,
  setHttpsMode,
  parsePortFromUrl,
  type HttpsMode,
} from '@/lib/second-brain/obsidian/tailscale'
import { getObsidianConfig } from '@/lib/second-brain/obsidian/config'

function couchdbPort(): number {
  return parsePortFromUrl(getObsidianConfig('couchdb_url') || 'http://localhost:5984', 5984)
}

export async function GET() {
  const info = getTailscaleInfo()
  const port = couchdbPort()
  const https = info.running ? getHttpsStatus(port) : { mode: 'off' as const, url: null }
  return NextResponse.json({ ...info, port, https })
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const port = couchdbPort()

  if (action === 'https-set') {
    const modeParam = url.searchParams.get('mode') as HttpsMode | null
    if (modeParam !== 'off' && modeParam !== 'serve' && modeParam !== 'funnel') {
      return NextResponse.json({ error: 'invalid mode' }, { status: 400 })
    }
    const result = await setHttpsMode(modeParam, port)
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          funnelEnableUrl: result.funnelEnableUrl ?? null,
          httpsCertEnableUrl: result.httpsCertEnableUrl ?? null,
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, ...result.status })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
