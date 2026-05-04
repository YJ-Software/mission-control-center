'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Download, Loader2, CheckCircle2, ChevronDown, FileDown } from 'lucide-react'

interface DetectedComponents {
  obsidian: boolean
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
  couchdb: boolean
}

interface InstallEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  data: string
}

interface MissingDepsCardProps {
  detected: DetectedComponents
  onInstallComplete: () => void
}

export function MissingDepsCard({ detected, onInstallComplete }: MissingDepsCardProps) {
  const t = useTranslations('secondBrain.obsidian.missingDeps')
  const [isInstalling, setIsInstalling] = useState(false)
  const [installDone, setInstallDone] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current && logExpanded) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, logExpanded])

  const downloadLog = useCallback(() => {
    const content = logs.join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `headless-deps-install-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  const missing = [
    !detected.xvfb && 'Xvfb',
    !detected.openbox && 'Openbox',
    !detected.x11vnc && 'x11vnc',
    !detected.websockify && 'websockify',
  ].filter(Boolean) as string[]

  async function startInstall() {
    setIsInstalling(true)
    setLogs([])
    setProgress('')
    setInstallDone(false)
    setLogExpanded(true)

    try {
      const res = await fetch('/api/second-brain/obsidian/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'headless-deps' }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response stream')

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event: InstallEvent = JSON.parse(line.slice(6))
            if (event.type === 'log') {
              setLogs(prev => [...prev, event.data])
            } else if (event.type === 'progress') {
              setProgress(event.data)
            } else if (event.type === 'done') {
              setInstallDone(true)
              setLogExpanded(false)
            } else if (event.type === 'error') {
              setLogs(prev => [...prev, `ERROR: ${event.data}`])
              setProgress('Error')
            }
          } catch {
            // skip malformed SSE
          }
        }
      }

      onInstallComplete()
    } catch {
      // Error already logged
    } finally {
      setIsInstalling(false)
    }
  }

  if (installDone) {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        <span className="text-sm text-green-400">{t('installComplete')}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">{t('title')}</p>
            <p className="text-xs text-white/40 mt-1">
              {t('description', { missing: missing.join(', ') })}
            </p>
          </div>
        </div>
        <button
          onClick={startInstall}
          disabled={isInstalling}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
        >
          {isInstalling ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('installing')}</>
          ) : (
            <><Download className="w-3.5 h-3.5" />{t('installButton')}</>
          )}
        </button>
      </div>

      {/* Install Log */}
      {(logs.length > 0 || progress) && (
        <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setLogExpanded(!logExpanded)}
              className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/60 transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${logExpanded ? '' : '-rotate-90'}`} />
              {t('log')} ({logs.length})
            </button>
            <div className="flex items-center gap-2">
              {progress && (
                <span className="text-xs font-mono text-amber-400">{progress}</span>
              )}
              {logs.length > 0 && (
                <button
                  onClick={downloadLog}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                >
                  <FileDown className="w-3 h-3" />
                  {t('downloadLog')}
                </button>
              )}
            </div>
          </div>
          {logExpanded && (
            <div ref={logRef} className="max-h-48 overflow-y-auto font-mono text-[11px] text-white/50 space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className="leading-relaxed">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
