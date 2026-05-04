/**
 * Session data reading from OpenClaw agent session files.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { estimateMsgCost, normalizeProvider, normalizeModel } from './model-pricing'

const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')

/** Get all agent session directories that have sessions.json */
function getAllSessionsDirs(): { agentId: string; sessDir: string }[] {
  const result: { agentId: string; sessDir: string }[] = []
  try {
    const agents = fs.readdirSync(agentsDir).filter(d => {
      try { return fs.statSync(path.join(agentsDir, d)).isDirectory() } catch { return false }
    })
    for (const agent of agents) {
      const sessDir = path.join(agentsDir, agent, 'sessions')
      if (fs.existsSync(path.join(sessDir, 'sessions.json'))) {
        result.push({ agentId: agent, sessDir })
      }
    }
  } catch { /* ignore */ }
  return result
}

function isSessionFile(f: string): boolean {
  return f.endsWith('.jsonl') || f.includes('.jsonl.reset.')
}

function extractSessionId(f: string): string {
  return f.replace(/\.jsonl(?:\.reset\.\d+)?$/, '')
}

function resolveName(key: string): string {
  const parts = key.split(':')
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]
    if (key.includes('cron')) return 'Cron: ' + last.substring(0, 12)
    if (key.includes('subagent')) return last.substring(0, 12)
    return last.substring(0, 20)
  }
  return key.substring(0, 20)
}

function getLastMessage(sessDir: string, sessionId: string): string {
  try {
    const filePath = path.join(sessDir, sessionId + '.jsonl')
    if (!fs.existsSync(filePath)) return ''
    const data = fs.readFileSync(filePath, 'utf-8')
    const lines = data.split('\n').filter(l => l.trim())
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      try {
        const d = JSON.parse(lines[i])
        if (d.type !== 'message') continue
        const msg = d.message
        if (!msg) continue
        if (msg.role !== 'user' && msg.role !== 'assistant') continue
        let text = ''
        if (typeof msg.content === 'string') {
          text = msg.content
        } else if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'text' && b.text) { text = b.text; break }
          }
        }
        if (text) return text.replace(/\n/g, ' ').substring(0, 80)
      } catch { /* skip bad line */ }
    }
    return ''
  } catch { return '' }
}

// Cost cache — recalculated every 60 seconds
let sessionCostCache: Record<string, number> = {}
let sessionCostCacheTime = 0

function refreshCostCache() {
  const now = Date.now()
  if (now - sessionCostCacheTime < 60000) return
  sessionCostCache = {}
  sessionCostCacheTime = now
  for (const { sessDir } of getAllSessionsDirs()) {
    try {
      const files = fs.readdirSync(sessDir).filter(isSessionFile)
      for (const file of files) {
        const sid = extractSessionId(file)
        let total = 0
        const lines = fs.readFileSync(path.join(sessDir, file), 'utf-8').split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const d = JSON.parse(line)
            if (d.type !== 'message') continue
            const c = estimateMsgCost(d.message || {})
            if (c > 0) total += c
          } catch { /* skip */ }
        }
        if (total > 0) sessionCostCache[sid] = Math.round(total * 100) / 100
      }
    } catch { /* ignore */ }
  }
}

export interface SessionInfo {
  key: string
  label: string
  model: string
  totalTokens: number
  contextTokens: number
  kind: string
  updatedAt: number
  createdAt: number
  aborted: boolean
  channel: string
  sessionId: string
  lastMessage: string
  cost: number
  agentId: string
}

export function getSessions(): SessionInfo[] {
  refreshCostCache()
  const all: SessionInfo[] = []
  for (const { agentId, sessDir } of getAllSessionsDirs()) {
    try {
      const sFile = path.join(sessDir, 'sessions.json')
      if (!fs.existsSync(sFile)) continue
      const data = JSON.parse(fs.readFileSync(sFile, 'utf-8'))
      for (const [key, s] of Object.entries(data) as [string, any][]) {
        all.push({
          key,
          label: s.label || resolveName(key),
          model: s.modelOverride || s.model || '-',
          totalTokens: s.totalTokens || 0,
          contextTokens: s.contextTokens || 0,
          kind: s.kind || (key.includes('group') ? 'group' : 'direct'),
          updatedAt: s.updatedAt || 0,
          createdAt: s.createdAt || s.updatedAt || 0,
          aborted: s.abortedLastRun || false,
          channel: s.channel || '-',
          sessionId: s.sessionId || '-',
          lastMessage: getLastMessage(sessDir, s.sessionId || key),
          cost: sessionCostCache[s.sessionId || key] || 0,
          agentId,
        })
      }
    } catch { /* ignore agent */ }
  }
  return all
}

