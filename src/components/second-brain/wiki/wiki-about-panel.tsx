'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import {
  Network, FileSearch, GitBranch, ShieldQuestion, Users,
  Upload, RefreshCw, Combine, Search, ChevronRight, Info,
} from 'lucide-react'
import { WikiPurposeSwitch } from '@/components/wiki/wiki-purpose-switch'

export function WikiAboutPanel() {
  const t = useTranslations('secondBrain.wiki.about')

  const pillars = [
    { icon: FileSearch, title: t('claimsTitle'), body: t('claimsBody') },
    { icon: GitBranch, title: t('compiledTitle'), body: t('compiledBody') },
    { icon: ShieldQuestion, title: t('provenanceTitle'), body: t('provenanceBody') },
  ]

  const flowSteps = [
    { key: 'ingest', icon: Upload, label: t('ingestLabel'), sub: t('ingestSub'), desc: t('ingestDesc'), tag: t('ingestTag'), auto: false },
    { key: 'compile', icon: RefreshCw, label: t('compileLabel'), sub: t('compileSub'), desc: t('compileDesc'), tag: t('compileTag'), auto: true },
    { key: 'synthesis', icon: Combine, label: t('synthesisLabel'), sub: t('synthesisSub'), desc: t('synthesisDesc'), tag: t('synthesisTag'), auto: false },
    { key: 'query', icon: Search, label: t('queryLabel'), sub: t('querySub'), desc: t('queryDesc'), tag: t('queryTag'), auto: true },
  ]

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-violet-500/[0.08] via-white/[0.02] to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-400/20 flex items-center justify-center">
            <Network className="w-6 h-6 text-violet-300" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">{t('tagline')}</h2>
            <p className="text-sm text-white/50 leading-relaxed">{t('intro')}</p>
          </div>
        </div>
      </div>

      {/* What this is */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <h3 className="text-sm font-medium text-white mb-2">{t('whatTitle')}</h3>
        <p className="text-sm text-white/50 leading-relaxed">{t('whatBody')}</p>
      </div>

      {/* Full flow + diagram */}
      <div>
        <h3 className="text-sm font-medium text-white mb-1">{t('flowTitle')}</h3>
        <p className="text-xs text-white/45 mb-4 leading-relaxed">{t('flowIntro')}</p>
        <div className="flex flex-col md:flex-row md:items-stretch gap-2">
          {flowSteps.map((s, i) => (
            <Fragment key={s.key}>
              <div className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-400/20 flex items-center justify-center">
                    <s.icon className="w-4 h-4 text-violet-300/90" />
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.auto ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {s.tag}
                  </span>
                </div>
                <h4 className="text-sm font-medium text-white leading-tight">{s.label}</h4>
                <p className="text-[10px] font-mono text-white/30 mb-1.5">{s.sub}</p>
                <p className="text-xs text-white/45 leading-relaxed">{s.desc}</p>
              </div>
              {i < flowSteps.length - 1 && (
                <div className="flex items-center justify-center text-white/25 shrink-0">
                  <ChevronRight className="w-5 h-5 rotate-90 md:rotate-0" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-500/[0.04] p-3">
          <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">{t('flowNote')}</p>
        </div>
      </div>

      {/* Three pillars */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">{t('pillarsTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
                <p.icon className="w-4 h-4 text-violet-300/90" />
              </div>
              <h4 className="text-sm font-medium text-white mb-1.5">{p.title}</h4>
              <p className="text-xs text-white/45 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Shared vault with customer service */}
      <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white mb-1.5">{t('sharedTitle')}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{t('sharedBody')}</p>
          </div>
        </div>
      </div>

      {/* Purpose selector */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">{t('purposeTitle')}</h3>
        <WikiPurposeSwitch />
      </div>
    </div>
  )
}
