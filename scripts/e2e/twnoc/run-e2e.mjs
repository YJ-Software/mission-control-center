#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { writePhaseRecord } from './lib/phase-record.mjs'

const args = process.argv.slice(2)
const mode = args.find(a => !a.startsWith('--')) ?? 'full'
const dryRun = args.includes('--dry-run')

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('>>>') || t.startsWith('<<<')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const value = t.slice(eq + 1).trim()
    if (!value) continue
    env[t.slice(0, eq).trim()] = value
  }
  return env
}

function exportEnv(env) {
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v
  }
  if (env.E2E_SSH_HOST && !process.env.PLAYWRIGHT_BASE_URL) {
    process.env.PLAYWRIGHT_BASE_URL = `http://${env.E2E_SSH_HOST}:3737`
  }
}

function run(cmd, args, env = {}) {
  return new Promise((resolveP, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('close', code => code === 0 ? resolveP() : reject(new Error(`${cmd} exit=${code}`)))
  })
}

async function pause(label) {
  if (!dryRun) return
  process.stdout.write(`\n[dry-run] ${label} — press Enter to continue (or Ctrl+C to abort) `)
  await new Promise(r => process.stdin.once('data', r))
}

const PHASES = {
  rebuild:  () => run('node', ['scripts/e2e/twnoc/rebuild-vps.mjs']),
  deploy:   () => run('npx',  ['playwright', 'test', '--project=twnoc-deploy', 'tests/e2e/twnoc/whmcs-deploy.spec.ts']),
  firewall: () => run('node', ['scripts/e2e/twnoc/setup-firewall.mjs']),
  specs:    () => run('npx',  ['playwright', 'test', '--project=mcc']),
  telegram: () => run('npx',  ['playwright', 'test', '--project=twnoc-deploy', 'tests/e2e/twnoc/whmcs-telegram-pair.spec.ts']),
}

async function main() {
  const envPath = resolve(process.cwd(), '.env.e2e.local')
  if (!existsSync(envPath)) {
    console.error(`[run-e2e] ${envPath} not found. Copy .env.e2e.local.example first.`)
    process.exit(2)
  }
  const env = loadEnv(envPath)
  exportEnv(env)

  let plan = []
  switch (mode) {
    case 'full':          plan = ['rebuild', 'deploy', 'firewall', 'specs', 'telegram']; break
    case 'smoke':         plan = ['specs']; break
    case 'firewall-only': plan = ['firewall']; break
    default:
      console.error(`unknown mode "${mode}". Use: full | smoke | firewall-only`)
      process.exit(2)
  }

  console.log(`[run-e2e] mode=${mode} dry-run=${dryRun} plan=${plan.join(' → ')}`)

  for (const phase of plan) {
    await pause(`about to run phase "${phase}"`)
    console.log(`\n[run-e2e] ─── ${phase} ─────────────────────────────`)
    try {
      await PHASES[phase]()
    } catch (err) {
      console.error(`[run-e2e] ${phase} FAILED: ${err.message}`)
      writePhaseRecord(phase, { ok: false, error: err.message })
      process.exit(1)
    }
    // After Phase 2 writes AUTH_PASSWORD back to .env.e2e.local, refresh process.env
    if (phase === 'deploy') {
      const fresh = loadEnv(resolve(process.cwd(), '.env.e2e.local'))
      for (const [k, v] of Object.entries(fresh)) {
        process.env[k] = v
      }
    }
  }

  console.log(`\n[run-e2e] all phases ok`)
}

main()
