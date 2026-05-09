import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

export function expandHome(path) {
  if (!path) return path
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return `${homedir()}/${path.slice(2)}`
  return path
}

export function buildSshArgs({ user, host, keyPath, command, extraOpts = [] }) {
  const args = [
    '-i', expandHome(keyPath),
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    ...extraOpts,
    `${user}@${host}`,
    command,
  ]
  return args
}

/**
 * Run a command over SSH. Resolves with {code, stdout, stderr}.
 * Never throws on non-zero exit — caller decides what's an error.
 */
export function sshExec({ user, host, keyPath, command, timeoutMs = 60_000 }) {
  return new Promise(resolve => {
    const child = spawn('ssh', buildSshArgs({ user, host, keyPath, command }))
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Wait until SSH accepts connections (used after rebuild). */
export async function waitForSsh({ user, host, keyPath, timeoutMs = 5 * 60_000 }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { code } = await sshExec({ user, host, keyPath, command: 'true', timeoutMs: 15_000 })
    if (code === 0) return
    await new Promise(r => setTimeout(r, 5_000))
  }
  throw new Error(`SSH not reachable on ${host} after ${timeoutMs / 1000}s`)
}
