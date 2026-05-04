import { execFileSync } from 'child_process'
import crypto from 'crypto'
import { getObsidianConfig, setObsidianConfig } from './config'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { sseEncode, createSSEStream } from '@/lib/headless-vnc'
import { resolveHome, generatePassword } from '@/lib/headless-vnc'

export type InstallTarget = 'obsidian' | 'couchdb' | 'headless-deps'

function getLatestObsidianVersion(): string {
  try {
    const url = execFileSync('curl', ['-sL', '-o', '/dev/null', '-w', '%{url_effective}', 'https://github.com/obsidianmd/obsidian-releases/releases/latest'], { encoding: 'utf8', timeout: 10000 }).trim()
    const version = url.split('/').pop()?.replace('v', '')
    if (version && /^\d+\.\d+\.\d+$/.test(version)) return version
  } catch {}
  return '1.12.4' // fallback
}

/** Generate openbox rc.xml that maximizes all windows by default */
function writeOpenboxConfig(): void {
  const openboxDir = path.join(os.homedir(), '.config/openbox')
  fs.mkdirSync(openboxDir, { recursive: true })
  const rcXml = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <!-- Maximize all windows by default for headless VNC -->
    <application class="*">
      <maximized>yes</maximized>
      <decor>no</decor>
    </application>
  </applications>
  <theme>
    <name>Clearlooks</name>
    <titleLayout>NLIMC</titleLayout>
  </theme>
  <desktops>
    <number>1</number>
  </desktops>
</openbox_config>
`
  fs.writeFileSync(path.join(openboxDir, 'rc.xml'), rcXml)
}

/** Generate all systemd unit files for headless environment */
function writeHeadlessUnits(unitDir: string, locale: string = 'zh-TW'): void {
  const display = getObsidianConfig('display')
  const resolution = getObsidianConfig('resolution')
  const vncPort = getObsidianConfig('vnc_port')
  const websockifyPort = getObsidianConfig('websockify_port')
  const homeDir = os.homedir()
  const passwdFile = path.join(homeDir, '.vnc/passwd-obsidian')

  const xvfbUnit = `[Unit]
Description=Xvfb virtual framebuffer

[Service]
ExecStart=/usr/bin/Xvfb ${display} -extension GLX -screen 0 ${resolution}x16
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`

  const openboxUnit = `[Unit]
Description=Openbox window manager
After=xvfb.service

[Service]
Type=simple
Environment=DISPLAY=${display}
ExecStart=/usr/bin/openbox --config-file ${homeDir}/.config/openbox/rc.xml
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`

  const obsidianUnit = `[Unit]
Description=Obsidian (headless via Xvfb)
After=openbox.service

[Service]
Type=simple
Environment=DISPLAY=${display}
Environment=ELECTRON_OZONE_PLATFORM_HINT=auto
Environment=GTK_USE_PORTAL=0
Environment=XDG_CURRENT_DESKTOP=X-Generic
Environment=GTK_MODULES=
ExecStart=obsidian --no-sandbox --disable-features=UsePortalFileChooser --lang=${locale}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`

  const x11vncUnit = `[Unit]
Description=x11vnc VNC server
After=xvfb.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display ${display} -rfbport ${vncPort} -rfbauth ${passwdFile} -forever -shared -localhost
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`

  const websockifyUnit = `[Unit]
Description=websockify VNC to WebSocket bridge
After=x11vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/websockify --web /usr/share/novnc ${websockifyPort} 127.0.0.1:${vncPort}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`

  fs.writeFileSync(path.join(unitDir, 'xvfb.service'), xvfbUnit)
  fs.writeFileSync(path.join(unitDir, 'openbox.service'), openboxUnit)
  fs.writeFileSync(path.join(unitDir, 'obsidian-headless.service'), obsidianUnit)
  fs.writeFileSync(path.join(unitDir, 'x11vnc.service'), x11vncUnit)
  fs.writeFileSync(path.join(unitDir, 'websockify.service'), websockifyUnit)
}

export function installObsidian(locale: string = 'zh-TW'): ReadableStream<Uint8Array> {
  const homeDir = os.homedir()
  const unitDir = path.join(homeDir, '.config/systemd/user')
  const obsidianVersion = getLatestObsidianVersion()

  // Auto-generate VNC password if not set
  let vncPassword = getObsidianConfig('vnc_password')
  if (!vncPassword) {
    vncPassword = generatePassword(16)
    setObsidianConfig('vnc_password', vncPassword)
  }

  const passwdFile = path.join(homeDir, '.vnc/passwd-obsidian')

  fs.mkdirSync(unitDir, { recursive: true })
  fs.mkdirSync(path.join(homeDir, '.vnc'), { recursive: true })

  writeOpenboxConfig()
  writeHeadlessUnits(unitDir, locale)

  const commands = [
    { label: 'Installing Xvfb, openbox, x11vnc, websockify and dependencies', cmd: 'sudo', args: ['apt', 'install', '-y', 'xvfb', 'openbox', 'x11vnc', 'websockify', 'novnc', 'xdg-utils', 'libnotify4', 'libnss3', 'libsecret-1-0'] },
    { label: `Downloading Obsidian v${obsidianVersion}`, cmd: 'wget', args: ['-q', '--show-progress', '-O', '/tmp/obsidian.deb', `https://github.com/obsidianmd/obsidian-releases/releases/download/v${obsidianVersion}/obsidian_${obsidianVersion}_amd64.deb`] },
    // Use `apt install <file>` so missing runtime libraries are auto-resolved;
    // `dpkg -i` alone fails on the first missing dependency and leaves the
    // system in a half-installed state.
    { label: 'Installing Obsidian', cmd: 'sudo', args: ['apt-get', 'install', '-y', '/tmp/obsidian.deb'] },
    { label: 'Reloading systemd user daemon', cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
    { label: 'Enabling and starting Xvfb', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'xvfb.service'] },
    { label: 'Enabling and starting Openbox', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'openbox.service'] },
    { label: 'Enabling and starting Obsidian', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'obsidian-headless.service'] },
    { label: 'Setting VNC password', cmd: 'x11vnc', args: ['-storepasswd', vncPassword, passwdFile] },
    { label: 'Enabling and starting x11vnc', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'x11vnc.service'] },
    { label: 'Enabling and starting websockify', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'websockify.service'] },
    { label: 'Enabling login linger', cmd: 'sudo', args: ['loginctl', 'enable-linger', os.userInfo().username] },
  ]

  const stream = createSSEStream(commands)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let hadError = false
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        if (!hadError) {
          registerObsidianVault(resolveHome(getObsidianConfig('vault_path')))
          // Restart Obsidian so it picks up the registered vault
          try { execFileSync('systemctl', ['--user', 'restart', 'obsidian-headless.service'], { timeout: 10000 }) } catch {}
          setObsidianConfig('installed', 'true')
        }
        controller.close()
        return
      }
      if (value && decoder.decode(value, { stream: true }).includes('"type":"error"')) {
        hadError = true
      }
      controller.enqueue(value)
    },
  })
}

