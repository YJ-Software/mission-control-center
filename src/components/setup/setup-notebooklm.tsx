'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Download, Loader2, CheckCircle2, XCircle,
  Podcast, RefreshCw, ExternalLink,
} from 'lucide-react'

interface NlmStatus {
  uv: { installed: boolean; path: string; version: string }
  nlm: { installed: boolean; path: string; version: string }
  patch: { cdpPath: string | null; applied: boolean; notNeeded?: boolean }
}

export function SetupNotebookLM() {
  const t = useTranslations('setup.notebooklm')
  const queryClient = useQueryClient()

  const [installing, setInstalling] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: status, isLoading } = useQuery<NlmStatus>({
    queryKey: ['setup-notebooklm'],
    queryFn: async () => {
      const res = await fetch('/api/setup/notebooklm')
      if (!res.ok) throw new Error('Failed to fetch status')
      return res.json()
    },
  })

  async function handleInstall() {
    setInstalling(true)
    setMessage(null)
    setLogs([])
    try {
      const res = await fetch('/api/setup/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install' }),
      })
      const data = await res.json()
      setLogs(data.logs || [])
      if (data.ok) {
        setMessage({ type: 'success', text: t('installSuccess') })
      } else {
        setMessage({ type: 'error', text: t('installError') })
      }
      queryClient.invalidateQueries({ queryKey: ['setup-notebooklm'] })
    } catch {
      setMessage({ type: 'error', text: t('installError') })
    } finally {
      setInstalling(false)
    }
  }

  async function handleRepatch() {
    setInstalling(true)
    setMessage(null)
    try {
      const res = await fetch('/api/setup/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'patch' }),
      })
      const data = await res.json()
      setLogs(data.logs || [])
      if (data.ok) {
        setMessage({ type: 'success', text: t('installSuccess') })
      } else {
        setMessage({ type: 'error', text: t('installError') })
      }
      queryClient.invalidateQueries({ queryKey: ['setup-notebooklm'] })
    } catch {
      setMessage({ type: 'error', text: t('installError') })
    } finally {
      setInstalling(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/50 text-sm p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }

  const patchOk = !!(status?.patch.applied || status?.patch.notNeeded)
  const allInstalled = status?.uv.installed && status?.nlm.installed && patchOk

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Description */}
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Podcast className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-white/80 leading-relaxed">{t('description')}</p>
            <p className="text-sm text-white/50 leading-relaxed">{t('uvInfo')}</p>
            <a
              href="https://github.com/jacob-bd/notebooklm-mcp-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              notebooklm-mcp-cli
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatusBadge
              label={t('uvLabel')}
              ok={status.uv.installed}
              value={status.uv.installed ? (status.uv.version || t('installed')) : t('notInstalled')}
            />
            <StatusBadge
              label={t('nlmLabel')}
              ok={status.nlm.installed}
              value={status.nlm.installed ? (status.nlm.version || t('installed')) : t('notInstalled')}
            />
            <StatusBadge
              label={t('patchLabel')}
              ok={status.patch.applied || !!status.patch.notNeeded}
              value={
                status.patch.applied
                  ? t('applied')
                  : status.patch.notNeeded
                    ? t('notNeeded')
                    : t('notApplied')
              }
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="cyber-card p-5">
        <div className="flex items-center gap-3">
          {!allInstalled ? (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30
                transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {installing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {installing ? t('installing') : t('install')}
            </button>
          ) : (
            <button
              onClick={handleRepatch}
              disabled={installing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-white/[0.06] text-white/60 hover:bg-white/[0.1] border border-white/[0.1]
                transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {installing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {t('repatch')}
            </button>
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

        {logs.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs text-white/40 mb-2">{t('installLogs')}</h4>
            <pre className="font-mono text-xs text-white/60 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {logs.join('\n')}
            </pre>
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
