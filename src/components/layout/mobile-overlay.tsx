'use client'

import { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MobileOverlayProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
}

export function MobileOverlay({ open, onClose, children, title }: MobileOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  const scrollY = useRef(0)

  // Swipe-down-to-close: only on drag handle, NOT on the panel
  const handleDragTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
  }, [])

  const handleDragTouchEnd = useCallback((e: React.TouchEvent) => {
    if (startY.current === null) return
    const deltaY = e.changedTouches[0].clientY - startY.current
    if (deltaY > 100) onClose()
    startY.current = null
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-bloom"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={overlayRef}
        className={cn(
          'absolute inset-x-0 bottom-0 top-0 flex flex-col animate-slide-up',
          'bg-gradient-to-b from-[#0a0b14] via-[#0d0f1e] to-[#100d1a]',
        )}
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
          {/* Drag handle — touch handlers ONLY here */}
          <div
            className="flex items-center justify-center pt-3 pb-1 shrink-0"
            data-mobile-drag-handle
            onTouchStart={handleDragTouchStart}
            onTouchEnd={handleDragTouchEnd}
          >
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-2 shrink-0">
            {title && (
              <span className="text-sm font-medium text-white/70">{title}</span>
            )}
            <button
              onClick={onClose}
              className="ml-auto p-2 rounded-xl text-white/40 hover:text-white/70 transition-colors"
              style={{ minWidth: 'var(--touch-min, 44px)', minHeight: 'var(--touch-min, 44px)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden touch-pan-y">
            {children}
          </div>
      </div>
    </div>
  )
}
