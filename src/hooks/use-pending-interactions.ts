'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '@/store/websocket'
import {
  INTERACTION_EVENTS,
  applyInteractionEvent,
  approvalResolveRequest,
  interactionsForSession,
  pruneExpired,
  questionCancelParams,
  questionResolveParams,
  removeInteraction,
  secretResolveParams,
  seedInteractions,
  type ApprovalDecision,
  type PendingApproval,
  type PendingInteraction,
  type PendingQuestion,
} from '@/lib/openclaw/interactions'

/** Grace past a prompt's expiry before hiding it, so clock skew between the
 * browser and the Gateway cannot pull a still-answerable prompt away. */
const EXPIRY_GRACE_MS = 10_000

/**
 * Questions, secret requests and permission approvals the agent in
 * `sessionKey` is blocked on. Live `question.*` / `*.approval.*` events keep
 * the list current; a (re)connect reseeds it from the list RPCs, since events
 * broadcast while the socket was down are gone.
 */
export function usePendingInteractions(sessionKey: string | null) {
  const { connected, sendRpc, addGatewayEventListener } = useWebSocket()
  const [items, setItems] = useState<PendingInteraction[]>([])
  // Events arriving while the list calls are in flight, replayed onto the seed.
  const eventsDuringSeedRef = useRef<Array<[string, unknown]> | null>(null)

  useEffect(
    () =>
      addGatewayEventListener((event, payload) => {
        if (!INTERACTION_EVENTS.has(event)) return
        eventsDuringSeedRef.current?.push([event, payload])
        setItems((prev) => applyInteractionEvent(prev, event, payload))
      }),
    [addGatewayEventListener],
  )

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    eventsDuringSeedRef.current = []
    const list = (method: string) => sendRpc(method, {}).catch(() => null)
    Promise.all([list('question.list'), list('exec.approval.list'), list('plugin.approval.list')]).then(
      ([questions, exec, plugin]) => {
        if (cancelled) return
        let next = seedInteractions({ questions, exec, plugin })
        for (const [event, payload] of eventsDuringSeedRef.current ?? []) {
          next = applyInteractionEvent(next, event, payload)
        }
        eventsDuringSeedRef.current = null
        setItems(next)
      },
    )
    return () => {
      cancelled = true
      eventsDuringSeedRef.current = null
    }
  }, [connected, sendRpc])

  useEffect(() => {
    const timer = setInterval(() => setItems((prev) => pruneExpired(prev, Date.now() - EXPIRY_GRACE_MS)), 5_000)
    return () => clearInterval(timer)
  }, [])

  const drop = useCallback(
    (id: string, kind: PendingInteraction['kind']) => setItems((prev) => removeInteraction(prev, id, kind)),
    [],
  )

  const answerQuestion = useCallback(
    async (q: PendingQuestion, answers: Record<string, string[]>) => {
      await sendRpc('question.resolve', questionResolveParams(q.id, answers))
      drop(q.id, 'question')
    },
    [sendRpc, drop],
  )

  const skipQuestion = useCallback(
    async (q: PendingQuestion) => {
      await sendRpc('question.resolve', questionCancelParams(q.id))
      drop(q.id, 'question')
    },
    [sendRpc, drop],
  )

  const submitSecret = useCallback(
    async (q: PendingQuestion, value: string, allowedHosts?: string[]) => {
      await sendRpc('question.resolve', secretResolveParams(q, value, allowedHosts))
      drop(q.id, 'question')
    },
    [sendRpc, drop],
  )

  const decideApproval = useCallback(
    async (a: PendingApproval, decision: ApprovalDecision) => {
      const { method, params } = approvalResolveRequest(a, decision)
      await sendRpc(method, params)
      drop(a.id, 'approval')
    },
    [sendRpc, drop],
  )

  // Approvals show on /talk too — the operator chose to let whoever holds the
  // chat window make permission decisions.
  const interactions = useMemo(
    () => interactionsForSession(items, sessionKey, { includeApprovals: true }),
    [items, sessionKey],
  )

  return { interactions, answerQuestion, skipQuestion, submitSecret, decideApproval }
}