/** Install only headless deps (Xvfb, openbox, x11vnc, websockify) + systemd services when Obsidian is already installed */
export function installHeadlessDeps(locale: string = 'zh-TW'): ReadableStream<Uint8Array> {
  const homeDir = os.homedir()
  const unitDir = path.join(homeDir, '.config/systemd/user')

  let vncPassword = getObsidianConfig('vnc_password')
  if (!vncPassword) {
    vncPassword = generatePassword(16)
    setObsidianConfig('vnc_password', vncPassword)
  }

  const passwdFile = path.join(homeDir, '.vnc/passwd-obsidian')

  fs.mkdirSync(unitDir, { recursive: true })
  fs.mkdirSync(path.join(homeDir, '.vnc'), { recursive: true })

  writeOpenboxConfig()
  writeHeadlessUnits(unitDir, locale)

  const commands = [
    { label: 'Installing Xvfb, openbox, x11vnc, websockify and dependencies', cmd: 'sudo', args: ['apt', 'install', '-y', 'xvfb', 'openbox', 'x11vnc', 'websockify', 'novnc', 'xdg-utils', 'libnotify4', 'libnss3', 'libsecret-1-0'] },
    { label: 'Reloading systemd user daemon', cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
    { label: 'Enabling and starting Xvfb', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'xvfb.service'] },
    { label: 'Enabling and starting Openbox', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'openbox.service'] },
    { label: 'Setting VNC password', cmd: 'x11vnc', args: ['-storepasswd', vncPassword, passwdFile] },
    { label: 'Enabling and starting x11vnc', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'x11vnc.service'] },
    { label: 'Enabling and starting websockify', cmd: 'systemctl', args: ['--user', 'enable', '--now', 'websockify.service'] },
    { label: 'Enabling login linger', cmd: 'sudo', args: ['loginctl', 'enable-linger', os.userInfo().username] },
  ]

  const stream = createSSEStream(commands)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let hadError = false
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        if (!hadError) {
          registerObsidianVault(resolveHome(getObsidianConfig('vault_path')))
          try { execFileSync('systemctl', ['--user', 'restart', 'obsidian-headless.service'], { timeout: 10000 }) } catch {}
          setObsidianConfig('installed', 'true')
        }
        controller.close()
        return
      }
      if (value && decoder.decode(value, { stream: true }).includes('"type":"error"')) {
        hadError = true
      }
      controller.enqueue(value)
    },
  })
}

