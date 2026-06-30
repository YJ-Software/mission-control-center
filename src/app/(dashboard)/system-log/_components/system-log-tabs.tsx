'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ListChecks, Terminal, Bot, ShieldBan } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SystemLogView } from './system-log-view'
import { LogViewer } from './log-viewer'

type Tab = 'jobs' | 'linux' | 'openclaw' | 'fail2ban'

const TABS: { id: Tab; icon: typeof ListChecks; labelKey: string }[] = [
  { id: 'jobs', icon: ListChecks, labelKey: 'tabJobs' },
  { id: 'linux', icon: Terminal, labelKey: 'tabLinux' },
  { id: 'openclaw', icon: Bot, labelKey: 'tabOpenclaw' },
  { id: 'fail2ban', icon: ShieldBan, labelKey: 'tabFail2ban' },
]

export function SystemLogTabs() {
  const t = useTranslations('systemLog')
  const sp = useSearchParams()
  const router = useRouter()
  const active = (sp.get('tab') as Tab) || 'jobs'

  const select = (tab: Tab) => {
    const params = new URLSearchParams(sp.toString())
    params.set('tab', tab)
    // The job-detail selection only applies to the jobs tab.
    if (tab !== 'jobs') params.delete('job')
    router.replace(`/system-log?${params}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex items-center gap-1 px-3 pt-3" role="tablist">
        {TABS.map((tab) => {
          const on = active === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={on}
              onClick={() => select(tab.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[12px] font-medium transition-colors',
                on
                  ? 'border-cyan-400 text-white'
                  : 'border-transparent text-white/45 hover:text-white/75',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(tab.labelKey)}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1">
        {active === 'jobs' && <SystemLogView />}
        {active === 'linux' && <LogViewer endpoint="/api/system-log/linux" queryKey="linux" />}
        {active === 'openclaw' && <LogViewer endpoint="/api/system-log/openclaw" queryKey="openclaw" />}
        {active === 'fail2ban' && <LogViewer endpoint="/api/system-log/fail2ban" queryKey="fail2ban" />}
      </div>
    </div>
  )
}
