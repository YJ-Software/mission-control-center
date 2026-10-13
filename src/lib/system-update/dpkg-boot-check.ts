/** 開機後背景檢查一次 dpkg 是否停在中斷狀態（上次 apt 被 MCC 重啟、OCD deployer、主機重開打斷）。
 *
 * 有問題就寫一則通知；通知中心依 dedupKey 顯示「修復」按鈕，按下去走 /api/action `dpkg-repair`
 * （job runner 執行同一個 `sudo -n dpkg --configure -a`，有日誌）。第一版只偵測＋提示，不自動修：
 * 開機時以 sudo 跑數分鐘可能撞上 unattended-upgrades 的鎖。 */

import { checkDpkgHealth, type DpkgCheckDeps, type DpkgHealth } from './dpkg-repair'
import { DPKG_INTERRUPTED_DEDUP_KEY } from '@/lib/long-run-client'

/** 通知中心靠這個 dedupKey 認出「可以一鍵修復」的通知 */
export { DPKG_INTERRUPTED_DEDUP_KEY }

export interface DpkgBootCheckDeps extends DpkgCheckDeps {
  check?: (deps: DpkgCheckDeps) => Promise<DpkgHealth>
  notify?: (input: { title: string; body: string }) => void
}

async function defaultNotify(input: { title: string; body: string }): Promise<void> {
  const { createNotification } = await import('@/lib/notifications')
  createNotification({
    type: 'system',
    severity: 'warning',
    title: input.title,
    body: input.body,
    dedupKey: DPKG_INTERRUPTED_DEDUP_KEY,
  })
}

export function buildDpkgNotice(detail: string): { title: string; body: string } {
  return {
    title: '上次的系統套件安裝被中斷，需要修復',
    body:
      `${detail}\n\n` +
      '在修復之前，之後的套件安裝與系統更新都會失敗。按「修復」會執行 sudo dpkg --configure -a（可在系統日誌查看進度）。',
  }
}

export interface RecheckDeps extends DpkgBootCheckDeps {
  clear?: () => void
}

async function defaultClear(): Promise<void> {
  const { deleteNotificationsByDedupKey } = await import('@/lib/notifications')
  deleteNotificationsByDedupKey(DPKG_INTERRUPTED_DEDUP_KEY)
}

/**
 * 一鍵修復的 job 結束後呼叫：已恢復就刪掉「dpkg 中斷」通知（重新整理後不再出現「修復」按鈕）；
 * 仍然中斷就重新通知（使用者按修復時已標為已讀，dedupKey 只擋未讀，所以會出現一則新的，按鈕回來）。絕不丟錯。
 */
export async function recheckDpkgAfterRepair(deps: RecheckDeps = {}): Promise<'cleared' | 'notified' | 'unsupported' | 'error'> {
  try {
    const health = await (deps.check ?? checkDpkgHealth)(deps)
    if (!health.supported) return 'unsupported'
    if (!health.interrupted) {
      if (deps.clear) deps.clear()
      else await defaultClear()
      return 'cleared'
    }
    const notice = buildDpkgNotice(health.detail)
    if (deps.notify) deps.notify(notice)
    else await defaultNotify(notice)
    return 'notified'
  } catch (e) {
    console.warn('[dpkg] recheck after repair skipped:', e instanceof Error ? e.message : String(e))
    return 'error'
  }
}

/** 絕不丟錯；回傳結果供測試與 log 使用 */
export async function runDpkgBootCheck(deps: DpkgBootCheckDeps = {}): Promise<'ok' | 'notified' | 'unsupported' | 'error'> {
  try {
    const health = await (deps.check ?? checkDpkgHealth)(deps)
    if (!health.supported) return 'unsupported'
    if (!health.interrupted) return 'ok'
    const notice = buildDpkgNotice(health.detail)
    if (deps.notify) deps.notify(notice)
    else await defaultNotify(notice)
    console.warn('[dpkg] interrupted package install detected:', health.detail.split('\n')[0])
    return 'notified'
  } catch (e) {
    console.warn('[dpkg] boot check skipped:', e instanceof Error ? e.message : String(e))
    return 'error'
  }
}
