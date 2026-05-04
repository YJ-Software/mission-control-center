'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Search } from 'lucide-react'
import { ChatPanel } from './chat-panel'
import { ChatToolbar } from './chat-toolbar'
import { useSessionsList, type ChatSession } from '@/hooks/use-sessions-list'
import { useAgents } from '@/hooks/use-agents'
import type { ChatToggleState } from './chat-types'

// ---------------------------------------------------------------------------
// Session helpers (unchanged from original)
// ---------------------------------------------------------------------------

interface SessionGroup {
  label: string
  sessions: ChatSession[]
}

function isCronSession(key: string): boolean {
  if (key.startsWith('cron:')) return true
  const parts = key.split(':')
  if (parts[0] === 'agent' && parts.length >= 3 && parts[2] === 'cron') return true
  return false
}

function groupSessions(sessions: ChatSession[]): SessionGroup[] {
  const groups = new Map<string, ChatSession[]>()
  for (const s of sessions) {
    const key = s.sessionKey
    let groupLabel = 'Other Sessions'
    if (key.startsWith('agent:')) {
      const parts = key.split(':')
      groupLabel = s.agentName || parts[1] || 'agent'
    } else if (key.startsWith('telegram:')) {
      groupLabel = 'Telegram'
    } else if (key.startsWith('cron:')) {
      groupLabel = 'Cron'
    }
    if (!groups.has(groupLabel)) groups.set(groupLabel, [])
    groups.get(groupLabel)!.push(s)
  }
  for (const [, list] of groups) {
    list.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, sessions]) => ({ label, sessions }))
}

function formatSessionLabel(session: ChatSession): string {
  // Use displayName only if it looks like a clean label (no raw metadata/JSON)
  if (session.displayName && !session.displayName.includes('untrusted') && !session.displayName.includes('```') && !session.displayName.startsWith('{')) {
    return session.displayName
  }
  // Use label if available
  if (session.label) return session.label
  const key = session.sessionKey
  const match = key.match(/^agent:[^:]+:(.+)$/)
  if (match) return match[1]
  return key
}

function formatTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Toggle state persistence
// ---------------------------------------------------------------------------

function loadToggles(): ChatToggleState {
  if (typeof window === 'undefined') return { showThinking: true, showToolCalls: true, focusMode: false, hideCron: true }
  return {
    showThinking: localStorage.getItem('chat-toggle-thinking') !== 'false',
    showToolCalls: localStorage.getItem('chat-toggle-tools') !== 'false',
    focusMode: localStorage.getItem('chat-focus-mode') === 'true',
    hideCron: localStorage.getItem('chat-hide-cron') !== 'false',
  }
}

