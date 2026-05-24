import { EventEmitter } from 'events'

/**
 * Process-local pub/sub for dashboard live updates. server.ts subscribes
 * and forwards every emitted event over the /ws channel as JSON, so
 * connected browsers can react without polling.
 *
 * Event shapes are typed below; producers should only emit those shapes
 * to keep the wire stable.
 *
 * Use one bus for everything (cs:*, notification:*, future channels) so
 * we have a single subscription point on the server.
 */
export const appBus = new EventEmitter()
appBus.setMaxListeners(100)

// --- Customer Service events ---
export interface BusCsNewMessage {
  type: 'cs:new-message'
  payload: { userId: string; messageId: string; direction: string; preview: string; createdAt: number | null }
}
export interface BusCsPauseChanged {
  type: 'cs:pause-changed'
  payload: { userId: string; paused: boolean; resumeAt: number | null }
}
export interface BusCsHandoffMemoriesExtracted {
  type: 'cs:handoff-memories-extracted'
  payload: { userId: string; count: number; errors: number }
}

// --- Dashboard-wide notifications ---
export interface BusNotificationNew {
  type: 'notification:new'
  payload: { id: string; severity: string; title: string; body: string | null; link: string | null; createdAt: number }
}
export interface BusNotificationCleared {
  type: 'notification:cleared'
  payload: { all: boolean; id?: string }
}

export type BusEvent =
  | BusCsNewMessage
  | BusCsPauseChanged
  | BusCsHandoffMemoriesExtracted
  | BusNotificationNew
  | BusNotificationCleared

export function emitBus(event: BusEvent): void {
  appBus.emit('bus', event)
}
