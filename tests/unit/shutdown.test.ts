import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { createGracefulShutdown, trackConnections } from '@/lib/shutdown'

/** 模擬 http.Server：close() 要等所有連線結束才回呼 */
function fakeServer() {
  const sockets = new Set<{ destroy: () => void }>()
  let closeCb: ((err?: Error) => void) | null = null
  const maybeClosed = () => { if (closeCb && sockets.size === 0) { const cb = closeCb; closeCb = null; cb() } }
  const server = {
    close: vi.fn((cb?: (err?: Error) => void) => { closeCb = cb ?? null; maybeClosed() }),
    closeIdleConnections: vi.fn(),
  }
  const open = () => {
    const s = { destroy: vi.fn(() => { sockets.delete(s); maybeClosed() }) }
    sockets.add(s)
    return s
  }
  return { server, sockets, open }
}

let calls: string[]
beforeEach(() => { vi.useFakeTimers(); calls = [] })
afterEach(() => { vi.useRealTimers() })

function deps(f: ReturnType<typeof fakeServer>, over: Partial<Parameters<typeof createGracefulShutdown>[0]> = {}) {
  return {
    server: f.server,
    sockets: f.sockets,
    cleanups: [() => { calls.push('tunnel') }, () => { calls.push('terminal') }],
    closeDb: () => { calls.push('closeDb') },
    exit: (code: number) => { calls.push(`exit:${code}`) },
    log: () => {},
    graceMs: 1000,
    forceExitMs: 5000,
    ...over,
  }
}

describe('createGracefulShutdown', () => {
  it('沒有長連線：server.close 回來後先關 DB 再 exit 0', () => {
    const f = fakeServer()
    createGracefulShutdown(deps(f))()
    expect(calls).toEqual(['tunnel', 'terminal', 'closeDb', 'exit:0'])
  })

  it('SSE/WebSocket 還開著：寬限期後主動切斷，仍以 exit 0 結束，且 DB 先關', () => {
    const f = fakeServer()
    const sse = f.open()
    const ws = f.open()
    createGracefulShutdown(deps(f))()
    expect(calls).toEqual(['tunnel', 'terminal'])
    vi.advanceTimersByTime(1000)
    expect(sse.destroy).toHaveBeenCalled()
    expect(ws.destroy).toHaveBeenCalled()
    expect(calls).toEqual(['tunnel', 'terminal', 'closeDb', 'exit:0'])
  })

  it('server.close 永遠不回來：force-exit 前仍會關 DB', () => {
    const f = fakeServer()
    const stuck = { destroy: vi.fn() } // destroy 了也不會讓 close 回呼
    f.sockets.add(stuck)
    createGracefulShutdown(deps(f))()
    vi.advanceTimersByTime(5000)
    expect(calls).toEqual(['tunnel', 'terminal', 'closeDb', 'exit:1'])
  })

  it('cleanup 或 closeDb 丟錯不會擋住關機', () => {
    const f = fakeServer()
    createGracefulShutdown(deps(f, {
      cleanups: [() => { throw new Error('tunnel boom') }],
      closeDb: () => { calls.push('closeDb'); throw new Error('db boom') },
    }))()
    expect(calls).toEqual(['closeDb', 'exit:0'])
  })

  it('重複收到訊號（SIGTERM 後又 SIGINT）只執行一次', () => {
    const f = fakeServer()
    f.open()
    const shutdown = createGracefulShutdown(deps(f))
    shutdown()
    shutdown()
    vi.advanceTimersByTime(10_000)
    expect(calls.filter((c) => c === 'closeDb')).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('exit:'))).toEqual(['exit:0'])
  })
})

describe('trackConnections', () => {
  it('記錄連線，連線關閉後移除', () => {
    const server = new EventEmitter()
    const set = trackConnections(server as any)
    const socket = new EventEmitter()
    server.emit('connection', socket)
    expect(set.has(socket as any)).toBe(true)
    socket.emit('close')
    expect(set.size).toBe(0)
  })
})

describe('接線（server.ts 會 spawn 整個 Next，無法直接 import 來測）', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string
  it('server.ts 的 SIGTERM/SIGINT 走 createGracefulShutdown，並把 closeDb 與連線追蹤交給它', () => {
    const src = read('server.ts')
    // 只看 createGracefulShutdown({ ... }) 這個參數物件本身（到第一個縮排兩格的 `})` 為止）
    const call = src.match(/createGracefulShutdown\(\{\n([\s\S]*?)\n  \}\)/)
    expect(call, 'server.ts 找不到 createGracefulShutdown({ ... }) 呼叫').not.toBeNull()
    expect(call![1]).toMatch(/^\s*closeDb\s*[,:]/m)
    expect(call![1]).toMatch(/^\s*sockets\s*:\s*openSockets\b/m)
    expect(src).toMatch(/trackConnections\(server\)/)
    expect(src).toMatch(/process\.on\('SIGTERM', gracefulShutdown\)/)
    expect(src).not.toMatch(/setTimeout\(\(\) => process\.exit\(1\)/)
  })
  it('db.ts 把自己開的連線登記到 closeDb 的登記表', () => {
    expect(read('src/lib/db.ts')).toMatch(/registerDbConnection\(sqlite\)/)
  })
})
