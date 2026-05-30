'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertCircle, Loader2, Clock, RotateCcw, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobMeta, LogLine, JobStatus } from '@/lib/jobs/types'

interface ListResponse {
  jobs: JobMeta[]
}

interface DetailResponse {
  meta: JobMeta
  log: LogLine[]
}

const statusBadge: Record<JobStatus, { label: string; cls: string; Icon: typeof Loader2 }> = {
  running: { label: 'running', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30', Icon: Loader2 },
  restarting: { label: 'restarting', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30', Icon: RotateCcw },
  success: { label: 'success', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  failed: { label: 'failed', cls: 'text-red-300 bg-red-500/10 border-red-500/30', Icon: AlertCircle },
  cancelled: { label: 'cancelled', cls: 'text-white/40 bg-white/[0.04] border-white/10', Icon: Clock },
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export function SystemLogView() {
  const t = useTranslations('systemLog')
  const sp = useSearchParams()
  const router = useRouter()
  const selectedId = sp.get('job')

  const { data: list } = useQuery<ListResponse>({
    queryKey: ['system-log-jobs'],
    queryFn: () => fetch('/api/jobs').then((r) => r.json()),
    refetchInterval: 5000,
  })

  const allJobs = useMemo(() => list?.jobs ?? [], [list])

  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all')
  const [kindFilter, setKindFilter] = useState<'all' | string>('all')
  const [query, setQuery] = useState('')

  const availableKinds = useMemo(() => {
    const set = new Set<string>()
    allJobs.forEach((j) => set.add(j.kind))
    return [...set].sort()
  }, [allJobs])

  const jobs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allJobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false
      if (kindFilter !== 'all' && j.kind !== kindFilter) return false
      if (q && !(`${j.label} ${j.kind} ${j.id}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [allJobs, statusFilter, kindFilter, query])

  const selectJob = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(sp.toString())
      if (id) params.set('job', id)
      else params.delete('job')
      router.replace(`/system-log${params.toString() ? `?${params}` : ''}`)
    },
    [sp, router],
  )

  // Auto-select first job if none.
  useEffect(() => {
    if (!selectedId && jobs.length > 0) selectJob(jobs[0].id)
  }, [selectedId, jobs, selectJob])

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <aside className="w-72 shrink-0 cyber-card overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white/70">{t('jobs')}</h3>
          <span className="font-mono text-[10px] text-white/30">
            {jobs.length}/{allJobs.length}
          </span>
        </div>
        <div className="px-3 py-2 border-b border-white/[0.06] space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-7 pr-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-[11px] text-white/80 placeholder-white/30 focus:border-white/20 outline-none font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | JobStatus)}
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg text-[10px] text-white/70 font-mono px-1.5 py-1 outline-none"
            >
              <option value="all">{t('statusAll')}</option>
              <option value="running">running</option>
              <option value="restarting">restarting</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg text-[10px] text-white/70 font-mono px-1.5 py-1 outline-none"
            >
              <option value="all">{t('kindAll')}</option>
              {availableKinds.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {jobs.length === 0 && (
            <p className="px-3 py-6 text-[11px] text-white/40 text-center">{t('empty')}</p>
          )}
          {jobs.map((job) => {
            const badge = statusBadge[job.status]
            const Icon = badge.Icon
            const active = job.id === selectedId
            return (
              <button
                key={job.id}
                onClick={() => selectJob(job.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-white/[0.04] transition-colors',
                  active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase',
                      badge.cls,
                    )}
                  >
                    <Icon
                      className={cn('w-2.5 h-2.5', (job.status === 'running' || job.status === 'restarting') && 'animate-spin')}
                    />
                    {badge.label}
                  </span>
                  <span className="font-mono text-[10px] text-white/30 ml-auto">{timeAgo(job.startedAt)}</span>
                </div>
                <div className="text-[12px] text-white/80 mt-1 truncate">{job.label}</div>
                <div className="font-mono text-[10px] text-white/35 mt-0.5">{job.kind}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex-1 cyber-card overflow-hidden flex flex-col min-w-0">
        {selectedId ? (
          <JobViewer jobId={selectedId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[11px] text-white/35">
            {t('selectJob')}
          </div>
        )}
      </section>
    </div>
  )
}

function JobViewer({ jobId }: { jobId: string }) {
  const t = useTranslations('systemLog')
  const [meta, setMeta] = useState<JobMeta | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  // Initial load (so we get full state even if SSE hasn't connected yet).
  useEffect(() => {
    let cancelled = false
    setMeta(null)
    setLines([])
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json() as Promise<DetailResponse>)
      .then((data) => {
        if (cancelled) return
        setMeta(data.meta)
        setLines(data.log)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [jobId])

  // SSE stream for live updates.
  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/stream`)
    es.addEventListener('meta', (e) => {
      try {
        setMeta(JSON.parse((e as MessageEvent).data) as JobMeta)
      } catch {}
    })
    es.addEventListener('log', (e) => {
      try {
        const line = JSON.parse((e as MessageEvent).data) as LogLine
        setLines((prev) => [...prev, line])
      } catch {}
    })
    es.addEventListener('end', (e) => {
      try {
        setMeta(JSON.parse((e as MessageEvent).data) as JobMeta)
      } catch {}
      es.close()
    })
    es.onerror = () => {
      // browser will retry; keep the connection lazy
    }
    return () => es.close()
  }, [jobId])

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  if (!meta) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-white/35">
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
        {t('loading')}
      </div>
    )
  }

  const badge = statusBadge[meta.status]
  const Icon = badge.Icon

  return (
    <>
      <header className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono uppercase',
              badge.cls,
            )}
          >
            <Icon className={cn('w-3 h-3', (meta.status === 'running' || meta.status === 'restarting') && 'animate-spin')} />
            {badge.label}
          </span>
          <h2 className="text-sm text-white/85 font-medium truncate">{meta.label}</h2>
        </div>
        <div className="font-mono text-[10px] text-white/35 mt-1 flex flex-wrap gap-x-3">
          <span>id: {meta.id}</span>
          <span>kind: {meta.kind}</span>
          <span>by: {meta.triggeredBy}</span>
          <span>started: {new Date(meta.startedAt).toLocaleString()}</span>
          {meta.finishedAt && <span>finished: {new Date(meta.finishedAt).toLocaleString()}</span>}
          {meta.exitCode != null && <span>exit: {meta.exitCode}</span>}
        </div>
        {meta.phases.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {meta.phases.map((p, i) => {
              const tone =
                p.status === 'success' ? 'text-emerald-300/85 border-emerald-500/30'
                : p.status === 'failed' ? 'text-red-300/85 border-red-500/30'
                : p.status === 'running' ? 'text-cyan-300/85 border-cyan-500/30'
                : p.status === 'skipped' ? 'text-white/30 border-white/10'
                : 'text-white/50 border-white/15'
              return (
                <div key={i} className="flex items-center gap-1">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-mono', tone)}>
                    {i + 1}. {p.name}
                    {p.status === 'running' && <Loader2 className="inline w-2.5 h-2.5 ml-1 animate-spin" />}
                  </span>
                  {i < meta.phases.length - 1 && <ChevronRight className="w-3 h-3 text-white/20" />}
                </div>
              )
            })}
          </div>
        )}
      </header>

      <div className="px-4 py-2 border-b border-white/[0.04] flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-white/45 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-cyan-400"
          />
          {t('autoScroll')}
        </label>
        <span className="font-mono text-[10px] text-white/30 ml-auto">{lines.length} lines</span>
      </div>

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-black/40 font-mono text-[11px] leading-relaxed px-4 py-3"
      >
        {lines.length === 0 && (
          <p className="text-white/30">{t('waitingOutput')}</p>
        )}
        {lines.map((line, i) => {
          const tone =
            line.stream === 'stderr' ? 'text-red-300/85'
            : line.stream === 'phase' ? 'text-cyan-300/85'
            : line.stream === 'system' ? 'text-amber-300/70'
            : 'text-white/75'
          return (
            <div key={i} className={cn('whitespace-pre-wrap break-words', tone)}>
              <span className="text-white/25 mr-2">{new Date(line.ts).toLocaleTimeString()}</span>
              {line.text}
            </div>
          )
        })}
      </div>
    </>
  )
}
