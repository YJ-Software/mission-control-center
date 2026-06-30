'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Play, Square, RotateCcw, Loader2, ArrowUpCircle, Puzzle, Copy, Check, ExternalLink } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

interface ServiceStatus {
  name: string
  unit: string
  active: boolean
  pid?: number
  memoryMB?: number
  uptime?: string
}

interface OpencliVersionInfo {
  installed: string | null
  latest: string | null
  updateAvailable: boolean
  extensionLoaded: boolean
  extensionFilePresent: boolean
  extensionPath: string
  needsManualInstall: boolean
}

const PRIMARY_SERVICE = 'chrome-headless'

const SERVICE_LABELS: Record<string, string> = {
  'chrome-headless': 'Chrome',
  'xvfb-chrome': 'Xvfb',
  'openbox-chrome': 'Openbox',
  'fcitx5-chrome': 'Fcitx5 新酷音',
  'x11vnc-chrome': 'x11vnc',
  'websockify-chrome': 'Websockify',
  'opencli-daemon': 'OpenCLI',
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
        <span className="text-sm text-white/80 w-24">{SERVICE_LABELS[service.unit.replace('.service', '')] ?? service.name}</span>
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
        <button onClick={() => onAction(service.unit.replace('.service', ''), 'start')} disabled={service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-green-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('start')}>
          <Play className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onAction(service.unit.replace('.service', ''), 'stop')} disabled={!service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('stop')}>
          <Square className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onAction(service.unit.replace('.service', ''), 'restart')} disabled={!service.active || isPending} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title={t('restart')}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function ExtensionSetupBanner({ info, t }: { info: OpencliVersionInfo; t: (key: string) => string }) {
  const [copied, setCopied] = useState(false)

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(info.extensionPath)
    } catch {
      // Fallback for non-HTTPS (e.g. VNC browser)
      const textarea = document.createElement('textarea')
      textarea.value = info.extensionPath
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3">
        <div className="flex items-start gap-2.5">
          <Puzzle className="w-4 h-4 text-amber-400/70 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-200/80 font-medium">{t('extensionNotLoaded')}</p>
            <p className="text-[11px] text-white/40 mt-1 leading-relaxed">{t('extensionManualSteps')}</p>
            <ol className="text-[11px] text-white/50 mt-2 space-y-1.5 list-decimal list-inside">
              <li>
                {t('extensionStep1')}
                <button
                  onClick={() => window.open('chrome://extensions', '_blank')}
                  className="ml-1 inline-flex items-center gap-0.5 text-cyan-400/70 hover:text-cyan-300 transition-colors"
                >
                  chrome://extensions <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </li>
              <li>{t('extensionStep2')}</li>
              <li className="flex items-start gap-1 flex-wrap">
                <span>{t('extensionStep3')}</span>
                <span className="inline-flex items-center gap-1 bg-white/[0.06] rounded px-1.5 py-0.5 font-mono text-[10px] text-white/60 max-w-full">
                  <span className="truncate">{info.extensionPath}</span>
                  <button onClick={copyPath} className="shrink-0 p-0.5 hover:text-white/80 transition-colors" title="Copy">
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ServiceStatusPanel() {
  const t = useTranslations('browser.services')
  const queryClient = useQueryClient()
  const router = useRouter()

  const { data: statuses = [], isLoading } = useQuery<ServiceStatus[]>({
    queryKey: ['browser-services'],
    queryFn: () => fetch('/api/browser/status').then(r => r.json()),
    refetchInterval: 5000,
  })

  const { data: opencliInfo } = useQuery<OpencliVersionInfo>({
    queryKey: ['opencli-version'],
    queryFn: () => fetch('/api/browser/opencli').then(r => r.json()),
    staleTime: 30_000, // 30s — re-check extension status reasonably often
    refetchInterval: 30_000,
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/browser/opencli', {
        method: 'POST',
        headers: { 'x-triggered-by': 'settings-card' },
      })
      return res.json() as Promise<{ ok: boolean; jobId?: string }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['opencli-version'] })
      queryClient.invalidateQueries({ queryKey: ['browser-services'] })
      // The upgrade now runs as a background job — follow it in /system-log.
      if (data?.jobId) router.push(`/system-log?job=${data.jobId}`)
    },
  })

  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/browser/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'opencli' }),
      })
      if (!res.ok) throw new Error('Install failed')
      // Read SSE stream to completion
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'error') throw new Error(event.data)
          } catch (e) {
            if (e instanceof Error && e.message !== line.slice(6)) throw e
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencli-version'] })
      queryClient.invalidateQueries({ queryKey: ['browser-services'] })
    },
  })

  const actionMutation = useMutation({
    mutationFn: async ({ name, action }: { name: string; action: string }) => {
      const res = await fetch('/api/browser/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action }),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['browser-services'] })
    },
  })

  const totalMemory = statuses.reduce((sum, s) => sum + (s.memoryMB ?? 0), 0)

  const primary = statuses.filter(s => s.unit === `${PRIMARY_SERVICE}.service`)
  const headless = statuses.filter(s => s.unit !== `${PRIMARY_SERVICE}.service`)

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

  // Show extension banner when: opencli installed, extension files present, needs manual install, not yet loaded
  const showExtensionBanner = opencliInfo?.installed
    && opencliInfo.extensionFilePresent
    && opencliInfo.needsManualInstall
    && !opencliInfo.extensionLoaded

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

        {/* Primary service */}
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
          <div className="mt-2 text-xs text-white/30 font-mono">
            {t('totalMemory')}: {totalMemory} MB
          </div>
        )}

        {/* OpenCLI: not installed */}
        {opencliInfo && !opencliInfo.installed && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/60 font-medium">{t('opencliNotInstalled')}</p>
                <p className="text-[11px] text-white/30 mt-0.5">{t('opencliNotInstalledDesc')}</p>
              </div>
              <button
                onClick={() => installMutation.mutate()}
                disabled={installMutation.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium
                  bg-cyan-500/15 text-cyan-400/80 hover:bg-cyan-500/25 hover:text-cyan-300
                  border border-cyan-500/20 transition-colors disabled:opacity-40 shrink-0 ml-3"
              >
                {installMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowUpCircle className="w-3 h-3" />
                )}
                {installMutation.isPending ? t('opencliInstalling') : t('opencliInstall')}
              </button>
            </div>
          </div>
        )}

        {/* OpenCLI version info (when installed) */}
        {opencliInfo?.installed && (
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/40 font-mono">OpenCLI v{opencliInfo.installed}</span>
                {opencliInfo.extensionLoaded && (
                  <span className="text-[10px] text-green-400/70 font-mono">{t('extensionActive')}</span>
                )}
                {opencliInfo.updateAvailable && opencliInfo.latest && (
                  <span className="text-[10px] text-cyan-400/70 font-mono">→ v{opencliInfo.latest}</span>
                )}
              </div>
              {opencliInfo.updateAvailable && (
                <button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium
                    bg-cyan-500/15 text-cyan-400/80 hover:bg-cyan-500/25 hover:text-cyan-300
                    border border-cyan-500/20 transition-colors disabled:opacity-40"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="w-3 h-3" />
                  )}
                  {t('update')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Extension manual setup banner */}
        {showExtensionBanner && opencliInfo && (
          <ExtensionSetupBanner info={opencliInfo} t={t} />
        )}
      </div>
    </TooltipProvider>
  )
}
