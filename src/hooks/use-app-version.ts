'use client'

import { useQuery } from '@tanstack/react-query'

export function useAppVersion() {
  return useQuery({
    queryKey: ['app-version'],
    queryFn: () => fetch('/api/health').then(r => r.json()),
    staleTime: Infinity,
    select: (data) => ({
      mccVersion: data.mccVersion as string,
      commit: data.commit as string | null,
      backendVersion: data.backend?.version as string | undefined,
    }),
  })
}
