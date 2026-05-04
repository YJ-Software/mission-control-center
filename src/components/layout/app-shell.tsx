'use client'

import { useState, useCallback, createContext, useContext } from 'react'
import { Sidebar } from './sidebar'
import { MobileDrawer } from './mobile-drawer'
import { WebSocketProvider } from '@/store/websocket'
import { QueryProvider } from '@/store/query'
import { ChatSlidePanel } from '@/components/chat/chat-slide-panel'
import { TerminalFloatingButton } from '@/components/terminal/terminal-floating-button'
import { TerminalFloating } from '@/components/terminal/terminal-floating'

interface MobileMenuContextValue {
  toggleDrawer: () => void
}

const MobileMenuContext = createContext<MobileMenuContextValue>({ toggleDrawer: () => {} })

export function useMobileMenu() {
  return useContext(MobileMenuContext)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const toggleDrawer = useCallback(() => setDrawerOpen(prev => !prev), [])

  return (
    <QueryProvider>
      <WebSocketProvider>
        <MobileMenuContext.Provider value={{ toggleDrawer }}>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              {children}
            </div>
          </div>
          <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
          <ChatSlidePanel />
          <TerminalFloatingButton />
          <TerminalFloating />
        </MobileMenuContext.Provider>
      </WebSocketProvider>
    </QueryProvider>
  )
}
