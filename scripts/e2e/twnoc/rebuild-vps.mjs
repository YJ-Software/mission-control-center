#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { rebuildVps, vpsStatus, waitForRunning } from './lib/virtualizor-api.mjs'
import { waitForSsh } from './lib/ssh.mjs'
import { writePhaseRecord } from './lib/phase-record.mjs'

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('>>>') || t.startsWith('<<<')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

function redact(s) { return s ? `…${s.slice(-4)}` : '∅' }

async function main() {
  const envPath = resolve(process.cwd(), '.env.e2e.local')
  const env = loadEnv(envPath)
  const required = [
    'VIRTUALIZOR_PANEL', 'VIRTUALIZOR_API_KEY', 'VIRTUALIZOR_API_PASS',
    'VIRTUALIZOR_VPS_ID', 'VIRTUALIZOR_OS_TEMPLATE_ID',
    'E2E_SSH_HOST', 'E2E_SSH_USER', 'E2E_SSH_KEY',
  ]
  const missing = required.filter(k => !env[k])
  if (missing.length) {
    console.error(`[phase-1] missing env keys: ${missing.join(', ')}`)
    process.exit(2)
  }
  console.log(`[phase-1] vps=${env.VIRTUALIZOR_VPS_ID} key=${redact(env.VIRTUALIZOR_API_KEY)}`)

  const before = await vpsStatus(env)
  console.log(`[phase-1] pre-rebuild status: ${JSON.stringify(before.json?.info?.status ?? before.json)}`)

  console.log('[phase-1] sending rebuild …')
  const rebuildResp = await rebuildVps(env)
  console.log(`[phase-1] rebuild response: ${JSON.stringify(rebuildResp.json).slice(0, 500)}`)
  if (rebuildResp.status >= 400 || rebuildResp.json?.error) {
    throw new Error(`rebuild API rejected: ${JSON.stringify(rebuildResp)}`)
  }

  console.log('[phase-1] waiting for VPS to be running …')
  const finalStatus = await waitForRunning(env)

  console.log('[phase-1] waiting for SSH …')
  await waitForSsh({
    user: env.E2E_SSH_USER,
    host: env.E2E_SSH_HOST,
    keyPath: env.E2E_SSH_KEY,
  })

  console.log('[phase-1] done')
  writePhaseRecord(1, { vpsId: env.VIRTUALIZOR_VPS_ID, finalStatus, ok: true })
}

main().catch(err => {
  writePhaseRecord(1, { ok: false, error: String(err) })
  console.error('[phase-1] FAIL', err)
  process.exit(1)
})
