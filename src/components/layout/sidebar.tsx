'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  Bot, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWebSocket } from '@/store/websocket'
import { navItems } from '@/lib/nav-items'

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const { connected } = useWebSocket()
  const t = useTranslations('nav')

  const { data: versionData } = useQuery<{ openclawVersion: { installed: string } | null }>({
    queryKey: ['openclaw-version'],
    queryFn: () => fetch('/api/services').then(r => r.json()),
    refetchInterval: 300000,
    select: (data) => ({ openclawVersion: data.openclawVersion ?? null }),
  })
  const ocVersion = versionData?.openclawVersion?.installed

  const { data: appVersion } = useQuery<{ version: string; commit: string | null; openclawVersion: string | null }>({
    queryKey: ['app-version'],
    queryFn: () => fetch('/api/health').then(r => r.json()),
    staleTime: Infinity,
    select: (data) => ({
      version: data.version,
      commit: data.commit,
      openclawVersion: data.openclawVersion ?? null,
    }),
  })
  const mccDisplay = appVersion?.version

  return (
    <aside
      data-sidebar
      className={cn(
        'relative hidden md:flex flex-col h-screen shrink-0 transition-all duration-300',
        'bg-white/[0.03] backdrop-blur-xl border-r border-white/[0.08]',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center h-14 border-b border-white/[0.08] px-4 shrink-0',
        collapsed ? 'justify-center' : 'gap-3'
      )}>
        <div className="shrink-0 w-8 h-8 relative flex items-center justify-center">
          <div className="w-8 h-8 rounded-lg bg-white/[0.08] border border-white/[0.12] flex items-center justify-center">
            <Bot className="w-4 h-4 text-cyan-400" />
          </div>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white tracking-wide truncate">
              Mission Ctrl
            </div>
            <div className="font-mono text-[10px] text-white/30 tracking-widest leading-tight truncate" suppressHydrationWarning>
              {mccDisplay ? `MCC ${mccDisplay}` : 'MCC'}
            </div>
            {ocVersion && (
              <div className="font-mono text-[9px] text-white/20 tracking-widest leading-tight truncate" suppressHydrationWarning>
                OPENCLAW v{ocVersion}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {!collapsed && (
          <div className="px-2 pb-2 pt-1">
            <span className="font-mono text-[10px] tracking-[0.15em] text-white/25 uppercase">
              Navigation
            </span>
          </div>
        )}

        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? t(item.labelKey) : undefined}
              className={cn(
                'group relative flex items-center gap-3 px-2.5 py-2 text-sm transition-all duration-150 rounded-lg',
                collapsed ? 'justify-center' : '',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:bg-white/[0.06] hover:text-white/80'
              )}
            >
              <div className={cn(
                'relative z-10 shrink-0 transition-all',
                collapsed ? 'w-5 h-5' : 'w-4 h-4',
              )}>
                <item.icon className="w-full h-full" />
              </div>

              {!collapsed && (
                <span className="relative z-10 font-medium tracking-wide truncate text-sm">
                  {t(item.labelKey)}
                </span>
              )}

              {!collapsed && (
                <span className={cn(
                  'relative z-10 ml-auto font-mono text-[9px] tracking-widest shrink-0',
                  isActive ? 'text-white/50' : 'text-white/20 group-hover:text-white/35'
                )}>
                  {item.code}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Gateway status + app version */}
      {!collapsed && (
        <div className="shrink-0 mx-2 mb-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <span className={connected ? 'status-dot-active' : 'status-dot-error'} />
            <span className="font-mono text-[10px] tracking-wide text-white/35">
              {connected ? 'Gateway Linked' : 'Gateway Offline'}
            </span>
          </div>
          {appVersion?.version && (
            <div className="mt-1 font-mono text-[10px] tracking-wide text-white/25" suppressHydrationWarning>
              {appVersion.version}
              {appVersion.commit && <span className="text-white/20"> · {appVersion.commit}</span>}
            </div>
          )}
        </div>
      )}

      {/* Collapse button */}
      <div className="shrink-0 p-2 border-t border-white/[0.08]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center gap-2 w-full px-2.5 py-2 text-white/30 hover:text-white/70 transition-colors rounded-lg hover:bg-white/[0.05]',
            collapsed ? 'justify-center' : ''
          )}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" />
            : <><ChevronLeft className="w-4 h-4" /><span className="font-mono text-[10px] tracking-widest">COLLAPSE</span></>
          }
        </button>
      </div>
    </aside>
  )
}
