import { NextRequest, NextResponse } from 'next/server'
import { startJob } from '@/lib/jobs/runner'
import { buildDeviceCodeLoginJob, buildPasteApiKeyJob } from '@/lib/openclaw/auth-jobs'
import { findProvider } from '@/lib/openclaw/auth-providers'
import { listAgents } from '@/lib/openclaw/auth-profiles'

// Whitelist of acceptable agent id chars — defence-in-depth against
// argv flag smuggling (e.g. agent="-foo" reparsed as a flag by openclaw).
const SAFE_ID = /^[a-zA-Z0-9_.-]+$/
function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length < 128 && SAFE_ID.test(v)
}

interface LoginBody {
  provider: string
  agent: string
  method: 'device-code' | 'api-key'
  apiKey?: string
  applyToAgents?: string[]
}

export async function POST(req: NextRequest) {
  let body: LoginBody
  try {
    body = (await req.json()) as LoginBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const { provider, agent, method, apiKey, applyToAgents } = body
  if (!provider || !agent || !method) {
    return NextResponse.json({ error: 'provider, agent, method required' }, { status: 400 })
  }
  // provider must be in the curated catalog — that gives it whitelist semantics
  // and prevents an attacker from injecting e.g. "--evil" as the provider arg.
  const spec = findProvider(provider)
  if (!spec) return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 })
  if (!spec.methods.includes(method)) {
    return NextResponse.json(
      { error: `provider ${provider} does not support ${method}` },
      { status: 400 },
    )
  }
  // agent ids come from on-disk dirnames — validate against the actual set
  // AND reject anything outside [A-Za-z0-9_.-] to defang argv flag smuggling.
  if (!isSafeId(agent)) {
    return NextResponse.json({ error: 'invalid agent id' }, { status: 400 })
  }
  const knownAgents = (await listAgents()).map((a) => a.id)
  if (!knownAgents.includes(agent)) {
    return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 400 })
  }
  if (applyToAgents !== undefined) {
    if (!Array.isArray(applyToAgents)) {
      return NextResponse.json({ error: 'applyToAgents must be an array' }, { status: 400 })
    }
    for (const a of applyToAgents) {
      if (!isSafeId(a) || !knownAgents.includes(a)) {
        return NextResponse.json({ error: `invalid applyToAgents entry: ${a}` }, { status: 400 })
      }
    }
  }

  if (method === 'device-code') {
    const meta = startJob(
      buildDeviceCodeLoginJob({
        provider,
        agent,
        applyToAgents,
        triggeredBy: 'api',
      }),
    )
    return NextResponse.json({ jobId: meta.id })
  }

  if (method === 'api-key') {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 4) {
      return NextResponse.json({ error: 'apiKey missing or too short' }, { status: 400 })
    }
    const meta = startJob(
      buildPasteApiKeyJob({
        provider,
        agent,
        apiKey,
        applyToAgents,
        triggeredBy: 'api',
      }),
    )
    return NextResponse.json({ jobId: meta.id })
  }

  return NextResponse.json({ error: 'unsupported method' }, { status: 400 })
}
