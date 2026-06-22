'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const BrowserPanel = dynamic(
  () => import('@/components/browser/browser-panel').then(m => m.BrowserPanel),
  { ssr: false },
)

export default function BrowserPage() {
  const t = useTranslations('browser')
  const { toggleDrawer } = useMobileMenu()

  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <BrowserPanel />
    </MainLayout>
  )
}
