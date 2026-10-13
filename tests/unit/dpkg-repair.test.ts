import { describe, it, expect, vi } from 'vitest'
import {
  isAptCommand, isDpkgRepairCommand, dpkgRepairShell, dpkgRepairStrictShell, runDpkgRepair,
  parseDpkgAudit, pendingDpkgJournals, checkDpkgHealth, DPKG_REPAIR_SUDO_ARGS, type ExecFn,
  withAptNonInteractive, sudoNonInteractiveArgs, runNonInteractive, APT_CONFFILE_OPTS,
} from '@/lib/system-update/dpkg-repair'
import { runDpkgBootCheck, buildDpkgNotice, DPKG_INTERRUPTED_DEDUP_KEY, recheckDpkgAfterRepair } from '@/lib/system-update/dpkg-boot-check'
import { buildSystemUpdatePhases } from '@/lib/system-update/apt'
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
    expect(s).toMatch(/^sudo -n env DEBIAN_FRONTEND=noninteractive .*dpkg --force-confdef --force-confold --configure -a 2>&1 \|\| echo /)
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

// dpkg 的 conffile 提問在 configure 階段、不看 DEBIAN_FRONTEND：沒有這些參數，被改過的設定檔會讓修復停在提問
describe('非互動參數（conffile 一律保留舊檔）', () => {
  it('dpkg --configure -a 一律帶 --force-confdef --force-confold 與非互動環境', () => {
    expect(DPKG_REPAIR_SUDO_ARGS).toEqual([
      '-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'NEEDRESTART_MODE=a', 'NEEDRESTART_SUSPEND=1',
      'UCF_FORCE_CONFFOLD=1', 'APT_LISTCHANGES_FRONTEND=none',
      'dpkg', '--force-confdef', '--force-confold', '--configure', '-a',
    ])
    expect(dpkgRepairStrictShell()).toContain('dpkg --force-confdef --force-confold --configure -a')
  })

  it('apt-get／apt：程式名後補 -y 與 -o Dpkg::Options::=--force-confdef/--force-confold', () => {
    expect(APT_CONFFILE_OPTS).toEqual(['-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'])
    expect(withAptNonInteractive('sudo', ['apt-get', 'install', 'xvfb'])).toEqual(['apt-get', '-y', ...APT_CONFFILE_OPTS, 'install', 'xvfb'])
    // 已有 -y 不重複
    expect(withAptNonInteractive('sudo', ['apt', 'remove', '-y', 'couchdb'])).toEqual(['apt', ...APT_CONFFILE_OPTS, 'remove', '-y', 'couchdb'])
    // sudo 旗標與 env 之後
    expect(withAptNonInteractive('sudo', ['-n', 'env', 'A=1', 'apt-get', 'update'])).toEqual(['-n', 'env', 'A=1', 'apt-get', '-y', ...APT_CONFFILE_OPTS, 'update'])
    // cmd 本身就是 apt-get
    expect(withAptNonInteractive('apt-get', ['install', 'x'])).toEqual(['-y', ...APT_CONFFILE_OPTS, 'install', 'x'])
    // 已有 conffile 選項不重複
    const once = withAptNonInteractive('sudo', ['apt-get', 'install', 'x'])
    expect(withAptNonInteractive('sudo', once)).toEqual(once)
  })

  it('dpkg：--configure／-i 補旗標，-r 不動；非套件管理指令原樣', () => {
    expect(withAptNonInteractive('sudo', ['dpkg', '-i', '/tmp/x.deb'])).toEqual(['dpkg', '--force-confdef', '--force-confold', '-i', '/tmp/x.deb'])
    expect(withAptNonInteractive('sudo', ['dpkg', '-r', 'obsidian'])).toEqual(['dpkg', '-r', 'obsidian'])
    expect(withAptNonInteractive('sudo', ['systemctl', 'restart', 'x'])).toEqual(['systemctl', 'restart', 'x'])
  })

  it('sudoNonInteractiveArgs：mem0 的 apt-get install docker.io', () => {
    expect(sudoNonInteractiveArgs(['apt-get', 'install', 'docker.io'])).toEqual([
      '-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'NEEDRESTART_MODE=a', 'NEEDRESTART_SUSPEND=1',
      'UCF_FORCE_CONFFOLD=1', 'APT_LISTCHANGES_FRONTEND=none',
      'apt-get', '-y', ...APT_CONFFILE_OPTS, 'install', 'docker.io',
    ])
  })

  it('系統更新的 apt-get update／upgrade 都非互動並帶 conffile 選項', () => {
    for (const p of buildSystemUpdatePhases().slice(1)) {
      expect(p.shell).toContain('DEBIAN_FRONTEND=noninteractive')
      expect(p.shell).toContain('--force-confold')
      expect(p.shell).toContain('--force-confdef')
      expect(p.shell).toMatch(/\s-y\b/)
    }
  })

  it('runNonInteractive 的 stdin 是關的：會讀 stdin 的指令立刻讀到 EOF，不會卡住', async () => {
    const t0 = Date.now()
    const r = await runNonInteractive('sh', ['-c', 'if read x; then echo got; else echo eof; fi'], 5000)
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('eof')
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('runNonInteractive：找不到指令回 127、逾時會結束並註明', async () => {
    expect((await runNonInteractive('/nonexistent/bin/x', [], 1000)).code).toBe(127)
    const r = await runNonInteractive('sh', ['-c', 'sleep 5'], 100)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('timeout')
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

  it('修復 job 結束後：恢復了就刪掉通知；仍中斷就重新通知（按鈕回來）', async () => {
    const clear = vi.fn()
    const notify = vi.fn()
    expect(await recheckDpkgAfterRepair({ check: async () => ({ supported: true, interrupted: false, detail: '' }), clear, notify })).toBe('cleared')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
    expect(await recheckDpkgAfterRepair({ check: async () => ({ supported: true, interrupted: true, detail: 'x' }), clear, notify })).toBe('notified')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(await recheckDpkgAfterRepair({ check: async () => { throw new Error('boom') }, clear, notify })).toBe('error')
  })

  it('通知中心靠同一個 dedupKey 顯示「修復」按鈕', () => {
    expect(DPKG_INTERRUPTED_DEDUP_KEY).toBe(CLIENT_KEY)
    expect(buildDpkgNotice('d').title.length).toBeGreaterThan(0)
  })
})
