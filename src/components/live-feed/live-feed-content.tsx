'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Play, Square, Trash2, Search, X, ChevronDown, ChevronUp } from 'lucide-react'

interface FeedEvent {
  timestamp: string
  session: string
  role: string
  content: string
}

const SESSION_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#14b8a6']

function getSessionColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length]
}

const roleBorderColors: Record<string, string> = {
  user: 'border-l-blue-500',
  assistant: 'border-l-green-500',
  tool: 'border-l-yellow-500',
}

const roleBadgeStyles: Record<string, string> = {
  user: 'bg-blue-500/20 text-blue-400',
  assistant: 'bg-green-500/20 text-green-400',
  tool: 'bg-yellow-500/20 text-yellow-400',
}

const COLLAPSE_THRESHOLD = 120

function FeedItem({ event, searchTerm }: { event: FeedEvent; searchTerm: string }) {
  const [expanded, setExpanded] = useState(false)
  const time = new Date(event.timestamp).toLocaleTimeString('en', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const sessionColor = getSessionColor(event.session)
  const roleClass = event.role || 'assistant'
  const isLong = event.content.length > COLLAPSE_THRESHOLD
  const displayText = (!isLong || expanded) ? event.content : event.content.substring(0, COLLAPSE_THRESHOLD) + '…'

  let rendered: React.ReactNode = displayText
  if (searchTerm) {
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = displayText.replace(regex, '▐$1▐').split('▐')
    rendered = parts.map((part, i) => {
      if (i % 2 === 1) return <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{part}</mark>
      return part
    })
  }

  return (
    <div
      className={`flex flex-col gap-1.5 p-3 rounded-lg border-l-[3px] ${roleBorderColors[roleClass] || 'border-l-white/20'} bg-white/[0.03] animate-slide-in ${isLong ? 'cursor-pointer' : ''}`}
      onClick={isLong ? () => setExpanded(e => !e) : undefined}
    >
      <div className="flex items-center justify-between text-[11px] text-white/35">
        <div className="flex items-center gap-2">
          <span
            className="text-white text-[10px] font-semibold px-2 py-0.5 rounded-full tracking-wide"
            style={{ background: sessionColor }}
          >
            {event.session}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${roleBadgeStyles[roleClass] || 'bg-white/10 text-white/50'}`}>
            {roleClass}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <span className="text-white/20 hover:text-white/50 transition-colors">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </span>
          )}
          <span className="font-mono">{time}</span>
        </div>
      </div>
      <div className={`text-[13px] text-white/80 leading-relaxed break-words font-mono ${expanded ? 'whitespace-pre-wrap' : ''}`}>
        {rendered}
      </div>
    </div>
  )
}

export function LiveFeedContent() {
  const t = useTranslations('liveFeed')
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const eventSourceRef = useRef<EventSource | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  const sessions = Array.from(new Set(events.map(e => e.session)))

  const startStream = useCallback(() => {
    if (eventSourceRef.current) return
    const es = new EventSource('/api/live')
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.status === 'connected') return
        setEvents(prev => {
          const next = [data as FeedEvent, ...prev]
          return next.slice(0, 200)
        })
      } catch { /* skip */ }
    }

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
      setStreaming(false)
    }

    setStreaming(true)
  }, [])

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setStreaming(false)
  }, [])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  const filteredEvents = events.filter(e => {
    if (sessionFilter !== 'all' && e.session !== sessionFilter) return false
    if (roleFilter !== 'all' && e.role !== roleFilter) return false
    if (searchTerm && !e.content.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  return (
    <div className="p-6 space-y-4">
      {/* Controls */}
      <div className="cyber-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <span className={`w-2 h-2 rounded-full ${streaming ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)] animate-pulse' : 'bg-white/20'}`} />
            <span>Live</span>
          </div>

          {/* Session filter */}
          <select
            value={sessionFilter}
            onChange={e => setSessionFilter(e.target.value)}
            className="bg-white/[0.06] text-white/70 border border-white/[0.1] rounded-md px-2 py-1 text-xs font-mono"
            suppressHydrationWarning
          >
            <option value="all">{t('allSessions')}</option>
            {sessions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="bg-white/[0.06] text-white/70 border border-white/[0.1] rounded-md px-2 py-1 text-xs font-mono"
            suppressHydrationWarning
          >
            <option value="all">{t('allRoles')}</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
            <option value="tool">Tool</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-7 pr-7 py-1 bg-white/[0.06] text-white/70 border border-white/[0.1] rounded-md text-xs font-mono placeholder:text-white/25"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Start/Stop */}
          <button
            onClick={streaming ? stopStream : startStream}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              streaming
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
            }`}
          >
            {streaming ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {streaming ? t('stop') : t('start')}
          </button>

          {/* Clear */}
          <button
            onClick={() => setEvents([])}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-white/40 bg-white/[0.06] border border-white/[0.1] hover:text-white/60 hover:bg-white/[0.1] transition-all"
          >
            <Trash2 className="w-3 h-3" />
            {t('clear')}
          </button>
        </div>
      </div>

      {/* Feed stream */}
      <div className="cyber-card" ref={feedRef}>
        <div className="p-3 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <div className="text-2xl">⚡</div>
              <div className="font-mono text-[11px] text-white/25 tracking-widest">
                {streaming ? t('waitingForEvents') : t('clickStart')}
              </div>
            </div>
          ) : (
            filteredEvents.map((event, i) => (
              <FeedItem key={`${event.timestamp}-${i}`} event={event} searchTerm={searchTerm} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
