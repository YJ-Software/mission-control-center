'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Save, Hash, Clock, FileText } from 'lucide-react'

interface DescribeData {
  value?: {
    summary?: string[]
    suggested_topics?: string[]
  }
}

export function InfoPanel({ notebookId, title, sourceCount, updatedAt }: {
  notebookId: string
  title: string
  sourceCount?: number
  updatedAt?: string
}) {
  const t = useTranslations('secondBrain.notebooklm.infoPanel')
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState(title)

  const { data: describe, isLoading } = useQuery<DescribeData>({
    queryKey: ['nlm-describe', notebookId],
    queryFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/describe`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const renameMutation = useMutation({
    mutationFn: async (t: string) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nlm-status'] })
    },
  })

  const summary = describe?.value?.summary?.join('\n\n') || ''
  const topics = describe?.value?.suggested_topics || []

  return (
    <div className="space-y-6">
      {/* Metadata */}
      <div className="cyber-card p-4 space-y-3">
        {/* Rename */}
        <div>
          <label className="block text-xs text-white/40 mb-1.5">{t('rename')}</label>
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 focus:outline-none focus:border-cyan-500/40"
            />
            <button
              onClick={() => renameMutation.mutate(newTitle)}
              disabled={renameMutation.isPending || newTitle === title || !newTitle.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40"
            >
              {renameMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {t('saving')}
            </button>
          </div>
        </div>

        {/* Info fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Hash className="w-3.5 h-3.5" />
            <span>{t('id')}: </span>
            <span className="font-mono text-white/60 truncate">{notebookId}</span>
          </div>
          {updatedAt && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <Clock className="w-3.5 h-3.5" />
              <span>{t('updated')}: {new Date(updatedAt).toLocaleString()}</span>
            </div>
          )}
          {sourceCount !== undefined && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <FileText className="w-3.5 h-3.5" />
              <span>{t('sourceCount')}: {sourceCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* AI Summary */}
      <div className="cyber-card p-4">
        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{t('summary')}</h4>
        {isLoading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('loading')}
          </div>
        ) : summary ? (
          <div className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{summary}</div>
        ) : (
          <div className="text-sm text-white/30">{t('noSummary')}</div>
        )}
      </div>

      {/* Topics */}
      {topics.length > 0 && (
        <div className="cyber-card p-4">
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{t('topics')}</h4>
          <div className="flex flex-wrap gap-2">
            {topics.map((topic, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/20">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
