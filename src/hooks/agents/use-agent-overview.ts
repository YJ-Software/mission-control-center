import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

type AgentsListRaw = {
  agents: Array<{
    id: string
    workspace?: string
    model?: { primary?: string; fallbacks?: string[] }
  }>
}

type ModelsListResult = {
  models: Array<{ id: string; name?: string; provider?: string }>
}

type IdentityResult = {
  agentId: string
  name?: string
  avatar?: string
  emoji?: string
  theme?: string
}

export function useAgentOverview(agentId: string | null) {
  return useQuery({
    enabled: !!agentId,
    queryKey: ['agents', 'overview', agentId],
    queryFn: async () => {
      const [raw, identity, models] = await Promise.all([
        rpcCall<AgentsListRaw>('agents.list', {}).catch(() => ({ agents: [] as AgentsListRaw['agents'] })),
        rpcCall<IdentityResult>('agent.identity.get', { agentId }).catch(() => null),
        rpcCall<ModelsListResult>('models.list', {}).catch(() => ({ models: [] })),
      ])
      const row = raw.agents.find((a) => a.id === agentId)
      return {
        workspace: row?.workspace,
        primaryModel: row?.model?.primary,
        fallbacks: row?.model?.fallbacks ?? [],
        skillFilter: undefined as string | undefined,
        identity,
        models: (models.models ?? []).map((m) => ({ id: m.id, name: m.name, provider: m.provider })),
      }
    },
    staleTime: 10_000,
  })
}

export function useSavePrimaryModel(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (primaryModel: string) =>
      rpcCall('config.patch', { agentId, patch: { primaryModel } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'overview', agentId] }),
  })
}
