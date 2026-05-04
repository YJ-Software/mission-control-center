import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createSSEStream,
  SSECommand,
  InstallEvent,
  writeSystemdUnits,
  removeSystemdUnits,
  VncStackConfig,
  installHeadlessDepsCommands,
  installInputMethodCommands,
  allHeadlessDepsInstalled,
  allInputMethodInstalled,
  setVncPassword,
  getUnitNames,
  stopAndDisableCommands,
  ensureFcitx5Profile,
} from '@/lib/headless-vnc'
import { generatePassword } from '@/lib/headless-vnc'
import {
  getBrowserConfig,
  setBrowserConfig,
  getChromeBinaryPath,
  detectComponents,
} from './config'
import { getServerEnv } from '@/lib/server-env'

function getChromeUserDataDir(): string {
  return path.join(os.homedir(), '.config', 'chrome-headless-data')
}

function getOpencliExtensionDir(): string {
  return path.join(os.homedir(), '.opencli', 'extension')
}

export function getOpencliExtensionSymlink(): string {
  return path.join(os.homedir(), 'OpenCLI-Extension')
}

function isOpencliExtensionInstalled(): boolean {
  return fs.existsSync(path.join(getOpencliExtensionDir(), 'manifest.json'))
}

function isOpencliInstalled(): boolean {
  try {
    execFileSync('which', ['opencli'], { encoding: 'utf8', timeout: 5000, env: getServerEnv() })
    return true
  } catch { return false }
}

const CHROME_ARGS = [
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-logging',
  '--v=1',
]

function getVncPasswordFile(): string {
  return path.join(os.homedir(), '.vnc', 'passwd-chrome')
}

function buildChromeCommand(): string {
  const chromeBin = getChromeBinaryPath() || 'chromium-browser'
  const cdpPort = getBrowserConfig('cdp_port') || '9222'
  const args = [
    ...CHROME_ARGS,
    `--user-data-dir=${getChromeUserDataDir()}`,
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
  ]
  // Chrome refuses to run as root unless sandbox is disabled.
  // Keep sandbox on for non-root installs (avoids Chrome's security warning bar).
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.unshift('--no-sandbox')
  }
  // Note: --load-extension is not supported in Google Chrome (only Chromium).
  // For Google Chrome, users must manually load the extension via chrome://extensions.
  const chromeBinLower = chromeBin.toLowerCase()
  const isChromium = chromeBinLower.includes('chromium')
  if (isChromium && isOpencliExtensionInstalled()) {
    args.push(`--load-extension=${getOpencliExtensionDir()}`)
  }
  return `${chromeBin} ${args.join(' ')}`
}

function hasInputMethod(): boolean {
  return allInputMethodInstalled()
}

export function buildVncStackConfig(): VncStackConfig {
  return {
    prefix: 'chrome',
    display: getBrowserConfig('display'),
    resolution: getBrowserConfig('resolution'),
    vncPort: parseInt(getBrowserConfig('vnc_port'), 10),
    websockifyPort: parseInt(getBrowserConfig('websockify_port'), 10),
    vncPasswordFile: getVncPasswordFile(),
    appCommand: buildChromeCommand(),
    appDescription: 'Headless Chrome browser',
    inputMethod: hasInputMethod(),
  }
}

function isPortInUse(port: number): boolean {
  try {
    const output = execFileSync('ss', ['-tlnH', `sport = :${port}`], { encoding: 'utf8', timeout: 3000 })
    return output.trim().length > 0
  } catch {
    return false
  }
}

/** Check port, auto-increment if in use, update DB, return resolved port */
function resolvePort(port: number, configKey: string, label: string, enqueue: (event: InstallEvent) => void): number {
  if (!isPortInUse(port)) return port

  // Try incrementing by 1 up to 10 times
  for (let offset = 1; offset <= 10; offset++) {
    const candidate = port + offset
    if (!isPortInUse(candidate)) {
      enqueue({ type: 'log', data: `⚠ Port ${port} (${label}) in use, switching to ${candidate}` })
      setBrowserConfig(configKey, String(candidate))
      return candidate
    }
  }

  enqueue({ type: 'log', data: `⚠ Port ${port} (${label}) in use, could not find free port nearby` })
  return port
}

