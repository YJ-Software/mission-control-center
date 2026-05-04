'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { useTranslations } from 'next-intl'
import { ArrowLeft, FileText, MessageSquare, Info, Search } from 'lucide-react'
import { SourcesPanel } from './sources-panel'
import { ChatPanel } from './chat-panel'
import { InfoPanel } from './info-panel'
import { ResearchPanel } from './research-panel'

interface NotebookDetailProps {
  notebookId: string
  notebookTitle: string
  sourceCount?: number
  updatedAt?: string
  onBack: () => void
}

export function NotebookDetail({ notebookId, notebookTitle, sourceCount, updatedAt, onBack }: NotebookDetailProps) {
  const t = useTranslations('secondBrain.notebooklm.detail')

  const tabs = [
    { value: 'sources', icon: FileText, label: t('tabs.sources') },
    { value: 'chat', icon: MessageSquare, label: t('tabs.chat') },
    { value: 'info', icon: Info, label: t('tabs.info') },
    { value: 'research', icon: Search, label: t('tabs.research') },
  ]

  return (
    <div className="space-y-4">
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('back')}
        </button>
        <h2 className="text-sm font-medium text-white truncate">{notebookTitle}</h2>
      </div>

      {/* Tabbed content */}
      <Tabs.Root defaultValue="sources">
        <Tabs.List className="flex gap-1 mb-4 bg-white/[0.04] rounded-lg p-1 border border-white/[0.08] overflow-x-auto">
          {tabs.map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-white/50
                data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400
                hover:text-white/70 transition-colors font-medium whitespace-nowrap"
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="sources"><SourcesPanel notebookId={notebookId} /></Tabs.Content>
        <Tabs.Content value="chat"><ChatPanel notebookId={notebookId} /></Tabs.Content>
        <Tabs.Content value="info"><InfoPanel notebookId={notebookId} title={notebookTitle} sourceCount={sourceCount} updatedAt={updatedAt} /></Tabs.Content>
        <Tabs.Content value="research"><ResearchPanel notebookId={notebookId} /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
