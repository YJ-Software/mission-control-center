'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface MobileNavItemProps {
  href: string
  icon: LucideIcon
  label: string
  code: string
  onNavigate: () => void
}

export function MobileNavItem({ href, icon: Icon, label, code, onNavigate }: MobileNavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200',
        'min-h-[var(--touch-min,44px)]',
        isActive
          ? 'text-white'
          : 'text-white/50 active:bg-white/[0.06]'
      )}
      style={isActive ? {
        background: `linear-gradient(135deg, hsla(var(--glow-primary, 43 96% 56%), 0.12), hsla(var(--glow-secondary, 174 68% 50%), 0.08))`,
        boxShadow: `0 0 20px hsla(var(--glow-primary, 43 96% 56%), 0.08), inset 0 1px 0 rgba(255,255,255,0.06)`,
        border: '1px solid rgba(255,255,255,0.08)',
      } : undefined}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="text-sm font-medium tracking-wide">{label}</span>
      <span className="ml-auto font-mono text-[9px] tracking-widest text-white/20">{code}</span>
    </Link>
  )
}
