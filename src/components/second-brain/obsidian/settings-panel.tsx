'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2, CheckCircle2, AlertCircle, Trash2, ChevronDown, FileDown, ArrowRight, Eye, EyeOff, Copy, Check, ShieldCheck, RefreshCw, Cloud } from 'lucide-react'

interface ObsidianConfig {
  vault_path: string
  display: string
  resolution: string
  vnc_password: string
  vnc_port: string
  websockify_port: string
  ime_enabled: string
  couchdb_url: string
  couchdb_user: string
  couchdb_password: string
  couchdb_database: string
  [key: string]: string
}

type HttpsMode = 'off' | 'serve' | 'funnel'

interface TailscaleStatus {
  installed: boolean
  running: boolean
  ipv4: string | null
  dnsName: string | null
  port: number
  https: { mode: HttpsMode; url: string | null }
}

export function SettingsPanel({ onUninstallAction, onUninstallStartAction }: { onUninstallAction: () => void; onUninstallStartAction?: () => void }) {
  const t = useTranslations('secondBrain.obsidian.settings')
  const tUninstall = useTranslations('secondBrain.obsidian.uninstall')
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ObsidianConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<'all' | 'couchdb' | null>(null)
  const [uninstalling, setUninstalling] = useState<'all' | 'couchdb' | null>(null)
  const [deleteData, setDeleteData] = useState(false)
  const [uninstallLogs, setUninstallLogs] = useState<string[]>([])
  const [uninstallProgress, setUninstallProgress] = useState('')
  const [uninstallDone, setUninstallDone] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPassphrase, setCopiedPassphrase] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const { data: config } = useQuery<ObsidianConfig>({
    queryKey: ['obsidian-config'],
    queryFn: () => fetch('/api/second-brain/obsidian').then(r => r.json()),
  })

  const tailscaleEnabled = form?.tailscale_url_enabled === 'true'

  const { data: tailscale, refetch: refetchTailscale } = useQuery<TailscaleStatus>({
    queryKey: ['obsidian-tailscale'],
    queryFn: () => fetch('/api/second-brain/obsidian/tailscale').then(r => r.json()),
    enabled: tailscaleEnabled,
    refetchInterval: tailscaleEnabled ? 10000 : false,
  })

  const [funnelEnableUrl, setFunnelEnableUrl] = useState<string | null>(null)
  const [httpsCertEnableUrl, setHttpsCertEnableUrl] = useState<string | null>(null)
  const httpsModeMutation = useMutation({
    mutationFn: async (mode: HttpsMode) => {
      const res = await fetch(`/api/second-brain/obsidian/tailscale?action=https-set&mode=${mode}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setFunnelEnableUrl(typeof data.funnelEnableUrl === 'string' ? data.funnelEnableUrl : null)
        setHttpsCertEnableUrl(typeof data.httpsCertEnableUrl === 'string' ? data.httpsCertEnableUrl : null)
        throw new Error(data.error || 'https mode change failed')
      }
      setFunnelEnableUrl(null)
      setHttpsCertEnableUrl(null)
      return data
    },
    onSuccess: () => refetchTailscale(),
  })

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  function copyUrl(value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedUrl(value)
      setTimeout(() => setCopiedUrl(null), 1500)
    })
  }

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
    a.download = `obsidian-uninstall-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [uninstallLogs])

  const saveMutation = useMutation({
    mutationFn: async (data: ObsidianConfig) => {
      const res = await fetch('/api/second-brain/obsidian', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obsidian-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  async function testCouchDBConnection() {
    if (!form) return
    try {
      const res = await fetch('/api/second-brain/obsidian/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: form.couchdb_url,
          user: form.couchdb_user,
          password: form.couchdb_password,
        }),
      })
      const data = await res.json()
      setTestResult(data.ok ? 'ok' : 'fail')
    } catch {
      setTestResult('fail')
    }
    setTimeout(() => setTestResult(null), 3000)
  }

  if (!form) return null

  const update = (key: string, value: string) => setForm({ ...form, [key]: value })

  const resolutionOptions = ['800x600', '1024x768', '1280x720', '1280x1024', '1920x1080']

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <h3 className="text-sm font-medium text-white mb-4">{t('title')}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs text-white/40 mb-1">{t('vaultPath')}</label>
          <input type="text" value={form.vault_path} onChange={e => update('vault_path', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('display')}</label>
          <input type="text" value={form.display} onChange={e => update('display', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('resolution')}</label>
          <select value={form.resolution} onChange={e => update('resolution', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50">
            {resolutionOptions.map(r => (
              <option key={r} value={r} className="bg-gray-900">{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('vncPort')}</label>
          <input type="text" value={form.vnc_port} onChange={e => update('vnc_port', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('websockifyPort')}</label>
          <input type="text" value={form.websockify_port} onChange={e => update('websockify_port', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input type="checkbox" checked={form.ime_enabled === 'true'} onChange={e => update('ime_enabled', e.target.checked ? 'true' : 'false')} className="accent-cyan-400" />
            {t('imeEnabled')}
          </label>
        </div>

        <div className="col-span-2 mt-2 pt-3 border-t border-white/[0.06]" />

        <div className="col-span-2">
          <label className="block text-xs text-white/40 mb-1">{t('couchdbUrl')}</label>
          <input type="text" value={form.couchdb_url} onChange={e => update('couchdb_url', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('couchdbUser')}</label>
          <input type="text" value={form.couchdb_user} onChange={e => update('couchdb_user', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/40 mb-1">{t('couchdbPassword')}</label>
          <div className="relative flex items-center">
            <input type={showPassword ? 'text' : 'password'} value={form.couchdb_password} onChange={e => update('couchdb_password', e.target.value)}
              className="w-full px-3 py-2 pr-16 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50" />
            <div className="absolute right-1.5 flex items-center gap-0.5">
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title={showPassword ? 'Hide' : 'Show'}>
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => { navigator.clipboard.writeText(form.couchdb_password); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title="Copy">
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-white/40 mb-1">{t('couchdbDatabase')}</label>
          <input type="text" value={form.couchdb_database} onChange={e => update('couchdb_database', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50" />
        </div>

        {/* Remote Access Section */}
        <div className="col-span-2 mt-2 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <Cloud className="w-4 h-4 text-cyan-400/60" />
            <span className="text-sm font-medium text-white/80">{t('remoteAccessTitle')}</span>
          </div>
        </div>

        {/* Localhost URL (read-only) */}
        <div className="col-span-2">
          <label className="block text-[11px] text-white/40 mb-1">{t('localUrlLabel')}</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm font-mono text-white/70">
              {`http://localhost:${tailscale?.port ?? 5984}`}
            </div>
            <button type="button"
              onClick={() => copyUrl(`http://localhost:${tailscale?.port ?? 5984}`)}
              className="px-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
              title={t('copy')}>
              {copiedUrl === `http://localhost:${tailscale?.port ?? 5984}`
                ? <Check className="w-3.5 h-3.5 text-green-400" />
                : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Tailscale toggle */}
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input type="checkbox"
              checked={tailscaleEnabled}
              onChange={e => update('tailscale_url_enabled', e.target.checked ? 'true' : 'false')}
              className="accent-cyan-400" />
            {t('tailscaleEnable')}
          </label>
          <p className="text-[11px] text-white/30 mt-1 ml-5">{t('tailscaleEnableDesc')}</p>
        </div>

        {tailscaleEnabled && (
          <>
            {tailscale && !tailscale.installed && (
              <div className="col-span-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('tailscaleNotInstalled')}</span>
              </div>
            )}
            {tailscale && tailscale.installed && !tailscale.running && (
              <div className="col-span-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('tailscaleNotRunning')}</span>
              </div>
            )}
            {tailscale?.ipv4 && (() => {
              const url = `http://${tailscale.ipv4}:${tailscale.port}`
              return (
                <div className="col-span-2">
                  <label className="block text-[11px] text-white/40 mb-1">{t('tailscaleTailnetUrlLabel')}</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm font-mono text-white/70">{url}</div>
                    <button type="button" onClick={() => copyUrl(url)}
                      className="px-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
                      title={t('copy')}>
                      {copiedUrl === url ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )
            })()}
            {tailscale?.dnsName && (() => {
              const url = `http://${tailscale.dnsName}:${tailscale.port}`
              return (
                <div className="col-span-2">
                  <label className="block text-[11px] text-white/40 mb-1">{t('tailscaleDnsUrlLabel')}</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm font-mono text-white/70">{url}</div>
                    <button type="button" onClick={() => copyUrl(url)}
                      className="px-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
                      title={t('copy')}>
                      {copiedUrl === url ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )
            })()}

            {tailscale?.running && (
              <>
                <div className="col-span-2 mt-1 pt-2 border-t border-white/[0.04]">
                  <label className="block text-xs text-white/50 mb-1 font-medium">{t('httpsModeTitle')}</label>
                  <p className="text-[11px] text-white/30 mb-2">{t('httpsModeDesc')}</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={tailscale.https.mode}
                      disabled={httpsModeMutation.isPending}
                      onChange={e => httpsModeMutation.mutate(e.target.value as HttpsMode)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-cyan-500/50 disabled:opacity-50"
                    >
                      <option value="off" className="bg-gray-900">{t('httpsModeOff')}</option>
                      <option value="serve" className="bg-gray-900">{t('httpsModeServe')}</option>
                      <option value="funnel" className="bg-gray-900">{t('httpsModeFunnel')}</option>
                    </select>
                    {httpsModeMutation.isPending && (
                      <span className="flex items-center gap-1 text-[11px] text-amber-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t('httpsApplying')}
                      </span>
                    )}
                  </div>
                </div>

                {tailscale.https.mode === 'serve' && (
                  <div className="col-span-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{t('httpsServeDesc')}</span>
                  </div>
                )}

                {tailscale.https.mode === 'funnel' && (
                  <div className="col-span-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300/90">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{t('httpsFunnelWarning')}</span>
                  </div>
                )}

                {tailscale.https.mode !== 'off' && tailscale.https.url && (() => {
                  const isFunnel = tailscale.https.mode === 'funnel'
                  const label = isFunnel ? t('httpsFunnelUrlLabel') : t('httpsServeUrlLabel')
                  const url = tailscale.https.url
                  return (
                    <div className="col-span-2">
                      <label className={`block text-[11px] mb-1 ${isFunnel ? 'text-red-300/80' : 'text-emerald-300/80'}`}>
                        {label}
                      </label>
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 px-3 py-2 rounded-lg text-sm font-mono ${isFunnel
                          ? 'bg-red-500/[0.06] border border-red-500/20 text-red-200/90'
                          : 'bg-emerald-500/[0.05] border border-emerald-500/20 text-emerald-200/90'}`}>
                          {url}
                        </div>
                        <button type="button" onClick={() => copyUrl(url)}
                          className="px-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
                          title={t('copy')}>
                          {copiedUrl === url
                            ? <Check className="w-3.5 h-3.5 text-green-400" />
                            : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {httpsModeMutation.isError && (
                  <div className="col-span-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div className="flex-1 break-words">
                        {httpsCertEnableUrl ? (
                          <>
                            <div>{t('httpsCertsNotEnabledOnTailnet')}</div>
                            <a href={httpsCertEnableUrl} target="_blank" rel="noopener noreferrer"
                              className="font-mono underline text-cyan-300 hover:text-cyan-200 break-all">
                              {httpsCertEnableUrl}
                            </a>
                          </>
                        ) : funnelEnableUrl ? (
                          <>
                            <div>{t('funnelNotEnabledOnTailnet')}</div>
                            <a href={funnelEnableUrl} target="_blank" rel="noopener noreferrer"
                              className="font-mono underline text-cyan-300 hover:text-cyan-200 break-all">
                              {funnelEnableUrl}
                            </a>
                          </>
                        ) : (
                          (httpsModeMutation.error as Error).message
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* E2EE Section */}
        <div className="col-span-2 mt-2 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-cyan-400/60" />
            <span className="text-sm font-medium text-white/80">{t('e2eeTitle')}</span>
          </div>
        </div>

        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input type="checkbox" checked={form.e2ee_enabled === 'true'} onChange={e => update('e2ee_enabled', e.target.checked ? 'true' : 'false')} className="accent-cyan-400" />
            {t('e2eeEnabled')}
          </label>
          <p className="text-[11px] text-white/30 mt-1 ml-5">{t('e2eeEnabledDesc')}</p>
        </div>

        {form.e2ee_enabled === 'true' && (
          <>
            <div className="col-span-2">
              <label className="block text-xs text-white/40 mb-1">{t('e2eePassphrase')}</label>
              <div className="relative flex items-center">
                <input type={showPassphrase ? 'text' : 'password'} value={form.e2ee_passphrase || ''} onChange={e => update('e2ee_passphrase', e.target.value)}
                  className="w-full px-3 py-2 pr-24 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50" />
                <div className="absolute right-1.5 flex items-center gap-0.5">
                  <button type="button" onClick={() => setShowPassphrase(!showPassphrase)}
                    className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title={showPassphrase ? 'Hide' : 'Show'}>
                    {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(form.e2ee_passphrase || ''); setCopiedPassphrase(true); setTimeout(() => setCopiedPassphrase(false), 1500) }}
                    className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title="Copy">
                    {copiedPassphrase ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => {
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
                    const arr = new Uint8Array(32)
                    crypto.getRandomValues(arr)
                    update('e2ee_passphrase', Array.from(arr, b => chars[b % chars.length]).join(''))
                  }}
                    className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors" title={t('e2eeRegenerate')}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-amber-400/70 mt-1.5">{t('e2eePassphraseWarn')}</p>
            </div>

            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
                <input type="checkbox" checked={form.e2ee_path_obfuscation === 'true'} onChange={e => update('e2ee_path_obfuscation', e.target.checked ? 'true' : 'false')} className="accent-cyan-400" />
                {t('e2eePathObfuscation')}
              </label>
              <p className="text-[11px] text-white/30 mt-1 ml-5">{t('e2eePathObfuscationDesc')}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/[0.06]">
        <button onClick={testCouchDBConnection}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/80 transition-colors">
          {testResult === 'ok' ? (
            <span className="flex items-center gap-1 text-green-400"><CheckCircle2 className="w-3.5 h-3.5" />{t('connectionOk')}</span>
          ) : testResult === 'fail' ? (
            <span className="flex items-center gap-1 text-red-400"><AlertCircle className="w-3.5 h-3.5" />{t('connectionFail')}</span>
          ) : t('testConnection')}
        </button>

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
                  queryClient.invalidateQueries({ queryKey: ['obsidian-config'] })
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
        ) : confirmTarget ? (
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
                  setConfirmTarget(null)
                  setUninstalling('all')
                  setUninstallLogs([])
                  setUninstallProgress('')
                  setUninstallDone(false)
                  onUninstallStartAction?.()
                  setLogExpanded(true)
                  try {
                    const params = `?target=all${deleteData ? '&deleteData=true' : ''}`
                    const res = await fetch(`/api/second-brain/obsidian/install${params}`, { method: 'DELETE' })
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
                        } catch {}
                      }
                    }
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err)
                    setUninstallLogs(prev => [...prev, `ERROR: ${msg}`])
                  } finally {
                    setUninstalling(null)
                    setUninstallDone(true)
                    setLogExpanded(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                {tUninstall('confirmYes')}
              </button>
              <button
                onClick={() => setConfirmTarget(null)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white/[0.06] text-white/40 hover:text-white/60 transition-colors"
              >
                {tUninstall('confirmNo')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmTarget('all')}
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
