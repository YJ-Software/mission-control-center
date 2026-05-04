'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2, CheckCircle2, Trash2, ChevronDown, FileDown, ArrowRight, Eye, EyeOff, Copy, Check } from 'lucide-react'

interface BrowserConfig {
  display: string
  resolution: string
  vnc_password: string
  vnc_port: string
  websockify_port: string
  [key: string]: string
}

export function SettingsPanel({ onUninstallAction, onUninstallStartAction }: { onUninstallAction: () => void; onUninstallStartAction?: () => void }) {
  const t = useTranslations('browser.settings')
  const tUninstall = useTranslations('browser.uninstall')
  const queryClient = useQueryClient()
  const [form, setForm] = useState<BrowserConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [deleteData, setDeleteData] = useState(false)
  const [uninstallLogs, setUninstallLogs] = useState<string[]>([])
  const [uninstallProgress, setUninstallProgress] = useState('')
  const [uninstallDone, setUninstallDone] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const { data: config } = useQuery<BrowserConfig>({
    queryKey: ['browser-config'],
    queryFn: () => fetch('/api/browser').then(r => r.json()),
  })

  useEffect(() => {
    if (config && !form) setForm(config)
  }, [config, form])

  useEffect(() => {
    if (logRef.current && logExpanded) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [uninstallLogs, logExpanded])

  const downloadLog = useCallback(() => {
    const content = uninstallLogs.join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `browser-uninstall-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [uninstallLogs])

  const saveMutation = useMutation({
    mutationFn: async (data: BrowserConfig) => {
      const res = await fetch('/api/browser', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['browser-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  if (!form) return null

  const update = (key: string, value: string) => setForm({ ...form, [key]: value })

  const resolutionOptions = ['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440']

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <h3 className="text-sm font-medium text-white mb-4">{t('title')}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-white/40 mb-1">{t('display')}</label>
          <input type="text" value={form.display || ''} onChange={e => update('display', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('resolution')}</label>
          <select value={form.resolution || '1920x1080'} onChange={e => update('resolution', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50">
            {resolutionOptions.map(r => (
              <option key={r} value={r} className="bg-gray-900">{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('vncPassword')}</label>
          <div className="relative flex items-center">
            <input type={showPassword ? 'text' : 'password'} value={form.vnc_password || ''} onChange={e => update('vnc_password', e.target.value)}
              className="w-full px-3 py-2 pr-16 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50" />
            <div className="absolute right-1.5 flex items-center gap-0.5">
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title={showPassword ? 'Hide' : 'Show'}>
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => { navigator.clipboard.writeText(form.vnc_password || ''); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title="Copy">
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('vncPort')}</label>
          <input type="text" value={form.vnc_port || ''} onChange={e => update('vnc_port', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('websockifyPort')}</label>
          <input type="text" value={form.websockify_port || ''} onChange={e => update('websockify_port', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('cdpPort')}</label>
          <input type="text" value={form.cdp_port || '9222'} onChange={e => update('cdp_port', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/[0.06]">
        <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-50">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? t('saved') : t('save')}
        </button>

        <span className="text-[11px] text-white/25 ml-auto">{t('restartRequired')}</span>
      </div>

      {/* Danger Zone: Uninstall */}
      <div className="mt-4 pt-4 border-t border-red-500/10 space-y-3">
        {uninstallDone ? (
          <>
            {/* Complete Banner */}
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                <span className="text-sm font-medium text-green-400">{tUninstall('complete')}</span>
              </div>
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['browser-config'] })
                  onUninstallAction()
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30"
              >
                {tUninstall('goToInstall')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Log */}
            {uninstallLogs.length > 0 && (
              <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => setLogExpanded(!logExpanded)}
                    className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/60 transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${logExpanded ? '' : '-rotate-90'}`} />
                    {tUninstall('log')} ({uninstallLogs.length})
                  </button>
                  <button
                    onClick={downloadLog}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <FileDown className="w-3 h-3" />
                    {tUninstall('downloadLog')}
                  </button>
                </div>
                {logExpanded && (
                  <div ref={logRef} className="max-h-48 overflow-y-auto font-mono text-[11px] text-white/50 space-y-0.5">
                    {uninstallLogs.map((line, i) => (
                      <div key={i} className="leading-relaxed">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : uninstalling ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              {uninstallProgress || tUninstall('uninstalling')}
            </div>
            {uninstallLogs.length > 0 && (
              <div ref={logRef} className="max-h-48 overflow-y-auto font-mono text-[11px] text-white/40 space-y-0.5">
                {uninstallLogs.map((line, i) => (
                  <div key={i} className="leading-relaxed">{line}</div>
                ))}
              </div>
            )}
          </div>
        ) : confirmUninstall ? (
          <div className="space-y-3">
            <span className="text-sm text-red-400/80">
              {tUninstall('confirm')}
            </span>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={deleteData}
                onChange={e => setDeleteData(e.target.checked)}
                className="accent-red-400"
              />
              <span className="text-white/60">{tUninstall('deleteData')}</span>
              {deleteData && <span className="text-[11px] text-red-400/80">{tUninstall('deleteDataWarn')}</span>}
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setConfirmUninstall(false)
                  setUninstalling(true)
                  setUninstallLogs([])
                  setUninstallProgress('')
                  setUninstallDone(false)
                  onUninstallStartAction?.()
                  setLogExpanded(true)
                  try {
                    const params = `?${deleteData ? 'deleteData=true' : ''}`
                    const res = await fetch(`/api/browser/install${params}`, { method: 'DELETE' })
                    const reader = res.body?.getReader()
                    const decoder = new TextDecoder()
                    if (!reader) throw new Error('No response stream')
                    let buffer = ''
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      buffer += decoder.decode(value, { stream: true })
                      const lines = buffer.split('\n')
                      buffer = lines.pop() ?? ''
                      for (const line of lines) {
                        if (!line.startsWith('data: ')) continue
                        try {
                          const event = JSON.parse(line.slice(6))
                          if (event.type === 'log') setUninstallLogs(prev => [...prev, event.data])
                          else if (event.type === 'progress') setUninstallProgress(event.data)
                          else if (event.type === 'done') setUninstallDone(true)
                        } catch {
                          // skip malformed SSE
                        }
                      }
                    }
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setUninstallLogs(prev => [...prev, `ERROR: ${msg}`])
                  } finally {
                    setUninstalling(false)
                    setUninstallDone(true)
                    setLogExpanded(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                {tUninstall('confirmYes')}
              </button>
              <button
                onClick={() => setConfirmUninstall(false)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/[0.06] text-white/40 hover:text-white/60 transition-colors"
              >
                {tUninstall('confirmNo')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmUninstall(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {tUninstall('button')}
          </button>
        )}
      </div>
    </div>
  )
}
