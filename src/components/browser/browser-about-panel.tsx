'use client'

import { useTranslations } from 'next-intl'
import {
  Globe, ShieldCheck, Workflow, Check, Info, ExternalLink, MousePointerClick,
} from 'lucide-react'

const REPO_URL = 'https://github.com/jackwener/opencli'

export function BrowserAboutPanel() {
  const t = useTranslations('browser.about')

  const why = t.raw('why') as string[]
  const how = t.raw('how') as { label: string; desc: string }[]
  const capabilities = t.raw('capabilities') as string[]

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-sky-500/[0.08] via-white/[0.02] to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-400/20 flex items-center justify-center">
            <Globe className="w-6 h-6 text-sky-300" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">瀏覽器自動化</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.06] text-white/50 border border-white/[0.08]">OpenCLI</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">{t('tagline')}</p>
          </div>
        </div>
      </div>

      {/* Intro */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <p className="text-sm text-white/50 leading-relaxed">{t('intro')}</p>
      </div>

      {/* Why — the OpenCLI spirit */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-sky-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('whyTitle')}</h3>
        </div>
        <ul className="space-y-1.5">
          {why.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-white/50 leading-relaxed">
              <Check className="w-3.5 h-3.5 text-sky-300/80 shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* How it works */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center">
            <Workflow className="w-4 h-4 text-sky-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('howTitle')}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {how.map((step, i) => (
            <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-5 h-5 rounded-md bg-sky-500/15 text-sky-300 text-[11px] font-mono flex items-center justify-center">{i + 1}</span>
                <h4 className="text-sm font-medium text-white">{step.label}</h4>
              </div>
              <p className="text-xs text-white/45 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center">
            <MousePointerClick className="w-4 h-4 text-sky-300" />
          </div>
          <h3 className="text-sm font-semibold text-white">{t('capabilitiesTitle')}</h3>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {capabilities.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-white/50 leading-relaxed">
              <Check className="w-3.5 h-3.5 text-sky-300/80 shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Note + status hint */}
      <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
            <Info className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white mb-1.5">{t('noteTitle')}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{t('note')}</p>
            <p className="text-xs text-white/35 mt-2">{t('statusHint')}</p>
          </div>
        </div>
      </div>

      {/* Repo link */}
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
      >
        {t('repoLink')}
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}
