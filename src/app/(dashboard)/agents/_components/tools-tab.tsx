'use client'
import { useTranslations } from 'next-intl'
import { useAgentTools, useSetToolAllowed } from '@/hooks/agents/use-agent-tools'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

export function ToolsTab({ agentId }: { agentId: string | null }) {
  const tc = useTranslations('agents.common')
  const tt = useTranslations('agents.tools')
  const q = useAgentTools(agentId)
  const set = useSetToolAllowed(agentId)

  if (!agentId) return <p className="text-sm text-muted-foreground">{tc('empty')}</p>
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>
  if (q.error) return <p className="text-sm text-destructive">{String(q.error)}</p>

  const tools = q.data?.tools ?? []
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {tools.map((t) => (
        <Card key={t.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t.label}</CardTitle>
            <Switch
              checked={!!t.allowed}
              disabled={set.isPending}
              onCheckedChange={(v) => set.mutate({ toolId: t.id, allowed: v })}
            />
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>{t.description ?? '—'}</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline" className="w-fit">
                {t.groupLabel}
              </Badge>
              <Badge variant="outline" className="w-fit">
                {t.source === 'core' ? tt('globalDefault') : t.source}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
