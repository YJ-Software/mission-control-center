/** Thin wrapper around `openclaw wiki ...` so MCC server-side code doesn't
 *  spread shell-args around. Uses execFile (no shell injection). */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { findOpenclawBin } from '@/lib/morning-report/openclaw'

const execFileAsync = promisify(execFile)

interface RunOpts {
  timeoutMs?: number
}

async function run(args: string[], opts: RunOpts = {}): Promise<{ stdout: string; stderr: string }> {
  const bin = findOpenclawBin()
  const { stdout, stderr } = await execFileAsync(bin, ['wiki', ...args], {
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return { stdout, stderr }
}

export interface WikiStatus {
  vaultMode: 'isolated' | 'bridge' | 'unsafe-local' | 'unknown'
  vaultPath: string
  vaultReady: boolean
  obsidianAvailable: boolean
  pages: { sources: number; entities: number; concepts: number; syntheses: number; reports: number }
  raw: string
}

export async function status(): Promise<WikiStatus> {
  const { stdout } = await run(['status'])
  // Output is a human-readable block; parse the lines we care about.
  const get = (re: RegExp): string => stdout.match(re)?.[1]?.trim() ?? ''
  const numFromPagesLine = (label: string) => {
    const m = stdout.match(new RegExp(`(\\d+)\\s+${label}`))
    return m ? Number(m[1]) : 0
  }
  return {
    vaultMode: (get(/Wiki vault mode:\s+(\S+)/) as WikiStatus['vaultMode']) || 'unknown',
    vaultPath: get(/Vault:\s+ready\s+\(([^)]+)\)/) || get(/Vault:\s+([^\n]+)/),
    vaultReady: /Vault:\s+ready/.test(stdout),
    obsidianAvailable: /Obsidian CLI:\s+available/.test(stdout),
    pages: {
      sources: numFromPagesLine('sources'),
      entities: numFromPagesLine('entities'),
      concepts: numFromPagesLine('concepts'),
      syntheses: numFromPagesLine('syntheses'),
      reports: numFromPagesLine('reports'),
    },
    raw: stdout,
  }
}

export async function ingest(target: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(['ingest', target], { timeoutMs: 180_000 })
    return { ok: true, output: stdout || stderr }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

export async function search(query: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await run(['search', query], { timeoutMs: 30_000 })
    return { ok: true, output: stdout }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

export async function lint(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await run(['lint'], { timeoutMs: 30_000 })
    return { ok: true, output: stdout }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

export async function compile(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await run(['compile'], { timeoutMs: 60_000 })
    return { ok: true, output: stdout }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}
