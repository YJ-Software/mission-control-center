'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const SecondBrainManager = dynamic(
  () => import('@/components/second-brain/second-brain-manager').then(m => m.SecondBrainManager),
  { ssr: false },
)

export default function SecondBrainPage() {
  const t = useTranslations('secondBrain')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <SecondBrainManager />
    </MainLayout>
  )
}
