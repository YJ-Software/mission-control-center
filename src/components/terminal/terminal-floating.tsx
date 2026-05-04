'use client'

import { useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { X, Minus, TerminalSquare } from 'lucide-react'
import { useTerminalStore } from '@/store/terminal'
import { useTerminalActions } from '@/hooks/use-terminal-actions'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { TerminalTabs } from './terminal-tabs'
import { TerminalInstance } from './terminal-instance'

export function TerminalFloating() {
  const t = useTranslations('terminal')
  const {
    sessions, activeSessionId, floatingOpen,
    floatingPosition, floatingSize,
    setFloatingOpen, setFloatingPosition, setFloatingSize,
  } = useTerminalStore()
  const { createSession, closeSession, ready } = useTerminalActions()
  const isMobile = useIsMobile()

  // Auto-create a session when floating terminal opens with no sessions
  useEffect(() => {
    if (floatingOpen && ready && sessions.length === 0) {
      createSession()
    }
  }, [floatingOpen, ready, sessions.length, createSession])

  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null)
  const windowRef = useRef<HTMLDivElement>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: floatingPosition.x,
      startPosY: floatingPosition.y,
    }

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setFloatingPosition({
        x: dragRef.current.startPosX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.startPosY + (ev.clientY - dragRef.current.startY),
      })
    }

    const handleUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [floatingPosition, setFloatingPosition])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: floatingSize.width,
      startH: floatingSize.height,
    }

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      setFloatingSize({
        width: Math.max(420, resizeRef.current.startW + (ev.clientX - resizeRef.current.startX)),
        height: Math.max(280, resizeRef.current.startH + (ev.clientY - resizeRef.current.startY)),
      })
    }

    const handleUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [floatingSize, setFloatingSize])

  if (!floatingOpen) return null
  if (isMobile) return null

  return (
    <div
      ref={windowRef}
      className="fixed z-50 flex flex-col rounded-2xl overflow-hidden"
      style={{
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: floatingSize.width,
        height: floatingSize.height,
        background: 'rgba(6,6,16,0.95)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `
          0 0 0 1px rgba(0,0,0,0.5),
          0 25px 60px rgba(0,0,0,0.7),
          0 0 60px rgba(0,200,255,0.04),
          inset 0 1px 0 rgba(255,255,255,0.06)
        `,
      }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move select-none shrink-0"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
        onMouseDown={handleDragStart}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFloatingOpen(false)}
            className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/50 hover:brightness-110 transition-all"
          />
          <button
            onClick={() => setFloatingOpen(false)}
            className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d4a028]/50 hover:brightness-110 transition-all"
          />
          <span className="w-3 h-3 rounded-full bg-[#28c840] border border-[#24a938]/50" />
        </div>

        {/* Center title */}
        <div className="flex items-center gap-1.5">
          <TerminalSquare className="w-3 h-3 text-emerald-400/50" />
          <span className="font-mono text-[10px] tracking-wider text-white/35">
            {t('floatingTerminal')}
          </span>
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setFloatingOpen(false)}
            className="p-1 rounded text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-all"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => setFloatingOpen(false)}
            className="p-1 rounded text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <TerminalTabs onCreateSession={createSession} onCloseSession={closeSession} />

      {/* Terminal area */}
      <div className="flex-1 min-h-0 relative">
        {/* Scanline */}
        <div
          className="absolute inset-0 pointer-events-none z-10 opacity-[0.02]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.08) 1px, rgba(255,255,255,0.08) 2px)',
            backgroundSize: '100% 2px',
          }}
        />

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

      {/* Bottom bar */}
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <span className="font-mono text-[9px] text-white/15 tracking-wider">
          {sessions.length}/5
        </span>
        <span className="font-mono text-[9px] text-white/15 tracking-wider">
          PTY
        </span>
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg viewBox="0 0 20 20" className="w-full h-full opacity-20">
          <line x1="14" y1="20" x2="20" y2="14" stroke="white" strokeWidth="1" />
          <line x1="10" y1="20" x2="20" y2="10" stroke="white" strokeWidth="1" />
          <line x1="6" y1="20" x2="20" y2="6" stroke="white" strokeWidth="1" />
        </svg>
      </div>
    </div>
  )
}
