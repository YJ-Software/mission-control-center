'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookOpen, Check, ExternalLink, Workflow, User, Package,
  ArrowUpCircle, RefreshCw, CheckCircle2, AlertTriangle, AlertCircle, Loader2, Clock,
} from 'lucide-react'

const REPO_URL = 'https://github.com/jacob-bd/notebooklm-mcp-cli'

interface NlmStatus {
  installed: boolean
  version?: string
  updateAvailable?: boolean
  upgradeInProgress?: boolean
}

interface UpgradeJob {
  id: string
  status: 'running' | 'restarting' | 'success' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt: string | null
}

export function NotebookLMAboutPanel() {
  const t = useTranslations('secondBrain.notebooklm.about')
  const queryClient = useQueryClient()

  const { data: status, isLoading, isRefetching } = useQuery<NlmStatus>({
    queryKey: ['nlm-status'],
    queryFn: async () => {
      const res = await fetch('/api/second-brain/notebooklm')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: history } = useQuery<{ jobs: UpgradeJob[] }>({
    queryKey: ['nlm-upgrade-history'],
    queryFn: async () => {
      const res = await fetch('/api/jobs?kind=upgrade-nlm&limit=10')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: 15000,
  })

  function recheck() {
    queryClient.invalidateQueries({ queryKey: ['nlm-status'] })
    queryClient.invalidateQueries({ queryKey: ['nlm-upgrade-history'] })
  }

  const capabilities = t.raw('capabilities') as string[]
  const upgradeJobs = history?.jobs ?? []
  const upToDate = status?.installed && !status?.updateAvailable && !status?.upgradeInProgress

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-cyan-500/[0.08] via-white/[0.02] to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-cyan-300" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">notebooklm-mcp-cli</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.06] text-white/50 border border-white/[0.08]">nlm</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">{t('tagline')}</p>
          </div>
        </div>
      </div>

      {/* Intro */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <p className="text-sm text-white/50 leading-relaxed">{t('intro')}</p>
      </div>

      {/* Version & updates */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
            <Package className="w-4 h-4 text-cyan-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('versionTitle')}</h3>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/30" />
            ) : !status?.installed ? (
              <span className="flex items-center gap-1.5 text-sm text-amber-300">
                <AlertTriangle className="w-4 h-4" /> {t('notInstalledShort')}
              </span>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-white/40">{t('versionInstalled')}</span>
                  <span className="text-sm font-mono text-white/90">
                    {status.version ? `v${status.version}` : t('versionUnknown')}
                  </span>
                </div>
                {status.upgradeInProgress ? (
                  <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">
                    <ArrowUpCircle className="w-3.5 h-3.5 animate-spin" /> {t('upgradingStatus')}
                  </span>
                ) : upToDate ? (
                  <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t('versionUpToDate')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/20">
                    <ArrowUpCircle className="w-3.5 h-3.5" /> {t('versionUpdateAvailable')}
                  </span>
                )}
              </>
            )}
          </div>

          <button
            onClick={recheck}
            disabled={isRefetching}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/60 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            {t('recheckBtn')}
          </button>
        </div>

        <p className="mt-3 text-xs text-white/40 leading-relaxed">{t('autoUpgradeNote')}</p>

        {/* Upgrade history */}
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-white/70">
              <Clock className="w-3.5 h-3.5 text-white/40" />
              {t('historyTitle')}
            </div>
            <a href="/system-log" className="inline-flex items-center gap-1 text-[11px] text-cyan-300/80 hover:text-cyan-200 transition-colors">
              {t('viewAllInSystemLog')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {upgradeJobs.length === 0 ? (
            <p className="text-xs text-white/30 py-1">{t('historyEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {upgradeJobs.map((job) => (
                <li key={job.id} className="flex items-center gap-2 text-xs py-1">
                  <UpgradeStatusIcon status={job.status} />
                  <span className="font-mono text-white/55">{new Date(job.startedAt).toLocaleString()}</span>
                  <span className="text-white/30">·</span>
                  <span className="text-white/45">{t('historyTriggerAuto')}</span>
                  <a
                    href={`/system-log?job=${job.id}`}
                    className="ml-auto inline-flex items-center gap-1 text-cyan-300/70 hover:text-cyan-200 transition-colors"
                  >
                    {t('viewInSystemLog')}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <h3 className="text-sm font-medium text-white mb-3">{t('capabilitiesTitle')}</h3>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {capabilities.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-white/50 leading-relaxed">
              <Check className="w-3.5 h-3.5 text-cyan-300/80 shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
            <Workflow className="w-4 h-4 text-cyan-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('howTitle')}</h3>
        </div>
        <p className="text-sm text-white/50 leading-relaxed">{t('howBody')}</p>
      </div>

      {/* Author */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <User className="w-4 h-4 text-cyan-300/90" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white mb-1.5">{t('authorTitle')}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{t('authorBody')}</p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:text-cyan-200 transition-colors"
            >
              {t('repoLink')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function UpgradeStatusIcon({ status }: { status: UpgradeJob['status'] }) {
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
  if (status === 'running' || status === 'restarting') return <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
  return <Clock className="w-3.5 h-3.5 text-white/30 shrink-0" />
}
