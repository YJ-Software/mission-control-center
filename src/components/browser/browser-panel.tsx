'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { useTranslations } from 'next-intl'
import { BrowserDashboard } from './browser-dashboard'
import { BrowserAboutPanel } from './browser-about-panel'

export function BrowserPanel() {
  const t = useTranslations('browser.subTabs')

  const subTab = (value: string, label: string) => (
    <Tabs.Trigger
      value={value}
      className="px-3 py-2 text-sm text-white/50 border-b-2 border-transparent -mb-px
        data-[state=active]:border-sky-400 data-[state=active]:text-white
        hover:text-white/80 transition-colors font-medium"
    >
      {label}
    </Tabs.Trigger>
  )

  return (
    <div className="p-6">
      <Tabs.Root defaultValue="about">
        <Tabs.List className="flex gap-1 mb-4 border-b border-white/[0.08]">
          {subTab('about', t('about'))}
          {subTab('overview', t('overview'))}
        </Tabs.List>

        <Tabs.Content value="about">
          <BrowserAboutPanel />
        </Tabs.Content>

        <Tabs.Content value="overview">
          <BrowserDashboard />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
