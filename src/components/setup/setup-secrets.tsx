'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { KeyRound, ShieldCheck, ShieldAlert, Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface SecretsStatus {
  plaintextCount: number
  fields: string[]
  hardened: boolean
  bundlePath: string
  provider: string
}

interface HardenResult {
  moved: number
  fields?: string[]
  bundlePath?: string
  backup?: string
  restarted?: boolean
  restartError?: string
  message?: string
  error?: string
}

export function SetupSecrets() {
  const t = useTranslations('setup.secrets')
  const queryClient = useQueryClient()

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<HardenResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: status, isLoading } = useQuery<SecretsStatus>({
    queryKey: ['setup-secrets'],
    queryFn: async () => {
      const res = await fetch('/api/setup/secrets')
      if (!res.ok) throw new Error('Failed to read secrets status')
      return res.json()
    },
  })

  async function handleHarden() {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/setup/secrets', { method: 'POST' })
      const body: HardenResult = await res.json()
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`)
      setResult(body)
      await queryClient.invalidateQueries({ queryKey: ['setup-secrets'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
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
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm text-white/80 leading-relaxed">{t('description')}</p>
            {/* Say plainly what this does and does not buy. */}
            <p className="text-sm text-white/50 leading-relaxed">{t('scopeNote')}</p>
          </div>
        </div>
      </div>

      <div className="cyber-card p-4">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          {t('currentStatus')}
        </h3>
        {status?.hardened ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            {t('hardened')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {t('plaintextFound', { count: status?.plaintextCount ?? 0 })}
            </div>
            <ul className="ml-6 space-y-1">
              {(status?.fields ?? []).map((f) => (
                <li key={f} className="text-xs font-mono text-white/50 break-all">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!status?.hardened && (
        <div className="cyber-card p-5">
          <h3 className="text-sm font-semibold text-white/90 mb-2">{t('actionTitle')}</h3>
          <p className="text-sm text-white/50 mb-2">{t('actionDesc')}</p>
          {/* The gateway restarts as part of this, and every credential is
              rewritten in one pass — say so before they click. */}
          <p className="text-sm text-amber-400/80 mb-4">{t('restartWarning')}</p>
          <button
            onClick={handleHarden}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20
              transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {running ? t('running') : t('run')}
          </button>
        </div>
      )}

      {result && (
        <div className="cyber-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {result.moved > 0 ? t('movedCount', { count: result.moved }) : t('alreadyHardened')}
          </div>
          {result.bundlePath && (
            <p className="text-xs text-white/40 font-mono break-all">
              {t('bundleAt')} {result.bundlePath}
            </p>
          )}
          {result.backup && (
            <p className="text-xs text-white/40 font-mono break-all">
              {t('backupAt')} {result.backup}
            </p>
          )}
          {result.restarted === false && result.restartError && (
            <p className="text-xs text-amber-400 break-all">
              {t('restartFailed')} {result.restartError}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="cyber-card p-4">
          <div className="flex items-start gap-2 text-sm text-red-400">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        </div>
      )}
    </div>
  )
}
