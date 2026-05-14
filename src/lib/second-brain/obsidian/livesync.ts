import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { getObsidianConfig, setObsidianConfig } from './config'

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

export async function installLiveSyncPlugin(): Promise<{ success: boolean; error?: string }> {
  try {
    const vaultPath = expandHome(getObsidianConfig('vault_path'))
    const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'obsidian-livesync')
    const communityPluginsPath = path.join(vaultPath, '.obsidian', 'community-plugins.json')

    fs.mkdirSync(pluginDir, { recursive: true })

    const releaseApi = 'https://api.github.com/repos/vrtmrz/obsidian-livesync/releases/latest'
    const releaseRes = await fetch(releaseApi)
    const release = await releaseRes.json()

    const assets = release.assets as { name: string; browser_download_url: string }[]
    const filesToDownload = ['main.js', 'manifest.json', 'styles.css']

    for (const fileName of filesToDownload) {
      const asset = assets.find(a => a.name === fileName)
      if (asset) {
        const res = await fetch(asset.browser_download_url)
        const content = await res.text()
        fs.writeFileSync(path.join(pluginDir, fileName), content)
      }
    }

    const couchdbUrl = getObsidianConfig('couchdb_url')
    const couchdbUser = getObsidianConfig('couchdb_user')
    const couchdbPassword = getObsidianConfig('couchdb_password')
    const couchdbDatabase = getObsidianConfig('couchdb_database')

    // E2EE configuration — installing LiveSync always enables E2EE + path
    // obfuscation. A previously-stored passphrase is preserved so we don't
    // strand an existing encrypted DB; only generate one when missing.
    setObsidianConfig('e2ee_enabled', 'true')
    setObsidianConfig('e2ee_path_obfuscation', 'true')
    const e2eeEnabled = 'true'
    let passphrase = getObsidianConfig('e2ee_passphrase')
    if (!passphrase) {
      passphrase = crypto.randomBytes(24).toString('base64url')
      setObsidianConfig('e2ee_passphrase', passphrase)
    }
    const pathObfuscation = 'true'

    const liveSyncConfig: Record<string, unknown> = {
      couchDB_URI: couchdbUrl,
      couchDB_USER: couchdbUser,
      couchDB_PASSWORD: couchdbPassword,
      couchDB_DBNAME: couchdbDatabase,
      liveSync: true,
      syncOnStart: true,
      syncOnSave: true,
      periodicReplication: false,
      batch_size: 50,
      batches_limit: 40,
      encrypt: e2eeEnabled === 'true',
      passphrase: e2eeEnabled === 'true' ? passphrase : '',
      usePathObfuscation: pathObfuscation === 'true',
      permitEmptyPassphrase: false,
      E2EEAlgorithm: 'v2',
    }

    fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify(liveSyncConfig, null, 2))

    let plugins: string[] = []
    if (fs.existsSync(communityPluginsPath)) {
      try { plugins = JSON.parse(fs.readFileSync(communityPluginsPath, 'utf8')) } catch {}
    }
    if (!plugins.includes('obsidian-livesync')) {
      plugins.push('obsidian-livesync')
    }
    fs.writeFileSync(communityPluginsPath, JSON.stringify(plugins, null, 2))

    const authHeader = 'Basic ' + Buffer.from(`${couchdbUser}:${couchdbPassword}`).toString('base64')
    try {
      await fetch(`${couchdbUrl}/${couchdbDatabase}`, { method: 'PUT', headers: { Authorization: authHeader } })
    } catch {}

    try {
      execFileSync('systemctl', ['--user', 'restart', 'obsidian-headless.service'], { timeout: 10000 })
    } catch {}

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
