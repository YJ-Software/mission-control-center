'use client'

import { Header } from './header'

interface MainLayoutProps {
  children: React.ReactNode
  title: string
  subtitle?: string
  onMenuToggle?: () => void
}

export function MainLayout({ children, title, subtitle, onMenuToggle }: MainLayoutProps) {
  return (
    <>
      <Header title={title} subtitle={subtitle} onMenuToggle={onMenuToggle} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </>
  )
}
