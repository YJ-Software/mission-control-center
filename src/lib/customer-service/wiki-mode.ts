/**
 * Switch wiki between isolated (text-only, scoped to one agent) and bridge
 * (shared with memory-lancedb, semantic search) modes.
 *
 * isolated → wiki vault stays under the agent's workspace, search.backend = local
 * bridge   → wiki vault is shared, search.backend = shared, memory-lancedb on
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

export type WikiMode = 'isolated' | 'bridge'

async function setConfig(path: string, value: any, replace = false): Promise<void> {
  const args = ['config', 'set', path, JSON.stringify(value)]
  args.push(replace ? '--replace' : '--merge')
  await execFileAsync('openclaw', args, { timeout: 30000, env: getServerEnv() })
}

async function restartGateway(): Promise<string> {
  try {
    const out = await execFileAsync('openclaw', ['gateway', 'restart'], { timeout: 60000, env: getServerEnv() })
    return (out.stdout || '') + (out.stderr || '')
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}

export async function setMode(target: WikiMode): Promise<{ output: string }> {
  if (!existsSync(OPENCLAW_CONFIG)) throw new Error('openclaw.json missing')
  const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>

  const wikiEntry = cfg?.plugins?.entries?.['memory-wiki']
  const wikiConfig = wikiEntry?.config ?? {}
  const memoryEntry = cfg?.plugins?.entries?.['memory-lancedb']
  const lancedbReady = Boolean(memoryEntry?.config?.embedding?.model)

  const lines: string[] = []

  if (target === 'bridge') {
    if (!lancedbReady) {
      throw new Error(
        'memory-lancedb is not configured with an embedding model. Run the install wizard first.',
      )
    }
    // Switch wiki to shared search; flip vaultMode to bridge.
    await setConfig('plugins.entries.memory-wiki.config', {
      ...wikiConfig,
      vaultMode: 'bridge',
      search: { ...(wikiConfig.search ?? {}), backend: 'shared', corpus: wikiConfig.search?.corpus ?? 'all' },
    })
    lines.push('switched memory-wiki to bridge mode + shared search')
    await setConfig('plugins.slots.memory', 'memory-lancedb')
    lines.push('confirmed memory-lancedb is the active memory slot')
  } else {
    // isolated: keep vault scoped + use local text search.
    await setConfig('plugins.entries.memory-wiki.config', {
      ...wikiConfig,
      vaultMode: 'isolated',
      search: { ...(wikiConfig.search ?? {}), backend: 'local', corpus: 'wiki' },
    })
    lines.push('switched memory-wiki to isolated mode + local search')
  }

  const restart = await restartGateway()
  lines.push(restart)
  return { output: lines.join('\n') }
}
