import { describe, it, expect, vi } from 'vitest'
import {
  isAptCommand, isDpkgRepairCommand, dpkgRepairShell, dpkgRepairStrictShell, runDpkgRepair,
  parseDpkgAudit, pendingDpkgJournals, checkDpkgHealth, DPKG_REPAIR_SUDO_ARGS, type ExecFn,
} from '@/lib/system-update/dpkg-repair'
import { runDpkgBootCheck, buildDpkgNotice, DPKG_INTERRUPTED_DEDUP_KEY } from '@/lib/system-update/dpkg-boot-check'
import { DPKG_INTERRUPTED_DEDUP_KEY as CLIENT_KEY } from '@/lib/long-run-client'

// 本測試不在本機跑真的 dpkg / sudo：exec 與讀目錄全部注入。

describe('isAptCommand', () => {
  it.each([
    ['sudo', ['apt-get', 'install', '-y', 'xvfb']],
    ['sudo', ['apt', 'install', '-y', 'x']],
    ['sudo', ['-n', 'apt-get', 'install', '-y', 'docker.io']],
    ['sudo', ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'upgrade']],
    ['sudo', ['dpkg', '-r', 'obsidian']],
    ['apt-get', ['update']],
  ])('%s %j → true', (cmd, args) => {
    expect(isAptCommand(cmd, args)).toBe(true)
  })
  it.each([
    ['sudo', ['systemctl', 'restart', 'x']],
    ['sudo', ['docker', 'pull', 'couchdb']],
    ['npm', ['install', '-g', 'apt']],
    ['bash', ['-c', 'yes | sudo apt-get install x']], // 包在 shell 字串裡的看不出來，呼叫端用 aptSelfHeal 指定
    ['sudo', ['tee', '/etc/apt/sources.list.d/google-chrome.list']],
  ])('%s %j → false', (cmd, args) => {
    expect(isAptCommand(cmd, args)).toBe(false)
  })
})

describe('修復指令', () => {
  it('前置版本：sudo -n、非互動環境、失敗只印一行並 exit 0', () => {
    const s = dpkgRepairShell()
    expect(s).toMatch(/^sudo -n env DEBIAN_FRONTEND=noninteractive .*dpkg --configure -a 2>&1 \|\| echo /)
    expect(s).toContain('NEEDRESTART_MODE=a')
  })
  it('一鍵修復版本：失敗就是失敗', () => {
    expect(dpkgRepairStrictShell()).not.toContain('||')
  })
  it('isDpkgRepairCommand', () => {
    expect(isDpkgRepairCommand('sudo', ['dpkg', '--configure', '-a'])).toBe(true)
    expect(isDpkgRepairCommand('sudo', [...DPKG_REPAIR_SUDO_ARGS])).toBe(true)
    expect(isDpkgRepairCommand('sudo', ['dpkg', '-r', 'x'])).toBe(false)
  })
  it('runDpkgRepair 絕不丟錯', async () => {
    const ok: ExecFn = vi.fn(async () => ({ code: 0, stdout: 'Setting up x\n', stderr: '' }))
    expect(await runDpkgRepair(ok)).toEqual({ ok: true, output: 'Setting up x' })
    expect(ok).toHaveBeenCalledWith('sudo', DPKG_REPAIR_SUDO_ARGS, expect.any(Number))
    const fail: ExecFn = async () => ({ code: 1, stdout: '', stderr: 'sudo: a password is required' })
    expect(await runDpkgRepair(fail)).toEqual({ ok: false, output: 'sudo: a password is required' })
    const boom: ExecFn = async () => { throw new Error('spawn EACCES') }
    expect(await runDpkgRepair(boom)).toEqual({ ok: false, output: 'spawn EACCES' })
  })
})

describe('dpkg 健康檢查', () => {
  it('parseDpkgAudit / pendingDpkgJournals', () => {
    expect(parseDpkgAudit('  \n')).toBeNull()
    expect(parseDpkgAudit('The following packages are only half configured:\n xvfb\n')).toContain('half configured')
    expect(pendingDpkgJournals(['0001', '0002', 'tmp.i', '.keep'])).toEqual(['0001', '0002'])
  })

  it('乾淨：audit 空、updates/ 空 → 沒中斷', async () => {
    const r = await checkDpkgHealth({ exec: async () => ({ code: 0, stdout: '', stderr: '' }), readUpdatesDir: () => [] })
    expect(r).toEqual({ supported: true, interrupted: false, detail: '' })
  })

  it('updates/ 有 journal（dpkg 被中斷）→ 中斷', async () => {
    const r = await checkDpkgHealth({ exec: async () => ({ code: 0, stdout: '', stderr: '' }), readUpdatesDir: () => ['0000'] })
    expect(r.interrupted).toBe(true)
    expect(r.detail).toContain('1 個未處理的 journal')
  })

  it('dpkg --audit 有輸出（不論 exit code）→ 中斷，內容帶進 detail', async () => {
    const r = await checkDpkgHealth({
      exec: async () => ({ code: 1, stdout: 'The following packages have been unpacked but not yet configured:\n couchdb\n', stderr: '' }),
      readUpdatesDir: () => [],
    })
    expect(r.interrupted).toBe(true)
    expect(r.detail).toContain('couchdb')
  })

  it('非 Debian 系（沒有 dpkg、沒有 /var/lib/dpkg）→ 不判斷', async () => {
    const r = await checkDpkgHealth({
      exec: async () => ({ code: 127, stdout: '', stderr: 'spawn dpkg ENOENT' }),
      readUpdatesDir: () => { throw new Error('ENOENT') },
    })
    expect(r.supported).toBe(false)
  })
})

describe('開機 dpkg 檢查', () => {
  it('有中斷 → 寫一則通知（標題、內文含修復說明）', async () => {
    const notify = vi.fn()
    const res = await runDpkgBootCheck({
      check: async () => ({ supported: true, interrupted: true, detail: 'dpkg --audit：\n xvfb' }),
      notify,
    })
    expect(res).toBe('notified')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].title).toContain('中斷')
    expect(notify.mock.calls[0][0].body).toContain('xvfb')
    expect(notify.mock.calls[0][0].body).toContain('dpkg --configure -a')
  })

  it('沒問題、不支援、檢查丟錯 → 不通知、不丟錯', async () => {
    const notify = vi.fn()
    expect(await runDpkgBootCheck({ check: async () => ({ supported: true, interrupted: false, detail: '' }), notify })).toBe('ok')
    expect(await runDpkgBootCheck({ check: async () => ({ supported: false, interrupted: false, detail: '' }), notify })).toBe('unsupported')
    expect(await runDpkgBootCheck({ check: async () => { throw new Error('x') }, notify })).toBe('error')
    expect(notify).not.toHaveBeenCalled()
  })

  it('通知中心靠同一個 dedupKey 顯示「修復」按鈕', () => {
    expect(DPKG_INTERRUPTED_DEDUP_KEY).toBe(CLIENT_KEY)
    expect(buildDpkgNotice('d').title.length).toBeGreaterThan(0)
  })
})
