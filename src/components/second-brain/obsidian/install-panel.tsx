'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, CheckCircle2, ChevronDown, FileDown, ArrowRight, Play } from 'lucide-react'

interface InstallEvent {
  type: 'log' | 'progress' | 'done' | 'error'
  data: string
}

interface InstallPanelProps {
  onInstallCompleteAction: () => void
  config?: { installed: string; couchdb_installed: string; [key: string]: string }
}

export function InstallPanel({ onInstallCompleteAction, config }: InstallPanelProps) {
  const t = useTranslations('secondBrain.obsidian.install')

  const [obsidianInstalled, setObsidianInstalled] = useState(config?.installed === 'true')
  const [couchdbInstalled, setCouchdbInstalled] = useState(config?.couchdb_installed === 'true')
  const [installObsidian, setInstallObsidian] = useState(config?.installed !== 'true')
  const [installCouchdb, setInstallCouchdb] = useState(config?.couchdb_installed !== 'true')
  const [couchdbMethod, setCouchdbMethod] = useState<'docker' | 'apt'>('docker')

  const [isInstalling, setIsInstalling] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [installDone, setInstallDone] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (config?.installed === 'true') setObsidianInstalled(true)
    if (config?.couchdb_installed === 'true') setCouchdbInstalled(true)
  }, [config?.installed, config?.couchdb_installed])

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
    a.download = `obsidian-install-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  async function consumeSSE(
    target: 'obsidian' | 'couchdb',
    onInstalled: () => void,
  ) {
    const res = await fetch('/api/second-brain/obsidian/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target,
        ...(target === 'couchdb' ? { method: couchdbMethod } : {}),
      }),
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
        let event: InstallEvent
        try {
          event = JSON.parse(line.slice(6))
        } catch {
          continue
        }
        if (event.type === 'log') {
          setLogs(prev => [...prev, event.data])
        } else if (event.type === 'progress') {
          setProgress(event.data)
        } else if (event.type === 'done') {
          onInstalled()
        } else if (event.type === 'error') {
          setLogs(prev => [...prev, `ERROR: ${event.data}`])
          setProgress('Error')
          throw new Error(event.data)
        }
      }
    }
  }

  async function startInstall() {
    setIsInstalling(true)
    setLogs([])
    setProgress('')
    setInstallDone(false)
    setLogExpanded(true)

    try {
      if (installObsidian && !obsidianInstalled) {
        await consumeSSE('obsidian', () => setObsidianInstalled(true))
      }

      if (installCouchdb && !couchdbInstalled) {
        // Insert separator if obsidian was also installed
        if (installObsidian && !obsidianInstalled) {
          setLogs(prev => [...prev, '', `── ${t('separator')} ──`, ''])
        }
        await consumeSSE('couchdb', () => setCouchdbInstalled(true))
      }

      setInstallDone(true)
      setLogExpanded(false)
      setProgress(t('complete'))

      // Auto-navigate to dashboard after a brief delay
      setTimeout(() => onInstallCompleteAction(), 2000)
    } catch {
      // Error already logged via SSE
    } finally {
      setIsInstalling(false)
    }
  }

  const canStart = !isInstalling
    && ((installObsidian && !obsidianInstalled) || (installCouchdb && !couchdbInstalled))
  const allDone = obsidianInstalled && couchdbInstalled

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="px-1">
        <h2 className="text-base font-medium text-white">{t('pageTitle')}</h2>
        <p className="text-xs text-white/40 mt-0.5">{t('pageSubtitle')}</p>
      </div>

      {/* Component Checkboxes */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
        {/* Obsidian */}
        <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
          obsidianInstalled
            ? 'border-green-500/20 bg-green-500/5'
            : installObsidian
              ? 'border-cyan-500/30 bg-cyan-500/5'
              : 'border-white/[0.06] hover:border-white/[0.12]'
        }`}>
          <input
            type="checkbox"
            checked={installObsidian || obsidianInstalled}
            disabled={obsidianInstalled || isInstalling}
            onChange={e => setInstallObsidian(e.target.checked)}
            className="mt-0.5 accent-cyan-400"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{t('obsidianLabel')}</span>
              {obsidianInstalled && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
            </div>
            <p className="text-xs text-white/40 mt-0.5">{t('obsidianDesc')}</p>
          </div>
        </label>

        {/* CouchDB */}
        <label className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
          couchdbInstalled
            ? 'border-green-500/20 bg-green-500/5'
            : installCouchdb
              ? 'border-purple-500/30 bg-purple-500/5'
              : 'border-white/[0.06] hover:border-white/[0.12]'
        }`}>
          <input
            type="checkbox"
            checked={installCouchdb || couchdbInstalled}
            disabled={couchdbInstalled || isInstalling}
            onChange={e => setInstallCouchdb(e.target.checked)}
            className="mt-0.5 accent-purple-400"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{t('couchdbLabel')}</span>
              {couchdbInstalled && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
            </div>
            <p className="text-xs text-white/40 mt-0.5">{t('couchdbDesc')}</p>
            {!couchdbInstalled && installCouchdb && (
              <div className="flex gap-4 mt-2">
                <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                  <input type="radio" name="couchdb-method" value="docker" checked={couchdbMethod === 'docker'} onChange={() => setCouchdbMethod('docker')} className="accent-purple-400" />
                  {t('methodDocker')}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer">
                  <input type="radio" name="couchdb-method" value="apt" checked={couchdbMethod === 'apt'} onChange={() => setCouchdbMethod('apt')} className="accent-purple-400" />
                  {t('methodApt')}
                </label>
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Start Install Button */}
      <button
        onClick={startInstall}
        disabled={!canStart}
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
          {allDone && (
            <button
              onClick={onInstallCompleteAction}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30"
            >
              {t('goToDashboard')}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
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
                <div key={i} className={`leading-relaxed ${line.startsWith('──') ? 'text-purple-400/70 font-medium mt-2' : ''}`}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
