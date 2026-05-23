'use client'

import { useTranslations } from 'next-intl'
import { Plug, Save, Power, Loader2, CheckCircle2, XCircle, MessageSquareOff } from 'lucide-react'
import { useBusinessHours } from './business-hours-context'

const KNOWN_CHANNELS = ['line', 'telegram', 'discord', 'slack', 'whatsapp', 'messenger']

/**
 * Settings-tab card bundling the business-hours-gate plugin controls:
 * - Plugin status (install / uninstall)
 * - Default reply text
 * - Applied channels
 * - Save bar + result message
 *
 * Shares the BusinessHoursProvider context so it stays in sync with the
 * Overview tab's master AI toggle.
 */
export function PluginConfigCard() {
  const t = useTranslations('customerService')
  const { data, isLoading, draft, setDraft, dirty, busy, message, output, callAction } = useBusinessHours()

  if (isLoading || !draft) {
    return (
      <div className="cyber-card p-5 flex items-center gap-2 text-white/50 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('actions.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Plugin status */}
      <div className="cyber-card p-5">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">{t('pluginStatus')}</h3>
        <div className="grid grid-cols-1 gap-2 mb-4">
          <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/40">{t('pluginInfo.name')}</div>
              <div className="text-sm font-mono text-white/90 mt-0.5">business-hours-gate</div>
            </div>
            <span className="text-xs text-white/40 font-mono">v0.1.0</span>
          </div>
          {data?.pluginSourceDir && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-white/40">{t('pluginInfo.path')}</div>
              <div className="text-[12px] font-mono text-white/80 mt-0.5 break-all">{data.pluginSourceDir}</div>
              <div className="text-[11px] text-white/40 mt-1">{t('pluginInfo.pathHint')}</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <StatusBadge label={t('installed')} ok={data?.installed ?? false} />
          <StatusBadge label={t('enabled')} ok={data?.enabled ?? false} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!data?.installed ? (
            <button
              onClick={() => callAction('install')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
                disabled:opacity-50 transition-colors"
            >
              {busy === 'install' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {t('actions.install')}
            </button>
          ) : (
            <button
              onClick={() => callAction('uninstall')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20
                disabled:opacity-50 transition-colors"
            >
              {busy === 'uninstall' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {t('actions.uninstall')}
            </button>
          )}
        </div>
        {output && (
          <pre className="mt-4 max-h-48 overflow-auto rounded bg-black/40 border border-white/[0.06] p-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap">
            {output}
          </pre>
        )}
      </div>

      {/* Default reply text */}
      <div className="cyber-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquareOff className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white/90">{t('reply.title')}</h3>
        </div>
        <p className="text-xs text-white/50 leading-relaxed">{t('reply.description')}</p>
        <textarea
          value={draft.replyText}
          onChange={(e) => setDraft({ ...draft, replyText: e.target.value })}
          placeholder={t('reply.placeholder')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/90"
        />
      </div>

      {/* Applied channels */}
      <div className="cyber-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white/90">{t('channels.title')}</h3>
        <p className="text-xs text-white/50 leading-relaxed">{t('channels.description')}</p>
        <div className="flex flex-wrap gap-2">
          {KNOWN_CHANNELS.map((channel) => {
            const checked = draft.channels.includes(channel)
            return (
              <label
                key={channel}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
                  checked
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25'
                    : 'bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08]'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.channels, channel]
                      : draft.channels.filter((c) => c !== channel)
                    setDraft({ ...draft, channels: next })
                  }}
                />
                {channel}
              </label>
            )
          })}
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => callAction('save-and-restart', { config: draft })}
          disabled={busy !== null || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/25
            disabled:opacity-50 transition-colors"
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t('actions.save')}
        </button>
        {dirty && <span className="text-xs text-amber-300">{t('messages.unsaved')}</span>}
      </div>

      {/* Message strip */}
      {message && (
        <div
          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${
            message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-red-500/10 text-red-300 border-red-500/20'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <span className="text-xs text-white/60">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-white/40">
          <XCircle className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  )
}
