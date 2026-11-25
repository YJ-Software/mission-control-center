import { HermesRuntime } from './hermes'
import { OpenClawRuntime } from './openclaw'
import { resolveHermesConfig } from './hermes-config'
import { agentRuntimeKind } from './selection'
import type { AgentRuntime } from './types'

export * from './types'
export { HermesRuntime } from './hermes'
export { OpenClawRuntime } from './openclaw'
export { agentRuntimeKind } from './selection'
export { resolveHermesConfig } from './hermes-config'

let cached: AgentRuntime | null = null
let cachedFor: string | null = null

/** Share a runtime within the current connection configuration. */
export function getAgentRuntime(): AgentRuntime {
  const kind = agentRuntimeKind()
  const config = kind === 'hermes' ? resolveHermesConfig() : null
  const key = JSON.stringify([kind, config?.baseUrl, config?.apiKey])
  if (!cached || cachedFor !== key) {
    cached = config ? new HermesRuntime(config) : new OpenClawRuntime()
    cachedFor = key
  }
  return cached
}

export function resetAgentRuntime(): void {
  cached = null
  cachedFor = null
}
