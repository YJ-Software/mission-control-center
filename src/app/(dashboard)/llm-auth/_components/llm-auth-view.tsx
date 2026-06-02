'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Trash2, KeyRound, Copy, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { KNOWN_PROVIDERS, type ProviderSpec, type AuthMethod } from '@/lib/openclaw/auth-providers'
import type { ProfileSummary } from '@/lib/openclaw/auth-profiles'
import type { JobMeta } from '@/lib/jobs/types'

interface AgentSummary {
  id: string
  profiles: ProfileSummary[]
}

interface AgentsResponse {
  agents: AgentSummary[]
}

function statusClass(status: ProfileSummary['status']): string {
  switch (status) {
    case 'active':
      return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    case 'expiring':
      return 'text-amber-300 bg-amber-500/10 border-amber-500/30'
    case 'expired':
      return 'text-red-300 bg-red-500/10 border-red-500/30'
    case 'cooldown':
      return 'text-white/40 bg-white/[0.04] border-white/10'
  }
}

function formatExpiry(ts: number | undefined): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  const minutes = Math.floor((abs % 3600000) / 60000)
  const sign = diff < 0 ? '-' : ''
  if (days > 0) return `${sign}${days}d ${hours}h`
  if (hours > 0) return `${sign}${hours}h ${minutes}m`
  return `${sign}${minutes}m`
}