export function installChrome(): ReadableStream<Uint8Array> {
  const chromeBin = getChromeBinaryPath()
  const headlessDepsInstalled = allHeadlessDepsInstalled()
  const imInstalled = allInputMethodInstalled()

  const commands: SSECommand[] = []

  // Install Chrome if not present.
  // On Ubuntu, `apt-get install chromium-browser` pulls the snap-wrapped build whose
  // confinement blocks --remote-debugging-port and custom --user-data-dir paths, so
  // prefer Google Chrome from the official apt repo on amd64.
  if (!chromeBin) {
    if (os.arch() === 'x64') {
      commands.push({
        label: 'Adding Google Chrome apt signing key',
        cmd: 'bash',
        args: ['-c', 'curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor --yes -o /etc/apt/trusted.gpg.d/google-chrome.gpg'],
      })
      commands.push({
        label: 'Adding Google Chrome apt repository',
        cmd: 'bash',
        args: ['-c', 'echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list > /dev/null'],
      })
      commands.push({
        label: 'Updating apt index',
        cmd: 'sudo',
        args: ['apt-get', 'update'],
      })
      commands.push({
        label: 'Installing Google Chrome',
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'google-chrome-stable'],
      })
    } else {
      // arm64 fallback: Google Chrome is not published for arm64, so use chromium
      commands.push({
        label: 'Installing Chromium browser (arm64 fallback)',
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'chromium-browser'],
      })
    }
  }

  // Install headless deps if missing
  if (!headlessDepsInstalled) {
    commands.push(...installHeadlessDepsCommands())
  }

  // Install input method if missing
  if (!imInstalled) {
    commands.push(...installInputMethodCommands())
  }

  // Install opencli if not present
  if (!isOpencliInstalled()) {
    commands.push({
      label: 'Installing opencli (browser automation CLI)',
      cmd: 'npm',
      args: ['install', '-g', '@jackwener/opencli'],
    })
  }

  return createSSEStream(commands, {
    onBefore(enqueue) {
      const detected = detectComponents()
      enqueue({ type: 'log', data: `Chrome detected: ${detected.chrome}` })
      enqueue({ type: 'log', data: `Headless deps installed: ${headlessDepsInstalled}` })
      enqueue({ type: 'log', data: `Input method installed: ${imInstalled}` })
      enqueue({ type: 'log', data: `OpenCLI installed: ${isOpencliInstalled()}` })

      // Resolve port conflicts — auto-increment if occupied
      const vncPort = parseInt(getBrowserConfig('vnc_port'), 10)
      const wsPort = parseInt(getBrowserConfig('websockify_port'), 10)
      resolvePort(vncPort, 'vnc_port', 'VNC', enqueue)
      resolvePort(wsPort, 'websockify_port', 'websockify', enqueue)
    },
    onAfter(enqueue) {
      // Set VNC password
      let vncPassword = getBrowserConfig('vnc_password')
      if (!vncPassword) {
        vncPassword = generatePassword(16)
        setBrowserConfig('vnc_password', vncPassword)
      }
      const passwdFile = getVncPasswordFile()
      enqueue({ type: 'progress', data: 'Setting VNC password...' })
      try {
        setVncPassword(vncPassword, passwdFile)
        enqueue({ type: 'log', data: 'VNC password set' })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        enqueue({ type: 'log', data: `Warning: could not set VNC password: ${msg}` })
      }

      // Ensure GTK file picker shows hidden files (needed for extension loading)
      ensureGtkShowHidden()

      // Write systemd units
      enqueue({ type: 'progress', data: 'Writing systemd unit files...' })
      const config = buildVncStackConfig()
      const written = writeSystemdUnits(config)
      enqueue({ type: 'log', data: `Wrote ${written.length} unit files` })

      // Run opencli post-install steps (extension, daemon unit, start daemon)
      if (isOpencliInstalled()) {
        setupOpencliPostInstall(enqueue)
      }

      // Ensure fcitx5 profile with chewing input method
      if (hasInputMethod()) {
        enqueue({ type: 'progress', data: 'Configuring fcitx5 input method profile...' })
        ensureFcitx5Profile()
        enqueue({ type: 'log', data: 'Fcitx5 profile configured (keyboard-us + chewing)' })
      }

      // Reload, enable, start VNC units
      enqueue({ type: 'progress', data: 'Reloading systemd daemon...' })
      try {
        execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 })
      } catch {
        // non-fatal
      }

      const unitNames = getUnitNames('chrome', { inputMethod: hasInputMethod() })
      for (const unit of unitNames) {
        enqueue({ type: 'progress', data: `Enabling and starting ${unit}...` })
        try {
          execFileSync('systemctl', ['--user', 'enable', '--now', unit], { timeout: 15000 })
          enqueue({ type: 'log', data: `Started ${unit}` })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          enqueue({ type: 'log', data: `Warning: failed to start ${unit}: ${msg}` })
        }
      }

      // Enable linger
      try {
        const user = os.userInfo().username
        execFileSync('loginctl', ['enable-linger', user], { timeout: 10000 })
      } catch {
        // optional
      }

      // Update DB
      setBrowserConfig('installed', 'true')
    },
  })
}

