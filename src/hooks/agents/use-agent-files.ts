import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

export type AgentFileEntry = {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
}

export type AgentFilesListResult = {
  agentId: string
  workspace: string
  files: AgentFileEntry[]
}

export type AgentFilesGetResult = {
  name: string
  path: string
  content: string
  updatedAtMs?: number
}

export function useAgentFilesList(agentId: string | null) {
  return useQuery({
    enabled: !!agentId,
    queryKey: ['agents', 'files', 'list', agentId],
    queryFn: () => rpcCall<AgentFilesListResult>('agents.files.list', { agentId }),
    staleTime: 10_000,
  })
}

type AgentFilesGetRaw = {
  agentId: string
  workspace: string
  file: { name: string; path: string; content: string; updatedAtMs?: number }
}

export function useAgentFile(agentId: string | null, name: string | null) {
  return useQuery({
    enabled: !!agentId && !!name,
    queryKey: ['agents', 'files', 'get', agentId, name],
    queryFn: async () => {
      const raw = await rpcCall<AgentFilesGetRaw>('agents.files.get', { agentId, name })
      return {
        name: raw.file.name,
        path: raw.file.path,
        content: raw.file.content,
        updatedAtMs: raw.file.updatedAtMs,
      } satisfies AgentFilesGetResult
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveAgentFile(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; content: string }) =>
      rpcCall('agents.files.set', { agentId, name: input.name, content: input.content }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['agents', 'files', 'get', agentId, v.name] })
      qc.invalidateQueries({ queryKey: ['agents', 'files', 'list', agentId] })
    },
  })
}
