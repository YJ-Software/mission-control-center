'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Bot, User, Copy, Check, Volume2, VolumeX, Trash2, Pin, PinOff, AlertCircle } from 'lucide-react'
import type { ChatMessage as ChatMessageType } from '@/hooks/use-chat-session'
import { useSpeechSynthesis } from '@/hooks/use-speech'

interface ChatMessageProps {
  message: ChatMessageType
  agentName?: string
  isFirstInGroup: boolean
  showToolCalls: boolean
  onDelete?: (id: string) => void
  onTogglePin?: (id: string) => void
  isPinned?: boolean
}

export function ChatMessage({
  message,
  agentName,
  isFirstInGroup,
  showToolCalls: _showToolCalls,
  onDelete,
  onTogglePin,
  isPinned,
}: ChatMessageProps) {
  const t = useTranslations('chat.message')
  const isUser = message.role === 'user'
  const isError = message.state === 'error'
  const isStreaming = message.state === 'streaming'
  const [copied, setCopied] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const { isSpeaking, speak, stop, isSupported: ttsSupported } = useSpeechSynthesis()

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReadAloud = () => {
    if (isSpeaking) stop()
    else speak(message.content)
  }

  const handleDelete = () => {
    const skipConfirm = localStorage.getItem('chat-delete-no-confirm') === 'true'
    if (skipConfirm) {
      onDelete?.(message.id)
    } else {
      setShowDeleteConfirm(true)
    }
  }

  const confirmDelete = (dontAskAgain: boolean) => {
    if (dontAskAgain) localStorage.setItem('chat-delete-no-confirm', 'true')
    onDelete?.(message.id)
    setShowDeleteConfirm(false)
  }

  return (
    <div className={`group relative flex gap-3 px-4 py-1.5 hover:bg-white/[0.02] transition-colors ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar column */}
      <div className="w-9 shrink-0">
        {isFirstInGroup && (
          <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
            isUser ? 'bg-cyan-500/10 text-cyan-400' : 'bg-white/[0.06] text-white/50'
          }`}>
            {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
          </div>
        )}
      </div>

      {/* Content column */}
      <div className={`flex-1 min-w-0 ${isUser ? 'flex flex-col items-end' : ''}`}>
        {/* Name + timestamp header (only for first in group) */}
        {isFirstInGroup && (
          <div className={`flex items-center gap-2 mb-0.5 ${isUser ? 'flex-row-reverse' : ''}`}>
            <span className={`text-sm font-semibold ${isUser ? 'text-cyan-300/90' : 'text-white/80'}`}>
              {isUser ? 'You' : agentName || 'Assistant'}
            </span>
            {message.timestamp > 0 && (
              <span className="text-[11px] text-white/25 font-mono">
                {new Date(message.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

        {/* User attachments (images) — rendered above the text bubble */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end mb-1 max-w-[85%]">
            {message.attachments.map((att, i) => (
              <img
                key={i}
                src={att.dataUrl}
                alt={att.fileName || `attachment-${i + 1}`}
                className="max-h-48 rounded-lg border border-cyan-500/20 object-cover"
              />
            ))}
          </div>
        )}

        {/* Message content */}
        {(message.content || (isUser && message.attachments && message.attachments.length > 0)) && (
          <div className={isError ? 'text-red-400/80' : ''}>
            {isUser ? (
              message.content ? (
                <div
                  className="inline-block rounded-xl px-4 py-3 max-w-[85%]"
                  style={{
                    background: 'rgba(0,200,255,0.08)',
                    border: '1px solid rgba(0,200,255,0.12)',
                  }}
                >
                  <p className="text-sm text-white/85 whitespace-pre-wrap">{message.content}</p>
                </div>
              ) : null
            ) : (
              <div
                className="inline-block rounded-xl px-4 py-3 text-sm text-white/75 max-w-[85%] prose prose-invert prose-sm
                  prose-p:my-1.5 prose-pre:my-2 prose-pre:rounded-lg
                  prose-code:text-cyan-300 prose-code:bg-white/[0.06] prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                  prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/[0.06]
                  prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline
                  prose-headings:text-white/90 prose-strong:text-white/90
                  prose-li:my-0.5
                "
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </ReactMarkdown>
                {isStreaming && (
                  <span className="inline-block w-2 h-4 bg-cyan-400/60 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            )}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-1.5 mt-1 text-red-400/60 text-xs">
            <AlertCircle className="w-3 h-3" />
            Error
          </div>
        )}
      </div>

      {/* Hover action buttons (assistant messages only, not streaming) */}
      {!isUser && !isStreaming && message.content && (
        <div className="absolute right-3 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-[rgba(20,20,30,0.95)] rounded-lg border border-white/[0.08] px-1 py-0.5">
          <button onClick={handleCopy} className="p-1.5 rounded text-white/30 hover:text-white/70 transition-colors" title={t('copyMarkdown')}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {ttsSupported && (
            <button onClick={handleReadAloud} className="p-1.5 rounded text-white/30 hover:text-white/70 transition-colors" title={isSpeaking ? t('stopReading') : t('readAloud')}>
              {isSpeaking ? <VolumeX className="w-3.5 h-3.5 text-amber-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          )}
          {onTogglePin && (
            <button onClick={() => onTogglePin(message.id)} className="p-1.5 rounded text-white/30 hover:text-white/70 transition-colors" title={isPinned ? t('unpinMessage') : t('pinMessage')}>
              {isPinned ? <PinOff className="w-3.5 h-3.5 text-amber-400" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
          {onDelete && (
            <div className="relative">
              <button onClick={handleDelete} className="p-1.5 rounded text-white/30 hover:text-red-400/70 transition-colors" title={t('deleteMessage')}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              {showDeleteConfirm && (
                <div className="absolute right-0 top-full mt-1 p-3 rounded-lg bg-[rgba(20,20,30,0.98)] border border-white/[0.1] shadow-xl z-50 min-w-[200px]">
                  <p className="text-xs text-white/70 mb-2">{t('deleteConfirm')}</p>
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => confirmDelete(false)} className="px-2.5 py-1 text-xs rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors">
                      {t('deleteMessage')}
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)} className="px-2.5 py-1 text-xs rounded bg-white/[0.06] text-white/50 hover:text-white/70 transition-colors">
                      Cancel
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[10px] text-white/30 cursor-pointer">
                    <input type="checkbox" onChange={(e) => { if (e.target.checked) confirmDelete(true) }} className="w-3 h-3 rounded" />
                    {t('dontAskAgain')}
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
