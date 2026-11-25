import type { ApprovalDecision } from '../openclaw/interactions'

const choices = { 'allow-once': 'once', 'allow-always': 'always', deny: 'deny' } as const

interface Approval {
  id: string
  runId: string
  requestId: string
  sourceSessionKey: string
  createdAtMs: number
  expiresAtMs: number
  presentation: { commandText?: string; warningText?: string; allowedDecisions: ApprovalDecision[] }
  timer: ReturnType<typeof setTimeout>
  response?: Promise<void>
  expiring?: boolean
}

export class HermesApprovals {
  private pending = new Map<string, Approval>()
  private expirations = new Map<string, Set<Promise<void>>>()

  constructor(private readonly opts: {
    timeoutMs: number
    emit: (event: string, payload: unknown) => void
    respond: (runId: string, requestId: string, choice: string) => Promise<void>
  }) {}

  list() {
    return [...this.pending.values()].map(({ id, sourceSessionKey, createdAtMs, expiresAtMs, presentation }) => ({
      id, sourceSessionKey, createdAtMs, expiresAtMs, presentation,
    }))
  }

  request(runId: string, sessionKey: string, event: Record<string, unknown>, onTimeout: (accepted: boolean) => void) {
    const requestId = event.request_id
    if (typeof requestId !== 'string' || !requestId) return
    const id = JSON.stringify([runId, requestId])
    if (this.pending.has(id)) return

    const offered = Array.isArray(event.choices) ? event.choices : ['once', 'always', 'deny']
    const allowedDecisions: ApprovalDecision[] = ['deny']
    if (offered.includes('once')) allowedDecisions.unshift('allow-once')
    if (offered.includes('always') && event.allow_permanent !== false) allowedDecisions.splice(-1, 0, 'allow-always')
    const createdAtMs = Date.now()
    const expiresAtMs = createdAtMs + this.opts.timeoutMs
    const presentation = {
      commandText: typeof event.command === 'string' ? event.command : undefined,
      warningText: typeof event.description === 'string' ? event.description : undefined,
      allowedDecisions,
    }
    const timer = setTimeout(() => {
      const expirations = this.expirations.get(runId) ?? new Set<Promise<void>>()
      const expiry = this.expire(id, onTimeout).finally(() => {
        expirations.delete(expiry)
        if (!expirations.size) this.expirations.delete(runId)
      })
      expirations.add(expiry)
      this.expirations.set(runId, expirations)
    }, this.opts.timeoutMs)
    timer.unref?.()
    this.pending.set(id, { id, runId, requestId, sourceSessionKey: sessionKey, createdAtMs, expiresAtMs, presentation, timer })
    this.opts.emit('exec.approval.requested', { id, sourceSessionKey: sessionKey, createdAtMs, expiresAtMs, presentation })
  }

  async resolve(id: string, decision: ApprovalDecision): Promise<{ ok: true }> {
    const approval = this.pending.get(id)
    if (!approval || approval.expiring || Date.now() >= approval.expiresAtMs) throw new Error('Hermes approval is no longer pending')
    if (!approval.presentation.allowedDecisions.includes(decision)) throw new Error('Unsupported Hermes approval decision')
    if (approval.response) throw new Error('Hermes approval is already being resolved')
    await this.respond(approval, decision)
    return { ok: true }
  }

  private async respond(approval: Approval, decision: ApprovalDecision): Promise<void> {
    const send = (async () => {
      try {
        await this.opts.respond(approval.runId, approval.requestId, choices[decision])
      } catch (err) {
        if ((err as { approvalInactive?: boolean }).approvalInactive) this.remove(approval.id)
        throw err
      }
      this.remove(approval.id)
    })()
    approval.response = send
    try {
      await send
    } finally {
      approval.response = undefined
    }
  }

  private async expire(id: string, onTimeout: (accepted: boolean) => void): Promise<void> {
    const approval = this.pending.get(id)
    if (!approval) return
    approval.expiring = true
    await approval.response?.catch(() => {})
    if (this.pending.get(id) !== approval) return

    try {
      await this.respond(approval, 'deny')
      onTimeout(true)
    } catch (err) {
      if (!(err as { approvalInactive?: boolean }).approvalInactive && this.pending.has(id)) {
        this.remove(id)
        onTimeout(false)
      }
    }
  }

  responded(runId: string, requestId: unknown) {
    const matching = [...this.pending.values()].filter((a) => a.runId === runId)
    if (typeof requestId === 'string') this.remove(JSON.stringify([runId, requestId]))
    else if (matching.length === 1) this.remove(matching[0].id)
  }

  hasPending(runId: string) {
    return [...this.pending.values()].some((a) => a.runId === runId)
  }

  async waitForExpiry(runId: string) {
    await Promise.all(this.expirations.get(runId) ?? [])
  }

  clearRun(runId: string) {
    for (const approval of this.pending.values()) {
      if (approval.runId === runId) this.remove(approval.id)
    }
  }

  private remove(id: string) {
    const approval = this.pending.get(id)
    if (!approval) return
    clearTimeout(approval.timer)
    this.pending.delete(id)
    this.opts.emit('exec.approval.resolved', { id })
  }
}
