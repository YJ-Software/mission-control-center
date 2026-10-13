'use client'

import { useTranslations } from 'next-intl'
import { useWebSocket } from '@/store/websocket'
import { gatewayStatusView } from '@/lib/gateway/link-status'

/**
 * Status dot + label for MCC's own link to the Gateway. "Linked" only after
 * the Gateway handshake completed — not merely because this tab reached MCC.
 */
export function GatewayStatusLabel() {
  const { connected, gatewayStatus } = useWebSocket()
  const t = useTranslations('nav.gatewayStatus')
  const view = gatewayStatusView(gatewayStatus, connected)
  const lastClose = gatewayStatus?.state !== 'linked' ? gatewayStatus?.lastClose : null
  const title = lastClose ? `${lastClose.code} ${lastClose.reason}`.trim() : undefined

  return (
    <>
      <span className={`status-dot-${view.tone}`} />
      <span
        className="font-mono text-[10px] tracking-wide text-white/35"
        data-gateway-state={gatewayStatus?.state ?? 'unknown'}
        title={title}
      >
        {t(view.labelKey, view.values)}
      </span>
    </>
  )
}
