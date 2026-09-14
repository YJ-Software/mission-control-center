import { describe, expect, it } from 'vitest'
import {
  applyInteractionEvent,
  approvalResolveRequest,
  buildQuestionAnswers,
  interactionsForSession,
  isSecretRequest,
  normalizeHosts,
  parseApproval,
  parseQuestionRecord,
  pruneExpired,
  questionCancelParams,
  questionResolveParams,
  secretResolveParams,
  seedInteractions,
  type PendingInteraction,
  type PendingQuestion,
} from '@/lib/openclaw/interactions'

// The Gateway did send MCC every question and approval event, but the browser
// store dispatched only `chat` events and nothing rendered a prompt, so an
// agent's ask_user reached /talk as nothing at all and the run sat blocked
// until the 15-minute timeout. These pin the payload
// parsing and the resolve params the Gateway's schemas require.

const NOW = 1_800_000_000_000

const askUser = {
  id: 'q-1',
  questions: [
    {
      questionId: 'deploy_target',
      header: 'Target',
      question: 'Where should this deploy?',
      options: [{ label: 'Staging (Recommended)' }, { label: 'Production', description: 'live traffic' }],
    },
  ],
  agentId: 'main',
  sessionKey: 'agent:main:main',
  runId: 'run-9',
  createdAtMs: NOW,
  expiresAtMs: NOW + 900_000,
  status: 'pending',
}

const secretAsk = {
  id: 'q-secret',
  questions: [
    {
      questionId: 'stripe_api_key',
      header: 'API key',
      question: 'Paste the Stripe key',
      options: [],
      isSecret: true,
      secretStore: { name: 'STRIPE_API_KEY', kind: 'secret', allowedHosts: ['api.stripe.com'], reason: 'billing sync' },
    },
  ],
  sessionKey: 'agent:main:main',
  createdAtMs: NOW + 1,
  expiresAtMs: NOW + 900_000,
  status: 'pending',
}

describe('parseQuestionRecord', () => {
  it('keeps the fields the prompt renders', () => {
    const q = parseQuestionRecord(askUser, NOW)!
    expect(q.kind).toBe('question')
    expect(q.sessionKey).toBe('agent:main:main')
    expect(q.questions[0].options).toEqual([
      { label: 'Staging (Recommended)' },
      { label: 'Production', description: 'live traffic' },
    ])
  })

  it('ignores questions that are no longer pending', () => {
    expect(parseQuestionRecord({ ...askUser, status: 'answered' }, NOW)).toBeNull()
  })

  it('rejects a record without an id or usable questions', () => {
    expect(parseQuestionRecord({ ...askUser, id: '' }, NOW)).toBeNull()
    expect(parseQuestionRecord({ ...askUser, questions: [{ header: 'x' }] }, NOW)).toBeNull()
  })

  it('carries the secret-store binding through', () => {
    const q = parseQuestionRecord(secretAsk, NOW)!
    expect(isSecretRequest(q)).toBe(true)
    expect(q.questions[0].secretStore).toEqual({
      name: 'STRIPE_API_KEY',
      kind: 'secret',
      allowedHosts: ['api.stripe.com'],
      reason: 'billing sync',
    })
    expect(isSecretRequest(parseQuestionRecord(askUser, NOW)!)).toBe(false)
  })
})

