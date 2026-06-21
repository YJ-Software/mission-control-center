'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { useTranslations } from 'next-intl'
import { NotebookLMDashboard } from './notebooklm-dashboard'
import { NotebookLMAboutPanel } from './notebooklm-about-panel'

export function NotebookLMPanel() {
  const t = useTranslations('secondBrain.notebooklmSubTabs')

  const subTab = (value: string, label: string) => (
    <Tabs.Trigger
      value={value}
      className="px-3 py-2 text-sm text-white/50 border-b-2 border-transparent -mb-px
        data-[state=active]:border-cyan-400 data-[state=active]:text-white
        hover:text-white/80 transition-colors font-medium"
    >
      {label}
    </Tabs.Trigger>
  )

  return (
    <Tabs.Root defaultValue="about">
      <Tabs.List className="flex gap-1 mb-4 border-b border-white/[0.08]">
        {subTab('about', t('about'))}
        {subTab('operate', t('operate'))}
      </Tabs.List>

      <Tabs.Content value="about">
        <NotebookLMAboutPanel />
      </Tabs.Content>

      <Tabs.Content value="operate">
        <NotebookLMDashboard />
      </Tabs.Content>
    </Tabs.Root>
  )
}
