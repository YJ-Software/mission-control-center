'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown, Filter, Search, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type LogLevel = 'info' | 'warning' | 'error'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  service: string
  message: string
}

interface LogResult {
  logs: LogEntry[]
  limited?: boolean
  hint?: string
}

const levelStyles: Record<LogLevel, string> = {
  info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/10 text-red-300 border-red-500/30',
}

function LogRow({ log, expanded, onToggle }: { log: LogEntry; expanded: boolean; onToggle: () => void }) {
  const time = new Date(log.timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <div className="flex items-center gap-3">
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0">
            <ChevronDown className="w-3.5 h-3.5 text-white/30" />
          </motion.div>
          <span className={cn('shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase w-16 text-center', levelStyles[log.level])}>
            {log.level}
          </span>
          <time className="shrink-0 w-20 font-mono text-[10px] text-white/35">{time}</time>
          <span className="shrink-0 max-w-[8rem] truncate font-mono text-[11px] text-cyan-300/70">{log.service}</span>
          <p className="flex-1 truncate font-mono text-[11px] text-white/65">{log.message}</p>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.05] bg-black/30"
          >
            <div className="px-4 py-3 space-y-3">
              <pre className="whitespace-pre-wrap break-words rounded bg-black/40 p-3 font-mono text-[11px] text-white/80">{log.message}</pre>
              <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-white/40">
                <span>service: <span className="text-white/70">{log.service}</span></span>
                <span>level: <span className="text-white/70">{log.level}</span></span>
                <span>time: <span className="text-white/70">{new Date(log.timestamp).toLocaleString()}</span></span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function FilterGroup({
  title, values, selected, onToggle,
}: { title: string; values: string[]; selected: string[]; onToggle: (v: string) => void }) {
  if (values.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono uppercase tracking-wider text-white/35">{title}</p>
      <div className="space-y-1.5">
        {values.map((v) => {
          const on = selected.includes(v)
          return (
            <button
              key={v}
              onClick={() => onToggle(v)}
              aria-pressed={on}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-colors',
                on ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' : 'border-white/[0.08] text-white/50 hover:border-white/20 hover:bg-white/[0.03]',
              )}
            >
              <span className="truncate">{v}</span>
              {on && <Check className="w-3 h-3 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function LogViewer({ endpoint, queryKey }: { endpoint: string; queryKey: string }) {
  const t = useTranslations('systemLog')
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useState<string[]>([])
  const [serviceFilter, setServiceFilter] = useState<string[]>([])

  const { data, isLoading, isFetching, refetch } = useQuery<LogResult>({
    queryKey: ['log-viewer', queryKey],
    queryFn: () => fetch(endpoint).then((r) => r.json()),
    refetchInterval: autoRefresh ? 5000 : false,
  })

  const logs = useMemo(() => data?.logs ?? [], [data])
  const services = useMemo(() => [...new Set(logs.map((l) => l.service))].sort(), [logs])
  const levels = useMemo(() => ['error', 'warning', 'info'].filter((lv) => logs.some((l) => l.level === lv)), [logs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) => {
      if (levelFilter.length && !levelFilter.includes(l.level)) return false
      if (serviceFilter.length && !serviceFilter.includes(l.service)) return false
      if (q && !(`${l.message} ${l.service}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [logs, query, levelFilter, serviceFilter])

  const activeFilters = levelFilter.length + serviceFilter.length
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="cyber-card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-white/[0.06] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-white/30" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-8 pr-2 py-1.5 font-mono text-[11px] text-white/80 placeholder-white/30 outline-none focus:border-white/20"
              />
            </div>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono transition-colors',
                showFilters ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' : 'border-white/[0.08] text-white/50 hover:border-white/20',
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              {activeFilters > 0 && (
                <span className="rounded bg-cyan-500/30 px-1 text-[9px] text-cyan-100">{activeFilters}</span>
              )}
            </button>
            <button
              onClick={() => setAutoRefresh((a) => !a)}
              title={t('autoRefresh')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono transition-colors',
                autoRefresh ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] text-white/50 hover:border-white/20',
              )}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
              {t('autoRefresh')}
            </button>
            {!autoRefresh && (
              <button
                onClick={() => refetch()}
                className="inline-flex items-center rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-mono text-white/50 hover:border-white/20"
              >
                {t('refresh')}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-white/30">{filtered.length}/{logs.length} {t('lines')}</span>
          </div>
        </div>

        {/* Limited-access hint */}
        {data?.limited && (
          <div className="flex items-start gap-2 border-b border-amber-400/15 bg-amber-500/[0.06] px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] leading-relaxed text-amber-200/80">{data.hint || t('limitedAccess')}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 220, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 overflow-y-auto border-r border-white/[0.06]"
              >
                <div className="space-y-5 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold text-white/70">{t('filters')}</h3>
                    {activeFilters > 0 && (
                      <button onClick={() => { setLevelFilter([]); setServiceFilter([]) }} className="text-[10px] text-white/40 hover:text-white/70">
                        {t('clear')}
                      </button>
                    )}
                  </div>
                  <FilterGroup title={t('level')} values={levels} selected={levelFilter} onToggle={(v) => toggle(levelFilter, setLevelFilter, v)} />
                  <FilterGroup title={t('service')} values={services} selected={serviceFilter} onToggle={(v) => toggle(serviceFilter, setServiceFilter, v)} />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-[11px] text-white/35">
                <Loader2 className="mr-2 w-3.5 h-3.5 animate-spin" />{t('loading')}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center p-12 text-center text-[11px] text-white/35">{t('empty')}</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {filtered.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    expanded={expandedId === log.id}
                    onToggle={() => setExpandedId((c) => (c === log.id ? null : log.id))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
