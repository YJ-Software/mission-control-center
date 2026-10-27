/**
 * 合併 `chat.history` 回應與「請求進行中」本機新增的訊息。
 *
 * `refreshHistory` 送出請求時會先清空畫面，所以回應到達時畫面上有的東西，都是請求期間才加上的：
 * 頁面一載入就送出的樂觀 user 訊息，或在那期間到達的 final／error／aborted 事件。舊做法直接用
 * 歷史整個取代，2026-10-26 E2E（OpenClaw 10.7）兩次撞到 chat.send 比 chat.history 晚 60–80 ms
 * 送出、卻在歷史快照之後才寫入，歷史回來不含這則，使用者的提問就從畫面上消失（gateway 其實有存）。
 *
 * 本機訊息若歷史已含同一則就略過，否則接在歷史後面（它們都比請求晚，順序不用重排）：
 * - 有 runId 時精確比對：歷史的 user 帶 `idempotencyKey: "<key>:user"`、assistant 帶
 *   `__openclaw.runId`，對上 chat.send 的 idempotencyKey／事件的 runId（10.7 實測有這兩個欄位）。
 * - 歷史沒有 runId（較舊的 gateway）時退回內容比對：同角色、同內容、時間不早於本機訊息
 *   `CONTENT_MATCH_WINDOW_MS` 之前；每則歷史訊息只能抵掉一則本機訊息。user 的本機時間是瀏覽器時鐘、
 *   歷史是 gateway 時鐘，時鐘差超過視窗時會重複顯示一次（reload 即消失），寧可重複也不要吃掉訊息。
 */

export interface MergeableMessage {
  role: string
  content: string
  timestamp: number
  /** chat.send 的 idempotencyKey（= 該輪的 runId）；沒有就是未知 */
  runId?: string
}

export const CONTENT_MATCH_WINDOW_MS = 5_000

export function mergeHistoryWithLocal<T extends MergeableMessage>(history: T[], local: T[]): T[] {
  if (local.length === 0) return history

  const historyRunKeys = new Set<string>()
  for (const h of history) {
    if (h.runId) historyRunKeys.add(`${h.role}:${h.runId}`)
  }
  // 只有沒帶 runId 的歷史訊息才拿來做內容比對，且每則只能用一次
  const unkeyed = history.filter(h => !h.runId)
  const used = new Set<T>()

  const late = local.filter(m => {
    if (m.runId && historyRunKeys.has(`${m.role}:${m.runId}`)) return false
    const match = unkeyed.find(h =>
      !used.has(h) &&
      h.role === m.role &&
      h.content === m.content &&
      h.timestamp >= m.timestamp - CONTENT_MATCH_WINDOW_MS)
    if (match) {
      used.add(match)
      return false
    }
    return true
  })

  return late.length > 0 ? [...history, ...late] : history
}

/** 歷史訊息的 runId：user 取 idempotencyKey（去掉 `:user` 後綴），assistant 取 `__openclaw.runId` */
export function historyRunId(m: {
  role: string
  idempotencyKey?: unknown
  __openclaw?: { runId?: unknown; idempotencyKey?: unknown } | null
}): string | undefined {
  if (m.role === 'user') {
    const key = typeof m.idempotencyKey === 'string' ? m.idempotencyKey
      : typeof m.__openclaw?.idempotencyKey === 'string' ? m.__openclaw.idempotencyKey
      : undefined
    return key ? key.replace(/:user$/, '') : undefined
  }
  const runId = m.__openclaw?.runId
  return typeof runId === 'string' && runId ? runId : undefined
}
