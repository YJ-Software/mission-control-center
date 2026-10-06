import { runOpenclaw } from '@/lib/openclaw/models-config'

export interface BackupAvailability { available: boolean; reason: string | null }

type Run = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>

const TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 8_000
let cache: { at: number; value: BackupAvailability } | null = null

export function resetBackupAvailabilityCache(): void { cache = null }

/** `openclaw backup --help` 能執行即視為支援原生備份；結果快取 60 秒。 */
export async function getBackupAvailability(
  deps: { run?: Run; now?: () => number } = {},
): Promise<BackupAvailability> {
  const now = (deps.now ?? Date.now)()
  if (cache && now - cache.at < TTL_MS) return cache.value
  const run = deps.run ?? runOpenclaw
  let value: BackupAvailability
  try {
    const r = await run(['backup', '--help'], PROBE_TIMEOUT_MS)
    value = r.code === 0
      ? { available: true, reason: null }
      : { available: false, reason: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(-300) }
  } catch (e) {
    value = { available: false, reason: e instanceof Error ? e.message : String(e) }
  }
  cache = { at: now, value }
  return value
}
