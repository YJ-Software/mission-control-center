import { useQuery } from '@tanstack/react-query'

interface Agent {
  id: string
  name: string
  role?: string
  description?: string
  [key: string]: unknown
}

export function useAgents() {
  return useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/agents').then(r => r.json()),
    refetchInterval: 30000,
  })
}
