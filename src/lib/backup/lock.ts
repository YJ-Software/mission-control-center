// 備份與還原共用的單一執行鎖。放在 globalThis：模組被重複載入（server.ts bundle / Next bundle / dev HMR）時仍共用。
const LOCK_KEY = '__mccBackupRunningLogId'
const lockStore = globalThis as unknown as Record<string, number | null | undefined>

function getLock(): number | null {
  return lockStore[LOCK_KEY] ?? null
}

export function isBackupRunning(): boolean {
  return getLock() !== null
}

export function setRunningLogId(id: number | null): void {
  lockStore[LOCK_KEY] = id
}

/** 備份進行中拒絕還原，還原進行中拒絕備份；重啟、升級路由也據此拒絕。 */
export function isBackupOrRestoreBusy(): boolean {
  return getLock() !== null
}

export function getRunningLogId(): number | null {
  return getLock()
}
