import { NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

export async function GET() {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) {
      return NextResponse.json({ bindings: [], lineAgentId: null })
    }
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const bindings: Array<{ agentId: string; channel: string }> = []
    for (const b of cfg?.bindings ?? []) {
      const ch = b?.match?.channel
      const id = b?.agentId
      if (typeof ch === 'string' && typeof id === 'string') {
        bindings.push({ agentId: id, channel: ch })
      }
    }
    const lineBinding = bindings.find((b) => b.channel === 'line')
    return NextResponse.json({
      bindings,
      lineAgentId: lineBinding?.agentId ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
