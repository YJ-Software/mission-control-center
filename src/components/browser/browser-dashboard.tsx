'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { resolveBrowserView } from './view-state'
import { InstallPanel } from './install-panel'
import { ServiceStatusPanel } from './service-status-panel'
import { VncViewer } from './vnc-viewer'
import { SettingsPanel } from './settings-panel'
import { MissingDepsCard } from './missing-deps-card'
import { BrowserLogs } from './browser-logs'

interface BrowserDetectedComponents {
  chrome: boolean
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
  chromeService: boolean
}

interface BrowserConfig {
  installed: string
  websockify_port: string
  vnc_password?: string
  detected?: BrowserDetectedComponents
  [key: string]: string | BrowserDetectedComponents | undefined
}

export function BrowserDashboard() {
  const [forceView, setForceView] = useState<'dashboard' | 'install' | null>(null)

  const { data: config, refetch, isPending } = useQuery<BrowserConfig>({
    queryKey: ['browser-config'],
    queryFn: () => fetch('/api/browser').then(r => r.json()),
  })

  const detected = config?.detected
  const isInstalled = config?.installed === 'true'
  const chromeDetected = detected?.chrome ?? false
  const chromeServiceRunning = detected?.chromeService ?? false
  const headlessMissing = chromeDetected && (!detected?.xvfb || !detected?.openbox || !detected?.x11vnc || !detected?.websockify)
  const websockifyPort = parseInt(config?.websockify_port || '6081')
  const vncPassword = config?.vnc_password || ''

  // Decided in view-state.ts. The key rule: render nothing until the config has
  // actually loaded — reading `installed` off an undefined `config` used to make
  // an installed box flash the installer before the dashboard replaced it.
  const view = resolveBrowserView({
    loaded: !isPending,
    installed: isInstalled,
    chromeServiceRunning,
    forceView,
  })

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-white/50">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    )
  }

  if (view === 'install') {
    return <InstallPanel onInstallCompleteAction={async () => { await refetch(); setForceView(null) }} />
  }

  return (
    <div className="space-y-6">
      {headlessMissing && detected && (
        <MissingDepsCard detected={detected} onInstallComplete={refetch} />
      )}
      <VncViewer websockifyPort={websockifyPort} vncPassword={vncPassword} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ServiceStatusPanel />
        <SettingsPanel
          onUninstallAction={() => { setForceView('install'); refetch() }}
          onUninstallStartAction={() => setForceView('dashboard')}
        />
      </div>
      <BrowserLogs />
    </div>
  )
}
