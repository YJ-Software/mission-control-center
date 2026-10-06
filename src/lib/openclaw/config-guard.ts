import { isDeepStrictEqual } from 'node:util'
import { agentsToList, type AgentModelOverride } from './models-config'

// OpenClaw 2026.9.8 under memory pressure can accept a `config set` (exit 0)
// and then drop it: a later write is computed from a config that lacks it.
// Exit codes therefore prove nothing — these helpers check the outcome.

const norm = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** Poll until the agent's model equals `expected` (undefined = no model key). */
export async function waitForAgentOverride(
  agentId: string,
  expected: AgentModelOverride | undefined,
  deps: { read(): Promise<unknown>; sleep(ms: number): Promise<void> },
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const { timeoutMs = 10_000, intervalMs = 500 } = opts
  const want = norm(expected)
  let waited = 0
  for (;;) {
    const entry = agentsToList(await deps.read()).find((a) => a.id === agentId)
    if (isDeepStrictEqual(norm(entry?.model), want)) return true
    if (waited >= timeoutMs) return false
    await deps.sleep(intervalMs)
    waited += intervalMs
  }
}

/** Run `fn` (e.g. a credential removal) and make sure the `agents` config is
 * the same afterwards; restore the snapshot if fn's side effects rewrote it. */
export async function guardAgentsDuring<T>(
  fn: () => Promise<T>,
  deps: {
    readAgents(): Promise<unknown>
    writeAgents(value: unknown): Promise<void>
    log(msg: string): void
  },
): Promise<T> {
  const snapshot = norm(await deps.readAgents())
  const result = await fn()
  if (isDeepStrictEqual(norm(await deps.readAgents()), snapshot)) return result
  deps.log('logout 改動了 agents 設定，已還原')
  await deps.writeAgents(snapshot)
  if (!isDeepStrictEqual(norm(await deps.readAgents()), snapshot)) {
    throw new Error('agents config could not be restored after the operation — check openclaw.json')
  }
  return result
}
