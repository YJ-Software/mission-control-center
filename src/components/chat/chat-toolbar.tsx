'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Brain, Wrench, Maximize2, Minimize2, Timer, ChevronDown } from 'lucide-react'
import { useModelsList, type ModelInfo } from '@/hooks/use-models-list'
import { useWebSocket } from '@/store/websocket'

interface ChatToolbarProps {
  sessionKey: string | null
  currentModel?: string
  cronCount: number
  toggleState: {
    showThinking: boolean
    showToolCalls: boolean
    focusMode: boolean
    hideCron: boolean
  }
  onToggle: (key: 'showThinking' | 'showToolCalls' | 'focusMode' | 'hideCron') => void
  onRefresh: () => void
}

export function ChatToolbar({
  sessionKey,
  currentModel,
  cronCount,
  toggleState,
  onToggle,
  onRefresh,
}: ChatToolbarProps) {
  const t = useTranslations('chat.toolbar')
  const { models } = useModelsList()
  const { sendRpc } = useWebSocket()
  const [selectedModel, setSelectedModel] = useState('')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedModel(currentModel || '')
  }, [currentModel])

  // Close dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [modelDropdownOpen])

  const handleModelChange = async (modelId: string) => {
    const prevModel = selectedModel
    setSelectedModel(modelId)
    setModelDropdownOpen(false)
    if (!sessionKey) return
    try {
      await sendRpc('sessions.patch', {
        key: sessionKey,
        model: modelId || null,
      })
    } catch (err) {
      // Revert on failure (e.g. model not allowed)
      setSelectedModel(prevModel)
      console.warn('[sessions.patch] model change failed:', err instanceof Error ? err.message : err)
    }
  }

  // Group models by provider
  const grouped = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const provider = m.provider || 'other'
    if (!grouped.has(provider)) grouped.set(provider, [])
    grouped.get(provider)!.push(m)
  }

  const selectedLabel = selectedModel
    ? models.find(m => m.id === selectedModel)?.name || selectedModel
    : currentModel || 'Default'

  return (
    <div className="flex items-center gap-2 flex-1">
      {/* Model selector — custom dropdown */}
      <div className="relative" ref={modelDropdownRef}>
        <button
          onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
          className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/80 border border-white/[0.08] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 max-w-[260px] transition-colors"
          style={{ background: modelDropdownOpen ? 'rgba(255,255,255,0.06)' : 'transparent' }}
          title={t('modelSelector')}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${modelDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {modelDropdownOpen && (
          <div
            className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-50 shadow-2xl min-w-[280px]"
            style={{
              background: 'rgba(20,20,30,0.98)',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(20px)',
              maxHeight: '360px',
            }}
          >
            <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
              {/* Default option */}
              <button
                onClick={() => handleModelChange('')}
                className={`w-full flex items-center px-3 py-1.5 text-xs transition-colors ${
                  !selectedModel ? 'bg-cyan-500/10 text-cyan-300' : 'text-white/60 hover:text-white/80 hover:bg-white/[0.04]'
                }`}
              >
                Default{currentModel ? ` (${currentModel})` : ''}
              </button>

              {[...grouped.entries()].map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 pt-2 pb-1 text-[10px] text-white/25 uppercase tracking-wider font-mono">
                    {provider}
                  </div>
                  {providerModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleModelChange(m.id)}
                      className={`w-full flex items-center px-3 py-1.5 text-xs transition-colors ${
                        selectedModel === m.id ? 'bg-cyan-500/10 text-cyan-300' : 'text-white/60 hover:text-white/80 hover:bg-white/[0.04]'
                      }`}
                    >
                      {m.name} · {m.provider}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Toggle buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-md text-white/30 hover:text-white/60 transition-colors"
          title={t('refreshChat')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-white/[0.08] mx-1" />

        <button
          onClick={() => onToggle('showThinking')}
          className={`p-1.5 rounded-md transition-colors ${
            toggleState.showThinking ? 'text-cyan-400/70 bg-cyan-500/10' : 'text-white/30 hover:text-white/60'
          }`}
          title={t('toggleThinking')}
        >
          <Brain className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onToggle('showToolCalls')}
          className={`p-1.5 rounded-md transition-colors ${
            toggleState.showToolCalls ? 'text-cyan-400/70 bg-cyan-500/10' : 'text-white/30 hover:text-white/60'
          }`}
          title={t('toggleTools')}
        >
          <Wrench className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onToggle('focusMode')}
          className={`p-1.5 rounded-md transition-colors ${
            toggleState.focusMode ? 'text-amber-400/70 bg-amber-500/10' : 'text-white/30 hover:text-white/60'
          }`}
          title={t('focusMode')}
        >
          {toggleState.focusMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {cronCount > 0 && (
          <button
            onClick={() => onToggle('hideCron')}
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
              !toggleState.hideCron ? 'text-amber-400/70 bg-amber-500/10' : 'text-white/30 hover:text-white/60'
            }`}
            title={t('cronSessions', { count: cronCount })}
          >
            <Timer className="w-3.5 h-3.5" />
            <span className="text-[10px] font-mono">{cronCount}</span>
          </button>
        )}
      </div>
    </div>
  )
}
