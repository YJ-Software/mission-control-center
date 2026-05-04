'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Search, Download } from 'lucide-react'

export function ResearchPanel({ notebookId }: { notebookId: string }) {
  const t = useTranslations('secondBrain.notebooklm.researchPanel')
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery<{ ok: boolean; output: string }>({
    queryKey: ['nlm-research', notebookId],
    queryFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/research`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: 10000,
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nlm-research', notebookId] }),
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import' }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nlm-research', notebookId] })
      queryClient.invalidateQueries({ queryKey: ['nlm-sources', notebookId] })
    },
  })

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40"
        >
          {startMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {startMutation.isPending ? t('starting') : t('start')}
        </button>
        <button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-white/[0.06] text-white/50 hover:bg-white/[0.1] border border-white/[0.1] transition-colors disabled:opacity-40"
        >
          {importMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {importMutation.isPending ? t('importing') : t('import')}
        </button>
      </div>

      {/* Status output */}
      <div className="cyber-card p-4">
        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">{t('output')}</h4>
        <pre className="font-mono text-xs text-white/60 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
          {status?.output || t('idle')}
        </pre>
      </div>
    </div>
  )
}
