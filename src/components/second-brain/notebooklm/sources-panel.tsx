'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Globe, FileText, Youtube, Trash2, Loader2, Plus, RefreshCw, Edit3, Check, X,
} from 'lucide-react'
import { SourceAddDialog } from './source-add-dialog'

interface Source {
  id: string
  title: string
  type: string
  url?: string
}

const TYPE_ICONS: Record<string, typeof Globe> = {
  web_page: Globe,
  youtube: Youtube,
}

export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const t = useTranslations('secondBrain.notebooklm.sourcePanel')
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const { data: sources = [], isLoading } = useQuery<Source[]>({
    queryKey: ['nlm-sources', notebookId],
    queryFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/sources`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (sourceIds: string[]) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/sources`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds }),
      })
      if (!res.ok) throw new Error('Delete failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nlm-sources', notebookId] }),
  })

  const renameMutation = useMutation({
    mutationFn: async ({ sourceId, title }: { sourceId: string; title: string }) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/sources/${sourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error('Rename failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nlm-sources', notebookId] })
      setEditingId(null)
    },
  })

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/sources/stale`, { method: 'POST' })
      if (!res.ok) throw new Error('Sync failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nlm-sources', notebookId] }),
  })

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('add')}
        </button>
        {sources.some(s => s.type === 'drive' || s.type === 'google_drive') && (
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.06] text-white/50 hover:bg-white/[0.1] border border-white/[0.1] transition-colors disabled:opacity-40"
          >
            {syncMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {syncMutation.isPending ? t('syncing') : t('sync')}
          </button>
        )}
      </div>

      {/* Add dialog */}
      {showAdd && (
        <SourceAddDialog
          notebookId={notebookId}
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false)
            queryClient.invalidateQueries({ queryKey: ['nlm-sources', notebookId] })
          }}
        />
      )}

      {/* Sources list */}
      {sources.length === 0 ? (
        <div className="text-center py-8 text-white/30 text-sm">{t('noSources')}</div>
      ) : (
        <div className="space-y-1">
          {sources.map((src) => {
            const Icon = TYPE_ICONS[src.type] || FileText
            const isEditing = editingId === src.id
            return (
              <div key={src.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] group">
                <Icon className="w-4 h-4 text-white/30 shrink-0" />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-cyan-500/30 rounded px-2 py-1 text-sm text-white/90 focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameMutation.mutate({ sourceId: src.id, title: editTitle })
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <button onClick={() => renameMutation.mutate({ sourceId: src.id, title: editTitle })} className="p-1 text-cyan-400 hover:text-cyan-300"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-white/30 hover:text-white/60"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-white/80 truncate">{src.title}</div>
                      <div className="text-[11px] text-white/25 font-mono">{src.type}</div>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(src.id); setEditTitle(src.title) }}
                      className="p-1 text-white/30 hover:text-white/60"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(t('confirmDelete'))) deleteMutation.mutate([src.id]) }}
                      disabled={deleteMutation.isPending}
                      className="p-1 text-red-400/40 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
