import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { detectHeadlessDeps } from '@/lib/headless-vnc'

// Fresh-install defaults — wiki vault is the canonical home. Capture skills
// will land their raw/ + transcripts/ inside the wiki vault, sibling to
// memory-wiki's managed sources/. dualWrite mode (`wiki.dualWrite=true` setting)
// is for operators with a pre-existing personal vault who want both worlds.
const DEFAULTS: Record<string, string> = {
  'obsidian.vault_path': '~/.openclaw/wiki/main',
  'obsidian.display': ':5',
  'obsidian.resolution': '1024x768',
  'obsidian.vnc_password': '',
  'obsidian.vnc_port': '5900',
  'obsidian.websockify_port': '6080',
  'obsidian.couchdb_url': 'http://localhost:5984',
  'obsidian.couchdb_user': 'admin',
  'obsidian.couchdb_password': '',
  'obsidian.couchdb_database': 'obsidian_livesync',
  'obsidian.couchdb_install_method': 'docker',
  'obsidian.couchdb_data_dir': '~/.mission-control/couchdb-data',
  'obsidian.ime_enabled': 'false',
  'obsidian.e2ee_enabled': '',
  'obsidian.e2ee_passphrase': '',
  'obsidian.e2ee_path_obfuscation': '',
  'obsidian.installed': 'false',
  'obsidian.couchdb_installed': 'false',
}

export function getObsidianConfig(key: string): string {
  const fullKey = key.startsWith('obsidian.') ? key : `obsidian.${key}`
  const row = db.select().from(settings).where(eq(settings.key, fullKey)).get()
  return row?.value ?? DEFAULTS[fullKey] ?? ''
}

export function setObsidianConfig(key: string, value: string): void {
  const fullKey = key.startsWith('obsidian.') ? key : `obsidian.${key}`
  db.insert(settings)
    .values({ key: fullKey, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function getAllObsidianConfig(): Record<string, string> {
  const rows = db.select().from(settings).all()
  const result: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) {
    if (row.key.startsWith('obsidian.')) {
      result[row.key] = row.value
    }
  }
  return result
}

export function getAllObsidianConfigClean(): Record<string, string> {
  const raw = getAllObsidianConfig()
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key.replace('obsidian.', '')] = value
  }
  return result
}

export function setMultipleObsidianConfig(entries: Record<string, string>): void {
  for (const [key, value] of Object.entries(entries)) {
    setObsidianConfig(key, value)
  }
}

function runQuiet(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return ''
  }
}

function hasBinary(name: string): boolean {
  return !!runQuiet('which', [name])
}

function hasSystemdUnit(unit: string, user = false): boolean {
  const args = user ? ['--user', 'is-enabled', unit] : ['is-enabled', unit]
  const state = runQuiet('systemctl', args)
  return state === 'enabled' || state === 'disabled' || state === 'static'
}

export interface DetectedComponents {
  obsidian: boolean
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
  couchdb: boolean
}

/** Detect which components are present on the system */
export function detectComponents(): DetectedComponents {
  const obsidian = hasBinary('obsidian') || hasSystemdUnit('obsidian-headless.service', true)
  const headless = detectHeadlessDeps()
  const { xvfb, openbox, x11vnc, websockify } = headless

  // CouchDB: Docker container, systemd service, or reachable URL
  let couchdb = false
  const docker = runQuiet('docker', ['inspect', '--format={{.State.Status}}', 'couchdb-for-ols'])
  if (docker) {
    couchdb = true
  } else if (hasSystemdUnit('couchdb.service') || hasSystemdUnit('couchdb.service', true)) {
    couchdb = true
  } else {
    const url = getObsidianConfig('couchdb_url')
    if (url) {
      const resp = runQuiet('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', url])
      if (resp && resp !== '000') couchdb = true
    }
  }

  return { obsidian, xvfb, openbox, x11vnc, websockify, couchdb }
}

/** Auto-update DB flags based on detected components */
export function autoDetectInstalled(): DetectedComponents {
  const detected = detectComponents()
  if (getObsidianConfig('installed') !== 'true' && detected.obsidian) {
    setObsidianConfig('installed', 'true')
  }
  if (getObsidianConfig('couchdb_installed') !== 'true' && detected.couchdb) {
    setObsidianConfig('couchdb_installed', 'true')
  }
  return detected
}

/** Read vault paths from Obsidian's own config (~/.config/obsidian/obsidian.json) */
export function detectVaultPaths(): string[] {
  try {
    const configPath = path.join(os.homedir(), '.config/obsidian/obsidian.json')
    const raw = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(raw) as { vaults?: Record<string, { path: string }> }
    if (!config.vaults) return []
    return Object.values(config.vaults)
      .map(v => v.path)
      .filter(p => {
        try { return fs.statSync(p).isDirectory() } catch { return false }
      })
  } catch {
    return []
  }
}
