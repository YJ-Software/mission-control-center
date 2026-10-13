import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  SECRET_MASK, redactSecrets, redactSecretValues, buildCurlAuthConfig, toPublicDestination,
  mergeDestinationConfig, PasswordRequiredError, redactStoredBackupLogErrors, collectDestinationCredentials,
  runBackupSecretsCleanup, BACKUP_SECRETS_CLEANUP_FLAG, type JobLogDeps,
} from '@/lib/backup/secrets'

// M7：FTP 密碼曾經從 `Command failed: /usr/bin/curl … --user 帳:密` 流進 backup_logs.error／job log／UI

describe('redactSecrets（只遮帳:密形狀，不做裸密碼替換）', () => {
  it('遮罩 --user 帳:密（execFile 的 Command failed 訊息）', () => {
    const msg = 'upload: Command failed: /usr/bin/curl -T /x.tar.gz ftp://1.2.3.4:21/b/ --user bob:s3cr#t --ftp-pasv\ncurl: (67) Access denied'
    const out = redactSecrets(msg)
    expect(out).not.toContain('s3cr#t')
    expect(out).not.toContain('bob:')
    expect(out).toContain('--user *** --ftp-pasv')
    expect(out).toContain('curl: (67) Access denied')
  })

  it('舊 argv 固定順序：帳號或密碼含空白也整段遮掉（到 --ftp-pasv／--connect-timeout 為止）', () => {
    expect(redactSecrets('curl ftp://h/ --user my user:pa ss --ftp-pasv --connect-timeout 30'))
      .toBe('curl ftp://h/ --user *** --ftp-pasv --connect-timeout 30')
    expect(redactSecrets('curl ftp://h/ --user bob:pa ss --connect-timeout 30 --max-time 600'))
      .toBe('curl ftp://h/ --user *** --connect-timeout 30 --max-time 600')
  })

  it('遮罩 -u 與 --user=、curl 設定檔語法 user = "帳:密"', () => {
    expect(redactSecrets('curl -u bob:pw1 x')).toBe('curl -u *** x')
    expect(redactSecrets('curl --user=bob:pw2 x')).toBe('curl --user=*** x')
    expect(redactSecrets('user = "bob:p w\\"3"\nnext')).toBe('user = ***\nnext')
    expect(redactSecrets('user=bob:pw4')).toBe('user=***')
  })

  it('不誤傷無害的 --user／-u／user=（systemctl、journalctl）', () => {
    const msg = 'systemctl --user restart openclaw-gateway failed; journalctl --user -u obsidian-headless.service; user = root'
    expect(redactSecrets(msg)).toBe(msg)
    expect(redactSecrets('journalctl -u openclaw-gateway: no entries')).toBe('journalctl -u openclaw-gateway: no entries')
    expect(redactSecrets('user=root: denied')).toBe('user=root: denied')
  })

  it('遮罩 URL 內嵌帳密 ftp://帳:密@主機', () => {
    expect(redactSecrets('ftp://bob:pw5@1.2.3.4/x')).toBe('ftp://***@1.2.3.4/x')
  })

  it('已知 帳:密 配對出現在任何位置都遮；裸密碼不遮（常見字密碼不誤傷路徑）', () => {
    const creds = [{ user: 'bob', password: 'backup' }]
    const keep = 'upload: x（本機備份檔已保留：/home/u/backup/mcc-backup_h_1.tar.gz）'
    expect(redactSecrets(keep, creds)).toBe(keep)
    expect(redactSecrets('530 for bob:backup here', creds)).toBe('530 for *** here')
  })

  it('含正規表示式特殊字元的配對也能比對；非字串密碼也比對', () => {
    expect(redactSecrets('bad u:a.b*c(d) here', [{ user: 'u', password: 'a.b*c(d)' }])).toBe('bad *** here')
    expect(redactSecrets('x u:123456 y', [{ user: 'u', password: 123456 }])).toBe('x *** y')
  })

  it('冪等：遮罩過的字串再遮罩一次不變', () => {
    const creds = [{ user: 'bob', password: 'pw' }]
    const once = redactSecrets('--user bob:pw --ftp-pasv --user=*** user = *** bob:pw', creds)
    expect(redactSecrets(once, creds)).toBe(once)
  })
})

describe('redactSecretValues（只用於當次 curl stderr）', () => {
  it('伺服器回顯的裸密碼也遮；短於 4 字元不遮', () => {
    expect(redactSecretValues('550 hunter22 not allowed; hunter22', [{ user: 'b', password: 'hunter22' }])).toBe('550 *** not allowed; ***')
    expect(redactSecretValues('exit 1', [{ user: 'b', password: '1' }, { password: '' }])).toBe('exit 1')
  })
})

