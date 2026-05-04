'use client'
import { useTranslations } from 'next-intl'
import { useAgentOverview } from '@/hooks/agents/use-agent-overview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AgentContentCard({ agentId }: { agentId: string | null }) {
  const t = useTranslations('agents.contentCard')
  const q = useAgentOverview(agentId)
  if (!agentId || !q.data) return null
  const d = q.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">{t('workspace')}</div>
          <code>{d.workspace ?? '—'}</code>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('primaryModel')}</div>
          <code>{d.primaryModel ?? '—'}</code>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('identity')}</div>
          <div>{d.identity?.name ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('skillFilter')}</div>
          <div>{d.skillFilter ?? t('allSkills')}</div>
        </div>
      </CardContent>
    </Card>
  )
}
