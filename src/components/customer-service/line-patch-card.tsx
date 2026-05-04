'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wrench,
  Webhook,
  XCircle,
} from 'lucide-react'

interface LinePatchStatus {
  scriptInstalled: boolean
  scriptPath: string
  distPatched: boolean
  distPath: string | null
  dropinInstalled: boolean
  dropinPath: string
}

export function LinePatchCard() {
  const t = useTranslations('customerService.linePatch')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<LinePatchStatus>({
    queryKey: ['cs-line-patch'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/line-patch')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 60000,
  })

  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function repair() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/customer-service/line-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-and-install-dropin' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'failed')
      setMessage({ type: 'success', text: t('messages.repaired') })
      if (typeof json.output === 'string') setOutput(json.output)
      qc.invalidateQueries({ queryKey: ['cs-line-patch'] })
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message ?? t('messages.failed') })
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !data) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
      </div>
    )
  }

  const allOk = data.distPatched && data.dropinInstalled

  return (
    <div className={`cyber-card p-5 ${allOk ? '' : 'border border-amber-500/30 bg-amber-500/[0.03]'}`}>
      <div className="flex items-center gap-2 mb-1">
        <Webhook className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
        {allOk ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" /> {t('statusOk')}
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" /> {t('statusActionNeeded')}
          </span>
        )}
      </div>
      <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

      <div className="space-y-2">
        <Row
          label={t('rows.distPatched')}
          ok={data.distPatched}
          okText={t('rows.distPatchedOk')}
          badText={t('rows.distPatchedBad')}
          path={data.distPath ?? undefined}
        />
        <Row
          label={t('rows.dropinInstalled')}
          ok={data.dropinInstalled}
          okText={t('rows.dropinInstalledOk')}
          badText={t('rows.dropinInstalledBad')}
          path={data.dropinPath}
        />
      </div>

      {!allOk && (
        <div className="mt-4">
          <button
            onClick={repair}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30
              disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            {t('actions.repair')}
          </button>
        </div>
      )}

      {message && (
        <div
          className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
            message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}
      {output && (
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}

function Row({
  label,
  ok,
  okText,
  badText,
  path,
}: {
  label: string
  ok: boolean
  okText: string
  badText: string
  path?: string
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        <div className="flex-1">
          <div className="text-sm text-white/85">{label}</div>
          <div className={`text-xs mt-0.5 ${ok ? 'text-emerald-300/70' : 'text-amber-300/80'}`}>{ok ? okText : badText}</div>
          {path && <div className="text-[10.5px] text-white/30 font-mono mt-1 break-all">{path}</div>}
        </div>
      </div>
    </div>
  )
}
