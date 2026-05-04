'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BrainCircuit } from 'lucide-react'
import { MemoryInstallWizard } from './memory-install-wizard'
import { MemoryProviderForm } from './memory-provider-form'
import { MemoryBrowser } from './memory-browser'
import { MemoryUsageStats } from './memory-usage-stats'
import { MemoryNeo4jPanel } from './memory-neo4j-panel'
import { MemoryBackendSelector } from './memory-backend-selector'

type Section = 'backend' | 'wizard' | 'provider' | 'browser' | 'stats' | 'neo4j'

export function MemoryTab() {
  const t = useTranslations('customerService.memory')
  const [section, setSection] = useState<Section>('backend')

  const sections: { key: Section; label: string }[] = [
    { key: 'backend', label: t('sections.backend') },
    { key: 'wizard', label: t('sections.wizard') },
    { key: 'provider', label: t('sections.provider') },
    { key: 'browser', label: t('sections.browser') },
    { key: 'stats', label: t('sections.stats') },
    { key: 'neo4j', label: t('sections.neo4j') },
  ]

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="cyber-card p-5">
        <div className="flex items-start gap-3">
          <BrainCircuit className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
            <p className="text-sm text-white/60 leading-relaxed">{t('description')}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              section === s.key
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                : 'text-white/60 hover:text-white/80 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'backend' && <MemoryBackendSelector />}
      {section === 'wizard' && <MemoryInstallWizard />}
      {section === 'provider' && <MemoryProviderForm />}
      {section === 'browser' && <MemoryBrowser />}
      {section === 'stats' && <MemoryUsageStats />}
      {section === 'neo4j' && <MemoryNeo4jPanel />}
    </div>
  )
}
