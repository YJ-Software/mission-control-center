'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Server, Globe, ArrowUpCircle, Loader2 } from 'lucide-react'
import type { ServiceInfo, TailscaleInfo, OpencliVersionInfo } from '@/lib/services-status'

function ServiceDot({ active }: { active: boolean | null }) {
  if (active === null) return <span className="w-2.5 h-2.5 rounded-full bg-white/20 shrink-0" />
  if (active) return <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)] shrink-0" />
  return <span className="w-2.5 h-2.5 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)] shrink-0" />
}

function StatusText({ active }: { active: boolean | null }) {
  if (active === null) return <span className="font-mono text-[11px] text-white/30">N/A</span>
  if (active) return <span className="font-mono text-[11px] text-emerald-400 font-semibold">Running</span>
  return <span className="font-mono text-[11px] text-red-400 font-semibold">Stopped</span>
}

export function ServicesPanel() {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [upgrading, setUpgrading] = useState(false)

  const { data } = useQuery<{ services: ServiceInfo[]; tailscale: TailscaleInfo; opencliVersion?: OpencliVersionInfo }>({
    queryKey: ['services-status'],
    queryFn: () => fetch('/api/services').then(r => r.json()),
    refetchInterval: 30000,
  })

  const services = data?.services ?? []
  const ts = data?.tailscale
  const opencli = data?.opencliVersion

  // Upgrade opencli via the shared job runner, then follow it in /system-log.
  const upgradeOpencli = useMutation({
    mutationFn: async () => {
      setUpgrading(true)
      const res = await fetch('/api/browser/opencli', {
        method: 'POST',
        headers: { 'x-triggered-by': 'quick-action' },
      })
      return res.json() as Promise<{ ok: boolean; jobId?: string }>
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['services-status'] })
      if (d?.jobId) router.push(`/system-log?job=${d.jobId}`)
    },
    onSettled: () => setUpgrading(false),
  })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Services Status */}
      <div className="cyber-card animate-slide-in delay-300">
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white/80">{t('servicesStatus')}</span>
        </div>
        <div className="p-3">
          {services.length === 0 ? (
            <div className="py-4 text-center">
              <span className="font-mono text-[10px] text-white/20 tracking-widest">LOADING...</span>
            </div>
          ) : (
            services.map((svc, i) => (
              <div
                key={svc.name}
                className={`flex items-center gap-3 py-3 ${i < services.length - 1 ? 'border-b border-white/[0.05]' : ''}`}
              >
                <ServiceDot active={svc.active} />
                <div className="flex-1 min-w-0 flex items-center">
                  <span className="text-[13px] font-semibold text-white/80">{svc.name}</span>
                  {svc.version && (
                    <span className="ml-2 font-mono text-[11px] text-white/30">v{svc.version}</span>
                  )}
                  {svc.name === 'opencli' && opencli?.updateAvailable && opencli.latest && (
                    <button
                      onClick={() => upgradeOpencli.mutate()}
                      disabled={upgrading}
                      title={t('opencliUpgradeTooltip')}
                      className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium
                        bg-cyan-500/15 text-cyan-300/90 hover:bg-cyan-500/25 border border-cyan-500/20
                        transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      {upgrading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                      → v{opencli.latest}
                    </button>
                  )}
                </div>
                <StatusText active={svc.active} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tailscale Status */}
      <div className="cyber-card animate-slide-in delay-400">
        <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white/80">{t('tailscaleStatus')}</span>
        </div>
        <div className="p-3">
          {!ts ? (
            <div className="py-4 text-center">
              <span className="font-mono text-[10px] text-white/20 tracking-widest">LOADING...</span>
            </div>
          ) : ts.error ? (
            <div className="py-4 text-center">
              <span className="font-mono text-[11px] text-white/30">{ts.error}</span>
            </div>
          ) : (
            <div className="space-y-0">
              <div className="flex justify-between items-center py-2.5 border-b border-white/[0.05]">
                <span className="text-[13px] text-white/40">Status</span>
                <span className={`font-semibold text-[13px] ${ts.online ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ts.online ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-white/[0.05]">
                <span className="text-[13px] text-white/40">Device</span>
                <span className="font-mono text-[13px] text-white/80">{ts.hostname}</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-white/[0.05]">
                <span className="text-[13px] text-white/40">Tailnet IP</span>
                <span className="font-mono text-[13px] text-white/80">{ts.ip}</span>
              </div>
              <div className="flex justify-between items-center py-2.5">
                <span className="text-[13px] text-white/40">Connected Peers</span>
                <span className="font-semibold text-[13px] text-white/80">{ts.peers}</span>
              </div>
              {ts.routes && ts.routes.length > 0 && (
                <div className="pt-3 mt-1 border-t border-white/[0.05]">
                  <span className="font-mono text-[10px] text-white/30 uppercase tracking-widest">Active Routes</span>
                  {ts.routes.map((r, i) => (
                    <div key={i} className="font-mono text-[11px] text-white/50 mt-1">{r}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
