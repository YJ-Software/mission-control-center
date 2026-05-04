'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Zap, ChevronRight, CheckCircle2, X } from 'lucide-react'
import { useChatSession, type ChatMessage as ChatMessageType, type ChatAttachment, type ToolCall } from '@/hooks/use-chat-session'
import { useWebSocket } from '@/store/websocket'
import { usePinnedMessages } from '@/hooks/use-pinned-messages'
import { ChatMessage } from './chat-message'
import { ChatInput } from './chat-input'
import { ChatSearch } from './chat-search'
import { ChatPinned } from './chat-pinned'
import { exportChatAsMarkdown } from './chat-export'
import type { SlashCommand } from './chat-types'

interface ChatPanelProps {
  sessionKey: string | null
  agentName?: string
  compact?: boolean
  showToolCalls?: boolean
  onMessageSent?: () => void
  onFocusToggle?: () => void
}

export function ChatPanel({
  sessionKey,
  agentName,
  compact: _compact = false,
  showToolCalls = true,
  onMessageSent,
  onFocusToggle,
}: ChatPanelProps) {
  const t = useTranslations('chat')
  const {
    messages, isStreaming, streamingText, activeToolCalls,
    sendMessage, abortResponse, deleteMessage, refreshHistory, connected,
  } = useChatSession(sessionKey)
  const { sendRpc } = useWebSocket()
  const { pinnedIds, togglePin, isPinned, clearPins } = usePinnedMessages(sessionKey)
  const [showSearch, setShowSearch] = useState(false)
  const [_showAgentPicker, setShowAgentPicker] = useState(false)
  const [selectedTool, setSelectedTool] = useState<{ name: string; output: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, activeToolCalls])

  // Keyboard shortcut: Cmd/Ctrl+F for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const scrollToMessage = useCallback((id: string) => {
    const el = messagesContainerRef.current?.querySelector(`[data-message-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.classList.add('bg-cyan-500/10')
    setTimeout(() => el?.classList.remove('bg-cyan-500/10'), 1500)
  }, [])

  const handleSend = useCallback((text: string, attachments?: ChatAttachment[]) => {
    sendMessage(text, attachments)
    onMessageSent?.()
  }, [sendMessage, onMessageSent])

  const handleSlashCommand = useCallback(async (cmd: SlashCommand, args: string) => {
    switch (cmd.name) {
      case 'help': {
        // Show available commands as a local message
        break
      }
      case 'new':
        setShowAgentPicker(true)
        break
      case 'clear':
        refreshHistory()
        break
      case 'reset':
        refreshHistory()
        break
      case 'stop':
        abortResponse()
        break
      case 'focus':
        onFocusToggle?.()
        break
      case 'export-session':
        exportChatAsMarkdown(messages, agentName || 'assistant')
        break
      case 'think': {
        if (!sessionKey) break
        if (args) {
          try {
            await sendRpc('sessions.patch', { key: sessionKey, thinkingLevel: args })
          } catch (e) {
            console.warn('/think error:', e instanceof Error ? e.message : e)
          }
        }
        break
      }
      case 'fast': {
        if (!sessionKey) break
        const val = args === 'on' ? true : args === 'off' ? false : undefined
        if (val !== undefined) {
          try {
            await sendRpc('sessions.patch', { key: sessionKey, fastMode: val })
          } catch (e) {
            console.warn('/fast error:', e instanceof Error ? e.message : e)
          }
        }
        break
      }
      case 'verbose': {
        if (!sessionKey) break
        if (args) {
          try {
            await sendRpc('sessions.patch', { key: sessionKey, verboseLevel: args })
          } catch (e) {
            console.warn('/verbose error:', e instanceof Error ? e.message : e)
          }
        }
        break
      }
      case 'model': {
        if (!sessionKey || !args) break
        try {
          await sendRpc('sessions.patch', { key: sessionKey, model: args })
        } catch (e) {
          console.warn('/model error:', e instanceof Error ? e.message : e)
        }
        break
      }
      case 'usage': {
        if (!sessionKey) break
        try {
          const result = await sendRpc('sessions.usage.logs', { sessionKey, limit: 1 }) as any
          const logs = result?.logs || result || []
          const last = Array.isArray(logs) && logs.length > 0 ? logs[0] : null
          if (last) {
            const info = `Token Usage:\n- Input: ${last.inputTokens || '?'}\n- Output: ${last.outputTokens || '?'}\n- Total: ${(last.inputTokens || 0) + (last.outputTokens || 0)}\n- Cost: $${last.cost || '?'}`
            console.log(info)
          }
        } catch (e) {
          console.warn('/usage error:', e instanceof Error ? e.message : e)
        }
        break
      }
      case 'agents': {
        try {
          const result = await sendRpc('agents.list') as any
          const agents = result?.agents || result || []
          if (Array.isArray(agents)) {
            const list = agents.map((a: any) => `- ${a.name || a.id} (${a.id})`).join('\n')
            console.log('Agents:\n' + list)
          }
        } catch (e) {
          console.warn('/agents error:', e instanceof Error ? e.message : e)
        }
        break
      }
    }
  }, [messages, agentName, sessionKey, refreshHistory, abortResponse, onFocusToggle, sendRpc])

  const handleExport = useCallback(() => {
    exportChatAsMarkdown(messages, agentName || 'assistant')
  }, [messages, agentName])

  if (!sessionKey) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 font-mono text-sm tracking-widest">
        {t('selectAgent')}
      </div>
    )
  }

  // Group consecutive same-role messages
  const groupedMessages = groupConsecutiveMessages(messages)

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: main chat area */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Search bar */}
      {showSearch && (
        <div className="mx-auto w-full max-w-[960px] xl:max-w-[1100px] 2xl:max-w-[1280px] px-2">
          <ChatSearch
            messages={messages}
            onClose={() => setShowSearch(false)}
            onScrollToMessage={scrollToMessage}
          />
        </div>
      )}

      {/* Pinned messages */}
      <div className="mx-auto w-full max-w-[960px] xl:max-w-[1100px] 2xl:max-w-[1280px] px-2">
        <ChatPinned
          messages={messages}
          pinnedIds={pinnedIds}
          onScrollToMessage={scrollToMessage}
          onClearPins={clearPins}
        />
      </div>

      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-2 touch-pan-y">
        <div className="mx-auto w-full max-w-[960px] xl:max-w-[1100px] 2xl:max-w-[1280px] px-2">
          {messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-full min-h-[200px] text-white/30 font-mono text-sm tracking-widest">
              {t('noMessages')}
            </div>
          )}

          {groupedMessages.map((group) => (
            <div key={group[0].id}>
              {group.map((msg, mi) => (
                <div key={msg.id} data-message-id={msg.id} className="transition-colors duration-500">
                  {/* Tool calls before assistant content */}
                  {msg.role !== 'user' && showToolCalls && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="pl-12 pr-4 py-1">
                      <ToolCallsBlock onSelectTool={(name, output) => setSelectedTool({ name, output })} toolCalls={msg.toolCalls} />
                    </div>
                  )}
                  <ChatMessage
                    message={msg}
                    agentName={agentName}
                    isFirstInGroup={mi === 0}
                    showToolCalls={showToolCalls}
                    onDelete={deleteMessage}
                    onTogglePin={togglePin}
                    isPinned={isPinned(msg.id)}
                  />
                </div>
              ))}
            </div>
          ))}

          {/* Active tool calls during streaming */}
          {isStreaming && showToolCalls && activeToolCalls.length > 0 && (
            <div className="pl-12 pr-4 py-1">
              <ToolCallsBlock onSelectTool={(name, output) => setSelectedTool({ name, output })} toolCalls={activeToolCalls} />
            </div>
          )}

          {/* Streaming message */}
          {isStreaming && streamingText && (
            <ChatMessage
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingText,
                timestamp: Date.now(),
                state: 'streaming',
              }}
              agentName={agentName}
              isFirstInGroup={true}
              showToolCalls={showToolCalls}
            />
          )}

          {/* Streaming indicator (no text yet, no tools) */}
          {isStreaming && !streamingText && activeToolCalls.length === 0 && (
            <div className="flex gap-3 px-4 py-1.5">
              <div className="w-9 shrink-0" />
              <div className="flex gap-1.5 py-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400/60 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-cyan-400/60 animate-pulse [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-cyan-400/60 animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="w-full">
        <ChatInput
          isStreaming={isStreaming}
          connected={connected}
          agentName={agentName}
          onSend={handleSend}
          onAbort={abortResponse}
          onSlashCommand={handleSlashCommand}
          onNewSession={() => setShowAgentPicker(true)}
          onExport={handleExport}
        />
      </div>
      </div>

      {/* Right: Tool Output sidebar */}
      {selectedTool && (
        <div
          className="w-[380px] shrink-0 border-l border-white/[0.06] flex flex-col"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
            <h3 className="text-sm font-semibold text-white/80">Tool Output</h3>
            <button
              onClick={() => setSelectedTool(null)}
              className="p-1 rounded text-white/30 hover:text-white/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-xs text-white/40 font-mono mb-2">{selectedTool.name}</div>
            <pre className="text-sm text-white/70 whitespace-pre-wrap break-all font-mono leading-relaxed">
              {formatToolOutput(selectedTool.output)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupConsecutiveMessages(messages: ChatMessageType[]): ChatMessageType[][] {
  const groups: ChatMessageType[][] = []
  for (const msg of messages) {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup[0].role === msg.role) {
      lastGroup.push(msg)
    } else {
      groups.push([msg])
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// Tool Calls Block
// ---------------------------------------------------------------------------

function ToolCallsBlock({ toolCalls, onSelectTool }: { toolCalls: ToolCall[]; onSelectTool?: (name: string, output: string) => void }) {
  const uniqueNames = [...new Set(toolCalls.map(tc => tc.name))]
  const namesLabel = uniqueNames.length <= 3
    ? uniqueNames.join(', ')
    : `${uniqueNames.slice(0, 2).join(', ')} +${uniqueNames.length - 2}`
  const allCompleted = toolCalls.every(tc => tc.status === 'completed')

  return (
    <details
      className="rounded-xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <summary className="flex items-center gap-2 px-3.5 py-2 cursor-pointer select-none text-sm text-white/70 hover:text-white/90 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 [[open]>&]:rotate-90" />
        <Zap className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
        <span className="font-medium">
          {toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''}
        </span>
        <span className="text-white/40">{namesLabel}</span>
        {!allCompleted && (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400/60 animate-spin ml-auto" />
        )}
      </summary>

      <div className="px-3.5 pb-3 space-y-2 border-t border-white/[0.06] pt-2">
        {toolCalls.map(tc => (
          <ToolCallItem key={tc.toolCallId} toolCall={tc} onSelectTool={onSelectTool} />
        ))}
      </div>
    </details>
  )
}

function ToolCallItem({ toolCall, onSelectTool }: { toolCall: ToolCall; onSelectTool?: (name: string, output: string) => void }) {
  const argsSummary = summarizeArgs(toolCall.name, toolCall.args)
  const hasOutput = !!toolCall.output

  return (
    <div
      className={`rounded-lg px-3 py-2 ${hasOutput ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
      onClick={() => { if (hasOutput && onSelectTool) onSelectTool(toolCall.name, toolCall.output!) }}
    >
      <div className="flex items-center gap-2">
        <ToolIcon name={toolCall.name} />
        <span className="text-sm font-medium text-white/80">{toolCall.name}</span>
        {hasOutput && onSelectTool && (
          <span className="text-[11px] text-cyan-400/60 ml-auto shrink-0">View</span>
        )}
        {toolCall.status === 'completed' ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400/60 animate-spin shrink-0" />
        )}
      </div>
      {argsSummary && (
        <p className="text-xs text-white/40 mt-1 font-mono truncate">{argsSummary}</p>
      )}
      {toolCall.output && (
        <p className="text-xs text-white/30 mt-1 font-mono truncate">{toolCall.output.slice(0, 100)}</p>
      )}
    </div>
  )
}


function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase()
  let emoji = '🔧'
  if (n.includes('read') || n.includes('file')) emoji = '📄'
  else if (n.includes('web_search') || n.includes('search')) emoji = '🔍'
  else if (n.includes('web_fetch') || n.includes('fetch')) emoji = '🌐'
  else if (n.includes('browser')) emoji = '🖥️'
  else if (n.includes('write') || n.includes('edit')) emoji = '✏️'
  else if (n.includes('exec') || n.includes('bash') || n.includes('shell')) emoji = '⚡'
  return <span className="text-xs">{emoji}</span>
}

function formatToolOutput(output: string): string {
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(output)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return output
  }
}

function summarizeArgs(_name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  if (a.from || a.path || a.file_path) return `${a.from || a.path || a.file_path}`
  if (a.query) return `"${String(a.query).slice(0, 80)}"`
  if (a.url) return `${String(a.url).slice(0, 80)}`
  if (a.command) return `$ ${String(a.command).slice(0, 80)}`
  if (a.content && typeof a.content === 'string') return `${String(a.content).slice(0, 60)}...`
  const keys = Object.keys(a).slice(0, 2)
  return keys.map(k => `${k}: ${String(a[k]).slice(0, 40)}`).join(', ')
}
