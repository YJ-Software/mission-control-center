export const AGENT_RPC_METHODS = new Set<string>([
  'agents.list',
  'agent.identity.get',
  'agents.files.list',
  'agents.files.get',
  'agents.files.set',
  'skills.status',
  'skills.detail',
  'skills.search',
  'skills.update',
  'skills.install',
  'tools.catalog',
  'tools.effective',
  'models.list',
  'models.authStatus',
  'cron.list',
  'cron.status',
  'cron.runs',
  'cron.add',
  'cron.update',
  'cron.remove',
  'cron.run',
  'channels.status',
  'channels.logout',
  'config.get',
  'config.schema',
  'config.patch',
])

export function isAllowedAgentRpc(method: string): boolean {
  return AGENT_RPC_METHODS.has(method)
}
