'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { TerminalPage } from '@/components/terminal/terminal-page'

export default function TerminalRoute() {
  const t = useTranslations('terminal')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <TerminalPage />
    </MainLayout>
  )
}
