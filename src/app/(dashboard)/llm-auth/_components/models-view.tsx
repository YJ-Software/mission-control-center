'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
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

const GLOBAL_TAB = '__global__'

export function ModelsView() {
  const t = useTranslations('llmAuth')
  const { data: agentsData } = useQuery<AgentResponse>({
    queryKey: ['openclaw-auth-agents'],
    queryFn: () => fetch('/api/openclaw/auth/agents').then((r) => r.json()),
  })
  const agents = agentsData?.agents ?? []
  const [active, setActive] = useState<string>(GLOBAL_TAB)

  // Use the first agent as the "carrier" for global queries — the underlying
  // CLI returns the same global config regardless of which agent we ask.
  const queryAgent = agents[0]?.id

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <TabPill
          active={active === GLOBAL_TAB}
          onClick={() => setActive(GLOBAL_TAB)}
        >
          {t('globalTab')}
        </TabPill>
        {agents.map((a) => (
          <TabPill
            key={a.id}
            active={active === a.id}
            onClick={() => setActive(a.id)}
            mono
          >
            {a.id}
          </TabPill>
        ))}
      </div>
      {active === GLOBAL_TAB
        ? queryAgent && <GlobalModels agent={queryAgent} />
        : <SingleAgentOverride agent={active} fallbackQueryAgent={queryAgent} />}
    </div>
  )
}

function TabPill({
  active,
  onClick,
  children,
  mono,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded text-sm border',
        mono && 'font-mono',
        active
          ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
          : 'border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20',
      )}
    >
      {children}
    </button>
  )
}

