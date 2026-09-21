/**
 * Refresh the dashboard's own systemd unit from the running version's
 * template, once per startup.
 *
 * Same rationale as ensure-log-rotation.ts: both upgrade paths (the UI
 * button and upgrade.sh) execute the OLD version's code, so a template
 * change (new PATH entry, new StandardOutput target — see
 * service-unit.ts) never reaches a machine upgraded from the dashboard.
 * The new version's first boot is the only place guaranteed to run new
 * code, so it re-renders the unit itself here.
 *
 * Safety is the whole point: writing a broken unit means the dashboard
 * does not come back on the next restart, and nothing rolls it back. So:
 * validate before writing, back up the old unit, write to a temp path and
 * rename (never truncate in place), and never call
 * systemctl start/stop/restart — only daemon-reload. The new unit takes
 * effect on the NEXT restart, which this code does not trigger.
 *
 * Like install-logrotate.sh's caller, this is fire-and-forget and never
 * fatal to startup.
 */

import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { InstallMode } from './manager'
import { renderServiceUnit, validateRenderedUnit, decideUnitUpdate } from './service-unit'

const execFileP = promisify(execFile)

export type EnsureUnitResult =
  | 'updated'
  | 'unchanged'
  | 'skipped-not-release'
  | 'skipped-no-template'
  | 'skipped-no-node'
  | 'rejected'
  | 'failed'

export interface EnsureServiceUnitOptions {
  mode: InstallMode
  prefix: string
  state: string
  service: string
  nodeBin?: string
  home?: string
  fs?: {
    readFileSync(p: string): string
    existsSync(p: string): boolean
    writeFileSync(p: string, data: string): void
    renameSync(a: string, b: string): void
    copyFileSync(a: string, b: string): void
    mkdirSync(p: string): void
    realpathSync(p: string): string
    rmSync?(p: string): void
  }
  run?: (cmd: string, args: string[]) => Promise<unknown>
}

type Io = NonNullable<EnsureServiceUnitOptions['fs']>
type Run = NonNullable<EnsureServiceUnitOptions['run']>

/**
 * Pick the node binary the unit should exec.
 *
 * process.execPath resolves through symlinks to a version-pinned path (e.g.
 * Homebrew's Cellar/node/<version>/bin/node, or a Volta shim's real target).
 * `brew upgrade node` / a Volta re-pin deletes the old target dir, so if we
 * rendered ExecStart with that resolved path, the NEXT unrelated node
 * upgrade — unrelated to this dashboard — leaves ExecStart pointing at a
 * binary that no longer exists: 203/EXEC, endless Restart=on-failure, and
 * nothing rolls it back (this feature exists specifically to rewrite the
 * unit, so there's no earlier-version fallback either).
 *
 * install.sh originally rendered ExecStart with the stable, un-resolved
 * path (`command -v node`, e.g. linuxbrew's bin/node symlink or a Volta
 * shim). So prefer whatever path is already in the existing unit's
 * ExecStart, as long as it still exists and still resolves to the same
 * node this process is running — that confirms it is a stable alias for
 * the same install, not a stale pointer. Only fall back to
 * process.execPath when there is no usable alias to keep.
 */
function resolveNodeBin(io: Pick<Io, 'existsSync' | 'realpathSync'>, current: string | null): string {
  if (current !== null) {
    const token = /^ExecStart=(\S+)/m.exec(current)?.[1]
    if (token && io.existsSync(token)) {
      try {
        if (io.realpathSync(token) === io.realpathSync(process.execPath)) return token
      } catch {
        // Unreadable/broken link — fall through to the execPath fallback.
      }
    }
  }
  return process.execPath
}

/**
 * If a previous run renamed the unit into place but then died or failed
 * before `daemon-reload` (killed mid-run, no user bus, etc.), the unit file
 * on disk is already the new content, so decideUnitUpdate() sees
 * 'unchanged' on every later boot and this function returns early without
 * ever reloading — systemd keeps running the stale in-memory unit
 * indefinitely even though the log already said "updated" once. Ask
 * systemd directly whether a reload is outstanding and opportunistically
 * run it — never a restart — so a fumbled write is not permanent.
 */
async function reloadIfPending(run: Run, service: string): Promise<void> {
  try {
    const result = (await run('systemctl', [
      '--user', 'show', '-p', 'NeedDaemonReload', '--value', `${service}.service`,
    ])) as { stdout?: string } | undefined
    if (result?.stdout?.trim() === 'yes') {
      await run('systemctl', ['--user', 'daemon-reload'])
    }
  } catch (err) {
    console.warn('[ServiceUnit] NeedDaemonReload check failed (non-fatal):', (err as Error).message)
  }
}

export async function ensureServiceUnit(opts: EnsureServiceUnitOptions): Promise<EnsureUnitResult> {
  // Dev units are edited by hand; only the release tarball ships the template.
  if (opts.mode !== 'release') return 'skipped-not-release'

  const io: Io = opts.fs ?? {
    readFileSync: (p: string) => fs.readFileSync(p, 'utf8'),
    existsSync: fs.existsSync,
    writeFileSync: (p: string, data: string) => fs.writeFileSync(p, data),
    renameSync: fs.renameSync,
    copyFileSync: fs.copyFileSync,
    mkdirSync: (p: string) => fs.mkdirSync(p, { recursive: true }),
    realpathSync: (p: string) => fs.realpathSync(p),
    rmSync: (p: string) => fs.rmSync(p),
  }
  const run = opts.run ?? ((cmd, args) => execFileP(cmd, args, { timeout: 30_000 }))

  const tmplPath = path.join(opts.prefix, 'current', 'install', 'mission-control.service.tmpl')
  if (!io.existsSync(tmplPath)) return 'skipped-no-template'

  const unitDir = path.join(opts.home ?? os.homedir(), '.config/systemd/user')
  const unitPath = path.join(unitDir, `${opts.service}.service`)
  const current = io.existsSync(unitPath) ? io.readFileSync(unitPath) : null

  const nodeBin = opts.nodeBin ?? resolveNodeBin(io, current)
  if (!io.existsSync(nodeBin)) return 'skipped-no-node'

  const template = io.readFileSync(tmplPath)
  const next = renderServiceUnit(template, { nodeBin, state: opts.state, prefix: opts.prefix })

  const rejection = validateRenderedUnit(next)
  if (rejection !== null) {
    console.warn(`[ServiceUnit] rendered unit failed validation (${rejection}), not writing`)
    return 'rejected'
  }

  if (decideUnitUpdate(current, next) === 'unchanged') {
    await reloadIfPending(run, opts.service)
    return 'unchanged'
  }

  const tmpPath = `${unitPath}.tmp`
  try {
    io.mkdirSync(unitDir)
    if (current !== null) io.copyFileSync(unitPath, `${unitPath}.bak`)
    io.writeFileSync(tmpPath, next)
    io.renameSync(tmpPath, unitPath)
    await run('systemctl', ['--user', 'daemon-reload'])
    console.log(`[ServiceUnit] updated ${unitPath} — takes effect on the next restart`)
    return 'updated'
  } catch (err) {
    // Best-effort: don't leave a stray .tmp file next to the real unit.
    try {
      if (io.existsSync(tmpPath)) io.rmSync?.(tmpPath)
    } catch {
      // cleanup is best-effort
    }
    console.warn('[ServiceUnit] update failed (non-fatal):', (err as Error).message)
    return 'failed'
  }
}
