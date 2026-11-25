import { AppShell } from '@/components/layout/app-shell'

import { getBackendCapabilities } from '@/lib/agent-runtime/selection'

export const dynamic = 'force-dynamic'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell capabilities={getBackendCapabilities()}>{children}</AppShell>
}