describe('buildCurlAuthConfig', () => {
  it('雙引號字串並跳脫反斜線、引號、換行', () => {
    expect(buildCurlAuthConfig('bob', 'a"b\\c\nd')).toBe('user = "bob:a\\"b\\\\c\\nd"\n')
  })
  it('非字串值先轉字串，不丟錯', () => {
    expect(buildCurlAuthConfig('bob', 12345)).toBe('user = "bob:12345"\n')
    expect(buildCurlAuthConfig(undefined, null)).toBe('user = ":"\n')
  })
})

describe('toPublicDestination', () => {
  it('FTP 目的地：password 換成遮罩、hasPassword=true，其他欄位不動', () => {
    const row = { id: 'd', name: 'n', type: 'ftp', enabled: 1, config: JSON.stringify({ ip: '1.2.3.4', port: 21, user: 'bob', password: 'pw', mode: 'passive', path: '/b' }) }
    const pub = toPublicDestination(row)
    expect(pub.hasPassword).toBe(true)
    expect(JSON.stringify(pub)).not.toContain('"pw"')
    expect(JSON.parse(pub.config)).toEqual({ ip: '1.2.3.4', port: 21, user: 'bob', password: SECRET_MASK, mode: 'passive', path: '/b' })
  })

  it('非字串密碼（數字、物件）也遮罩並標 hasPassword', () => {
    for (const password of [12345, { k: 'v' }, ['a'], true]) {
      const pub = toPublicDestination({ id: 'n', type: 'ftp', config: JSON.stringify({ ip: 'h', password }) })
      expect(pub.hasPassword).toBe(true)
      expect(JSON.parse(pub.config).password).toBe(SECRET_MASK)
    }
  })

  it('沒有密碼的 FTP 與 local：hasPassword=false，config 原樣', () => {
    const ftp = toPublicDestination({ id: 'a', type: 'ftp', config: JSON.stringify({ ip: 'h', password: '' }) })
    expect(ftp.hasPassword).toBe(false)
    expect(JSON.parse(ftp.config).password).toBe('')
    const local = toPublicDestination({ id: 'b', type: 'local', config: JSON.stringify({ path: '~/backup' }) })
    expect(local.hasPassword).toBe(false)
    expect(JSON.parse(local.config)).toEqual({ path: '~/backup' })
  })

  it('config 壞掉時不丟錯也不回傳原字串', () => {
    const pub = toPublicDestination({ id: 'c', type: 'ftp', config: '{"password":"pw"' })
    expect(pub.config).toBe('{}')
    expect(pub.hasPassword).toBe(false)
  })
})

describe('mergeDestinationConfig', () => {
  const existing = JSON.stringify({ ip: 'h', port: 21, user: 'bob', password: 'old', mode: 'passive', path: '/a' })
  it('空字串、遮罩值、未帶 password 都沿用既有密碼（主機／帳號沒變）', () => {
    expect(mergeDestinationConfig(existing, { ip: 'h', port: 21, user: 'bob', password: '', mode: 'active', path: '/c' }))
      .toEqual({ ip: 'h', port: 21, user: 'bob', password: 'old', mode: 'active', path: '/c' })
    expect(mergeDestinationConfig(existing, { ip: 'h', user: 'bob', password: SECRET_MASK }).password).toBe('old')
    expect(mergeDestinationConfig(existing, { ip: 'h', user: 'bob' }).password).toBe('old')
    expect(mergeDestinationConfig(existing, { ip: 'h', port: '21', user: 'bob', password: '' }).password).toBe('old')
  })
  it('改了 ip／port／user 但密碼留空：要求重新輸入', () => {
    expect(() => mergeDestinationConfig(existing, { ip: 'h2', user: 'bob', password: '' })).toThrow(PasswordRequiredError)
    expect(() => mergeDestinationConfig(existing, { ip: 'h', port: 2121, user: 'bob' })).toThrow(PasswordRequiredError)
    expect(() => mergeDestinationConfig(existing, { ip: 'h', user: 'alice', password: SECRET_MASK })).toThrow(PasswordRequiredError)
  })
  it('改了 ip 且給了新密碼：照存', () => {
    expect(mergeDestinationConfig(existing, { ip: 'h2', user: 'bob', password: 'new' })).toEqual({ ip: 'h2', user: 'bob', password: 'new' })
  })
  it('既有密碼不是字串也照樣沿用', () => {
    expect(mergeDestinationConfig(JSON.stringify({ ip: 'h', password: 1234 }), { ip: 'h', password: '' }).password).toBe(1234)
  })
  it('改成 local（不含 FTP 欄位）時不把舊密碼帶過去', () => {
    expect(mergeDestinationConfig(existing, { path: '/x' }, 'local')).toEqual({ path: '/x' })
  })
  it('既有 config 不存在或壞掉：照新值（遮罩值不落地）', () => {
    expect(mergeDestinationConfig(undefined, { ip: 'h', password: SECRET_MASK })).toEqual({ ip: 'h' })
    expect(mergeDestinationConfig('{bad', { ip: 'h', password: '' })).toEqual({ ip: 'h', password: '' })
  })
})

