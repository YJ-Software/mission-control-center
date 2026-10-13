// 前端用：解析重啟路徑回的 409（code: 'long-run-busy'），列出正在跑的安裝作業。純函式，不可 import 伺服器端模組。

/** 「dpkg 被中斷」通知的 dedupKey：通知中心看到它就顯示「修復」按鈕（伺服器端 dpkg-boot-check.ts 用同一個常數） */
export const DPKG_INTERRUPTED_DEDUP_KEY = 'dpkg-interrupted'

export interface LongRunInfo {
  name: string
  startedAt: string
  pid: number | null
  step: string | null
}

/** 不是長時間作業造成的 409（或格式不對）回傳 null，呼叫端照原本方式顯示 */
export function parseLongRunBusy(data: unknown): LongRunInfo[] | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { code?: unknown; longRuns?: unknown }
  if (d.code !== 'long-run-busy' || !Array.isArray(d.longRuns)) return null
  const list = d.longRuns
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string')
    .map((r) => ({
      name: r.name as string,
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
      pid: typeof r.pid === 'number' ? r.pid : null,
      step: typeof r.step === 'string' ? r.step : null,
    }))
  return list.length > 0 ? list : null
}
