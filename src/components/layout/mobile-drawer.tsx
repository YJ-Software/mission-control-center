'use client'

import { useTranslations } from 'next-intl'
import { useWebSocket } from '@/store/websocket'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Bot } from 'lucide-react'
import { navItems } from '@/lib/nav-items'
import { MobileNavItem } from './mobile-nav-item'

interface MobileDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MobileDrawer({ open, onOpenChange }: MobileDrawerProps) {
  const t = useTranslations('nav')
  const { connected } = useWebSocket()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[280px] p-0 border-r-0 bg-transparent md:hidden flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #0a0b14 0%, #0d0f1e 50%, #100d1a 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <SheetHeader className="px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, hsla(var(--glow-primary, 43 96% 56%), 0.2), hsla(var(--glow-secondary, 174 68% 50%), 0.15))`,
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <Bot className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <SheetTitle className="text-sm font-semibold text-white tracking-wide">
                Mission Ctrl
              </SheetTitle>
              <div className="font-mono text-[10px] text-white/30 tracking-widest">
                OPENCLAW v2.0
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((item) => (
            <MobileNavItem
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={t(item.labelKey)}
              code={item.code}
              onNavigate={() => onOpenChange(false)}
            />
          ))}
        </nav>

        {/* Gateway status */}
        <div className="mx-3 mb-4 px-4 py-3 rounded-2xl shrink-0"
          style={{
            background: `linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))`,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className={connected ? 'status-dot-active' : 'status-dot-error'} />
            <span className="font-mono text-[10px] tracking-wide text-white/35">
              {connected ? 'Gateway Linked' : 'Gateway Offline'}
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
