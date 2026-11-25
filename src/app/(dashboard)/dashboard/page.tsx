'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { DashboardContent } from '@/components/dashboard/dashboard-content'
import { useBackendCapabilities } from '@/components/layout/backend-capabilities'

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const { toggleDrawer } = useMobileMenu()
  const { service } = useBackendCapabilities()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle', { backend: service.name })} onMenuToggle={toggleDrawer}>
      <DashboardContent />
    </MainLayout>
  )
}
