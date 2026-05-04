'use client'

import { useQuery } from '@tanstack/react-query'
import { useWebSocket } from '@/store/websocket'
import { Bot, Clock, Code2, PenLine, Search, Settings2, Zap } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { useState } from 'react'
import { useLocale } from 'next-intl'

interface Agent {
  id: string
  name: string
  role: string
  group: string
  description: string
  lastActive: string | null
  status: string
}

const GROUP_ICONS = {
  operators: Settings2,
  developers: Code2,
  writers: PenLine,
  researchers: Search,
}

const GROUP_COLORS: Record<string, { accent: string; border: string; glowColor: string }> = {
  operators:   { accent: 'text-cyan-400',    border: 'border-cyan-400/25',    glowColor: 'rgba(0,200,255,0.15)' },
  developers:  { accent: 'text-emerald-400', border: 'border-emerald-400/25', glowColor: 'rgba(52,211,153,0.15)' },
  writers:     { accent: 'text-purple-400',  border: 'border-purple-400/25',  glowColor: 'rgba(157,122,255,0.15)' },
  researchers: { accent: 'text-yellow-400',  border: 'border-yellow-400/25',  glowColor: 'rgba(250,204,21,0.15)' },
}

const GROUP_LABELS: Record<string, string> = {
  operators: 'Operators',
  developers: 'Developers',
  writers: 'Writers',
  researchers: 'Researchers',
}

function AgentCard({ agent, wsStatus }: { agent: Agent; wsStatus: string }) {
  const status = wsStatus || agent.status || 'idle'
  const [expanded, setExpanded] = useState(false)
  const isActive = status === 'active'
  const isError = status === 'error'
  const col = GROUP_COLORS[agent.group] || GROUP_COLORS.operators
  const GroupIcon = GROUP_ICONS[agent.group as keyof typeof GROUP_ICONS] || Bot

  return (
    <div
      className={`cyber-card cursor-pointer transition-all duration-200`}
      style={expanded ? { boxShadow: `0 8px 40px rgba(0,0,0,0.5), 0 0 20px ${col.glowColor}` } : undefined}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          <div className="shrink-0 relative w-10 h-10 flex items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08]">
            <GroupIcon className={`w-4 h-4 ${isActive ? col.accent : 'text-white/30'}`} />
            <div className="absolute -top-1 -right-1">
              <span className={
                status === 'active' ? 'status-dot-active' :
                status === 'error' ? 'status-dot-error' :
                'status-dot-idle'
              } />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={`text-sm font-semibold tracking-wide ${isActive ? col.accent : 'text-white/80'}`}>
                {agent.name}
              </span>
              <span className={`font-mono text-[9px] tracking-widests px-2 py-0.5 rounded border ${
                isActive ? `${col.border} ${col.accent} bg-white/[0.05]` :
                isError ? 'border-red-400/25 text-red-400/70' :
                'border-white/[0.1] text-white/30'
              }`}>
                {isActive ? 'ACTIVE' : isError ? 'ERROR' : 'IDLE'}
              </span>
            </div>
            <p className="font-mono text-[10px] text-white/35 tracking-wide">{agent.role}</p>
            {agent.description && (
              <p className="text-xs text-white/45 mt-1 line-clamp-2">{agent.description}</p>
            )}
            {agent.lastActive && (
              <div className="flex items-center gap-1 mt-2">
                <Clock className="w-2.5 h-2.5 text-white/20" />
                <span className="font-mono text-[9px] text-white/25 tracking-widests">
                  {formatRelativeTime(new Date(agent.lastActive))}
                </span>
              </div>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
            <div>
              <p className="font-mono text-[9px] text-white/30 tracking-[0.2em] mb-1">AGENT ID</p>
              <code className={`font-mono text-[10px] ${col.accent} tracking-wide`}>{agent.id}</code>
            </div>
            <div>
              <p className="font-mono text-[9px] text-white/30 tracking-[0.2em] mb-1">CLUSTER</p>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${col.border} ${col.accent} tracking-widests`}>
                {GROUP_LABELS[agent.group] || agent.group}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function AITeamView() {
  const locale = useLocale()
  const { agentStatuses, connected } = useWebSocket()
  const { data, isLoading } = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/agents').then(r => r.json()),
    refetchInterval: 30000,
  })

  const agents = data?.agents || []
  const groups = ['operators', 'developers', 'writers', 'researchers']
  const agentsByGroup = groups.reduce((acc, group) => {
    acc[group] = agents.filter(a => a.group === group)
    return acc
  }, {} as Record<string, Agent[]>)
  const activeCount = agents.filter(a => agentStatuses[a.id] === 'active').length

  return (
    <div className="p-6 space-y-6">
      {/* Summary bar */}
      <div className="cyber-card p-5 flex items-center gap-6 animate-slide-in">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-400/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <p className="font-mono text-[10px] text-white/35 tracking-wide">TOTAL AGENTS</p>
            <p className="text-2xl font-bold text-cyan-400">{agents.length}</p>
          </div>
        </div>
        <div className="w-px h-8 bg-white/[0.08]" />
        <div className="flex items-center gap-3">
          <span className="status-dot-active" />
          <div>
            <p className="font-mono text-[10px] text-white/35 tracking-wide">ACTIVE</p>
            <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
          </div>
        </div>
        <div className="w-px h-8 bg-white/[0.08]" />
        <div className="flex items-center gap-3">
          <span className={connected ? 'status-dot-active' : 'status-dot-error'} />
          <div>
            <p className="font-mono text-[10px] text-white/35 tracking-wide">GATEWAY</p>
            <p className={`font-mono text-sm tracking-widests ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
              {connected ? 'LINKED' : 'OFFLINE'}
            </p>
          </div>
        </div>
      </div>

      {/* Agent groups */}
      {groups.map((group, gi) => {
        const groupAgents = agentsByGroup[group] || []
        if (groupAgents.length === 0) return null
        const col = GROUP_COLORS[group]
        const GroupIcon = GROUP_ICONS[group as keyof typeof GROUP_ICONS] || Bot

        return (
          <div key={group} className="animate-slide-in" style={{ animationDelay: `${(gi + 1) * 100}ms` }}>
            <div className="flex items-center gap-3 mb-3">
              <GroupIcon className={`w-4 h-4 ${col.accent}`} />
              <span className={`text-sm font-semibold tracking-wide ${col.accent}`}>
                {GROUP_LABELS[group]}
              </span>
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="font-mono text-[10px] text-white/25 tracking-widests">
                {groupAgents.length} units
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {groupAgents.map(agent => (
                <AgentCard key={agent.id} agent={agent} wsStatus={agentStatuses[agent.id]} />
              ))}
            </div>
          </div>
        )
      })}

      {isLoading && (
        <div className="flex items-center justify-center h-48 gap-3">
          <Bot className="w-4 h-4 text-cyan-400/50 animate-pulse" />
          <span className="font-mono text-[10px] text-white/20 tracking-[0.3em] typewriter">LOADING AGENTS</span>
        </div>
      )}
    </div>
  )
}
