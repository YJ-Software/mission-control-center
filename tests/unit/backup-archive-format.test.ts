import { describe, it, expect } from 'vitest'
import { classifyBackupFile, buildArchiveName, parseManifest } from '@/lib/backup/archive-format'

describe('classifyBackupFile', () => {
  it.each([
    ['mcc-backup_openclaw_box1_20261006_101500.tar.gz', 'mcc'],
    ['openclaw-backup_jane_20260901_030000.tar.gz', 'legacy-openclaw'],
    ['extra-backup_docs_20261006_101500.tar.gz', 'extra'],
    ['something.tar.gz', 'unknown'],
    ['mcc-backup_openclaw_box1_20261006_101500.zip', 'unknown'],
  ])('%s → %s', (name, kind) => expect(classifyBackupFile(name)).toBe(kind))
})

describe('buildArchiveName', () => {
  it('uses backend, sanitised host and local timestamp', () => {
    const at = new Date(2026, 9, 6, 10, 15, 0)
    expect(buildArchiveName({ backend: 'openclaw', host: 'my box_01', at }))
      .toBe('mcc-backup_openclaw_my-box-01_20261006_101500.tar.gz')
  })
  it('round-trips through classifyBackupFile', () => {
    expect(classifyBackupFile(buildArchiveName({ backend: 'hermes', host: 'h', at: new Date() }))).toBe('mcc')
  })
})

describe('parseManifest', () => {
  const ok = {
    format: 1, backend: 'openclaw', backendVersion: '2026.9.8', mccVersion: '0.3.94',
    createdAt: '2026-10-06T02:15:00.000Z', hostname: 'box1',
    parts: { backend: 'backend/x-openclaw-backup.tar.gz', mccDb: 'mcc/db.sqlite', mccEnv: 'mcc/env.local' },
  }
  it('accepts a valid manifest', () => expect(parseManifest(ok)).toEqual(ok))
  it('allows parts.backend null (OpenClaw 未包含)', () => {
    expect(parseManifest({ ...ok, backendVersion: null, parts: { ...ok.parts, backend: null } }).parts.backend).toBeNull()
  })
  it('allows mccEnv null and backendVersion null', () => {
    expect(parseManifest({ ...ok, backendVersion: null, parts: { ...ok.parts, mccEnv: null } }).parts.mccEnv).toBeNull()
  })
  it.each([
    ['format', { ...ok, format: 2 }],
    ['backend', { ...ok, backend: 'other' }],
    ['parts.backend', { ...ok, parts: { ...ok.parts, backend: '' } }],
    ['parts.mccDb', { ...ok, parts: { ...ok.parts, mccDb: '../db.sqlite' } }],
  ])('rejects bad %s', (field, bad) => expect(() => parseManifest(bad)).toThrow(field))
  it('rejects non-objects', () => expect(() => parseManifest(null)).toThrow())
})
