import { EventEmitter } from 'events'
import type { JobMeta, LogLine } from './types'

export type JobEvent =
  | { type: 'log'; jobId: string; line: LogLine }
  | { type: 'meta'; jobId: string; meta: JobMeta }
  | { type: 'end'; jobId: string; meta: JobMeta }

const emitter = new EventEmitter()
emitter.setMaxListeners(100)

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