export function LlmAuthView() {
  const t = useTranslations('llmAuth')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<AgentsResponse>({
    queryKey: ['openclaw-auth-agents'],
    queryFn: () => fetch('/api/openclaw/auth/agents').then((r) => r.json()),
    refetchInterval: 10000,
  })

  const [loginCtx, setLoginCtx] = useState<{ agent: string; provider?: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ agent: string; profileId: string } | null>(
    null,
  )

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['openclaw-auth-agents'] })
  }, [qc])

  const agents = data?.agents ?? []
  const allAgentIds = useMemo(() => agents.map((a) => a.id), [agents])

  const removeProfile = useCallback(
    async (agentIds: string[], profileId: string) => {
      const res = await fetch('/api/openclaw/auth/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: agentIds, profileId }),
      })
      if (!res.ok) throw new Error(await res.text())
      refresh()
    },
    [refresh],
  )

  return (
    <div className="space-y-6">
      {isLoading && <div className="text-white/40 text-sm">{t('loading')}</div>}

      {agents.map((agent) => (
        <div
          key={agent.id}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium text-white">
                {t('agent')}: <span className="font-mono">{agent.id}</span>
              </div>
              <div className="text-xs text-white/40 mt-0.5">
                {t('profileCount', { count: agent.profiles.length })}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLoginCtx({ agent: agent.id })}
            >
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> {t('addLogin')}
            </Button>
          </div>

          {agent.profiles.length === 0 ? (
            <div className="text-xs text-white/30 italic py-4 text-center">{t('noProfiles')}</div>
          ) : (
            <div className="space-y-2">
              {agent.profiles.map((p) => (
                <div
                  key={p.profileId}
                  className="flex items-center gap-3 px-3 py-2 rounded border border-white/[0.06] bg-white/[0.02]"
                >
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-mono',
                      statusClass(p.status),
                    )}
                  >
                    {p.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-mono truncate">{p.profileId}</div>
                    <div className="text-xs text-white/40 truncate">
                      {p.type} · {p.identity ?? '—'} ·{' '}
                      {p.expiresAt ? `${t('expiresIn')} ${formatExpiry(p.expiresAt)}` : t('noExpiry')}
                    </div>
                  </div>
                  <button
                    onClick={() => setConfirmRemove({ agent: agent.id, profileId: p.profileId })}
                    title={t('remove')}
                    className="text-white/40 hover:text-red-300 p-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {loginCtx && (
        <LoginModal
          agent={loginCtx.agent}
          allAgentIds={allAgentIds}
          onClose={() => setLoginCtx(null)}
          onDone={() => {
            setLoginCtx(null)
            refresh()
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmRemoveModal
          agent={confirmRemove.agent}
          profileId={confirmRemove.profileId}
          allAgentIds={allAgentIds}
          onClose={() => setConfirmRemove(null)}
          onConfirm={async (agentsToRemove) => {
            await removeProfile(agentsToRemove, confirmRemove.profileId)
            setConfirmRemove(null)
          }}
        />
      )}
    </div>
  )
}

function LoginModal({
  agent,
  allAgentIds,
  onClose,
  onDone,
}: {
  agent: string
  allAgentIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const t = useTranslations('llmAuth')
  const [provider, setProvider] = useState<ProviderSpec | null>(null)
  const [method, setMethod] = useState<AuthMethod | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [applyToOthers, setApplyToOthers] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobMeta, setJobMeta] = useState<JobMeta | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const otherAgents = useMemo(() => allAgentIds.filter((a) => a !== agent), [allAgentIds, agent])

  const start = useCallback(async () => {
    if (!provider || !method) return
    setSubmitError(null)
    const res = await fetch('/api/openclaw/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider.id,
        agent,
        method,
        apiKey: method === 'api-key' ? apiKey : undefined,
        applyToAgents: applyToOthers ? otherAgents : [],
      }),
    })
    if (!res.ok) {
      setSubmitError(await res.text())
      return
    }
    const body = (await res.json()) as { jobId: string }
    setJobId(body.jobId)
  }, [provider, method, agent, apiKey, applyToOthers, otherAgents])

  useEffect(() => {
    if (!jobId) return
    const es = new EventSource(`/api/jobs/${jobId}/stream`)
    es.addEventListener('meta', (e) => {
      try {
        setJobMeta(JSON.parse((e as MessageEvent).data))
      } catch {}
    })
    es.addEventListener('end', (e) => {
      try {
        setJobMeta(JSON.parse((e as MessageEvent).data))
      } catch {}
      es.close()
    })
    return () => es.close()
  }, [jobId])

  const finished = jobMeta?.status === 'success' || jobMeta?.status === 'failed'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1a1a2e] border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="text-white">
            {t('loginTitle', { agent })}
          </DialogTitle>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">{t('provider')}</label>
              <div className="grid grid-cols-2 gap-2">
                {KNOWN_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProvider(p)
                      setMethod(p.methods[0] ?? null)
                    }}
                    className={cn(
                      'px-3 py-2 rounded border text-left text-sm transition',
                      provider?.id === p.id
                        ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                        : 'border-white/[0.08] bg-white/[0.02] text-white/70 hover:border-white/20',
                    )}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="text-[10px] text-white/40 font-mono">{p.id}</div>
                  </button>
                ))}
              </div>
            </div>

            {provider && provider.methods.length > 1 && (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">{t('method')}</label>
                <div className="flex gap-2">
                  {provider.methods.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={cn(
                        'px-3 py-1.5 rounded border text-sm',
                        method === m
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                          : 'border-white/[0.08] bg-white/[0.02] text-white/70',
                      )}
                    >
                      {m === 'device-code' ? t('methodDeviceCode') : t('methodApiKey')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {method === 'api-key' && (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">{t('apiKey')}</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  className="font-mono text-xs"
                />
                {provider?.apiKeyUrl && (
                  <a
                    href={provider.apiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 mt-1.5 inline-flex items-center gap-1"
                  >
                    {t('getApiKey')} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {otherAgents.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyToOthers}
                  onChange={(e) => setApplyToOthers(e.target.checked)}
                  className="rounded border-white/20"
                />
                {t('applyToOthers', { count: otherAgents.length })}
              </label>
            )}

            {submitError && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded">
                {submitError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button onClick={start} disabled={!provider || !method || (method === 'api-key' && !apiKey)}>
                {t('start')}
              </Button>
            </div>
          </div>
        ) : (
          <LoginProgress
            meta={jobMeta}
            method={method}
            onClose={onClose}
            onDone={onDone}
            finished={finished}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LoginProgress({
  meta,
  method,
  onClose,
  onDone,
  finished,
}: {
  meta: JobMeta | null
  method: AuthMethod | null
  onClose: () => void
  onDone: () => void
  finished: boolean
}) {
  const t = useTranslations('llmAuth')
  const [copied, setCopied] = useState<'url' | 'code' | null>(null)

  const verificationUrl = meta?.extra?.verificationUrl
  const userCode = meta?.extra?.userCode

  // navigator.clipboard is unavailable in non-secure contexts (plain HTTP LAN URLs)
  // AND can race against the same-task user-gesture window if we await it. Run
  // the textarea fallback synchronously inside the click handler — that's the
  // form that works on http://100.72.74.90 and other non-HTTPS access modes.
  const copy = (val: string, kind: 'url' | 'code') => {
    let ok = false
    try {
      const ta = document.createElement('textarea')
      ta.value = val
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '0'
      ta.style.left = '0'
      ta.style.width = '1px'
      ta.style.height = '1px'
      ta.style.padding = '0'
      ta.style.border = 'none'
      ta.style.outline = 'none'
      ta.style.boxShadow = 'none'
      ta.style.background = 'transparent'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, val.length)
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      ok = false
    }
    // Try Promise-based API as a secondary attempt (will silently fail on http://).
    if (!ok && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(val).catch(() => {})
      ok = true
    }
    if (ok) {
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    }
  }

  if (!meta) {
    return (
      <div className="py-8 text-center text-white/50 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('starting')}
      </div>
    )
  }

  if (finished) {
    return (
      <div className="space-y-3">
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded border',
            meta.status === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300',
          )}
        >
          {meta.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {meta.status === 'success' ? t('success') : t('failed')}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
          {meta.status === 'success' && <Button onClick={onDone}>{t('done')}</Button>}
        </div>
      </div>
    )
  }

  if (method === 'device-code') {
    return (
      <div className="space-y-4">
        <div className="text-sm text-white/80">{t('deviceCodeInstructions')}</div>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-white/40 block mb-1">URL</label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded bg-black/30 border border-white/[0.08] text-xs text-cyan-300 font-mono truncate">
                {verificationUrl ?? t('waiting')}
              </code>
              {verificationUrl && (
                <>
                  <Button size="sm" variant="outline" onClick={() => copy(verificationUrl, 'url')}>
                    {copied === 'url' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={verificationUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-white/40 block mb-1">{t('code')}</label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded bg-black/30 border border-white/[0.08] text-base text-amber-300 font-mono tracking-widest text-center">
                {userCode ?? t('waiting')}
              </code>
              {userCode && (
                <Button size="sm" variant="outline" onClick={() => copy(userCode, 'code')}>
                  {copied === 'code' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('pollingForAuth')}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="py-8 text-center text-white/50 flex items-center justify-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {t('working')}
    </div>
  )
}

function ConfirmRemoveModal({
  agent,
  profileId,
  allAgentIds,
  onClose,
  onConfirm,
}: {
  agent: string
  profileId: string
  allAgentIds: string[]
  onClose: () => void
  onConfirm: (agents: string[]) => Promise<void>
}) {
  const t = useTranslations('llmAuth')
  const [allAgents, setAllAgents] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="bg-[#1a1a2e] border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            {t('removeTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-white/70">
            {t('removeConfirm')}{' '}
            <code className="font-mono text-amber-300">{profileId}</code>
          </div>
          {allAgentIds.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={allAgents}
                onChange={(e) => setAllAgents(e.target.checked)}
                className="rounded border-white/20"
              />
              {t('removeFromAll', { count: allAgentIds.length })}
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setBusy(true)
                try {
                  await onConfirm(allAgents ? allAgentIds : [agent])
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
            >
              {t('remove')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
