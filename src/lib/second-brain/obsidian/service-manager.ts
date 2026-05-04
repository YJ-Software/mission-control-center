import { execFileSync } from 'child_process'
import fs from 'fs'
import { getObsidianConfig } from './config'

export type ServiceName = 'xvfb' | 'openbox' | 'obsidian' | 'x11vnc' | 'websockify' | 'couchdb' | 'all'

export interface ServiceStatus {
  name: ServiceName
  active: boolean
  pid?: number
  memoryMB?: number
  uptime?: string
}

const SYSTEMD_UNITS: Record<Exclude<ServiceName, 'all'>, string> = {
  xvfb: 'xvfb.service',
  openbox: 'openbox.service',
  obsidian: 'obsidian-headless.service',
  x11vnc: 'x11vnc.service',
  websockify: 'websockify.service',
  couchdb: 'couchdb.service',
}

// Order for 'all' start / restart. Stop runs in reverse.
const ALL_ORDER: Exclude<ServiceName, 'all'>[] = ['xvfb', 'openbox', 'obsidian', 'x11vnc', 'websockify', 'couchdb']

function isDockerCouchDB(): boolean {
  return getObsidianConfig('couchdb_install_method') === 'docker'
}

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function runDocker(args: string[]): string {
  const result = runQuiet('docker', args)
  if (result) return result
  return runQuiet('sudo', ['docker', ...args])
}

export function getServiceStatus(name: Exclude<ServiceName, 'all'>): ServiceStatus {
  if (name === 'couchdb' && isDockerCouchDB()) {
    return getDockerCouchDBStatus()
  }

  const unit = SYSTEMD_UNITS[name]
  const isActive = runQuiet('systemctl', ['--user', 'is-active', unit]) === 'active'

  let pid: number | undefined
  let memoryMB: number | undefined
  let uptime: string | undefined

  if (isActive) {
    const pidStr = runQuiet('systemctl', ['--user', 'show', unit, '--property=MainPID', '--value'])
    pid = pidStr ? parseInt(pidStr) : undefined

    if (pid && pid > 0) {
      try {
        const statusContent = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
        const vmRssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/)
        if (vmRssMatch) memoryMB = Math.round(parseInt(vmRssMatch[1]) / 1024)
      } catch {
        // Process may have exited
      }

      const elapsed = runQuiet('ps', ['-o', 'etimes=', '-p', String(pid)])
      if (elapsed) {
        const secs = parseInt(elapsed)
        if (secs >= 0) {
          const days = Math.floor(secs / 86400)
          const hours = Math.floor((secs % 86400) / 3600)
          const mins = Math.floor((secs % 3600) / 60)
          uptime = days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
        }
      }
    }
  }

  return { name, active: isActive, pid, memoryMB, uptime }
}

function getDockerCouchDBStatus(): ServiceStatus {
  const output = runDocker(['inspect', '--format={{.State.Running}}|{{.State.Pid}}', 'couchdb-for-ols'])
  if (!output) return { name: 'couchdb', active: false }

  const [running, pidStr] = output.split('|')
  const active = running === 'true'
  const pid = parseInt(pidStr) || undefined

  let memoryMB: number | undefined
  if (active) {
    const mem = runDocker(['stats', 'couchdb-for-ols', '--no-stream', '--format={{.MemUsage}}'])
    const match = mem.match(/([\d.]+)MiB/)
    if (match) memoryMB = Math.round(parseFloat(match[1]))
  }

  return { name: 'couchdb', active, pid, memoryMB }
}

export function getAllServiceStatuses(): ServiceStatus[] {
  return ALL_ORDER.map(getServiceStatus)
}

export async function serviceAction(
  name: ServiceName,
  action: 'start' | 'stop' | 'restart'
): Promise<{ success: boolean; error?: string }> {
  if (name === 'all') {
    const order = action === 'stop' ? [...ALL_ORDER].reverse() : ALL_ORDER
    let lastError: string | undefined
    for (const n of order) {
      const r = await serviceAction(n, action)
      if (!r.success) lastError = r.error ?? `Failed on ${n}`
    }
    return lastError ? { success: false, error: lastError } : { success: true }
  }

  try {
    if (name === 'couchdb' && isDockerCouchDB()) {
      try {
        execFileSync('docker', [action, 'couchdb-for-ols'], { timeout: 15000 })
      } catch {
        execFileSync('sudo', ['docker', action, 'couchdb-for-ols'], { timeout: 15000 })
      }
    } else {
      const unit = SYSTEMD_UNITS[name]
      execFileSync('systemctl', ['--user', action, unit], { timeout: 15000 })
    }
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}
