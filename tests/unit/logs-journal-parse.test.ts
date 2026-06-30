import { describe, it, expect } from 'vitest'
import {
  parseFail2banFile,
  classifyFail2ban,
  parseJournalJson,
  levelFromPriority,
} from '../../src/lib/logs/journal'

describe('classifyFail2ban', () => {
  it('flags bans as warning', () => {
    expect(classifyFail2ban('NOTICE  [sshd] Ban 1.2.3.4')).toBe('warning')
  })
  it('flags errors as error', () => {
    expect(classifyFail2ban('ERROR   [sshd] Failed to execute ban jail')).toBe('error')
  })
  it('treats found/unban as info', () => {
    expect(classifyFail2ban('NOTICE  [sshd] Unban 1.2.3.4')).toBe('info')
    expect(classifyFail2ban('INFO    [sshd] Found 1.2.3.4')).toBe('info')
  })
})

describe('parseFail2banFile', () => {
  const sample = [
    '2026-06-30 11:00:00,123 fail2ban.actions        [12345]: NOTICE  [sshd] Ban 192.168.1.10',
    '2026-06-30 11:05:30,000 fail2ban.actions        [12345]: NOTICE  [mission-control] Unban 10.0.0.5',
    'garbage line that should be skipped',
  ].join('\n')

  it('parses ban lines into entries with jail as service', () => {
    const entries = parseFail2banFile(sample, 't')
    expect(entries).toHaveLength(2)
    expect(entries[0].service).toBe('sshd')
    expect(entries[0].level).toBe('warning')
    expect(entries[0].message).toContain('Ban 192.168.1.10')
    // pid/component prefix is stripped from the message
    expect(entries[0].message).not.toContain('[12345]')
  })

  it('uses the jail name for the second entry and dates parse', () => {
    const entries = parseFail2banFile(sample, 't')
    expect(entries[1].service).toBe('mission-control')
    expect(entries[1].level).toBe('info')
    expect(new Date(entries[0].timestamp).getUTCFullYear()).toBe(2026)
  })
})

describe('parseJournalJson tag mode', () => {
  it('extracts the [subsystem] tag (skipping numeric pid brackets)', () => {
    const usec = String(Date.UTC(2026, 5, 30, 8, 0, 0) * 1000)
    const line = JSON.stringify({
      __REALTIME_TIMESTAMP: usec,
      PRIORITY: '6',
      MESSAGE: '2026-06-30T16:47:00.063+08:00 [ws] ⇄ res ok',
    })
    const [entry] = parseJournalJson(line, { idPrefix: 'oc', serviceFrom: 'tag', tagFallback: 'openclaw' })
    expect(entry.service).toBe('ws')
    // leading ISO timestamp stripped
    expect(entry.message.startsWith('[ws]')).toBe(true)
  })
})

describe('levelFromPriority', () => {
  it('maps syslog priorities', () => {
    expect(levelFromPriority('3')).toBe('error')
    expect(levelFromPriority('4')).toBe('warning')
    expect(levelFromPriority('6')).toBe('info')
    expect(levelFromPriority(undefined)).toBe('info')
  })
})
