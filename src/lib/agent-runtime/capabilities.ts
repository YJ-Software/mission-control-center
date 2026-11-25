export type BackendKind = 'openclaw' | 'hermes'

const pageCapabilities = {
  '/agents': 'agents',
  '/customer-service': 'customerService',
  '/live-feed': 'liveFeed',
  '/cron-jobs': 'cron',
  '/morning-report': 'morningReport',
  '/second-brain': 'wiki',
  '/llm-auth': 'llmManagement',
  '/setup': 'openclawSetup',
} as const

export interface BackendCapabilities {
  agents: boolean
  customerService: boolean
  liveFeed: boolean
  cron: boolean
  morningReport: boolean
  wiki: boolean
  llmManagement: boolean
  openclawSetup: boolean
  backupTarget: BackendKind
  modelPicker: boolean
  interactivePrompts: { approvals: boolean; questions: boolean }
  service: { name: string; restartAction: 'restart-openclaw' | 'restart-hermes'; upgrade: boolean; userUnit: string }
}

export function capabilitiesFor(kind: BackendKind): BackendCapabilities {
  const openclaw = kind === 'openclaw'
  return {
    agents: openclaw,
    customerService: openclaw,
    liveFeed: openclaw,
    cron: openclaw,
    morningReport: openclaw,
    wiki: openclaw,
    llmManagement: openclaw,
    openclawSetup: openclaw,
    backupTarget: kind,
    modelPicker: openclaw,
    interactivePrompts: { approvals: true, questions: openclaw },
    service: openclaw
      ? { name: 'OpenClaw', restartAction: 'restart-openclaw', upgrade: true, userUnit: 'openclaw-gateway.service' }
      : { name: 'Hermes', restartAction: 'restart-hermes', upgrade: false, userUnit: 'hermes-gateway.service' },
  }
}

export function supportsPage(capabilities: BackendCapabilities, pathname: string): boolean {
  const root = `/${pathname.split('/')[1]}`
  const capability = pageCapabilities[root as keyof typeof pageCapabilities]
  return !capability || capabilities[capability]
}
