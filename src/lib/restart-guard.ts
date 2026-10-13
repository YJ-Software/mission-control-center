// MCC 自己發起的重啟（重啟儀表板、升級、重開機、release 還原）共用的互鎖。
// 長時間安裝作業進行中預設 409；使用者在前端二次確認後帶 force: true 可強制略過，並留下紀錄。

import type { PhaseSpec } from '@/lib/jobs/runner'
import { forcedRestartNote, listLongRuns, waitForNoLongRuns, type LongRunEntry } from '@/lib/long-running'

/** body.force / header 只接受明確的 true，不把任意 truthy 值當成強制 */
export function parseForce(v: unknown): boolean {
  return v === true || v === 'true' || v === '1'
}

export interface RestartGate {
  /** 非 null：要回 409 */
  blocked: LongRunEntry[] | null
  /** 強制略過時的紀錄（同時寫進伺服器 log） */
  note: string | null
}

export function checkRestartGate(force: boolean, list: LongRunEntry[] = listLongRuns()): RestartGate {
  if (list.length === 0) return { blocked: null, note: null }
  if (!force) return { blocked: list, note: null }
  const note = forcedRestartNote(list)
  console.warn(`[restart] ${note}`)
  return { blocked: null, note }
}

export const WAIT_FOR_INSTALLS_PHASE = '等待安裝作業結束'

/**
 * 放在重啟 phase 之前的獨立 phase：等待期間 job 仍是 running（restartingBeforeLastPhase 只在最後一個
 * phase 才切成 restarting），前端的重啟等待畫面不會先逾時。入口已 409；這裡擋的是入口之後才開始的安裝。
 * force 時不等，只把略過的清單寫進 job log。
 */
export function waitForInstallsPhase(force: boolean, wait: typeof waitForNoLongRuns = waitForNoLongRuns): PhaseSpec {
  return {
    name: WAIT_FOR_INSTALLS_PHASE,
    inline: async (log) => {
      if (force) {
        const list = listLongRuns()
        log('system', list.length > 0 ? forcedRestartNote(list) : '使用者強制重啟（目前沒有進行中的安裝作業）')
        return 0
      }
      await wait((m) => log('system', m))
      return 0
    },
  }
}
