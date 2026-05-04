// src/lib/headless-vnc/config.ts
import { execFileSync } from 'child_process'

function hasBinary(name: string): boolean {
  try {
    execFileSync('which', [name], { encoding: 'utf-8', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function hasSystemdUnit(unitName: string): boolean {
  try {
    const result = execFileSync('systemctl', ['--user', 'cat', unitName], {
      encoding: 'utf-8',
      timeout: 3000,
    })
    return result.length > 0
  } catch {
    return false
  }
}

export interface HeadlessDepsStatus {
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
}

export function detectHeadlessDeps(): HeadlessDepsStatus {
  return {
    xvfb: hasBinary('Xvfb'),
    openbox: hasBinary('openbox'),
    x11vnc: hasBinary('x11vnc'),
    websockify: hasBinary('websockify'),
  }
}

export function allHeadlessDepsInstalled(): boolean {
  const deps = detectHeadlessDeps()
  return deps.xvfb && deps.openbox && deps.x11vnc && deps.websockify
}

export interface InputMethodStatus {
  fcitx5: boolean
  chewing: boolean
}

export function detectInputMethod(): InputMethodStatus {
  return {
    fcitx5: hasBinary('fcitx5'),
    chewing: hasAptPackage('fcitx5-chewing'),
  }
}

export function allInputMethodInstalled(): boolean {
  const im = detectInputMethod()
  return im.fcitx5 && im.chewing
}

function hasAptPackage(pkg: string): boolean {
  try {
    const result = execFileSync('dpkg', ['-s', pkg], { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] })
    return result.includes('Status: install ok installed')
  } catch {
    return false
  }
}

export { hasBinary, hasSystemdUnit }
