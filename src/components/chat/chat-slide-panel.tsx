'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { MessageSquare, X, Bot, ChevronDown } from 'lucide-react'
import { ChatPanel } from './chat-panel'
import { useAgents } from '@/hooks/use-agents'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { MobileOverlay } from '@/components/layout/mobile-overlay'

export function ChatSlidePanel() {
  const t = useTranslations('chat')
  const pathname = usePathname()
  const { data: agentsData } = useAgents()
  const agents = agentsData?.agents
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('chat-overlay-agent') || null
  })
  const [showPicker, setShowPicker] = useState(false)
  const isMobile = useIsMobile()

  // Default to 'main' agent if no selection and agents are loaded
  useEffect(() => {
    if (selectedAgentId) return
    if (!agents?.length) return
    const mainAgent = agents.find(a => a.id === 'main') || agents[0]
    setSelectedAgentId(mainAgent.id)
  }, [selectedAgentId, agents])

  // Persist selection
  useEffect(() => {
    if (selectedAgentId) {
      localStorage.setItem('chat-overlay-agent', selectedAgentId)
    }
  }, [selectedAgentId])

  const sessionKey = selectedAgentId ? `agent:${selectedAgentId}:main` : null
  const selectedAgent = agents?.find(a => a.id === selectedAgentId)

  // Hide on /chat page (it has its own full chat UI)
  if (pathname?.startsWith('/chat')) return null

  // Shared agent picker header used by both mobile and desktop
  const agentPickerHeader = (
    <div
      className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-white/80 hover:text-white/90 transition-colors"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Bot className="w-3.5 h-3.5 text-cyan-400/60" />
            <span>{selectedAgent?.name || t('selectAgent')}</span>
            <ChevronDown className="w-3 h-3 text-white/40" />
          </button>

          {showPicker && agents && (
            <div
              className="absolute top-full left-0 mt-1 w-56 rounded-xl overflow-hidden z-10 shadow-xl"
              style={{
                background: 'rgba(15,15,30,0.98)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {agents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgentId(agent.id)
                    setShowPicker(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:text-white/90 hover:bg-white/[0.04] transition-colors"
                >
                  <Bot className="w-3.5 h-3.5 text-cyan-400/60" />
                  {agent.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // --- Mobile rendering ---
  if (isMobile) {
    return (
      <>
        {!isOpen && (
          <button
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-lg transition-all active:scale-95"
            style={{
              minWidth: 'var(--touch-min, 44px)',
              minHeight: 'var(--touch-min, 44px)',
              background: 'linear-gradient(135deg, hsla(var(--glow-primary, 43 96% 56%), 0.15), hsla(var(--glow-secondary, 174 68% 50%), 0.15))',
              border: '1px solid hsla(var(--glow-primary, 43 96% 56%), 0.2)',
              backdropFilter: 'blur(12px)',
            }}
            title={t('openChat')}
          >
            <MessageSquare className="w-5 h-5 text-amber-400" />
          </button>
        )}
        <MobileOverlay open={isOpen} onClose={() => setIsOpen(false)} title={t('title')}>
          {agentPickerHeader}
          <ChatPanel sessionKey={sessionKey} agentName={selectedAgent?.name} compact />
        </MobileOverlay>
      </>
    )
  }

  // --- Desktop rendering (unchanged) ---
  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 p-3.5 rounded-2xl shadow-lg shadow-cyan-500/10 transition-all hover:scale-105"
          style={{
            background: 'linear-gradient(135deg, rgba(0,200,255,0.15), rgba(157,122,255,0.15))',
            border: '1px solid rgba(0,200,255,0.2)',
            backdropFilter: 'blur(12px)',
          }}
          title={t('openChat')}
        >
          <MessageSquare className="w-5 h-5 text-cyan-400" />
        </button>
      )}

      {/* Slide-out panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-[400px] flex flex-col animate-slide-in-right"
            style={{
              background: 'rgba(10,10,20,0.95)',
              backdropFilter: 'blur(20px)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {agentPickerHeader}

            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-white/40 hover:text-white/70 transition-colors hover:bg-white/[0.06]"
              title={t('closeChat')}
            >
              <X className="w-4 h-4" />
            </button>

            <ChatPanel sessionKey={sessionKey} agentName={selectedAgent?.name} compact />
          </div>
        </>
      )}
    </>
  )
}
