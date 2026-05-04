'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Archive, Database, Briefcase, Activity, AlertTriangle, Wand2 } from 'lucide-react'
import { BackupWizard } from './backup-wizard'

interface DashboardData {
  totalBackups: number
  totalUsage: string
  totalUsageBytes: number
  totalJobs: number
  queue: {
    pending: number
    processing: number
    completed: number
    failed: number
    canceled: number
  }
  scriptsAvailable: boolean
  scriptsMissing: string[]
  backupToken: string
}

export function BackupDashboard({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const t = useTranslations('backup')
  const [showWizard, setShowWizard] = useState(false)

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['backup-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/backup?type=dashboard')
      if (!res.ok) throw new Error('Failed to fetch backup dashboard')
      return res.json()
    },
    refetchInterval: 10000,
  })

  if (isLoading) {
    return <div className="text-white/50 text-sm font-mono p-4">載入中...</div>
  }

  if (isError || !data) {
    return <div className="text-red-400 text-sm font-mono p-4">發生錯誤</div>
  }

  return (
    <div className="space-y-4">
      {!data.scriptsAvailable && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t('dashboard.scriptsNotFound')} — {t('dashboard.scriptsNotFoundDesc')}</span>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Total Backups */}
        <div className="cyber-card p-4 cursor-pointer hover:border-cyan-500/30 transition-colors" onClick={() => onNavigate?.('restore')}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Archive className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="text-[11px] text-white/40 uppercase tracking-wider">{t('dashboard.totalBackups')}</div>
              <div className="text-xl font-bold text-white">{data.totalBackups}</div>
            </div>
          </div>
        </div>

        {/* Total Usage */}
        <div className="cyber-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="text-[11px] text-white/40 uppercase tracking-wider">{t('dashboard.totalUsage')}</div>
              <div className="text-xl font-bold text-white">{data.totalUsage}</div>
            </div>
          </div>
        </div>

        {/* Total Jobs */}
        <div className="cyber-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <div className="text-[11px] text-white/40 uppercase tracking-wider">{t('dashboard.totalJobs')}</div>
              <div className="text-xl font-bold text-white">{data.totalJobs}</div>
            </div>
          </div>
        </div>

        {/* Queue Summary */}
        <div className="cyber-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-white/40 uppercase tracking-wider mb-2">{t('dashboard.queueSummary')}</div>
              <div className="flex flex-wrap gap-1">
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-yellow-500/20 text-yellow-400">
                  {t('dashboard.pending')} {data.queue.pending}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/20 text-blue-400">
                  {t('dashboard.processing')} {data.queue.processing}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-green-500/20 text-green-400">
                  {t('dashboard.completed')} {data.queue.completed}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/20 text-red-400">
                  {t('dashboard.failed')} {data.queue.failed}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-white/10 text-white/40">
                  {t('dashboard.canceled')} {data.queue.canceled}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wizard */}
      {showWizard ? (
        <BackupWizard onClose={() => setShowWizard(false)} />
      ) : (
        <button
          onClick={() => setShowWizard(true)}
          className="w-full cyber-card p-4 flex items-center gap-4 hover:bg-white/[0.03] transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20 transition-colors">
            <Wand2 className="w-5 h-5 text-violet-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-white/80">{t('dashboard.wizard')}</div>
            <div className="text-[11px] text-white/40">{t('dashboard.wizardDesc')}</div>
          </div>
        </button>
      )}
    </div>
  )
}
