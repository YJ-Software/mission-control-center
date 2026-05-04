import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

type ChannelsStatusRaw = {
  ts: number
  channels: Record<
    string,
    { configured: boolean; running: boolean; mode?: string; lastError?: string | null }
  >
  channelAccounts?: Record<string, Array<{ accountId: string; displayName?: string }>>
}

export type ChannelRow = {
  id: string
  provider: string
  connected: boolean
  policy?: string
  displayName?: string
}

export function useAgentChannels(_agentId: string | null) {
  return useQuery({
    queryKey: ['agents', 'channels'],
    queryFn: async () => {
      const raw = await rpcCall<ChannelsStatusRaw>('channels.status', {})
      const channels: ChannelRow[] = Object.entries(raw.channels ?? {}).map(([id, ch]) => {
        const account = raw.channelAccounts?.[id]?.[0]
        return {
          id,
          provider: id,
          connected: !!ch.running,
          policy: ch.mode,
          displayName: account?.displayName,
        }
      })
      return { channels }
    },
    staleTime: 15_000,
  })
}

export function useLogoutChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rpcCall('channels.logout', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'channels'] }),
  })
}