/** Ensure GTK file picker shows hidden files by default */
function ensureGtkShowHidden(): void {
  const gtkDir = path.join(os.homedir(), '.config', 'gtk-3.0')
  const settingsPath = path.join(gtkDir, 'settings.ini')
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8')
      if (content.includes('gtk-show-hidden')) return // already configured
      fs.appendFileSync(settingsPath, '\ngtk-show-hidden=true\n')
    } else {
      fs.mkdirSync(gtkDir, { recursive: true })
      fs.writeFileSync(settingsPath, '[Settings]\ngtk-show-hidden=true\n')
    }
  } catch { /* non-fatal */ }
}

/** Download opencli extension from GitHub releases and extract to ~/.opencli/extension/ */
export function resolveOpencliExtensionAssetUrl(): string {
  // GitHub asset names include the extension version (e.g. opencli-extension-v1.0.0.zip),
  // so query the releases API to find the current matching asset.
  const apiJson = execFileSync('curl', ['-fsSL',
    'https://api.github.com/repos/jackwener/opencli/releases/latest',
  ], { encoding: 'utf8', timeout: 30000 })
  const release = JSON.parse(apiJson) as { assets?: { name: string; browser_download_url: string }[] }
  const asset = release.assets?.find(a => /^opencli-extension.*\.zip$/i.test(a.name))
  if (!asset?.browser_download_url) {
    throw new Error('No opencli-extension*.zip asset found in latest release')
  }
  return asset.browser_download_url
}

function installOpencliExtension(): void {
  const extDir = getOpencliExtensionDir()
  const zipPath = path.join(os.tmpdir(), 'opencli-extension.zip')

  const assetUrl = resolveOpencliExtensionAssetUrl()
  execFileSync('curl', ['-fsSL', '-o', zipPath, assetUrl], { timeout: 60000 })

  // Extract
  fs.mkdirSync(extDir, { recursive: true })
  execFileSync('unzip', ['-o', zipPath, '-d', extDir], { timeout: 30000 })

  // Cleanup
  try { fs.unlinkSync(zipPath) } catch { /* ignore */ }

  // Create visible symlink in home directory for easy access in file picker
  // (hidden dirs like .opencli are invisible in Chrome's file dialog)
  const symlink = getOpencliExtensionSymlink()
  try {
    if (fs.existsSync(symlink)) fs.unlinkSync(symlink)
    fs.symlinkSync(extDir, symlink)
  } catch { /* non-fatal */ }
}

