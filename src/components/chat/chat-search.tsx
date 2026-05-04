'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import type { ChatMessage } from '@/hooks/use-chat-session'

interface ChatSearchProps {
  messages: ChatMessage[]
  onClose: () => void
  onScrollToMessage: (id: string) => void
}

export function ChatSearch({ messages, onClose, onScrollToMessage }: ChatSearchProps) {
  const t = useTranslations('chat.search')
  const [query, setQuery] = useState('')
  const [matchIds, setMatchIds] = useState<string[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setMatchIds([])
      setCurrentMatchIndex(0)
      return
    }
    const q = query.toLowerCase()
    const ids = messages
      .filter(m => m.content.toLowerCase().includes(q))
      .map(m => m.id)
    setMatchIds(ids)
    setCurrentMatchIndex(0)
    if (ids.length > 0) onScrollToMessage(ids[0])
  }, [query, messages, onScrollToMessage])

  const goNext = () => {
    if (matchIds.length === 0) return
    const next = (currentMatchIndex + 1) % matchIds.length
    setCurrentMatchIndex(next)
    onScrollToMessage(matchIds[next])
  }

  const goPrev = () => {
    if (matchIds.length === 0) return
    const prev = (currentMatchIndex - 1 + matchIds.length) % matchIds.length
    setCurrentMatchIndex(prev)
    onScrollToMessage(matchIds[prev])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'Enter' && !e.shiftKey) goNext()
    else if (e.key === 'Enter' && e.shiftKey) goPrev()
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <Search className="w-4 h-4 text-white/30 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('searchMessages')}
        className="flex-1 bg-transparent text-sm text-white/80 placeholder:text-white/30 focus:outline-none"
      />
      {query && (
        <span className="text-[11px] text-white/30 font-mono shrink-0">
          {matchIds.length > 0
            ? t('matchCount', { current: currentMatchIndex + 1, total: matchIds.length })
            : t('noMatches')
          }
        </span>
      )}
      <button onClick={goPrev} className="p-1 text-white/30 hover:text-white/60 transition-colors" disabled={matchIds.length === 0}>
        <ChevronUp className="w-4 h-4" />
      </button>
      <button onClick={goNext} className="p-1 text-white/30 hover:text-white/60 transition-colors" disabled={matchIds.length === 0}>
        <ChevronDown className="w-4 h-4" />
      </button>
      <button onClick={onClose} className="p-1 text-white/30 hover:text-white/60 transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
