'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { CostsContent } from '@/components/costs/costs-content'

export default function CostsPage() {
  const t = useTranslations('costs')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <CostsContent />
    </MainLayout>
  )
}