function saveToggle(key: string, value: boolean) {
  localStorage.setItem(key, String(value))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatContent() {
  const t = useTranslations('chat')
  const { sessions: remoteSessions, loading, refresh } = useSessionsList()
  const { data: agentsData } = useAgents()
  const agents = agentsData?.agents
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)
  const [localSessions, _setLocalSessions] = useState<ChatSession[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [toggleState, setToggleState] = useState<ChatToggleState>(loadToggles)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Restore active session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('chat-page-session')
    if (saved) setActiveSessionKey(saved)
  }, [])

  // Focus mode: toggle sidebar + header visibility
  useEffect(() => {
    const sidebar = document.querySelector('[data-sidebar]') as HTMLElement | null
    const header = containerRef.current?.closest('.flex.flex-col')?.querySelector('header') as HTMLElement | null
    if (toggleState.focusMode) {
      sidebar?.classList.add('hidden')
      header?.classList.add('hidden')
    } else {
      sidebar?.classList.remove('hidden')
      header?.classList.remove('hidden')
    }
    return () => {
      sidebar?.classList.remove('hidden')
      header?.classList.remove('hidden')
    }
  }, [toggleState.focusMode])

  // Merge remote + local sessions, dedup
  const sessions = useMemo(() => {
    const seen = new Set<string>()
    const merged: ChatSession[] = []
    for (const s of remoteSessions) {
      if (!seen.has(s.sessionKey)) { seen.add(s.sessionKey); merged.push(s) }
    }
    for (const s of localSessions) {
      if (!seen.has(s.sessionKey)) { seen.add(s.sessionKey); merged.push(s) }
    }
    return merged
  }, [remoteSessions, localSessions])

  const cronCount = useMemo(
    () => sessions.filter(s => isCronSession(s.sessionKey)).length,
    [sessions]
  )

  const activeSession = useMemo(
    () => sessions.find(s => s.sessionKey === activeSessionKey),
    [sessions, activeSessionKey]
  )

  const activeAgentName = useMemo(() => {
    if (activeSession?.agentName) return activeSession.agentName
    if (!activeSessionKey) return undefined
    const match = activeSessionKey.match(/^agent:([^:]+):/)
    if (match && agents) {
      const agent = agents.find(a => a.id === match[1])
      if (agent) return agent.name
    }
    return undefined
  }, [activeSession, activeSessionKey, agents])

  const groupedSessions = useMemo(() => {
    let filtered = sessions
    if (toggleState.hideCron) {
      filtered = filtered.filter(s => !isCronSession(s.sessionKey))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(s =>
        s.sessionKey.toLowerCase().includes(q) ||
        (s.agentName || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q)
      )
    }
    return groupSessions(filtered)
  }, [sessions, searchQuery, toggleState.hideCron])

  // Default to main agent session
  useEffect(() => {
    if (activeSessionKey) return
    if (!agents?.length) return
    const mainAgent = agents.find(a => a.id === 'main') || agents[0]
    setActiveSessionKey(`agent:${mainAgent.id}:main`)
  }, [activeSessionKey, agents])

  // Persist session selection
  useEffect(() => {
    if (activeSessionKey) localStorage.setItem('chat-page-session', activeSessionKey)
  }, [activeSessionKey])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setSearchQuery('')
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  useEffect(() => {
    if (dropdownOpen && searchRef.current) searchRef.current.focus()
  }, [dropdownOpen])

  const handleSelectSession = useCallback((sessionKey: string) => {
    setActiveSessionKey(sessionKey)
    setDropdownOpen(false)
    setSearchQuery('')
  }, [])

  const handleToggle = useCallback((key: keyof ChatToggleState) => {
    setToggleState(prev => {
      const next = { ...prev, [key]: !prev[key] }
      const storageKeyMap: Record<string, string> = {
        showThinking: 'chat-toggle-thinking',
        showToolCalls: 'chat-toggle-tools',
        focusMode: 'chat-focus-mode',
        hideCron: 'chat-hide-cron',
      }
      saveToggle(storageKeyMap[key], next[key])
      return next
    })
  }, [])

  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  const selectorLabel = activeSessionKey
    ? formatSessionLabel(activeSession || { sessionKey: activeSessionKey })
    : t('selectAgent')

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Top bar: session selector + model selector + toolbar toggles — all in one row */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Session selector */}
        <div className="relative min-w-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-white/[0.04] max-w-[260px]"
            style={{
              background: dropdownOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="truncate text-white/80">{selectorLabel}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-white/40 shrink-0 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div
              className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-50 shadow-2xl min-w-[300px]"
              style={{
                background: 'rgba(20,20,30,0.98)',
                border: '1px solid rgba(255,255,255,0.1)',
                backdropFilter: 'blur(20px)',
                maxHeight: '420px',
              }}
            >
              <div className="flex items-center gap-1.5 p-2 border-b border-white/[0.06]">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('searchSessions')}
                    className="w-full pl-8 pr-3 py-1.5 rounded-md text-sm text-white/80 placeholder:text-white/30 focus:outline-none"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  />
                </div>
              </div>

              <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
                {groupedSessions.map(group => (
                  <div key={group.label}>
                    <div className="px-3 pt-2.5 pb-1 text-[10px] text-white/30 uppercase tracking-wider font-mono">
                      {group.label}
                    </div>
                    {group.sessions.map(session => (
                      <button
                        key={session.sessionKey}
                        onClick={() => handleSelectSession(session.sessionKey)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                          activeSessionKey === session.sessionKey
                            ? 'bg-cyan-500/10 text-cyan-300/90'
                            : 'text-white/60 hover:text-white/80 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="truncate font-mono text-xs">
                          {formatSessionLabel(session)}
                        </span>
                        {session.lastActivity && (
                          <span className="text-[10px] text-white/20 ml-auto shrink-0">
                            {formatTime(session.lastActivity)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}

                {groupedSessions.length === 0 && !loading && (
                  <div className="text-white/20 text-xs font-mono text-center py-4 tracking-widest">—</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Model selector + toolbar toggles */}
        <ChatToolbar
          sessionKey={activeSessionKey}
          currentModel={activeSession?.model}
          cronCount={cronCount}
          toggleState={toggleState}
          onToggle={handleToggle}
          onRefresh={handleRefresh}
        />
      </div>

      {/* Chat panel */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <ChatPanel
          sessionKey={activeSessionKey}
          agentName={activeAgentName}
          showToolCalls={toggleState.showToolCalls}
          onMessageSent={handleRefresh}
          onFocusToggle={() => handleToggle('focusMode')}
        />
      </div>
    </div>
  )
}
