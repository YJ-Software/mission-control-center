'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  HardDrive, Globe, Plus, Trash2, ChevronDown, ChevronUp,
  Loader2, CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Destination {
  id: string
  name: string
  type: 'ftp' | 'local'
  config: string
  enabled: number
  createdAt: number
  updatedAt: number
}

interface FtpConfig {
  ip: string
  port: number
  user: string
  password: string
  mode: 'active' | 'passive'
  path: string
}

interface LocalConfig {
  path: string
}

type DestType = 'ftp' | 'local'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseConfig(dest: Destination): FtpConfig | LocalConfig {
  try {
    return JSON.parse(dest.config)
  } catch {
    return dest.type === 'ftp'
      ? { ip: '', port: 21, user: '', password: '', mode: 'passive', path: '' }
      : { path: '' }
  }
}

function emptyFtp(): FtpConfig {
  return { ip: '', port: 21, user: '', password: '', mode: 'passive', path: '' }
}

function emptyLocal(): LocalConfig {
  return { path: '' }
}

// ---------------------------------------------------------------------------
// Toggle Switch (inline, no external dependency)
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors
        ${checked ? 'bg-cyan-500/60 border-cyan-400/50' : 'bg-white/[0.08] border-white/[0.12]'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`pointer-events-none mt-0.5 ml-0.5 inline-block h-4 w-4 rounded-full bg-white shadow
          transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Destination Form
// ---------------------------------------------------------------------------

interface DestFormState {
  name: string
  type: DestType
  ftp: FtpConfig
  local: LocalConfig
}

function initFormState(dest?: Destination): DestFormState {
  if (!dest) {
    return { name: '', type: 'ftp', ftp: emptyFtp(), local: emptyLocal() }
  }
  const cfg = parseConfig(dest)
  return {
    name: dest.name,
    type: dest.type,
    ftp: dest.type === 'ftp' ? (cfg as FtpConfig) : emptyFtp(),
    local: dest.type === 'local' ? (cfg as LocalConfig) : emptyLocal(),
  }
}

interface DestFormProps {
  initial?: Destination
  onSave: (payload: { name: string; type: DestType; config: object }) => void
  onCancel: () => void
  saving: boolean
}

function DestForm({ initial, onSave, onCancel, saving }: DestFormProps) {
  const t = useTranslations('backup')
  const tc = useTranslations('backup.common')

  const [form, setForm] = useState<DestFormState>(() => initFormState(initial))

  const inputCls =
    'bg-white/[0.06] text-white/70 border border-white/[0.1] rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500/50'

  const setFtp = (patch: Partial<FtpConfig>) =>
    setForm((f) => ({ ...f, ftp: { ...f.ftp, ...patch } }))
  const setLocal = (patch: Partial<LocalConfig>) =>
    setForm((f) => ({ ...f, local: { ...f.local, ...patch } }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const config = form.type === 'ftp' ? form.ftp : form.local
    onSave({ name: form.name, type: form.type, config })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-3 border-t border-white/[0.06] pt-4">
      {/* Type selector */}
      <div className="flex gap-2">
        {(['ftp', 'local'] as DestType[]).map((tp) => (
          <button
            key={tp}
            type="button"
            onClick={() => setForm((f) => ({ ...f, type: tp }))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors
              ${form.type === tp
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-400'
                : 'border border-white/[0.1] text-white/40 hover:text-white/60'
              }`}
          >
            {tp === 'ftp' ? <Globe className="w-3.5 h-3.5" /> : <HardDrive className="w-3.5 h-3.5" />}
            {tp === 'ftp' ? t('destinations.ftp') : t('destinations.local')}
          </button>
        ))}
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs font-mono text-white/50 mb-1">Name</label>
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </div>

      {/* FTP fields */}
      {form.type === 'ftp' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.ip')}</label>
              <input
                className={inputCls}
                value={form.ftp.ip}
                onChange={(e) => setFtp({ ip: e.target.value })}
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.port')}</label>
              <input
                type="number"
                className={inputCls}
                value={form.ftp.port}
                onChange={(e) => setFtp({ port: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.username')}</label>
              <input
                className={inputCls}
                value={form.ftp.user}
                onChange={(e) => setFtp({ user: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.password')}</label>
              <input
                type="password"
                className={inputCls}
                value={form.ftp.password}
                onChange={(e) => setFtp({ password: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.mode')}</label>
            <div className="flex gap-4">
              {(['active', 'passive'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-white/60">
                  <input
                    type="radio"
                    name="ftp-mode"
                    value={m}
                    checked={form.ftp.mode === m}
                    onChange={() => setFtp({ mode: m })}
                    className="accent-cyan-400"
                  />
                  {m === 'active' ? t('destinations.active') : t('destinations.passive')}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.remotePath')}</label>
            <input
              className={inputCls}
              value={form.ftp.path}
              onChange={(e) => setFtp({ path: e.target.value })}
              placeholder="/backup"
            />
          </div>
        </>
      )}

      {/* Local fields */}
      {form.type === 'local' && (
        <div>
          <label className="block text-xs font-mono text-white/50 mb-1">{t('destinations.localPath')}</label>
          <input
            className={inputCls}
            value={form.local.path}
            onChange={(e) => setLocal({ path: e.target.value })}
            placeholder={t('destinations.defaultPath')}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="flex items-center gap-1.5 bg-cyan-500/20 border border-cyan-500/30 text-cyan-400
            text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-500/30
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {tc('save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-white/40 hover:text-white/60 text-xs font-mono px-3 py-1.5 transition-colors"
        >
          {tc('cancel')}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Destination Card
// ---------------------------------------------------------------------------

interface DestCardProps {
  dest: Destination
}

function DestCard({ dest }: DestCardProps) {
  const t = useTranslations('backup')
  const tc = useTranslations('backup.common')
  const queryClient = useQueryClient()

  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Toggle enabled
  const toggleMutation = useMutation({
    mutationFn: async (enabled: number) => {
      const res = await fetch('/api/backup/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dest.id, enabled }),
      })
      if (!res.ok) throw new Error('Toggle failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-destinations'] }),
  })

  // Update
  const updateMutation = useMutation({
    mutationFn: async (payload: { name: string; type: DestType; config: object }) => {
      const res = await fetch('/api/backup/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dest.id, ...payload }),
      })
      if (!res.ok) throw new Error('Update failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-destinations'] })
      setExpanded(false)
    },
  })

  // Delete
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/backup/destinations?id=${dest.id}`, { method: 'DELETE' })
      if (res.status === 409) {
        const body = await res.json()
        throw new Error(body.error ?? t('destinations.deleteBlocked'))
      }
      if (!res.ok) throw new Error('Delete failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-destinations'] })
    },
    onError: (err: Error) => {
      setDeleteError(err.message)
      setConfirmDelete(false)
    },
  })

  const cfg = parseConfig(dest)

  return (
    <div className={`cyber-card transition-all ${dest.enabled ? '' : 'opacity-60'}`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => { setExpanded((v) => !v); setDeleteError(null) }}
      >
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="shrink-0">
            {dest.type === 'ftp'
              ? <Globe className="w-4 h-4 text-cyan-400/70" />
              : <HardDrive className="w-4 h-4 text-cyan-400/70" />
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/85 font-medium">{dest.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className="text-xs px-1.5 py-0 font-mono">
                {dest.type === 'ftp' ? t('destinations.ftp') : t('destinations.local')}
              </Badge>
              {dest.type === 'ftp' && (
                <span className="font-mono text-xs text-white/35">
                  {(cfg as FtpConfig).ip}:{(cfg as FtpConfig).port}
                </span>
              )}
              {dest.type === 'local' && (
                <span className="font-mono text-xs text-white/35">
                  {(cfg as LocalConfig).path || '~/backup'}
                </span>
              )}
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
            <ToggleSwitch
              checked={dest.enabled === 1}
              onChange={(v) => toggleMutation.mutate(v ? 1 : 0)}
              disabled={toggleMutation.isPending}
            />
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              className="text-white/30 hover:text-white/60 transition-colors p-1 rounded border border-white/[0.08] hover:bg-white/[0.05]"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded edit form */}
      {expanded && (
        <div className="px-4 pb-4">
          <DestForm
            initial={dest}
            onSave={(payload) => updateMutation.mutate(payload)}
            onCancel={() => setExpanded(false)}
            saving={updateMutation.isPending}
          />

          {/* Delete section */}
          <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center gap-3 flex-wrap">
            {!confirmDelete ? (
              <button
                onClick={() => { setConfirmDelete(true); setDeleteError(null) }}
                className="flex items-center gap-1.5 text-red-400/50 hover:text-red-400 text-xs font-mono px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {tc('delete')}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-red-400">{t('destinations.deleteConfirm')}</span>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="text-red-400 hover:text-red-300 underline disabled:opacity-50"
                >
                  {tc('confirm')}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-white/40 hover:text-white/60 underline"
                >
                  {tc('cancel')}
                </button>
              </span>
            )}

            {deleteError && (
              <span className="text-xs font-mono text-red-400/80">{deleteError}</span>
            )}

            {updateMutation.isSuccess && (
              <span className="flex items-center gap-1 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                {tc('save')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BackupDestinations() {
  const t = useTranslations('backup')
  const queryClient = useQueryClient()

  const [showAdd, setShowAdd] = useState(false)

  const { data: destinations = [], isLoading } = useQuery<Destination[]>({
    queryKey: ['backup-destinations'],
    queryFn: async () => {
      const res = await fetch('/api/backup/destinations')
      if (!res.ok) throw new Error('Failed to load destinations')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; type: DestType; config: object }) => {
      const res = await fetch('/api/backup/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Create failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-destinations'] })
      setShowAdd(false)
    },
  })

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-mono tracking-wider text-white/70 uppercase">
          {t('destinations.title')}
        </h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400
            text-xs font-mono px-3 py-1.5 rounded-lg transition-all hover:bg-cyan-500/20"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('destinations.addNew')}
        </button>
      </div>

      {/* Inline add form */}
      {showAdd && (
        <div className="cyber-card p-4">
          <p className="text-xs font-mono text-white/50 uppercase tracking-wider mb-2">
            {t('destinations.addNew')}
          </p>
          <DestForm
            onSave={(payload) => createMutation.mutate(payload)}
            onCancel={() => setShowAdd(false)}
            saving={createMutation.isPending}
          />
        </div>
      )}

      {/* List */}
      {isLoading && (
        <div className="flex items-center gap-2 text-white/40 text-sm font-mono p-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      )}

      {!isLoading && destinations.length === 0 && !showAdd && (
        <div className="text-white/30 text-sm font-mono p-6 cyber-card text-center">
          — {t('destinations.addNew')} —
        </div>
      )}

      <div className="space-y-3">
        {destinations.map((dest) => (
          <DestCard key={dest.id} dest={dest} />
        ))}
      </div>
    </div>
  )
}
