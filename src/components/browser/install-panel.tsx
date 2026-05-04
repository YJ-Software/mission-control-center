'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, CheckCircle2, ChevronDown, FileDown, ArrowRight, Play } from 'lucide-react'

interface InstallEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  data: string
}

interface InstallPanelProps {
  onInstallCompleteAction: () => void | Promise<void>
}

export function InstallPanel({ onInstallCompleteAction }: InstallPanelProps) {
  const t = useTranslations('browser.install')

  const [isInstalling, setIsInstalling] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [installDone, setInstallDone] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
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
    a.download = `browser-install-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  async function startInstall() {
    setIsInstalling(true)
    setLogs([])
    setProgress('')
    setInstallDone(false)
    setLogExpanded(true)

    try {
      const res = await fetch('/api/browser/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'chrome' }),
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
              setProgress(t('complete'))
            } else if (event.type === 'error') {
              setLogs(prev => [...prev, `ERROR: ${event.data}`])
              setProgress('Error')
              throw new Error(event.data)
            }
          } catch (e) {
            if (e instanceof Error && e.message !== '') throw e
          }
        }
      }

      // Auto-navigate to dashboard after a brief delay
      setTimeout(() => onInstallCompleteAction(), 2000)
    } catch {
      // Error already logged via SSE
    } finally {
      setIsInstalling(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="px-1">
        <h2 className="text-base font-medium text-white">{t('pageTitle')}</h2>
        <p className="text-xs text-white/40 mt-0.5">{t('pageSubtitle')}</p>
      </div>

      {/* Chrome + Headless */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-white">{t('chromeLabel')}</span>
            <p className="text-xs text-white/40 mt-0.5">{t('chromeDesc')}</p>
          </div>
        </div>
      </div>

      {/* Start Install Button */}
      <button
        onClick={startInstall}
        disabled={isInstalling || installDone}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
          bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
      >
        {isInstalling ? (
          <><Loader2 className="w-4 h-4 animate-spin" />{t('installing')}</>
        ) : (
          <><Play className="w-4 h-4" />{t('startInstall')}</>
        )}
      </button>

      {/* Install Complete Banner */}
      {installDone && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            <span className="text-sm font-medium text-green-400">{t('complete')}</span>
          </div>
          <button
            onClick={onInstallCompleteAction}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30"
          >
            {t('goToDashboard')}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Install Log */}
      {(logs.length > 0 || progress) && (
        <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setLogExpanded(!logExpanded)}
              className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/60 transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${logExpanded ? '' : '-rotate-90'}`} />
              {t('log')} ({logs.length})
            </button>
            <div className="flex items-center gap-2">
              {!installDone && progress && (
                <span className="text-xs font-mono text-cyan-400">{progress}</span>
              )}
              {logs.length > 0 && (
                <button
                  onClick={downloadLog}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  title={t('downloadLog')}
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
