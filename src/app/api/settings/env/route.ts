import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const ENV_PATH = join(process.cwd(), '.env.local')

function parseEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}
  const content = readFileSync(ENV_PATH, 'utf8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    result[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1)
  }
  return result
}

function writeEnvFile(vars: Record<string, string>) {
  if (!existsSync(ENV_PATH)) return

  const content = readFileSync(ENV_PATH, 'utf8')
  const lines = content.split('\n')
  const updated = new Set<string>()

  const newLines = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return line
    const key = trimmed.slice(0, eqIndex)
    if (key in vars) {
      updated.add(key)
      return `${key}=${vars[key]}`
    }
    return line
  })

  // Append any new keys not already in file
  for (const [key, value] of Object.entries(vars)) {
    if (!updated.has(key)) {
      newLines.push(`${key}=${value}`)
    }
  }

  writeFileSync(ENV_PATH, newLines.join('\n'))
}

// Only expose specific safe keys
const ALLOWED_KEYS = ['OPENCLAW_GATEWAY_WS', 'OPENCLAW_GATEWAY_HTTP', 'OPENCLAW_TOKEN']

export async function GET() {
  try {
    const env = parseEnvFile()
    const result: Record<string, string> = {}
    for (const key of ALLOWED_KEYS) {
      result[key] = env[key] || ''
    }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>
    const filtered: Record<string, string> = {}
    for (const key of ALLOWED_KEYS) {
      if (key in body) filtered[key] = body[key]
    }
    writeEnvFile(filtered)
    return NextResponse.json({ ok: true, restart: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
