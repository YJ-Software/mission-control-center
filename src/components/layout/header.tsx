'use client'

import { Bell, Globe, Menu, RefreshCw, ArrowUpCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import type { OpenClawVersionInfo } from '@/lib/services-status'

const locales = [
  { code: 'zh-TW', label: '繁' },
  { code: 'zh-CN', label: '簡' },
  { code: 'en', label: 'EN' },
]

interface HeaderProps {
  title: string
  subtitle?: string
  onMenuToggle?: () => void
}

export function Header({ title, subtitle, onMenuToggle }: HeaderProps) {
  const activeLocale = useLocale()
  const [currentLocale, setCurrentLocale] = useState(activeLocale)
  const [refreshing, setRefreshing] = useState(false)
  const [updating, setUpdating] = useState(false)
  const t = useTranslations('header')
  const queryClient = useQueryClient()

  const { data: versionInfo } = useQuery<{ openclawVersion: OpenClawVersionInfo | null }>({
    queryKey: ['openclaw-version'],
    queryFn: () => fetch('/api/services').then(r => r.json()),
    refetchInterval: 300000, // check every 5 min
    select: (data) => ({ openclawVersion: data.openclawVersion ?? null }),
  })

  const oc = versionInfo?.openclawVersion

  async function handleUpdate() {
    setUpdating(true)
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-openclaw' }),
      })
      queryClient.invalidateQueries({ queryKey: ['openclaw-version'] })
      queryClient.invalidateQueries({ queryKey: ['services-status'] })
    } finally {
      setUpdating(false)
    }
  }

  const switchLocale = (locale: string) => {
    setCurrentLocale(locale)
    document.cookie = `locale=${locale}; path=/; max-age=31536000`
    // Sync Obsidian headless --lang flag if installed (best-effort, non-blocking)
    fetch('/api/second-brain/obsidian/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    }).catch(() => {})
    window.location.reload()
  }

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => { setRefreshing(false); window.location.reload() }, 300)
  }

  return (
    <header className="relative h-12 flex items-center justify-between px-3 md:px-6 shrink-0 bg-white/[0.03] backdrop-blur border-b border-white/[0.08]">
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="flex md:hidden items-center justify-center p-2 -ml-2 rounded-xl text-white/50 hover:text-white/80 active:bg-white/[0.06] transition-colors"
            style={{ minWidth: 'var(--touch-min, 44px)', minHeight: 'var(--touch-min, 44px)' }}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div>
          <h1 className="text-base font-semibold text-white leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="font-mono text-[10px] text-white/30 tracking-widest leading-tight">
              {subtitle}
            </p>
          )}
        </div>

        {oc?.updateAvailable && (
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium
              bg-amber-500/15 text-amber-300 border border-amber-500/30
              hover:bg-amber-500/25 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ArrowUpCircle className="w-3.5 h-3.5" />}
            {updating ? t('updating') : t('updateAvailable', { version: oc.latest })}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Globe className="hidden sm:block w-3.5 h-3.5 text-white/30" />
          <div className="flex ml-1">
            {locales.map((locale) => (
              <button
                key={locale.code}
                onClick={() => switchLocale(locale.code)}
                className={cn(
                  'px-2 sm:px-3 py-1 font-mono text-[9px] sm:text-[10px] tracking-wide transition-all rounded-md',
                  currentLocale === locale.code
                    ? 'bg-white/10 text-white'
                    : 'text-white/35 hover:text-white/70 hover:bg-white/[0.05]'
                )}
              >
                {locale.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden sm:block w-px h-4 bg-white/[0.12]" />

        <button className="relative p-2.5 sm:p-1.5 text-white/35 hover:text-white/70 transition-colors rounded-lg hover:bg-white/[0.05]"
          style={{ minWidth: 'var(--touch-min, 44px)', minHeight: 'var(--touch-min, 44px)' }}>
          <Bell className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
        </button>

        <button
          onClick={handleRefresh}
          className="p-2.5 sm:p-1.5 text-white/35 hover:text-white/70 transition-colors rounded-lg hover:bg-white/[0.05]"
          style={{ minWidth: 'var(--touch-min, 44px)', minHeight: 'var(--touch-min, 44px)' }}
        >
          <RefreshCw className={cn('w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform', refreshing && 'animate-spin')} />
        </button>
      </div>
    </header>
  )
}
