'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { useMobileMenu } from '@/components/layout/app-shell'
import { DockerContent } from '@/components/docker/docker-content'

export default function DockerPage() {
  const { toggleDrawer } = useMobileMenu()
  return (
    <MainLayout title="Docker" subtitle="Containers, images and system info" onMenuToggle={toggleDrawer}>
      <DockerContent />
    </MainLayout>
  )
}
