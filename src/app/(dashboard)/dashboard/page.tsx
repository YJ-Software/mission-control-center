'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { DashboardContent } from '@/components/dashboard/dashboard-content'

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <DashboardContent />
    </MainLayout>
  )
}
