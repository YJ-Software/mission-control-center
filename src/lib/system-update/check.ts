import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { getServerEnv } from '@/lib/server-env'
import { parseAptCheck, type AptCounts } from './apt'

const APT_CHECK = '/usr/lib/update-notifier/apt-check'
const TTL_MS = 30 * 60_000

interface AptCheckState {
  revision: number
  cached?: { counts: AptCounts | null; expiresAt: number }
  pending?: Promise<void>
}

// Route bundles and their background jobs share the cache in this server process.
const server = globalThis as typeof globalThis & { mccAptCheck?: AptCheckState }
const state = server.mccAptCheck ??= { revision: 0 }

export function invalidateAptCheck(): void {
  state.revision++
  state.cached = undefined
}

async function readCounts(): Promise<AptCounts | null> {
  if (!existsSync(APT_CHECK)) return null
  try {
    // apt-check writes the counts to stderr.
    const execFileAsync = promisify(execFile)
    const { stderr } = await execFileAsync(APT_CHECK, [], { timeout: 30_000, env: getServerEnv() })
    return parseAptCheck(stderr)
  } catch {
    return null
  }
}

export async function pendingAptCounts(): Promise<AptCounts | null> {
  for (;;) {
    if (state.cached && state.cached.expiresAt > Date.now()) return state.cached.counts
    const revision = state.revision
    state.pending ??= readCounts().then(counts => {
      if (revision === state.revision) state.cached = { counts, expiresAt: Date.now() + TTL_MS }
    }).finally(() => {
      state.pending = undefined
    })
    // If apt changed mid-check, wait for this process to finish before starting the replacement check.
    await state.pending
  }
}
