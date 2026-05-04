'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { TerminalSquare, Circle, ExternalLink } from 'lucide-react'
import { useTerminalStore } from '@/store/terminal'
import { useTerminalActions } from '@/hooks/use-terminal-actions'
import { TerminalTabs } from './terminal-tabs'
import { TerminalInstance } from './terminal-instance'

export function TerminalPage() {
  const t = useTranslations('terminal')
  const { sessions, activeSessionId } = useTerminalStore()
  const { createSession, closeSession, ready } = useTerminalActions()

  // Auto-create a session when entering terminal page with no sessions
  const autoCreated = useRef(false)
  useEffect(() => {
    if (ready && sessions.length === 0 && !autoCreated.current) {
      autoCreated.current = true
      createSession()
    }
  }, [ready, sessions.length, createSession])

  const activeSession = sessions.find(s => s.id === activeSessionId)

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Terminal window */}
      <div
        className="flex flex-col flex-1 min-h-0 rounded-2xl overflow-hidden relative"
        style={{
          background: 'rgba(6,6,16,0.9)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: `
            0 0 0 1px rgba(0,0,0,0.5),
            0 8px 40px rgba(0,0,0,0.6),
            0 0 80px rgba(0,200,255,0.03),
            inset 0 1px 0 rgba(255,255,255,0.06)
          `,
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5 select-none shrink-0"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Traffic lights */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/50" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d4a028]/50" />
              <span className="w-3 h-3 rounded-full bg-[#28c840] border border-[#24a938]/50" />
            </div>
          </div>

          {/* Center title */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <TerminalSquare className="w-3.5 h-3.5 text-emerald-400/60" />
            <span className="font-mono text-[11px] tracking-wider text-white/40">
              {activeSession ? `${activeSession.title} — session ${activeSession.id.slice(0, 8)}` : 'TERMINAL'}
            </span>
          </div>

          {/* Connection status + popup */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Circle className="w-2 h-2 fill-emerald-400 text-emerald-400" />
              <span className="font-mono text-[10px] tracking-widest text-emerald-400/60 uppercase">
                {t('connected')}
              </span>
            </div>
            <button
              onClick={() => window.open('/terminal-popup', '_blank', 'width=900,height=600')}
              className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors"
              title={t('openInNewWindow')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <TerminalTabs onCreateSession={createSession} onCloseSession={closeSession} />

        {/* Terminal viewport */}
        <div className="flex-1 min-h-0 relative">
          {/* Scanline overlay */}
          <div
            className="absolute inset-0 pointer-events-none z-10 opacity-[0.03]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.08) 1px, rgba(255,255,255,0.08) 2px)',
              backgroundSize: '100% 2px',
            }}
          />

          {/* Top inner shadow */}
          <div
            className="absolute top-0 left-0 right-0 h-8 pointer-events-none z-10"
            style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 100%)',
            }}
          />

          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div
                className="p-5 rounded-2xl"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <TerminalSquare className="w-10 h-10 text-white/15" />
              </div>
              <div className="text-center space-y-1.5">
                <p className="font-mono text-sm text-white/25 tracking-wide">{t('noSessions')}</p>
                <p className="font-mono text-[10px] text-white/15 tracking-widest uppercase">
                  Press + to initialize
                </p>
              </div>
            </div>
          ) : (
            sessions.map((session) => (
              <TerminalInstance
                key={session.id}
                sessionId={session.id}
                visible={session.id === activeSessionId}
              />
            ))
          )}
        </div>

        {/* Bottom status bar */}
        <div
          className="flex items-center justify-between px-4 py-1.5 shrink-0"
          style={{
            background: 'rgba(255,255,255,0.02)',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-white/20 tracking-wider">
              {sessions.length > 0 ? `${sessions.length}/5 sessions` : 'idle'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-white/20 tracking-wider">
              PTY
            </span>
            <span className="font-mono text-[10px] text-white/20 tracking-wider">
              UTF-8
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
