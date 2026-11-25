import { capabilitiesFor, type BackendKind } from './capabilities'

export function agentRuntimeKind(): BackendKind {
  const kind = (process.env.MCC_AGENT_RUNTIME || 'openclaw').trim().toLowerCase()
  if (kind === 'openclaw' || kind === 'hermes') return kind
  throw new Error('Unknown MCC_AGENT_RUNTIME (expected "openclaw" or "hermes")')
}

export function getBackendCapabilities() {
  return capabilitiesFor(agentRuntimeKind())
}

export async function unsupportedGatewayRpc(): Promise<never> {
  throw new Error('OpenClaw gateway RPC is not supported on Hermes backend')
}
