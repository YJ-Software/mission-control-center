'use client'

import { useTranslations } from 'next-intl'
import { Network, FileSearch, GitBranch, ShieldQuestion, Users } from 'lucide-react'
import { WikiPurposeSwitch } from '@/components/wiki/wiki-purpose-switch'

export function WikiAboutPanel() {
  const t = useTranslations('secondBrain.wiki.about')

  const pillars = [
    { icon: FileSearch, title: t('claimsTitle'), body: t('claimsBody') },
    { icon: GitBranch, title: t('compiledTitle'), body: t('compiledBody') },
    { icon: ShieldQuestion, title: t('provenanceTitle'), body: t('provenanceBody') },
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
