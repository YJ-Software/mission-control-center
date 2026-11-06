import { execFileSync } from 'child_process'
import { accessSync, constants, statSync } from 'fs'

/** Stable candidates only: never persist Homebrew's resolved Cellar target.
 * Prefer the same formula (including keg-only node@NN) over a different Node
 * linked into bin. Keep other installations, such as nvm and NodeSource, as-is. */
export function nodePathCandidates(execPath: string): string[] {
  const brew = execPath.match(/^(.*)\/Cellar\/(node(?:@[^/]+)?)\/[^/]+\/bin\/node$/)
  return brew
    ? [`${brew[1]}/opt/${brew[2]}/bin/node`, `${brew[1]}/bin/node`]
    : [execPath]
}

export function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** X_OK alone misses binaries whose shared libraries disappeared after brew
 * upgrade. Probe without a shell; keep the symlink path, not its realpath. */
export function resolveNodePath(execPath = process.execPath): string {
  for (const candidate of nodePathCandidates(execPath)) {
    if (!isExecutableFile(candidate)) continue
    try {
      execFileSync(candidate, ['--version'], { timeout: 5000, stdio: 'pipe' })
      return candidate
    } catch { /* Try the next stable candidate. */ }
  }
  throw new Error(`No runnable stable Node interpreter for ${execPath}`)
}
