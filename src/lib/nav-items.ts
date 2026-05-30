import {
  LayoutDashboard, Clock, Newspaper,
  MessageSquare, Settings, BrainCircuit, TerminalSquare, Globe, Users, DollarSign, Zap, Container, HardDrive, Wrench, Bot, Headphones, ScrollText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  icon: LucideIcon
  labelKey: string
  code: string
}

export const navItems: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard', code: 'DASH' },
  { href: '/chat', icon: MessageSquare, labelKey: 'chat', code: 'CHAT' },
  { href: '/agents', icon: Bot, labelKey: 'agents', code: 'AGNT' },
  { href: '/customer-service', icon: Headphones, labelKey: 'customerService', code: 'CS' },
  { href: '/terminal', icon: TerminalSquare, labelKey: 'terminal', code: 'TERM' },
  { href: '/browser', icon: Globe, labelKey: 'browser', code: 'BROW' },
  { href: '/sessions', icon: Users, labelKey: 'sessions', code: 'SESS' },
  { href: '/costs', icon: DollarSign, labelKey: 'costs', code: 'COST' },
  { href: '/live-feed', icon: Zap, labelKey: 'liveFeed', code: 'FEED' },
  { href: '/cron-jobs', icon: Clock, labelKey: 'cronJobs', code: 'CRON' },
  { href: '/system-log', icon: ScrollText, labelKey: 'systemLog', code: 'LOG' },
  { href: '/morning-report', icon: Newspaper, labelKey: 'morningReport', code: 'RPT' },
  { href: '/second-brain', icon: BrainCircuit, labelKey: 'secondBrain', code: 'BRAIN' },
  { href: '/docker', icon: Container, labelKey: 'docker', code: 'DOCK' },
  { href: '/backup', icon: HardDrive, labelKey: 'backup', code: 'BKUP' },
  { href: '/setup', icon: Wrench, labelKey: 'setup', code: 'INIT' },
  { href: '/settings', icon: Settings, labelKey: 'settings', code: 'CONF' },
]