/** Ensure openbox service and config exist for existing installations that predate the openbox integration */
export function ensureOpenboxSetup(): boolean {
  const homeDir = os.homedir()
  const unitDir = path.join(homeDir, '.config/systemd/user')
  const openboxServicePath = path.join(unitDir, 'openbox.service')
  const openboxConfigPath = path.join(homeDir, '.config/openbox/rc.xml')

  let changed = false

  if (!fs.existsSync(openboxConfigPath)) {
    writeOpenboxConfig()
    changed = true
  }

  if (!fs.existsSync(openboxServicePath)) {
    const display = getObsidianConfig('display')
    const openboxUnit = `[Unit]
Description=Openbox window manager
After=xvfb.service

[Service]
Type=simple
Environment=DISPLAY=${display}
ExecStart=/usr/bin/openbox --config-file ${homeDir}/.config/openbox/rc.xml
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`
    fs.mkdirSync(unitDir, { recursive: true })
    fs.writeFileSync(openboxServicePath, openboxUnit)
    changed = true
  }

  // Also update obsidian-headless.service to depend on openbox instead of xvfb
  const obsidianServicePath = path.join(unitDir, 'obsidian-headless.service')
  if (fs.existsSync(obsidianServicePath)) {
    const content = fs.readFileSync(obsidianServicePath, 'utf8')
    if (content.includes('After=xvfb.service') && !content.includes('After=openbox.service')) {
      fs.writeFileSync(obsidianServicePath, content.replace('After=xvfb.service', 'After=openbox.service'))
      changed = true
    }
  }

  if (changed) {
    try { execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 5000 }) } catch {}
  }

  return changed
}

/** Update the --lang flag of the Obsidian systemd unit and restart it.
 *  Best-effort: no-ops if the unit doesn't exist yet. */
export function setObsidianLocale(locale: string): { updated: boolean } {
  if (!/^[a-zA-Z-]{2,10}$/.test(locale)) {
    throw new Error('Invalid locale')
  }
  const unitPath = path.join(os.homedir(), '.config/systemd/user/obsidian-headless.service')
  if (!fs.existsSync(unitPath)) return { updated: false }

  const current = fs.readFileSync(unitPath, 'utf8')
  const updated = current.includes('--lang=')
    ? current.replace(/--lang=[a-zA-Z-]+/, `--lang=${locale}`)
    : current.replace(
        /(ExecStart=obsidian [^\n]*)/,
        (m) => `${m} --lang=${locale}`,
      )

  if (updated === current) return { updated: false }

  fs.writeFileSync(unitPath, updated, 'utf8')
  try { execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 }) } catch {}
  try { execFileSync('systemctl', ['--user', 'restart', 'obsidian-headless.service'], { timeout: 15000 }) } catch {}
  return { updated: true }
}

