'use client'

import { useTranslations } from 'next-intl'
import {
  Sunrise, AlertTriangle, Workflow, Info,
  CalendarClock, Coins, ListChecks, Mic, Send, Filter, FileText,
} from 'lucide-react'

// One icon per feature, matched by order to the `features` i18n array.
const FEATURE_ICONS = [CalendarClock, Coins, ListChecks, Mic, Send, Filter, FileText]

export function MorningReportAboutPanel() {
  const t = useTranslations('morningReport.about')

  const features = t.raw('features') as { title: string; body: string }[]
  const pipeline = t.raw('pipeline') as { label: string; desc: string }[]

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-amber-500/[0.08] via-white/[0.02] to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
            <Sunrise className="w-6 h-6 text-amber-300" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">{t('tagline')}</h2>
          </div>
        </div>
      </div>

      {/* The pain point — why a system is needed */}
      <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white mb-1.5">{t('painTitle')}</h3>
            <p className="text-sm text-white/55 leading-relaxed whitespace-pre-line">{t('painBody')}</p>
          </div>
        </div>
      </div>

      {/* Features */}
      <div>
        <h3 className="text-sm font-medium text-white mb-3">{t('featuresTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((f, i) => {
            const Icon = FEATURE_ICONS[i] ?? Info
            return (
              <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="w-9 h-9 rounded-lg bg-amber-500/[0.08] border border-amber-400/15 flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-amber-300/90" />
                </div>
                <h4 className="text-sm font-medium text-white mb-1.5">{f.title}</h4>
                <p className="text-[13px] text-white/65 leading-relaxed">{f.body}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pipeline */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
            <Workflow className="w-4 h-4 text-amber-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('pipelineTitle')}</h3>
        </div>
        <div className="flex flex-col md:flex-row md:items-stretch gap-2">
          {pipeline.map((s, i) => (
            <div key={i} className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-5 h-5 rounded-md bg-amber-500/15 text-amber-300 text-[11px] font-mono flex items-center justify-center">{i + 1}</span>
                <h4 className="text-sm font-medium text-white leading-tight">{s.label}</h4>
              </div>
              <p className="text-[13px] text-white/65 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Note */}
      <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <Info className="w-4 h-4 text-amber-300/80 shrink-0 mt-0.5" />
        <p className="text-xs text-white/45 leading-relaxed">{t('note')}</p>
      </div>
    </div>
  )
}
