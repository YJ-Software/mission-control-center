import { describe, it, expect } from 'vitest'
import { nextRunAt, isDue } from '@/lib/backup/next-run'

const L = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0)

describe('nextRunAt', () => {
  it('hourly interval 6 → next hour divisible by 6 at :00', () => {
    expect(nextRunAt('hourly', { interval: 6 }, L(2026, 10, 6, 7, 30))).toEqual(L(2026, 10, 6, 12, 0))
  })
  it('hourly is strictly after: exactly on the boundary moves to the next one', () => {
    expect(nextRunAt('hourly', { interval: 1 }, L(2026, 10, 6, 7, 0))).toEqual(L(2026, 10, 6, 8, 0))
  })
  it('daily picks the next listed weekday at time', () => {
    // 2026-10-06 is a Tuesday (2). days=[1,3] (Mon, Wed) at 03:00
    expect(nextRunAt('daily', { days: [1, 3], time: '03:00' }, L(2026, 10, 6, 12, 0))).toEqual(L(2026, 10, 7, 3, 0))
  })
  it('daily later today when the time has not passed', () => {
    expect(nextRunAt('daily', { days: [2], time: '23:30' }, L(2026, 10, 6, 12, 0))).toEqual(L(2026, 10, 6, 23, 30))
  })
  it('weekly wraps to next week', () => {
    expect(nextRunAt('weekly', { day: 2, time: '01:00' }, L(2026, 10, 6, 12, 0))).toEqual(L(2026, 10, 13, 1, 0))
  })
  it('monthly rolls into next month', () => {
    expect(nextRunAt('monthly', { dayOfMonth: 5, time: '02:00' }, L(2026, 10, 6, 0, 0))).toEqual(L(2026, 11, 5, 2, 0))
  })
  it('unknown type throws', () => expect(() => nextRunAt('yearly', { interval: 1 } as never, new Date())).toThrow())
})

describe('isDue', () => {
  it('due when a run time falls in (lastTick, now]', () => {
    expect(isDue('hourly', { interval: 1 }, L(2026, 10, 6, 7, 59), L(2026, 10, 6, 8, 0))).toBe(true)
  })
  it('not due before the boundary', () => {
    expect(isDue('hourly', { interval: 1 }, L(2026, 10, 6, 7, 58), L(2026, 10, 6, 7, 59))).toBe(false)
  })
})
