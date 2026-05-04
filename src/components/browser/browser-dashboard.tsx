'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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

  const { data: config, refetch } = useQuery<BrowserConfig>({
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

  // Show install panel when:
  // - forced to install view, OR
  // - not installed and Chrome service not set up (even if Chrome binary exists, services may not be configured)
  const showInstall = forceView === 'install' || (!isInstalled && !chromeServiceRunning && forceView !== 'dashboard')

  if (showInstall) {
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
