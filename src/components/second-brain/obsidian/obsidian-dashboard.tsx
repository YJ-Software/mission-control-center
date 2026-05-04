'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import * as Tabs from '@radix-ui/react-tabs'
import { useTranslations } from 'next-intl'
import { InstallPanel } from './install-panel'
import { ServiceStatusPanel } from './service-status-panel'
import { VncViewer } from './vnc-viewer'
import { SettingsPanel } from './settings-panel'
import { LiveSyncSetup } from './livesync-setup'
import { MissingDepsCard } from './missing-deps-card'
import { VaultPathDialog } from './vault-path-dialog'
import { ObsidianLogs } from './obsidian-logs'
import { SkillsPanel } from '@/components/second-brain/skills/skills-panel'

interface DetectedComponents {
  obsidian: boolean
  xvfb: boolean
  openbox: boolean
  x11vnc: boolean
  websockify: boolean
  couchdb: boolean
}

interface ObsidianConfig {
  installed: string
  couchdb_installed: string
  websockify_port: string
  vnc_password?: string
  vault_path?: string
  detected?: DetectedComponents
  detectedVaults?: string[]
  [key: string]: string | DetectedComponents | string[] | undefined
}

export function ObsidianDashboard() {
  const t = useTranslations('secondBrain.obsidianSubTabs')
  const [forceView, setForceView] = useState<'dashboard' | 'install' | null>(null)
  const [showVaultDialog, setShowVaultDialog] = useState(false)
  const [vaultAutoSet, setVaultAutoSet] = useState(false)

  const { data: config, refetch } = useQuery<ObsidianConfig>({
    queryKey: ['obsidian-config'],
    queryFn: () => fetch('/api/second-brain/obsidian').then(r => r.json()),
  })

  const saveVaultPath = useMutation({
    mutationFn: async (vaultPath: string) => {
      await fetch('/api/second-brain/obsidian', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vault_path: vaultPath }),
      })
    },
    onSuccess: () => refetch(),
  })

  const detected = config?.detected
  const isInstalled = config?.installed === 'true' && config?.couchdb_installed === 'true'
  const obsidianDetected = detected?.obsidian ?? false
  const headlessMissing = obsidianDetected && (!detected?.xvfb || !detected?.openbox || !detected?.x11vnc || !detected?.websockify)
  const websockifyPort = parseInt(config?.websockify_port || '6080')
  const vncPassword = config?.vnc_password || ''
  const detectedVaults = config?.detectedVaults ?? []
  const currentVaultPath = config?.vault_path ?? ''
  const isDefaultVault = currentVaultPath === '~/Documents/ObsidianVault'

  // Auto-detect vault path when Obsidian is detected
  useEffect(() => {
    if (!obsidianDetected || vaultAutoSet || !config) return

    if (detectedVaults.length > 0 && isDefaultVault) {
      // Auto-set to the first detected vault
      saveVaultPath.mutate(detectedVaults[0])
      setVaultAutoSet(true)
    } else if (detectedVaults.length === 0 && isDefaultVault) {
      // No vaults detected and still using default — prompt user
      setShowVaultDialog(true)
      setVaultAutoSet(true)
    }
  }, [obsidianDetected, detectedVaults, isDefaultVault, config, vaultAutoSet]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show install panel only when nothing is detected and not forced to dashboard
  const showInstall = forceView === 'install' || (!isInstalled && !obsidianDetected && forceView !== 'dashboard')

  if (showInstall) {
    const { detected: _, detectedVaults: _v, ...rest } = config ?? {} as ObsidianConfig
    const installConfig = config ? rest as { installed: string; couchdb_installed: string; [key: string]: string } : undefined
    return <InstallPanel onInstallCompleteAction={() => { setForceView(null); refetch() }} config={installConfig} />
  }

  return (
    <div className="space-y-4">
      <VaultPathDialog
        open={showVaultDialog}
        onOpenChangeAction={setShowVaultDialog}
        onConfirmAction={(vaultPath: string) => {
          saveVaultPath.mutate(vaultPath)
          setShowVaultDialog(false)
        }}
      />
      {headlessMissing && detected && (
        <MissingDepsCard detected={detected} onInstallComplete={refetch} />
      )}
      <Tabs.Root defaultValue="overview">
        <Tabs.List className="flex gap-1 mb-4 border-b border-white/[0.08]">
          <Tabs.Trigger
            value="overview"
            className="px-3 py-2 text-sm text-white/50 border-b-2 border-transparent -mb-px
              data-[state=active]:border-cyan-400 data-[state=active]:text-white
              hover:text-white/80 transition-colors font-medium"
          >
            {t('overview')}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="skills"
            className="px-3 py-2 text-sm text-white/50 border-b-2 border-transparent -mb-px
              data-[state=active]:border-cyan-400 data-[state=active]:text-white
              hover:text-white/80 transition-colors font-medium"
          >
            {t('skills')}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ServiceStatusPanel />
            <VncViewer websockifyPort={websockifyPort} vncPassword={vncPassword} />
          </div>
          <SettingsPanel
            onUninstallAction={() => { setForceView('install'); refetch() }}
            onUninstallStartAction={() => setForceView('dashboard')}
          />
          <LiveSyncSetup />
          <ObsidianLogs />
        </Tabs.Content>

        <Tabs.Content value="skills">
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.08] p-6">
            <SkillsPanel />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
