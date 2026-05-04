'use client'

import { useTranslations } from 'next-intl'
import { Pin } from 'lucide-react'
import type { ChatMessage } from '@/hooks/use-chat-session'

interface ChatPinnedProps {
  messages: ChatMessage[]
  pinnedIds: Set<string>
  onScrollToMessage: (id: string) => void
  onClearPins: () => void
}

export function ChatPinned({ messages, pinnedIds, onScrollToMessage, onClearPins }: ChatPinnedProps) {
  const t = useTranslations('chat.pinned')
  const pinned = messages.filter(m => pinnedIds.has(m.id))

  if (pinned.length === 0) return null

  return (
    <div className="border-b border-white/[0.06] px-4 py-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400/60 font-mono">
          <Pin className="w-3 h-3" />
          {t('pinnedMessages')} ({pinned.length})
        </div>
        <button onClick={onClearPins} className="text-[10px] text-white/25 hover:text-white/50 transition-colors">
          {t('clearPins')}
        </button>
      </div>
      <div className="space-y-1">
        {pinned.map(msg => (
          <button
            key={msg.id}
            onClick={() => onScrollToMessage(msg.id)}
            className="w-full text-left px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.04] transition-colors truncate"
          >
            <span className="text-white/25 mr-1.5">{msg.role === 'user' ? 'You' : 'AI'}:</span>
            {msg.content.slice(0, 100)}
          </button>
        ))}
      </div>
    </div>
  )
}
