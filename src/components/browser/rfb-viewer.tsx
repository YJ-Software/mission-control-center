'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type RFB from '@/lib/novnc/rfb.js'

export default function RfbViewer() {
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [status, setStatus] = useState<'loading' | 'connecting' | 'connected' | 'disconnected'>('loading')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Read params from URL (avoid useSearchParams which needs Suspense)
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const host = params?.get('host') || (typeof window !== 'undefined' ? window.location.hostname : 'localhost')
  const port = params?.get('port') || '6082'
  const password = params?.get('password') || ''

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2000)
  }, [])

  // Clipboard sync: host → VNC
  const syncClipboardToVnc = useCallback(async () => {
    if (!rfbRef.current) return
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        rfbRef.current.clipboardPasteFrom(text)
      }
    } catch {
      // Permission denied or empty
    }
  }, [])

  useEffect(() => {
    if (!screenRef.current) return

    let rfb: any = null

    async function connect() {
      // Dynamic import to avoid SSR issues
      const { default: RFB } = await import('@/lib/novnc/rfb.js')

      const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${wsScheme}://${host}:${port}/websockify`

      setStatus('connecting')

      rfb = new RFB(screenRef.current!, wsUrl, {
        credentials: { password },
      })

      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.clipViewport = true

      rfb.addEventListener('connect', () => {
        setStatus('connected')
      })

      rfb.addEventListener('disconnect', () => {
        setStatus('disconnected')
      })

      rfb.addEventListener('credentialsrequired', () => {
        setStatus('disconnected')
      })

      // Clipboard sync: VNC → host
      rfb.addEventListener('clipboard', async (e: any) => {
        const text = e.detail?.text
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          showToast('Clipboard synced from VNC')
        } catch {
          // Clipboard write failed
        }
      })

      rfbRef.current = rfb
    }

    connect().catch(() => setStatus('disconnected'))

    return () => {
      if (rfb) {
        try { rfb.disconnect() } catch {}
      }
      rfbRef.current = null
    }
  }, [host, port, password, showToast])

  // Sync clipboard on focus and Ctrl+V
  useEffect(() => {
    const onFocus = () => syncClipboardToVnc()
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        syncClipboardToVnc()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [syncClipboardToVnc])

  // Initial clipboard sync after connected
  useEffect(() => {
    if (status === 'connected') {
      const timer = setTimeout(syncClipboardToVnc, 500)
      return () => clearTimeout(timer)
    }
  }, [status, syncClipboardToVnc])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', position: 'relative', overflow: 'hidden' }}>
      {/* Status bar */}
      <div style={{
        position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
        font: '12px/1 monospace', color: '#888', background: 'rgba(0,0,0,0.7)',
        padding: '4px 12px', borderRadius: 4, zIndex: 10,
        opacity: status === 'connected' ? 0 : 1,
        transition: 'opacity 0.5s',
        pointerEvents: 'none',
      }}>
        {status === 'loading' && 'Loading...'}
        {status === 'connecting' && 'Connecting...'}
        {status === 'connected' && 'Connected'}
        {status === 'disconnected' && 'Disconnected — reload to retry'}
      </div>

      {/* Clipboard toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 12, right: 12,
          font: '11px/1 monospace', color: '#4ade80', background: 'rgba(0,0,0,0.8)',
          padding: '6px 12px', borderRadius: 4, zIndex: 10,
        }}>
          {toast}
        </div>
      )}

      {/* VNC screen */}
      <div ref={screenRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
