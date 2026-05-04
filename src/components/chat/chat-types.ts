// src/components/chat/chat-types.ts
import type { ChatMessage, ToolCall } from '@/hooks/use-chat-session'

export type { ChatMessage, ToolCall }

export interface SlashCommand {
  name: string
  description: string
  category: 'session' | 'model' | 'tools'
  args?: string
  execute?: (args: string) => void
}

export interface ChatToggleState {
  showThinking: boolean
  showToolCalls: boolean
  focusMode: boolean
  hideCron: boolean
}

export interface MessageAction {
  id: string
  icon: string
  label: string
  onClick: (message: ChatMessage) => void
}
