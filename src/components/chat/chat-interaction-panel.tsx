'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, ExternalLink, KeyRound, Loader2, MessageCircleQuestion, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { usePendingInteractions } from '@/hooks/use-pending-interactions'
import {
  buildQuestionAnswers,
  isSecretRequest,
  normalizeHosts,
  type ApprovalDecision,
  type PendingApproval,
  type PendingQuestion,
  type QuestionSelection,
} from '@/lib/openclaw/interactions'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

function useCountdown(expiresAtMs: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const left = Math.max(0, Math.floor((expiresAtMs - now) / 1_000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

const inputClass =
  'w-full px-3 py-2 rounded-md border border-white/10 bg-white/[0.02] text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/60'

function CardHeader({ icon, title, expiresAtMs }: { icon: ReactNode; title: string; expiresAtMs: number }) {
  const t = useTranslations('chat.interaction')
  const left = useCountdown(expiresAtMs)
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
      <span className="text-cyan-300">{icon}</span>
      <span className="text-sm font-medium text-white/90 flex-1 min-w-0 truncate">{title}</span>
      <span className="flex items-center gap-1 text-[11px] text-white/40 shrink-0">
        <Clock className="w-3 h-3" />
        {t('timeLeft', { time: left })}
      </span>
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useTranslations('chat.interaction')
  if (!error) return null
  return <div className="text-xs text-red-300 break-words">{t('failed', { error })}</div>
}

/**
 * What a running agent is blocked on — an ask_user question, a secrets
 * request, or a permission approval — docked above the composer. Without an
 * answer here the agent waits out the prompt's timeout.
 */
export function ChatInteractionPanel({ sessionKey }: { sessionKey: string | null }) {
  const t = useTranslations('chat.interaction')
  const { interactions, answerQuestion, skipQuestion, submitSecret, decideApproval } =
    usePendingInteractions(sessionKey)
  if (interactions.length === 0) return null
  const current = interactions[0]
  return (
    <div className="mx-auto w-full max-w-[960px] xl:max-w-[1100px] 2xl:max-w-[1280px] px-2 pt-2">
      <div
        data-testid="chat-interaction-panel"
        className="rounded-lg border border-cyan-400/30 bg-[#0d1520] shadow-lg"
      >
        {interactions.length > 1 && (
          <div className="px-4 pt-2 text-[11px] text-white/40">
            {t('queue', { total: interactions.length })}
          </div>
        )}
        {current.kind === 'approval' ? (
          <ApprovalCard key={`approval-${current.id}`} approval={current} onDecide={decideApproval} />
        ) : isSecretRequest(current) ? (
          <SecretCard key={`secret-${current.id}`} question={current} onSubmit={submitSecret} onSkip={skipQuestion} />
        ) : (
          <QuestionCard key={`question-${current.id}`} question={current} onAnswer={answerQuestion} onSkip={skipQuestion} />
        )}
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  onAnswer,
  onSkip,
}: {
  question: PendingQuestion
  onAnswer: (q: PendingQuestion, answers: Record<string, string[]>) => Promise<void>
  onSkip: (q: PendingQuestion) => Promise<void>
}) {
  const t = useTranslations('chat.interaction')
  const [step, setStep] = useState(0)
  const [selections, setSelections] = useState<Record<string, QuestionSelection>>({})
  const [missing, setMissing] = useState(false)
  const { busy, error, run } = useAction()
  const items = question.questions
  const item = items[step]
  const sel = selections[item.questionId] ?? { selected: [] }
  const last = step === items.length - 1

  const toggle = (label: string) => {
    setMissing(false)
    setSelections((prev) => {
      const cur = prev[item.questionId] ?? { selected: [] }
      const selected = item.multiSelect
        ? cur.selected.includes(label)
          ? cur.selected.filter((l) => l !== label)
          : [...cur.selected, label]
        : [label]
      // On single-select a picked option replaces any typed answer.
      return { ...prev, [item.questionId]: { selected, other: item.multiSelect ? cur.other : '' } }
    })
  }

  const setOther = (other: string) => {
    setMissing(false)
    setSelections((prev) => {
      const cur = prev[item.questionId] ?? { selected: [] }
      // On single-select a typed answer replaces the picked option.
      return { ...prev, [item.questionId]: { selected: item.multiSelect || !other ? cur.selected : [], other } }
    })
  }

  const submit = () => {
    const result = buildQuestionAnswers(items, selections)
    if ('missing' in result) {
      setMissing(true)
      const first = items.findIndex((q) => result.missing.includes(q.questionId))
      if (first >= 0) setStep(first)
      return
    }
    void run(() => onAnswer(question, result.answers))
  }

  return (
    <div>
      <CardHeader
        icon={<MessageCircleQuestion className="w-4 h-4" />}
        title={t('questionTitle')}
        expiresAtMs={question.expiresAtMs}
      />
      <div className="px-4 pb-3 space-y-3">
        {items.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((q, i) => (
              <button
                key={q.questionId}
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border font-mono',
                  i === step ? 'border-cyan-400/60 text-cyan-200 bg-cyan-500/10' : 'border-white/10 text-white/40',
                )}
              >
                {q.header || i + 1}
              </button>
            ))}
          </div>
        )}
        <div>
          {item.header && items.length === 1 && (
            <span className="text-[10px] uppercase tracking-wider text-cyan-300/80 font-mono">{item.header}</span>
          )}
          <p className="text-sm text-white/90 mt-0.5 whitespace-pre-wrap">{item.question}</p>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              {t('openLink')}
            </a>
          )}
        </div>
        <div className="grid gap-1.5">
          {item.options.map((opt) => {
            const active = sel.selected.includes(opt.label)
            return (
              <button
                key={opt.label}
                type="button"
                disabled={busy}
                onClick={() => toggle(opt.label)}
                className={cn(
                  'text-left px-3 py-2 rounded-md border transition-colors',
                  active ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-3.5 h-3.5 shrink-0 border',
                      item.multiSelect ? 'rounded-sm' : 'rounded-full',
                      active ? 'border-cyan-300 bg-cyan-400/70' : 'border-white/30',
                    )}
                  />
                  <span className="text-sm text-white/90">{opt.label}</span>
                </div>
                {opt.description && <div className="text-xs text-white/40 mt-0.5 pl-6">{opt.description}</div>}
              </button>
            )
          })}
          <input
            type="text"
            value={sel.other ?? ''}
            disabled={busy}
            onChange={(e) => setOther(e.target.value)}
            placeholder={t('otherPlaceholder')}
            className={inputClass}
          />
          {item.multiSelect && <div className="text-[11px] text-white/40">{t('multiHint')}</div>}
        </div>
        {missing && <div className="text-xs text-amber-300">{t('missing')}</div>}
        <ErrorLine error={error} />
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => onSkip(question))}>
            {t('skip')}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
                {t('previous')}
              </Button>
            )}
            {last ? (
              <Button size="sm" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('submit')}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => setStep(step + 1)}>
                {t('next')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SecretCard({
  question,
  onSubmit,
  onSkip,
}: {
  question: PendingQuestion
  onSubmit: (q: PendingQuestion, value: string, allowedHosts?: string[]) => Promise<void>
  onSkip: (q: PendingQuestion) => Promise<void>
}) {
  const t = useTranslations('chat.interaction')
  const item = question.questions.find((q) => q.isSecret || q.secretStore) ?? question.questions[0]
  const binding = item.secretStore
  const [value, setValue] = useState('')
  const [hostsText, setHostsText] = useState(() => (binding?.allowedHosts ?? []).join('\n'))
  const [hostsEdited, setHostsEdited] = useState(false)
  const { busy, error, run } = useAction()

  const submit = () => {
    if (!value) return
    // Untouched hosts are left to the Gateway: it already fills the prompt from
    // the agent's proposal or the entry's current list, and an explicit empty
    // list would switch egress substitution off.
    const hosts = binding && (hostsEdited || binding.allowedHosts) ? normalizeHosts(hostsText) : undefined
    void run(async () => {
      await onSubmit(question, value, hosts)
      setValue('')
    })
  }

  return (
    <div>
      <CardHeader icon={<KeyRound className="w-4 h-4" />} title={t('secretTitle')} expiresAtMs={question.expiresAtMs} />
      <form
        className="px-4 pb-3 space-y-3"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="text-sm text-white/90 whitespace-pre-wrap">{item.question}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {binding && (
            <>
              <dt className="text-white/40">{t('secretName')}</dt>
              <dd className="font-mono text-white/80 break-all">{binding.name}</dd>
            </>
          )}
          {binding?.reason && (
            <>
              <dt className="text-white/40">{t('secretReason')}</dt>
              <dd className="text-white/80">{binding.reason}</dd>
            </>
          )}
          {question.agentId && (
            <>
              <dt className="text-white/40">{t('requestedBy')}</dt>
              <dd className="font-mono text-white/80">{question.agentId}</dd>
            </>
          )}
        </dl>
        {item.secretStoreExisting && (
          <div className="text-xs text-amber-300">
            {t('secretExisting', { time: new Date(item.secretStoreExisting.updatedAtMs).toLocaleString() })}
          </div>
        )}
        <input
          type="password"
          value={value}
          disabled={busy}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('secretValuePlaceholder')}
          className={cn(inputClass, 'font-mono')}
        />
        {binding && (
          <label className="block">
            <span className="text-xs text-white/40">{t('allowedHosts')}</span>
            <textarea
              rows={2}
              value={hostsText}
              disabled={busy}
              onChange={(e) => {
                setHostsText(e.target.value)
                setHostsEdited(true)
              }}
              className={cn(inputClass, 'mt-1 font-mono text-xs')}
            />
            <span className="text-[11px] text-white/30">{t('allowedHostsHint')}</span>
          </label>
        )}
        <div className="text-[11px] text-white/40">{t('secretNote')}</div>
        <ErrorLine error={error} />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => onSkip(question))}>
            {t('skip')}
          </Button>
          <Button type="submit" size="sm" disabled={busy || value.length === 0}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApproval
  onDecide: (a: PendingApproval, decision: ApprovalDecision) => Promise<void>
}) {
  const t = useTranslations('chat.interaction')
  const { busy, error, run } = useAction()
  const decisionLabel: Record<ApprovalDecision, string> = {
    'allow-once': t('allowOnce'),
    'allow-always': t('allowAlways'),
    deny: t('deny'),
  }
  const severityLabel = { info: t('severityInfo'), warning: t('severityWarning'), critical: t('severityCritical') }
  const severityClass =
    approval.severity === 'critical'
      ? 'text-red-300 border-red-500/40 bg-red-500/10'
      : approval.severity === 'info'
        ? 'text-white/60 border-white/15 bg-white/[0.04]'
        : 'text-amber-300 border-amber-500/40 bg-amber-500/10'

  return (
    <div>
      <CardHeader
        icon={<ShieldAlert className="w-4 h-4" />}
        title={approval.approvalKind === 'exec' ? t('approvalExec') : t('approvalPlugin')}
        expiresAtMs={approval.expiresAtMs}
      />
      <div className="px-4 pb-3 space-y-2">
        {approval.approvalKind === 'plugin' ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-white/90 truncate">{approval.title}</span>
              <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-mono', severityClass)}>
                {severityLabel[approval.severity]}
              </span>
            </div>
            {approval.description && (
              <p className="text-sm text-white/70 whitespace-pre-wrap">{approval.description}</p>
            )}
          </>
        ) : (
          <>
            <pre className="text-xs font-mono text-white/90 bg-black/40 border border-white/10 rounded-md px-3 py-2 whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {approval.command ?? '—'}
            </pre>
            {approval.host && (
              <div className="text-xs text-white/40">
                {t('host')}: <span className="font-mono">{approval.host}</span>
              </div>
            )}
          </>
        )}
        {approval.warningText && <div className="text-xs text-amber-300 whitespace-pre-wrap">{approval.warningText}</div>}
        {approval.agentId && (
          <div className="text-[11px] text-white/40">
            {t('requestedBy')}: <span className="font-mono">{approval.agentId}</span>
          </div>
        )}
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {approval.allowedDecisions.map((decision) => (
            <Button
              key={decision}
              size="sm"
              variant={decision === 'allow-once' ? undefined : 'outline'}
              disabled={busy}
              onClick={() => void run(() => onDecide(approval, decision))}
              className={decision === 'deny' ? 'text-red-300 border-red-500/40 hover:bg-red-500/10' : undefined}
            >
              {decisionLabel[decision]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
