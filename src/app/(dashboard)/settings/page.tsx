'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { SettingsView } from '@/components/settings/settings-view'

export default function SettingsPage() {
  const t = useTranslations('settings')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} onMenuToggle={toggleDrawer}>
      <SettingsView />
    </MainLayout>
  )
}
