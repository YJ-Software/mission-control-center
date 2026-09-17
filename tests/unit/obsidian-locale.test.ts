import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import { setObsidianLocale } from '@/lib/second-brain/obsidian/installer'

function unitPath() {
  return path.join(os.homedir(), '.config/systemd/user/obsidian-headless.service')
}

/**
 * This suite used to operate on the developer's REAL
 * `~/.config/systemd/user/obsidian-headless.service`: it wrote to it, deleted
 * it, and relied on `afterEach` to put it back — so a crash or a Ctrl-C
 * mid-run left the machine's unit file modified or gone. That also made
 * CLAUDE.md's "npm test is safe in any environment" untrue.
 *
 * `setObsidianLocale` resolves `os.homedir()` on every call (installer.ts:374),
 * not once at import, so pointing HOME at a throwaway directory redirects both
 * the test and the code under test. No production code needs to change.
 */
let home: string
const realHome = process.env.HOME

describe('setObsidianLocale', () => {
  beforeEach(() => {
    // A fresh HOME per test: no backup/restore needed, because nothing outside
    // this directory is ever read or written.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-obsidian-'))
    process.env.HOME = home
  })

  afterEach(() => {
    process.env.HOME = realHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('never touches the real home directory', () => {
    // The guard for the bug above: if HOME is not redirected, this path is the
    // developer's own unit file and the rest of this suite would rewrite it.
    expect(unitPath().startsWith(home)).toBe(true)
    expect(unitPath().startsWith(realHome!)).toBe(false)
  })

  it('returns { updated: false } when no unit file exists', () => {
    const p = unitPath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
    expect(setObsidianLocale('zh-TW')).toEqual({ updated: false })
  })

  it('rejects malformed locale strings to prevent shell injection', () => {
    expect(() => setObsidianLocale('zh-TW; rm -rf /')).toThrow(/Invalid locale/)
    expect(() => setObsidianLocale('')).toThrow(/Invalid locale/)
  })

  it('replaces an existing --lang flag with the new locale', () => {
    const p = unitPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, [
      '[Service]',
      'ExecStart=obsidian --no-sandbox --lang=zh-TW',
      '',
    ].join('\n'), 'utf8')

    const result = setObsidianLocale('en')
    expect(result).toEqual({ updated: true })
    expect(fs.readFileSync(p, 'utf8')).toContain('--lang=en')
    expect(fs.readFileSync(p, 'utf8')).not.toContain('--lang=zh-TW')
  })

  it('appends --lang when missing from ExecStart', () => {
    const p = unitPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, [
      '[Service]',
      'ExecStart=obsidian --no-sandbox --disable-features=Foo',
      '',
    ].join('\n'), 'utf8')

    expect(setObsidianLocale('zh-CN')).toEqual({ updated: true })
    const content = fs.readFileSync(p, 'utf8')
    expect(content).toContain('ExecStart=obsidian --no-sandbox --disable-features=Foo --lang=zh-CN')
  })

  it('is idempotent when the locale already matches', () => {
    const p = unitPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const original = [
      '[Service]',
      'ExecStart=obsidian --no-sandbox --lang=zh-TW',
      '',
    ].join('\n')
    fs.writeFileSync(p, original, 'utf8')

    expect(setObsidianLocale('zh-TW')).toEqual({ updated: false })
    expect(fs.readFileSync(p, 'utf8')).toBe(original)
  })
})
