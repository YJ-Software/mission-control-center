'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { LiveFeedContent } from '@/components/live-feed/live-feed-content'

export default function LiveFeedPage() {
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title="Live Feed" subtitle="Real-time agent activity stream — all sessions" onMenuToggle={toggleDrawer}>
      <LiveFeedContent />
    </MainLayout>
  )
}
