'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface ModelsStatus {
  defaultModel: string | null
  resolvedDefault: string | null
  fallbacks: string[]
  aliases: Record<string, string>
  allowed: string[]
}

interface AvailableModel {
  key: string
  name: string
  input: string
  contextWindow: number
  available: boolean
  tags: string[]
}

interface AgentResponse {
  agents: { id: string }[]
}

interface ModelsResponse {
  status: ModelsStatus
  available: AvailableModel[]
}

export function ModelsView() {
  const { data: agentsData } = useQuery<AgentResponse>({
    queryKey: ['openclaw-auth-agents'],
    queryFn: () => fetch('/api/openclaw/auth/agents').then((r) => r.json()),
  })
  const agents = agentsData?.agents ?? []
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const selected = activeAgent ?? agents[0]?.id ?? null

  return (
    <div className="space-y-4">
      {agents.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setActiveAgent(a.id)}
              className={cn(
                'px-3 py-1.5 rounded text-sm border font-mono',
                selected === a.id
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                  : 'border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20',
              )}
            >
              {a.id}
            </button>
          ))}
        </div>
      )}
      {selected && <AgentModels agent={selected} />}
    </div>
  )
}

function AgentModels({ agent }: { agent: string }) {
  const t = useTranslations('llmAuth')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<ModelsResponse>({
    queryKey: ['openclaw-models', agent],
    queryFn: () => fetch(`/api/openclaw/models?agent=${agent}`).then((r) => r.json()),
  })

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['openclaw-models', agent] })
  }, [qc, agent])

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aliasModal, setAliasModal] = useState<{ alias: string; model: string } | null>(null)
  const [fallbackModal, setFallbackModal] = useState(false)

  const post = useCallback(
    async (path: string, body: unknown, key: string) => {
      setBusy(key)
      setError(null)
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? r.statusText)
        refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const setDefault = (model: string) =>
    post('/api/openclaw/models/default', { agent, model }, `default-${model}`)

  const removeFallback = (model: string) =>
    post('/api/openclaw/models/fallbacks', { agent, action: 'remove', model }, `fbrm-${model}`)

  const addFallback = (model: string) =>
    post('/api/openclaw/models/fallbacks', { agent, action: 'add', model }, `fbadd-${model}`)

  const reorderFallbacks = (models: string[]) =>
    post('/api/openclaw/models/fallbacks', { agent, action: 'reorder', models }, 'reorder')

  const removeAlias = (alias: string) =>
    post('/api/openclaw/models/aliases', { agent, action: 'remove', alias }, `aliasrm-${alias}`)

  const addAlias = (alias: string, model: string) =>
    post('/api/openclaw/models/aliases', { agent, action: 'add', alias, model }, 'aliasadd')

  if (isLoading || !data) return <div className="text-white/40 text-sm">{t('loading')}</div>

  const { status, available } = data
  const availableByKey = new Map(available.map((m) => [m.key, m]))
  const fallbackSet = new Set(status.fallbacks)
  const candidateForFallback = available.filter(
    (m) => m.key !== status.defaultModel && !fallbackSet.has(m.key) && m.available,
  )

  const moveFallback = (idx: number, dir: -1 | 1) => {
    const next = [...status.fallbacks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    reorderFallbacks(next)
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded">
          {error}
        </div>
      )}

      <Section
        title={t('modelDefault')}
        subtitle={
          status.defaultModel
            ? `${status.defaultModel}${
                status.resolvedDefault && status.resolvedDefault !== status.defaultModel
                  ? ` → ${status.resolvedDefault}`
                  : ''
              }`
            : t('modelNoDefault')
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
          {available.map((m) => {
            const isDefault = status.defaultModel === m.key
            return (
              <button
                key={m.key}
                onClick={() => !isDefault && setDefault(m.key)}
                disabled={!m.available || isDefault || busy === `default-${m.key}`}
                className={cn(
                  'px-3 py-2 rounded border text-left text-xs flex items-center gap-2 transition',
                  isDefault
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : m.available
                      ? 'border-white/[0.08] bg-white/[0.02] text-white/80 hover:border-white/20'
                      : 'border-white/[0.04] bg-white/[0.01] text-white/30 cursor-not-allowed',
                )}
              >
                {isDefault && <Star className="w-3 h-3 fill-current shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="font-mono truncate">{m.key}</div>
                  <div className="text-[10px] text-white/40">
                    {m.input} · {Math.round(m.contextWindow / 1000)}k
                    {!m.available && ` · ${t('modelNotAvailable')}`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title={t('modelFallbacks')}
        subtitle={t('modelFallbacksHint')}
        action={
          <Button size="sm" variant="outline" onClick={() => setFallbackModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> {t('addFallback')}
          </Button>
        }
      >
        {status.fallbacks.length === 0 ? (
          <div className="text-xs text-white/30 italic py-3 text-center">
            {t('noFallbacks')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {status.fallbacks.map((m, i) => {
              const meta = availableByKey.get(m)
              return (
                <div
                  key={m}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/[0.06] bg-white/[0.02]"
                >
                  <span className="text-[10px] text-white/40 font-mono w-5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-white truncate">{m}</div>
                    {meta && (
                      <div className="text-[10px] text-white/40">
                        {meta.input} · {Math.round(meta.contextWindow / 1000)}k
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => moveFallback(i, -1)}
                    disabled={i === 0 || busy === 'reorder'}
                    className="text-white/40 hover:text-white p-1 disabled:opacity-30"
                    title={t('moveUp')}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveFallback(i, 1)}
                    disabled={i === status.fallbacks.length - 1 || busy === 'reorder'}
                    className="text-white/40 hover:text-white p-1 disabled:opacity-30"
                    title={t('moveDown')}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeFallback(m)}
                    disabled={busy === `fbrm-${m}`}
                    className="text-white/40 hover:text-red-300 p-1"
                    title={t('remove')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section
        title={t('modelAliases')}
        subtitle={t('modelAliasesHint')}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAliasModal({ alias: '', model: status.defaultModel ?? '' })}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> {t('addAlias')}
          </Button>
        }
      >
        {Object.keys(status.aliases).length === 0 ? (
          <div className="text-xs text-white/30 italic py-3 text-center">
            {t('noAliases')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(status.aliases).map(([alias, model]) => (
              <div
                key={alias}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/[0.06] bg-white/[0.02]"
              >
                <code className="text-xs text-cyan-300 font-mono">{alias}</code>
                <span className="text-white/30 text-xs">→</span>
                <code className="text-xs text-white/80 font-mono flex-1 truncate">{model}</code>
                <button
                  onClick={() => removeAlias(alias)}
                  disabled={busy === `aliasrm-${alias}`}
                  className="text-white/40 hover:text-red-300 p-1"
                  title={t('remove')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {fallbackModal && (
        <AddFallbackModal
          candidates={candidateForFallback}
          onClose={() => setFallbackModal(false)}
          onPick={(m) => {
            addFallback(m)
            setFallbackModal(false)
          }}
        />
      )}

      {aliasModal && (
        <AliasModal
          available={available}
          initial={aliasModal}
          onClose={() => setAliasModal(null)}
          onSave={(alias, model) => {
            addAlias(alias, model)
            setAliasModal(null)
          }}
        />
      )}
    </div>
  )
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          {subtitle && <div className="text-xs text-white/40 mt-0.5 font-mono">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function AddFallbackModal({
  candidates,
  onClose,
  onPick,
}: {
  candidates: AvailableModel[]
  onClose: () => void
  onPick: (model: string) => void
}) {
  const t = useTranslations('llmAuth')
  const [filter, setFilter] = useState('')
  const filtered = useMemo(
    () => candidates.filter((c) => c.key.toLowerCase().includes(filter.toLowerCase())),
    [candidates, filter],
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1a1a2e] border-white/[0.08] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">{t('addFallback')}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t('filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs"
        />
        <div className="max-h-96 overflow-y-auto space-y-1">
          {filtered.map((m) => (
            <button
              key={m.key}
              onClick={() => onPick(m.key)}
              className="w-full text-left px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            >
              <div className="text-xs font-mono text-white">{m.key}</div>
              <div className="text-[10px] text-white/40">
                {m.input} · {Math.round(m.contextWindow / 1000)}k
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AliasModal({
  available,
  initial,
  onClose,
  onSave,
}: {
  available: AvailableModel[]
  initial: { alias: string; model: string }
  onClose: () => void
  onSave: (alias: string, model: string) => void
}) {
  const t = useTranslations('llmAuth')
  const [alias, setAlias] = useState(initial.alias)
  const [model, setModel] = useState(initial.model)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1a1a2e] border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="text-white">{t('addAlias')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">{t('aliasName')}</label>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="my-default"
              className="text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">{t('aliasTarget')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 rounded bg-black/30 border border-white/[0.08] text-xs text-white font-mono"
            >
              {available.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.key}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              <X className="w-3.5 h-3.5 mr-1" /> {t('cancel')}
            </Button>
            <Button
              onClick={() => onSave(alias.trim(), model)}
              disabled={!alias.trim() || !model}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> {t('save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
