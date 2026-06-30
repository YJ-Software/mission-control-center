import {
  getAllServiceStatuses as getAll,
  serviceAction as doAction,
  allInputMethodInstalled,
  ServiceStatus,
  getServiceStatus,
} from '@/lib/headless-vnc'
import { getUnitNames } from '@/lib/headless-vnc'
import fs from 'fs'
import path from 'path'
import os from 'os'

export type ChromeServiceName = 'xvfb-chrome' | 'openbox-chrome' | 'fcitx5-chrome' | 'chrome-headless' | 'x11vnc-chrome' | 'websockify-chrome' | 'opencli-daemon' | 'all'

export type { ServiceStatus }

function imOpts() {
  return { inputMethod: allInputMethodInstalled() }
}

export function hasOpencliDaemonUnit(): boolean {
  return fs.existsSync(path.join(os.homedir(), '.config', 'systemd', 'user', 'opencli-daemon.service'))
}

export function getAllServiceStatuses(): ServiceStatus[] {
  const statuses = getAll('chrome', imOpts())
  // Include opencli daemon if installed
  if (hasOpencliDaemonUnit()) {
    statuses.push(getServiceStatus('opencli-daemon.service', 'chrome'))
  }
  return statuses
}

const PRIMARY = 'chrome-headless'

export async function serviceAction(
  name: ChromeServiceName,
  action: 'start' | 'stop' | 'restart',
): Promise<{ success: boolean; error?: string }> {
  const validUnits = getUnitNames('chrome', imOpts())
  // Also allow opencli-daemon if its unit exists
  if (hasOpencliDaemonUnit()) validUnits.push('opencli-daemon.service')

  // 'all' cascades every known unit in dependency order (reverse when stopping).
  if (name === 'all') {
    const units = action === 'stop' ? [...validUnits].reverse() : validUnits
    let lastError: string | undefined
    for (const u of units) {
      const result = await doAction(u, action)
      if (!result.success) lastError = result.error ?? `Failed on ${u}`
    }
    return lastError ? { success: false, error: lastError } : { success: true }
  }

  const unit = `${name}.service`
  if (!validUnits.includes(unit)) {
    return { success: false, error: `Unknown service: ${name}` }
  }

  // Starting/restarting the primary service starts all units in dependency order;
  // stopping it stops all units in reverse order.
  if (name === PRIMARY) {
    const units = action === 'stop' ? [...validUnits].reverse() : validUnits
    for (const u of units) {
      const result = await doAction(u, action)
      if (!result.success) return result
    }
    return { success: true }
  }

  return doAction(unit, action)
}
