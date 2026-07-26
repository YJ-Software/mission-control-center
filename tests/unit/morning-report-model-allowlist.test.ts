import { describe, it, expect } from 'vitest'
import { resolveAllowedModel } from '@/lib/morning-report/utils'

/**
 * Regression: on 2026-07-26 the 科技股 topic vanished from the morning report.
 *
 * Its cron job carried `payload.model = "kimi-coding/k2p5"` — a provider that
 * had been removed from openclaw.json months earlier, inherited from a stale
 * global `cronModel`. OpenClaw rejects a job whose model isn't in the agent
 * allowlist, so the run failed at 07:10:00.000 without doing any work, and the
 * section became "⚠️ 此段落尚未生成" with nobody notified.
 *
 * syncCronJobs now substitutes a runnable model at write time.
 */

const ALLOWED = ['kimi/k3', 'kimi/kimi-for-coding', 'openai/gpt-5.6-terra']

describe('resolveAllowedModel', () => {
  it('substitutes the fallback for a model the allowlist rejects', () => {
    // The exact shape of the outage.
    expect(resolveAllowedModel('kimi-coding/k2p5', ALLOWED, 'kimi/k3')).toBe('kimi/k3')
  })

  it('leaves an allowed model untouched', () => {
    expect(resolveAllowedModel('kimi/kimi-for-coding', ALLOWED, 'kimi/k3'))
      .toBe('kimi/kimi-for-coding')
  })

  it('treats an empty allowlist as no restriction, not as "deny everything"', () => {
    // OpenClaw only enforces agents.defaults.models when it is populated.
    // Reading absent-config as deny-all would rewrite every job on a box that
    // never configured an allowlist.
    expect(resolveAllowedModel('anything/at-all', [], 'kimi/k3')).toBe('anything/at-all')
  })

  it('passes an empty model through — it means "use the agent default"', () => {
    expect(resolveAllowedModel('', ALLOWED, 'kimi/k3')).toBe('')
  })

  it('keeps the original when the fallback is itself not allowed', () => {
    // Swapping in a second unrunnable model would just move the failure while
    // making it harder to trace back to the configured value.
    expect(resolveAllowedModel('bad/model', ALLOWED, 'also-bad/model')).toBe('bad/model')
  })

  it('keeps the original when no fallback is available', () => {
    expect(resolveAllowedModel('bad/model', ALLOWED, '')).toBe('bad/model')
  })
})
