'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { History, GitCompare, RotateCcw, Loader2 } from 'lucide-react'

export type TemplateScope = 'topic' | 'format' | 'config'

export interface TemplateHistoryRef {
  scope: TemplateScope
  refId: string
}

interface VersionMeta {
  id: number
  origin: string
  note: string | null
  createdAt: number
  size: number
}

interface DiffPart {
  added?: boolean
  removed?: boolean
  value: string
}

interface Props extends TemplateHistoryRef {
  /** Text currently in the editor — the left side of any comparison. */
  current: string
  /** Load a revision into the editor. Deliberately does not save: the operator
   *  reviews it and presses the editor's own save, so nothing changes behind
   *  their back. */
  onLoad: (content: string) => void
}

// Kept as an explicit map rather than interpolating the origin into a key, so
// an unknown origin degrades to its raw value instead of throwing on a missing
// translation.
const ORIGIN_KEYS: Record<string, string> = {
  baseline: 'versions.origin.baseline',
  save: 'versions.origin.save',
  'reset-default': 'versions.origin.resetDefault',
  restore: 'versions.origin.restore',
}

function labelFor(v: VersionMeta, t: ReturnType<typeof useTranslations>): string {
  const when = new Date(v.createdAt * 1000).toLocaleString('sv').slice(0, 16)
  const key = ORIGIN_KEYS[v.origin]
  return `${when} · ${key ? t(key) : v.origin} · ${v.size}B`
}

export function TemplateVersionPicker({ scope, refId, current, onLoad }: Props) {
  const t = useTranslations('morningReport')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [diff, setDiff] = useState<DiffPart[] | null>(null)
  const [busy, setBusy] = useState(false)

  const { data } = useQuery<{ versions: VersionMeta[] }>({
    queryKey: ['template-versions', scope, refId],
    queryFn: () =>
      fetch(`/api/morning-report?type=template-versions&scope=${scope}&refId=${encodeURIComponent(refId)}`)
        .then(r => r.json()),
    staleTime: 10_000,
  })

  const versions = data?.versions ?? []
  if (versions.length === 0) return null

  const fetchContent = async (id: number): Promise<string> => {
    const res = await fetch(`/api/morning-report?type=template-version&id=${id}`)
    if (!res.ok) throw new Error('failed to load revision')
    return (await res.json()).content as string
  }

  const handleLoad = async () => {
    if (selectedId === null) return
    setBusy(true)
    try {
      onLoad(await fetchContent(selectedId))
      setDiff(null)
    } finally {
      setBusy(false)
    }
  }

  const handleCompare = async () => {
    if (selectedId === null) return
    if (diff) { setDiff(null); return }
    setBusy(true)
    try {
      const older = await fetchContent(selectedId)
      // Pulled in on demand: comparing is rare, and this keeps the diff
      // implementation out of the initial bundle for everyone else.
      const { diffLines } = await import('diff')
      setDiff(diffLines(older, current) as DiffPart[])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <History className="w-3 h-3 text-white/25 shrink-0" />
        <select
          value={selectedId ?? ''}
          onChange={e => {
            setSelectedId(e.target.value ? Number(e.target.value) : null)
            setDiff(null)
          }}
          className="flex-1 min-w-[200px] bg-white/[0.03] border border-white/[0.08] text-[11px]
            font-mono text-white/70 rounded px-2 py-1 outline-none focus:border-cyan-400/40"
        >
          <option value="" className="bg-[#0a0a1a] text-white/80">
            {t('versions.pick', { count: versions.length })}
          </option>
          {versions.map((v, i) => (
            <option key={v.id} value={v.id} className="bg-[#0a0a1a] text-white/80">
              {/* Name the newest entry rather than only marking it — a bare
                  star leaves the reader to infer what it means. */}
              {i === 0 ? `★ ${t('versions.current')} · ${labelFor(v, t)}` : labelFor(v, t)}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={selectedId === null || busy}
          onClick={handleCompare}
          className="px-1.5 py-1 rounded text-[10px] inline-flex items-center gap-1 transition-colors
            bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80
            border border-white/[0.08] disabled:opacity-30 disabled:pointer-events-none"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
          {diff ? t('versions.hideDiff') : t('versions.compare')}
        </button>

        <button
          type="button"
          disabled={selectedId === null || busy}
          onClick={handleLoad}
          className="px-1.5 py-1 rounded text-[10px] inline-flex items-center gap-1 transition-colors
            bg-cyan-400/10 text-cyan-400/70 hover:bg-cyan-400/20 hover:text-cyan-400
            border border-cyan-400/10 disabled:opacity-30 disabled:pointer-events-none"
        >
          <RotateCcw className="w-3 h-3" />
          {t('versions.load')}
        </button>
      </div>

      {diff && (
        <div className="rounded border border-white/[0.08] bg-black/20 overflow-x-auto max-h-72 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] text-white/40 border-b border-white/[0.06] sticky top-0 bg-[#0a0a1a]">
            {t('versions.diffLegend')}
          </div>
          <pre className="text-[11px] font-mono leading-relaxed p-2 whitespace-pre-wrap break-words">
            {diff.map((part, i) => (
              <span
                key={i}
                className={
                  part.added
                    ? 'block bg-emerald-400/10 text-emerald-300/90'
                    : part.removed
                      ? 'block bg-rose-400/10 text-rose-300/90'
                      : 'block text-white/35'
                }
              >
                {part.value.replace(/\n$/, '').split('\n').map((line, j) => (
                  <span key={j} className="block">
                    <span className="select-none opacity-40 mr-1">
                      {part.added ? '+' : part.removed ? '-' : ' '}
                    </span>
                    {line || ' '}
                  </span>
                ))}
              </span>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}
