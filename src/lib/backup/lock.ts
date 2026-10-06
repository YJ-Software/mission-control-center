// 備份與還原共用的單一執行鎖。放在 globalThis：模組被重複載入（server.ts bundle / Next bundle / dev HMR）時仍共用。
const LOCK_KEY = '__mccBackupRunningLogId'
const OWNER_KEY = '__mccBackupLockOwner'
const SEQ_KEY = '__mccBackupLockSeq'
const store = globalThis as unknown as Record<string, number | null | undefined>

export class BackupBusyError extends Error {
  constructor(message = 'A backup or restore is already running') { super(message) }
}

function getLock(): number | null {
  return store[LOCK_KEY] ?? null
}

export function isBackupRunning(): boolean {
  return getLock() !== null
}

/** 取得鎖並回傳擁有者 token；釋放時必須出示，過期的計時器因此清不掉較新擁有者的鎖。 */
export function acquireLock(id: number): number {
  const token = (store[SEQ_KEY] ?? 0) + 1
  store[SEQ_KEY] = token
  store[LOCK_KEY] = id
  store[OWNER_KEY] = token
  return token
}

/** 只有 token 仍是目前擁有者才釋放；回傳是否真的釋放。 */
export function releaseLock(token: number): boolean {
  if (store[OWNER_KEY] !== token) return false
  store[LOCK_KEY] = null
  store[OWNER_KEY] = null
  return true
}

/** 無條件設定／清除（測試與舊呼叫端用）；非 null 時也會換新擁有者。 */
export function setRunningLogId(id: number | null): void {
  if (id === null) { store[LOCK_KEY] = null; store[OWNER_KEY] = null } else acquireLock(id)
}

/** 備份進行中拒絕還原，還原進行中拒絕備份；重啟、升級路由也據此拒絕。 */
export function isBackupOrRestoreBusy(): boolean {
  return getLock() !== null
}

export function getRunningLogId(): number | null {
  return getLock()
}
