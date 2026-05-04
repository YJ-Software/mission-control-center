'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { Newspaper, Settings2, Rocket, Mic, Wrench } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ReportBrowser } from './report-browser'
import { TopicManager } from './topic-manager'
import { ExecutionControl } from './execution-control'
import { PodcastManager } from './podcast-manager'
import { ReportSettings } from './report-settings'

export function MorningReportManager() {
  const t = useTranslations('morningReport')

  const tabs = [
    { value: 'browse', icon: Newspaper, label: t('tabs.browse') },
    { value: 'topics', icon: Settings2, label: t('tabs.topics') },
    { value: 'execute', icon: Rocket, label: t('tabs.execute') },
    { value: 'podcast', icon: Mic, label: t('tabs.podcast') },
    { value: 'settings', icon: Wrench, label: t('tabs.settings') },
  ]
  return (
    <div className="p-6">
      <Tabs.Root defaultValue="browse">
        <Tabs.List className="flex gap-1 mb-6 bg-white/[0.04] rounded-lg p-1 border border-white/[0.08] overflow-x-auto">
          {tabs.map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm text-white/60
                data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400
                hover:text-white/80 transition-colors font-medium whitespace-nowrap"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="browse"><ReportBrowser /></Tabs.Content>
        <Tabs.Content value="topics"><TopicManager /></Tabs.Content>
        <Tabs.Content value="execute"><ExecutionControl /></Tabs.Content>
        <Tabs.Content value="podcast"><PodcastManager /></Tabs.Content>
        <Tabs.Content value="settings"><ReportSettings /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
