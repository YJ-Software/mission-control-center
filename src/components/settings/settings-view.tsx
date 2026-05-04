'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useWebSocket } from '@/store/websocket'
import {
  Database, Zap, Bot, Globe, Key,
  CheckCircle2, XCircle, Download, Save
} from 'lucide-react'
import { UpgradeCard } from './upgrade-card'

export function SettingsView() {
  const t = useTranslations('settings')
  const { connected } = useWebSocket()
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [token, setToken] = useState('')
  const [gatewaySaved, setGatewaySaved] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [gogAccount, setGogAccount] = useState('')
  const [gogSaved, setGogSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/env')
      .then(r => r.json())
      .then(data => {
        setGatewayUrl(data.OPENCLAW_GATEWAY_WS || 'ws://127.0.0.1:18789')
        setToken(data.OPENCLAW_TOKEN || '')
      })
      .catch(() => {})
    fetch('/api/settings?prefix=gog.')
      .then(r => r.json())
      .then(data => { if (data['gog.account']) setGogAccount(data['gog.account']) })
      .catch(() => {})
  }, [])

  const saveGogAccount = async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'gog.account': gogAccount }),
    })
    setGogSaved(true)
    setTimeout(() => setGogSaved(false), 2000)
  }

  const gogDesc = gogAccount ? `via gogcli — ${gogAccount}` : t('notConfigured')
  const gogStatus = gogAccount ? true : null

  const integrations = [
    { name: 'OpenClaw Gateway', status: connected, description: t('wsConnectionStatus') },
    { name: 'Google Calendar', status: gogStatus, description: gogDesc },
    { name: 'Gmail', status: gogStatus, description: gogDesc },
    { name: 'Telegram', status: null, description: t('telegramChannel') },
    { name: 'SQLite Database', status: true, description: '~/.mission-control/db.sqlite' },
    { name: 'LanceDB Memory', status: null, description: 'memory-lancedb-pro' },
  ]

  const handleBackup = async () => {
    setBackingUp(true)
    try {
      const res = await fetch('/api/settings/backup', { method: 'POST' })
      const data = await res.json()
      if (data.ok) alert(t('backupSuccess', { path: data.path }))
      else alert(t('backupFailed') + '：' + data.error)
    } catch {
      alert(t('backupFailed'))
    } finally {
      setBackingUp(false)
    }
  }

  const glassInput = "font-mono text-sm bg-white/[0.04] border border-white/[0.1] text-white/85 focus:border-white/25 focus:bg-white/[0.07] outline-none px-3 py-2 tracking-wide w-full rounded-xl transition-all"

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Updates */}
      <UpgradeCard />

      {/* Gateway Settings */}
      <div className="cyber-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          {t('connectionSettings')}
        </h3>
        <div>
          <label className="font-mono text-[10px] tracking-widests text-white/35 mb-1 block">Gateway URL</label>
          <input value={gatewayUrl} onChange={e => setGatewayUrl(e.target.value)} className={glassInput} />
        </div>
        <div>
          <label className="font-mono text-[10px] tracking-widests text-white/35 mb-1 block">{t('authToken')}</label>
          <input type="password" value={token} onChange={e => setToken(e.target.value)} className={glassInput} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={connected ? 'status-dot-active' : 'status-dot-error'} />
            <span className="font-mono text-xs text-white/40 tracking-wide">
              {connected ? t('wsConnected') : t('wsDisconnected')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await fetch('/api/settings/env', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    OPENCLAW_GATEWAY_WS: gatewayUrl,
                    OPENCLAW_GATEWAY_HTTP: gatewayUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
                    OPENCLAW_TOKEN: token,
                  }),
                })
                setGatewaySaved(true)
                setTimeout(() => setGatewaySaved(false), 3000)
              }}
              className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm"
            >
              {gatewaySaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {gatewaySaved ? t('saved') : t('save')}
            </button>
          </div>
        </div>
        {gatewaySaved && (
          <p className="font-mono text-[10px] text-yellow-400/70 tracking-wide">{t('restartRequired')}</p>
        )}
      </div>

      {/* Integration Status */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Globe className="w-4 h-4 text-purple-400" />
          {t('integrationStatus')}
        </h3>
        <div className="space-y-0">
          {integrations.map(integration => (
            <div key={integration.name} className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
              <div>
                <p className="font-medium text-white/80 text-sm">{integration.name}</p>
                <p className="font-mono text-[10px] text-white/35 tracking-wide">{integration.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {integration.status === true ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-mono text-[9px] tracking-widests px-2 py-0.5 rounded border border-emerald-400/25 text-emerald-400/70">{t('connected')}</span>
                  </>
                ) : integration.status === false ? (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="font-mono text-[9px] tracking-widests px-2 py-0.5 rounded border border-red-400/25 text-red-400/70">{t('disconnected')}</span>
                  </>
                ) : (
                  <span className="font-mono text-[9px] tracking-widests px-2 py-0.5 rounded border border-white/[0.1] text-white/35">{t('notConfigured')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Backup */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Database className="w-4 h-4 text-yellow-400" />
          {t('backupSettings')}
        </h3>
        <p className="font-mono text-xs text-white/35 tracking-wide">
          {t('backupDescription')}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            {backingUp ? t('backingUp') : t('backupNow')}
          </button>
        </div>
      </div>

      {/* Language */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400" />
          {t('languageSettings')}
        </h3>
        <div className="flex gap-2">
          {[
            { code: 'zh-TW', label: '繁體中文' },
            { code: 'zh-CN', label: '简体中文' },
            { code: 'en', label: 'English' },
          ].map(locale => (
            <button
              key={locale.code}
              className="bg-white/[0.06] border border-white/[0.1] text-white/60 hover:bg-white/[0.1] hover:text-white transition-all rounded-xl px-4 py-2 text-sm"
              onClick={() => {
                document.cookie = `locale=${locale.code}; path=/; max-age=31536000`
                window.location.reload()
              }}
            >
              {locale.label}
            </button>
          ))}
        </div>
      </div>

      {/* GOG Account */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Globe className="w-4 h-4 text-green-400" />
          Google (gogcli)
        </h3>
        <div>
          <label className="font-mono text-[10px] tracking-widests text-white/35 mb-1 block">Google Account</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={gogAccount}
              onChange={e => setGogAccount(e.target.value)}
              placeholder="user@gmail.com"
              className={glassInput}
            />
            <button
              onClick={saveGogAccount}
              className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm shrink-0"
            >
              {gogSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {gogSaved ? t('saved') : t('save')}
            </button>
          </div>
        </div>
      </div>

      {/* Agent Config */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" />
          {t('agentSettings')}
        </h3>
        <p className="font-mono text-xs text-white/35 tracking-wide">
          {t('agentConfigPath')} <code className="text-cyan-400/60 font-mono">~/.openclaw/agents/</code>
        </p>
        <button
          className="bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm"
          onClick={() => window.open('http://127.0.0.1:18789', '_blank')}
        >
          <Zap className="w-3.5 h-3.5" />
          {t('openConsole')}
        </button>
      </div>

      {/* Security */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Key className="w-4 h-4 text-red-400" />
          {t('security')}
        </h3>
        <button
          onClick={async () => {
            await fetch('/api/auth', { method: 'DELETE' })
            window.location.href = '/login'
          }}
          className="bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 transition-all rounded-xl px-4 py-2 flex items-center gap-1 text-sm"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  )
}
