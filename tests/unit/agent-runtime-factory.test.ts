import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { getAgentRuntime, resetAgentRuntime } from '@/lib/agent-runtime'
import { stubHermesHome } from './helpers/hermes-test-home'

let state: ReturnType<typeof stubHermesHome>

beforeEach(() => {
  state = stubHermesHome()
  vi.stubEnv('MCC_AGENT_RUNTIME', undefined)
  resetAgentRuntime()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetAgentRuntime()
  state.cleanup()
})

describe('getAgentRuntime', () => {
  it('defaults to OpenClaw when nothing is configured', () => {
    expect(getAgentRuntime().id).toBe('openclaw')
  })

  it('selects Hermes when fully configured', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
    vi.stubEnv('HERMES_API_URL', 'http://fixture.invalid:8642')
    vi.stubEnv('HERMES_API_KEY', 'fixture-key')
    expect(getAgentRuntime().id).toBe('hermes')
  })

  it('refuses Hermes without an environment key or a native dotenv key', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
    vi.stubEnv('HERMES_API_URL', 'http://fixture.invalid:8642')
    expect(() => getAgentRuntime()).toThrow(/HERMES_API_KEY/)
  })

  it('accepts the default URL when only the key is configured', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
    vi.stubEnv('HERMES_API_KEY', 'fixture-key')
    expect(getAgentRuntime().id).toBe('hermes')
  })

  it('rejects an unknown backend name rather than guessing', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', 'gpt-pilot')
    expect(() => getAgentRuntime()).toThrow(/Unknown MCC_AGENT_RUNTIME/)
  })

  it('is case- and whitespace-tolerant', () => {
    vi.stubEnv('MCC_AGENT_RUNTIME', '  OpenClaw  ')
    expect(getAgentRuntime().id).toBe('openclaw')
  })

  it('re-selects when the configuration changes', () => {
    expect(getAgentRuntime().id).toBe('openclaw')
    vi.stubEnv('MCC_AGENT_RUNTIME', 'hermes')
    vi.stubEnv('HERMES_API_URL', 'http://fixture.invalid:8642')
    vi.stubEnv('HERMES_API_KEY', 'fixture-key')
    expect(getAgentRuntime().id).toBe('hermes')
  })
})
