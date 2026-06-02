'use client'

import * as Tabs from '@radix-ui/react-tabs'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, Cpu } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { LlmAuthView } from './_components/llm-auth-view'
import { ModelsView } from './_components/models-view'

export default function LlmAuthPage() {
  const t = useTranslations('llmAuth')
  const { toggleDrawer } = useMobileMenu()
  const [activeTab, setActiveTab] = useState('auth')

  const tabs = [
    { value: 'auth', icon: KeyRound, label: t('tabAuth') },
    { value: 'models', icon: Cpu, label: t('tabModels') },
  ]

  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <div className="p-6">
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
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

          <Tabs.Content value="auth"><LlmAuthView /></Tabs.Content>
          <Tabs.Content value="models"><ModelsView /></Tabs.Content>
        </Tabs.Root>
      </div>
    </MainLayout>
  )
}
