'use client'
import { useTranslations } from 'next-intl'
import { useAgentChannels, useLogoutChannel } from '@/hooks/agents/use-agent-channels'
import { AgentContentCard } from './shared/agent-content-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function ChannelsTab({ agentId }: { agentId: string | null }) {
  const t = useTranslations('agents.channels')
  const q = useAgentChannels(agentId)
  const logout = useLogoutChannel()
  const list = q.data?.channels ?? []
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AgentContentCard agentId={agentId} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noConnected')}</p>
          ) : (
            list.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-medium">{c.provider}</span>
                  <span className="text-xs text-muted-foreground">{c.policy ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.connected ? 'default' : 'outline'}>
                    {c.connected ? t('connected') : t('offline')}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={logout.isPending || !c.connected}
                    onClick={() => logout.mutate(c.id)}
                  >
                    {t('logout')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
