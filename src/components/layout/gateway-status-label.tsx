'use client'

import { useTranslations } from 'next-intl'
import { useWebSocket } from '@/store/websocket'
import { gatewayStatusView } from '@/lib/gateway/link-status'
import { useBackendCapabilities } from './backend-capabilities'

export function GatewayStoppingNotice({ className = '' }: { className?: string }) {
  const { service } = useBackendCapabilities()
  const { connected, gatewayStatus } = useWebSocket()
  const t = useTranslations('nav.gatewayStatus')
  if (!service.upgrade || !connected || gatewayStatus?.state !== 'stopping') return null
  const view = gatewayStatusView(gatewayStatus, connected)
  return (
    <div className={`flex items-center gap-2 text-xs text-amber-200 ${className}`} role="status" data-gateway-stopping>
      <span className="status-dot-pending shrink-0" />
      {t(view.labelKey, view.values)}
    </div>
  )
}

/**
 * Status dot + label for MCC's own link to the Gateway. "Linked" only after
 * the Gateway handshake completed — not merely because this tab reached MCC.
 */
export function GatewayStatusLabel() {
  const { connected, gatewayStatus } = useWebSocket()
  const t = useTranslations('nav.gatewayStatus')
  const view = gatewayStatusView(gatewayStatus, connected)
  const lastClose = view.labelKey.startsWith('stopping') ? null : gatewayStatus?.lastClose
  const title = lastClose ? `${lastClose.code} ${lastClose.reason}`.trim() : undefined

  return (
    <>
      <span className={`status-dot-${view.tone} shrink-0`} />
      <span
        className={`font-mono text-[10px] tracking-wide ${gatewayStatus?.state === 'stopping' && connected ? 'text-amber-200' : 'text-white/35'}`}
        data-gateway-state={gatewayStatus?.state ?? 'unknown'}
        title={title}
      >
        {t(view.labelKey, view.values)}
      </span>
    </>
  )
}
