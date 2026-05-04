'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Box, HardDrive, BarChart3, RefreshCw, Trash2 } from 'lucide-react'

interface Container {
  Names: string
  Image: string
  Status: string
  State: string
  Ports: string
}

interface DockerImage {
  Repository: string
  Tag: string
  Size: string
}

interface DockerData {
  containers: Container[]
  images: DockerImage[]
  system: string
}

function ActionButton({ onClick, variant, children }: {
  onClick: () => void
  variant: 'danger' | 'warn' | 'success' | 'default'
  children: React.ReactNode
}) {
  const colors = {
    danger: 'text-red-400 hover:bg-red-400/10 border-red-400/20',
    warn: 'text-yellow-400 hover:bg-yellow-400/10 border-yellow-400/20',
    success: 'text-green-400 hover:bg-green-400/10 border-green-400/20',
    default: 'text-white/60 hover:bg-white/[0.06] border-white/[0.1]',
  }
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${colors[variant]}`}
    >
      {children}
    </button>
  )
}

export function DockerContent() {
  const t = useTranslations('docker')
  const queryClient = useQueryClient()
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const { data, isLoading } = useQuery<DockerData>({
    queryKey: ['docker'],
    queryFn: () => fetch('/api/docker').then(r => r.json()),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['docker'] })

  const dockerAction = async (action: string, id?: string) => {
    const label = action === 'prune-containers' ? t('pruneStoppedConfirm')
      : action === 'prune-images' ? t('pruneUnusedConfirm')
      : `${action} ${id}?`
    if (!confirm(label)) return

    setActionInProgress(action + (id || ''))
    try {
      const res = await fetch('/api/docker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      const result = await res.json()
      if (result.error) alert('Error: ' + result.error)
      refresh()
    } catch (e) {
      alert('Error: ' + (e as Error).message)
    } finally {
      setActionInProgress(null)
    }
  }

  const containers = data?.containers || []
  const images = data?.images || []
  const system = data?.system || ''

  return (
    <div className="p-6 space-y-5">
      {/* Containers */}
      <div className="cyber-card animate-slide-in">
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white/80">{t('containers')}</span>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton variant="danger" onClick={() => dockerAction('prune-containers')}>
              <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" /> {t('pruneStopped')}</span>
            </ActionButton>
            <ActionButton variant="default" onClick={refresh}>
              <span className="flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} /> {t('refresh')}</span>
            </ActionButton>
          </div>
        </div>
        <div className="p-3 overflow-x-auto">
          {isLoading ? (
            <div className="text-white/25 font-mono text-xs p-4">{t('loading')}</div>
          ) : containers.length === 0 ? (
            <div className="text-white/25 font-mono text-xs p-4 text-center">{t('noContainers')}</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('name')}</th>
                  <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('image')}</th>
                  <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('status')}</th>
                  <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('ports')}</th>
                  <th className="p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c, i) => {
                  const running = c.State === 'running'
                  return (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="p-2 font-mono text-white/80">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} />
                        {c.Names}
                      </td>
                      <td className="p-2 font-mono text-white/50 max-w-[200px] truncate">{c.Image}</td>
                      <td className="p-2 text-white/50">{c.Status}</td>
                      <td className="p-2 text-white/30 text-[11px]">{c.Ports || '-'}</td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {running ? (
                            <>
                              <ActionButton variant="danger" onClick={() => dockerAction('stop', c.Names)}>
                                {actionInProgress === 'stop' + c.Names ? '...' : t('stop')}
                              </ActionButton>
                              <ActionButton variant="warn" onClick={() => dockerAction('restart', c.Names)}>
                                {actionInProgress === 'restart' + c.Names ? '...' : t('restart')}
                              </ActionButton>
                            </>
                          ) : (
                            <ActionButton variant="success" onClick={() => dockerAction('start', c.Names)}>
                              {actionInProgress === 'start' + c.Names ? '...' : t('start')}
                            </ActionButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Images */}
        <div className="cyber-card animate-slide-in delay-100">
          <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white/80">{t('images')}</span>
            </div>
            <ActionButton variant="danger" onClick={() => dockerAction('prune-images')}>
              <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" /> {t('pruneUnused')}</span>
            </ActionButton>
          </div>
          <div className="p-3 overflow-x-auto">
            {images.length === 0 ? (
              <div className="text-white/25 font-mono text-xs p-4 text-center">{t('noImages')}</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('repository')}</th>
                    <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('tag')}</th>
                    <th className="text-left p-2 text-white/40 font-semibold uppercase tracking-wider text-[10px]">{t('size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {images.map((img, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="p-2 font-mono text-white/70">{img.Repository}</td>
                      <td className="p-2 font-mono text-white/50">{img.Tag}</td>
                      <td className="p-2 font-mono text-white/30">{img.Size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* System */}
        <div className="cyber-card animate-slide-in delay-200">
          <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white/80">{t('system')}</span>
          </div>
          <div className="p-4">
            <pre className="font-mono text-xs text-white/60 whitespace-pre-wrap max-h-[300px] overflow-y-auto leading-relaxed">
              {system || t('loading')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
