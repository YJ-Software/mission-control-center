'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  LogIn, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Monitor, RefreshCw, ExternalLink, BookOpen, FileText, Plus, Trash2, ArrowUpCircle,
} from 'lucide-react'
import { NotebookDetail } from './notebook-detail'

interface Notebook {
  id: string
  title: string
  source_count: number
  updated_at: string
}

interface NlmStatus {
  installed: boolean
  authenticated: boolean
  output?: string
  notebooks?: Notebook[]
  version?: string
  updateAvailable?: boolean
}

interface BrowserConfig {
  websockify_port: string
  vnc_password?: string
  installed: string
  [key: string]: string | undefined
}

export function NotebookLMDashboard() {
  const t = useTranslations('secondBrain.notebooklm')
  const queryClient = useQueryClient()

  const [loggingIn, setLoggingIn] = useState(false)
  const [loginOutput, setLoginOutput] = useState<string | null>(null)
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')

  const { data: nlmStatus, isLoading: nlmLoading } = useQuery<NlmStatus>({
    queryKey: ['nlm-status'],
    queryFn: async () => {
      const res = await fetch('/api/second-brain/notebooklm')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const { data: browserConfig } = useQuery<BrowserConfig>({
    queryKey: ['browser-config'],
    queryFn: async () => {
      const res = await fetch('/api/browser')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const websockifyPort = parseInt(browserConfig?.websockify_port || '6081')
  const vncPassword = browserConfig?.vnc_password
  const browserInstalled = browserConfig?.installed === 'true'

  const [upgrading, setUpgrading] = useState(false)
  const upgradeTriggered = useRef(false)

  // Auto-upgrade when update available
  useEffect(() => {
    if (nlmStatus?.updateAvailable && !upgrading && !upgradeTriggered.current) {
      upgradeTriggered.current = true
      setUpgrading(true)
      fetch('/api/second-brain/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upgrade' }),
      })
        .then(() => fetch('/api/setup/notebooklm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'patch' }),
        }))
        .then(() => queryClient.invalidateQueries({ queryKey: ['nlm-status'] }))
        .finally(() => setUpgrading(false))
    }
  }, [nlmStatus?.updateAvailable, upgrading, queryClient])

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch('/api/second-brain/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', title }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nlm-status'] })
      setShowCreate(false)
      setCreateTitle('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (notebookId: string) => {
      const res = await fetch('/api/second-brain/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', notebookId }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nlm-status'] }),
  })

  async function handleLogin() {
    setLoggingIn(true)
    setLoginOutput(null)
    try {
      const res = await fetch('/api/second-brain/notebooklm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login' }),
      })
      const data = await res.json()
      setLoginOutput(data.output || '')
      queryClient.invalidateQueries({ queryKey: ['nlm-status'] })
    } catch {
      setLoginOutput('Login request failed')
    } finally {
      setLoggingIn(false)
    }
  }

  if (nlmLoading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin text-white/30" /></div>
  }

  if (!nlmStatus?.installed) {
    return (
      <div className="cyber-card p-8 flex flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="w-8 h-8 text-yellow-400/60" />
        <p className="text-sm text-white/60">{t('notInstalled')}</p>
        <a href="/setup" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors underline underline-offset-2">{t('goSetup')}</a>
      </div>
    )
  }

  // Main view — left: notebooks, right: VNC browser
  return (
    <div className="flex gap-4">
      {/* Left panel — notebooks */}
      <div className="min-w-0 space-y-4 overflow-y-auto" style={{ height: '740px', flex: '3.5' }}>
      {selectedNotebook ? (
        <NotebookDetail
          notebookId={selectedNotebook.id}
          notebookTitle={selectedNotebook.title}
          sourceCount={selectedNotebook.source_count}
          updatedAt={selectedNotebook.updated_at}
          onBack={() => setSelectedNotebook(null)}
        />
      ) : (
        <>
      {/* Auth status card */}
      <div className="cyber-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {nlmStatus.authenticated ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400/60" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-white">
                  {nlmStatus.authenticated ? t('authenticated') : t('notAuthenticated')}
                </h3>
                {nlmStatus.version && (
                  <span className="text-[11px] font-mono text-white/25">v{nlmStatus.version}</span>
                )}
                {upgrading && (
                  <span className="flex items-center gap-1 text-[11px] text-cyan-400/70">
                    <ArrowUpCircle className="w-3 h-3 animate-spin" />
                    {t('upgrading')}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/40 mt-0.5">
                {nlmStatus.authenticated ? t('authDesc') : t('notAuthDesc')}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogin}
            disabled={loggingIn || !browserInstalled}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loggingIn ? t('loggingIn') : t('login')}
          </button>
        </div>
        {!browserInstalled && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {t('browserRequired')}
          </div>
        )}
      </div>

      {/* Login output */}
      {loginOutput && (
        <div className="cyber-card p-3">
          <pre className="font-mono text-xs text-white/60 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">{loginOutput}</pre>
        </div>
      )}

      {/* Notebooks list */}
      {nlmStatus.authenticated && (
        <div className="cyber-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-medium text-white">{t('notebooks')}</h3>
              <span className="text-xs text-white/30 font-mono">{nlmStatus.notebooks?.length || 0}</span>
            </div>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('createNotebook')}
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="flex gap-2 mb-3 pb-3 border-b border-white/[0.06]">
              <input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder={t('createPlaceholder')}
                className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && createTitle.trim()) createMutation.mutate(createTitle.trim()) }}
              />
              <button
                onClick={() => createMutation.mutate(createTitle.trim())}
                disabled={createMutation.isPending || !createTitle.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40"
              >
                {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('createNotebook')}
              </button>
            </div>
          )}

          {/* Notebook rows */}
          {(!nlmStatus.notebooks || nlmStatus.notebooks.length === 0) ? (
            <div className="text-center py-6 text-white/30 text-sm">{t('noNotebooks')}</div>
          ) : (
            <div className="space-y-1">
              {nlmStatus.notebooks.map((nb) => (
                <div key={nb.id} className="flex items-center gap-3 rounded-lg hover:bg-white/[0.04] transition-colors group">
                  <button
                    onClick={() => setSelectedNotebook(nb)}
                    className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5 text-left"
                  >
                    <FileText className="w-4 h-4 text-white/20 group-hover:text-cyan-400/60 transition-colors shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/80 group-hover:text-white truncate">{nb.title}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-white/30 font-mono">{t('sources')}: {nb.source_count}</span>
                        <span className="text-[11px] text-white/20 font-mono">{new Date(nb.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={`https://notebooklm.google.com/notebook/${nb.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-white/20 hover:text-white/50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm(t('confirmDelete'))) deleteMutation.mutate(nb.id) }}
                      className="p-1.5 text-red-400/30 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

        </>
      )}
      </div>

      {/* Right panel — VNC browser */}
      {browserInstalled && vncPassword && (
        <div className="min-w-0" style={{ flex: '6.5' }}>
          <EmbeddedVncViewer websockifyPort={websockifyPort} vncPassword={vncPassword} t={t} />
        </div>
      )}
    </div>
  )
}

function EmbeddedVncViewer({ websockifyPort, vncPassword, t }: {
  websockifyPort: number
  vncPassword: string
  t: ReturnType<typeof useTranslations>
}) {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [iframeKey, setIframeKey] = useState(0)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const passwordParam = `&password=${encodeURIComponent(vncPassword)}`
  const novncUrl = `http://${host}:${websockifyPort}/vnc.html?autoconnect=true&resize=scale${passwordParam}`

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-white/40" />
          <h3 className="text-sm font-medium text-white">{t('vncTitle')}</h3>
          {status === 'loading' && <span className="text-[11px] font-mono text-yellow-400">{t('vncConnecting')}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setStatus('loading'); setIframeKey(k => k + 1) }} className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-white/80 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a href={novncUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white/[0.08] text-white/70 hover:bg-white/[0.15] transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
            {t('vncNewTab')}
          </a>
        </div>
      </div>
      <div className="relative w-full bg-black" style={{ minHeight: '700px' }}>
        {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center z-10"><Loader2 className="w-6 h-6 animate-spin text-white/30" /></div>}
        <iframe key={iframeKey} src={novncUrl} onLoad={() => setStatus('ready')} className="w-full border-0" style={{ height: '700px' }} allow="clipboard-read; clipboard-write" />
      </div>
    </div>
  )
}
