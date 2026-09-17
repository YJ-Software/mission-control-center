/**
 * Which agent backend this install talks to.
 *
 * Defaults to OpenClaw, which is what every existing deployment runs — the
 * second backend is opt-in and must never change behaviour for someone who has
 * not configured it. Selection is by environment so a single build serves both.
 *
 *   MCC_AGENT_RUNTIME=hermes
 *   HERMES_API_URL=http://127.0.0.1:8642
 *   HERMES_API_KEY=<bearer token>
 *
 * A half-configured Hermes selection throws with the missing variable named,
 * rather than silently falling back to OpenClaw and reporting another agent's
 * sessions as if they were this one's.
 */

import { HermesRuntime } from './hermes'
import { OpenClawRuntime } from './openclaw'
import type { AgentRuntime } from './types'

export * from './types'
export { HermesRuntime } from './hermes'
export { OpenClawRuntime } from './openclaw'

let cached: AgentRuntime | null = null
let cachedFor: string | null = null

/** Which backend this process is configured for. */
export function agentRuntimeKind(): string {
  return (process.env.MCC_AGENT_RUNTIME || 'openclaw').trim().toLowerCase()
}

/**
 * The Hermes connection settings, validated. Single source of truth: server.ts
 * needs the same values to build the chat bridge, and a second copy of this
 * parsing drifted from this one almost immediately (it reported a vaguer error
 * and treated a missing key as a warning rather than a failure).
 */
export function resolveHermesConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.HERMES_API_URL || '').trim().replace(/\/+$/, '')
  const apiKey = (process.env.HERMES_API_KEY || '').trim()
  const missing = [!baseUrl && 'HERMES_API_URL', !apiKey && 'HERMES_API_KEY'].filter(Boolean)
  if (missing.length) {
    throw new Error(`MCC_AGENT_RUNTIME=hermes requires ${missing.join(' and ')}`)
  }
  return { baseUrl, apiKey }
}

function build(): AgentRuntime {
  const kind = agentRuntimeKind()
  if (kind === 'openclaw') return new OpenClawRuntime()
  if (kind === 'hermes') return new HermesRuntime(resolveHermesConfig())
  throw new Error(`Unknown MCC_AGENT_RUNTIME "${kind}" (expected "openclaw" or "hermes")`)
}

/** The configured runtime. Cached per configuration so tests can re-select. */
export function getAgentRuntime(): AgentRuntime {
  const key = `${process.env.MCC_AGENT_RUNTIME || 'openclaw'}|${process.env.HERMES_API_URL || ''}`
  if (!cached || cachedFor !== key) {
    cached = build()
    cachedFor = key
  }
  return cached
}

/** Drop the memoized runtime (tests, and after a config change). */
export function resetAgentRuntime(): void {
  cached = null
  cachedFor = null
}
