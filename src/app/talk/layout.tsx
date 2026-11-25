import { BackendCapabilitiesProvider } from '@/components/layout/backend-capabilities'
import { getBackendCapabilities } from '@/lib/agent-runtime/selection'

export const dynamic = 'force-dynamic'

export default function TalkLayout({ children }: { children: React.ReactNode }) {
  return <BackendCapabilitiesProvider value={getBackendCapabilities()}>{children}</BackendCapabilitiesProvider>
}
