import { reconcileOrphanedJobs } from '@/lib/jobs/recovery'
import type { JobMeta, JobKind } from '@/lib/jobs/types'
import { BackupBusyError } from './lock'

/** 會重啟 MCC、gateway 或整台主機的 job：它們執行中不可開始備份或還原 */
const DISRUPTIVE_KINDS: JobKind[] = [
  'upgrade-mcc', 'upgrade-mcc-tarball', 'upgrade-openclaw', 'restart-mcc', 'restart-openclaw', 'reboot-host',
]

/**
 * 只有本行程 runner 真正在執行的重啟類 job 才會擋。前一個 MCC 行程留下的 running/restarting
 * （例如從 shell 重啟、OOM、主機重開）先用 jobs/recovery 的邏輯回收，否則它會永遠擋住排程備份：
 * 回收原本只在有人打開 System Log（GET /api/jobs）時才跑，而排程器在 server.ts bundle。
 */
export function findBlockingJob(): JobMeta | null {
  try {
    return reconcileOrphanedJobs((j) => DISRUPTIVE_KINDS.includes(j.kind))[0] ?? null
  } catch {
    return null // 讀不到 job 紀錄不應擋住備份
  }
}

export function assertNoBlockingJob(find: () => JobMeta | null = findBlockingJob): void {
  const j = find()
  if (j) throw new BackupBusyError(`${j.label}（${j.kind}）進行中，暫時無法開始備份或還原；請等它完成後再試`)
}
