'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { Search, Podcast, Network, Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SetupSearch } from './setup-search'
import { SetupNotebookLM } from './setup-notebooklm'
import { SetupTailscale } from './setup-tailscale'
import { SetupImunifyAV } from './setup-imunifyav'

export function SetupContent() {
  const t = useTranslations('setup')

  const tabs = [
    { value: 'search', icon: Search, label: t('tabs.search') },
    { value: 'notebooklm', icon: Podcast, label: t('tabs.notebooklm') },
    { value: 'tailscale', icon: Network, label: t('tabs.tailscale') },
    { value: 'imunifyav', icon: Shield, label: t('tabs.imunifyav') },
  ]

  return (
    <div className="p-6">
      <Tabs.Root defaultValue="search">
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

        <Tabs.Content value="search"><SetupSearch /></Tabs.Content>
        <Tabs.Content value="notebooklm"><SetupNotebookLM /></Tabs.Content>
        <Tabs.Content value="tailscale"><SetupTailscale /></Tabs.Content>
        <Tabs.Content value="imunifyav"><SetupImunifyAV /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
