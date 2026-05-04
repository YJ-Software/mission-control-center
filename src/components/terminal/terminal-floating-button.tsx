'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { TerminalSquare } from 'lucide-react'
import { useTerminalStore } from '@/store/terminal'
import { useTerminalActions } from '@/hooks/use-terminal-actions'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { MobileOverlay } from '@/components/layout/mobile-overlay'
import { TerminalTabs } from './terminal-tabs'
import { TerminalInstance } from './terminal-instance'

export function TerminalFloatingButton() {
  const t = useTranslations('terminal')
  const pathname = usePathname()
  const { floatingOpen, toggleFloating, sessions, activeSessionId } = useTerminalStore()
  const { createSession, closeSession } = useTerminalActions()
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (pathname?.startsWith('/terminal')) return null

  // On desktop, hide button when floating terminal is open
  if (!isMobile && floatingOpen) return null

  return (
    <>
      <button
        onClick={() => isMobile ? setMobileOpen(true) : toggleFloating()}
        className="fixed bottom-20 right-6 z-50 group p-3 rounded-xl transition-all duration-300 hover:scale-105"
        style={{
          minWidth: 'var(--touch-min, 44px)',
          minHeight: 'var(--touch-min, 44px)',
          background: 'rgba(6,6,16,0.85)',
          border: '1px solid rgba(40,200,64,0.15)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 20px rgba(40,200,64,0.06)',
        }}
        title={t('floatingTerminal')}
      >
        <TerminalSquare className="w-4.5 h-4.5 text-emerald-400/70 group-hover:text-emerald-400 transition-colors" />
      </button>

      {/* Mobile full-screen terminal overlay */}
      {isMobile && (
        <MobileOverlay
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          title={t('floatingTerminal')}
        >
          <TerminalTabs onCreateSession={createSession} onCloseSession={closeSession} />
          <div className="flex-1 min-h-0 relative">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <TerminalSquare className="w-7 h-7 text-white/10" />
                <p className="font-mono text-[10px] text-white/20 tracking-wide">{t('noSessions')}</p>
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
        </MobileOverlay>
      )}
    </>
  )
}
