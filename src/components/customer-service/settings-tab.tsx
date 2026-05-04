'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Bot, Settings as SettingsIcon, Info, ArrowUpRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

interface AgentInfo {
  id: string
  name?: string
  workspace?: string
  model?: { primary?: string }
  bindings?: Array<{ channel?: string }>
}

interface AgentsResponse {
  agents: AgentInfo[]
  active?: string
}

type DetectionRule = 'line-binding' | 'non-main' | 'first' | 'none'

export function SettingsTab() {
  const t = useTranslations('customerService.settings')
  const { data } = useQuery<AgentsResponse>({
    queryKey: ['cs-agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const { data: bindingsData } = useQuery<{ bindings: Array<{ agentId: string; channel: string }>; lineAgentId: string | null }>({
    queryKey: ['cs-bindings'],
    queryFn: async () => {
      const res = await fetch('/api/customer-service/bindings')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const agents = data?.agents ?? []
  // Pick agent the LINE channel is bound to (read from openclaw.json bindings).
  // Fallback: first non-main agent. Fallback again: first agent.
  // No hardcoded id.
  const lineBoundId = bindingsData?.lineAgentId ?? null
  const lineBound = lineBoundId ? agents.find((a) => a.id === lineBoundId) : undefined
  const nonMain = agents.find((a) => a.id !== 'main')
  const activeAgent = lineBound ?? nonMain ?? agents[0]
  const rule: DetectionRule = lineBound
    ? 'line-binding'
    : nonMain
      ? 'non-main'
      : activeAgent
        ? 'first'
        : 'none'

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="cyber-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <SettingsIcon className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('description')}</p>
      </div>

      <div className="cyber-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('agents.title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-2">{t('agents.description')}</p>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 mb-4">
          <div className="flex items-start gap-2 text-[11px] text-white/55 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-white/70 font-medium mb-0.5">{t('agents.detection.title')}</div>
              <div>{t(`agents.detection.${rule}`)}</div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {agents.map((agent) => {
            const isActive = activeAgent?.id === agent.id
            return (
              <Link
                key={agent.id}
                href={`/agents?agent=${encodeURIComponent(agent.id)}`}
                className={`group flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                  isActive
                    ? 'border-cyan-500/30 bg-cyan-500/[0.04] hover:bg-cyan-500/[0.08]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div>
                  <div className="text-sm text-white/90 flex items-center gap-1.5">
                    {agent.name ?? agent.id}
                    <ArrowUpRight className="w-3 h-3 text-white/30 group-hover:text-white/70 transition-colors" />
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {agent.id} · {agent.model?.primary ?? '—'}
                  </div>
                </div>
                {isActive && (
                  <span className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">
                    {t('agents.active')}
                  </span>
                )}
              </Link>
            )
          })}
          {agents.length === 0 && (
            <div className="text-xs text-white/40">{t('agents.empty')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
