'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAgentFilesList, useAgentFile, useSaveAgentFile } from '@/hooks/agents/use-agent-files'
import { FileEditor } from './shared/file-editor'
import { Button } from '@/components/ui/button'

const FILE_ORDER = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'MEMORY.md']

export function FilesTab({ agentId }: { agentId: string | null }) {
  const t = useTranslations('agents')
  const tc = useTranslations('agents.common')
  const tf = useTranslations('agents.files')
  const [selected, setSelected] = useState<string | null>(null)
  const list = useAgentFilesList(agentId)
  const file = useAgentFile(agentId, selected)
  const save = useSaveAgentFile(agentId)
  const [draft, setDraft] = useState<string>('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (file.data) {
      setDraft(file.data.content)
      setDirty(false)
    }
  }, [file.data])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const tabs = useMemo(() => {
    const discovered = list.data?.files.map((f) => f.name) ?? []
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const n of FILE_ORDER) if (discovered.includes(n)) { ordered.push(n); seen.add(n) }
    for (const n of discovered) if (!seen.has(n)) ordered.push(n)
    return ordered
  }, [list.data])

  if (!agentId) return <p className="text-sm text-muted-foreground">{tc('empty')}</p>

  const selectedFile = list.data?.files.find((f) => f.name === selected)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 border-b">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setSelected(name)}
            className={
              selected === name
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                : 'px-3 py-2 text-sm text-muted-foreground'
            }
          >
            {name.replace(/\.md$/, '')}
          </button>
        ))}
      </div>
      {!selected ? (
        <p className="text-sm text-muted-foreground">{tf('selectToEdit')}</p>
      ) : file.isLoading ? (
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      ) : (
        <>
          <FileEditor
            value={draft}
            onChange={(v) => {
              setDraft(v)
              setDirty(v !== (file.data?.content ?? ''))
            }}
          />
          <div className="flex gap-2">
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ name: selected, content: draft })}
            >
              {t('actions.save')}
            </Button>
            {save.error ? (
              <span className="self-center text-sm text-destructive">{String(save.error)}</span>
            ) : null}
            {selectedFile?.path ? (
              <code className="self-center text-xs text-muted-foreground">{selectedFile.path}</code>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
