'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { Globe, BookOpen, Network } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ObsidianDashboard } from './obsidian/obsidian-dashboard'
import { NotebookLMDashboard } from './notebooklm/notebooklm-dashboard'
import { WikiPanel } from './wiki/wiki-panel'

export function SecondBrainManager() {
  const t = useTranslations('secondBrain')

  const tabs = [
    { value: 'obsidian', icon: Globe, label: t('tabs.obsidian') },
    { value: 'wiki', icon: Network, label: 'Wiki' },
    { value: 'notebooklm', icon: BookOpen, label: t('tabs.notebooklm') },
  ]

  return (
    <div className="p-6">
      <Tabs.Root defaultValue="obsidian">
        <Tabs.List className="flex gap-1 mb-6 bg-white/[0.04] rounded-lg p-1 border border-white/[0.08]">
          {tabs.map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm text-white/60
                data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400
                hover:text-white/80 transition-colors font-medium"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="obsidian">
          <ObsidianDashboard />
        </Tabs.Content>
        <Tabs.Content value="wiki">
          <WikiPanel />
        </Tabs.Content>
        <Tabs.Content value="notebooklm">
          <NotebookLMDashboard />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
