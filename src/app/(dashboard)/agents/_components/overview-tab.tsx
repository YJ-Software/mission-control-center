'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAgentOverview } from '@/hooks/agents/use-agent-overview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function OverviewTab({ agentId }: { agentId: string | null }) {
  const tc = useTranslations('agents.common')
  const t = useTranslations('agents.overview')
  const q = useAgentOverview(agentId)
  const [showFallbacks, setShowFallbacks] = useState(false)
  if (!agentId) return <p className="text-sm text-muted-foreground">{tc('empty')}</p>
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>
  if (q.error) return <p className="text-sm text-destructive">{tc('error', { message: String(q.error) })}</p>
  const d = q.data!
  const fallbackCount = d.fallbacks.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overviewTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">{t('workspace')}</div>
          <code className="text-sm">{d.workspace ?? '—'}</code>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs text-muted-foreground">{t('primaryModel')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 text-sm font-medium">
              {d.primaryModel ?? '—'}
            </code>
            {fallbackCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-xs"
                onClick={() => setShowFallbacks((v) => !v)}
              >
                {showFallbacks ? '−' : '+'}{fallbackCount} fallback{fallbackCount === 1 ? '' : 's'}
              </Button>
            ) : null}
          </div>
          {showFallbacks && fallbackCount > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {d.fallbacks.map((m, idx) => (
                <Badge key={m} variant="outline" className="font-mono text-xs">
                  {idx + 1}. {m}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t('skillFilter')}</div>
          <code className="text-sm">{d.skillFilter ?? t('allSkills')}</code>
        </div>
      </CardContent>
    </Card>
  )
}
