// 本行程 runner 正在執行的 job id。放在 globalThis：server.ts bundle 與 Next bundle 是同一個行程、
// 各自載入 runner，必須共用同一份紀錄（同 backup/lock.ts 的做法）。job 不會脫離 MCC 行程存活
// （runner 以一般子行程執行，不 detach），所以 index 中 running/restarting 但不在這裡的 job，
// 一定是前一個 MCC 行程留下的孤兒。
const KEY = '__mccLiveJobIds'
const store = globalThis as unknown as Record<string, Set<string> | undefined>

function live(): Set<string> {
  return (store[KEY] ??= new Set<string>())
}

export function markJobLive(id: string): void { live().add(id) }
export function markJobDone(id: string): void { live().delete(id) }
export function isJobLive(id: string): boolean { return live().has(id) }
