'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search, X, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { SessionInfo } from '@/lib/sessions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatCost(c: number): string {
  if (c <= 0) return '-'
  return `$${c.toFixed(2)}`
}

function timeAgo(ts: number): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function getSessionType(s: SessionInfo): string {
  if (s.key.includes('cron')) return 'cron'
  if (s.key.includes('subagent')) return 'sub'
  if (s.kind === 'group' || s.key.includes('group')) return 'group'
  if (s.key.includes(':main:')) return 'main'
  return ''
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case 'cron': return 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30'
    case 'sub': return 'bg-cyan-400/15 text-cyan-400 border-cyan-400/30'
    case 'group': return 'bg-purple-400/15 text-purple-400 border-purple-400/30'
    case 'main': return 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30'
    default: return 'bg-white/5 text-white/30 border-white/10'
  }
}

function statusColor(s: SessionInfo): string {
  if (s.aborted) return 'bg-red-400'
  if (Date.now() - s.updatedAt < 300_000) return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
  return 'bg-white/20'
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-[11px] font-semibold rounded-full border cursor-pointer transition-colors ${
        active
          ? 'bg-cyan-400/20 text-cyan-400 border-cyan-400/40'
          : 'bg-white/[0.03] text-white/40 border-white/[0.08] hover:bg-white/[0.06]'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Expandable session row detail
// ---------------------------------------------------------------------------

interface SessionMessage {
  role: string
  content: string
  timestamp: string
}

function SessionDetail({ session, onFullView }: { session: SessionInfo; onFullView: () => void }) {
  const { data } = useQuery<{ messages: SessionMessage[] }>({
    queryKey: ['session-messages', session.sessionId],
    queryFn: () => fetch(`/api/sessions?messages=${encodeURIComponent(session.sessionId)}`).then(r => r.json()),
  })
  const messages = data?.messages ?? []

  return (
    <div className="bg-white/[0.02] border-t border-white/[0.05] px-6 py-4">
      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-4">
        {[
          ['SESSION KEY', session.key],
          ['MODEL', session.model],
          ['TOKENS', session.totalTokens.toLocaleString()],
          ['COST', formatCost(session.cost)],
          ['CHANNEL', session.channel],
          ['CREATED', session.createdAt ? new Date(session.createdAt).toLocaleString() : '-'],
          ['LAST ACTIVE', timeAgo(session.updatedAt)],
        ].map(([label, value]) => (
          <div key={label as string}>
            <div className="font-mono text-[9px] text-white/30 uppercase tracking-widest mb-1">{label}</div>
            <div className="font-mono text-[12px] text-white/70 truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Recent Messages</span>
        <button
          onClick={onFullView}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 rounded cursor-pointer hover:bg-cyan-400/20 transition-colors"
        >
          Full View <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center py-4">
            <span className="font-mono text-[10px] text-white/20">No messages</span>
          </div>
        ) : (
          messages.slice(-10).map((msg, i) => (
            <div key={i} className="flex gap-2 py-1">
              <span className={`font-mono text-[10px] font-bold shrink-0 w-20 uppercase ${
                msg.role === 'assistant' ? 'text-emerald-400' :
                msg.role === 'user' ? 'text-cyan-400' : 'text-yellow-400'
              }`}>
                {msg.role}
              </span>
              <span className="font-mono text-[10px] text-white/30 shrink-0 w-16">
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <span className="font-mono text-[11px] text-white/50 truncate">{msg.content}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Full view modal
// ---------------------------------------------------------------------------

function SessionModal({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const { data } = useQuery<{ messages: SessionMessage[] }>({
    queryKey: ['session-messages-full', session.sessionId],
    queryFn: () => fetch(`/api/sessions?messages=${encodeURIComponent(session.sessionId)}`).then(r => r.json()),
  })
  const messages = data?.messages ?? []
  const isActive = Date.now() - session.updatedAt < 300_000

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d1117] border border-white/[0.08] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-white/[0.06] flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{session.label}</h2>
            <p className="font-mono text-[11px] text-white/30 mt-0.5">{session.key}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded cursor-pointer">
            <X className="w-5 h-5 text-white/40" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 p-5 border-b border-white/[0.06]">
          {[
            ['STATUS', isActive ? 'Active' : session.aborted ? 'Aborted' : 'Idle'],
            ['MODEL', session.model],
            ['TOKENS', session.totalTokens.toLocaleString()],
            ['COST', formatCost(session.cost)],
            ['LAST ACTIVE', timeAgo(session.updatedAt)],
            ['CHANNEL', session.channel],
          ].map(([label, value]) => (
            <div key={label as string}>
              <div className="font-mono text-[9px] text-white/30 uppercase tracking-widest mb-1">{label}</div>
              <div className="font-mono text-[13px] text-white/80 flex items-center gap-1.5">
                {label === 'STATUS' && <span className={`w-2 h-2 rounded-full ${statusColor(session)}`} />}
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-3">Recent Messages</div>
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className="border-b border-white/[0.04] pb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-mono text-[10px] font-bold uppercase ${
                    msg.role === 'assistant' ? 'text-emerald-400' :
                    msg.role === 'user' ? 'text-cyan-400' : 'text-yellow-400'
                  }`}>
                    {msg.role}
                  </span>
                  <span className="font-mono text-[10px] text-white/20">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <pre className="font-mono text-[11px] text-white/50 whitespace-pre-wrap break-all leading-relaxed">{msg.content}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session Timeline (Gantt chart)
// ---------------------------------------------------------------------------

const TIMELINE_COLORS: Record<string, string> = {
  main: '#a78bfa',   // purple-400
  sub: '#22d3ee',    // cyan-400
  cron: '#facc15',   // yellow-400
  group: '#60a5fa',  // blue-400
}

function SessionTimeline({ sessions, dateFilter }: { sessions: SessionInfo[]; dateFilter: string }) {
  const { items, ticks, rangeMs, start } = useMemo(() => {
    const now = Date.now()
    const ms = dateFilter === 'today' ? 86400000
      : dateFilter === '7d' ? 7 * 86400000
      : dateFilter === '30d' ? 30 * 86400000
      : 30 * 86400000
    const s = now - ms

    // Deduplicate by label, keep most recent, max 12
    const seen = new Set<string>()
    const deduped = [...sessions]
      .filter(x => x.updatedAt > s)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(x => { if (seen.has(x.label)) return false; seen.add(x.label); return true })
      .slice(0, 12)

    // Time axis ticks
    const tickCount = dateFilter === 'today' ? 6 : 7
    const tickArr: { pct: number; label: string }[] = []
    for (let i = 0; i <= tickCount; i++) {
      const t = s + (ms / tickCount) * i
      const d = new Date(t)
      const label = dateFilter === 'today'
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
      tickArr.push({ pct: (i / tickCount) * 100, label })
    }

    return { items: deduped, ticks: tickArr, rangeMs: ms, start: s }
  }, [sessions, dateFilter])

  if (items.length === 0) {
    return (
      <div className="cyber-card p-4">
        <div className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-3">Session Timeline</div>
        <div className="text-center py-4 font-mono text-[11px] text-white/20">No sessions in range</div>
      </div>
    )
  }

  return (
    <div className="cyber-card p-4">
      <div className="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-3">Session Timeline</div>
      <div className="space-y-1.5">
        {items.map((s, i) => {
          const type = getSessionType(s)
          const color = TIMELINE_COLORS[type] || TIMELINE_COLORS.main
          const created = Math.max(s.createdAt || s.updatedAt, start)
          const leftPct = Math.max(((created - start) / rangeMs) * 100, 0)
          const rightPct = Math.min(((s.updatedAt - start) / rangeMs) * 100, 100)
          const widthPct = Math.max(rightPct - leftPct, 1)

          return (
            <div key={`${s.key}-${i}`} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-right font-mono text-[11px] text-white/40 truncate">
                {s.label}
              </div>
              <div className="flex-1 h-3.5 bg-white/[0.03] rounded relative overflow-hidden">
                <div
                  className="absolute h-full rounded"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {/* Time axis */}
      <div className="relative h-4 ml-[104px] mt-1">
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute font-mono text-[9px] text-white/25 -translate-x-1/2"
            style={{ left: `${t.pct}%`, bottom: 0 }}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | 'active' | 'idle' | 'sub' | 'cron' | 'group'
type DateFilter = 'today' | '7d' | '30d' | 'all'
type SortKey = 'updated' | 'tokens' | 'cost' | 'label'

export function SessionsContent() {
  const searchParams = useSearchParams()
  const sessionParam = searchParams.get('session')

  const { data } = useQuery<{ sessions: SessionInfo[] }>({
    queryKey: ['sessions'],
    queryFn: () => fetch('/api/sessions').then(r => r.json()),
    refetchInterval: 30000,
  })

  const sessions = data?.sessions ?? []

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>(sessionParam ? 'all' : '7d')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(sessionParam)
  const [modalSession, setModalSession] = useState<SessionInfo | null>(null)

  // Auto-expand session from URL param when data loads
  useEffect(() => {
    if (sessionParam && sessions.length > 0) {
      setExpandedKey(sessionParam)
    }
  }, [sessionParam, sessions.length])

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }, [sortKey, sortAsc])

  // Filter
  const now = Date.now()
  let filtered = [...sessions]

  if (dateFilter === 'today') {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    filtered = filtered.filter(s => s.updatedAt >= todayStart.getTime())
  } else if (dateFilter === '7d') {
    filtered = filtered.filter(s => now - s.updatedAt < 7 * 86400000)
  } else if (dateFilter === '30d') {
    filtered = filtered.filter(s => now - s.updatedAt < 30 * 86400000)
  }

  if (statusFilter === 'active') filtered = filtered.filter(s => now - s.updatedAt < 300000 && !s.aborted)
  else if (statusFilter === 'idle') filtered = filtered.filter(s => now - s.updatedAt >= 300000 && !s.aborted)
  else if (statusFilter === 'sub') filtered = filtered.filter(s => s.key.includes('subagent'))
  else if (statusFilter === 'cron') filtered = filtered.filter(s => s.key.includes('cron'))
  else if (statusFilter === 'group') filtered = filtered.filter(s => s.kind === 'group' || s.key.includes('group'))

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(s =>
      s.label.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q)
    )
  }

  // Sort
  filtered.sort((a, b) => {
    let cmp = 0
    if (sortKey === 'updated') cmp = a.updatedAt - b.updatedAt
    else if (sortKey === 'tokens') cmp = a.totalTokens - b.totalTokens
    else if (sortKey === 'cost') cmp = a.cost - b.cost
    else if (sortKey === 'label') cmp = a.label.localeCompare(b.label)
    return sortAsc ? cmp : -cmp
  })

  // Stats
  const totalTokens = filtered.reduce((sum, s) => sum + s.totalTokens, 0)
  const totalCost = filtered.reduce((sum, s) => sum + s.cost, 0)

  return (
    <div className="p-6 space-y-5">
      {/* Stats bar */}
      <div className="cyber-card p-4 flex flex-wrap items-center gap-4 sm:gap-8">
        <div>
          <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Sessions</span>
          <span className="font-mono text-base sm:text-xl font-bold text-white ml-2">{filtered.length}</span>
        </div>
        <div>
          <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Tokens</span>
          <span className="font-mono text-base sm:text-xl font-bold text-white ml-2">{formatTokens(totalTokens)}</span>
        </div>
        <div>
          <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Cost</span>
          <span className="font-mono text-base sm:text-xl font-bold text-emerald-400 ml-2">${totalCost.toFixed(2)}</span>
        </div>
      </div>

      {/* Timeline */}
      <SessionTimeline sessions={filtered} dateFilter={dateFilter} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'active', 'idle', 'sub', 'cron', 'group'] as StatusFilter[]).map(f => (
          <Chip key={f} label={f === 'all' ? 'All' : f === 'sub' ? 'Subs' : f.charAt(0).toUpperCase() + f.slice(1)}
            active={statusFilter === f} onClick={() => setStatusFilter(f)} />
        ))}
        <div className="w-px h-5 bg-white/10 mx-1" />
        {(['today', '7d', '30d', 'all'] as DateFilter[]).map(f => (
          <Chip key={f} label={f === 'all' ? 'All' : f === 'today' ? 'Today' : f}
            active={dateFilter === f} onClick={() => setDateFilter(f)} />
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 pr-3 py-1.5 text-[12px] bg-white/[0.04] border border-white/[0.08] rounded-lg text-white/70 placeholder:text-white/20 outline-none focus:border-cyan-400/30 w-40"
          />
        </div>
      </div>

      {/* Table */}
      <div className="cyber-card overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[24px_1fr_70px_120px_80px_70px_1fr_90px] gap-2 px-4 py-2.5 border-b border-white/[0.06] text-[10px] text-white/30 uppercase tracking-widest font-mono">
          <div />
          <button className="text-left cursor-pointer hover:text-white/50" onClick={() => handleSort('label')}>Name</button>
          <div>Type</div>
          <div>Model</div>
          <button className="text-right cursor-pointer hover:text-white/50" onClick={() => handleSort('tokens')}>Tokens</button>
          <button className="text-right cursor-pointer hover:text-white/50" onClick={() => handleSort('cost')}>Cost</button>
          <div>Last Message</div>
          <button className="text-right cursor-pointer hover:text-white/50" onClick={() => handleSort('updated')}>Updated</button>
        </div>

        {/* Rows */}
        <div className="max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <span className="font-mono text-[11px] text-white/20">No sessions found</span>
            </div>
          ) : (
            filtered.map(s => {
              const type = getSessionType(s)
              const isExpanded = expandedKey === s.key
              return (
                <div key={s.key}>
                  <div
                    className={`grid grid-cols-[24px_1fr_70px_120px_80px_70px_1fr_90px] gap-2 px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors items-center ${isExpanded ? 'bg-white/[0.03]' : ''}`}
                    onClick={() => setExpandedKey(isExpanded ? null : s.key)}
                  >
                    <div className="flex items-center">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-white/30" /> : <ChevronRight className="w-3.5 h-3.5 text-white/20" />}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(s)}`} />
                      <span className="text-[13px] text-white/80 truncate">{s.label}</span>
                    </div>
                    <div>
                      {type && (
                        <span className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded border ${typeBadgeClass(type)}`}>
                          {type}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-white/40 truncate">{s.model}</div>
                    <div className="font-mono text-[11px] text-white/50 text-right">{s.totalTokens.toLocaleString()}</div>
                    <div className="font-mono text-[11px] text-white/50 text-right">{formatCost(s.cost)}</div>
                    <div className="font-mono text-[11px] text-white/25 truncate">{s.lastMessage}</div>
                    <div className="font-mono text-[11px] text-white/30 text-right">{timeAgo(s.updatedAt)}</div>
                  </div>
                  {isExpanded && (
                    <SessionDetail session={s} onFullView={() => setModalSession(s)} />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Full view modal */}
      {modalSession && (
        <SessionModal session={modalSession} onClose={() => setModalSession(null)} />
      )}
    </div>
  )
}
