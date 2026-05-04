'use client'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAgentsList } from '@/hooks/agents/use-agents-list'
import { buildAgentsUrl, type AgentsUrlState } from './url-state'
import { Button } from '@/components/ui/button'

export function AgentSelector({ state }: { state: AgentsUrlState }) {
  const t = useTranslations('agents.actions')
  const router = useRouter()
  const q = useAgentsList()
  const list = q.data?.agents ?? []
  const selectedId = state.agent ?? q.data?.defaultId ?? list[0]?.id ?? null
  const isDefault = selectedId && q.data?.defaultId === selectedId

  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={selectedId ?? ''}
        onChange={(e) => router.replace(buildAgentsUrl({ ...state, agent: e.target.value }))}
      >
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.id}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={!selectedId}
        onClick={() => selectedId && navigator.clipboard.writeText(selectedId)}
      >
        {t('copyId')}
      </Button>
      <Button variant="ghost" size="sm" disabled={!!isDefault}>
        {t('makeDefault')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => q.refetch()}>
        {t('refresh')}
      </Button>
    </div>
  )
}
