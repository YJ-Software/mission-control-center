import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Edit history for morning-report templates.
 *
 * The motivating case is "還原預設", which rewrites every topic's prompt in one
 * click and was previously unrecoverable.
 *
 * `@/lib/db` opens ~/.mission-control/db.sqlite at import with no override, so
 * these tests substitute a drizzle instance over a throwaway file rather than
 * writing to the operator's real database.
 */

const { tmpDbPath } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return { tmpDbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-tplver-')), 'db.sqlite') }
})

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('@/lib/schema')
  const sqlite = new Database(tmpDbPath)
  // Mirrors the DDL in src/lib/db.ts.
  sqlite.exec(`
    CREATE TABLE morning_report_template_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'save',
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `)
  return { db: drizzle(sqlite, { schema }), initDb: () => {} }
})

import {
  recordTemplateVersion,
  listTemplateVersions,
  getTemplateVersion,
  callerOrigin,
} from '@/lib/morning-report/template-versions'
import { db } from '@/lib/db'
import { morningReportTemplateVersions } from '@/lib/schema'

beforeEach(() => {
  db.delete(morningReportTemplateVersions).run()
})

const list = (refId: string) => listTemplateVersions('topic', refId)

describe('recordTemplateVersion', () => {
  it('captures the pre-edit content as a baseline on the first save', () => {
    // Without this, the first edit of a template you did not write destroys
    // the original — the moment you are most likely to want it back.
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'v2', previous: 'v1' })

    const versions = list('stocks')
    expect(versions.map((v) => [v.content, v.origin])).toEqual([
      ['v2', 'save'],
      ['v1', 'baseline'],
    ])
  })

  it('only seeds a baseline once', () => {
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'v2', previous: 'v1' })
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'v3', previous: 'v2' })

    expect(list('stocks').filter((v) => v.origin === 'baseline')).toHaveLength(1)
  })

  it('skips the baseline when there was no previous content', () => {
    recordTemplateVersion({ scope: 'topic', refId: 'fresh', content: 'v1' })
    expect(list('fresh').map((v) => v.content)).toEqual(['v1'])

    recordTemplateVersion({ scope: 'topic', refId: 'empty', content: 'v1', previous: '' })
    expect(list('empty').map((v) => v.content)).toEqual(['v1'])
  })

  it('does not record a save that changed nothing', () => {
    // Topic updates rewrite every field, so an unchanged template arrives here
    // on any edit to the name, cron time, model…
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'same' })
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'same' })
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'same' })

    expect(list('stocks')).toHaveLength(1)
  })

  it('records the reset origin so a bulk 還原預設 is identifiable in the list', () => {
    recordTemplateVersion({
      scope: 'topic', refId: 'stocks', content: 'default', previous: 'mine', origin: 'reset-default',
    })

    expect(list('stocks').map((v) => [v.content, v.origin])).toEqual([
      ['default', 'reset-default'],
      ['mine', 'baseline'],
    ])
  })

  it('keeps scopes and refs independent', () => {
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'topic-content' })
    recordTemplateVersion({ scope: 'topic', refId: 'arxiv', content: 'other-topic' })
    recordTemplateVersion({ scope: 'format', refId: 'format', content: 'format-content' })
    recordTemplateVersion({ scope: 'config', refId: 'finalizeMessageTemplate', content: 'cfg' })

    expect(list('stocks').map((v) => v.content)).toEqual(['topic-content'])
    expect(listTemplateVersions('format', 'format').map((v) => v.content)).toEqual(['format-content'])
    expect(listTemplateVersions('config', 'finalizeMessageTemplate').map((v) => v.content)).toEqual(['cfg'])
  })

  it('prunes to the newest 50, keeping the most recent', () => {
    for (let i = 1; i <= 55; i++) {
      recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: `v${i}` })
    }

    const versions = list('stocks')
    expect(versions).toHaveLength(50)
    expect(versions[0].content).toBe('v55')
    expect(versions.at(-1)!.content).toBe('v6')
  })

  it('prunes per ref, not globally', () => {
    for (let i = 1; i <= 55; i++) {
      recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: `v${i}` })
    }
    recordTemplateVersion({ scope: 'topic', refId: 'arxiv', content: 'only-one' })

    expect(list('arxiv')).toHaveLength(1)
    expect(list('stocks')).toHaveLength(50)
  })

  it('never throws — a lost history entry must not fail the save it accompanies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A scope the column constraints accept but with content the driver
    // rejects: undefined violates NOT NULL through the query builder.
    expect(() => recordTemplateVersion({
      scope: 'topic', refId: 'stocks', content: undefined as unknown as string,
    })).not.toThrow()
    warn.mockRestore()
  })
})

describe('callerOrigin', () => {
  it('accepts a restore claim', () => {
    expect(callerOrigin('restore')).toBe('restore')
  })

  it('refuses server-only origins so an edit cannot pose as a reset or baseline', () => {
    // These describe things the server did; letting a client assert them would
    // make the history lie about how a version came to be.
    expect(callerOrigin('reset-default')).toBe('save')
    expect(callerOrigin('baseline')).toBe('save')
  })

  it('falls back to save for anything else', () => {
    for (const v of [null, undefined, '', 'nonsense', 42, {}]) {
      expect(callerOrigin(v)).toBe('save')
    }
  })
})

describe('listTemplateVersions / getTemplateVersion', () => {
  it('returns newest first', () => {
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'first' })
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'second' })
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'third' })

    expect(list('stocks').map((v) => v.content)).toEqual(['third', 'second', 'first'])
  })

  it('fetches one revision in full for loading into the editor', () => {
    recordTemplateVersion({ scope: 'topic', refId: 'stocks', content: 'the full prompt text' })
    const id = list('stocks')[0].id

    expect(getTemplateVersion(id)?.content).toBe('the full prompt text')
  })

  it('returns undefined for an id that does not exist', () => {
    expect(getTemplateVersion(999999)).toBeUndefined()
  })
})