/** Run all opencli post-install steps: extension download, daemon unit, start services */
export function setupOpencliPostInstall(enqueue: (event: InstallEvent) => void): void {
  // Download and install extension
  if (!isOpencliExtensionInstalled()) {
    enqueue({ type: 'progress', data: 'Downloading opencli Chrome extension...' })
    try {
      installOpencliExtension()
      enqueue({ type: 'log', data: 'OpenCLI extension installed' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      enqueue({ type: 'log', data: `Warning: opencli extension install failed: ${msg}` })
    }
  }

  // Write daemon systemd unit
  enqueue({ type: 'progress', data: 'Writing opencli daemon unit...' })
  writeOpencliDaemonUnit()
  enqueue({ type: 'log', data: 'opencli-daemon.service written' })

  // Reload systemd
  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 })
  } catch { /* non-fatal */ }

  // Enable and start daemon
  enqueue({ type: 'progress', data: 'Starting opencli daemon...' })
  try {
    execFileSync('systemctl', ['--user', 'enable', '--now', 'opencli-daemon.service'], { timeout: 15000 })
    enqueue({ type: 'log', data: 'Started opencli-daemon.service' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    enqueue({ type: 'log', data: `Warning: failed to start opencli daemon: ${msg}` })
  }

  // Install opencli skills for all available agents (non-interactive)
  enqueue({ type: 'progress', data: 'Installing opencli skills for all agents...' })
  try {
    const output = execFileSync(
      'npx',
      ['-y', 'skills', 'add', 'jackwener/opencli', '--all', '-g'],
      { encoding: 'utf8', timeout: 180000, env: getServerEnv() },
    )
    enqueue({ type: 'log', data: 'OpenCLI skills installed' })
    const tail = output.trim().split('\n').slice(-3).join(' | ')
    if (tail) enqueue({ type: 'log', data: tail })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    enqueue({ type: 'log', data: `Warning: failed to install opencli skills: ${msg}` })
  }

  // Restart chrome-headless to load extension (Chromium only)
  const chromeBin = getChromeBinaryPath() || ''
  if (chromeBin.toLowerCase().includes('chromium') && isOpencliExtensionInstalled()) {
    enqueue({ type: 'progress', data: 'Restarting Chrome to load extension...' })
    try {
      execFileSync('systemctl', ['--user', 'restart', 'chrome-headless.service'], { timeout: 15000 })
      enqueue({ type: 'log', data: 'Chrome restarted with extension' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      enqueue({ type: 'log', data: `Warning: failed to restart Chrome: ${msg}` })
    }
  }
}

/** Write systemd unit for opencli daemon */
function writeOpencliDaemonUnit(): void {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user')
  fs.mkdirSync(unitDir, { recursive: true })

  // Find opencli package dist directory to locate daemon.js
  let opencliPath = ''
  try {
    opencliPath = execFileSync('which', ['opencli'], {
      encoding: 'utf8', timeout: 5000, env: getServerEnv(),
    }).trim()
  } catch { /* ignore */ }

  // Resolve symlink to find the actual package directory
  let daemonJs = ''
  if (opencliPath) {
    try {
      const realPath = fs.realpathSync(opencliPath)
      const distDir = path.dirname(realPath)
      const candidate = path.join(distDir, 'daemon.js')
      if (fs.existsSync(candidate)) {
        daemonJs = candidate
      }
    } catch { /* ignore */ }
  }

  // Fallback: try common npm global paths
  if (!daemonJs) {
    const candidates = [
      path.join(os.homedir(), '.npm-global/lib/node_modules/@jackwener/opencli/dist/daemon.js'),
      '/usr/lib/node_modules/@jackwener/opencli/dist/daemon.js',
      '/usr/local/lib/node_modules/@jackwener/opencli/dist/daemon.js',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) { daemonJs = c; break }
    }
  }

  if (!daemonJs) return // Can't find daemon, skip

  const unit = `[Unit]
Description=OpenCLI daemon (browser automation bridge)
After=chrome-headless.service

[Service]
Type=simple
ExecStart=/usr/bin/env node ${daemonJs}
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`

  fs.writeFileSync(path.join(unitDir, 'opencli-daemon.service'), unit)
}

export function installHeadlessDepsOnly(): ReadableStream<Uint8Array> {
  const commands: SSECommand[] = [
    ...installHeadlessDepsCommands(),
    ...(!allInputMethodInstalled() ? installInputMethodCommands() : []),
  ]

  return createSSEStream(commands, {
    onAfter(enqueue) {
      // Set VNC password
      let vncPassword = getBrowserConfig('vnc_password')
      if (!vncPassword) {
        vncPassword = generatePassword(16)
        setBrowserConfig('vnc_password', vncPassword)
      }
      const passwdFile = getVncPasswordFile()
      enqueue({ type: 'progress', data: 'Setting VNC password...' })
      try {
        setVncPassword(vncPassword, passwdFile)
      } catch {
        // x11vnc may not be installed yet
      }

      // Write systemd units
      enqueue({ type: 'progress', data: 'Writing systemd unit files...' })
      const config = buildVncStackConfig()
      writeSystemdUnits(config)

      // Ensure fcitx5 profile
      if (hasInputMethod()) {
        ensureFcitx5Profile()
      }

      // Reload and start
      try {
        execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 })
      } catch {}

      const unitNames = getUnitNames('chrome', { inputMethod: hasInputMethod() })
      for (const unit of unitNames) {
        enqueue({ type: 'progress', data: `Enabling and starting ${unit}...` })
        try {
          execFileSync('systemctl', ['--user', 'enable', '--now', unit], { timeout: 15000 })
        } catch {}
      }

      try {
        const user = os.userInfo().username
        execFileSync('loginctl', ['enable-linger', user], { timeout: 10000 })
      } catch {}

      setBrowserConfig('installed', 'true')
    },
  })
}

