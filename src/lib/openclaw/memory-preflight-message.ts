/**
 * 記憶體預檢擋下時的訊息參數（不依賴 node: 模組，前端也能用）。
 *
 * 文案放在 messages/*.json 的 `openclawMemoryPreflight` 底下：前端依語系用 next-intl 組字，
 * server 端的 `error`（job log、舊前端）用同一份 zh-TW 範本填值，兩邊不會各說各話。
 */

export interface MemoryPreflightBlockDetails {
  /** 估計升級時可用的記憶體（MemAvailable + SwapFree + 會先停掉的 gateway 佔用），MB */
  estimateMb: number
  /** 擋下的門檻，MB */
  requiredMb: number
  memAvailableMb: number
  swapFreeMb: number
  /** 升級前會先停掉的 gateway 佔用（停不掉或沒在跑時為 0），MB */
  gatewayMb: number
}

export const MEMORY_BLOCK_MESSAGE_KEY = 'blocked'

export function memoryBlockMessageValues(d: MemoryPreflightBlockDetails): Record<string, string> {
  return {
    estimate: String(d.estimateMb),
    required: String(d.requiredMb),
    available: String(d.memAvailableMb),
    swap: String(d.swapFreeMb),
    gateway: String(d.gatewayMb),
  }
}

export function isMemoryPreflightBlockDetails(v: unknown): v is MemoryPreflightBlockDetails {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return ['estimateMb', 'requiredMb', 'memAvailableMb', 'swapFreeMb', 'gatewayMb'].every(k => typeof d[k] === 'number')
}
