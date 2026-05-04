'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, CheckCircle2, AlertCircle, ArrowUpCircle, Package, Settings, Save } from 'lucide-react'

interface UpgradeStatus {
  mode: 'release' | 'dev' | 'unknown'
  prefix: string
  state: string
  service: string
  current: { version: string; commit: string | null; buildTime: string }
  manifestUrl: string | null
}

interface CheckResult {
  current: string
  latest: string
  hasUpdate: boolean
  releaseDate: string | null
  notes: string | null
  artifact: { url: string; sha256: string | null; size: number | null } | null
  error?: string
}

type Phase = 'idle' | 'checking' | 'uploading' | 'applying' | 'restarting' | 'done' | 'error'

export function UpgradeCard() {
  const [status, setStatus] = useState<UpgradeStatus | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string>('')
  const [showManifestConfig, setShowManifestConfig] = useState(false)
  const [manifestUrlDraft, setManifestUrlDraft] = useState('')
  const [manifestSaved, setManifestSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadStatus = useCallback(() => {
    fetch('/api/upgrade/status')
      .then((r) => r.json())
      .then((data: UpgradeStatus) => {
        setStatus(data)
        setManifestUrlDraft(data.manifestUrl || '')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const saveManifestUrl = async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'upgrade.manifestUrl': manifestUrlDraft.trim() }),
      })
      setManifestSaved(true)
      setTimeout(() => setManifestSaved(false), 2000)
      // Refresh status so the rest of the card (Check button) picks up the
      // new URL without a page reload.
      loadStatus()
      setCheck(null)
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleCheck = async () => {
    setPhase('checking')
    setMessage('')
    try {
      const res = await fetch('/api/upgrade/check')
      const data = (await res.json()) as CheckResult
      if (!res.ok) {
        setPhase('error')
        setMessage(data.error || `check failed (${res.status})`)
        return
      }
      setCheck(data)
      setPhase('idle')
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const pollForNewVersion = useCallback(
    async (expectedVersion: string, timeoutMs = 120_000) => {
      setPhase('restarting')
      setMessage(`Waiting for v${expectedVersion}…`)
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const res = await fetch('/api/health', { cache: 'no-store' })
          if (res.ok) {
            const health = (await res.json()) as { version?: string }
            if (health.version === expectedVersion) {
              setPhase('done')
              setMessage(`Upgraded to v${expectedVersion}`)
              // Reload the page so the new version's UI takes over.
              setTimeout(() => window.location.reload(), 1200)
              return
            }
          }
        } catch {
          // service restart in flight — expected
        }
      }
      setPhase('error')
      setMessage('Timed out waiting for the new version. Check journalctl.')
    },
    [],
  )

  const handleFileUpload = async (file: File) => {
    setPhase('uploading')
    setMessage(`Uploading ${file.name}…`)
    try {
      setPhase('applying')
      const res = await fetch('/api/upgrade/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      const data = await res.json()
      if (!res.ok) {
        setPhase('error')
        setMessage(data.error || `apply failed (${res.status})`)
        return
      }
      await pollForNewVersion(data.version)
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleApplyFromManifest = async () => {
    if (!check?.artifact) return
    setPhase('applying')
    setMessage(`Downloading v${check.latest}…`)
    try {
      const res = await fetch('/api/upgrade/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: check.artifact.url, sha256: check.artifact.sha256 || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPhase('error')
        setMessage(data.error || `apply failed (${res.status})`)
        return
      }
      await pollForNewVersion(data.version)
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = phase === 'checking' || phase === 'uploading' || phase === 'applying' || phase === 'restarting'
  const disabledForMode = status?.mode !== 'release'

  return (
    <div className="cyber-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Package className="w-4 h-4 text-cyan-400" />
          Updates
        </h3>
        <button
          onClick={() => setShowManifestConfig((v) => !v)}
          className="p-1.5 rounded-lg text-white/35 hover:text-white/70 hover:bg-white/[0.05] transition-colors"
          title="Configure manifest URL"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Manifest URL config (collapsible) */}
      {showManifestConfig && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
          <label className="font-mono text-[10px] tracking-wide text-white/40 block">
            Manifest URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={manifestUrlDraft}
              onChange={(e) => setManifestUrlDraft(e.target.value)}
              placeholder="https://example.com/mission-control/manifest.json"
              className="font-mono text-xs bg-white/[0.04] border border-white/[0.1] text-white/85 focus:border-white/25 focus:bg-white/[0.07] outline-none px-3 py-2 tracking-wide w-full rounded-xl transition-all"
            />
            <button
              onClick={saveManifestUrl}
              className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-3 py-2 flex items-center gap-1 text-sm shrink-0"
            >
              {manifestSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {manifestSaved ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="font-mono text-[10px] text-white/30 leading-relaxed">
            Expected manifest shape: <code className="text-cyan-400/60">{`{ latest: { version, artifacts: [{ platform, arch, url, sha256? }] } }`}</code>
          </p>
        </div>
      )}

      {/* Current version */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/75">
            Current: <span className="font-mono text-cyan-300">v{status?.current.version || '—'}</span>
            {status?.current.commit && (
              <span className="font-mono text-[11px] text-white/40"> · {status.current.commit}</span>
            )}
          </p>
          <p className="font-mono text-[10px] tracking-wide text-white/35 mt-0.5">
            mode: {status?.mode || '…'}
            {status?.service && status.mode === 'release' && ` · service: ${status.service}`}
          </p>
        </div>
      </div>

      {/* Dev-mode notice */}
      {status && disabledForMode && (
        <div className="flex items-start gap-2 text-[11px] text-amber-300/70 bg-amber-400/5 border border-amber-400/15 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            UI upgrade only works in release mode (installed via{' '}
            <code className="font-mono">deploy/release/install.sh</code>). This looks like a dev install.
          </span>
        </div>
      )}

      {/* Manifest check */}
      {status?.manifestUrl && status.mode === 'release' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheck}
              disabled={busy}
              className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm disabled:opacity-40"
            >
              {phase === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Check for updates
            </button>
            <span className="font-mono text-[10px] text-white/30 truncate">
              {status.manifestUrl}
            </span>
          </div>

          {check && !check.hasUpdate && (
            <p className="text-[11px] text-white/40">
              You are on the latest version (v{check.current}).
            </p>
          )}

          {check?.hasUpdate && check.artifact && (
            <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-white/85">
                    v{check.latest} available
                    <span className="text-white/30 text-xs"> (from v{check.current})</span>
                  </p>
                  {check.releaseDate && (
                    <p className="font-mono text-[10px] text-white/35">{check.releaseDate}</p>
                  )}
                </div>
                <button
                  onClick={handleApplyFromManifest}
                  disabled={busy}
                  className="bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/25 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm disabled:opacity-40"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  Upgrade
                </button>
              </div>
              {check.notes && (
                <pre className="font-mono text-[11px] text-white/55 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {check.notes}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual upload */}
      {status?.mode === 'release' && (
        <div className="space-y-1 pt-1 border-t border-white/[0.05]">
          <p className="font-mono text-[10px] tracking-wide text-white/35">
            Or upgrade from a tarball you have locally:
          </p>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar.gz,application/gzip,application/x-gzip,application/x-tar"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileUpload(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="bg-white/[0.06] border border-white/[0.12] text-white/70 hover:bg-white/[0.1] transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm disabled:opacity-40"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              Choose tarball…
            </button>
          </div>
        </div>
      )}

      {/* Phase indicator */}
      {phase !== 'idle' && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            phase === 'error'
              ? 'bg-red-500/10 border border-red-500/25 text-red-300/85'
              : phase === 'done'
                ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300/85'
                : 'bg-cyan-500/10 border border-cyan-500/25 text-cyan-300/85'
          }`}
        >
          {phase === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          ) : phase === 'done' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          )}
          <span className="font-mono">{message || phase}</span>
        </div>
      )}
    </div>
  )
}
