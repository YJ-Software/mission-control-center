'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Send, Square, Paperclip, Mic, MicOff, Plus, Download, AlertCircle, X } from 'lucide-react'
import { useSpeechToText } from '@/hooks/use-speech'
import { useInputHistory } from '@/hooks/use-input-history'
import type { SlashCommand } from './chat-types'
import type { ChatAttachment } from '@/hooks/use-chat-session'
import { ChatSlashMenu, getDefaultSlashCommands } from './chat-slash-menu'

interface ChatInputProps {
  isStreaming: boolean
  connected: boolean
  agentName?: string
  onSend: (text: string, attachments?: ChatAttachment[]) => void
  onAbort: () => void
  onSlashCommand: (command: SlashCommand, args: string) => void
  onNewSession: () => void
  onExport: () => void
}

export function ChatInput({
  isStreaming,
  connected,
  agentName,
  onSend,
  onAbort,
  onSlashCommand,
  onNewSession,
  onExport,
}: ChatInputProps) {
  const t = useTranslations('chat')
  const tSlash = useTranslations('chat.slash')
  const [input, setInput] = useState('')
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [attachments, setAttachments] = useState<{ dataUrl: string; name: string; mimeType: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { push, navigateUp, navigateDown, reset: resetHistory } = useInputHistory()
  const { isRecording, transcript, interimTranscript, startRecording, stopRecording, isSupported: sttSupported } = useSpeechToText()

  const slashCommands = getDefaultSlashCommands((key: string) => tSlash(key))

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px'
    }
  }, [input])

  // Append speech transcript to input
  useEffect(() => {
    if (transcript) {
      setInput(prev => prev + transcript)
    }
  }, [transcript])

  // Slash menu detection
  useEffect(() => {
    if (input.startsWith('/') && !input.includes(' ')) {
      setShowSlashMenu(true)
      setSlashQuery(input.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }, [input])

  const handleSend = useCallback(() => {
    const text = input.trim()
    const hasAttachments = attachments.length > 0
    if (isStreaming) return
    if (!text && !hasAttachments) return

    // Check for slash command (only when no attachments are queued)
    if (text.startsWith('/') && !hasAttachments) {
      const spaceIndex = text.indexOf(' ')
      const cmdName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
      const cmdArgs = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()
      const cmd = slashCommands.find(c => c.name === cmdName)
      if (cmd) {
        onSlashCommand(cmd, cmdArgs)
        setInput('')
        setShowSlashMenu(false)
        resetHistory()
        return
      }
    }

    if (text) push(text)
    const payload = hasAttachments
      ? attachments.map(a => ({ dataUrl: a.dataUrl, fileName: a.name, mimeType: a.mimeType }))
      : undefined
    onSend(text, payload)
    setInput('')
    setAttachments([])
    resetHistory()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, isStreaming, attachments, slashCommands, onSlashCommand, onSend, push, resetHistory])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'ArrowUp' && !showSlashMenu) {
      const textarea = textareaRef.current
      if (textarea && textarea.selectionStart === 0) {
        const prev = navigateUp(input)
        if (prev !== null) { e.preventDefault(); setInput(prev) }
      }
    } else if (e.key === 'ArrowDown' && !showSlashMenu) {
      const textarea = textareaRef.current
      if (textarea && textarea.selectionEnd === textarea.value.length) {
        const next = navigateDown()
        if (next !== null) { e.preventDefault(); setInput(next) }
      }
    }
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setShowSlashMenu(false)
    setInput('')
    onSlashCommand(cmd, '')
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments(prev => [...prev, { dataUrl: reader.result as string, name: file.name, mimeType: file.type }])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        const mime = file.type || item.type
        const ext = mime.split('/')[1] || 'png'
        const reader = new FileReader()
        reader.onload = () => {
          setAttachments(prev => [...prev, { dataUrl: reader.result as string, name: `pasted-image.${ext}`, mimeType: mime }])
        }
        reader.readAsDataURL(file)
      }
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const placeholder = agentName
    ? t('inputPlaceholder', { name: agentName })
    : t('inputPlaceholderDefault')

  return (
    <div className="border-t border-white/[0.06] shrink-0" style={{ background: 'rgba(255,255,255,0.02)' }}>
      {!connected && (
        <div className="flex items-center gap-2 text-red-400/80 text-xs px-4 pt-2 font-mono">
          <AlertCircle className="w-3 h-3" />
          {t('disconnected')}
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 px-4 pt-2 overflow-x-auto">
          {attachments.map((att, i) => (
            <div key={i} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-white/[0.1]">
              <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="relative px-3 py-3">
        {showSlashMenu && (
          <ChatSlashMenu
            query={slashQuery}
            commands={slashCommands}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
          />
        )}

        <div className="flex items-end gap-2">
          {/* Left buttons */}
          <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg text-white/30 hover:text-white/60 transition-colors"
              title={t('input.attachFile')}
              disabled={!connected}
            >
              <Paperclip className="w-4 h-4" />
            </button>
            {sttSupported && (
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`p-2 rounded-lg transition-colors ${
                  isRecording ? 'text-red-400 animate-pulse bg-red-500/10' : 'text-white/30 hover:text-white/60'
                }`}
                title={isRecording ? t('input.recording') : t('input.voiceInput')}
                disabled={!connected}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input + (interimTranscript ? interimTranscript : '')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            disabled={!connected}
          />

          {/* Right buttons */}
          <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
            <button
              onClick={onNewSession}
              className="p-2 rounded-lg text-white/30 hover:text-white/60 transition-colors"
              title={t('newSession')}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onExport}
              className="p-2 rounded-lg text-white/30 hover:text-white/60 transition-colors"
              title={t('input.exportChat')}
            >
              <Download className="w-4 h-4" />
            </button>

            {isStreaming ? (
              <button
                onClick={onAbort}
                className="p-2 rounded-lg text-red-400 hover:text-red-300 transition-colors"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                title={t('abort')}
              >
                <Square className="w-4 h-4" />
              </button>
            ) : (
              (() => {
                const canSend = (input.trim().length > 0 || attachments.length > 0) && connected
                return (
                  <button
                    onClick={handleSend}
                    disabled={!canSend}
                    className="p-2 rounded-lg text-cyan-400 hover:text-cyan-300 disabled:text-white/20 disabled:cursor-not-allowed transition-colors"
                    style={{
                      background: canSend ? 'rgba(0,200,255,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${canSend ? 'rgba(0,200,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                    title={t('send')}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )
              })()
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
