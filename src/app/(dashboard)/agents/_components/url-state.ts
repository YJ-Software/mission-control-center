import type { AgentsPanel } from '@/lib/openclaw/agent-types'

const PANELS: AgentsPanel[] = ['overview', 'files', 'tools', 'skills', 'channels', 'cron']

export type AgentsUrlState = { agent: string | null; tab: AgentsPanel }

export function parseAgentsUrlState(p: URLSearchParams): AgentsUrlState {
  const rawTab = p.get('tab') as AgentsPanel | null
  const tab: AgentsPanel = rawTab && PANELS.includes(rawTab) ? rawTab : 'overview'
  const agent = p.get('agent') || null
  return { agent, tab }
}

export function buildAgentsUrl(state: AgentsUrlState): string {
  const qs = new URLSearchParams()
  if (state.agent) qs.set('agent', state.agent)
  if (state.tab !== 'overview') qs.set('tab', state.tab)
  const s = qs.toString()
  return s ? `/agents?${s}` : '/agents'
}
