'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FileText, Bot, Package, Mic, Play, Zap, Terminal, Clock,
  Loader2, ChevronDown, ArrowRight,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Topic } from './topic-card'

/* ── Types ── */
interface LogEntry {
  time: string
  step: string
  detail: string
  type?: string
}

interface CronRunEntry {
  jobId: string
  jobName: string
  status: string
  summary: string
  error?: string
  runAtMs: number
  durationMs: number
  model: string
  provider: string
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
}

type StepStatus = 'idle' | 'running' | 'done' | 'error'

/* ── Pipeline step config (keys only, labels resolved in component) ── */
const STEP_DEFS = [
  { id: 1, key: 'generate-prompts', labelKey: 'generatePrompts' as const, emoji: '📝', icon: FileText, color: 'cyan' },
  { id: 2, key: 'run-all', labelKey: 'runTopics' as const, emoji: '🤖', icon: Bot, color: 'purple' },
  { id: 3, key: 'finalize', labelKey: 'finalize' as const, emoji: '📦', icon: Package, color: 'cyan' },
  { id: 4, key: 'podcast', labelKey: 'generatePodcast' as const, emoji: '🎙️', icon: Mic, color: 'purple' },
] as const

function statusVariant(s: StepStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (s) {
    case 'idle': return 'outline'
    case 'running': return 'secondary'
    case 'done': return 'default'
    case 'error': return 'destructive'
  }
}

function statusBadgeClass(s: StepStatus) {
  switch (s) {
    case 'idle': return 'border-white/20 text-white/40'
    case 'running': return 'border-yellow-400/40 text-yellow-400 bg-yellow-400/10'
    case 'done': return 'border-green-400/40 text-green-400 bg-green-400/10'
    case 'error': return 'border-red-400/40 text-red-400 bg-red-400/10'
  }
}

