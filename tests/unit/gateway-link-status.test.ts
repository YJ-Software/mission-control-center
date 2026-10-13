import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  gatewayStatusFrame,
  gatewayStatusView,
  parseGatewayStatusFrame,
  GATEWAY_STATUS_FRAME_TYPE,
  type GatewayLinkStatus,
} from '@/lib/gateway/link-status'

const base: GatewayLinkStatus = { state: 'linked', since: 1, runtime: 'openclaw' }

describe('gateway status frame', () => {
  it('round-trips through the wire format', () => {
    const status: GatewayLinkStatus = {
      state: 'pairing-retry', since: 42, runtime: 'openclaw',
      pairingFailures: 3, nextRetryAt: 99, lastClose: { code: 1008, reason: 'pairing required' },
    }
    expect(parseGatewayStatusFrame(JSON.parse(gatewayStatusFrame(status)))).toEqual(status)
  })

  it('ignores other frames and malformed payloads', () => {
    expect(parseGatewayStatusFrame({ type: 'res', id: '1', ok: true })).toBeNull()
    expect(parseGatewayStatusFrame({ type: 'event', event: 'chat', payload: { state: 'linked' } })).toBeNull()
    expect(parseGatewayStatusFrame({ type: GATEWAY_STATUS_FRAME_TYPE, payload: { state: 'bogus' } })).toBeNull()
    expect(parseGatewayStatusFrame({ type: GATEWAY_STATUS_FRAME_TYPE })).toBeNull()
    expect(parseGatewayStatusFrame(null)).toBeNull()
  })
})

describe('gatewayStatusView', () => {
  it('is Linked only when the server says the handshake completed', () => {
    expect(gatewayStatusView(base, true)).toEqual({ tone: 'active', labelKey: 'linked' })
  })

  it('does not claim Linked just because this tab reached MCC (the original bug)', () => {
    expect(gatewayStatusView(null, true).labelKey).toBe('connecting')
    for (const state of ['connecting', 'starting', 'pairing', 'pairing-retry', 'auth-failed', 'offline'] as const) {
      expect(gatewayStatusView({ ...base, state }, true).labelKey).not.toBe('linked')
    }
  })

  it('gives pairing, retrying and disconnected distinct labels', () => {
    expect(gatewayStatusView({ ...base, state: 'pairing' }, true)).toEqual({ tone: 'pending', labelKey: 'pairing' })
    expect(gatewayStatusView({ ...base, state: 'pairing-retry', pairingFailures: 4 }, true))
      .toEqual({ tone: 'error', labelKey: 'pairingRetry', values: { n: 4 } })
    expect(gatewayStatusView({ ...base, state: 'offline' }, true)).toEqual({ tone: 'error', labelKey: 'offline' })
    expect(gatewayStatusView({ ...base, state: 'auth-failed' }, true)).toEqual({ tone: 'error', labelKey: 'authFailed' })
  })

  it('shows a booting gateway as starting (pending), not offline', () => {
    expect(gatewayStatusView({ ...base, state: 'starting' }, true)).toEqual({ tone: 'pending', labelKey: 'starting' })
    const frame = gatewayStatusFrame({ ...base, state: 'starting', lastClose: { code: 1013, reason: 'gateway starting' } })
    expect(parseGatewayStatusFrame(JSON.parse(frame))?.state).toBe('starting')
  })

  it('says the dashboard is disconnected when the tab lost MCC, whatever the last status was', () => {
    expect(gatewayStatusView(base, false)).toEqual({ tone: 'error', labelKey: 'dashboardOffline' })
  })

  it('shows Hermes mode instead of a Gateway that does not exist there', () => {
    expect(gatewayStatusView({ ...base, state: 'offline', runtime: 'hermes' }, true).labelKey).toBe('hermes')
  })

  it('has a label for every view key in all three locales', () => {
    const keys = ['linked', 'connecting', 'starting', 'pairing', 'pairingRetry', 'authFailed', 'offline', 'dashboardOffline', 'hermes']
    for (const locale of ['en', 'zh-TW', 'zh-CN']) {
      const msgs = JSON.parse(readFileSync(join(__dirname, `../../messages/${locale}.json`), 'utf8'))
      for (const k of keys) {
        expect(typeof msgs.nav.gatewayStatus[k], `${locale} nav.gatewayStatus.${k}`).toBe('string')
      }
      expect(msgs.nav.gatewayStatus.pairingRetry).toContain('{n}')
    }
  })
})