/** Install opencli standalone (browser must already be installed) */
export function installOpencliOnly(): ReadableStream<Uint8Array> {
  const commands: SSECommand[] = [
    {
      label: 'Installing opencli (browser automation CLI)',
      cmd: 'npm',
      args: ['install', '-g', '@jackwener/opencli'],
    },
  ]

  return createSSEStream(commands, {
    onBefore(enqueue) {
      enqueue({ type: 'log', data: `OpenCLI installed: ${isOpencliInstalled()}` })
    },
    onAfter(enqueue) {
      setupOpencliPostInstall(enqueue)
    },
  })
}

export function uninstallChrome(deleteData = false): ReadableStream<Uint8Array> {
  const homeDir = os.homedir()
  const unitNames = getUnitNames('chrome', { inputMethod: hasInputMethod() })

  // Also stop opencli daemon if exists
  const opencliUnit = path.join(homeDir, '.config', 'systemd', 'user', 'opencli-daemon.service')
  if (fs.existsSync(opencliUnit)) {
    unitNames.push('opencli-daemon.service')
  }

  const commands: SSECommand[] = [
    ...stopAndDisableCommands(unitNames),
  ]

  return createSSEStream(commands, {
    onAfter(enqueue) {
      // Remove unit files
      enqueue({ type: 'progress', data: 'Removing systemd unit files...' })
      removeSystemdUnits('chrome')
      // Also remove opencli daemon unit
      try {
        if (fs.existsSync(opencliUnit)) {
          fs.unlinkSync(opencliUnit)
          enqueue({ type: 'log', data: 'opencli-daemon.service removed' })
        }
      } catch { /* ignore */ }
      enqueue({ type: 'log', data: 'Unit files removed' })

      // Remove VNC password file
      const passwdFile = getVncPasswordFile()
      try {
        if (fs.existsSync(passwdFile)) {
          fs.unlinkSync(passwdFile)
          enqueue({ type: 'log', data: 'VNC password file removed' })
        }
      } catch {}

      // Remove openbox config
      const openboxConfig = path.join(homeDir, '.config', 'openbox', 'rc-chrome.xml')
      try {
        if (fs.existsSync(openboxConfig)) {
          fs.unlinkSync(openboxConfig)
          enqueue({ type: 'log', data: 'Openbox config removed' })
        }
      } catch {}

      // Optionally delete Chrome user data
      if (deleteData) {
        const chromeDirs = [
          getChromeUserDataDir(),
          path.join(homeDir, '.config', 'google-chrome'),
          path.join(homeDir, '.config', 'chromium'),
        ]
        for (const dir of chromeDirs) {
          if (fs.existsSync(dir)) {
            enqueue({ type: 'progress', data: `Removing ${dir}...` })
            try {
              fs.rmSync(dir, { recursive: true, force: true })
              enqueue({ type: 'log', data: `Removed ${dir}` })
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              enqueue({ type: 'log', data: `Warning: could not remove ${dir}: ${msg}` })
            }
          }
        }
      }

      // Reload daemon
      try {
        execFileSync('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 })
      } catch {}

      // Reset DB flags
      setBrowserConfig('installed', 'false')
      if (deleteData) {
        setBrowserConfig('vnc_password', '')
      }
    },
  })
}
