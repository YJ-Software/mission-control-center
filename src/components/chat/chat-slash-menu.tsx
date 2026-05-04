'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { SlashCommand } from './chat-types'

interface ChatSlashMenuProps {
  query: string
  commands: SlashCommand[]
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

export function ChatSlashMenu({ query, commands, onSelect, onClose }: ChatSlashMenuProps) {
  const t = useTranslations('chat.slash')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const filtered = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault()
        onSelect(filtered[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [filtered, selectedIndex, onSelect, onClose])

  useEffect(() => {
    const el = menuRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0) return null

  const grouped = new Map<string, SlashCommand[]>()
  for (const cmd of filtered) {
    const cat = cmd.category
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(cmd)
  }

  let flatIndex = 0

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden shadow-2xl z-50"
      style={{
        background: 'rgba(20,20,30,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(20px)',
        maxHeight: '300px',
      }}
    >
      <div className="px-3 py-2 text-[10px] text-white/30 uppercase tracking-wider font-mono border-b border-white/[0.06]">
        {t('title')}
      </div>
      <div ref={menuRef} className="overflow-y-auto" style={{ maxHeight: '260px' }}>
        {[...grouped.entries()].map(([category, cmds]) => (
          <div key={category}>
            <div className="px-3 pt-2 pb-1 text-[10px] text-white/20 uppercase tracking-wider font-mono">
              {category}
            </div>
            {cmds.map(cmd => {
              const idx = flatIndex++
              return (
                <button
                  key={cmd.name}
                  onClick={() => onSelect(cmd)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    idx === selectedIndex
                      ? 'bg-cyan-500/10 text-cyan-300'
                      : 'text-white/60 hover:text-white/80 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="font-mono text-cyan-400/70">/{cmd.name}</span>
                  <span className="text-white/30 text-xs truncate">{cmd.description}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Build the default slash command list */
export function getDefaultSlashCommands(t: (key: string) => string): SlashCommand[] {
  return [
    { name: 'help', description: t('help'), category: 'session' },
    { name: 'new', description: t('new'), category: 'session' },
    { name: 'clear', description: t('clear'), category: 'session' },
    { name: 'reset', description: t('reset'), category: 'session' },
    { name: 'stop', description: t('stop'), category: 'session' },
    { name: 'export-session', description: t('exportSession'), category: 'session' },
    { name: 'model', description: t('model'), category: 'model' },
    { name: 'think', description: t('think'), category: 'model' },
    { name: 'fast', description: t('fast'), category: 'model' },
    { name: 'verbose', description: t('verbose'), category: 'model' },
    { name: 'focus', description: t('focus'), category: 'tools' },
    { name: 'usage', description: t('usage'), category: 'tools' },
    { name: 'agents', description: t('agents'), category: 'tools' },
  ]
}
