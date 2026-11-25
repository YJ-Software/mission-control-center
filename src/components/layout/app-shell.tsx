'use client'

import { usePathname } from 'next/navigation'
import { useState, useCallback, createContext, useContext } from 'react'
import { Sidebar } from './sidebar'
import { MobileDrawer } from './mobile-drawer'
import { DataProviders } from './data-providers'
import { ChatSlidePanel } from '@/components/chat/chat-slide-panel'
import { TerminalFloatingButton } from '@/components/terminal/terminal-floating-button'
import { TerminalFloating } from '@/components/terminal/terminal-floating'
import { BackendCapabilitiesProvider, type BackendCapabilities } from './backend-capabilities'
import { supportsPage } from '@/lib/agent-runtime/capabilities'
import { UnsupportedBackend } from './unsupported-backend'

interface MobileMenuContextValue {
  toggleDrawer: () => void
}

const MobileMenuContext = createContext<MobileMenuContextValue>({ toggleDrawer: () => {} })

export function useMobileMenu() {
  return useContext(MobileMenuContext)
}

export function AppShell({ children, capabilities }: { children: React.ReactNode; capabilities: BackendCapabilities }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const toggleDrawer = useCallback(() => setDrawerOpen(prev => !prev), [])

  return (
    <BackendCapabilitiesProvider value={capabilities}>
      <DataProviders>
        <MobileMenuContext.Provider value={{ toggleDrawer }}>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              {supportsPage(capabilities, pathname) ? children : <UnsupportedBackend />}
            </div>
          </div>
          <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
          <ChatSlidePanel />
          <TerminalFloatingButton />
          <TerminalFloating />
        </MobileMenuContext.Provider>
      </DataProviders>
    </BackendCapabilitiesProvider>
  )
}
