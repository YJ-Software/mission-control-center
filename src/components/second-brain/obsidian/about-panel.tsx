'use client'

import { useTranslations } from 'next-intl'
import { Brain, Share2, Radio, ShieldCheck, Download, RefreshCw, Sparkles, ArrowRight } from 'lucide-react'

interface AboutPanelProps {
  onNavigateAction: (tab: 'overview' | 'skills') => void
}

export function AboutPanel({ onNavigateAction }: AboutPanelProps) {
  const t = useTranslations('secondBrain.obsidian.about')

  const pillars = [
    { icon: Share2, title: t('sharedTitle'), body: t('sharedBody') },
    { icon: Radio, title: t('alwaysOnTitle'), body: t('alwaysOnBody') },
    { icon: ShieldCheck, title: t('sovereigntyTitle'), body: t('sovereigntyBody') },
  ]

  const steps = [
    { icon: Download, title: t('step1Title'), body: t('step1Body'), cta: t('step1Cta'), target: 'overview' as const },
    { icon: RefreshCw, title: t('step2Title'), body: t('step2Body'), cta: t('step2Cta'), target: 'overview' as const },
    { icon: Sparkles, title: t('step3Title'), body: t('step3Body'), cta: t('step3Cta'), target: 'skills' as const },
  ]

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-cyan-500/[0.08] via-white/[0.02] to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
            <Brain className="w-6 h-6 text-cyan-300" />
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

      {/* Three pillars */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">{t('pillarsTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
                <p.icon className="w-4 h-4 text-cyan-300/90" />
              </div>
              <h4 className="text-sm font-medium text-white mb-1.5">{p.title}</h4>
              <p className="text-xs text-white/45 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Get started */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">{t('getStartedTitle')}</h3>
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={s.title} className="flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex-shrink-0 flex items-center gap-3">
                <span className="text-xs font-mono text-white/25 w-4 text-right">{i + 1}</span>
                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                  <s.icon className="w-4 h-4 text-cyan-300/90" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-white mb-1">{s.title}</h4>
                <p className="text-xs text-white/45 leading-relaxed">{s.body}</p>
              </div>
              <button
                onClick={() => onNavigateAction(s.target)}
                className="flex-shrink-0 self-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  text-cyan-300 bg-cyan-500/10 border border-cyan-400/20 hover:bg-cyan-500/15 transition-colors"
              >
                {s.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