// ---------------------------------------------------------------------------
// 啟動時一次性清理：DB ＋ backup-run job log
// ---------------------------------------------------------------------------

describe('runBackupSecretsCleanup（initDb 呼叫）', () => {
  let tmp: string
  let jobs: { id: string; kind: string }[]
  let deps: JobLogDeps
  let s: Database.Database
  const quiet = () => ({ log: vi.fn(), warn: vi.fn() })
  const logFile = (id: string) => path.join(tmp, `${id}.log`)
  const line = (text: string, stream = 'stderr') => JSON.stringify({ ts: '2026-10-01T00:00:00Z', stream, text, phaseIndex: 3 })

  function makeDb() {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE backup_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT);
    `)
    const dest = db.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES (?, ?, ?, ?)`)
    dest.run('f', 'ftp', 'ftp', JSON.stringify({ ip: '1.2.3.4', user: 'bob', password: 'Hunter 22' }))
    dest.run('b', 'ftp2', 'ftp', JSON.stringify({ ip: '5.6.7.8', user: 'eve', password: 'backup' }))
    dest.run('l', 'local', 'local', '{"path":"~/backup"}')
    dest.run('x', 'bad', 'ftp', '{oops')
    const ins = db.prepare(`INSERT INTO backup_logs (status, error) VALUES (?, ?)`)
    ins.run('failed', 'upload: Command failed: /usr/bin/curl -T /a.tar.gz ftp://1.2.3.4:21/b/ --user bob:Hunter 22 --ftp-pasv --connect-timeout 30 --max-time 600（本機備份檔已保留：/a.tar.gz）')
    ins.run('failed', 'upload: Command failed: /usr/bin/curl -T /h/backup/x.tar.gz ftp://5.6.7.8:21/b/ --user eve:backup --connect-timeout 30（本機備份檔已保留：/home/u/backup/mcc-backup_h_1.tar.gz）')
    ins.run('failed', 'upload: --user carol:gone-dest-pw --ftp-pasv')
    ins.run('completed', 'extra 資料夾「backup」備份失敗：/home/u/backup/x')
    ins.run('completed', null)
    return db
  }
  const errors = () => (s.prepare('SELECT error FROM backup_logs ORDER BY id').all() as { error: string | null }[]).map(r => r.error)
  const flag = () => s.prepare('SELECT value FROM settings WHERE key = ?').get(BACKUP_SECRETS_CLEANUP_FLAG)

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-secrets-cleanup-'))
    s = makeDb()
    jobs = [
      { id: 'leak', kind: 'backup-run' },
      { id: 'clean', kind: 'backup-run' },
      { id: 'other', kind: 'upgrade-mcc' },
      { id: 'nolog', kind: 'backup-run' },
    ]
    deps = { listJobs: () => jobs as ReturnType<JobLogDeps['listJobs']>, logPath: logFile }
    fs.writeFileSync(logFile('leak'), [
      line('phase upload', 'phase'),
      line('upload: Command failed: /usr/bin/curl -T /a ftp://1.2.3.4:21/b/ --user bob:Hunter 22 --ftp-pasv --connect-timeout 30'),
      line('本機備份檔已保留：/home/u/backup/a.tar.gz'),
      'not json --user eve:backup --connect-timeout 30',
      '',
    ].join('\n'), { mode: 0o600 })
    fs.writeFileSync(logFile('clean'), line('done /home/u/backup/x.tar.gz') + '\n')
    fs.writeFileSync(logFile('other'), line('--user bob:Hunter 22 --ftp-pasv') + '\n')
    const old = new Date('2020-01-01T00:00:00Z')
    for (const id of ['clean', 'other']) fs.utimesSync(logFile(id), old, old)
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('收集帳密：略過 local、壞掉的 config', () => {
    expect(collectDestinationCredentials(s)).toEqual([{ user: 'bob', password: 'Hunter 22' }, { user: 'eve', password: 'backup' }])
  })

  it('DB：遮罩含帳密的列；常見字密碼 backup 不改寫 /backup/ 路徑', () => {
    expect(redactStoredBackupLogErrors(s, collectDestinationCredentials(s))).toBe(3)
    const e = errors()
    expect(e.join('\n')).not.toContain('Hunter')
    expect(e.join('\n')).not.toContain('gone-dest-pw')
    expect(e.join('\n')).not.toContain('eve:backup')
    expect(e[0]).toBe('upload: Command failed: /usr/bin/curl -T /a.tar.gz ftp://1.2.3.4:21/b/ --user *** --ftp-pasv --connect-timeout 30 --max-time 600（本機備份檔已保留：/a.tar.gz）')
    expect(e[1]).toContain('-T /h/backup/x.tar.gz')
    expect(e[1]).toContain('/home/u/backup/mcc-backup_h_1.tar.gz')
    expect(e[3]).toBe('extra 資料夾「backup」備份失敗：/home/u/backup/x')
    expect(e[4]).toBeNull()
  })

  it('job log：只改寫命中的 backup-run 檔，JSON 仍有效、權限保留、無暫存檔殘留', () => {
    const cleanStat = fs.statSync(logFile('clean'))
    const otherBefore = fs.readFileSync(logFile('other'), 'utf8')
    runBackupSecretsCleanup(s, { jobLogs: deps, log: quiet() })
    const leak = fs.readFileSync(logFile('leak'), 'utf8')
    expect(leak).not.toContain('Hunter')
    expect(leak).not.toContain('eve:backup')
    expect(leak).toContain('/home/u/backup/a.tar.gz')
    const lines = leak.split('\n')
    expect(JSON.parse(lines[1])).toEqual({ ts: '2026-10-01T00:00:00Z', stream: 'stderr', text: 'upload: Command failed: /usr/bin/curl -T /a ftp://1.2.3.4:21/b/ --user *** --ftp-pasv --connect-timeout 30', phaseIndex: 3 })
    expect(lines[0]).toBe(line('phase upload', 'phase'))
    expect(lines[3]).toBe('not json --user *** --connect-timeout 30')
    expect(fs.statSync(logFile('leak')).mode & 0o777).toBe(0o600)
    // 沒命中：不改寫（inode 與 mtime 都不變）
    const cleanAfter = fs.statSync(logFile('clean'))
    expect(cleanAfter.ino).toBe(cleanStat.ino)
    expect(cleanAfter.mtimeMs).toBe(cleanStat.mtimeMs)
    // 非 backup-run 的 job 不碰
    expect(fs.readFileSync(logFile('other'), 'utf8')).toBe(otherBefore)
    expect(fs.readdirSync(tmp).filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(flag()).toBeTruthy()
  })

  it('冪等：旗標存在就整個跳過；清掉旗標重跑結果相同且不改寫任何檔', () => {
    const log = quiet()
    runBackupSecretsCleanup(s, { jobLogs: deps, log })
    expect(log.log).toHaveBeenCalledTimes(1)
    const dbAfter = errors()
    const leakStat = fs.statSync(logFile('leak'))
    const log2 = quiet()
    const list = vi.fn(deps.listJobs)
    runBackupSecretsCleanup(s, { jobLogs: { ...deps, listJobs: list }, log: log2 })
    expect(list).not.toHaveBeenCalled()
    s.prepare('DELETE FROM settings WHERE key = ?').run(BACKUP_SECRETS_CLEANUP_FLAG)
    runBackupSecretsCleanup(s, { jobLogs: deps, log: log2 })
    expect(log2.log).not.toHaveBeenCalled()
    expect(errors()).toEqual(dbAfter)
    expect(fs.statSync(logFile('leak')).ino).toBe(leakStat.ino)
    expect(flag()).toBeTruthy()
  })

  it('單一 log 失敗：其他檔照清、DB 照清、不記旗標、不丟錯', () => {
    jobs.unshift({ id: 'broken', kind: 'backup-run' })
    fs.mkdirSync(logFile('broken')) // 讀目錄 → EISDIR
    const log = quiet()
    expect(() => runBackupSecretsCleanup(s, { jobLogs: deps, log })).not.toThrow()
    expect(fs.readFileSync(logFile('leak'), 'utf8')).not.toContain('Hunter')
    expect(errors().join('\n')).not.toContain('Hunter')
    expect(flag()).toBeUndefined()
    expect(log.warn).toHaveBeenCalled()
  })

  it('job 清單讀不到或 DB 壞掉：只記 log，不丟錯、不記旗標', () => {
    const log = quiet()
    runBackupSecretsCleanup(s, { jobLogs: { ...deps, listJobs: () => { throw new Error('EACCES') } }, log })
    expect(log.warn).toHaveBeenCalled()
    expect(flag()).toBeUndefined()
    const broken = new Database(':memory:')
    expect(() => runBackupSecretsCleanup(broken, { jobLogs: deps, log })).not.toThrow()
  })
})
