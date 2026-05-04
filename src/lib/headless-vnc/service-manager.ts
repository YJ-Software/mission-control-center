// src/lib/headless-vnc/service-manager.ts
import { execFileSync } from 'child_process'
import fs from 'fs'
import { getUnitNames } from './unit-templates'

export interface ServiceStatus {
  name: string
  unit: string
  active: boolean
  pid?: number
  memoryMB?: number
  uptime?: string
}

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function unitToLabel(unit: string, prefix: string): string {
  return unit
    .replace('.service', '')
    .replace(`-${prefix}`, '')
    .replace(`${prefix}-`, '')
}

export function getServiceStatus(unit: string, prefix: string): ServiceStatus {
  const name = unitToLabel(unit, prefix)
  const activeRaw = runQuiet('systemctl', ['--user', 'is-active', unit])
  const active = activeRaw === 'active'

  let pid: number | undefined
  let memoryMB: number | undefined
  let uptime: string | undefined

  if (active) {
    const pidRaw = runQuiet('systemctl', ['--user', 'show', unit, '-p', 'MainPID', '--value'])
    pid = pidRaw ? parseInt(pidRaw, 10) : undefined

    if (pid && pid > 0) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8')
        const vmRss = status.match(/VmRSS:\s+(\d+)\s+kB/)
        if (vmRss) memoryMB = Math.round(parseInt(vmRss[1], 10) / 1024)
      } catch {}

      const elapsed = runQuiet('ps', ['-o', 'etime=', '-p', String(pid)])
      if (elapsed) uptime = elapsed.trim()
    }
  }

  return { name, unit, active, pid, memoryMB, uptime }
}

export function getAllServiceStatuses(prefix: string, opts?: { inputMethod?: boolean }): ServiceStatus[] {
  return getUnitNames(prefix, opts).map(unit => getServiceStatus(unit, prefix))
}

export async function serviceAction(
  unit: string,
  action: 'start' | 'stop' | 'restart',
): Promise<{ success: boolean; error?: string }> {
  try {
    execFileSync('systemctl', ['--user', action, unit], { timeout: 15000 })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export { runQuiet }
