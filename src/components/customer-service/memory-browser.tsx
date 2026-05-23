'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Loader2,
  Trash2,
  Search,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Users,
  Clock,
} from 'lucide-react'

interface MemoryItem {
  id?: string
  memory?: string
  text?: string
  score?: number
  metadata?: Record<string, unknown>
  user_id?: string
  created_at?: string
  updated_at?: string
}

interface Customer {
  userId: string
  lastSeen: string | null
  sessionKey: string | null
  source: ('session' | 'memory')[]
  memoryCount?: number
  displayName?: string | null
  pictureUrl?: string | null
}

function unwrapResults(result: unknown): MemoryItem[] {
  if (Array.isArray(result)) return result as MemoryItem[]
  if (result && typeof result === 'object' && 'results' in (result as any)) {
    return ((result as { results?: MemoryItem[] }).results ?? []) as MemoryItem[]
  }
  return []
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function shortId(id: string): string {
  if (id.length <= 16) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}

export function MemoryBrowser() {
  const t = useTranslations('customerService.memory.browser')
  const [userId, setUserId] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MemoryItem[] | null>(null)
  const [busy, setBusy] = useState<'list' | 'search' | 'add' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addContent, setAddContent] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const { data: customersData, refetch: refetchCustomers, isFetching: customersLoading } = useQuery<{ customers: Customer[] }>({
    queryKey: ['cs-mem0-customers'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/memory/customers')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 60000,
  })

  const customers = useMemo(() => {
    const list = customersData?.customers ?? []
    if (!filter.trim()) return list
    const q = filter.trim().toLowerCase()
    return list.filter((c) =>
      c.userId.toLowerCase().includes(q)
      || (c.displayName?.toLowerCase().includes(q) ?? false),
    )
  }, [customersData, filter])

  // Auto-load when picking a customer
  useEffect(() => {
    if (!userId) return
    void load(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function load(uid?: string) {
    const target = (uid ?? userId).trim()
    if (!target) {
      setError(t('errors.userIdRequired'))
      return
    }
    setBusy('list')
    setError(null)
    try {
      const res = await fetch(`/api/customer-service/memory/items?userId=${encodeURIComponent(target)}&limit=50`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setItems(unwrapResults(json.result))
      setInfo(null)
    } catch (err: any) {
      setError(err?.message ?? 'failed')
    } finally {
      setBusy(null)
    }
  }

  async function runSearch() {
    if (!userId.trim() || !query.trim()) {
      setError(t('errors.userIdAndQueryRequired'))
      return
    }
    setBusy('search')
    setError(null)
    try {
      const res = await fetch('/api/customer-service/memory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', userId: userId.trim(), query: query.trim(), limit: 10 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setItems(unwrapResults(json.result))
      setInfo(null)
    } catch (err: any) {
      setError(err?.message ?? 'failed')
    } finally {
      setBusy(null)
    }
  }

  async function add() {
    if (!userId.trim() || !addContent.trim()) {
      setError(t('errors.userIdAndContentRequired'))
      return
    }
    setBusy('add')
    setError(null)
    try {
      const res = await fetch('/api/customer-service/memory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          userId: userId.trim(),
          content: addContent.trim(),
          metadata: { source: 'mcc-tester' },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      const added = unwrapResults(json.result)
      setInfo(t('info.added', { count: added.length }))
      setAddContent('')
      await load()
      void refetchCustomers()
    } catch (err: any) {
      setError(err?.message ?? 'failed')
    } finally {
      setBusy(null)
    }
  }

  async function deleteOne(id: string) {
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch('/api/customer-service/memory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', memoryId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setItems((prev) => (prev ?? []).filter((m) => m.id !== id))
      setInfo(t('info.deleted'))
    } catch (err: any) {
      setError(err?.message ?? 'failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Customer picker */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
          <button
            onClick={() => void refetchCustomers()}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded
              bg-white/[0.04] text-white/60 hover:bg-white/[0.08] border border-white/[0.08]"
          >
            <RefreshCw className={`w-3 h-3 ${customersLoading ? 'animate-spin' : ''}`} />
            {t('actions.refreshCustomers')}
          </button>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-3">{t('description')}</p>

        <div className="flex gap-2 mb-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('fields.filterPlaceholder')}
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90 font-mono"
          />
        </div>

        {customers.length === 0 ? (
          <div className="text-xs text-white/40 flex items-center gap-2 py-3">
            <AlertTriangle className="w-3.5 h-3.5" />
            {customersLoading ? t('emptyLoading') : t('noCustomers')}
          </div>
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-white/[0.06] bg-white/[0.01]">
            {customers.map((c) => {
              const active = userId === c.userId
              const hasMem = (c.memoryCount ?? 0) > 0
              const primary = c.displayName?.trim() || shortId(c.userId)
              const isAnon = !c.displayName
              return (
                <button
                  key={c.userId}
                  onClick={() => setUserId(c.userId)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2 border-b border-white/[0.04] last:border-b-0 transition-colors ${
                    active ? 'bg-cyan-500/[0.08]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  {c.pictureUrl ? (
                    <img src={c.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-600 to-purple-600 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                      {(primary[0] ?? '?').toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${active ? 'text-cyan-200' : 'text-white/90'} ${isAnon ? 'font-mono text-xs' : ''}`}>
                      {primary}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-white/40">
                      <span className="font-mono">{shortId(c.userId)}</span>
                      <span className="text-white/20">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatRelative(c.lastSeen)}
                      </span>
                      {c.source.includes('session') && (
                        <span className="text-white/40">session</span>
                      )}
                      {hasMem && (
                        <span className="text-emerald-400/80">{c.memoryCount} memories</span>
                      )}
                    </div>
                  </div>
                  {active && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t('fields.manualUserIdPlaceholder')}
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-white/70 font-mono"
          />
          <button
            onClick={() => load()}
            disabled={busy !== null || !userId}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
              disabled:opacity-50"
          >
            {busy === 'list' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('actions.load')}
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-white/60 mb-1">{t('fields.query')}</label>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('fields.queryPlaceholder')}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
            />
            <button
              onClick={runSearch}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.08]
                disabled:opacity-50"
            >
              {busy === 'search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t('actions.search')}
            </button>
          </div>
        </div>
      </div>

      {/* Tester */}
      <div className="cyber-card p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-1">{t('tester.title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed mb-3">{t('tester.description')}</p>
        <textarea
          value={addContent}
          onChange={(e) => setAddContent(e.target.value)}
          placeholder={t('tester.placeholder')}
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={add}
            disabled={busy !== null || !userId}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
              disabled:opacity-50"
          >
            {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('tester.add')}
          </button>
          {!userId && <span className="text-xs text-white/40">{t('tester.needsUserId')}</span>}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-red-500/10 text-red-300 border-red-500/20 text-sm">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {info && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          {info}
        </div>
      )}

      {items !== null && (
        <div className="cyber-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white/90">{t('listTitle')}</h3>
            <span className="text-xs text-white/40">{t('listCount', { count: items.length })}</span>
          </div>
          {items.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-white/40">
              <AlertTriangle className="w-4 h-4" /> {t('empty')}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((m) => (
                <div
                  key={m.id ?? Math.random()}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-white/90 leading-snug">
                        {m.memory ?? m.text ?? '(no content)'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-white/40">
                        {typeof m.score === 'number' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                            score {m.score.toFixed(2)}
                          </span>
                        )}
                        {m.created_at && <span>· {new Date(m.created_at).toLocaleString()}</span>}
                        {m.id && <span className="font-mono text-white/30">· {m.id.slice(0, 8)}</span>}
                      </div>
                    </div>
                    {m.id && (
                      <button
                        onClick={() => deleteOne(m.id!)}
                        disabled={busy !== null}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs rounded
                          text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20
                          disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
