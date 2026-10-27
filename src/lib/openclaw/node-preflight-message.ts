/**
 * Node 預檢擋下時的訊息參數（不依賴 node: 模組，前端也能用）。
 *
 * 文案放在 messages/*.json 的 `openclawNodePreflight` 底下：前端依語系用 next-intl 組字，
 * server 端的 `error`（job log、舊前端）用同一份 zh-TW 範本填值，兩邊不會各說各話。
 */

export type NodeBlockReason = 'both-fail' | 'service-unknown'

export interface NodePreflightBlockDetails {
  /** both-fail：CLI 與 gateway 服務的 Node 都確定不符合；service-unknown：CLI 不符合、讀不到服務的 Node */
  reason: NodeBlockReason
  targetVersion: string
  nodeEngine: string
  cliVersion: string
  cliPath: string
  serviceVersion?: string
  servicePath?: string
}

export const NODE_BLOCK_MESSAGE_KEY: Record<NodeBlockReason, 'blockedBothFail' | 'blockedServiceUnknown'> = {
  'both-fail': 'blockedBothFail',
  'service-unknown': 'blockedServiceUnknown',
}

export function nodeBlockMessageValues(d: NodePreflightBlockDetails): Record<string, string> {
  return {
    target: d.targetVersion,
    engine: d.nodeEngine,
    cliVersion: d.cliVersion,
    cliPath: d.cliPath,
    serviceVersion: d.serviceVersion ?? '',
    servicePath: d.servicePath ?? '',
  }
}

/** 只做 `{name}` 代換（範本裡沒有 ICU 複數／選擇語法） */
export function fillMessageTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
}

export function isNodePreflightBlockDetails(v: unknown): v is NodePreflightBlockDetails {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return (d.reason === 'both-fail' || d.reason === 'service-unknown') &&
    typeof d.targetVersion === 'string' && typeof d.nodeEngine === 'string' &&
    typeof d.cliVersion === 'string' && typeof d.cliPath === 'string'
}
