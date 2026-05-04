import { describe, it, expect } from 'vitest'
import { AGENT_RPC_METHODS, isAllowedAgentRpc } from '@/lib/openclaw/rpc-methods'

describe('rpc-methods allowlist', () => {
  it('contains every method the agents page uses', () => {
    const expected = [
      'agents.list', 'agent.identity.get',
      'agents.files.list', 'agents.files.get', 'agents.files.set',
      'skills.status', 'skills.detail', 'skills.search', 'skills.update', 'skills.install',
      'tools.catalog', 'tools.effective',
      'models.list', 'models.authStatus',
      'cron.list', 'cron.status', 'cron.runs', 'cron.add', 'cron.update', 'cron.remove', 'cron.run',
      'channels.status', 'channels.logout',
      'config.get', 'config.schema', 'config.patch',
    ]
    for (const m of expected) expect(AGENT_RPC_METHODS.has(m)).toBe(true)
  })

  it('rejects unknown methods', () => {
    expect(isAllowedAgentRpc('agents.delete')).toBe(false)
    expect(isAllowedAgentRpc('system.shutdown')).toBe(false)
    expect(isAllowedAgentRpc('agents.list')).toBe(true)
  })
})
