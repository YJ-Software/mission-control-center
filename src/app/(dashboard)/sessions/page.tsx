'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { SessionsContent } from '@/components/sessions/sessions-content'

export default function SessionsPage() {
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title="Sessions" subtitle="All agent sessions and their activity" onMenuToggle={toggleDrawer}>
      <SessionsContent />
    </MainLayout>
  )
}
