'use client'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAgentSkills, useToggleSkill } from '@/hooks/agents/use-agent-skills'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

const CATEGORIES = ['workspace', 'builtin', 'extra', 'other'] as const
const CATEGORY_KEY_MAP = {
  workspace: 'categoryWorkspace',
  builtin: 'categoryBuiltin',
  extra: 'categoryExtra',
  other: 'categoryOther',
} as const

export function SkillsTab({ agentId }: { agentId: string | null }) {
  const tc = useTranslations('agents.common')
  const t = useTranslations('agents.skills')
  const q = useAgentSkills(agentId)
  const toggle = useToggleSkill(agentId)
  const [filter, setFilter] = useState('')

  const grouped = useMemo(() => {
    const skills = q.data?.skills ?? []
    const lc = filter.toLowerCase()
    const filtered = lc
      ? skills.filter((s) => s.name.toLowerCase().includes(lc) || s.key.includes(lc))
      : skills
    const by: Record<string, typeof skills> = {}
    for (const c of CATEGORIES) by[c] = []
    for (const s of filtered) (by[s.category] ??= []).push(s)
    return by
  }, [q.data, filter])

  if (!agentId) return <p className="text-sm text-muted-foreground">{tc('empty')}</p>
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>

  return (
    <div className="flex flex-col gap-4">
      <Input placeholder={t('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {CATEGORIES.map((cat) => {
        const list = grouped[cat] ?? []
        if (!list.length) return null
        return (
          <section key={cat} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(CATEGORY_KEY_MAP[cat])}
            </h3>
            {list.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.eligible ? <Badge variant="outline">{t('eligible')}</Badge> : null}
                    {s.always ? <Badge>always</Badge> : null}
                  </div>
                  {s.description ? (
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                  ) : null}
                </div>
                <Switch
                  checked={s.enabled}
                  disabled={toggle.isPending}
                  onCheckedChange={(v) => toggle.mutate({ skillKey: s.key, enabled: v })}
                />
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
