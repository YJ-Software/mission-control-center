import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

export function stubHermesHome() {
  const home = mkdtempSync(join(tmpdir(), 'mcc-hermes-test-'))
  for (const [key, directory] of Object.entries({
    HERMES_HOME: '.hermes',
    OPENCLAW_STATE_DIR: '.openclaw',
    MISSION_CONTROL_DATA_DIR: '.mission-control',
    XDG_CONFIG_HOME: '.config',
    XDG_CACHE_HOME: '.cache',
    XDG_DATA_HOME: '.data',
    XDG_STATE_HOME: '.state',
    XDG_RUNTIME_DIR: '.runtime',
  })) {
    const path = join(home, directory)
    mkdirSync(path)
    vi.stubEnv(key, path)
  }
  vi.stubEnv('HOME', home)
  vi.stubEnv('DBUS_SESSION_BUS_ADDRESS', `unix:path=${join(home, '.runtime', 'bus')}`)
  vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
  for (const key of ['HERMES_API_KEY', 'HERMES_API_URL', 'HERMES_INSTALL_DIR', 'HERMES_BIN']) vi.stubEnv(key, undefined)
  return { home, hermes: join(home, '.hermes'), cleanup: () => rmSync(home, { recursive: true, force: true }) }
}