describe('parseApproval', () => {
  it('reads an exec command from the raw request shape', () => {
    const a = parseApproval('exec', {
      id: 'ex-1',
      request: { command: 'rm -rf /tmp/build', host: 'gateway', sessionKey: 'agent:main:main' },
      createdAtMs: NOW,
      expiresAtMs: NOW + 60_000,
    }, NOW)!
    expect(a.command).toBe('rm -rf /tmp/build')
    expect(a.sessionKey).toBe('agent:main:main')
    expect(a.allowedDecisions).toEqual(['allow-once', 'allow-always', 'deny'])
  })

  it('prefers the reviewer-safe presentation and drops unavailable decisions', () => {
    const a = parseApproval('exec', {
      id: 'ex-2',
      presentation: { kind: 'exec', commandText: 'git push', allowedDecisions: ['allow-once', 'allow-always', 'deny'] },
      request: { command: 'raw', unavailableDecisions: ['allow-always'] },
    }, NOW)!
    expect(a.command).toBe('git push')
    expect(a.allowedDecisions).toEqual(['allow-once', 'deny'])
  })

  it('falls back to the system-run plan and argv', () => {
    expect(parseApproval('exec', { id: 'a', request: { systemRunPlan: { commandText: 'ls -la' } } }, NOW)!.command).toBe('ls -la')
    expect(parseApproval('exec', { id: 'b', request: { commandArgv: ['echo', 'hi'] } }, NOW)!.command).toBe('echo hi')
  })

  it('reads plugin title, severity and the declared decisions', () => {
    const a = parseApproval('plugin', {
      id: 'plugin:1',
      request: { title: 'Deploy service', description: 'to production', severity: 'critical', allowedDecisions: ['allow-once'] },
    }, NOW)!
    expect(a.title).toBe('Deploy service')
    expect(a.severity).toBe('critical')
    // deny is always offered, even when a plugin forgets to declare it
    expect(a.allowedDecisions).toEqual(['allow-once', 'deny'])
  })

  it('rejects a plugin approval with no title', () => {
    expect(parseApproval('plugin', { id: 'p', request: {} }, NOW)).toBeNull()
  })
})

describe('applyInteractionEvent', () => {
  it('adds on requested and drops on resolved', () => {
    let list: PendingInteraction[] = []
    list = applyInteractionEvent(list, 'question.requested', askUser, NOW)
    list = applyInteractionEvent(list, 'plugin.approval.requested', { id: 'plugin:1', request: { title: 'T', description: 'd' }, createdAtMs: NOW + 5 }, NOW)
    expect(list.map((x) => x.id)).toEqual(['q-1', 'plugin:1'])
    list = applyInteractionEvent(list, 'question.resolved', { id: 'q-1', status: 'answered' }, NOW)
    expect(list.map((x) => x.id)).toEqual(['plugin:1'])
    list = applyInteractionEvent(list, 'plugin.approval.resolved', { id: 'plugin:1', decision: 'deny' }, NOW)
    expect(list).toEqual([])
  })

  it('does not let a question resolution remove an approval with the same id', () => {
    const list = applyInteractionEvent([], 'exec.approval.requested', { id: 'same', request: { command: 'ls' } }, NOW)
    expect(applyInteractionEvent(list, 'question.resolved', { id: 'same' }, NOW)).toBe(list)
  })

  it('replaces a re-broadcast instead of duplicating it', () => {
    let list = applyInteractionEvent([], 'question.requested', askUser, NOW)
    list = applyInteractionEvent(list, 'question.requested', askUser, NOW)
    expect(list).toHaveLength(1)
  })

  it('returns the same list for unrelated events', () => {
    const list = applyInteractionEvent([], 'question.requested', askUser, NOW)
    expect(applyInteractionEvent(list, 'tick', {}, NOW)).toBe(list)
  })
})

describe('seedInteractions', () => {
  it('rebuilds from list responses in either envelope shape', () => {
    const list = seedInteractions({
      questions: { questions: [askUser, { ...secretAsk, status: 'expired' }] },
      exec: [{ id: 'ex-1', request: { command: 'ls' }, createdAtMs: NOW + 2 }],
      plugin: { approvals: [{ id: 'plugin:9', request: { title: 'T', description: 'd' }, createdAtMs: NOW + 3 }] },
    }, NOW)
    expect(list.map((x) => x.id)).toEqual(['q-1', 'ex-1', 'plugin:9'])
  })
})

describe('interactionsForSession', () => {
  const list = seedInteractions({
    questions: { questions: [askUser, { ...secretAsk, id: 'other', sessionKey: 'agent:ops:main' }, { ...secretAsk, id: 'unbound', sessionKey: undefined }] },
    exec: [{ id: 'ex-1', request: { command: 'ls', sessionKey: 'agent:main:main' } }],
  }, NOW)

  it('shows this session and unbound prompts, never another session', () => {
    expect(interactionsForSession(list, 'agent:main:main', { includeApprovals: true }).map((x) => x.id).sort())
      .toEqual(['ex-1', 'q-1', 'unbound'])
  })

  it('hides approvals where they are not allowed', () => {
    expect(interactionsForSession(list, 'agent:main:main', { includeApprovals: false }).some((x) => x.kind === 'approval'))
      .toBe(false)
  })
})

