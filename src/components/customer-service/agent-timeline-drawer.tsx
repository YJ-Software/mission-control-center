'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Clock, ChevronDown, ChevronRight, Brain, MessageSquare, Wrench, AlertTriangle,
  CheckCircle2, Bot, User as UserIcon, Loader2,
} from 'lucide-react'

interface AgentSessionSummary {
  agentId: string
  sessionId: string
  startedAt: number | null
  updatedAt: number | null
  lastInteractionAt: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  exists: boolean
  hasUndelivered: boolean
}

interface TimelineEvent {
  ts: number
  kind:
    | 'user' | 'assistant_thinking' | 'assistant_text'
    | 'tool_call' | 'tool_result' | 'session_start' | 'session_end' | 'meta'
  text?: string
  toolName?: string
  toolArgs?: string
  isError?: boolean
  delivered?: boolean
  stopReason?: string
}

interface AgentSessionTimeline {
  agentId: string
  sessionId: string
  events: TimelineEvent[]
  hasUndelivered: boolean
}

interface Props {
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const fmtTime = (sec: number | null) => {
  if (!sec) return '—'
  const d = new Date(sec * 1000)
  return d.toLocaleString('zh-TW', { hour12: false })
}
const fmtClock = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

export function AgentTimelineDrawer({ userId, open, onOpenChange }: Props) {
  const t = useTranslations('customerService.agentTimeline')

  const { data, isLoading } = useQuery<{ sessions: AgentSessionSummary[] }>({
    queryKey: ['cs-agent-sessions', userId],
    queryFn: () => fetch(`/api/customer-service/agent-sessions?userId=${encodeURIComponent(userId)}`).then(r => r.json()),
    enabled: open,
  })

  const sessions = data?.sessions ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden bg-zinc-950 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-white/90">
            <Clock className="w-4 h-4 text-cyan-400" />
            {t('title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-white/50 text-sm py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('loading')}
            </div>
          )}
          {!isLoading && sessions.length === 0 && (
            <p className="text-white/40 text-sm py-8 text-center">{t('noSessions')}</p>
          )}
          {sessions.map(s => (
            <SessionRow key={`${s.agentId}/${s.sessionId}`} session={s} userId={userId} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SessionRow({ session, userId }: { session: AgentSessionSummary; userId: string }) {
  const t = useTranslations('customerService.agentTimeline')
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery<AgentSessionTimeline>({
    queryKey: ['cs-agent-session-timeline', session.agentId, session.sessionId, userId],
    queryFn: () => fetch(
      `/api/customer-service/agent-sessions/${encodeURIComponent(session.sessionId)}` +
      `?userId=${encodeURIComponent(userId)}&agentId=${encodeURIComponent(session.agentId)}`,
    ).then(r => r.json()),
    enabled: open && session.exists,
  })

  const undelivered = data?.hasUndelivered ?? false
  const eventCount = data?.events.length ?? null

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/[0.03] text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 mt-0.5 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-white/40 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-white/80 font-mono text-xs">{session.sessionId.slice(0, 8)}</span>
            <span className="text-white/55 text-xs">·</span>
            <span className="text-white/60 text-xs">{fmtTime(session.updatedAt)}</span>
            {!session.exists && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/40 text-white/40">{t('pruned')}</span>
            )}
            {undelivered && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3" />
                {t('hasUndelivered')}
              </span>
            )}
            {eventCount !== null && (
              <span className="text-[10px] text-white/35 font-mono">{eventCount} events</span>
            )}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5 font-mono">
            {t('agent')}: {session.agentId}
            {session.totalTokens ? ` · ${session.totalTokens.toLocaleString()} tok` : ''}
            {session.estimatedCostUsd ? ` · $${session.estimatedCostUsd.toFixed(4)}` : ''}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-3 py-3 space-y-2 bg-zinc-900/40">
          {!session.exists && (
            <p className="text-white/40 text-xs">{t('prunedHint')}</p>
          )}
          {session.exists && isLoading && (
            <div className="flex items-center gap-2 text-white/50 text-xs py-3 justify-center">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('loading')}
            </div>
          )}
          {data?.events.map((ev, i) => <EventRow key={i} ev={ev} />)}
        </div>
      )}
    </div>
  )
}

