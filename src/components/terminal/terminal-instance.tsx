'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface TerminalInstanceProps {
  sessionId: string
  visible: boolean
}

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_INTERVAL_MS = 2000

export function TerminalInstance({ sessionId, visible }: TerminalInstanceProps) {
  const t = useTranslations('terminal')
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return

    disposedRef.current = false

    function connectWs() {
      if (disposedRef.current) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws/terminal?sessionId=${sessionId}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (wsRef.current !== ws) return // Stale connection (React strict mode)
        reconnectCountRef.current = 0
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          // Always send resize — this triggers PTY spawn on first connect
          // and fit() may not fire onResize if dimensions were already set
          const { cols, rows } = terminalRef.current
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      }

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return // Stale connection
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'output') {
            terminalRef.current?.write(msg.data)
          } else if (msg.type === 'reconnected' && msg.bufferedOutput) {
            terminalRef.current?.write(msg.bufferedOutput)
          } else if (msg.type === 'exit') {
            terminalRef.current?.write(`\r\n\x1b[90m[${t('sessionEnded')} (code: ${msg.code})]\x1b[0m\r\n`)
          }
        } catch {}
      }

      ws.onclose = () => {
        if (wsRef.current !== ws) return // Stale connection — don't interfere
        wsRef.current = null
        // Auto-reconnect (up to 3 times, 2-second interval)
        if (!disposedRef.current && reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectCountRef.current++
          terminalRef.current?.write(`\r\n\x1b[33m[${t('reconnecting')}]\x1b[0m\r\n`)
          reconnectTimerRef.current = setTimeout(connectWs, RECONNECT_INTERVAL_MS)
        } else if (!disposedRef.current) {
          terminalRef.current?.write(`\r\n\x1b[31m[${t('disconnected')}]\x1b[0m\r\n`)
        }
      }
    }

    async function init() {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      const { WebLinksAddon } = await import('@xterm/addon-web-links')
      // @ts-expect-error -- CSS import handled by Next.js bundler at runtime
      await import('@xterm/xterm/css/xterm.css')

      if (disposedRef.current) return

      const fitAddon = new FitAddon()
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, monospace',
        theme: {
          background: '#0a0a14',
          foreground: '#e0e0e0',
          cursor: '#00c8ff',
          cursorAccent: '#0a0a14',
          selectionBackground: 'rgba(0,200,255,0.2)',
          black: '#1a1a2e',
          red: '#ff6b6b',
          green: '#51cf66',
          yellow: '#ffd43b',
          blue: '#339af0',
          magenta: '#9d7aff',
          cyan: '#00c8ff',
          white: '#e0e0e0',
          brightBlack: '#4a4a6a',
          brightRed: '#ff8787',
          brightGreen: '#69db7c',
          brightYellow: '#ffe066',
          brightBlue: '#5c9fff',
          brightMagenta: '#b197ff',
          brightCyan: '#3bd5ff',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      })

      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())

      terminalRef.current = term
      fitAddonRef.current = fitAddon

      // Clean up any leftover xterm DOM from React strict mode remount
      const container = containerRef.current!
      while (container.firstChild) {
        container.removeChild(container.firstChild)
      }
      term.open(container)

      if (visible) {
        fitAddon.fit()
      }

      // Send input to WebSocket
      term.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data }))
        }
      })

      // Send resize to WebSocket
      term.onResize(({ cols, rows }) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })

      connectWs()
    }

    init()

    return () => {
      disposedRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
      terminalRef.current?.dispose()
      // xterm.dispose() doesn't remove its DOM element — clean up manually
      // to prevent duplicate xterm instances on React strict mode remount
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild)
        }
      }
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle visibility changes — refit when becoming visible
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      // Small delay to let the DOM settle
      const timer = setTimeout(() => fitAddonRef.current?.fit(), 50)
      return () => clearTimeout(timer)
    }
  }, [visible])

  // Handle container resize (debounced)
  useEffect(() => {
    if (!containerRef.current || !visible) return

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        if (fitAddonRef.current && visible) {
          fitAddonRef.current.fit()
        }
      }, 100) // 100ms debounce
    })

    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [visible])

  return (
    <div
      className="w-full h-full"
      style={{
        display: visible ? 'flex' : 'none',
        padding: '8px 4px 4px 8px',
      }}
    >
      <div ref={containerRef} className="flex-1 min-w-0 min-h-0" />
    </div>
  )
}
