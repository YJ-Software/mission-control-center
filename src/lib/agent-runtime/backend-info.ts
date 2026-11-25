import { getHermesVersion } from './hermes-host'
import { agentRuntimeKind, getBackendCapabilities } from './selection'

/** Running version for health, without spawning the OpenClaw CLI on probes. */
export async function getBackendInfo() {
  const kind = agentRuntimeKind()
  const version = kind === 'hermes'
    ? await getHermesVersion()
    : (globalThis as { __gatewayVersion?: string }).__gatewayVersion ?? null
  return { kind, version, capabilities: getBackendCapabilities() }
}
