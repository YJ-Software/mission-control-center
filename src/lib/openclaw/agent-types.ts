export type AgentRow = {
  id: string
  name?: string
  identity?: {
    name?: string
    theme?: string
    emoji?: string
    avatar?: string
    avatarUrl?: string
  }
}

export type AgentsListResult = {
  defaultId: string
  mainKey: string
  scope: string
  agents: AgentRow[]
}

export type AgentFileKind = 'AGENTS' | 'SOUL' | 'TOOLS' | 'IDENTITY' | 'USER' | 'HEARTBEAT' | 'MEMORY'

export type AgentFileEntry = {
  kind: AgentFileKind
  path: string
  exists: boolean
  sizeBytes?: number
  updatedAtMs?: number
}

export type AgentFilesListResult = {
  agentId: string
  workspace: string
  files: AgentFileEntry[]
}

export type AgentFilesGetResult = {
  kind: AgentFileKind
  path: string
  content: string
  updatedAtMs?: number
}

export type ToolCatalogEntry = {
  id: string
  name: string
  description?: string
  category?: 'builtin' | 'workspace' | 'extra' | 'other'
  defaultAllowed?: boolean
}

export type ToolsCatalogResult = {
  agentId: string
  tools: ToolCatalogEntry[]
  profile?: 'full' | 'limited' | 'custom'
  source?: 'global' | 'agent'
}

export type ToolsEffectiveResult = {
  agentId: string
  allowed: string[]
  denied: string[]
  source: Record<string, 'global' | 'agent'>
}

export type SkillStatusEntry = {
  key: string
  name: string
  description?: string
  category: 'workspace' | 'builtin' | 'extra' | 'other'
  enabled: boolean
  eligible: boolean
  requiresApiKey?: boolean
}

export type SkillStatusReport = {
  agentId: string
  skills: SkillStatusEntry[]
}

export type ChannelStatusEntry = {
  id: string
  provider: string
  policy?: string
  connected: boolean
  displayName?: string
}

export type ChannelsStatusResult = {
  agentId: string
  channels: ChannelStatusEntry[]
}

export type AgentsPanel = 'overview' | 'files' | 'tools' | 'skills' | 'channels' | 'cron'
