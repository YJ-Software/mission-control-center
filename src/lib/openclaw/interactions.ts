/**
 * Human-in-the-loop prompts an OpenClaw run raises mid-turn and then waits on:
 * `ask_user` questions, `secrets` credential requests (the same question
 * protocol, flagged isSecret), and exec / plugin permission approvals.
 *
 * The Gateway broadcasts these to operator clients (MCC connects with
 * `operator.admin`, which covers them), but a prompt nobody answers blocks the
 * agent until it times out. Everything here is pure —
 * parsing Gateway payloads and building resolve params — so the chat UI stays
 * a thin renderer.
 */

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

const DECISIONS: readonly ApprovalDecision[] = ['allow-once', 'allow-always', 'deny']

/** Gateway defaults, used only when a payload omits its own expiry. */
const DEFAULT_QUESTION_TIMEOUT_MS = 900_000
const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000

export interface QuestionOption {
  label: string
  description?: string
}

export interface SecretStoreBinding {
  name: string
  kind: 'secret' | 'env'
  allowedHosts?: string[]
  reason?: string
}

export interface QuestionItem {
  questionId: string
  header: string
  question: string
  url?: string
  options: QuestionOption[]
  multiSelect?: boolean
  isSecret?: boolean
  secretStore?: SecretStoreBinding
  secretStoreExisting?: { updatedAtMs: number; updatedBy?: string }
}

export interface PendingQuestion {
  kind: 'question'
  id: string
  questions: QuestionItem[]
  agentId?: string
  sessionKey?: string
  runId?: string
  createdAtMs: number
  expiresAtMs: number
}

export interface PendingApproval {
  kind: 'approval'
  approvalKind: 'exec' | 'plugin'
  id: string
  agentId?: string
  sessionKey?: string
  createdAtMs: number
  expiresAtMs: number
  /** Plugin approvals only. */
  title?: string
  description?: string
  /** Exec approvals only: the command waiting for permission. */
  command?: string
  host?: string
  warningText?: string
  severity: 'info' | 'warning' | 'critical'
  allowedDecisions: ApprovalDecision[]
}

export type PendingInteraction = PendingQuestion | PendingApproval

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function parseOption(raw: unknown): QuestionOption | null {
  if (!isObj(raw)) return null
  const label = str(raw.label)
  if (!label) return null
  const description = str(raw.description)
  return description ? { label, description } : { label }
}

function parseSecretStore(raw: unknown): SecretStoreBinding | undefined {
  if (!isObj(raw)) return undefined
  const name = str(raw.name)
  if (!name) return undefined
  return {
    name,
    kind: raw.kind === 'env' ? 'env' : 'secret',
    ...(Array.isArray(raw.allowedHosts) ? { allowedHosts: strings(raw.allowedHosts) } : {}),
    ...(str(raw.reason) ? { reason: raw.reason as string } : {}),
  }
}

function parseQuestionItem(raw: unknown): QuestionItem | null {
  if (!isObj(raw)) return null
  const questionId = str(raw.questionId)
  const question = str(raw.question)
  if (!questionId || !question) return null
  const options = Array.isArray(raw.options)
    ? raw.options.map(parseOption).filter((o): o is QuestionOption => o !== null)
    : []
  const existing = isObj(raw.secretStoreExisting) ? raw.secretStoreExisting : null
  return {
    questionId,
    header: typeof raw.header === 'string' ? raw.header : '',
    question,
    options,
    ...(str(raw.url) ? { url: raw.url as string } : {}),
    ...(raw.multiSelect === true ? { multiSelect: true } : {}),
    ...(raw.isSecret === true ? { isSecret: true } : {}),
    ...(parseSecretStore(raw.secretStore) ? { secretStore: parseSecretStore(raw.secretStore) } : {}),
    ...(existing && typeof existing.updatedAtMs === 'number'
      ? {
          secretStoreExisting: {
            updatedAtMs: existing.updatedAtMs,
            ...(str(existing.updatedBy) ? { updatedBy: existing.updatedBy as string } : {}),
          },
        }
      : {}),
  }
}

