'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { MessageSquare, Loader2, Search, Ban } from 'lucide-react'
import { ConversationView } from './conversation-view'

interface ConversationRow {
  userId: string
  displayName: string | null
  pictureUrl: string | null
  language: string | null
  lastMessageAt: number | null
  lastMessagePreview: string | null
  lastDirection: string | null
  profileFetchedAt: number | null
  paused: boolean
  pauseInfo: { pausedAt: number; resumeAt: number; operatorId: string | null } | null
}

function relativeTime(unixSec: number | null): string {
  if (!unixSec) return ''
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function initialsOf(name: string | null, userId: string): string {
  if (name && name.trim()) return name.trim().charAt(0).toUpperCase()
  return userId.charAt(1) || '?'
}

function avatarGradient(userId: string): string {
  // Deterministic colour for the placeholder avatar
  const palette = [
    'linear-gradient(135deg,#0891b2,#7c3aed)',
    'linear-gradient(135deg,#7c3aed,#ec4899)',
    'linear-gradient(135deg,#06b6d4,#10b981)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#3b82f6,#8b5cf6)',
    'linear-gradient(135deg,#14b8a6,#22d3ee)',
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

export function ConversationsTab() {
  const t = useTranslations('customerService.conversations')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ conversations: ConversationRow[] }>({
    queryKey: ['cs-conversations', search],
    queryFn: () => {
      const qp = search ? `?q=${encodeURIComponent(search)}` : ''
      return fetch(`/api/customer-service/conversations${qp}`).then(r => r.json())
    },
    refetchInterval: 5000,
  })

  // Live invalidation triggered by /ws cs:* events forwarded from the
  // server-side EventEmitter (see src/lib/customer-service/cs-store.ts).
  useEffect(() => {
    const onNew = () => qc.invalidateQueries({ queryKey: ['cs-conversations'] })
    const onPause = () => qc.invalidateQueries({ queryKey: ['cs-conversations'] })
    window.addEventListener('cs:new-message', onNew)
    window.addEventListener('cs:pause-changed', onPause)
    return () => {
      window.removeEventListener('cs:new-message', onNew)
      window.removeEventListener('cs:pause-changed', onPause)
    }
  }, [qc])

  const conversations = data?.conversations ?? []
  const selectedConv = conversations.find(c => c.userId === selected) ?? null

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '280px 1fr', height: 'calc(100vh - 14rem)' }}>
      {/* sidebar */}
      <div className="cyber-card flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <MessageSquare className="w-3.5 h-3.5 text-cyan-400/70" />
          <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
          <span className="ml-auto text-[10px] text-white/30 font-mono">{conversations.length}</span>
        </div>
        <div className="px-3 py-2 border-b border-white/[0.04]">
          <div className="relative">
            <Search className="w-3 h-3 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-7 pr-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-xs text-white/85 focus:outline-none focus:border-cyan-500/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-white/40 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
              {t('loading')}
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-8 px-4 text-white/40 text-xs">{t('empty')}</div>
          ) : (
            conversations.map(c => {
              const active = c.userId === selected
              const name = c.displayName?.trim() || `${c.userId.slice(0, 7)}…`
              const isUnknown = !c.displayName
              return (
                <button
                  key={c.userId}
                  onClick={() => setSelected(c.userId)}
                  className={`w-full text-left px-4 py-2.5 border-b border-white/[0.04] flex gap-2.5 items-start transition-colors ${active ? 'bg-cyan-400/[0.06] border-l-2 border-l-cyan-400 pl-[14px]' : 'hover:bg-white/[0.02]'}`}
                >
                  {c.pictureUrl ? (
                    <img src={c.pictureUrl} alt="" className="w-9 h-9 rounded-full shrink-0 object-cover" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold text-white"
                      style={{ background: avatarGradient(c.userId) }}
                    >
                      {initialsOf(c.displayName, c.userId)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[13px] truncate ${isUnknown ? 'text-white/55 font-mono' : 'text-white/90'}`}>
                        {name}
                      </span>
                      <span className="text-[10px] text-white/30 font-mono ml-auto shrink-0">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5 truncate">
                      {c.lastDirection === 'bot' && '[bot] '}
                      {c.lastDirection === 'operator' && '[op] '}
                      {c.lastMessagePreview || '—'}
                    </div>
                    {c.paused && (
                      <span className="inline-block mt-1 text-[9px] text-amber-300 border border-amber-300/30 bg-amber-300/[0.08] rounded-full px-1.5 py-px font-mono">
                        ⏸ paused
                      </span>
                    )}
                    {isUnknown && (
                      <span className="inline-block mt-1 text-[9px] text-white/30 border border-white/10 bg-white/[0.03] rounded-full px-1.5 py-px font-mono ml-1">
                        no profile
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* main view */}
      <div className="cyber-card flex flex-col overflow-hidden">
        {selectedConv ? (
          <ConversationView key={selectedConv.userId} userId={selectedConv.userId} initial={selectedConv} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/30 text-sm gap-2">
            <Ban className="w-4 h-4" />
            {t('noneSelected')}
          </div>
        )}
      </div>
    </div>
  )
}
