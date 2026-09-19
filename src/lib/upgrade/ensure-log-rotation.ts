/**
 * Install/refresh the log-rotation timer from the running version's own
 * installer, once per startup.
 *
 * This lives at startup rather than in the upgrade flow on purpose: both
 * upgrade paths execute the PREVIOUS version's code — the UI button runs the
 * old process's manager.ts, and upgrade.sh is launched from the installed
 * tree. A step added to either only takes effect one upgrade later. The new
 * version's first boot is the only place guaranteed to run new code.
 *
 * install-logrotate.sh is idempotent and never fatal, and so is this.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { InstallMode } from './manager'

const execFileP = promisify(execFile)

export type EnsureLogRotationResult = 'ran' | 'skipped-not-release' | 'skipped-no-script' | 'failed'

export interface EnsureLogRotationOptions {
  mode: InstallMode
  prefix: string
  state: string
  service: string
  exists?: (p: string) => boolean
  run?: (cmd: string, args: string[]) => Promise<unknown>
}

export async function ensureLogRotation(opts: EnsureLogRotationOptions): Promise<EnsureLogRotationResult> {
  // Dev units log to the journal, which rotates itself.
  if (opts.mode !== 'release') return 'skipped-not-release'

  const installDir = path.join(opts.prefix, 'current', 'install')
  const script = path.join(installDir, 'install-logrotate.sh')
  if (!(opts.exists ?? existsSync)(script)) return 'skipped-no-script'

  const run = opts.run ?? ((cmd, args) => execFileP(cmd, args, { timeout: 30_000 }))
  try {
    await run('bash', [script, installDir, opts.state, opts.service])
    return 'ran'
  } catch (err) {
    console.warn('[LogRotation] setup failed (non-fatal):', (err as Error).message)
    return 'failed'
  }
}
