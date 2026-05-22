'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Eye, EyeOff, Copy, Check, Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react'

interface ChannelStatus {
  channelId: string
  channelSecret: string          // masked
  channelAccessToken: string     // masked
  hasSecret: boolean
  hasAccessToken: boolean
}

interface BotInfo {
  userId: string
  displayName: string
  pictureUrl?: string
  chatMode: string
  markAsReadMode: string
}

export function LineChannelCard() {
  const t = useTranslations('customerService.lineChannel')
  const qc = useQueryClient()

  const { data: status } = useQuery<ChannelStatus>({
    queryKey: ['cs-line-channel'],
    queryFn: () => fetch('/api/customer-service/line-channel').then(r => r.json()),
  })

  // Local form state. The displayed masked values get cleared as soon as the
  // user types in either secret field so we don't accidentally upsert the mask
  // string as the real value.
  const [channelId, setChannelId] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [channelAccessToken, setChannelAccessToken] = useState('')
  const [secretTouched, setSecretTouched] = useState(false)
  const [tokenTouched, setTokenTouched] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [copiedField, setCopiedField] = useState<'id' | null>(null)

  useEffect(() => {
    if (!status) return
    if (!channelId) setChannelId(status.channelId)
  }, [status, channelId])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { channelId }
      if (secretTouched) body.channelSecret = channelSecret
      if (tokenTouched) body.channelAccessToken = channelAccessToken
      const res = await fetch('/api/customer-service/line-channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'save failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-line-channel'] })
      setSecretTouched(false)
      setTokenTouched(false)
      setChannelSecret('')
      setChannelAccessToken('')
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/customer-service/line-channel?action=test', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'test failed')
      return data.info as BotInfo
    },
  })

  const copyChannelId = () => {
    navigator.clipboard.writeText(channelId).then(() => {
      setCopiedField('id')
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  return (
    <div className="cyber-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white/90">{t('title')}</h3>
      </div>
      <p className="text-xs text-white/50 leading-relaxed mb-4">{t('description')}</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-white/40 mb-1">{t('channelId')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              placeholder="1234567890"
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-emerald-500/40"
            />
            {channelId && (
              <button
                type="button"
                onClick={copyChannelId}
                className="px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/80"
                title={t('copy')}
              >
                {copiedField === 'id' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-white/40 mb-1">{t('channelSecret')}</label>
          <div className="flex gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secretTouched ? channelSecret : (status?.channelSecret ?? '')}
              onChange={e => { setSecretTouched(true); setChannelSecret(e.target.value) }}
              placeholder={status?.hasSecret ? t('storedHint') : t('secretPlaceholder')}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-emerald-500/40"
            />
            <button
              type="button"
              onClick={() => setShowSecret(v => !v)}
              className="px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/80"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-white/40 mb-1">{t('channelAccessToken')}</label>
          <div className="flex gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenTouched ? channelAccessToken : (status?.channelAccessToken ?? '')}
              onChange={e => { setTokenTouched(true); setChannelAccessToken(e.target.value) }}
              placeholder={status?.hasAccessToken ? t('storedHint') : t('tokenPlaceholder')}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-emerald-500/40"
            />
            <button
              type="button"
              onClick={() => setShowToken(v => !v)}
              className="px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/80"
            >
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              saveMutation.isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                <Save className="w-3.5 h-3.5" />}
            {t('save')}
          </button>
          <button
            onClick={() => testMutation.mutate()}
            disabled={!status?.hasAccessToken || testMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-white/[0.04] text-white/70 hover:bg-white/[0.08] border border-white/[0.1] disabled:opacity-40"
          >
            {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              testMutation.isSuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> :
                null}
            {t('testConnection')}
          </button>
          <span className="ml-auto text-[10px] text-white/30 font-mono">
            {status?.hasAccessToken ? t('statusConfigured') : t('statusEmpty')}
          </span>
        </div>

        {/* Test result */}
        {testMutation.isSuccess && testMutation.data && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[12px] text-emerald-200">
            {testMutation.data.pictureUrl && (
              <img src={testMutation.data.pictureUrl} alt="" className="w-6 h-6 rounded-full" />
            )}
            <div className="flex-1">
              <div>{t('testOk', { name: testMutation.data.displayName })}</div>
              <div className="text-[10px] text-emerald-200/60 font-mono">{testMutation.data.userId}</div>
            </div>
          </div>
        )}
        {testMutation.isError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-[12px] text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{(testMutation.error as Error).message}</span>
          </div>
        )}

        {/* Help */}
        <p className="text-[11px] text-white/30 mt-3 leading-relaxed">
          {t('help')}
        </p>
      </div>
    </div>
  )
}
