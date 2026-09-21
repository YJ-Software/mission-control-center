/**
 * Rendering and safety checks for the dashboard's own systemd unit.
 *
 * The unit is written at install time by deploy/release/install.sh and
 * re-rendered by upgrade.sh — but the UI upgrade button runs neither: it
 * executes the OLD version's manager.ts, which never touches the unit. So a
 * template change (a new PATH entry, a new StandardOutput target) never
 * reaches a machine upgraded from the dashboard. The new version re-renders
 * it on its first boot instead; see ensure-service-unit.ts.
 *
 * Pure on purpose: writing a broken unit means the dashboard does not come
 * back after the next restart, and nothing rolls it back automatically, so
 * every rejection rule here is tested.
 */

import path from 'node:path'

export interface UnitVars {
  /** Absolute path of the node binary the unit should exec. */
  nodeBin: string
  /** State dir (`~/.mission-control`). */
  state: string
  /** Install prefix (`~/mission-control`). */
  prefix: string
}

/** Same placeholders and same global substitution as install.sh's sed. */
export function renderServiceUnit(template: string, vars: UnitVars): string {
  return template
    .split('__NODE_BIN__').join(vars.nodeBin)
    .split('__NODE_DIR__').join(path.dirname(vars.nodeBin))
    .split('__STATE__').join(vars.state)
    .split('__PREFIX__').join(vars.prefix)
}

export type UnitRejection = 'placeholders-left' | 'missing-service-section' | 'missing-execstart'

/** Null when the text is safe to install as a unit file. */
export function validateRenderedUnit(text: string): UnitRejection | null {
  if (/__[A-Z_]+__/.test(text)) return 'placeholders-left'
  if (!/^\[Service\]$/m.test(text)) return 'missing-service-section'
  if (!/^ExecStart=\S/m.test(text)) return 'missing-execstart'
  return null
}

export type UnitDecision = 'write' | 'unchanged'

/** Compare ignoring trailing whitespace so a stray newline is not a change. */
export function decideUnitUpdate(current: string | null, next: string): UnitDecision {
  if (current === null) return 'write'
  return current.trimEnd() === next.trimEnd() ? 'unchanged' : 'write'
}
