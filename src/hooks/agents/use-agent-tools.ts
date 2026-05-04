import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

type ToolRaw = {
  id: string
  label: string
  description?: string
  source?: string
  defaultProfiles?: string[]
}

type GroupRaw = {
  id: string
  label: string
  source?: string
  tools: ToolRaw[]
}

type CatalogRaw = {
  agentId: string
  profiles: Array<{ id: string; label: string }>
  groups: GroupRaw[]
}

export type ToolEntry = {
  id: string
  label: string
  description?: string
  groupId: string
  groupLabel: string
  source: string
  defaultProfiles: string[]
  allowed: boolean
}

export function useAgentTools(agentId: string | null) {
  return useQuery({
    enabled: !!agentId,
    queryKey: ['agents', 'tools', agentId],
    queryFn: async () => {
      const catalog = await rpcCall<CatalogRaw>('tools.catalog', { agentId })
      const tools: ToolEntry[] = []
      for (const g of catalog.groups) {
        for (const t of g.tools) {
          tools.push({
            id: t.id,
            label: t.label ?? t.id,
            description: t.description,
            groupId: g.id,
            groupLabel: g.label,
            source: t.source ?? g.source ?? 'core',
            defaultProfiles: t.defaultProfiles ?? [],
            allowed: (t.defaultProfiles ?? []).length > 0,
          })
        }
      }
      return {
        profiles: catalog.profiles,
        groups: catalog.groups.map((g) => ({ id: g.id, label: g.label })),
        tools,
      }
    },
    staleTime: 30_000,
  })
}

export function useSetToolAllowed(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ toolId, allowed }: { toolId: string; allowed: boolean }) =>
      rpcCall('config.patch', {
        agentId,
        patch: { tools: { set: { [toolId]: { allowed } } } },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'tools', agentId] }),
  })
}
