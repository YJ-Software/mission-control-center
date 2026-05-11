#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sshExec } from './lib/ssh.mjs'
import { writePhaseRecord } from './lib/phase-record.mjs'
import { request } from 'node:http'

const ALWAYS_ALLOW = '122.146.90.137'

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

async function ssh(env, command, timeoutMs = 60_000) {
  const r = await sshExec({
    user: env.E2E_SSH_USER, host: env.E2E_SSH_HOST,
    keyPath: env.E2E_SSH_KEY, command, timeoutMs,
  })
  if (r.code !== 0) throw new Error(`ssh "${command}" exit=${r.code} stderr=${r.stderr}`)
  return r.stdout.trim()
}

async function localHttp(host, port, path, timeoutMs = 10_000) {
  return new Promise(resolve => {
    const req = request({ host, port, path, method: 'GET', timeout: timeoutMs }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }) })
    req.end()
  })
}

async function main() {
  const env = loadEnv(resolve(process.cwd(), '.env.e2e.local'))
  for (const k of ['E2E_SSH_HOST', 'E2E_SSH_USER', 'E2E_SSH_KEY', 'E2E_LOCAL_PUBLIC_IP']) {
    if (!env[k]) { console.error(`[phase-3] missing ${k}`); process.exit(2) }
  }

  // Pre-check: SSH source IP from sshd's $SSH_CONNECTION (first field = client IP).
  // `who` is unreliable here — non-interactive SSH commands don't always populate utmp.
  const conn = await ssh(env, 'echo "$SSH_CONNECTION"')
  const observed = conn.split(/\s+/)[0]
  if (!observed || !/^\d+\.\d+\.\d+\.\d+$/.test(observed)) {
    throw new Error(`could not parse source IP from SSH_CONNECTION: "${conn}"`)
  }
  if (observed !== env.E2E_LOCAL_PUBLIC_IP) {
    throw new Error(
      `source IP mismatch: who reports ${observed} but E2E_LOCAL_PUBLIC_IP=${env.E2E_LOCAL_PUBLIC_IP}. ` +
      `Refusing to enable ufw — would lock you out.`
    )
  }
  console.log(`[phase-3] source IP verified: ${observed}`)

  // Dashboard alive locally on VPS?
  const localHealth = await ssh(env, 'curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1:3737/api/health || echo "0"')
  if (!/^2\d\d/.test(localHealth)) {
    throw new Error(`dashboard not alive on VPS localhost: /api/health → ${localHealth}`)
  }
  console.log('[phase-3] dashboard reachable on VPS localhost')

  // Reset and configure ufw
  console.log('[phase-3] applying ufw rules')
  await ssh(env, 'ufw --force reset')
  await ssh(env, 'ufw default deny incoming')
  await ssh(env, 'ufw default allow outgoing')
  await ssh(env, `ufw allow from ${env.E2E_LOCAL_PUBLIC_IP}`)
  await ssh(env, `ufw allow from ${ALWAYS_ALLOW}`)
  await ssh(env, 'ufw --force enable')

  const ruleList = await ssh(env, 'ufw status numbered')
  console.log(`[phase-3] ufw rules:\n${ruleList}`)

  // Post-check: dashboard reachable from local machine
  const remote = await localHttp(env.E2E_SSH_HOST, 3737, '/api/health')
  if (remote.status < 200 || remote.status >= 300) {
    throw new Error(`dashboard not reachable from local after ufw enable: status=${remote.status}`)
  }
  console.log(`[phase-3] dashboard reachable from local: ${remote.status}`)

  writePhaseRecord(3, { ok: true, observed_ip: observed, ufw: ruleList })
}

main().catch(err => {
  writePhaseRecord(3, { ok: false, error: String(err) })
  console.error('[phase-3] FAIL', err)
  process.exit(1)
})
