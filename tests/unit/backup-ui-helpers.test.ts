import { describe, it, expect } from 'vitest'
import {
  classifyLogOutcome, restoreAction, systemLogJobUrl, recentDbRestore, LAST_DB_RESTORE_MAX_AGE_MS,
} from '@/lib/backup/ui-helpers'

describe('classifyLogOutcome', () => {
  it('completed 無 error = ok；空白 error 也算 ok', () => {
    expect(classifyLogOutcome('completed', null)).toBe('ok')
    expect(classifyLogOutcome('completed', '  ')).toBe('ok')
  })
  it('completed 但 error 非空 = warning（不是失敗）', () => {
    expect(classifyLogOutcome('completed', 'FTP 上傳失敗')).toBe('warning')
  })
  it('failed = error，即使 error 為空', () => {
    expect(classifyLogOutcome('failed', 'boom')).toBe('error')
    expect(classifyLogOutcome('failed', null)).toBe('error')
  })
  it('其他狀態 = other', () => {
    expect(classifyLogOutcome('processing', null)).toBe('other')
  })
})

describe('restoreAction', () => {
  it('mcc 可還原', () => expect(restoreAction({ kind: 'mcc', legacyRestorable: false })).toBe('enabled'))
  it('legacy 依腳本是否存在', () => {
    expect(restoreAction({ kind: 'legacy-openclaw', legacyRestorable: true })).toBe('enabled')
    expect(restoreAction({ kind: 'legacy-openclaw', legacyRestorable: false })).toBe('legacy-disabled')
  })
  it('extra / unknown 不顯示還原', () => {
    expect(restoreAction({ kind: 'extra', legacyRestorable: true })).toBe('hidden')
    expect(restoreAction({ kind: 'unknown', legacyRestorable: true })).toBe('hidden')
  })
})

describe('systemLogJobUrl', () => {
  it('帶 tab=jobs，否則 job 參數會被分頁邏輯移除', () => {
    expect(systemLogJobUrl('abc 1')).toBe('/system-log?tab=jobs&job=abc%201')
  })
})

describe('recentDbRestore', () => {
  const now = Date.parse('2026-10-10T00:00:00Z')
  const v = (at: string) => ({ result: 'applied' as const, at, detail: 'd' })
  it('7 天內顯示、超過不顯示', () => {
    expect(recentDbRestore(v('2026-10-08T00:00:00Z'), now)).not.toBeNull()
    expect(recentDbRestore(v(new Date(now - LAST_DB_RESTORE_MAX_AGE_MS - 1000).toISOString()), now)).toBeNull()
  })
  it('null 與壞時間回 null', () => {
    expect(recentDbRestore(null, now)).toBeNull()
    expect(recentDbRestore(v('garbage'), now)).toBeNull()
  })
})
