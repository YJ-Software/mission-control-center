import { execFileSync } from 'child_process'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { detectHeadlessDeps, hasBinary, hasSystemdUnit, generatePassword } from '@/lib/headless-vnc'

const DEFAULTS: Record<string, string> = {
  'browser.display': ':6',
  'browser.resolution': '1920x1080',
  'browser.vnc_password': '',
  'browser.vnc_port': '5901',
  'browser.websockify_port': '6081',
  'browser.cdp_port': '9222',
  'browser.installed': 'false',
}

export function getBrowserConfig(key: string): string {
  const fullKey = key.startsWith('browser.') ? key : `browser.${key}`
  const row = db.select().from(settings).where(eq(settings.key, fullKey)).get()
  return row?.value ?? DEFAULTS[fullKey] ?? ''
}

export function setBrowserConfig(key: string, value: string): void {
  const fullKey = key.startsWith('browser.') ? key : `browser.${key}`
  db.insert(settings)
    .values({ key: fullKey, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function getAllBrowserConfig(): Record<string, string> {
  const rows = db.select().from(settings).all()
  const result: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) {
    if (row.key.startsWith('browser.')) {
      result[row.key] = row.value
    }
  }
  return result
}

export function getAllBrowserConfigClean(): Record<string, string> {
  const raw = getAllBrowserConfig()
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key.replace('browser.', '')] = value
  }
  return result
}

export function setMultipleBrowserConfig(entries: Record<string, string>): void {
  for (const [key, value] of Object.entries(entries)) {
    setBrowserConfig(key, value)
  }
}

const CHROME_BINARIES = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']

export function getChromeBinaryPath(): string {
  for (const bin of CHROME_BINARIES) {
    if (hasBinary(bin)) {
      try {
        return execFileSync('which', [bin], { encoding: 'utf8', timeout: 3000 }).trim()
      } catch {
        // continue
      }
    }
  }
  return ''
}

export interface BrowserDetectedComponents {
  chrome: boolean
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
  chromeService: boolean
}

export function detectComponents(): BrowserDetectedComponents {
  const chrome = !!getChromeBinaryPath()
  const headless = detectHeadlessDeps()
  const { xvfb, openbox, x11vnc, websockify } = headless
  const chromeService = hasSystemdUnit('chrome-headless.service')

  return { chrome, xvfb, openbox, x11vnc, websockify, chromeService }
}

export function autoDetectInstalled(): BrowserDetectedComponents {
  const detected = detectComponents()

  // Auto-sync installed flag
  if (getBrowserConfig('installed') !== 'true' && detected.chrome && detected.chromeService) {
    setBrowserConfig('installed', 'true')
  }

  // Auto-generate VNC password if empty
  if (!getBrowserConfig('vnc_password')) {
    setBrowserConfig('vnc_password', generatePassword(16))
  }

  return detected
}
