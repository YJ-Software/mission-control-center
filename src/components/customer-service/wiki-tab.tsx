'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus, Loader2, Trash2, Save, BookText, X, AlertCircle, CheckCircle2 } from 'lucide-react'

interface WikiEntrySummary {
  id: string
  title: string
  status: string
  sourceType: string
  updatedAt: string
  filename: string
}

interface WikiEntryDetail extends WikiEntrySummary {
  content: string
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export function WikiTab() {
  const t = useTranslations('customerService.wiki')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<{ filename: string | null; title: string; content: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const listQuery = useQuery<{ entries: WikiEntrySummary[] } | { error: string }>({
    queryKey: ['cs-wiki-entries'],
    queryFn: () => fetch('/api/customer-service/wiki-entries').then(r => r.json()),
  })

  const detailQuery = useQuery<WikiEntryDetail>({
    queryKey: ['cs-wiki-entry', editing?.filename],
    queryFn: async () => {
      const res = await fetch(`/api/customer-service/wiki-entries?filename=${encodeURIComponent(editing!.filename!)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'fetch failed')
      return res.json()
    },
    enabled: !!editing?.filename,
  })

  // Hydrate edit form when detail loads. Tracked separately from `editing`
  // so user edits don't get clobbered by stale fetches.
  useEffect(() => {
    if (!editing?.filename || !detailQuery.data) return
    if (editing.title === '' && editing.content === '') {
      setEditing({
        filename: editing.filename,
        title: detailQuery.data.title,
        content: detailQuery.data.content,
      })
    }
  }, [editing, detailQuery.data])

  const saveMutation = useMutation({
    mutationFn: async (input: { filename: string | null; title: string; content: string }) => {
      const isNew = input.filename === null
      const res = await fetch('/api/customer-service/wiki-entries', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isNew
            ? { title: input.title, content: input.content }
            : { filename: input.filename, title: input.title, content: input.content },
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'save failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-wiki-entries'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`/api/customer-service/wiki-entries?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'delete failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-wiki-entries'] })
      setConfirmDelete(null)
    },
  })

  const list = listQuery.data && 'entries' in listQuery.data ? listQuery.data.entries : []
  const listError = listQuery.data && 'error' in listQuery.data ? listQuery.data.error : null

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <BookText className="w-4 h-4 text-cyan-400/70" />
              {t('title')}
            </h3>
            <p className="text-xs text-white/40 mt-1">{t('description')}</p>
          </div>
          <button
            onClick={() => setEditing({ filename: null, title: '', content: '' })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('addNew')}
          </button>
        </div>

        {listError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{listError}</span>
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-white/40 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {t('loading')}
          </div>
        ) : list.length === 0 && !listError ? (
          <div className="text-center py-8 text-white/40 text-sm">{t('empty')}</div>
        ) : list.length > 0 ? (
          <div className="space-y-1.5">
            {list.map(entry => (
              <div
                key={entry.filename}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors"
              >
                <button
                  onClick={() => setEditing({ filename: entry.filename, title: '', content: '' })}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-sm text-white/90 truncate">{entry.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-white/30 font-mono">{entry.sourceType}</span>
                    <span className="text-[10px] text-white/30">·</span>
                    <span className="text-[10px] text-white/30">{fmtDate(entry.updatedAt)}</span>
                    {entry.status !== 'active' && (
                      <>
                        <span className="text-[10px] text-white/30">·</span>
                        <span className="text-[10px] text-amber-400/80">{entry.status}</span>
                      </>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDelete(entry.filename)}
                  className="p-1.5 rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title={t('delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Edit / Create modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-white/[0.1] bg-[#0a0a1a] shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
              <h3 className="text-sm font-medium text-white">
                {editing.filename === null ? t('createTitle') : t('editTitle')}
              </h3>
              <button
                onClick={() => setEditing(null)}
                className="p-1 rounded-md text-white/40 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {editing.filename && detailQuery.isLoading ? (
                <div className="flex items-center justify-center py-8 text-white/40 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {t('loading')}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">{t('fieldTitle')}</label>
                    <input
                      type="text"
                      value={editing.title}
                      onChange={e => setEditing({ ...editing, title: e.target.value })}
                      placeholder={t('titlePlaceholder')}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1">{t('fieldContent')}</label>
                    <textarea
                      value={editing.content}
                      onChange={e => setEditing({ ...editing, content: e.target.value })}
                      placeholder={t('contentPlaceholder')}
                      rows={14}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-500/50 resize-y"
                    />
                    <p className="text-[10px] text-white/30 mt-1">{t('contentHint')}</p>
                  </div>
                </>
              )}

              {saveMutation.isError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{(saveMutation.error as Error).message}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-white/[0.08]">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 rounded-lg text-sm bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => saveMutation.mutate(editing)}
                disabled={
                  saveMutation.isPending ||
                  !editing.title.trim() ||
                  !editing.content.trim()
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saveMutation.isSuccess ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-[#0a0a1a] p-5 shadow-2xl">
            <h3 className="text-sm font-medium text-white mb-2">{t('deleteConfirmTitle')}</h3>
            <p className="text-xs text-white/60 mb-4">{t('deleteConfirmBody', { name: confirmDelete })}</p>
            {deleteMutation.isError && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{(deleteMutation.error as Error).message}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded-lg text-sm bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
