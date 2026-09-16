import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { getAgentRuntime, resetAgentRuntime } from '@/lib/agent-runtime'

/**
 * Backend selection. The load-bearing property is the refusal: a half-configured
 * Hermes must NOT quietly fall back to OpenClaw, or the dashboard would show one
 * agent's sessions, costs and schedules while the operator believes they are
 * looking at the other's.
 */

const KEYS = ['MCC_AGENT_RUNTIME', 'HERMES_API_URL', 'HERMES_API_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  resetAgentRuntime()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetAgentRuntime()
})

describe('getAgentRuntime', () => {
  it('defaults to OpenClaw when nothing is configured', () => {
    expect(getAgentRuntime().id).toBe('openclaw')
  })

  it('selects Hermes when fully configured', () => {
    process.env.MCC_AGENT_RUNTIME = 'hermes'
    process.env.HERMES_API_URL = 'http://127.0.0.1:8642'
    process.env.HERMES_API_KEY = 'k'
    expect(getAgentRuntime().id).toBe('hermes')
  })

  it('REFUSES a half-configured Hermes instead of falling back', () => {
    process.env.MCC_AGENT_RUNTIME = 'hermes'
    process.env.HERMES_API_URL = 'http://127.0.0.1:8642'
    expect(() => getAgentRuntime()).toThrow(/HERMES_API_KEY/)

    resetAgentRuntime()
    delete process.env.HERMES_API_URL
    process.env.HERMES_API_KEY = 'k'
    expect(() => getAgentRuntime()).toThrow(/HERMES_API_URL/)
  })

  it('rejects an unknown backend name rather than guessing', () => {
    process.env.MCC_AGENT_RUNTIME = 'gpt-pilot'
    expect(() => getAgentRuntime()).toThrow(/gpt-pilot/)
  })

  it('is case- and whitespace-tolerant', () => {
    process.env.MCC_AGENT_RUNTIME = '  OpenClaw  '
    expect(getAgentRuntime().id).toBe('openclaw')
  })

  it('re-selects when the configuration changes', () => {
    expect(getAgentRuntime().id).toBe('openclaw')
    process.env.MCC_AGENT_RUNTIME = 'hermes'
    process.env.HERMES_API_URL = 'http://127.0.0.1:8642'
    process.env.HERMES_API_KEY = 'k'
    expect(getAgentRuntime().id).toBe('hermes')
  })
})