/** Register a vault path in ~/.config/obsidian/obsidian.json so Obsidian opens it on launch */
export function registerObsidianVault(vaultPath: string): void {
  const configPath = path.join(os.homedir(), '.config/obsidian/obsidian.json')
  let config: { vaults: Record<string, { path: string; ts: number; open: boolean }> } = { vaults: {} }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    config = JSON.parse(raw)
  } catch {}

  // Check if vault already registered
  const alreadyRegistered = Object.values(config.vaults).some(v => v.path === vaultPath)
  if (alreadyRegistered) return

  // Generate a random 16-char hex id (same format Obsidian uses)
  const id = crypto.randomBytes(8).toString('hex')
  config.vaults[id] = { path: vaultPath, ts: Date.now(), open: true }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  // Ensure vault directory exists
  fs.mkdirSync(vaultPath, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8')
}

function waitForCouchDB(url: string, user: string, password: string, maxRetries = 30): void {
  for (let i = 0; i < maxRetries; i++) {
    try {
      execFileSync('curl', ['-sf', '-u', `${user}:${password}`, `${url}/_up`], { timeout: 5000 })
      return
    } catch {
      execFileSync('sleep', ['2'], { timeout: 5000 })
    }
  }
}

export function uninstallObsidian(deleteData = false): ReadableStream<Uint8Array> {
  const homeDir = os.homedir()
  const unitDir = path.join(homeDir, '.config/systemd/user')
  const couchdbMethod = getObsidianConfig('couchdb_install_method')
  const dataDir = resolveHome(getObsidianConfig('couchdb_data_dir'))
  const etcDir = path.resolve(`${dataDir}/../couchdb-etc`)

  const commands: { label: string; cmd: string; args: string[]; optional?: boolean }[] = [
    { label: 'Stopping websockify', cmd: 'systemctl', args: ['--user', 'stop', 'websockify.service'] },
    { label: 'Stopping x11vnc', cmd: 'systemctl', args: ['--user', 'stop', 'x11vnc.service'] },
    { label: 'Stopping Obsidian', cmd: 'systemctl', args: ['--user', 'stop', 'obsidian-headless.service'] },
    { label: 'Stopping Openbox', cmd: 'systemctl', args: ['--user', 'stop', 'openbox.service'], optional: true },
    { label: 'Stopping Xvfb', cmd: 'systemctl', args: ['--user', 'stop', 'xvfb.service'] },
    { label: 'Disabling websockify', cmd: 'systemctl', args: ['--user', 'disable', 'websockify.service'] },
    { label: 'Disabling x11vnc', cmd: 'systemctl', args: ['--user', 'disable', 'x11vnc.service'] },
    { label: 'Disabling Obsidian', cmd: 'systemctl', args: ['--user', 'disable', 'obsidian-headless.service'] },
    { label: 'Disabling Openbox', cmd: 'systemctl', args: ['--user', 'disable', 'openbox.service'], optional: true },
    { label: 'Disabling Xvfb', cmd: 'systemctl', args: ['--user', 'disable', 'xvfb.service'] },
  ]

  if (couchdbMethod === 'docker') {
    commands.push(
      { label: 'Stopping CouchDB container', cmd: 'sudo', args: ['docker', 'stop', 'couchdb-for-ols'], optional: true },
      { label: 'Removing CouchDB container', cmd: 'sudo', args: ['docker', 'rm', 'couchdb-for-ols'], optional: true },
    )
    if (deleteData) {
      commands.push(
        { label: 'Removing CouchDB data files', cmd: 'sudo', args: ['rm', '-rf', dataDir, etcDir] },
      )
    }
  } else if (couchdbMethod === 'apt') {
    commands.push(
      { label: 'Stopping CouchDB service', cmd: 'sudo', args: ['systemctl', 'stop', 'couchdb'], optional: true },
      { label: 'Removing CouchDB package', cmd: 'sudo', args: ['apt', 'remove', '-y', 'couchdb'] },
    )
    if (deleteData) {
      commands.push(
        { label: 'Removing CouchDB data files', cmd: 'sudo', args: ['rm', '-rf', '/var/lib/couchdb'] },
      )
    }
  }

  if (deleteData) {
    const obsidianConfigDir = path.join(homeDir, '.config/obsidian')
    const vncDir = path.join(homeDir, '.vnc')
    commands.push(
      { label: 'Removing Obsidian config', cmd: 'rm', args: ['-rf', obsidianConfigDir] },
      { label: 'Removing VNC password', cmd: 'rm', args: ['-rf', vncDir] },
    )
  }

  commands.push(
    { label: 'Removing Obsidian package', cmd: 'sudo', args: ['dpkg', '-r', 'obsidian'] },
    { label: 'Reloading systemd user daemon', cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
  )

  const stream = createSSEStream(commands)
  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        // Remove unit files after all commands have run
        const unitFiles = ['xvfb.service', 'openbox.service', 'obsidian-headless.service', 'x11vnc.service', 'websockify.service']
        for (const file of unitFiles) {
          try { fs.unlinkSync(path.join(unitDir, file)) } catch {}
        }
        setObsidianConfig('installed', 'false')
        setObsidianConfig('couchdb_installed', 'false')
        if (deleteData) {
          setObsidianConfig('vnc_password', '')
          setObsidianConfig('couchdb_password', '')
        }
        controller.close()
        return
      }
      controller.enqueue(value)
    },
  })
}