export interface SessionMessage {
  role: string
  content: string
  timestamp: string
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (const { sessDir } of getAllSessionsDirs()) {
    try {
      const files = fs.readdirSync(sessDir).filter(isSessionFile)
      let targetFile = files.find(f => f.includes(sessionId))
      if (!targetFile) {
        const sFile = path.join(sessDir, 'sessions.json')
        if (fs.existsSync(sFile)) {
          const data = JSON.parse(fs.readFileSync(sFile, 'utf-8'))
          for (const [, v] of Object.entries(data) as [string, any][]) {
            if (v.sessionId === sessionId) {
              targetFile = files.find(f => f.includes(v.sessionId))
              break
            }
          }
        }
      }
      if (!targetFile) continue
      const lines = fs.readFileSync(path.join(sessDir, targetFile), 'utf-8').split('\n').filter(l => l.trim())
      for (let i = Math.max(0, lines.length - 30); i < lines.length; i++) {
        try {
          const d = JSON.parse(lines[i])
          if (d.type !== 'message') continue
          const msg = d.message
          if (!msg) continue
          let text = ''
          if (typeof msg.content === 'string') {
            text = msg.content
          } else if (Array.isArray(msg.content)) {
            for (const b of msg.content) {
              if (b.type === 'text' && b.text) { text = b.text; break }
              if (b.type === 'tool_use' || b.type === 'toolCall') { text = '🔧 ' + (b.name || b.toolName || 'tool'); break }
              if (b.type === 'tool_result') { text = b.content?.substring?.(0, 300) || '[tool result]'; break }
            }
          }
          if (text) {
            messages.push({
              role: msg.role || 'unknown',
              content: text.substring(0, 300),
              timestamp: d.timestamp || '',
            })
          }
        } catch { /* skip */ }
      }
      if (messages.length > 0) return messages // Found in this agent
    } catch { /* ignore */ }
  }
  return messages
}

/**
 * Cost breakdown data — shared between sessions and future costs page.
 */
export interface CostData {
  total: number
  today: number
  week: number
  perModel: Record<string, number>
  perDay: Record<string, number>
  perSession: Record<string, { cost: number; label: string }>
}

export function getCostData(): CostData {
  const perModel: Record<string, number> = {}
  const perDay: Record<string, number> = {}
  const perSession: Record<string, number> = {}
  const sessionLabels: Record<string, string> = {}
  let total = 0

  for (const { sessDir } of getAllSessionsDirs()) {
    // Load session labels from sessions.json
    try {
      const sFile = path.join(sessDir, 'sessions.json')
      if (fs.existsSync(sFile)) {
        const data = JSON.parse(fs.readFileSync(sFile, 'utf-8'))
        for (const [key, s] of Object.entries(data)) {
          const info = s as { label?: string; sessionId?: string }
          const sid = info.sessionId || key
          sessionLabels[sid] = info.label || resolveName(key)
        }
      }
    } catch { /* ignore */ }

    try {
      const files = fs.readdirSync(sessDir).filter(isSessionFile)
      for (const file of files) {
        const sid = extractSessionId(file)
        const lines = fs.readFileSync(path.join(sessDir, file), 'utf-8').split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const d = JSON.parse(line)
            if (d.type !== 'message') continue
            const msg = d.message
            if (!msg?.usage) continue
            const c = estimateMsgCost(msg)
            if (c <= 0) continue
            const provider = normalizeProvider(msg.provider)
            const model = normalizeModel(provider, msg.model)
            const ts: string = d.timestamp || ''
            const day = ts.substring(0, 10)
            const modelKey = `${provider}/${model}`
            perModel[modelKey] = (perModel[modelKey] || 0) + c
            if (day) perDay[day] = (perDay[day] || 0) + c
            perSession[sid] = (perSession[sid] || 0) + c
            total += c
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }
  }

  const todayKey = new Date().toISOString().substring(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10)
  let weekCost = 0
  for (const [d, c] of Object.entries(perDay)) {
    if (d >= weekAgo) weekCost += c
  }

  const perSessionWithLabels: Record<string, { cost: number; label: string }> = {}
  for (const [sid, cost] of Object.entries(perSession)) {
    if (cost > 0) {
      perSessionWithLabels[sid] = {
        cost: Math.round(cost * 100) / 100,
        label: sessionLabels[sid] || sid.substring(0, 12),
      }
    }
  }

  return {
    total: Math.round(total * 100) / 100,
    today: Math.round((perDay[todayKey] || 0) * 100) / 100,
    week: Math.round(weekCost * 100) / 100,
    perModel,
    perDay: Object.fromEntries(
      Object.entries(perDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)
    ),
    perSession: perSessionWithLabels,
  }
}
