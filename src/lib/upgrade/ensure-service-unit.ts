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
  }
  run?: (cmd: string, args: string[]) => Promise<unknown>
}

export async function ensureServiceUnit(opts: EnsureServiceUnitOptions): Promise<EnsureUnitResult> {
  // Dev units are edited by hand; only the release tarball ships the template.
  if (opts.mode !== 'release') return 'skipped-not-release'

  const io = opts.fs ?? {
    readFileSync: (p: string) => fs.readFileSync(p, 'utf8'),
    existsSync: fs.existsSync,
    writeFileSync: (p: string, data: string) => fs.writeFileSync(p, data),
    renameSync: fs.renameSync,
    copyFileSync: fs.copyFileSync,
    mkdirSync: (p: string) => fs.mkdirSync(p, { recursive: true }),
  }
  const run = opts.run ?? ((cmd, args) => execFileP(cmd, args, { timeout: 30_000 }))

  const tmplPath = path.join(opts.prefix, 'current', 'install', 'mission-control.service.tmpl')
  if (!io.existsSync(tmplPath)) return 'skipped-no-template'

  const nodeBin = opts.nodeBin ?? process.execPath
  if (!io.existsSync(nodeBin)) return 'skipped-no-node'

  const template = io.readFileSync(tmplPath)
  const next = renderServiceUnit(template, { nodeBin, state: opts.state, prefix: opts.prefix })

  if (validateRenderedUnit(next) !== null) {
    console.warn(`[ServiceUnit] rendered unit failed validation (${validateRenderedUnit(next)}), not writing`)
    return 'rejected'
  }

  const unitDir = path.join(opts.home ?? os.homedir(), '.config/systemd/user')
  const unitPath = path.join(unitDir, `${opts.service}.service`)
  const current = io.existsSync(unitPath) ? io.readFileSync(unitPath) : null

  if (decideUnitUpdate(current, next) === 'unchanged') return 'unchanged'

  try {
    io.mkdirSync(unitDir)
    if (current !== null) io.copyFileSync(unitPath, `${unitPath}.bak`)
    const tmpPath = `${unitPath}.tmp`
    io.writeFileSync(tmpPath, next)
    io.renameSync(tmpPath, unitPath)
    await run('systemctl', ['--user', 'daemon-reload'])
    console.log(`[ServiceUnit] updated ${unitPath} — takes effect on the next restart`)
    return 'updated'
  } catch (err) {
    console.warn('[ServiceUnit] update failed (non-fatal):', (err as Error).message)
    return 'failed'
  }
}
