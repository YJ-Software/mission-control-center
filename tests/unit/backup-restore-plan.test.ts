import { describe, it, expect } from 'vitest'
import { planCarryOver } from '@/lib/backup/restore-plan'

describe('planCarryOver', () => {
  it('carries extensions/npm from live even when the restored tree has a partial copy', () => {
    expect(planCarryOver(['extensions', 'npm', 'state'], ['extensions', 'state'])).toEqual(['extensions', 'npm'])
  })
  it('carries anything the backup did not include (tmp, cache, plugin-skills)', () => {
    expect(planCarryOver(['state', 'tmp', 'cache', 'plugin-skills', 'workspace'], ['state', 'workspace']))
      .toEqual(['cache', 'plugin-skills', 'tmp'])
  })
  it('never carries user data from live, even if missing in the backup', () => {
    expect(planCarryOver(['state', 'agents', 'openclaw.json', 'workspace', 'credentials'], [])).toEqual([])
  })
  it('ignores ALWAYS_FROM_LIVE entries that do not exist live', () => {
    expect(planCarryOver(['state'], ['state', 'extensions'])).toEqual([])
  })
})
