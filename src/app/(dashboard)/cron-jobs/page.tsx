'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { CronJobsManager } from '@/components/cron/cron-jobs-manager'

export default function CronJobsPage() {
  const t = useTranslations('cronJobs')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <CronJobsManager />
    </MainLayout>
  )
}
