'use client'

import { useTranslations } from 'next-intl'
import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { ChatContent } from '@/components/chat/chat-content'

export default function ChatPage() {
  const t = useTranslations('chat')
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title={t('title')} subtitle={t('subtitle')} onMenuToggle={toggleDrawer}>
      <ChatContent />
    </MainLayout>
  )
}
