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

describe('setObsidianLocale', () => {
  let originalUnit: string | null = null

  beforeEach(() => {
    const p = unitPath()
    originalUnit = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  })

  afterEach(() => {
    const p = unitPath()
    if (originalUnit !== null) {
      fs.writeFileSync(p, originalUnit, 'utf8')
    } else if (fs.existsSync(p)) {
      fs.unlinkSync(p)
    }
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
