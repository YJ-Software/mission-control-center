'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const MorningReportManager = dynamic(
  () => import('@/components/morning-report/morning-report-manager').then(m => m.MorningReportManager),
  { ssr: false },
)

export default function MorningReportPage() {
  const t = useTranslations('morningReport')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <MorningReportManager />
    </MainLayout>
  )
}
