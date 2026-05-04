'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { parseAgentsUrlState, buildAgentsUrl } from './url-state'
import { AgentSelector } from './agent-selector'
import { useAgentsList } from '@/hooks/agents/use-agents-list'
import { OverviewTab } from './overview-tab'
import { FilesTab } from './files-tab'
import { ToolsTab } from './tools-tab'
import { SkillsTab } from './skills-tab'
import { ChannelsTab } from './channels-tab'
import { CronJobsTab } from './cron-jobs-tab'
import { useAgentsWsInvalidation } from './use-ws-invalidation'
import type { AgentsPanel } from '@/lib/openclaw/agent-types'

const TABS: AgentsPanel[] = ['overview', 'files', 'tools', 'skills', 'channels', 'cron']

export function AgentsPageClient() {
  const t = useTranslations('agents')
  const router = useRouter()
  const sp = useSearchParams()
  const { toggleDrawer } = useMobileMenu()
  const state = useMemo(() => parseAgentsUrlState(new URLSearchParams(sp.toString())), [sp])

  const setTab = useCallback(
    (tab: AgentsPanel) => router.replace(buildAgentsUrl({ ...state, tab })),
    [router, state],
  )

  const agents = useAgentsList()
  const effectiveAgentId = state.agent ?? agents.data?.defaultId ?? agents.data?.agents?.[0]?.id ?? null

  useAgentsWsInvalidation(effectiveAgentId)

  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <div className="flex flex-col gap-6 p-6">
        <AgentSelector state={state} />
        <nav role="tablist" className="flex gap-2 border-b">
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={state.tab === tab}
              onClick={() => setTab(tab)}
              className={
                state.tab === tab
                  ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                  : 'px-3 py-2 text-sm text-muted-foreground'
              }
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
        </nav>
        <section role="tabpanel" data-panel={state.tab}>
          {state.tab === 'overview' && <OverviewTab agentId={effectiveAgentId} />}
          {state.tab === 'files' && <FilesTab agentId={effectiveAgentId} />}
          {state.tab === 'tools' && <ToolsTab agentId={effectiveAgentId} />}
          {state.tab === 'skills' && <SkillsTab agentId={effectiveAgentId} />}
          {state.tab === 'channels' && <ChannelsTab agentId={effectiveAgentId} />}
          {state.tab === 'cron' && <CronJobsTab agentId={effectiveAgentId} />}
        </section>
      </div>
    </MainLayout>
  )
}
