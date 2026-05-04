// src/lib/headless-vnc/installer.ts
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import type { SSECommand } from './sse-stream'

const HEADLESS_PACKAGES = ['xvfb', 'openbox', 'x11vnc', 'websockify', 'novnc']
const INPUT_METHOD_PACKAGES = ['fcitx5', 'fcitx5-chewing']

export function installHeadlessDepsCommands(): SSECommand[] {
  return [{
    label: 'Install headless display packages',
    cmd: 'sudo',
    args: ['apt-get', 'install', '-y', ...HEADLESS_PACKAGES],
  }]
}

export function installInputMethodCommands(): SSECommand[] {
  return [{
    label: 'Install input method (fcitx5 + chewing)',
    cmd: 'sudo',
    args: ['apt-get', 'install', '-y', ...INPUT_METHOD_PACKAGES],
  }]
}

export function enableAndStartCommands(unitNames: string[]): SSECommand[] {
  return unitNames.map(unit => ({
    label: `Enable and start ${unit}`,
    cmd: 'systemctl',
    args: ['--user', 'enable', '--now', unit],
  }))
}

export function stopAndDisableCommands(unitNames: string[]): SSECommand[] {
  return [...unitNames].reverse().map(unit => ({
    label: `Stop and disable ${unit}`,
    cmd: 'systemctl',
    args: ['--user', 'disable', '--now', unit],
    optional: true,
  }))
}

export function enableLingerCommand(): SSECommand {
  const user = os.userInfo().username
  return {
    label: 'Enable loginctl linger',
    cmd: 'loginctl',
    args: ['enable-linger', user],
    optional: true,
  }
}

export function migrateUnprefixedUnits(oldUnitNames: string[]): SSECommand[] {
  const commands: SSECommand[] = []
  const unitDir = join(os.homedir(), '.config', 'systemd', 'user')

  for (const oldUnit of oldUnitNames) {
    const oldPath = join(unitDir, oldUnit)
    if (existsSync(oldPath)) {
      commands.push({
        label: `Stop and disable old ${oldUnit}`,
        cmd: 'systemctl',
        args: ['--user', 'disable', '--now', oldUnit],
        optional: true,
      })
    }
  }

  return commands
}

export function reloadSystemdCommand(): SSECommand {
  return {
    label: 'Reload systemd user daemon',
    cmd: 'systemctl',
    args: ['--user', 'daemon-reload'],
  }
}

export function setVncPassword(password: string, passwordFile: string): void {
  const dir = join(passwordFile, '..')
  mkdirSync(dir, { recursive: true })
  execFileSync('x11vnc', ['-storepasswd', password, passwordFile], { timeout: 10000 })
}

export function hasVncPassword(passwordFile: string): boolean {
  return existsSync(passwordFile)
}

/**
 * Ensure fcitx5 profile exists with chewing input method configured.
 * Without this profile, fcitx5 only has keyboard-us and Ctrl+Space won't toggle Chinese input.
 */
export function ensureFcitx5Profile(): void {
  const profilePath = join(os.homedir(), '.config', 'fcitx5', 'profile')

  // Don't overwrite if user already has a profile
  if (existsSync(profilePath)) return

  const profileDir = join(os.homedir(), '.config', 'fcitx5')
  mkdirSync(profileDir, { recursive: true })

  const profile = `[Groups/0]
Name=Default
Default Layout=us
DefaultIM=keyboard-us

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=chewing
Layout=

[GroupOrder]
0=Default
`
  writeFileSync(profilePath, profile)
}