export function uninstallCouchDB(deleteData = false): ReadableStream<Uint8Array> {
  const couchdbMethod = getObsidianConfig('couchdb_install_method')
  const dataDir = resolveHome(getObsidianConfig('couchdb_data_dir'))
  const etcDir = path.resolve(`${dataDir}/../couchdb-etc`)

  const commands: { label: string; cmd: string; args: string[] }[] = []

  if (couchdbMethod === 'docker') {
    commands.push(
      { label: 'Stopping CouchDB container', cmd: 'sudo', args: ['docker', 'stop', 'couchdb-for-ols'] },
      { label: 'Removing CouchDB container', cmd: 'sudo', args: ['docker', 'rm', 'couchdb-for-ols'] },
    )
    if (deleteData) {
      commands.push(
        { label: 'Removing CouchDB data files', cmd: 'sudo', args: ['rm', '-rf', dataDir, etcDir] },
      )
    }
  } else if (couchdbMethod === 'apt') {
    commands.push(
      { label: 'Stopping CouchDB service', cmd: 'sudo', args: ['systemctl', 'stop', 'couchdb'] },
      { label: 'Removing CouchDB package', cmd: 'sudo', args: ['apt', 'remove', '-y', 'couchdb'] },
    )
    if (deleteData) {
      commands.push(
        { label: 'Removing CouchDB data files', cmd: 'sudo', args: ['rm', '-rf', '/var/lib/couchdb'] },
      )
    }
  }

  const stream = createSSEStream(commands)
  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        setObsidianConfig('couchdb_installed', 'false')
        controller.close()
        return
      }
      controller.enqueue(value)
    },
  })
}

/** Update LiveSync plugin data.json with current CouchDB credentials and E2EE settings if plugin exists */
function updateLiveSyncConfig(couchdbUrl: string, user: string, password: string, database: string): void {
  const vaultPath = resolveHome(getObsidianConfig('vault_path'))
  const dataPath = path.join(vaultPath, '.obsidian', 'plugins', 'obsidian-livesync', 'data.json')

  try {
    if (!fs.existsSync(dataPath)) return
    const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    existing.couchDB_URI = couchdbUrl
    existing.couchDB_USER = user
    existing.couchDB_PASSWORD = password
    existing.couchDB_DBNAME = database

    // Sync E2EE settings from config
    const e2eeEnabled = getObsidianConfig('e2ee_enabled')
    const passphrase = getObsidianConfig('e2ee_passphrase')
    const pathObfuscation = getObsidianConfig('e2ee_path_obfuscation')
    if (e2eeEnabled) {
      existing.encrypt = e2eeEnabled === 'true'
      existing.passphrase = e2eeEnabled === 'true' ? passphrase : (existing.passphrase ?? '')
      existing.permitEmptyPassphrase = false
      existing.E2EEAlgorithm = existing.E2EEAlgorithm || 'v2'
    }
    if (pathObfuscation) {
      existing.usePathObfuscation = pathObfuscation === 'true'
    }

    fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2))
  } catch {}
}