/** A `question.requested` payload or `question.list` row; null unless pending. */
export function parseQuestionRecord(raw: unknown, now = Date.now()): PendingQuestion | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  if (raw.status !== undefined && raw.status !== 'pending') return null
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map(parseQuestionItem).filter((q): q is QuestionItem => q !== null)
    : []
  if (questions.length === 0) return null
  const createdAtMs = num(raw.createdAtMs, now)
  return {
    kind: 'question',
    id,
    questions,
    agentId: str(raw.agentId),
    sessionKey: str(raw.sessionKey),
    runId: str(raw.runId),
    createdAtMs,
    expiresAtMs: num(raw.expiresAtMs, createdAtMs + DEFAULT_QUESTION_TIMEOUT_MS),
  }
}

function allowedDecisions(presentation: Obj, request: Obj): ApprovalDecision[] {
  const declared = Array.isArray(presentation.allowedDecisions)
    ? strings(presentation.allowedDecisions)
    : Array.isArray(request.allowedDecisions)
      ? strings(request.allowedDecisions)
      : null
  const unavailable = strings(request.unavailableDecisions)
  const decisions = DECISIONS.filter(
    (d) => (declared ? declared.includes(d) : true) && !unavailable.includes(d),
  )
  // Deny is always offered, so a malformed or unsafe prompt can still fail closed.
  return decisions.includes('deny') ? decisions : [...decisions, 'deny']
}

/**
 * An `exec.approval.requested` / `plugin.approval.requested` payload or an
 * `*.approval.list` row. The Gateway has shipped both a raw `request` shape and
 * a reviewer-safe `presentation` shape; presentation wins where both exist.
 */
export function parseApproval(
  approvalKind: 'exec' | 'plugin',
  raw: unknown,
  now = Date.now(),
): PendingApproval | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  if (raw.status !== undefined && raw.status !== 'pending') return null
  const request = isObj(raw.request) ? raw.request : {}
  const presentation = isObj(raw.presentation) ? raw.presentation : {}
  const plan = isObj(request.systemRunPlan) ? request.systemRunPlan : {}
  const pick = (key: string) => str(presentation[key]) ?? str(request[key])
  const createdAtMs = num(raw.createdAtMs, now)
  const base = {
    kind: 'approval' as const,
    approvalKind,
    id,
    agentId: pick('agentId') ?? str(plan.agentId),
    sessionKey: str(raw.sourceSessionKey) ?? str(request.sessionKey) ?? str(plan.sessionKey),
    createdAtMs,
    expiresAtMs: num(raw.expiresAtMs, createdAtMs + DEFAULT_APPROVAL_TIMEOUT_MS),
    warningText: pick('warningText'),
    allowedDecisions: allowedDecisions(presentation, request),
  }
  if (approvalKind === 'exec') {
    const argv = strings(request.commandArgv)
    const command =
      str(presentation.commandText) ??
      str(plan.commandText) ??
      str(request.command) ??
      (argv.length > 0 ? argv.join(' ') : undefined)
    return { ...base, command, host: pick('host'), severity: 'warning' }
  }
  const title = pick('title')
  if (!title) return null
  const severity = pick('severity')
  return {
    ...base,
    title,
    description: pick('description'),
    severity: severity === 'info' || severity === 'critical' ? severity : 'warning',
  }
}

function upsert(list: PendingInteraction[], item: PendingInteraction | null): PendingInteraction[] {
  if (!item) return list
  const rest = list.filter((x) => !(x.kind === item.kind && x.id === item.id))
  return [...rest, item].sort((a, b) => a.createdAtMs - b.createdAtMs)
}

export function removeInteraction(
  list: PendingInteraction[],
  id: string,
  kind?: PendingInteraction['kind'],
): PendingInteraction[] {
  const next = list.filter((x) => !(x.id === id && (kind === undefined || x.kind === kind)))
  return next.length === list.length ? list : next
}

/** Fold one Gateway event into the pending list; unrelated events return it unchanged. */
export function applyInteractionEvent(
  list: PendingInteraction[],
  event: string,
  payload: unknown,
  now = Date.now(),
): PendingInteraction[] {
  const resolvedId = isObj(payload) ? str(payload.id) : undefined
  switch (event) {
    case 'question.requested':
      return upsert(list, parseQuestionRecord(payload, now))
    case 'exec.approval.requested':
      return upsert(list, parseApproval('exec', payload, now))
    case 'plugin.approval.requested':
      return upsert(list, parseApproval('plugin', payload, now))
    case 'question.resolved':
      return resolvedId ? removeInteraction(list, resolvedId, 'question') : list
    case 'exec.approval.resolved':
    case 'plugin.approval.resolved':
      return resolvedId ? removeInteraction(list, resolvedId, 'approval') : list
    default:
      return list
  }
}

