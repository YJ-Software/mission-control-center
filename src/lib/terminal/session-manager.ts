import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { getBrowserConfig } from '@/lib/browser/config'

const MAX_SESSIONS = 5
const IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000 // 6h of no PTY activity → kill
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // scan every 5min
const MAX_BUFFER_BYTES = 1_048_576 // 1MB

// Environment variables to strip from PTY
const SENSITIVE_PATTERNS = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'DATABASE_URL', 'GATEWAY_WS']

function sanitizeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_PATTERNS.some(p => key.toUpperCase().includes(p))) continue
    env[key] = value
  }
  return env
}

export interface TerminalSessionInfo {
  id: string
  title: string
  createdAt: string
}

interface TerminalSession {
  id: string
  title: string
  createdAt: string
  ptyProcess: pty.IPty | null // null until first resize from client
  ws: import('ws').WebSocket | null
  buffer: string
  bufferBytes: number
  ptySpawned: boolean
  lastActivityAt: number // ms timestamp, updated on any PTY input/output
}

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Periodically scan for idle sessions and kill them
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), CLEANUP_INTERVAL_MS)
  }

  private cleanupIdleSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > IDLE_TIMEOUT_MS) {
        this.closeSession(id)
      }
    }
  }

  createSession(): TerminalSessionInfo {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error('MAX_SESSIONS_REACHED')
    }

    const id = randomUUID()
    const shell = process.env.SHELL || '/bin/bash'

    const session: TerminalSession = {
      id,
      title: shell.split('/').pop() || 'shell',
      createdAt: new Date().toISOString(),
      ptyProcess: null, // Deferred until first resize
      ws: null,
      buffer: '',
      bufferBytes: 0,
      ptySpawned: false,
      lastActivityAt: Date.now(),
    }

    this.sessions.set(id, session)

    return { id, title: session.title, createdAt: session.createdAt }
  }

  private spawnPty(session: TerminalSession, cols: number, rows: number): void {
    if (session.ptySpawned) return

    const shell = process.env.SHELL || '/bin/bash'
    const env = sanitizeEnv()

    // Set DISPLAY to Browser's X display so GUI apps (e.g. xdg-open) render in noVNC
    if (!env.DISPLAY) {
      try {
        env.DISPLAY = getBrowserConfig('display') || ':6'
      } catch {
        env.DISPLAY = ':6'
      }
    }

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: env.HOME || process.cwd(),
      env,
    })

    session.ptyProcess = ptyProcess
    session.ptySpawned = true

    ptyProcess.onData((data: string) => {
      session.lastActivityAt = Date.now()
      // Append to buffer (cap at MAX_BUFFER_BYTES)
      session.buffer += data
      session.bufferBytes += Buffer.byteLength(data)
      if (session.bufferBytes > MAX_BUFFER_BYTES) {
        // Trim from the front
        const excess = session.bufferBytes - MAX_BUFFER_BYTES
        let trimmed = 0
        let i = 0
        while (trimmed < excess && i < session.buffer.length) {
          trimmed += Buffer.byteLength(session.buffer[i])
          i++
        }
        session.buffer = session.buffer.slice(i)
        session.bufferBytes = Buffer.byteLength(session.buffer)
      }

      // Forward to WebSocket if connected
      if (session.ws?.readyState === 1) { // WebSocket.OPEN
        session.ws.send(JSON.stringify({ type: 'output', data }))
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      if (session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({ type: 'exit', code: exitCode }))
      }
      this.sessions.delete(session.id)
    })
  }

  attachWebSocket(sessionId: string, ws: import('ws').WebSocket): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Mutex: only one WS per session
    if (session.ws?.readyState === 1) {
      session.ws.close(1000, 'replaced')
    }

    session.ws = ws
    session.lastActivityAt = Date.now()

    // On reconnect (PTY already running), replay buffer
    if (session.ptySpawned && session.buffer.length > 0) {
      ws.send(JSON.stringify({ type: 'reconnected', bufferedOutput: session.buffer }))
    }

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'input' && typeof msg.data === 'string') {
          session.lastActivityAt = Date.now()
          session.ptyProcess?.write(msg.data)
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          session.lastActivityAt = Date.now()
          const cols = Math.max(1, Math.min(500, msg.cols))
          const rows = Math.max(1, Math.min(200, msg.rows))

          if (!session.ptySpawned) {
            this.spawnPty(session, cols, rows)
          } else {
            session.ptyProcess!.resize(cols, rows)
          }
        }
      } catch {}
    })

    ws.on('close', () => {
      if (session.ws === ws) {
        session.ws = null
        // PTY stays alive; idle cleanup will kill it after IDLE_TIMEOUT_MS of no activity
      }
    })

    return true
  }

  closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    try { session.ptyProcess?.kill() } catch {}
    if (session.ws?.readyState === 1) {
      session.ws.close(1012, 'session closed')
    }
    this.sessions.delete(sessionId)
    return true
  }

  listSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
    }))
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    for (const [id] of this.sessions) {
      this.closeSession(id)
    }
  }
}