describe('pruneExpired', () => {
  it('drops expired prompts and keeps identity when nothing expired', () => {
    const list = seedInteractions({ questions: [askUser] }, NOW)
    expect(pruneExpired(list, NOW)).toBe(list)
    expect(pruneExpired(list, NOW + 900_001)).toEqual([])
  })
})

describe('question answers', () => {
  const q = parseQuestionRecord({
    ...askUser,
    questions: [
      askUser.questions[0],
      { questionId: 'extras', header: 'Extras', question: 'Also run?', options: [{ label: 'Tests' }, { label: 'Lint' }], multiSelect: true },
    ],
  }, NOW) as PendingQuestion

  it('builds the protocol answer map', () => {
    const r = buildQuestionAnswers(q.questions, {
      deploy_target: { selected: ['Production'] },
      extras: { selected: ['Tests', 'Lint'] },
    })
    expect(r).toEqual({ answers: { deploy_target: ['Production'], extras: ['Tests', 'Lint'] } })
    expect(questionResolveParams(q.id, (r as { answers: Record<string, string[]> }).answers)).toEqual({
      id: 'q-1',
      answers: { answers: { deploy_target: ['Production'], extras: ['Tests', 'Lint'] } },
    })
  })

  it('uses a typed Other answer, replacing the pick on single-select and adding to multi-select', () => {
    expect(buildQuestionAnswers(q.questions, {
      deploy_target: { selected: ['Production'], other: ' canary ' },
      extras: { selected: ['Tests'], other: 'e2e' },
    })).toEqual({ answers: { deploy_target: ['canary'], extras: ['Tests', 'e2e'] } })
  })

  it('names unanswered questions and ignores labels that are not options', () => {
    expect(buildQuestionAnswers(q.questions, { deploy_target: { selected: ['Nope'] } }))
      .toEqual({ missing: ['deploy_target', 'extras'] })
  })

  it('skips with a cancel', () => {
    expect(questionCancelParams('q-1')).toEqual({ id: 'q-1', cancel: true })
  })
})

describe('secret answers', () => {
  const q = parseQuestionRecord(secretAsk, NOW)!

  it('sends exactly one value, untrimmed, with the edited hosts', () => {
    expect(secretResolveParams(q, ' sk_live_x ', ['api.stripe.com'])).toEqual({
      id: 'q-secret',
      answers: { answers: { stripe_api_key: [' sk_live_x '] } },
      secretStoreAllowedHosts: ['api.stripe.com'],
    })
  })

  it('refuses an empty value or a non-secret question', () => {
    expect(() => secretResolveParams(q, '')).toThrow(/empty/)
    expect(() => secretResolveParams(parseQuestionRecord(askUser, NOW)!, 'x')).toThrow(/not a secret/)
  })

  it('normalizes an edited host list the way the Gateway validates it', () => {
    expect(normalizeHosts('api.stripe.com, files.stripe.com\napi.stripe.com  ')).toEqual(['api.stripe.com', 'files.stripe.com'])
    expect(normalizeHosts('   ')).toEqual([])
  })
})

describe('approvalResolveRequest', () => {
  it('routes to the kind-specific resolve method', () => {
    const exec = parseApproval('exec', { id: 'ex-1', request: { command: 'ls' } }, NOW)!
    const plugin = parseApproval('plugin', { id: 'plugin:1', request: { title: 'T' } }, NOW)!
    expect(approvalResolveRequest(exec, 'allow-once')).toEqual({ method: 'exec.approval.resolve', params: { id: 'ex-1', decision: 'allow-once' } })
    expect(approvalResolveRequest(plugin, 'deny')).toEqual({ method: 'plugin.approval.resolve', params: { id: 'plugin:1', decision: 'deny' } })
  })

  it('refuses a decision the approval does not allow', () => {
    const a = parseApproval('plugin', { id: 'p', request: { title: 'T', allowedDecisions: ['allow-once', 'deny'] } }, NOW)!
    expect(() => approvalResolveRequest(a, 'allow-always')).toThrow(/not allowed/)
  })
})
