import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getServerEnv } from '@/lib/server-env'
import {
  planHardening,
  buildHardenedConfig,
  type AuditFinding,
} from '@/lib/openclaw/secret-hardening'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const BUNDLE_PATH = join(homedir(), '.openclaw', 'secrets', 'secrets.json')
const PROVIDER = 'mcc-file'

/** Ask OpenClaw which fields are still plaintext. It already knows — the list
 * grows with each release, so deriving the plan from the audit beats keeping a
 * hardcoded list in step. */
async function auditFindings(): Promise<AuditFinding[]> {
  const { stdout } = await execFileAsync('openclaw', ['secrets', 'audit', '--json'], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: getServerEnv(),
  })
  const parsed = JSON.parse(stdout) as { findings?: AuditFinding[] }
  return parsed.findings ?? []
}

function readBundle(): Record<string, unknown> {
  if (!existsSync(BUNDLE_PATH)) return {}
  try {
    return JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

/** GET — how many credentials are still plaintext in openclaw.json. */
export async function GET() {
  try {
    const plan = planHardening(await auditFindings(), OPENCLAW_CONFIG)
    return NextResponse.json({
      plaintextCount: plan.length,
      fields: plan.map((t) => t.jsonPath),
      hardened: plan.length === 0,
      bundlePath: BUNDLE_PATH,
      provider: PROVIDER,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — move every plaintext credential into the file provider, then restart
 * the gateway so it picks the refs up. Idempotent: re-running with nothing left
 * to move rewrites nothing and skips the restart. */
export async function POST() {
  try {
    const plan = planHardening(await auditFindings(), OPENCLAW_CONFIG)
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf8'))
    const { config: next, bundle, moved } = buildHardenedConfig(config, plan, {
      provider: PROVIDER,
      path: BUNDLE_PATH,
      existingBundle: readBundle(),
    })

    if (moved === 0) {
      return NextResponse.json({ moved: 0, restarted: false, message: 'already hardened' })
    }

    // Keep a copy of the pre-migration config: this rewrites every credential
    // in one pass, and a bad write would lock the gateway out of its own auth.
    // The backup still holds every secret in plaintext, so create it 0600
    // outright rather than copying and fixing up — a copy inherits whatever
    // mode the source happens to carry, and is briefly readable before a
    // follow-up chmod lands.
    const backupPath = `${OPENCLAW_CONFIG}.pre-secret-hardening`
    writeFileSync(backupPath, readFileSync(OPENCLAW_CONFIG), { mode: 0o600 })
    chmodSync(backupPath, 0o600)

    const dir = dirname(BUNDLE_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    writeFileSync(BUNDLE_PATH, JSON.stringify(bundle, null, 2), { mode: 0o600 })
    chmodSync(BUNDLE_PATH, 0o600)

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(next, null, 2), { mode: 0o600 })
    chmodSync(OPENCLAW_CONFIG, 0o600)

    let restarted = true
    let restartError: string | undefined
    try {
      await execFileAsync('openclaw', ['gateway', 'restart'], {
        timeout: 120_000,
        env: getServerEnv(),
      })
    } catch (err) {
      restarted = false
      restartError = err instanceof Error ? err.message : String(err)
    }

    return NextResponse.json({
      moved,
      fields: plan.map((t) => t.jsonPath),
      bundlePath: BUNDLE_PATH,
      backup: backupPath,
      restarted,
      restartError,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
