'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { useBackendCapabilities } from '@/components/layout/backend-capabilities'

const BackupContent = dynamic(
  () => import('@/components/backup/backup-content').then(m => m.BackupContent),
  { ssr: false },
)

export default function BackupPage() {
  const t = useTranslations('backup')
  const { toggleDrawer } = useMobileMenu()
  const { service } = useBackendCapabilities()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle', { backend: service.name })} onMenuToggle={toggleDrawer}>
      <BackupContent />
    </MainLayout>
  )
}
