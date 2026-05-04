/**
 * Live Feed — watches session .jsonl files for real-time agent activity.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

const agentsDir = path.join(os.homedir(), '.openclaw', 'agents')

function isSessionFile(f: string): boolean {
  return f.endsWith('.jsonl')
}

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

function getSessionLabel(sessDir: string, sessionKey: string): string {
  try {
    const sFile = path.join(sessDir, 'sessions.json')
    if (!fs.existsSync(sFile)) return sessionKey.substring(0, 12)
    const data = JSON.parse(fs.readFileSync(sFile, 'utf-8'))
    for (const [key, s] of Object.entries(data)) {
      const info = s as { label?: string; sessionId?: string }
      const sid = info.sessionId || key
      if (sid === sessionKey || key.includes(sessionKey)) {
        return info.label || resolveName(key)
      }
    }
  } catch { /* ignore */ }
  return sessionKey.substring(0, 12)
}

export interface LiveEvent {
  timestamp: string
  session: string
  role: string
  content: string
}

function formatLiveEvent(data: Record<string, unknown>, sessDir: string): LiveEvent | null {
  const timestamp = (data.timestamp as string) || new Date().toISOString()
  const sessionKey = (data._sessionKey as string) || 'unknown'

  if (data.type !== 'message') return null
  const msg = data.message as Record<string, unknown> | undefined
  if (!msg) return null

  const role = (msg.role as string) || 'unknown'
  let content = ''

  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        content = (block.text as string).substring(0, 500)
        break
      } else if (block.type === 'toolCall' || block.type === 'tool_use') {
        content = `🔧 ${block.name || block.toolName || 'tool'}(${JSON.stringify(block.arguments || block.input || {}).substring(0, 300)})`
        break
      } else if (block.type === 'toolResult' || block.type === 'tool_result') {
        const rc = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '')
        content = `📋 Result: ${rc.substring(0, 300)}`
        break
      } else if (block.type === 'thinking') {
        content = `💭 ${((block.thinking as string) || '').substring(0, 300)}`
        break
      }
    }
    if (!content && msg.content[0]) {
      content = JSON.stringify(msg.content[0]).substring(0, 300)
    }
  } else if (typeof msg.content === 'string') {
    content = msg.content.substring(0, 500)
  }

  if (!content) return null

  const label = getSessionLabel(sessDir, sessionKey)

  return {
    timestamp,
    session: label,
    role,
    content: content.replace(/\n/g, ' ').trim(),
  }
}

/** Get recent events from active session files (last hour). */
export function getRecentEvents(limit = 20): LiveEvent[] {
  const events: LiveEvent[] = []
  const cutoff = Date.now() - 3600000

  for (const { sessDir } of getAllSessionsDirs()) {
    try {
      const files = fs.readdirSync(sessDir).filter(f => {
        if (!isSessionFile(f)) return false
        try { return fs.statSync(path.join(sessDir, f)).mtimeMs > cutoff } catch { return false }
      })
      for (const file of files) {
        const sessionKey = file.replace('.jsonl', '')
        const content = fs.readFileSync(path.join(sessDir, file), 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        lines.slice(-5).forEach(line => {
          try {
            const data = JSON.parse(line)
            data._sessionKey = sessionKey
            const event = formatLiveEvent(data, sessDir)
            if (event) events.push(event)
          } catch { /* skip */ }
        })
      }
    } catch { /* ignore */ }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return events.slice(0, limit)
}

export interface LiveWatcherHandle {
  onEvent: (cb: (event: LiveEvent) => void) => void
  close: () => void
}

/** Watch all session directories for new JSONL lines. */
export function watchLive(): LiveWatcherHandle {
  const callbacks: ((event: LiveEvent) => void)[] = []
  const fileWatchers: Record<string, fs.FSWatcher> = {}
  const fileSizes: Record<string, number> = {}
  const dirWatchers: fs.FSWatcher[] = []

  function watchFile(sessDir: string, file: string) {
    const filePath = path.join(sessDir, file)
    const key = filePath
    if (fileWatchers[key]) return
    try { fileSizes[key] = fs.statSync(filePath).size } catch { fileSizes[key] = 0 }

    try {
      fileWatchers[key] = fs.watch(filePath, eventType => {
        if (eventType !== 'change') return
        try {
          const stats = fs.statSync(filePath)
          if (stats.size <= (fileSizes[key] || 0)) return
          const fd = fs.openSync(filePath, 'r')
          const buffer = Buffer.allocUnsafe(stats.size - (fileSizes[key] || 0))
          fs.readSync(fd, buffer, 0, buffer.length, fileSizes[key] || 0)
          fs.closeSync(fd)
          fileSizes[key] = stats.size
          const sessionKey = file.replace('.jsonl', '')
          buffer.toString('utf-8').split('\n').filter(l => l.trim()).forEach(line => {
            try {
              const data = JSON.parse(line)
              data._sessionKey = sessionKey
              const event = formatLiveEvent(data, sessDir)
              if (event) callbacks.forEach(cb => cb(event))
            } catch { /* skip */ }
          })
        } catch { /* skip */ }
      })
    } catch { /* skip */ }
  }

  for (const { sessDir } of getAllSessionsDirs()) {
    try {
      fs.readdirSync(sessDir).filter(isSessionFile).forEach(f => watchFile(sessDir, f))
      const w = fs.watch(sessDir, (_eventType, filename) => {
        if (filename && isSessionFile(filename)) {
          try {
            if (fs.existsSync(path.join(sessDir, filename))) watchFile(sessDir, filename)
          } catch { /* skip */ }
        }
      })
      dirWatchers.push(w)
    } catch { /* ignore */ }
  }

  return {
    onEvent(cb) { callbacks.push(cb) },
    close() {
      Object.values(fileWatchers).forEach(w => { try { w.close() } catch {} })
      dirWatchers.forEach(w => { try { w.close() } catch {} })
    },
  }
}
