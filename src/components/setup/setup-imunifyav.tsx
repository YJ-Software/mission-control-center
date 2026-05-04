'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Shield, Loader2, CheckCircle2, XCircle,
  ExternalLink, Download, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react'

interface ImunifyAVStatus {
  installed: boolean
  version?: string
  serviceActive?: boolean
  confExists?: boolean
}

export function SetupImunifyAV() {
  const t = useTranslations('setup.imunifyav')
  const queryClient = useQueryClient()

  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)

  const { data: status, isLoading } = useQuery<ImunifyAVStatus>({
    queryKey: ['setup-imunifyav'],
    queryFn: async () => {
      const res = await fetch('/api/setup/imunifyav')
      if (!res.ok) throw new Error('Failed to fetch status')
      return res.json()
    },
  })

  const [progress, setProgress] = useState('')

  async function handleAction(action: string) {
    if (running) return
    setRunning(true)
    setMessage(null)
    setConfirmPurge(false)
    setLogs([])
    setProgress('')
    setShowLogs(true)
    try {
      const res = await fetch('/api/setup/imunifyav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()

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
            const event = JSON.parse(line.slice(6)) as {
              type: 'log' | 'progress' | 'done' | 'error'
              data: string
            }
            if (event.type === 'log') {
              setLogs(prev => [...prev, event.data])
            } else if (event.type === 'progress') {
              setProgress(event.data)
            } else if (event.type === 'done') {
              const successKey = action === 'install' ? 'installSuccess'
                : action === 'purge' ? 'purgeSuccess' : 'uninstallSuccess'
              setMessage({ type: 'success', text: t(successKey) })
            } else if (event.type === 'error') {
              setMessage({ type: 'error', text: event.data })
            }
          } catch { /* skip malformed lines */ }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['setup-imunifyav'] })
    } catch {
      setMessage({ type: 'error', text: t('installError') })
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/50 text-sm p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Description */}
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-white/80 leading-relaxed">{t('description')}</p>
            <a
              href="https://docs.imunify360.com/imunifyav/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              docs.imunify360.com
            </a>
          </div>
        </div>
      </div>

      {/* Status */}
      {status && (
        <div className="cyber-card p-4">
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
            {t('currentStatus')}
          </h3>
          {!status.installed ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <XCircle className="w-4 h-4 text-white/30" />
              {t('notInstalled')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatusBadge
                label={t('statusLabel')}
                ok={!!status.serviceActive}
                value={status.serviceActive ? t('running') : t('stopped')}
              />
              <StatusBadge
                label={t('versionLabel')}
                ok={true}
                value={status.version || '-'}
              />
              <StatusBadge
                label={t('configLabel')}
                ok={!!status.confExists}
                value={status.confExists ? t('configured') : t('notConfigured')}
              />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-3">
          {!status?.installed ? (
            <button
              onClick={() => handleAction('install')}
              disabled={running}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30
                transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {running ? t('installing') : t('install')}
            </button>
          ) : (
            <div className="flex flex-col gap-3 w-full">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleAction('uninstall')}
                  disabled={running}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                    bg-white/[0.06] text-white/60 hover:bg-red-500/20 hover:text-red-300
                    border border-white/[0.1] hover:border-red-500/30
                    transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {running ? t('uninstalling') : t('uninstall')}
                </button>
                {!confirmPurge ? (
                  <button
                    onClick={() => setConfirmPurge(true)}
                    disabled={running}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                      bg-white/[0.06] text-white/40 hover:bg-red-500/20 hover:text-red-300
                      border border-white/[0.1] hover:border-red-500/30
                      transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('purge')}
                  </button>
                ) : (
                  <button
                    onClick={() => { setConfirmPurge(false); handleAction('purge') }}
                    disabled={running}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                      bg-red-500/20 text-red-300 border border-red-500/40
                      animate-pulse transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('purgeConfirm')}
                  </button>
                )}
              </div>
              <div className="text-xs text-white/30 space-y-1">
                <p>• {t('uninstallDesc')}</p>
                <p>• {t('purgeDesc')}</p>
              </div>
            </div>
          )}
        </div>

        {message && (
          <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border mt-4 ${
            message.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        {/* Progress */}
        {running && progress && (
          <div className="flex items-center gap-2 mt-4 text-xs text-cyan-400/80">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {progress}
          </div>
        )}

        {/* Logs */}
        {(logs.length > 0 || showLogs) && (
          <div className="mt-4">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-2"
            >
              {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {t('installLogs')}
            </button>
            {showLogs && (
              <pre
                ref={el => { if (el) el.scrollTop = el.scrollHeight }}
                className="font-mono text-xs text-white/60 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto"
              >
                {logs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ label, ok, value }: {
  label: string
  ok: boolean
  value: string
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
      <span className="text-[11px] text-white/40 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400/60" />
        )}
        <span className={`text-xs font-mono ${ok ? 'text-white/70' : 'text-white/30'}`}>
          {value}
        </span>
      </div>
    </div>
  )
}
