'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const SetupContent = dynamic(
  () => import('@/components/setup/setup-content').then(m => m.SetupContent),
  { ssr: false },
)

export default function SetupPage() {
  const t = useTranslations('setup')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <SetupContent />
    </MainLayout>
  )
}