function GlobalModels({ agent }: { agent: string }) {
  const t = useTranslations('llmAuth')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<ModelsResponse>({
    queryKey: ['openclaw-models', agent],
    queryFn: () => fetch(`/api/openclaw/models?agent=${agent}`).then((r) => r.json()),
  })
  // Fetch TRUE global defaults — getStatus(agent).{defaultModel,fallbacks}
  // returns the per-agent effective view, so if that agent has an override
  // we'd be showing the override and reorder writes would seem to silently
  // do nothing.
  const { data: overrides } = useQuery<OverridesResponse>({
    queryKey: ['openclaw-models-overrides'],
    queryFn: () => fetch('/api/openclaw/models/overrides').then((r) => r.json()),
  })

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['openclaw-models', agent] })
    qc.invalidateQueries({ queryKey: ['openclaw-models-overrides'] })
  }, [qc, agent])

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aliasModal, setAliasModal] = useState<{ alias: string; model: string } | null>(null)
  const [fallbackModal, setFallbackModal] = useState(false)

  const post = useCallback(
    async (
      path: string,
      body: unknown,
      key: string,
      optimistic?: (prev: OverridesResponse | undefined) => OverridesResponse | undefined,
    ) => {
      setBusy(key)
      setError(null)
      const previous = qc.getQueryData<OverridesResponse>(['openclaw-models-overrides'])
      // Optimistic update — server-side writes re-spawn openclaw (~3s); UI
      // must reflect the change instantly so the highlight tracks the spinner.
      if (optimistic) {
        qc.setQueryData<OverridesResponse | undefined>(
          ['openclaw-models-overrides'],
          (old) => optimistic(old),
        )
      }
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
        if (optimistic && previous)
          qc.setQueryData(['openclaw-models-overrides'], previous)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [refresh, qc],
  )

  const patchDefaults = (
    updater: (d: { primary: string | null; fallbacks: string[] }) => {
      primary: string | null
      fallbacks: string[]
    },
  ) =>
    (prev: OverridesResponse | undefined): OverridesResponse | undefined => {
      if (!prev) return prev
      const base = prev.defaults ?? { primary: null, fallbacks: [] }
      return { ...prev, defaults: updater(base) }
    }

  const setDefault = (model: string) =>
    post(
      '/api/openclaw/models/default',
      { agent, model },
      `default-${model}`,
      patchDefaults((d) => ({ ...d, primary: model })),
    )

  const removeFallback = (model: string) =>
    post(
      '/api/openclaw/models/fallbacks',
      { agent, action: 'remove', model },
      `fbrm-${model}`,
      patchDefaults((d) => ({ ...d, fallbacks: d.fallbacks.filter((m) => m !== model) })),
    )

  const addFallback = (model: string) =>
    post(
      '/api/openclaw/models/fallbacks',
      { agent, action: 'add', model },
      `fbadd-${model}`,
      patchDefaults((d) => ({ ...d, fallbacks: [...d.fallbacks, model] })),
    )

  const reorderFallbacks = (models: string[]) =>
    post(
      '/api/openclaw/models/fallbacks',
      { agent, action: 'reorder', models },
      'reorder',
      patchDefaults((d) => ({ ...d, fallbacks: models })),
    )

  const removeAlias = (alias: string) =>
    post('/api/openclaw/models/aliases', { agent, action: 'remove', alias }, `aliasrm-${alias}`)

  const addAlias = (alias: string, model: string) =>
    post('/api/openclaw/models/aliases', { agent, action: 'add', alias, model }, 'aliasadd')

  if (isLoading || !data) return <div className="text-white/40 text-sm">{t('loading')}</div>

  const { status, available } = data
  // True global config — falls back to status if /overrides hasn't loaded yet.
  const globalPrimary = overrides?.defaults?.primary ?? status.defaultModel
  const globalFallbacks = overrides?.defaults?.fallbacks ?? status.fallbacks
  const availableByKey = new Map(available.map((m) => [m.key, m]))
  const fallbackSet = new Set(globalFallbacks)
  const candidateForFallback = available.filter(
    (m) => m.key !== globalPrimary && !fallbackSet.has(m.key) && m.available,
  )

  const moveFallback = (idx: number, dir: -1 | 1) => {
    const next = [...globalFallbacks]
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
        subtitle={globalPrimary ?? t('modelNoDefault')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
          {available.map((m) => {
            const isDefault = globalPrimary === m.key
            const isSaving = busy === `default-${m.key}`
            return (
              <button
                key={m.key}
                onClick={() => !isDefault && setDefault(m.key)}
                disabled={!m.available || isDefault || isSaving}
                className={cn(
                  'px-3 py-2 rounded border text-left text-xs flex items-center gap-2 transition',
                  isDefault
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : isSaving
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                      : m.available
                        ? 'border-white/[0.08] bg-white/[0.02] text-white/80 hover:border-white/20'
                        : 'border-white/[0.04] bg-white/[0.01] text-white/30 cursor-not-allowed',
                )}
              >
                {isSaving ? (
                  <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                ) : (
                  isDefault && <Star className="w-3 h-3 fill-current shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-mono truncate">{m.key}</div>
                  <div className="text-[10px] text-white/40">
                    {isSaving
                      ? t('saving')
                      : `${m.input} · ${Math.round(m.contextWindow / 1000)}k${
                          !m.available ? ` · ${t('modelNotAvailable')}` : ''
                        }`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title={
          <div className="flex items-center gap-2">
            <span>{t('modelFallbacks')}</span>
            {busy === 'reorder' && (
              <span className="flex items-center gap-1 text-[10px] text-cyan-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('saving')}
              </span>
            )}
          </div>
        }
        subtitle={t('modelFallbacksHint')}
        action={
          <Button size="sm" variant="outline" onClick={() => setFallbackModal(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> {t('addFallback')}
          </Button>
        }
      >
        {globalFallbacks.length === 0 ? (
          <div className="text-xs text-white/30 italic py-3 text-center">
            {t('noFallbacks')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {globalFallbacks.map((m, i) => {
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
                    disabled={i === globalFallbacks.length - 1 || busy === 'reorder'}
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
            onClick={() => setAliasModal({ alias: '', model: globalPrimary ?? '' })}
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
  title: React.ReactNode
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
              style={{ colorScheme: 'dark' }}
              className="w-full px-3 py-2 rounded bg-black/30 border border-white/[0.08] text-xs text-white font-mono"
            >
              {available.map((m) => (
                <option
                  key={m.key}
                  value={m.key}
                  style={{ backgroundColor: '#1a1a2e', color: '#ffffff' }}
                >
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

// ─── Per-agent overrides ────────────────────────────────────────────────

interface OverridesResponse {
  agents: { id: string; model?: { primary?: string; fallbacks?: string[] } }[]
  defaults: { primary: string | null; fallbacks: string[] } | null
}

function SingleAgentOverride({
  agent,
  fallbackQueryAgent,
}: {
  agent: string
  fallbackQueryAgent?: string
}) {
  const t = useTranslations('llmAuth')
  const qc = useQueryClient()
  const { data } = useQuery<OverridesResponse>({
    queryKey: ['openclaw-models-overrides'],
    queryFn: () => fetch('/api/openclaw/models/overrides').then((r) => r.json()),
  })
  const queryAgent = fallbackQueryAgent ?? agent
  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ['openclaw-models', queryAgent],
    queryFn: () => fetch(`/api/openclaw/models?agent=${queryAgent}`).then((r) => r.json()),
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['openclaw-models-overrides'] })
  }, [qc])

  const post = useCallback(
    async (
      body: {
        agent: string
        action: 'set' | 'clear'
        primary?: string
        fallbacks?: string[]
      },
      key: string,
    ) => {
      setBusy(key)
      setError(null)
      // Snapshot for rollback if the API call fails.
      const previous = qc.getQueryData<OverridesResponse>(['openclaw-models-overrides'])
      // Optimistic update — server-side `agent-override` triggers an
      // `openclaw config set/unset` that re-spawns openclaw (~3s); without
      // this the badge would lag behind the spinner.
      qc.setQueryData<OverridesResponse | undefined>(
        ['openclaw-models-overrides'],
        (old) => {
          if (!old) return old
          return {
            ...old,
            agents: old.agents.map((a) => {
              if (a.id !== body.agent) return a
              if (body.action === 'clear') {
                const { model: _model, ...rest } = a
                return rest
              }
              const nextModel: { primary?: string; fallbacks?: string[] } = {}
              if (body.primary !== undefined) nextModel.primary = body.primary
              if (body.fallbacks !== undefined) nextModel.fallbacks = body.fallbacks
              return { ...a, model: nextModel }
            }),
          }
        },
      )
      try {
        const r = await fetch('/api/openclaw/models/agent-override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? r.statusText)
        refresh()
      } catch (e) {
        // Roll back the optimistic update on failure.
        if (previous) qc.setQueryData(['openclaw-models-overrides'], previous)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [refresh, qc],
  )

  if (!data) return <div className="text-white/40 text-sm">{t('loading')}</div>

  const entry = data.agents.find((a) => a.id === agent)
  if (!entry)
    return (
      <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded">
        agent not found: {agent}
      </div>
    )

  const available = modelsData?.available ?? []
  const hasOverride = !!entry.model
  const primaryDisplay = entry.model?.primary ?? data.defaults?.primary ?? '—'
  const fallbacksDisplay = entry.model?.fallbacks ?? data.defaults?.fallbacks ?? []

  return (
    <Section
      title={
        <div className="flex items-center gap-2">
          <span>{agent}</span>
          <span
            className={cn(
              'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-mono',
              hasOverride
                ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                : 'text-white/40 bg-white/[0.04] border-white/10',
            )}
          >
            {hasOverride ? t('overrideSet') : t('overrideInherit')}
          </span>
        </div>
      }
      subtitle={primaryDisplay}
    >
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}
      <PerAgentEditor
        agent={agent}
        current={entry.model}
        defaults={data.defaults}
        available={available}
        busy={busy === `set-${agent}` || busy === `clear-${agent}`}
        fallbacksDisplay={fallbacksDisplay}
        onSave={(primary, fallbacks) =>
          post(
            {
              agent,
              action: 'set',
              primary: primary ?? undefined,
              fallbacks: fallbacks ?? undefined,
            },
            `set-${agent}`,
          )
        }
        onClear={() => post({ agent, action: 'clear' }, `clear-${agent}`)}
      />
    </Section>
  )
}

function PerAgentEditor({
  current,
  defaults,
  available,
  busy,
  fallbacksDisplay,
  onSave,
  onClear,
}: {
  agent: string
  current?: { primary?: string; fallbacks?: string[] }
  defaults: { primary: string | null; fallbacks: string[] } | null
  available: AvailableModel[]
  busy: boolean
  fallbacksDisplay: string[]
  onSave: (primary: string | null, fallbacks: string[] | null) => void
  onClear: () => void
}) {
  const t = useTranslations('llmAuth')
  const [primary, setPrimary] = useState<string>(current?.primary ?? '')
  const [fallbacks, setFallbacks] = useState<string[]>(current?.fallbacks ?? [])
  const [overrideFallbacks, setOverrideFallbacks] = useState<boolean>(
    !!current?.fallbacks,
  )
  const [filter, setFilter] = useState('')
  const filteredAvailable = useMemo(
    () => available.filter((m) => m.key.toLowerCase().includes(filter.toLowerCase())),
    [available, filter],
  )

  const fallbackCandidates = filteredAvailable.filter(
    (m) => !fallbacks.includes(m.key) && m.key !== primary,
  )

  const moveFallback = (idx: number, dir: -1 | 1) => {
    const next = [...fallbacks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setFallbacks(next)
  }

  return (
    <div className="border-t border-white/[0.06] p-3 space-y-3">
      <div>
        <label className="text-xs text-white/50 mb-1.5 block">{t('overridePrimary')}</label>
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value)}
          // color-scheme: dark forces the native dropdown popup to render with
          // a dark palette in Chrome/Edge; inline option styles cover Firefox
          // / older Chrome where the popup ignores parent CSS.
          style={{ colorScheme: 'dark' }}
          className="w-full px-3 py-2 rounded bg-black/30 border border-white/[0.08] text-xs text-white font-mono"
        >
          <option value="" style={{ backgroundColor: '#1a1a2e', color: '#ffffff' }}>
            {t('overrideInheritOption')} ({defaults?.primary ?? '—'})
          </option>
          {available.map((m) => (
            <option
              key={m.key}
              value={m.key}
              style={{ backgroundColor: '#1a1a2e', color: '#ffffff' }}
            >
              {m.key}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs text-white/70 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overrideFallbacks}
            onChange={(e) => {
              setOverrideFallbacks(e.target.checked)
              if (!e.target.checked) setFallbacks([])
            }}
            className="rounded border-white/20"
          />
          {t('overrideFallbacksToggle')}
        </label>
        {overrideFallbacks ? (
          <div className="space-y-2">
            {fallbacks.length === 0 ? (
              <div className="text-xs text-white/30 italic py-2">{t('noFallbacks')}</div>
            ) : (
              <div className="space-y-1">
                {fallbacks.map((m, i) => (
                  <div
                    key={m}
                    className="flex items-center gap-2 px-2 py-1 rounded border border-white/[0.06] bg-white/[0.02]"
                  >
                    <span className="text-[10px] text-white/40 font-mono w-5">#{i + 1}</span>
                    <code className="text-xs text-white/80 font-mono flex-1 truncate">{m}</code>
                    <button
                      onClick={() => moveFallback(i, -1)}
                      disabled={i === 0}
                      className="text-white/40 hover:text-white p-1 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveFallback(i, 1)}
                      disabled={i === fallbacks.length - 1}
                      className="text-white/40 hover:text-white p-1 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setFallbacks(fallbacks.filter((x) => x !== m))}
                      className="text-white/40 hover:text-red-300 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Input
              placeholder={t('filterPlaceholder')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs"
            />
            <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1">
              {fallbackCandidates.slice(0, 30).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setFallbacks([...fallbacks, m.key])}
                  className="text-left px-2 py-1 rounded border border-white/[0.06] bg-white/[0.02] text-xs font-mono text-white/70 hover:border-white/20"
                >
                  + {m.key}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/40 italic">
            {t('overrideInheritOption')} ({fallbacksDisplay.length} {t('modelsCount')})
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {current && (
          <Button variant="ghost" onClick={onClear} disabled={busy}>
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 mr-1" />
            )}
            {t('clearOverride')}
          </Button>
        )}
        <Button
          onClick={() => {
            // "繼承全域" both fields + existing override → dispatch clear
            // (the set endpoint rejects empty payloads).
            if (!primary && !overrideFallbacks) {
              if (current) onClear()
              return
            }
            onSave(primary || null, overrideFallbacks ? fallbacks : null)
          }}
          disabled={busy || (!primary && !overrideFallbacks && !current)}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          )}
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
}
