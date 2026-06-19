'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Wrench, Loader2, ChevronDown } from 'lucide-react'

type RunResult = { ok?: boolean; output?: string; error?: string }

function fmt(data: RunResult): string {
  if (data.error) return `❌ ${data.error}`
  return data.output ?? JSON.stringify(data)
}

/** Advanced / maintenance commands surfaced from `openclaw wiki ...`:
 *  doctor, get, apply, bridge import, okf import. */
export function WikiAdvancedCard() {
  const t = useTranslations('secondBrain.wiki.advanced')
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        <Wrench className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white/90">{t('title')}</h3>
        <ChevronDown className={`w-4 h-4 text-white/40 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5">
          <p className="text-xs text-white/40">{t('subtitle')}</p>
          <DoctorRow t={t} />
          <GetRow t={t} />
          <ApplyRow t={t} />
          <BridgeRow t={t} />
          <OkfRow t={t} />
        </div>
      )}
    </div>
  )
}

type T = (key: string) => string

function Output({ text }: { text: string }) {
  if (!text) return null
  return (
    <pre className="mt-2 text-xs text-white/60 bg-black/40 rounded p-3 max-h-56 overflow-auto whitespace-pre-wrap">
      {text}
    </pre>
  )
}

const inputCls = 'flex-1 bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white/90 placeholder:text-white/30'
const btnCls = 'px-3 py-1.5 rounded-md text-xs bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 disabled:opacity-50 inline-flex items-center gap-1.5'
const sectionLabel = 'text-xs font-medium text-white/70'

function DoctorRow({ t }: { t: T }) {
  const [out, setOut] = useState('')
  const m = useMutation({
    mutationFn: async () => fetch('/api/second-brain/wiki?type=doctor').then(r => r.json() as Promise<RunResult>),
    onSuccess: (d) => setOut(fmt(d)),
    onError: (e: Error) => setOut(`❌ ${e.message}`),
  })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>{t('doctorTitle')}</span>
        <button onClick={() => m.mutate()} disabled={m.isPending} className={btnCls}>
          {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('run')}
        </button>
      </div>
      <p className="text-xs text-white/40">{t('doctorDesc')}</p>
      <Output text={out} />
    </div>
  )
}

function GetRow({ t }: { t: T }) {
  const [id, setId] = useState('')
  const [out, setOut] = useState('')
  const m = useMutation({
    mutationFn: async (v: string) => fetch(`/api/second-brain/wiki?type=get&id=${encodeURIComponent(v)}`).then(r => r.json() as Promise<RunResult>),
    onSuccess: (d) => setOut(fmt(d)),
    onError: (e: Error) => setOut(`❌ ${e.message}`),
  })
  return (
    <div className="space-y-2">
      <span className={sectionLabel}>{t('getTitle')}</span>
      <p className="text-xs text-white/40">{t('getDesc')}</p>
      <div className="flex gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder={t('getPlaceholder')} className={inputCls}
          onKeyDown={(e) => e.key === 'Enter' && id.trim() && m.mutate(id.trim())} />
        <button onClick={() => id.trim() && m.mutate(id.trim())} disabled={!id.trim() || m.isPending} className={btnCls}>
          {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('get')}
        </button>
      </div>
      <Output text={out} />
    </div>
  )
}

function ApplyRow({ t }: { t: T }) {
  const [kind, setKind] = useState('synthesis')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [out, setOut] = useState('')
  const m = useMutation({
    mutationFn: async () => fetch('/api/second-brain/wiki?action=apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, title, body, sourceId }),
    }).then(r => r.json() as Promise<RunResult>),
    onSuccess: (d) => setOut(fmt(d)),
    onError: (e: Error) => setOut(`❌ ${e.message}`),
  })
  return (
    <div className="space-y-2">
      <span className={sectionLabel}>{t('applyTitle')}</span>
      <p className="text-xs text-white/40">{t('applyDesc')}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-white/90">
          <option value="synthesis">synthesis</option>
          <option value="entity">entity</option>
          <option value="concept">concept</option>
          <option value="source">source</option>
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('applyTitlePlaceholder')} className="md:col-span-2 bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white/90 placeholder:text-white/30" />
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('applyBodyPlaceholder')} rows={3}
        className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white/90 placeholder:text-white/30" />
      <div className="flex gap-2">
        <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder={t('applySourcePlaceholder')} className={inputCls} />
        <button onClick={() => kind && title.trim() && body.trim() && m.mutate()} disabled={!title.trim() || !body.trim() || m.isPending} className={btnCls}>
          {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('apply')}
        </button>
      </div>
      <Output text={out} />
    </div>
  )
}

function BridgeRow({ t }: { t: T }) {
  const [out, setOut] = useState('')
  const m = useMutation({
    mutationFn: async () => fetch('/api/second-brain/wiki?action=bridge-import', { method: 'POST' }).then(r => r.json() as Promise<RunResult>),
    onSuccess: (d) => setOut(fmt(d)),
    onError: (e: Error) => setOut(`❌ ${e.message}`),
  })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>{t('bridgeTitle')}</span>
        <button onClick={() => m.mutate()} disabled={m.isPending} className={btnCls}>
          {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('import')}
        </button>
      </div>
      <p className="text-xs text-white/40">{t('bridgeDesc')}</p>
      <Output text={out} />
    </div>
  )
}

function OkfRow({ t }: { t: T }) {
  const [path, setPath] = useState('')
  const [out, setOut] = useState('')
  const m = useMutation({
    mutationFn: async (p: string) => fetch('/api/second-brain/wiki?action=okf-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }),
    }).then(r => r.json() as Promise<RunResult>),
    onSuccess: (d) => setOut(fmt(d)),
    onError: (e: Error) => setOut(`❌ ${e.message}`),
  })
  return (
    <div className="space-y-2">
      <span className={sectionLabel}>{t('okfTitle')}</span>
      <p className="text-xs text-white/40">{t('okfDesc')}</p>
      <div className="flex gap-2">
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('okfPlaceholder')} className={inputCls}
          onKeyDown={(e) => e.key === 'Enter' && path.trim() && m.mutate(path.trim())} />
        <button onClick={() => path.trim() && m.mutate(path.trim())} disabled={!path.trim() || m.isPending} className={btnCls}>
          {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{t('import')}
        </button>
      </div>
      <Output text={out} />
    </div>
  )
}