function EventRow({ ev }: { ev: TimelineEvent }) {
  const t = useTranslations('customerService.agentTimeline')
  const [thinkingOpen, setThinkingOpen] = useState(false)

  const clock = fmtClock(ev.ts)

  if (ev.kind === 'user') {
    return (
      <div className="flex gap-2 items-start text-xs">
        <span className="text-white/30 font-mono shrink-0 w-16">{clock}</span>
        <UserIcon className="w-3.5 h-3.5 mt-0.5 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0 text-white/85 whitespace-pre-wrap break-words bg-blue-500/[0.06] rounded-md px-2 py-1.5">
          {ev.text}
        </div>
      </div>
    )
  }

  if (ev.kind === 'assistant_thinking') {
    return (
      <div className="flex gap-2 items-start text-xs">
        <span className="text-white/30 font-mono shrink-0 w-16">{clock}</span>
        <Brain className="w-3.5 h-3.5 mt-0.5 text-purple-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <button onClick={() => setThinkingOpen(o => !o)} className="text-white/45 hover:text-white/70 italic text-[11px]">
            {thinkingOpen ? '▼' : '▶'} {t('thinking')}
          </button>
          {thinkingOpen && (
            <div className="mt-1 text-white/55 whitespace-pre-wrap break-words bg-purple-500/[0.05] rounded-md px-2 py-1.5 text-[11px]">
              {ev.text}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (ev.kind === 'assistant_text') {
    return (
      <div className="flex gap-2 items-start text-xs">
        <span className="text-white/30 font-mono shrink-0 w-16">{clock}</span>
        <Bot className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {ev.delivered ? (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                <CheckCircle2 className="w-3 h-3" />
                {t('delivered')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3" />
                {t('notDelivered')}
              </span>
            )}
            {ev.stopReason && (
              <span className="text-[10px] text-white/40 font-mono">stop={ev.stopReason}</span>
            )}
          </div>
          <div className="text-white/85 whitespace-pre-wrap break-words bg-emerald-500/[0.06] rounded-md px-2 py-1.5">
            {ev.text}
          </div>
        </div>
      </div>
    )
  }

  if (ev.kind === 'tool_call') {
    return (
      <div className="flex gap-2 items-start text-xs">
        <span className="text-white/30 font-mono shrink-0 w-16">{clock}</span>
        <Wrench className="w-3.5 h-3.5 mt-0.5 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-cyan-300 font-mono text-[11px]">{ev.toolName}</span>
          {ev.toolArgs && (
            <span className="text-white/50 font-mono text-[11px]"> {ev.toolArgs}</span>
          )}
        </div>
      </div>
    )
  }

  if (ev.kind === 'tool_result') {
    return (
      <div className="flex gap-2 items-start text-xs">
        <span className="text-white/30 font-mono shrink-0 w-16">{clock}</span>
        <MessageSquare className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${ev.isError ? 'text-red-400' : 'text-white/40'}`} />
        <div className="flex-1 min-w-0">
          <span className="text-white/45 text-[11px]">← {ev.toolName}{ev.isError ? ' ⚠️' : ''}</span>
          <div className="text-white/50 whitespace-pre-wrap break-words text-[11px] mt-0.5 font-mono">
            {ev.text}
          </div>
        </div>
      </div>
    )
  }

  if (ev.kind === 'session_start' || ev.kind === 'session_end') {
    return (
      <div className="flex gap-2 items-start text-xs text-white/35">
        <span className="font-mono shrink-0 w-16">{clock}</span>
        <span className="text-[11px]">— {ev.text} —</span>
      </div>
    )
  }

  return null
}
