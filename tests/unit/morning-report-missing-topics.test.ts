import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'child_process'

/**
 * Regression: a topic that produced no output used to fail completely
 * silently. The report published, the podcast recorded, and the only trace was
 * a "⚠️ 此段落尚未生成" placeholder someone had to read the page to notice — the
 * 2026-07-26 科技股 outage went unreported for a day.
 *
 * finalize now pushes the gap to the dashboard bell and the operator's
 * channel. Both are deliberately independent of the finalize cron job's
 * announce template, which installs can (and do) override.
 */

vi.mock('child_process', () => ({ execFileSync: vi.fn(), execSync: vi.fn(), execFile: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/schema', () => ({ morningReportConfig: {} }))
vi.mock('@/lib/morning-report/openclaw', () => ({
  findOpenclawBin: () => '/usr/local/bin/openclaw',
}))

const createNotification = vi.fn()
vi.mock('@/lib/notifications', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }))

import { alertMissingTopics } from '@/lib/morning-report/finalize'

const mockExec = vi.mocked(execFileSync)

beforeEach(() => vi.clearAllMocks())

describe('alertMissingTopics', () => {
  it('stays silent when every topic produced output', () => {
    alertMissingTopics([], '2026-07-26')

    expect(createNotification).not.toHaveBeenCalled()
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('names the missing topics on both channels', () => {
    alertMissingTopics([{ id: 'stocks', name: '科技股/產業脈動' }], '2026-07-26')

    const note = createNotification.mock.calls[0][0]
    expect(note.severity).toBe('warning')
    expect(note.title).toContain('1')
    expect(note.body).toContain('科技股/產業脈動')
    expect(note.body).toContain('2026-07-26')

    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('announce')
    expect(String(args)).toContain('科技股/產業脈動')
  })

  it('lists all of them when several are missing', () => {
    alertMissingTopics(
      [{ id: 'stocks', name: '科技股' }, { id: 'arxiv', name: '論文' }],
      '2026-07-26',
    )

    const note = createNotification.mock.calls[0][0]
    expect(note.title).toContain('2')
    expect(note.body).toContain('科技股')
    expect(note.body).toContain('論文')
  })

  it('dedups per day so re-running finalize does not stack bell entries', () => {
    alertMissingTopics([{ id: 'stocks', name: '科技股' }], '2026-07-26')

    expect(createNotification.mock.calls[0][0].dedupKey).toBe('morning-report-missing-2026-07-26')
  })

  it('still rings the bell when the channel announce fails', () => {
    // openclaw may be missing from PATH under systemd; that must not swallow
    // the alert entirely.
    mockExec.mockImplementation(() => { throw new Error('ENOENT') })

    expect(() => alertMissingTopics([{ id: 'stocks', name: '科技股' }], '2026-07-26')).not.toThrow()
    expect(createNotification).toHaveBeenCalled()
  })

  it('still announces when the bell write fails', () => {
    createNotification.mockImplementation(() => { throw new Error('db locked') })

    expect(() => alertMissingTopics([{ id: 'stocks', name: '科技股' }], '2026-07-26')).not.toThrow()
    expect(mockExec).toHaveBeenCalled()
  })
})
