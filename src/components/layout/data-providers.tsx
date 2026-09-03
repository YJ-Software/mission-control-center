'use client'

import { WebSocketProvider } from '@/store/websocket'
import { QueryProvider } from '@/store/query'

/**
 * The data plumbing every page needs: react-query and the gateway WebSocket.
 *
 * These used to be mounted only inside AppShell, which made them inseparable
 * from the operator chrome (sidebar, drawer, floating terminal). The customer
 * chat window at /talk deliberately lives outside the (dashboard) group so it
 * gets no chrome — and so it got no QueryClient either, and every render died
 * server-side with "No QueryClient set, use QueryClientProvider to set one".
 *
 * Split out so a page can take the plumbing without taking the chrome.
 */
export function DataProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <WebSocketProvider>{children}</WebSocketProvider>
    </QueryProvider>
  )
}
