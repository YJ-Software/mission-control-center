'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { SystemLogTabs } from './_components/system-log-tabs'

export default function SystemLogPage() {
  const t = useTranslations('systemLog')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <SystemLogTabs />
    </MainLayout>
  )
}
