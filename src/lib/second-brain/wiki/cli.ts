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

/** Guard against argv flag-smuggling: a positional value starting with "-"
 *  would be parsed by the CLI as a flag. execFile blocks shell injection but
 *  not this. Used for free-text positionals (ids, paths, titles). */
function rejectFlagLike(value: string, field: string): void {
  if (value.startsWith('-')) {
    throw new Error(`${field} 不可以 "-" 開頭（避免被當成指令參數）`)
  }
}

const APPLY_KINDS = new Set(['synthesis', 'entity', 'concept', 'source'])

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
    rejectFlagLike(target, 'target')
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

/** Health diagnostics: vault integrity, provenance gaps, plugin wiring. */
export async function doctor(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(['doctor'], { timeoutMs: 60_000 })
    return { ok: true, output: stdout || stderr }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Retrieve a single page by id (e.g. `entity.alpha`) or path. */
export async function get(idOrPath: string): Promise<{ ok: boolean; output: string }> {
  try {
    rejectFlagLike(idOrPath, 'id/path')
    const { stdout } = await run(['get', idOrPath], { timeoutMs: 30_000 })
    return { ok: true, output: stdout }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Narrow structured write — e.g. apply a synthesis or entity page.
 *  kind: synthesis | entity | concept | source (per `openclaw wiki apply`). */
export async function apply(opts: {
  kind: string
  title: string
  body: string
  sourceId?: string
}): Promise<{ ok: boolean; output: string }> {
  try {
    if (!APPLY_KINDS.has(opts.kind)) {
      throw new Error(`kind 必須是 ${[...APPLY_KINDS].join(' / ')} 其中之一`)
    }
    rejectFlagLike(opts.title, 'title')
    // kind is allowlisted and title is flag-guarded; body/source-id are flag
    // VALUES (after --body / --source-id) so they can't smuggle flags.
    const args = ['apply', opts.kind, opts.title, '--body', opts.body]
    if (opts.sourceId?.trim()) {
      rejectFlagLike(opts.sourceId.trim(), 'source id')
      args.push('--source-id', opts.sourceId.trim())
    }
    const { stdout, stderr } = await run(args, { timeoutMs: 60_000 })
    return { ok: true, output: stdout || stderr }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Import public artifacts from the active memory plugin into the wiki. */
export async function bridgeImport(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(['bridge', 'import'], { timeoutMs: 120_000 })
    return { ok: true, output: stdout || stderr }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Import an Open Knowledge Format (OKF) bundle from a local directory. */
export async function okfImport(bundlePath: string): Promise<{ ok: boolean; output: string }> {
  try {
    rejectFlagLike(bundlePath, 'bundle path')
    const { stdout, stderr } = await run(['okf', 'import', bundlePath], { timeoutMs: 120_000 })
    return { ok: true, output: stdout || stderr }
  } catch (err: unknown) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) }
  }
}
