'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Plug,
  RefreshCw,
} from 'lucide-react'

interface ComponentStatus {
  id: 'docker' | 'ollama' | 'bge-m3' | 'qdrant' | 'uv' | 'mcp'
  label: string
  ready: boolean
  detail?: string
  error?: string
}

interface ProgressEvent {
  stage: 'check' | 'install' | 'log' | 'error' | 'done'
  step?: ComponentStatus['id']
  message: string
  ready?: boolean
}

export function MemoryInstallWizard() {
  const t = useTranslations('customerService.memory.wizard')
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery<{ components: ComponentStatus[] }>({
    queryKey: ['cs-mem0-setup'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/memory/setup')
      if (!res.ok) throw new Error('detect failed')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const [installing, setInstalling] = useState(false)
  const [logs, setLogs] = useState<ProgressEvent[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  async function startInstall() {
    setInstalling(true)
    setLogs([{ stage: 'log', message: t('starting') }])
    try {
      const res = await fetch('/api/customer-service/memory/setup', { method: 'POST' })
      if (!res.body) throw new Error('no stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const ev = JSON.parse(line.slice(6)) as ProgressEvent
              setLogs((prev) => [...prev, ev])
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, { stage: 'error', message: err?.message ?? String(err) }])
    } finally {
      setInstalling(false)
      queryClient.invalidateQueries({ queryKey: ['cs-mem0-setup'] })
      queryClient.invalidateQueries({ queryKey: ['cs-mem0-provider'] })
    }
  }

  if (isLoading || !data) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/40 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('loading')}
      </div>
    )
  }

  const total = data.components.length
  const ready = data.components.filter((c) => c.ready).length
  const allReady = ready === total

  return (
    <div className="space-y-4">
      <div className="cyber-card p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
          <span className={`text-xs px-2 py-0.5 rounded border ${allReady ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
            {ready} / {total} {t('ready')}
          </span>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('description')}</p>

        <div className="mt-4 space-y-2">
          {data.components.map((c) => (
            <div
              key={c.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                c.ready
                  ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
                  : c.error
                    ? 'border-red-500/30 bg-red-500/[0.05]'
                    : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {c.ready ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : c.error ? (
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                ) : (
                  <Circle className="w-4 h-4 text-white/30" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-white/90">{c.label}</div>
                <div className={`text-xs mt-0.5 ${c.error ? 'text-red-300' : 'text-white/50'}`}>
                  {c.error ?? c.detail}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={startInstall}
            disabled={installing || allReady}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
              disabled:opacity-50 transition-colors"
          >
            {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            {allReady ? t('actions.allInstalled') : installing ? t('actions.installing') : t('actions.install')}
          </button>
          <button
            onClick={() => refetch()}
            disabled={installing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.08]
              disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('actions.refresh')}
          </button>
        </div>

        <p className="text-[11px] text-white/40 mt-2 leading-relaxed">{t('sudoNote')}</p>
      </div>

      {logs.length > 0 && (
        <div className="cyber-card p-4">
          <div className="text-xs text-white/50 uppercase tracking-wider mb-2">{t('logs')}</div>
          <div ref={logRef} className="max-h-72 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed font-mono text-white/70 space-y-1">
            {logs.map((ev, i) => (
              <div key={i} className={`whitespace-pre-wrap ${ev.stage === 'error' ? 'text-red-300' : ev.stage === 'done' ? 'text-emerald-300' : ev.ready ? 'text-emerald-300' : ''}`}>
                <span className="text-white/30 mr-2">[{ev.stage}{ev.step ? `:${ev.step}` : ''}]</span>
                {ev.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
