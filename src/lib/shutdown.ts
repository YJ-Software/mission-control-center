/**
 * server.ts 的關機流程（抽出來才測得到）。
 *
 * 1. 先跑各項清理（tunnel、terminal…），任何一項丟錯都不影響後續。
 * 2. server.close() 停止接新連線；閒置的 keep-alive 立刻關掉。
 * 3. SSE、WebSocket（含升級後的 /ws、終端、VNC 代理、Next HMR）永遠不會自己結束，
 *    server.close() 會一直等它們；寬限期後把仍開著的 socket 全部切斷，讓 close 回來、正常 exit 0。
 * 4. 不論 server.close() 有沒有回來（force-exit 也一樣），exit 之前一定先關 DB：
 *    better-sqlite3 不關連線就不會 checkpoint，資料會一直留在 db.sqlite-wal。
 */
export interface ClosableServer {
  close(cb?: (err?: Error) => void): unknown
  closeIdleConnections?(): void
}

export interface GracefulShutdownDeps {
  server: ClosableServer
  /** 目前所有開著的 TCP 連線（trackConnections 的回傳值） */
  sockets: Iterable<{ destroy(): void }>
  cleanups: Array<() => void>
  closeDb: () => void
  exit: (code: number) => void
  log?: (msg: string) => void
  /** 給進行中的一般請求完成的時間，之後切斷所有剩下的連線 */
  graceMs?: number
  /** 切斷後仍無法關閉時的最後保險 */
  forceExitMs?: number
}

export function createGracefulShutdown(deps: GracefulShutdownDeps): () => void {
  const log = deps.log ?? ((m: string) => console.log(m))
  const graceMs = deps.graceMs ?? 1500
  const forceExitMs = deps.forceExitMs ?? 5000
  let started = false
  let finished = false

  const finish = (code: number) => {
    if (finished) return
    finished = true
    try { deps.closeDb() } catch (err) { log(`[Server] closing database failed: ${err instanceof Error ? err.message : String(err)}`) }
    deps.exit(code)
  }

  return () => {
    if (started) return
    started = true
    log('[Server] Shutting down...')
    for (const fn of deps.cleanups) {
      try { fn() } catch (err) { log(`[Server] shutdown cleanup failed: ${err instanceof Error ? err.message : String(err)}`) }
    }
    const graceTimer = setTimeout(() => {
      for (const s of Array.from(deps.sockets)) {
        try { s.destroy() } catch { /* ignore */ }
      }
    }, graceMs)
    graceTimer.unref?.()
    const forceTimer = setTimeout(() => {
      log('[Server] Connections did not close in time; forcing exit')
      finish(1)
    }, forceExitMs)
    forceTimer.unref?.()
    deps.server.close(() => finish(0))
    try { deps.server.closeIdleConnections?.() } catch { /* ignore */ }
  }
}

interface ConnectionSource {
  on(event: 'connection', listener: (socket: { destroy(): void; once(event: 'close', l: () => void): unknown }) => void): unknown
}

/** 追蹤 server 上所有 TCP 連線（包含之後被升級成 WebSocket 的），關閉時自動移除。 */
export function trackConnections<S extends { destroy(): void; once(event: 'close', l: () => void): unknown }>(
  server: ConnectionSource,
): Set<S> {
  const set = new Set<S>()
  server.on('connection', (socket) => {
    set.add(socket as S)
    socket.once('close', () => set.delete(socket as S))
  })
  return set
}
