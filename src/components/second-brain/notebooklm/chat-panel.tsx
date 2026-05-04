'use client'

import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Send, Loader2, MessageSquare, RotateCcw } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  value?: {
    answer: string
    conversation_id?: string
  }
  answer?: string
  conversation_id?: string
}

const STORAGE_PREFIX = 'nlm-chat-'

function loadChat(notebookId: string): { messages: Message[]; conversationId: string | null } {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${notebookId}`)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { messages: [], conversationId: null }
}

function saveChat(notebookId: string, messages: Message[], conversationId: string | null) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${notebookId}`, JSON.stringify({ messages, conversationId }))
  } catch { /* ignore */ }
}

export function ChatPanel({ notebookId }: { notebookId: string }) {
  const t = useTranslations('secondBrain.notebooklm.chatPanel')
  const [messages, setMessages] = useState<Message[]>(() => loadChat(notebookId).messages)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(() => loadChat(notebookId).conversationId)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Persist on change
  useEffect(() => {
    saveChat(notebookId, messages, conversationId)
  }, [notebookId, messages, conversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const chatMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, conversationId }),
      })
      if (!res.ok) throw new Error('Chat failed')
      return res.json() as Promise<ChatResponse>
    },
    onSuccess: (data) => {
      const answer = data.value?.answer || data.answer || ''
      const convId = data.value?.conversation_id || data.conversation_id
      if (convId) setConversationId(convId)
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
    },
  })

  function handleSend() {
    const q = input.trim()
    if (!q || chatMutation.isPending) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    chatMutation.mutate(q)
  }

  function handleNewChat() {
    setMessages([])
    setConversationId(null)
    try { localStorage.removeItem(`${STORAGE_PREFIX}${notebookId}`) } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <h3 className="text-sm font-medium text-white">{t('title')}</h3>
        {messages.length > 0 && (
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t('newChat')}
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
            <MessageSquare className="w-8 h-8" />
            <p className="text-sm">{t('noMessages')}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-cyan-500/15 text-white/90 border border-cyan-500/20'
                : 'bg-white/[0.04] text-white/80 border border-white/[0.06]'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/40 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('sending')}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="pt-3 border-t border-white/[0.06]">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={t('placeholder')}
            className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
            disabled={chatMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={chatMutation.isPending || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
