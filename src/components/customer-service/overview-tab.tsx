'use client'

import { useTranslations } from 'next-intl'
import * as Switch from '@radix-ui/react-switch'
import { Loader2, Pause, Play } from 'lucide-react'
import { useBusinessHours } from './business-hours-context'
import { OverviewStatsPanel } from './overview-stats-panel'

/**
 * Overview tab is now focused on:
 *   1. the master AI on/off toggle (most critical control)
 *   2. headline stats + recommendations
 *
 * The plugin install / channels / default reply configuration moved
 * into the Settings tab (PluginConfigCard) where operators expect
 * one-time setup to live.
 */
export function OverviewTab() {
  const t = useTranslations('customerService')
  const { data, draft, isLoading, busy, togglePauseAi } = useBusinessHours()

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center p-12 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  const paused = draft.pauseAi

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Master AI on/off */}
      <div className={`cyber-card p-5 border ${paused ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-emerald-500/25 bg-emerald-500/[0.03]'}`}>
        <div className="flex items-center gap-4">
          <div className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${paused ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
            {paused ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </div>
          <div className="flex-1">
            <h3 className={`text-base font-semibold ${paused ? 'text-amber-200' : 'text-emerald-200'}`}>
              {paused ? t('master.paused') : t('master.active')}
            </h3>
            <p className="text-sm text-white/60 mt-0.5 leading-relaxed">
              {paused ? t('master.pausedDesc') : t('master.activeDesc')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {busy === 'pause' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-cyan-300 mr-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('master.applying')}
              </span>
            )}
            <span className={`text-xs font-medium uppercase tracking-wider ${paused ? 'text-white/40' : 'text-emerald-300'}`}>
              {t('master.toggleOn')}
            </span>
            <Switch.Root
              checked={!paused}
              onCheckedChange={togglePauseAi}
              disabled={busy !== null || !data?.installed}
              aria-label={paused ? t('master.resume') : t('master.pause')}
              className="relative h-7 w-14 shrink-0 cursor-pointer rounded-full border transition-colors
                disabled:cursor-not-allowed disabled:opacity-60
                data-[state=checked]:bg-emerald-500/30 data-[state=checked]:border-emerald-500/50
                data-[state=unchecked]:bg-amber-500/20 data-[state=unchecked]:border-amber-500/40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Switch.Thumb className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full shadow-lg ring-0 transition-all
                bg-white
                data-[state=checked]:translate-x-[1.875rem] data-[state=checked]:bg-emerald-300
                data-[state=unchecked]:translate-x-1 data-[state=unchecked]:bg-amber-300">
                {busy === 'pause' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-white/80" />
                ) : paused ? (
                  <Pause className="w-3 h-3 text-amber-900" />
                ) : (
                  <Play className="w-3 h-3 text-emerald-900" />
                )}
              </Switch.Thumb>
            </Switch.Root>
            <span className={`text-xs font-medium uppercase tracking-wider ${paused ? 'text-amber-300' : 'text-white/40'}`}>
              {t('master.toggleOff')}
            </span>
          </div>
        </div>
        {!data?.installed && (
          <p className="text-xs text-white/40 mt-3 ml-16">{t('master.needsInstall')}</p>
        )}
      </div>

      <OverviewStatsPanel />
    </div>
  )
}
