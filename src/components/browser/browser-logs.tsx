'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Filter, Search, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type LogLevel = 'info' | 'warning' | 'error'
type LogSource = 'app' | 'journal'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  service: string
  message: string
}

type Filters = {
  level: string[]
  service: string[]
}

const levelStyles: Record<LogLevel, string> = {
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: LogEntry
  expanded: boolean
  onToggle: () => void
}) {
  const formattedTime = new Date(log.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const formattedDate = new Date(log.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <>
      <motion.button
        onClick={onToggle}
        className="w-full px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]"
      >
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0"
          >
            <ChevronDown className="h-3.5 w-3.5 text-white/20" />
          </motion.div>

          <Badge
            variant="secondary"
            className={`flex-shrink-0 capitalize text-[10px] px-1.5 py-0 border ${levelStyles[log.level]}`}
          >
            {log.level}
          </Badge>

          <time className="w-12 flex-shrink-0 font-mono text-[11px] text-white/30">
            {formattedTime}
          </time>

          <span className="flex-shrink-0 text-xs font-medium text-white/50 w-28 truncate">
            {log.service}
          </span>

          <p className="flex-1 truncate text-xs text-white/60 font-mono">
            {log.message}
          </p>
        </div>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.04] bg-white/[0.02]"
          >
            <div className="space-y-3 p-4">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/25">
                  Message
                </p>
                <p className="rounded-lg bg-black/30 border border-white/[0.06] p-3 font-mono text-xs text-white/70 break-all">
                  {log.message}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">Service</p>
                  <p className="font-mono text-white/60">{log.service}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">Date</p>
                  <p className="font-mono text-white/60">{formattedDate}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">Timestamp</p>
                  <p className="font-mono text-[11px] text-white/60">{log.timestamp}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function FilterPanel({
  filters,
  onChange,
  logs,
  t,
  showServiceFilter,
}: {
  filters: Filters
  onChange: (filters: Filters) => void
  logs: LogEntry[]
  t: (key: string) => string
  showServiceFilter: boolean
}) {
  const levels = Array.from(new Set(logs.map((log) => log.level)))
  const services = Array.from(new Set(logs.map((log) => log.service))).sort()

  const toggleFilter = (category: keyof Filters, value: string) => {
    const current = filters[category]
    const updated = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    onChange({ ...filters, [category]: updated })
  }

  const clearAll = () => onChange({ level: [], service: [] })
  const hasActiveFilters = Object.values(filters).some((g) => g.length > 0)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.05 }}
      className="flex h-full flex-col space-y-4 overflow-y-auto p-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white/60">{t('filters')}</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-5 text-[10px] text-white/40 hover:text-white/60 px-1.5">
            {t('clearFilters')}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/25">{t('level')}</p>
        <div className="space-y-1">
          {levels.map((level) => {
            const selected = filters.level.includes(level)
            return (
              <motion.button
                key={level}
                type="button"
                whileHover={{ x: 2 }}
                onClick={() => toggleFilter('level', level)}
                className={`flex w-full items-center justify-between gap-2 border rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  selected
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                    : 'border-white/[0.06] text-white/40 hover:border-white/[0.12] hover:bg-white/[0.03]'
                }`}
              >
                <span className="capitalize">{level}</span>
                {selected && <Check className="h-3 w-3" />}
              </motion.button>
            )
          })}
        </div>
      </div>

      {showServiceFilter && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/25">{t('service')}</p>
          <div className="space-y-1">
            {services.map((service) => {
              const selected = filters.service.includes(service)
              return (
                <motion.button
                  key={service}
                  type="button"
                  whileHover={{ x: 2 }}
                  onClick={() => toggleFilter('service', service)}
                  className={`flex w-full items-center justify-between gap-2 border rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    selected
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                      : 'border-white/[0.06] text-white/40 hover:border-white/[0.12] hover:bg-white/[0.03]'
                  }`}
                >
                  <span>{service}</span>
                  {selected && <Check className="h-3 w-3" />}
                </motion.button>
              )
            })}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function LogList({
  source,
  t,
}: {
  source: LogSource
  t: (key: string) => string
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>({ level: [], service: [] })

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery<LogEntry[]>({
    queryKey: ['browser-logs', source],
    queryFn: () => fetch(`/api/browser/logs?source=${source}&limit=300`).then(r => r.json()),
    refetchInterval: 15000,
  })

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const lowerQuery = searchQuery.toLowerCase()
      const matchSearch = log.message.toLowerCase().includes(lowerQuery) ||
        log.service.toLowerCase().includes(lowerQuery)
      const matchLevel = filters.level.length === 0 || filters.level.includes(log.level)
      const matchService = filters.service.length === 0 || filters.service.includes(log.service)
      return matchSearch && matchLevel && matchService
    })
  }, [filters, searchQuery, logs])

  const activeFilters = filters.level.length + filters.service.length

  return (
    <>
      {/* Toolbar */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/20" />
            <Input
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/20 focus-visible:ring-cyan-500/30"
            />
          </div>
          <span className="text-[11px] text-white/25 font-mono shrink-0">
            {filteredLogs.length}/{logs.length}
          </span>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters((c) => !c)}
            className={`relative h-8 px-2.5 ${
              showFilters
                ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border-cyan-500/30'
                : 'border-white/[0.08] text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilters > 0 && (
              <Badge className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center p-0 text-[9px] bg-cyan-500 text-white border-0">
                {activeFilters}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 px-2 text-white/40 hover:text-white/60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              key="filters"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 200, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-r border-white/[0.06] flex-shrink-0"
            >
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                logs={logs}
                t={t}
                showServiceFilter={source === 'journal'}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-5 w-5 animate-spin text-white/20" />
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              <AnimatePresence mode="popLayout">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log, index) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15, delay: Math.min(index * 0.01, 0.3) }}
                    >
                      <LogRow
                        log={log}
                        expanded={expandedId === log.id}
                        onToggle={() => setExpandedId((c) => c === log.id ? null : log.id)}
                      />
                    </motion.div>
                  ))
                ) : (
                  <motion.div
                    key="empty-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-12 text-center"
                  >
                    <p className="text-white/30 text-sm">{t('noLogs')}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export function BrowserLogs() {
  const t = useTranslations('browser.logs')
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<LogSource>('app')

  const tabs: { key: LogSource; label: string }[] = [
    { key: 'app', label: t('tabApp') },
    { key: 'journal', label: t('tabServices') },
  ]

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <h3 className="text-sm font-medium text-white">{t('title')}</h3>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-4 w-4 text-white/30" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="logs-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 480, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden flex flex-col border-t border-white/[0.06]"
          >
            {/* Tabs */}
            <div className="flex px-4 pt-2 pb-0 border-b border-white/[0.06]">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative px-3 pb-2.5 text-xs font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'text-cyan-400'
                      : 'text-white/35 hover:text-white/60'
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="browser-log-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-cyan-400 rounded-full"
                      transition={{ duration: 0.2 }}
                    />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <LogList source={activeTab} t={t} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
