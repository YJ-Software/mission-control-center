'use client'

import { QueryProvider } from '@/store/query'
import { TerminalPage } from '@/components/terminal/terminal-page'

export default function TerminalPopupRoute() {
  return (
    <QueryProvider>
      <div className="h-screen bg-[#0a0a1a]">
        <TerminalPage />
      </div>
    </QueryProvider>
  )
}
