'use client'

import { useTranslations } from 'next-intl'
import { Network, ExternalLink, Info } from 'lucide-react'

export function MemoryNeo4jPanel() {
  const t = useTranslations('customerService.memory.neo4j')

  return (
    <div className="space-y-4">
      <div className="cyber-card p-5">
        <div className="flex items-start gap-3">
          <Network className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
            <p className="text-xs text-white/60 leading-relaxed mt-1">{t('description')}</p>
          </div>
        </div>
      </div>

      <div className="cyber-card p-5 border border-cyan-500/25 bg-cyan-500/[0.04]">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-cyan-300 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3">
            <h4 className="text-sm font-semibold text-cyan-100">{t('unavailable.title')}</h4>
            <p className="text-xs text-white/70 leading-relaxed">{t('unavailable.description')}</p>
            <div className="space-y-2 text-xs text-white/60">
              <div>
                <span className="text-white/40">{t('unavailable.osScope')}:</span>{' '}
                <span className="font-mono text-white/80">vector store + LLM 萃取</span>
              </div>
              <div>
                <span className="text-white/40">{t('unavailable.cloudScope')}:</span>{' '}
                <span className="font-mono text-white/80">vector + graph + entity linking</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href="https://docs.mem0.ai/open-source/graph_memory/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                  bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 transition-colors"
              >
                {t('unavailable.docsLink')}
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://github.com/mem0ai/mem0/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                  bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
              >
                {t('unavailable.trackLink')}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="cyber-card p-5">
        <h4 className="text-xs uppercase tracking-wider text-white/50 mb-3">{t('alternatives.title')}</h4>
        <ul className="space-y-2 text-xs text-white/70 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-cyan-400 shrink-0">·</span>
            <span><strong className="text-white/90">{t('alternatives.cloud.title')}</strong> — {t('alternatives.cloud.description')}</span>
          </li>
          <li className="flex gap-2">
            <span className="text-cyan-400 shrink-0">·</span>
            <span><strong className="text-white/90">{t('alternatives.metadata.title')}</strong> — {t('alternatives.metadata.description')}</span>
          </li>
          <li className="flex gap-2">
            <span className="text-cyan-400 shrink-0">·</span>
            <span><strong className="text-white/90">{t('alternatives.future.title')}</strong> — {t('alternatives.future.description')}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
