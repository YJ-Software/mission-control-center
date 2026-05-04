'use client'

import * as Tabs from '@radix-ui/react-tabs'
import {
  LayoutDashboard, HardDrive, FolderOpen,
  Calendar, Briefcase, RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BackupDashboard } from './backup-dashboard'
import { BackupDestinations } from './backup-destinations'
import { BackupSources } from './backup-sources'
import { BackupSchedules } from './backup-schedules'
import { BackupJobs } from './backup-jobs'
import { BackupRestore } from './backup-restore'

export function BackupContent() {
  const t = useTranslations('backup')
  const [activeTab, setActiveTab] = useState('dashboard')

  const tabs = [
    { value: 'dashboard', icon: LayoutDashboard, label: t('tabs.dashboard') },
    { value: 'destinations', icon: HardDrive, label: t('tabs.destinations') },
    { value: 'sources', icon: FolderOpen, label: t('tabs.sources') },
    { value: 'schedules', icon: Calendar, label: t('tabs.schedules') },
    { value: 'jobs', icon: Briefcase, label: t('tabs.jobs') },
    { value: 'restore', icon: RotateCcw, label: t('tabs.restore') },
  ]

  return (
    <div className="p-6">
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-1 mb-6 bg-white/[0.04] rounded-lg p-1 border border-white/[0.08] overflow-x-auto">
          {tabs.map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm text-white/60
                data-[state=active]:bg-white/[0.08] data-[state=active]:text-cyan-400
                hover:text-white/80 transition-colors font-medium whitespace-nowrap"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="dashboard"><BackupDashboard onNavigate={setActiveTab} /></Tabs.Content>
        <Tabs.Content value="destinations"><BackupDestinations /></Tabs.Content>
        <Tabs.Content value="sources"><BackupSources /></Tabs.Content>
        <Tabs.Content value="schedules"><BackupSchedules /></Tabs.Content>
        <Tabs.Content value="jobs"><BackupJobs /></Tabs.Content>
        <Tabs.Content value="restore"><BackupRestore /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
