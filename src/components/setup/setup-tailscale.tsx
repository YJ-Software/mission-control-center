'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Network, Loader2, CheckCircle2, XCircle,
  ExternalLink, Power, PowerOff, Copy, Check,
} from 'lucide-react'

interface TailscaleStatus {
  installed: boolean
  version?: string
  connected?: boolean
  backendState?: string
  hostname?: string
  dnsName?: string
  tailscaleIp?: string
  os?: string
  online?: boolean
}

export function SetupTailscale() {
  const t = useTranslations('setup.tailscale')
  const queryClient = useQueryClient()

  const [running, setRunning] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: status, isLoading } = useQuery<TailscaleStatus>({
    queryKey: ['setup-tailscale'],
    queryFn: async () => {
      const res = await fetch('/api/setup/tailscale')
      if (!res.ok) throw new Error('Failed to fetch status')
      return res.json()
    },
    refetchInterval: authUrl ? 5000 : false, // Poll when waiting for auth
  })

  async function handleAction(action: string) {
    setRunning(true)
    setMessage(null)
    setAuthUrl(null)
    setOutput('')
    try {
      const res = await fetch('/api/setup/tailscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (data.authUrl) {
        setAuthUrl(data.authUrl)
      }
      if (data.output) setOutput(data.output)
      if (data.ok && !data.authUrl) {
        setMessage({ type: 'success', text: t('actionSuccess') })
      } else if (!data.ok) {
        setMessage({ type: 'error', text: data.output || t('actionError') })
      }
      queryClient.invalidateQueries({ queryKey: ['setup-tailscale'] })
    } catch {
      setMessage({ type: 'error', text: t('actionError') })
    } finally {
      setRunning(false)
    }
  }

  // Auto-clear authUrl when connected
  useEffect(() => {
    if (authUrl && status?.connected) {
      setAuthUrl(null)
      setMessage({ type: 'success', text: t('authSuccess') })
    }
  }, [authUrl, status?.connected, t])

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
          <Network className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-white/80 leading-relaxed">{t('description')}</p>
            <a
              href="https://tailscale.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              tailscale.com
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
            <div className="flex items-center gap-2 text-sm text-red-400/80">
              <XCircle className="w-4 h-4" />
              {t('notInstalled')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatusBadge
                  label={t('statusLabel')}
                  ok={!!status.connected}
                  value={status.connected ? t('connected') : (status.backendState || t('disconnected'))}
                />
                <StatusBadge
                  label={t('ipLabel')}
                  ok={!!status.tailscaleIp}
                  value={status.tailscaleIp || '-'}
                />
                <StatusBadge
                  label={t('versionLabel')}
                  ok={true}
                  value={status.version || '-'}
                />
              </div>
              {status.connected && status.dnsName && (
                <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                  <span className="text-[11px] text-white/40 uppercase tracking-wider">{t('dnsLabel')}</span>
                  <div className="text-xs font-mono text-white/70 mt-1">{status.dnsName}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Auth URL */}
      {authUrl && (
        <div className="cyber-card p-5 border-cyan-500/30">
          <h3 className="text-sm font-medium text-cyan-400 mb-3">{t('authRequired')}</h3>
          <p className="text-xs text-white/60 mb-3">{t('authInstructions')}</p>
          <div className="flex items-center gap-2">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-mono text-cyan-300 hover:bg-cyan-500/20 transition-colors truncate"
            >
              {authUrl}
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(authUrl)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/40 hover:text-white/70 transition-colors shrink-0"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-white/30 mt-2">{t('authWaiting')}</p>
        </div>
      )}

      {/* Actions */}
      {status?.installed && (
        <div className="cyber-card p-5">
          <div className="flex items-center gap-3">
            {!status.connected ? (
              <button
                onClick={() => handleAction('up')}
                disabled={running}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium
                  bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30
                  transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                {running ? t('connecting') : t('connect')}
              </button>
            ) : (
              <button
                onClick={() => handleAction('down')}
                disabled={running}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  bg-white/[0.06] text-white/60 hover:bg-white/[0.1] border border-white/[0.1]
                  transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                {t('disconnect')}
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

          {output && !authUrl && (
            <div className="mt-4">
              <pre className="font-mono text-xs text-white/60 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Install instructions */}
      {status && !status.installed && (
        <div className="cyber-card p-5">
          <h3 className="text-sm font-medium text-white/80 mb-3">{t('installTitle')}</h3>
          <pre className="font-mono text-xs text-cyan-300/80 bg-black/40 rounded-lg p-3">
            curl -fsSL https://tailscale.com/install.sh | sh
          </pre>
        </div>
      )}
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
