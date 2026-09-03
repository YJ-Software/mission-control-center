'use client'

import Link from 'next/link'
import { LayoutDashboard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ChatContent } from '@/components/chat/chat-content'
import { DataProviders } from '@/components/layout/data-providers'
import { DASHBOARD_PATH } from '@/lib/landing'

/**
 * The customer-facing chat window.
 *
 * Deliberately outside the (dashboard) route group, so it does NOT get AppShell
 * — no sidebar, no operator navigation. A customer arriving on their chat
 * subdomain should see a conversation, not the machine's control surface. The
 * one way out is an explicit button to the full Mission Control.
 *
 * ChatContent is the same component the in-dashboard /chat page renders. It
 * does need react-query and the gateway WebSocket, which AppShell would
 * normally supply — hence DataProviders, the plumbing without the chrome.
 */
export default function TalkPage() {
  const t = useTranslations('talk')

  return (
    <div className="flex flex-col h-dvh bg-[#0a0e14]">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.08] shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-white/90 truncate">{t('title')}</h1>
          <p className="hidden sm:block text-[11px] text-white/40 truncate">{t('subtitle')}</p>
        </div>
        <Link
          href={DASHBOARD_PATH}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
            bg-white/[0.06] text-white/70 border border-white/[0.1]
            hover:bg-white/[0.1] hover:text-white/90 transition-colors shrink-0"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          {t('openFullMcc')}
        </Link>
      </header>

      <div className="flex-1 min-h-0">
        <DataProviders>
          <ChatContent />
        </DataProviders>
      </div>
    </div>
  )
}
