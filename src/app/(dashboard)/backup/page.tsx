'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const BackupContent = dynamic(
  () => import('@/components/backup/backup-content').then(m => m.BackupContent),
  { ssr: false },
)

export default function BackupPage() {
  const t = useTranslations('backup')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <BackupContent />
    </MainLayout>
  )
}
