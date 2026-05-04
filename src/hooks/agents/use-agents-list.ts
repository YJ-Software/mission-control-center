import { useQuery } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'
import type { AgentsListResult } from '@/lib/openclaw/agent-types'

type FallbackAgent = { id: string; name?: string }
type FallbackResponse = { agents: FallbackAgent[] }

async function fetchAgentsListFallback(): Promise<AgentsListResult> {
  const res = await fetch('/api/agents')
  if (!res.ok) throw new Error(`/api/agents failed: ${res.status}`)
  const body = (await res.json()) as FallbackResponse
  const agents = (body.agents ?? []).map((a) => ({ id: a.id, name: a.name ?? a.id }))
  const defaultId = agents.find((a) => a.id === 'main')?.id ?? agents[0]?.id ?? ''
  return { defaultId, mainKey: defaultId, scope: 'local', agents }
}

export function useAgentsList() {
  return useQuery({
    queryKey: ['agents', 'list'],
    queryFn: async () => {
      try {
        return await rpcCall<AgentsListResult>('agents.list', {})
      } catch {
        return await fetchAgentsListFallback()
      }
    },
    staleTime: 30_000,
  })
}
