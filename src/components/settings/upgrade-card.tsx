'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2, CheckCircle2, AlertCircle, ArrowUpCircle, Package, Settings, Save, Terminal, Copy, Check, ScrollText } from 'lucide-react'

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

interface OpenclawCheck {
  installed: boolean
  current: string | null
  latest: string | null
  latestPublishedAt?: string | null
  hasUpdate: boolean
  installCommand: string
  error?: string
}

type Phase = 'idle' | 'checking' | 'uploading' | 'applying' | 'restarting' | 'done' | 'error'

interface JobStartResponse { success?: boolean; jobId?: string; error?: string }

export function UpgradeCard() {
  const [status, setStatus] = useState<UpgradeStatus | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string>('')
  const [showManifestConfig, setShowManifestConfig] = useState(false)
  const [manifestUrlDraft, setManifestUrlDraft] = useState('')
  const [manifestSaved, setManifestSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [openclaw, setOpenclaw] = useState<OpenclawCheck | null>(null)
  const [openclawChecking, setOpenclawChecking] = useState(false)
  const [openclawCopied, setOpenclawCopied] = useState(false)
  const [openclawJobId, setOpenclawJobId] = useState<string | null>(null)
  const [openclawUpgrading, setOpenclawUpgrading] = useState(false)
  const [mccJobId, setMccJobId] = useState<string | null>(null)

  const loadOpenclawCheck = useCallback(async () => {
    setOpenclawChecking(true)
    try {
      const res = await fetch('/api/upgrade/openclaw-check')
      const data = (await res.json()) as OpenclawCheck
      setOpenclaw(data)
    } catch (e) {
      setOpenclaw({
        installed: false,
        current: null,
        latest: null,
        hasUpdate: false,
        installCommand: 'npm install -g openclaw@latest',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setOpenclawChecking(false)
    }
  }, [])

  useEffect(() => {
    loadOpenclawCheck()
  }, [loadOpenclawCheck])

  const copyOpenclawCommand = () => {
    if (!openclaw) return
    navigator.clipboard.writeText(openclaw.installCommand).then(() => {
      setOpenclawCopied(true)
      setTimeout(() => setOpenclawCopied(false), 2000)
    })
  }

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

  const handleFileUpload = async (file: File) => {
    setPhase('uploading')
    setMessage(`Uploading ${file.name}…`)
    try {
      setPhase('applying')
      const res = await fetch('/api/upgrade/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-triggered-by': 'settings-card' },
        body: file,
      })
      const data = (await res.json()) as { ok?: boolean; jobId?: string; error?: string }
      if (!res.ok) {
        setPhase('error')
        setMessage(data.error || `apply failed (${res.status})`)
        return
      }
      if (data.jobId) setMccJobId(data.jobId)
      setPhase('restarting')
      setMessage('Restart scheduled — see System Log for live progress')
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleApplyFromManifest = async () => {
    if (!check?.artifact) return
    setPhase('applying')
    setMessage(`Starting upgrade to v${check.latest}…`)
    try {
      const res = await fetch('/api/upgrade/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: check.artifact.url,
          sha256: check.artifact.sha256 || undefined,
          triggeredBy: 'settings-card',
        }),
      })
      const data = (await res.json()) as { ok?: boolean; jobId?: string; error?: string }
      if (!res.ok) {
        setPhase('error')
        setMessage(data.error || `apply failed (${res.status})`)
        return
      }
      if (data.jobId) setMccJobId(data.jobId)
      setPhase('restarting')
      setMessage('Restart scheduled — see System Log for live progress')
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleUpgradeOpenclaw = async () => {
    setOpenclawUpgrading(true)
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-openclaw', triggeredBy: 'settings-card' }),
      })
      const data = (await res.json()) as JobStartResponse
      if (data?.jobId) setOpenclawJobId(data.jobId)
      // Refresh detection so the badge clears once npm finishes.
      setTimeout(() => loadOpenclawCheck(), 30_000)
    } finally {
      setOpenclawUpgrading(false)
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

      {/* OpenClaw upgrade check (detection only — no one-click) */}
      <div className="pt-3 border-t border-white/[0.05] space-y-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-purple-400/70" />
          <span className="text-sm text-white/80 font-medium">OpenClaw CLI</span>
          {openclawChecking && <Loader2 className="w-3 h-3 animate-spin text-white/40" />}
          <button
            onClick={loadOpenclawCheck}
            disabled={openclawChecking}
            className="ml-auto text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
          >
            Re-check
          </button>
        </div>

        {openclaw && !openclaw.error && !openclaw.installed && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>OpenClaw CLI not found on this host. Install it once with the command below.</span>
          </div>
        )}

        {openclaw && openclaw.error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{openclaw.error}</span>
          </div>
        )}

        {openclaw && openclaw.installed && !openclaw.error && (
          <div className="font-mono text-[11px] text-white/55">
            <div>current: <span className="text-white/85">{openclaw.current}</span></div>
            <div>latest:&nbsp; <span className="text-white/85">{openclaw.latest}</span>{openclaw.latestPublishedAt && (
              <span className="text-white/30"> ({new Date(openclaw.latestPublishedAt).toISOString().slice(0, 10)})</span>
            )}</div>
          </div>
        )}

        {openclaw && openclaw.hasUpdate && (
          <div className="rounded-xl border border-purple-400/25 bg-purple-400/[0.04] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-white/85">
                OpenClaw v{openclaw.latest} available
                <span className="text-white/30 text-xs"> (from v{openclaw.current})</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleUpgradeOpenclaw}
                  disabled={openclawUpgrading}
                  className="bg-purple-400/15 border border-purple-400/40 text-purple-300 hover:bg-purple-400/25 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm disabled:opacity-40"
                >
                  {openclawUpgrading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                  )}
                  Upgrade
                </button>
                {openclawJobId && (
                  <Link
                    href={`/system-log?job=${openclawJobId}`}
                    className="flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-mono text-purple-300/80 hover:text-purple-200 hover:bg-purple-500/10 border border-purple-500/20 transition-colors"
                  >
                    <ScrollText className="w-3 h-3" />
                    View log
                  </Link>
                )}
              </div>
            </div>
            <details className="text-[11px] text-white/55">
              <summary className="cursor-pointer text-white/40 hover:text-white/70">Or run on the server yourself</summary>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-[12px] font-mono text-cyan-300 select-all break-all">
                  {openclaw.installCommand}
                </code>
                <button
                  onClick={copyOpenclawCommand}
                  className="px-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/80 transition-colors"
                  title="Copy"
                >
                  {openclawCopied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </details>
          </div>
        )}

        {openclaw && openclaw.installed && !openclaw.hasUpdate && !openclaw.error && (
          <p className="text-[11px] text-white/40">
            OpenClaw is up to date (v{openclaw.current}).
          </p>
        )}
      </div>

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
          {mccJobId && (
            <Link
              href={`/system-log?job=${mccJobId}`}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono text-cyan-300/85 hover:text-cyan-200 hover:bg-cyan-500/10 border border-cyan-500/30"
            >
              <ScrollText className="w-3 h-3" />
              View log
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
