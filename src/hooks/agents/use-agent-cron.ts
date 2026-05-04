import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

export type CronJob = {
  id: string
  name: string
  agentId?: string
  enabled: boolean
  createdAtMs: number
  nextRunAtMs?: number
  lastStatus?: string
}

export function useAgentCronJobs(agentId: string | null) {
  return useQuery({
    enabled: !!agentId,
    queryKey: ['agents', 'cron', 'list', agentId],
    queryFn: async () => {
      const res = await rpcCall<{ jobs: CronJob[] }>('cron.list', {})
      return res.jobs.filter((j) => j.agentId === agentId)
    },
    staleTime: 10_000,
  })
}

export function useCronStatus() {
  return useQuery({
    queryKey: ['agents', 'cron', 'status'],
    queryFn: () =>
      rpcCall<{ enabled: boolean; totalJobs: number; nextRunAtMs?: number }>('cron.status', {}),
    staleTime: 10_000,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, agentId: string | null) {
  qc.invalidateQueries({ queryKey: ['agents', 'cron', 'list', agentId] })
  qc.invalidateQueries({ queryKey: ['agents', 'cron', 'status'] })
}

export function useCronEnabled(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpcCall('cron.update', { id, patch: { enabled } }),
    onSuccess: () => invalidate(qc, agentId),
  })
}

export function useRunCron(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpcCall('cron.run', { id, mode: 'force' }),
    onSuccess: () => invalidate(qc, agentId),
  })
}

export function useRemoveCron(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpcCall('cron.remove', { id }),
    onSuccess: () => invalidate(qc, agentId),
  })
}
