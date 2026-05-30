'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { SystemLogView } from './_components/system-log-view'

export default function SystemLogPage() {
  const t = useTranslations('systemLog')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <SystemLogView />
    </MainLayout>
  )
}
