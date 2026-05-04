'use client'

import { useTranslations } from 'next-intl'
import { Plus, X, TerminalSquare } from 'lucide-react'
import { useTerminalStore } from '@/store/terminal'

interface TerminalTabsProps {
  onCreateSession: () => void
  onCloseSession: (id: string) => void
}

export function TerminalTabs({ onCreateSession, onCloseSession }: TerminalTabsProps) {
  const t = useTranslations('terminal')
  const { sessions, activeSessionId, setActiveSession } = useTerminalStore()

  return (
    <div
      className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto shrink-0"
      style={{
        background: 'rgba(255,255,255,0.015)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {sessions.map((session, i) => {
        const isActive = activeSessionId === session.id
        return (
          <div
            key={session.id}
            role="tab"
            tabIndex={0}
            onClick={() => setActiveSession(session.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') setActiveSession(session.id) }}
            className={`group flex items-center gap-2 px-3 py-1.5 text-xs transition-all shrink-0 cursor-pointer relative ${
              isActive
                ? 'text-white/80'
                : 'text-white/30 hover:text-white/50'
            }`}
            style={isActive ? {
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '8px 8px 0 0',
              borderTop: '1px solid rgba(0,200,255,0.15)',
              borderLeft: '1px solid rgba(255,255,255,0.06)',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            } : {
              borderRadius: '8px 8px 0 0',
            }}
          >
            <TerminalSquare className={`w-3 h-3 ${isActive ? 'text-emerald-400/70' : ''}`} />
            <span className="font-mono text-[11px] tracking-wide">
              {session.title}
              <span className="text-white/20 ml-1.5">:{i + 1}</span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCloseSession(session.id)
              }}
              className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
              title={t('closeTab')}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        )
      })}

      <button
        onClick={onCreateSession}
        className="p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-all shrink-0 ml-0.5"
        title={t('newTab')}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