/* ── Component ── */
export function ExecutionControl() {
  const t = useTranslations('morningReport')
  const tc = useTranslations('common')
  const queryClient = useQueryClient()
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(['idle', 'idle', 'idle', 'idle'])

  const STEPS = STEP_DEFS.map(s => ({ ...s, label: t(`execution.${s.labelKey}`) }))

  function statusLabel(s: StepStatus) {
    switch (s) {
      case 'idle': return t('execution.statusIdle')
      case 'running': return t('execution.statusRunning')
      case 'done': return t('execution.statusDone')
      case 'error': return t('execution.statusError')
    }
  }
  const [running, setRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  /* ── Data fetching ── */
  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ['morning-topics'],
    queryFn: async () => {
      const res = await fetch('/api/morning-report?type=topics')
      return res.json()
    },
  })

  const { data: cronRuns = [], isLoading: cronRunsLoading } = useQuery<CronRunEntry[]>({
    queryKey: ['morning-cron-runs'],
    queryFn: async () => {
      const res = await fetch('/api/morning-report?type=cron-runs')
      return res.json()
    },
  })

  /* ── SSE connection ── */
  useEffect(() => {
    const evtSource = new EventSource('/api/morning-report/stream')
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        setLogs(prev => [...prev, {
          time: new Date(data.timestamp || Date.now()).toLocaleTimeString(),
          step: data.step || '',
          detail: data.detail || data.message || JSON.stringify(data),
          type: data.type,
        }])
      } catch {
        // ignore parse errors
      }
    }
    evtSource.onerror = () => {
      // SSE will auto-reconnect
    }
    return () => evtSource.close()
  }, [])

  /* ── Auto-scroll log ── */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  /* ── Step helpers ── */
  const updateStep = useCallback((idx: number, status: StepStatus) => {
    setStepStatuses(prev => {
      const next = [...prev]
      next[idx] = status
      return next
    })
  }, [])

  async function executeStep(stepIndex: number) {
    const step = STEPS[stepIndex]
    updateStep(stepIndex, 'running')
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      step: step.label,
      detail: t('execution.startExecuting'),
    }])
    try {
      let url = `/api/morning-report?action=${step.key}`
      if (step.key === 'podcast') {
        const today = new Date().toISOString().split('T')[0]
        url += `&date=${today}`
      }
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      updateStep(stepIndex, 'done')
      setLogs(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        step: step.label,
        detail: t('execution.executionComplete'),
        type: 'success',
      }])
      return data
    } catch (err: unknown) {
      updateStep(stepIndex, 'error')
      const msg = err instanceof Error ? err.message : t('execution.unknownError')
      setLogs(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        step: step.label,
        detail: t('execution.executionFailed', { error: msg }),
        type: 'error',
      }])
      throw err
    }
  }

  /* ── Single step execution ── */
  async function runSingleStep(stepIndex: number) {
    setRunning(true)
    try {
      await executeStep(stepIndex)
    } finally {
      setRunning(false)
      queryClient.invalidateQueries({ queryKey: ['morning-cron-runs'] })
    }
  }

  /* ── Full pipeline ── */
  async function runFullPipeline() {
    setRunning(true)
    setStepStatuses(['idle', 'idle', 'idle', 'idle'])
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      step: t('execution.fullPipeline'),
      detail: t('execution.startFullPipeline'),
    }])
    try {
      for (let i = 0; i < STEPS.length; i++) {
        setCurrentStep(i + 1)
        await executeStep(i)
      }
      setCurrentStep(5) // all done
      setLogs(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        step: t('execution.fullPipeline'),
        detail: t('execution.allStepsComplete'),
        type: 'success',
      }])
    } catch {
      setCurrentStep(-1) // error
    } finally {
      setRunning(false)
      queryClient.invalidateQueries({ queryKey: ['morning-cron-runs'] })
    }
  }

  /* ── Per-topic execution ── */
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set())
  const [topicRunning, setTopicRunning] = useState<Record<string, boolean>>({})
  const [topicStatus, setTopicStatus] = useState<Record<string, StepStatus>>({})

  async function runSingleTopic(topicId: string, topicName: string) {
    setTopicRunning(prev => ({ ...prev, [topicId]: true }))
    setTopicStatus(prev => ({ ...prev, [topicId]: 'running' }))
    setLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      step: topicName,
      detail: t('execution.startTopicExecution'),
    }])
    try {
      const res = await fetch(`/api/morning-report?action=run-topic&id=${topicId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      setTopicStatus(prev => ({ ...prev, [topicId]: 'done' }))
      setLogs(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        step: topicName,
        detail: `${t('execution.topicComplete')}${data.sessionId ? ` (session: ${data.sessionId})` : ''} ✓`,
        type: 'success',
      }])
    } catch (err: unknown) {
      setTopicStatus(prev => ({ ...prev, [topicId]: 'error' }))
      const msg = err instanceof Error ? err.message : t('execution.unknownError')
      setLogs(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        step: topicName,
        detail: t('execution.topicFailed', { error: msg }),
        type: 'error',
      }])
    } finally {
      setTopicRunning(prev => ({ ...prev, [topicId]: false }))
      queryClient.invalidateQueries({ queryKey: ['morning-cron-runs'] })
    }
  }

  return (
    <div className="space-y-6">
      {/* ── A. Pipeline Steps ── */}
      <div>
        <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          {t('execution.pipeline')}
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {STEPS.map((step, idx) => {
            const Icon = step.icon
            const status = stepStatuses[idx]
            const isActive = running && currentStep === idx + 1
            const colorClass = step.color === 'cyan' ? 'text-cyan-400' : 'text-purple-400'
            const bgClass = step.color === 'cyan' ? 'bg-cyan-400/10' : 'bg-purple-400/10'
            return (
              <div key={step.id} className="relative">
                <div className={`cyber-card p-4 transition-all ${isActive ? 'border-cyan-400/30 shadow-[0_0_20px_rgba(34,211,238,0.1)]' : ''}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg ${bgClass} flex items-center justify-center`}>
                      {isActive ? (
                        <Loader2 className={`w-4 h-4 ${colorClass} animate-spin`} />
                      ) : (
                        <Icon className={`w-4 h-4 ${colorClass}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white/40 font-mono">{t('execution.step', { id: step.id })}</p>
                      <p className="text-sm font-medium text-white/80 truncate">{step.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge className={`text-[10px] ${statusBadgeClass(status)}`} variant={statusVariant(status)}>
                      {isActive && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                      {statusLabel(status)}
                    </Badge>
                    <Button
                      size="sm"
                      disabled={running}
                      onClick={() => runSingleStep(idx)}
                      className={`text-xs h-7 px-3 ${
                        step.color === 'cyan'
                          ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20'
                          : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/20'
                      } disabled:opacity-30`}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      {t('execution.execute')}
                    </Button>
                  </div>
                </div>
                {/* Arrow connector */}
                {idx < STEPS.length - 1 && (
                  <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                    <ArrowRight className="w-4 h-4 text-white/20" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── B. One-Click Run ── */}
      <div className="cyber-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400/20 to-purple-400/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/80">{t('execution.oneClickRun')}</p>
              <p className="text-xs text-white/40">{t('execution.oneClickRunDesc')}</p>
            </div>
          </div>
          <Button
            disabled={running}
            onClick={runFullPipeline}
            className="bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-white hover:from-cyan-500/40 hover:to-purple-500/40
              border border-white/10 disabled:opacity-30 px-6"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('execution.runningProgress', { current: currentStep })}
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                {t('execution.startExecution')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── C. Per-Topic Execution ── */}
      {topics.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4 text-purple-400" />
            {t('execution.perTopicExecution')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topics.filter(t => t.enabled).map(topic => {
              const tRunning = topicRunning[topic.id] || false
              const tStatus = topicStatus[topic.id] || 'idle'
              return (
                <div key={topic.id} className="cyber-card p-3 flex items-center gap-3">
                  <span className="text-xl">{topic.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">{topic.name}</p>
                    <Badge className={`text-[10px] mt-1 ${statusBadgeClass(tStatus)}`} variant={statusVariant(tStatus)}>
                      {tRunning && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                      {statusLabel(tStatus)}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    disabled={running || tRunning}
                    onClick={() => runSingleTopic(topic.id, topic.name)}
                    className="text-xs h-7 px-3 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30
                      border border-purple-500/20 disabled:opacity-30"
                  >
                    {tRunning ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Play className="w-3 h-3 mr-1" />
                        {t('execution.execute')}
                      </>
                    )}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── D. Progress Log ── */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
            {t('execution.executionLog')}
          </h3>
          {logs.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLogs([])}
              className="text-[10px] text-white/30 hover:text-white/60 h-6 px-2"
            >
              {tc('clear')}
            </Button>
          )}
        </div>
        <div
          ref={logContainerRef}
          className="p-4 font-mono text-xs bg-black/30 max-h-64 overflow-y-auto space-y-1"
        >
          {logs.length === 0 ? (
            <p className="text-white/20 text-center py-4">{t('execution.waitingForExecution')}</p>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={`${log.type === 'error' ? 'text-red-400/80' : log.type === 'success' ? 'text-green-400/80' : 'text-white/60'}`}
              >
                <span className="text-green-400/60">[{log.time}]</span>{' '}
                <span className="text-cyan-400/80">{log.step}</span>: {log.detail}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── E. Execution History (Cron + Manual) ── */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            {t('execution.executionHistory')}
          </h3>
        </div>
        <div className="overflow-x-auto">
          {cronRunsLoading ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-white/30" />
              <span className="text-white/30 text-sm">{tc('loading')}</span>
            </div>
          ) : cronRuns.length === 0 ? (
            <p className="text-white/20 text-center text-sm py-6">{t('execution.noExecutionRecords')}</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left p-3 font-medium">{t('execution.historyTime')}</th>
                  <th className="text-left p-3 font-medium">{t('execution.historyJob')}</th>
                  <th className="text-left p-3 font-medium">{t('execution.historyStatus')}</th>
                  <th className="text-left p-3 font-medium">{t('execution.historyDuration')}</th>
                  <th className="text-left p-3 font-medium">{t('execution.historyModel')}</th>
                  <th className="text-left p-3 font-medium">{t('execution.historySummary')}</th>
                </tr>
              </thead>
              <tbody>
                {cronRuns.slice(0, 50).flatMap((entry, i) => {
                  const isExpanded = expandedRuns.has(i)
                  const summaryText = entry.error || entry.summary || ''
                  const rows = [
                    <tr
                      key={`${entry.jobId}-${entry.runAtMs}-${i}`}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setExpandedRuns(prev => {
                        const next = new Set(prev)
                        next.has(i) ? next.delete(i) : next.add(i)
                        return next
                      })}
                    >
                      <td className="p-3 text-white/70 font-mono whitespace-nowrap">
                        {entry.runAtMs ? new Date(entry.runAtMs).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="p-3 text-white/70 max-w-[160px] truncate">
                        {entry.jobName}
                      </td>
                      <td className="p-3">
                        {entry.status === 'ok' || entry.status === 'finished' ? (
                          <Badge className="text-[10px] border-green-400/40 text-green-400 bg-green-400/10">{t('execution.historyStatusDone')}</Badge>
                        ) : entry.status === 'error' ? (
                          <Badge className="text-[10px] border-red-400/40 text-red-400 bg-red-400/10">{t('execution.historyStatusFailed')}</Badge>
                        ) : (
                          <Badge className="text-[10px]" variant="outline">{entry.status}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-white/50 font-mono whitespace-nowrap">
                        {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(0)}s` : '—'}
                      </td>
                      <td className="p-3 text-white/50 font-mono whitespace-nowrap">
                        {entry.model || '—'}
                      </td>
                      <td className="p-3 text-white/40">
                        <div className="flex items-center gap-1.5">
                          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                          <span className={isExpanded ? '' : 'max-w-[280px] truncate block'}>
                            {summaryText || '—'}
                          </span>
                        </div>
                      </td>
                    </tr>,
                  ]
                  if (isExpanded) {
                    rows.push(
                      <tr key={`${entry.jobId}-${entry.runAtMs}-${i}-detail`} className="border-b border-white/[0.04] bg-white/[0.02]">
                        <td colSpan={6} className="px-4 py-3 space-y-2">
                          {entry.usage && (
                            <div className="flex items-center gap-4 text-[11px] font-mono">
                              <span className="text-cyan-400/70">{t('execution.tokens')}</span>
                              <span className="text-white/50">{t('execution.tokensInput')} <span className="text-white/70">{entry.usage.input_tokens?.toLocaleString()}</span></span>
                              <span className="text-white/50">{t('execution.tokensOutput')} <span className="text-white/70">{entry.usage.output_tokens?.toLocaleString()}</span></span>
                              <span className="text-white/50">{t('execution.tokensTotal')} <span className="text-white/70">{entry.usage.total_tokens?.toLocaleString()}</span></span>
                            </div>
                          )}
                          {summaryText && (
                            <pre className="text-xs text-white/60 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                              {summaryText}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )
                  }
                  return rows
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
