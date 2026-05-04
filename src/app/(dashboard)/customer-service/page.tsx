'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'

const CustomerServiceContent = dynamic(
  () =>
    import('@/components/customer-service/customer-service-content').then(
      (m) => m.CustomerServiceContent,
    ),
  { ssr: false },
)

export default function CustomerServicePage() {
  const t = useTranslations('customerService')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <CustomerServiceContent />
    </MainLayout>
  )
}
