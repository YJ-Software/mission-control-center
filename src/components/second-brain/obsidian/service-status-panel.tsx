'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Play, Square, RotateCcw, Loader2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

interface ServiceStatus {
  name: string
  active: boolean
  pid?: number
  memoryMB?: number
  uptime?: string
}

const PRIMARY_SERVICES = ['obsidian', 'couchdb']
const HEADLESS_SERVICES = ['xvfb', 'openbox', 'x11vnc', 'websockify']

const SERVICE_LABELS: Record<string, string> = {
  obsidian: 'Obsidian',
  couchdb: 'CouchDB',
  xvfb: 'Xvfb',
  openbox: 'Openbox',
  x11vnc: 'x11vnc',
  websockify: 'Websockify',
}

function ServiceRow({
  service,
  onAction,
  isPending,
  t,
}: {
  service: ServiceStatus
  onAction: (name: string, action: string) => void
  isPending: boolean
  t: (key: string) => string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.03]">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${service.active ? 'bg-green-400' : 'bg-red-400/60'}`} />
        <span className="text-sm text-white/80 w-24">{SERVICE_LABELS[service.name] ?? service.name}</span>
        {service.active && service.memoryMB !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[11px] font-mono text-white/30 cursor-default">{service.memoryMB} MB</span>
            </TooltipTrigger>
            <TooltipContent>{t('memoryTooltip')}</TooltipContent>
          </Tooltip>
        )}
        {service.active && service.uptime && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[11px] font-mono text-white/30 cursor-default">{service.uptime}</span>
            </TooltipTrigger>
            <TooltipContent>{t('uptimeTooltip')}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onAction(service.name, 'start')} disabled={service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-green-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('start')}>
          <Play className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onAction(service.name, 'stop')} disabled={!service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('stop')}>
          <Square className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onAction(service.name, 'restart')} disabled={!service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('restart')}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function ServiceStatusPanel() {
  const t = useTranslations('secondBrain.obsidian.services')
  const queryClient = useQueryClient()

  const { data: statuses = [], isLoading } = useQuery<ServiceStatus[]>({
    queryKey: ['obsidian-services'],
    queryFn: () => fetch('/api/second-brain/obsidian/status').then(r => r.json()),
    refetchInterval: 5000,
  })

  const actionMutation = useMutation({
    mutationFn: async ({ name, action }: { name: string; action: string }) => {
      const res = await fetch('/api/second-brain/obsidian/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action }),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obsidian-services'] })
    },
  })

  const totalMemory = statuses.reduce((sum, s) => sum + (s.memoryMB ?? 0), 0)

  const primary = statuses.filter(s => PRIMARY_SERVICES.includes(s.name))
  const headless = statuses.filter(s => HEADLESS_SERVICES.includes(s.name))

  const handleAction = (name: string, action: string) => {
    actionMutation.mutate({ name, action })
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 flex items-center justify-center h-48">
        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
      </div>
    )
  }

  const allActive = statuses.length > 0 && statuses.every(s => s.active)
  const allInactive = statuses.length > 0 && statuses.every(s => !s.active)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white">{t('title')}</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleAction('all', 'start')}
              disabled={actionMutation.isPending || allActive}
              title={t('startAll')}
              className="p-1.5 rounded-md text-green-400/70 hover:text-green-300 hover:bg-green-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleAction('all', 'stop')}
              disabled={actionMutation.isPending || allInactive}
              title={t('stopAll')}
              className="p-1.5 rounded-md text-red-400/70 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleAction('all', 'restart')}
              disabled={actionMutation.isPending}
              title={t('restartAll')}
              className="p-1.5 rounded-md text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              {actionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Primary services */}
        <div className="space-y-1">
          {primary.map((service) => (
            <ServiceRow key={service.name} service={service} onAction={handleAction} isPending={actionMutation.isPending} t={t} />
          ))}
        </div>

        {/* Separator */}
        {headless.length > 0 && (
          <div className="my-2.5 flex items-center gap-2">
            <div className="flex-1 border-t border-white/[0.06]" />
            <span className="text-[10px] font-mono text-white/20 uppercase tracking-wider">{t('headlessDeps')}</span>
            <div className="flex-1 border-t border-white/[0.06]" />
          </div>
        )}

        {/* Headless dependency services */}
        <div className="space-y-1">
          {headless.map((service) => (
            <ServiceRow key={service.name} service={service} onAction={handleAction} isPending={actionMutation.isPending} t={t} />
          ))}
        </div>

        {totalMemory > 0 && (
          <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-white/30 font-mono">
            {t('totalMemory')}: {totalMemory} MB
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