/** Build the couchdb-init.sh equivalent commands (from obsidian-livesync official setup) */
function buildCouchDBInitCommands(couchdbUrl: string, user: string, password: string): { label: string; cmd: string; args: string[] }[] {
  const node = '_local'
  const auth = `${user}:${password}`

  return [
    // Single node setup
    { label: 'Configuring single node setup', cmd: 'curl', args: ['-sf', '-X', 'POST', `${couchdbUrl}/_cluster_setup`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ action: 'enable_single_node', username: user, password, bind_address: '0.0.0.0', port: 5984, singlenode: true }), '-u', auth] },
    // Require valid user
    { label: 'Setting require_valid_user (chttpd)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/chttpd/require_valid_user`, '-H', 'Content-Type: application/json', '-d', '"true"', '-u', auth] },
    { label: 'Setting require_valid_user (chttpd_auth)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/chttpd_auth/require_valid_user`, '-H', 'Content-Type: application/json', '-d', '"true"', '-u', auth] },
    // HTTP auth
    { label: 'Setting WWW-Authenticate header', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/httpd/WWW-Authenticate`, '-H', 'Content-Type: application/json', '-d', '"Basic realm=\\"couchdb\\""', '-u', auth] },
    // Enable CORS
    { label: 'Enabling CORS (httpd)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/httpd/enable_cors`, '-H', 'Content-Type: application/json', '-d', '"true"', '-u', auth] },
    { label: 'Enabling CORS (chttpd)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/chttpd/enable_cors`, '-H', 'Content-Type: application/json', '-d', '"true"', '-u', auth] },
    // Max sizes for LiveSync
    { label: 'Setting max_http_request_size (4GB)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/chttpd/max_http_request_size`, '-H', 'Content-Type: application/json', '-d', '"4294967296"', '-u', auth] },
    { label: 'Setting max_document_size (50MB)', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/couchdb/max_document_size`, '-H', 'Content-Type: application/json', '-d', '"50000000"', '-u', auth] },
    // CORS credentials & origins
    { label: 'Enabling CORS credentials', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/cors/credentials`, '-H', 'Content-Type: application/json', '-d', '"true"', '-u', auth] },
    { label: 'Setting CORS origins', cmd: 'curl', args: ['-sf', '-X', 'PUT', `${couchdbUrl}/_node/${node}/_config/cors/origins`, '-H', 'Content-Type: application/json', '-d', '"app://obsidian.md,capacitor://localhost,http://localhost"', '-u', auth] },
  ]
}

