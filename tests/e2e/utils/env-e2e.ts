import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load .env.e2e.local into process.env if not already loaded.
 * Idempotent — Playwright workers may import multiple times.
 *
 * Existing process.env values win, so CI / cmdline overrides still work.
 */
export function loadE2eEnv(rootDir = process.cwd()): void {
  if (process.env.__E2E_ENV_LOADED__) return
  const path = resolve(rootDir, '.env.e2e.local')
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>>>') || trimmed.startsWith('<<<')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
  process.env.__E2E_ENV_LOADED__ = '1'
}
