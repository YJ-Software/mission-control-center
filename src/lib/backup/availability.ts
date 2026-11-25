import { getBackendCapabilities } from '@/lib/agent-runtime/selection'
import { runHermesCli } from '@/lib/agent-runtime/hermes-host'
import { runOpenclaw } from '@/lib/openclaw/models-config'

export interface BackupAvailability { available: boolean; reason: string | null }

type Run = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>

const TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 8_000
const cache = new Map<string, { at: number; value: BackupAvailability }>()
const inflight = new Map<string, Promise<BackupAvailability>>()

export function resetBackupAvailabilityCache(): void { cache.clear(); inflight.clear() }

/** `openclaw backup --help` 能執行即視為支援原生備份；結果快取 60 秒。 */
export async function getBackupAvailability(
  deps: { run?: Run; now?: () => number } = {},
): Promise<BackupAvailability> {
  const now = (deps.now ?? Date.now)()
  const { backupTarget: backend } = getBackendCapabilities()
  const cached = cache.get(backend)
  if (cached && now - cached.at < TTL_MS) return cached.value
  const pending = inflight.get(backend)
  if (pending) return pending
  const probe = (async () => {
    let value: BackupAvailability
    try {
      if (backend === 'hermes') {
        await runHermesCli(['backup', '--help'], PROBE_TIMEOUT_MS)
        value = { available: true, reason: null }
      } else {
        const r = await (deps.run ?? runOpenclaw)(['backup', '--help'], PROBE_TIMEOUT_MS)
        value = r.code === 0
          ? { available: true, reason: null }
          : { available: false, reason: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(-300) }
      }
    } catch (e) {
      value = { available: false, reason: e instanceof Error ? e.message : String(e) }
    }
    cache.set(backend, { at: now, value })
    return value
  })().finally(() => { inflight.delete(backend) })
  inflight.set(backend, probe)
  return probe
}