export const INTERACTION_EVENTS: ReadonlySet<string> = new Set([
  'question.requested',
  'question.resolved',
  'exec.approval.requested',
  'exec.approval.resolved',
  'plugin.approval.requested',
  'plugin.approval.resolved',
])

const rows = (raw: unknown, key: string): unknown[] =>
  Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []

/** Rebuild the pending list from `question.list` / `exec.approval.list` /
 * `plugin.approval.list` after a (re)connect, when events were missed. */
export function seedInteractions(
  lists: { questions?: unknown; exec?: unknown; plugin?: unknown },
  now = Date.now(),
): PendingInteraction[] {
  let list: PendingInteraction[] = []
  for (const r of rows(lists.questions, 'questions')) list = upsert(list, parseQuestionRecord(r, now))
  for (const r of rows(lists.exec, 'approvals')) list = upsert(list, parseApproval('exec', r, now))
  for (const r of rows(lists.plugin, 'approvals')) list = upsert(list, parseApproval('plugin', r, now))
  return list
}

export function pruneExpired(list: PendingInteraction[], now = Date.now()): PendingInteraction[] {
  const next = list.filter((x) => x.expiresAtMs > now)
  return next.length === list.length ? list : next
}

/** What a chat for `sessionKey` should show. A prompt with no session binding
 * (an attached MCP client, say) has no better home than the chat that is open. */
export function interactionsForSession(
  list: PendingInteraction[],
  sessionKey: string | null,
  opts: { includeApprovals: boolean },
): PendingInteraction[] {
  return list.filter((item) => {
    if (item.kind === 'approval' && !opts.includeApprovals) return false
    return !item.sessionKey || item.sessionKey === sessionKey
  })
}

export function isSecretRequest(q: PendingQuestion): boolean {
  return q.questions.some((item) => item.isSecret === true || item.secretStore !== undefined)
}

export interface QuestionSelection {
  selected: string[]
  other?: string
}

/** Turn the operator's picks into the answer map, or name the questions still unanswered. */
export function buildQuestionAnswers(
  questions: QuestionItem[],
  selections: Record<string, QuestionSelection | undefined>,
): { answers: Record<string, string[]> } | { missing: string[] } {
  const answers: Record<string, string[]> = {}
  const missing: string[] = []
  for (const q of questions) {
    const sel = selections[q.questionId]
    const labels = new Set(q.options.map((o) => o.label))
    const picked = (sel?.selected ?? []).filter((label) => labels.has(label))
    const other = sel?.other?.trim()
    const values = q.multiSelect
      ? other
        ? [...picked, other]
        : picked
      : other
        ? [other]
        : picked.slice(0, 1)
    if (values.length === 0) missing.push(q.questionId)
    else answers[q.questionId] = values
  }
  return missing.length > 0 ? { missing } : { answers }
}

export function questionResolveParams(id: string, answers: Record<string, string[]>) {
  return { id, answers: { answers } }
}

export function questionCancelParams(id: string) {
  return { id, cancel: true as const }
}

/** The Gateway stores a secret answer straight into its secret store and
 * requires exactly one value for exactly one question. The value is sent as
 * typed — the Gateway preserves surrounding whitespace on purpose. */
export function secretResolveParams(q: PendingQuestion, value: string, allowedHosts?: string[]) {
  const item = q.questions.find((i) => i.isSecret === true || i.secretStore !== undefined)
  if (!item) throw new Error(`question ${q.id} is not a secret request`)
  if (value.length === 0) throw new Error('secret value is empty')
  return {
    id: q.id,
    answers: { answers: { [item.questionId]: [value] } },
    ...(allowedHosts ? { secretStoreAllowedHosts: allowedHosts } : {}),
  }
}

/** Parse an editable host list. The Gateway rejects duplicates, entries over
 * 253 characters, and more than 128 hosts. */
export function normalizeHosts(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(/[\s,]+/)) {
    const host = part.trim()
    if (host && host.length <= 253) seen.add(host)
  }
  return [...seen].slice(0, 128)
}

export function approvalResolveRequest(item: PendingApproval, decision: ApprovalDecision) {
  if (!item.allowedDecisions.includes(decision)) {
    throw new Error(`decision ${decision} is not allowed for approval ${item.id}`)
  }
  return {
    method: item.approvalKind === 'exec' ? 'exec.approval.resolve' : 'plugin.approval.resolve',
    params: { id: item.id, decision },
  }
}
