'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Loader2, Download, Trash2, Edit3, Check, X,
  Headphones, Video, FileImage, FileSpreadsheet, FileText, Brain, HelpCircle, BookOpen,
  Presentation,
} from 'lucide-react'

interface Artifact {
  id: string
  type: string
  status: string
  title?: string
}

const DOWNLOAD_TYPES = [
  { key: 'audio', icon: Headphones },
  { key: 'video', icon: Video },
  { key: 'slide-deck', icon: Presentation },
  { key: 'infographic', icon: FileImage },
  { key: 'report', icon: FileText },
  { key: 'mind-map', icon: Brain },
  { key: 'data-table', icon: FileSpreadsheet },
  { key: 'quiz', icon: HelpCircle },
  { key: 'flashcards', icon: BookOpen },
]

export function StudioPanel({ notebookId }: { notebookId: string }) {
  const t = useTranslations('secondBrain.notebooklm.studioPanel')
  const queryClient = useQueryClient()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const { data: artifacts = [], isLoading } = useQuery<Artifact[]>({
    queryKey: ['nlm-studio', notebookId],
    queryFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/studio`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const renameMutation = useMutation({
    mutationFn: async ({ artifactId, title }: { artifactId: string; title: string }) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/studio/${artifactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nlm-studio', notebookId] }); setEditingId(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: async (artifactId: string) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/studio/${artifactId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nlm-studio', notebookId] }),
  })

  async function handleDownload(type: string) {
    setDownloading(type)
    try {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/download?type=${type}`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const filenameMatch = disposition.match(/filename="(.+)"/)
      const filename = filenameMatch?.[1] || `notebooklm-${type}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
    setDownloading(null)
  }

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Artifacts list */}
      {artifacts.length > 0 && (
        <div className="space-y-1">
          {artifacts.map((art) => (
            <div key={art.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] group">
              <div className="flex-1 min-w-0">
                {editingId === art.id ? (
                  <div className="flex items-center gap-1.5">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 bg-white/[0.06] border border-cyan-500/30 rounded px-2 py-1 text-sm text-white/90 focus:outline-none" autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') renameMutation.mutate({ artifactId: art.id, title: editTitle }); if (e.key === 'Escape') setEditingId(null) }}
                    />
                    <button onClick={() => renameMutation.mutate({ artifactId: art.id, title: editTitle })} className="p-1 text-cyan-400"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-white/30"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-white/80">{art.title || art.type}</div>
                    <div className="text-[11px] text-white/25 font-mono">{art.type} · {art.status}</div>
                  </>
                )}
              </div>
              {editingId !== art.id && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingId(art.id); setEditTitle(art.title || '') }} className="p-1 text-white/30 hover:text-white/60"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteMutation.mutate(art.id)} className="p-1 text-red-400/40 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Download grid */}
      <div>
        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{t('download')}</h4>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {DOWNLOAD_TYPES.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleDownload(key)}
              disabled={downloading === key}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors disabled:opacity-40 text-center"
            >
              {downloading === key ? <Loader2 className="w-5 h-5 animate-spin text-cyan-400" /> : <Icon className="w-5 h-5 text-white/40" />}
              <span className="text-[11px] text-white/50 leading-tight">{t(`types.${key}`)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
