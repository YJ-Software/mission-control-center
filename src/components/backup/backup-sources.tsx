'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Shield, FolderOpen, Plus, Trash2, X, Check, Lock } from 'lucide-react'

interface BackupSource {
  id: string
  name: string
  path: string
  description: string | null
  enabled: 0 | 1
  createdAt: number
  updatedAt: number
}

export function BackupSources() {
  const t = useTranslations('backup')
  const tc = useTranslations('common')
  const queryClient = useQueryClient()

  const [showAddForm, setShowAddForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPath, setFormPath] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data: sources = [], isLoading, isError } = useQuery<BackupSource[]>({
    queryKey: ['backup-sources'],
    queryFn: async () => {
      const res = await fetch('/api/backup/sources')
      if (!res.ok) throw new Error('Failed to fetch sources')
      return res.json()
    },
  })

  const addMutation = useMutation({
    mutationFn: async (body: { name: string; path: string; description: string }) => {
      const res = await fetch('/api/backup/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to add source')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-sources'] })
      setShowAddForm(false)
      setFormName('')
      setFormPath('')
      setFormDesc('')
      setFormError(null)
    },
    onError: (err: Error) => {
      if (err.message.toLowerCase().includes('exist') || err.message.toLowerCase().includes('not found') || err.message.toLowerCase().includes('找不到')) {
        setFormError(t('sources.pathNotFound'))
      } else {
        setFormError(err.message)
      }
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: 0 | 1 }) => {
      const res = await fetch('/api/backup/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      })
      if (!res.ok) throw new Error('Failed to update source')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-sources'] })
    },
  })

  const [deleteError, setDeleteError] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backup/sources?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to delete source')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-sources'] })
      setDeleteConfirmId(null)
      setDeleteError(null)
    },
    onError: (err: Error) => {
      if (err.message === 'DELETE_BLOCKED') {
        setDeleteError(t('sources.deleteBlocked'))
      } else {
        setDeleteError(err.message)
      }
    },
  })

  function handleAdd() {
    setFormError(null)
    if (!formName.trim() || !formPath.trim()) return
    addMutation.mutate({ name: formName.trim(), path: formPath.trim(), description: formDesc.trim() })
  }

  function handleCancelAdd() {
    setShowAddForm(false)
    setFormName('')
    setFormPath('')
    setFormDesc('')
    setFormError(null)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/60 uppercase tracking-wider">
          {t('sources.title')}
        </h2>
        <button
          onClick={() => { setShowAddForm(v => !v); setFormError(null) }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('sources.addFolder')}
        </button>
      </div>

      {/* Inline Add Form */}
      {showAddForm && (
        <div className="cyber-card p-4 border-cyan-500/30 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('sources.folderName')}
              </label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
                placeholder={t('sources.folderName')}
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
                {t('sources.folderPath')}
              </label>
              <input
                type="text"
                value={formPath}
                onChange={e => { setFormPath(e.target.value); setFormError(null) }}
                className={`w-full bg-white/[0.05] border rounded-md px-3 py-1.5 text-sm text-white font-mono placeholder:text-white/30 focus:outline-none transition-colors ${formError ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/10 focus:border-cyan-500/50'}`}
                placeholder="/path/to/folder"
              />
              {formError && (
                <p className="mt-1 text-[11px] text-red-400">{formError}</p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-white/40 uppercase tracking-wider mb-1">
              {t('sources.description')}
            </label>
            <input
              type="text"
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
              placeholder={t('sources.description')}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !formName.trim() || !formPath.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {tc('save')}
            </button>
            <button
              onClick={handleCancelAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-white/50 hover:text-white/70 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* OpenClaw Built-in Card */}
      <div className="cyber-card p-4 border-cyan-500/20">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white">{t('sources.openClaw')}</span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Lock className="w-2.5 h-2.5" />
                Built-in
              </span>
            </div>
            <p className="mt-1 text-[12px] text-white/50">{t('sources.openClawDesc')}</p>
          </div>
          {/* Always-on indicator */}
          <div className="shrink-0 w-9 h-5 rounded-full bg-cyan-500/30 border border-cyan-500/40 flex items-center justify-end px-0.5" title="Always enabled">
            <div className="w-4 h-4 rounded-full bg-cyan-400" />
          </div>
        </div>
      </div>

      {/* Extra Sources */}
      {isLoading && (
        <div className="text-white/40 text-sm font-mono px-1">{tc('loading')}</div>
      )}
      {isError && (
        <div className="text-red-400 text-sm font-mono px-1">{tc('error')}</div>
      )}
      {!isLoading && !isError && sources.map(source => {
        const isEnabled = source.enabled === 1
        const isConfirmingDelete = deleteConfirmId === source.id

        return (
          <div key={source.id} className="cyber-card p-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <FolderOpen className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{source.name}</div>
                <div className="mt-0.5 text-[12px] font-mono text-cyan-300/70 truncate">{source.path}</div>
                {source.description && (
                  <p className="mt-1 text-[12px] text-white/50">{source.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Toggle */}
                <button
                  onClick={() => toggleMutation.mutate({ id: source.id, enabled: isEnabled ? 0 : 1 })}
                  disabled={toggleMutation.isPending}
                  className={`w-9 h-5 rounded-full border transition-colors flex items-center px-0.5 ${isEnabled ? 'bg-cyan-500/30 border-cyan-500/40 justify-end' : 'bg-white/5 border-white/10 justify-start'}`}
                  title={isEnabled ? tc('enabled') : tc('disabled')}
                >
                  <div className={`w-4 h-4 rounded-full transition-colors ${isEnabled ? 'bg-cyan-400' : 'bg-white/20'}`} />
                </button>

                {/* Delete */}
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      onClick={() => { setDeleteError(null); deleteMutation.mutate(source.id) }}
                      disabled={deleteMutation.isPending}
                      className="px-2 py-1 rounded text-[11px] bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                    >
                      {tc('delete')}
                    </button>
                    <button
                      onClick={() => { setDeleteConfirmId(null); setDeleteError(null) }}
                      className="px-2 py-1 rounded text-[11px] text-white/40 hover:text-white/60 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    {deleteError && deleteConfirmId === source.id && (
                      <div className="w-full text-[11px] text-red-400 mt-1">{deleteError}</div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(source.id)}
                    className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title={tc('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