export function installCouchDB(method: 'docker' | 'apt'): ReadableStream<Uint8Array> {
  const user = getObsidianConfig('couchdb_user')
  let password = getObsidianConfig('couchdb_password')
  if (!password) {
    password = generatePassword()
    setObsidianConfig('couchdb_password', password)
  }
  const database = getObsidianConfig('couchdb_database')
  const couchdbUrl = getObsidianConfig('couchdb_url')
  const dataDir = resolveHome(getObsidianConfig('couchdb_data_dir'))
  const etcDir = `${dataDir}/../couchdb-etc`
  const tmpDir = os.tmpdir()

  // Validate URL format to prevent injection
  try { new URL(couchdbUrl) } catch { throw new Error('Invalid CouchDB URL') }

  // LiveSync requirement: lowercase letters, digits, underscore only; cannot start with _
  if (!/^[a-z][a-z0-9_]*$/.test(database)) {
    throw new Error('Invalid database name: use only lowercase letters, digits, and underscores; cannot start with _')
  }

  // Ensure data and config directories exist
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.resolve(etcDir), { recursive: true })

  const currentUser = os.userInfo().username
  const containerName = 'couchdb-for-ols'

  const commands: { label: string; cmd: string; args: string[]; optional?: boolean }[] = method === 'docker'
    ? [
        { label: 'Adding user to docker group', cmd: 'sudo', args: ['usermod', '-aG', 'docker', currentUser] },
        { label: 'Removing existing container (if any)', cmd: 'sudo', args: ['docker', 'rm', '-f', containerName], optional: true },
        { label: 'Removing legacy couchdb container (if any)', cmd: 'sudo', args: ['docker', 'rm', '-f', 'couchdb'], optional: true },
        { label: 'Pulling CouchDB Docker image', cmd: 'sudo', args: ['docker', 'pull', 'couchdb:latest'] },
        { label: 'Starting CouchDB container', cmd: 'sudo', args: [
          'docker', 'run', '-d',
          '--name', containerName,
          '-e', `COUCHDB_USER=${user}`,
          '-e', `COUCHDB_PASSWORD=${password}`,
          '-v', `${dataDir}:/opt/couchdb/data`,
          '-v', `${path.resolve(etcDir)}:/opt/couchdb/etc/local.d`,
          '-p', '5984:5984',
          '--restart', 'unless-stopped',
          'couchdb:latest',
        ] },
      ]
    : [
        { label: 'Downloading CouchDB repository key', cmd: 'curl', args: ['-sfo', path.join(tmpDir, 'couchdb-keys.asc'), 'https://couchdb.apache.org/repo/keys.asc'] },
        { label: 'Dearmoring GPG key', cmd: 'gpg', args: ['--dearmor', '-o', path.join(tmpDir, 'couchdb-archive-keyring.gpg'), path.join(tmpDir, 'couchdb-keys.asc')] },
        { label: 'Installing GPG key', cmd: 'sudo', args: ['cp', path.join(tmpDir, 'couchdb-archive-keyring.gpg'), '/usr/share/keyrings/couchdb-archive-keyring.gpg'] },
        { label: 'Updating apt repositories', cmd: 'sudo', args: ['apt', 'update'] },
        { label: 'Installing CouchDB', cmd: 'sudo', args: ['apt', 'install', '-y', 'couchdb'] },
      ]

  // For apt method, write the sources list file before running commands
  if (method === 'apt') {
    fs.writeFileSync(
      path.join(tmpDir, 'couchdb.list'),
      'deb [signed-by=/usr/share/keyrings/couchdb-archive-keyring.gpg] https://apache.jfrog.io/artifactory/couchdb-deb/ jammy main\n'
    )
    commands.splice(3, 0, {
      label: 'Adding CouchDB apt repository',
      cmd: 'sudo',
      args: ['cp', path.join(tmpDir, 'couchdb.list'), '/etc/apt/sources.list.d/couchdb.list'],
    })
  }

  const encoder = new TextEncoder()
  const stream = createSSEStream(commands)
  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        // Wait for CouchDB to be ready after install
        controller.enqueue(encoder.encode(sseEncode({ type: 'progress', data: 'Waiting for CouchDB to be ready...' })))
        try {
          waitForCouchDB(couchdbUrl, user, password)
          controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: 'CouchDB is ready' })))
        } catch {
          controller.enqueue(encoder.encode(sseEncode({ type: 'error', data: 'CouchDB readiness check timed out' })))
          controller.close()
          return
        }

        // Run couchdb-init.sh equivalent configuration (from obsidian-livesync official setup)
        const initCommands = buildCouchDBInitCommands(couchdbUrl, user, password)
        for (const { label, cmd, args } of initCommands) {
          controller.enqueue(encoder.encode(sseEncode({ type: 'progress', data: label })))
          try {
            execFileSync(cmd, args, { timeout: 15000, env: { ...process.env } })
            controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: `✓ ${label}` })))
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: `⚠ ${label}: ${message}` })))
          }
        }

        // Create the LiveSync database (ignore if already exists)
        controller.enqueue(encoder.encode(sseEncode({ type: 'progress', data: `Creating database: ${database}` })))
        try {
          const result = execFileSync('curl', ['-s', '-X', 'PUT', `${couchdbUrl}/${database}`, '-u', `${user}:${password}`], { timeout: 10000, encoding: 'utf8' })
          if (result.includes('"ok":true') || result.includes('file_exists')) {
            const msg = result.includes('file_exists') ? `✓ Database "${database}" already exists` : `✓ Database "${database}" created`
            controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: msg })))
          } else {
            controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: `⚠ Database creation: ${result}` })))
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          controller.enqueue(encoder.encode(sseEncode({ type: 'log', data: `⚠ Database creation: ${message}` })))
        }

        // Update LiveSync plugin config if it exists in the vault
        updateLiveSyncConfig(couchdbUrl, user, password, database)

        setObsidianConfig('couchdb_installed', 'true')
        setObsidianConfig('couchdb_install_method', method)
        controller.enqueue(encoder.encode(sseEncode({ type: 'done', data: 'Installation complete' })))
        controller.close()
        return
      }
      controller.enqueue(value)
    },
  })
}
