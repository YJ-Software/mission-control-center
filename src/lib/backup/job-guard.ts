import { readAllJobsSync } from '@/lib/jobs/store'
import type { JobMeta, JobKind } from '@/lib/jobs/types'
import { BackupBusyError } from './lock'

/** 會重啟 MCC、gateway 或整台主機的 job：它們執行中不可開始備份或還原 */
const DISRUPTIVE_KINDS: JobKind[] = [
  'upgrade-mcc', 'upgrade-mcc-tarball', 'upgrade-openclaw', 'restart-mcc', 'restart-openclaw', 'reboot-host',
]

export function findBlockingJob(): JobMeta | null {
  try {
    return readAllJobsSync().find(
      (j) => (j.status === 'running' || j.status === 'restarting') && DISRUPTIVE_KINDS.includes(j.kind),
    ) ?? null
  } catch {
    return null // 讀不到 job 紀錄不應擋住備份
  }
}

export function assertNoBlockingJob(find: () => JobMeta | null = findBlockingJob): void {
  const j = find()
  if (j) throw new BackupBusyError(`${j.label}（${j.kind}）進行中，暫時無法開始備份或還原；請等它完成後再試`)
}
