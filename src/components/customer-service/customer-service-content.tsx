'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { LayoutDashboard, Clock, BrainCircuit, Settings as SettingsIcon, Send, BookText } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { BusinessHoursProvider } from './business-hours-context'
import { OverviewTab } from './overview-tab'
import { BusinessHoursTab } from './business-hours-tab'
import { MemoryTab } from './memory-tab'
import { SettingsTab } from './settings-tab'
import { HandoffTab } from './handoff-tab'
import { WikiTab } from './wiki-tab'
import { WikiConflictBanner } from './wiki-conflict-banner'

export function CustomerServiceContent() {
  const t = useTranslations('customerService')

  const tabs = [
    { value: 'overview', icon: LayoutDashboard, label: t('tabs.overview') },
    { value: 'hours', icon: Clock, label: t('tabs.hours') },
    { value: 'wiki', icon: BookText, label: t('tabs.wiki') },
    { value: 'memory', icon: BrainCircuit, label: t('tabs.memory') },
    { value: 'handoff', icon: Send, label: t('tabs.handoff') },
    { value: 'settings', icon: SettingsIcon, label: t('tabs.settings') },
  ]

  return (
    <div className="p-6 space-y-5">
      <WikiConflictBanner />

      <BusinessHoursProvider>
        <Tabs.Root defaultValue="overview">
          <Tabs.List className="flex gap-1 mb-6 bg-white/[0.04] rounded-lg p-1 border border-white/[0.08] overflow-x-auto">
            {tabs.map((tab) => (
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

          <Tabs.Content value="overview">
            <OverviewTab />
          </Tabs.Content>
          <Tabs.Content value="hours">
            <BusinessHoursTab />
          </Tabs.Content>
          <Tabs.Content value="wiki">
            <WikiTab />
          </Tabs.Content>
          <Tabs.Content value="memory">
            <MemoryTab />
          </Tabs.Content>
          <Tabs.Content value="handoff">
            <HandoffTab />
          </Tabs.Content>
          <Tabs.Content value="settings">
            <SettingsTab />
          </Tabs.Content>
        </Tabs.Root>
      </BusinessHoursProvider>
    </div>
  )
}
