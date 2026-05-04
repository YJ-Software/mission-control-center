'use client'

import { useWebSocket } from '@/store/websocket'
import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SystemHealth } from './system-health'
import { CronJobsPanel } from './cron-jobs-panel'
import { ServicesPanel } from './services-panel'
import { RecentActivity } from './recent-activity'
import { QuickActions } from './quick-actions'
import { DailySpend } from './daily-spend'

function StatusDot({ status }: { status: string }) {
  const cls = ({
    active: 'status-dot-active', pending: 'status-dot-pending',
    error: 'status-dot-error', idle: 'status-dot-idle', system: 'status-dot-active',
  } as Record<string, string>)[status] || 'status-dot-idle'
  return <span className={cls} />
}

export function DashboardContent() {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const { agentStatuses } = useWebSocket()

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/agents').then(r => r.json()),
    refetchInterval: 30000,
  })

  const agents: { id: string; name: string; role: string }[] = (agentsData?.agents ?? []).map(
    (a: { id: string; name?: string; role?: string }) => ({
      id: a.id,
      name: (a.name || a.id).toUpperCase(),
      role: a.role || a.id,
    })
  )

  return (
    <div className="p-6 space-y-5">
      {/* System Health */}
      <SystemHealth />

      {/* Services + Tailscale */}
      <ServicesPanel />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Activity + Daily Spend */}
        <div className="lg:col-span-2 space-y-5">
          <RecentActivity />
          <DailySpend />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Agent status */}
          <div className="cyber-card animate-slide-in delay-300">
            <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white/80">{t('agents')}</span>
            </div>
            <div className="p-3 space-y-1">
              {agents.map(agent => {
                const status = agentStatuses[agent.id] || 'idle'
                const isActive = status === 'active'
                const isError = status === 'error'
                return (
                  <div key={agent.id}
                    className={`flex items-center justify-between px-2 py-2 rounded-lg transition-colors ${isActive ? 'bg-white/[0.04]' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot status={status} />
                      <div>
                        <p className="font-mono text-xs tracking-wide text-white/80">{agent.name}</p>
                        <p className="font-mono text-[10px] text-white/35">{agent.role}</p>
                      </div>
                    </div>
                    <span className={`font-mono text-[9px] tracking-widest px-2 py-0.5 rounded-md border ${
                      isActive
                        ? 'border-cyan-400/30 text-cyan-400 bg-cyan-400/10'
                        : isError
                        ? 'border-red-400/30 text-red-400 bg-red-400/10'
                        : 'border-white/[0.12] text-white/30'
                    }`}>
                      {isActive ? tc('run') : isError ? tc('err') : tc('idle')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cron Jobs */}
          <CronJobsPanel />
        </div>
      </div>

      {/* Quick Actions */}
      <QuickActions />
    </div>
  )
}
