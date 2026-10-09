import { EventEmitter } from 'events'
import type { JobMeta, LogLine } from './types'

export type JobEvent =
  | { type: 'log'; jobId: string; line: LogLine }
  | { type: 'meta'; jobId: string; meta: JobMeta }
  | { type: 'end'; jobId: string; meta: JobMeta }

// 放在 globalThis：server.ts bundle（備份排程器啟動的 job）與 Next bundle（SSE route）
// 各自載入本模組，必須共用同一個 emitter，事件才送得到訂閱端（同 backup/lock.ts 的做法）
const EMITTER_KEY = '__mccJobEmitter'
const store = globalThis as unknown as Record<string, EventEmitter | undefined>
const emitter: EventEmitter = store[EMITTER_KEY] ??= (() => {
  const e = new EventEmitter()
  e.setMaxListeners(100)
  return e
})()

export function emitJobEvent(ev: JobEvent): void {
  emitter.emit('event', ev)
  emitter.emit(`job:${ev.jobId}`, ev)
}

export function subscribeJob(jobId: string, handler: (ev: JobEvent) => void): () => void {
  emitter.on(`job:${jobId}`, handler)
  return () => emitter.off(`job:${jobId}`, handler)
}

export function subscribeAll(handler: (ev: JobEvent) => void): () => void {
  emitter.on('event', handler)
  return () => emitter.off('event', handler)
}
