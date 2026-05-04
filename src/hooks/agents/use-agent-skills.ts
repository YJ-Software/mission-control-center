import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpcCall } from '@/lib/openclaw/rpc-client'

type SkillRaw = {
  name: string
  description?: string
  source: string
  bundled?: boolean
  filePath?: string
  skillKey: string
  always?: boolean
  disabled?: boolean
  blockedByAllowlist?: boolean
  eligible?: boolean
}

type SkillsStatusRaw = {
  workspaceDir: string
  managedSkillsDir: string
  skills: SkillRaw[]
}

export type SkillEntry = {
  key: string
  name: string
  description?: string
  category: 'workspace' | 'builtin' | 'extra' | 'other'
  enabled: boolean
  eligible: boolean
  always: boolean
  source: string
}

function categoryFor(source: string): SkillEntry['category'] {
  if (source === 'openclaw-workspace') return 'workspace'
  if (source === 'openclaw-bundled' || source === 'bundled' || source === 'builtin') return 'builtin'
  if (source === 'openclaw-extras' || source === 'extras') return 'extra'
  return 'other'
}

export function useAgentSkills(agentId: string | null) {
  return useQuery({
    enabled: !!agentId,
    queryKey: ['agents', 'skills', agentId],
    queryFn: async () => {
      const raw = await rpcCall<SkillsStatusRaw>('skills.status', { agentId })
      const skills: SkillEntry[] = raw.skills.map((s) => ({
        key: s.skillKey ?? s.name,
        name: s.name,
        description: s.description,
        category: categoryFor(s.source),
        enabled: !s.disabled && !s.blockedByAllowlist,
        eligible: s.eligible ?? true,
        always: !!s.always,
        source: s.source,
      }))
      return { workspaceDir: raw.workspaceDir, skills }
    },
    staleTime: 30_000,
  })
}

export function useToggleSkill(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillKey, enabled }: { skillKey: string; enabled: boolean }) =>
      rpcCall('skills.update', { agentId, skillKey, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'skills', agentId] }),
  })
}

export function useInstallSkill(agentId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { source: string }) =>
      rpcCall('skills.install', { agentId, source: input.source }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'skills', agentId] }),
  })
}
