/**
 * Top-level directories that should always be carried from live during restore,
 * if they exist in the live home.
 */
export const ALWAYS_FROM_LIVE = ['extensions', 'npm'] as const

/**
 * Directories that should never be carried from live to restore,
 * as they contain state/credentials that would mix live data into the restore.
 */
const NEVER_CARRY = new Set(['state', 'agents', 'openclaw.json', 'workspace', 'credentials'])

/**
 * Plan which top-level directories to carry from the live home during restore.
 *
 * Returns sorted, deduplicated list of entries to copy from live to restored:
 * 1. Entries from ALWAYS_FROM_LIVE that exist in live
 * 2. Entries that exist in live but not in restored
 * 3. Never includes: state, agents, openclaw.json, workspace, credentials
 */
export function planCarryOver(liveEntries: string[], restoredEntries: string[]): string[] {
  const live = new Set(liveEntries)
  const restored = new Set(restoredEntries)

  const toCarry = new Set<string>()

  // 1. Add ALWAYS_FROM_LIVE entries that exist in live
  for (const entry of ALWAYS_FROM_LIVE) {
    if (live.has(entry)) {
      toCarry.add(entry)
    }
  }

  // 2. Add entries that exist in live but not in restored
  for (const entry of live) {
    if (!restored.has(entry)) {
      toCarry.add(entry)
    }
  }

  // 3. Remove entries that should never be carried
  for (const entry of NEVER_CARRY) {
    toCarry.delete(entry)
  }

  // Sort and return as array
  return Array.from(toCarry).sort()
}
