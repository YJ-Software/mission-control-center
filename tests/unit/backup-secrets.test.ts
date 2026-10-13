import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  SECRET_MASK, redactSecrets, buildCurlAuthConfig, toPublicDestination,
  mergeDestinationConfig, redactStoredBackupLogErrors, BACKUP_LOG_REDACTION_FLAG,
} from '@/lib/backup/secrets'

// M7：FTP 密碼曾經從 `Command failed: /usr/bin/curl … --user 帳:密` 流進 backup_logs.error／job log／UI

describe('redactSecrets', () => {
  it('遮罩 --user 帳:密（execFile 的 Command failed 訊息）', () => {
    const msg = 'upload: Command failed: /usr/bin/curl -T /x.tar.gz ftp://1.2.3.4:21/b/ --user bob:s3cr#t --ftp-pasv\ncurl: (67) Access denied'
    const out = redactSecrets(msg)
    expect(out).not.toContain('s3cr#t')
    expect(out).not.toContain('bob:')
    expect(out).toContain('--user ***')
    expect(out).toContain('curl: (67) Access denied')
  })

  it('遮罩 -u 與 --user=、curl 設定檔語法 user = "帳:密"', () => {
    expect(redactSecrets('curl -u bob:pw1 x')).toBe('curl -u *** x')
    expect(redactSecrets('curl --user=bob:pw2 x')).toBe('curl --user=*** x')
    expect(redactSecrets('user = "bob:p w\\"3"\nnext')).toBe('user = ***\nnext')
    expect(redactSecrets('user=bob:pw4')).toBe('user=***')
  })

  it('不誤傷無害的 --user／-u（systemctl、journalctl）', () => {
    const msg = 'systemctl --user restart openclaw-gateway failed; journalctl --user -u obsidian-headless.service; user = root'
    expect(redactSecrets(msg)).toBe(msg)
  })

  it('遮罩 URL 內嵌帳密 ftp://帳:密@主機', () => {
    expect(redactSecrets('ftp://bob:pw5@1.2.3.4/x')).toBe('ftp://***@1.2.3.4/x')
  })

  it('已知密碼本文出現在任何位置都換成 ***；空字串與短到會誤傷的值不處理', () => {
    expect(redactSecrets('550 hunter22 not allowed; hunter22', ['hunter22'])).toBe('550 *** not allowed; ***')
    expect(redactSecrets('exit 1', ['', '1'])).toBe('exit 1')
  })

  it('含正規表示式特殊字元的密碼也能比對', () => {
    expect(redactSecrets('bad a.b*c(d) here', ['a.b*c(d)'])).toBe('bad *** here')
  })

  it('冪等：遮罩過的字串再遮罩一次不變', () => {
    const once = redactSecrets('--user bob:pw --user=*** user = ***', ['pw'])
    expect(redactSecrets(once, ['pw'])).toBe(once)
  })
})

describe('buildCurlAuthConfig', () => {
  it('雙引號字串並跳脫反斜線、引號、換行', () => {
    expect(buildCurlAuthConfig('bob', 'a"b\\c\nd')).toBe('user = "bob:a\\"b\\\\c\\nd"\n')
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
  const existing = JSON.stringify({ ip: 'h', user: 'bob', password: 'old' })
  it('空字串、遮罩值、未帶 password 都沿用既有密碼', () => {
    expect(mergeDestinationConfig(existing, { ip: 'h2', user: 'bob', password: '' })).toEqual({ ip: 'h2', user: 'bob', password: 'old' })
    expect(mergeDestinationConfig(existing, { ip: 'h', user: 'bob', password: SECRET_MASK })).toEqual({ ip: 'h', user: 'bob', password: 'old' })
    expect(mergeDestinationConfig(existing, { ip: 'h', user: 'bob' })).toEqual({ ip: 'h', user: 'bob', password: 'old' })
  })
  it('新密碼覆蓋', () => {
    expect(mergeDestinationConfig(existing, { ip: 'h', password: 'new' }).password).toBe('new')
  })
  it('改成 local（不含 FTP 欄位）時不把舊密碼帶過去', () => {
    expect(mergeDestinationConfig(existing, { path: '/x' }, 'local')).toEqual({ path: '/x' })
  })
  it('既有 config 不存在或壞掉：照新值（遮罩值不落地）', () => {
    expect(mergeDestinationConfig(undefined, { ip: 'h', password: SECRET_MASK })).toEqual({ ip: 'h' })
    expect(mergeDestinationConfig('{bad', { ip: 'h', password: '' })).toEqual({ ip: 'h', password: '' })
  })
})

describe('redactStoredBackupLogErrors（initDb 一次性清理）', () => {
  function makeDb() {
    const s = new Database(':memory:')
    s.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE backup_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE backup_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT);
    `)
    s.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES ('f', 'ftp', 'ftp', ?)`)
      .run(JSON.stringify({ ip: '1.2.3.4', user: 'bob', password: 'Hunter-22' }))
    s.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES ('l', 'local', 'local', '{"path":"~/backup"}')`).run()
    s.prepare(`INSERT INTO backup_destinations (id, name, type, config) VALUES ('x', 'bad', 'ftp', '{oops')`).run()
    const ins = s.prepare(`INSERT INTO backup_logs (status, error) VALUES (?, ?)`)
    ins.run('failed', 'upload: Command failed: /usr/bin/curl -T /a.tar.gz ftp://1.2.3.4:21/b/ --user bob:Hunter-22 --ftp-pasv（本機備份檔已保留：/a.tar.gz）')
    ins.run('failed', 'upload: 530 Login incorrect for Hunter-22')
    ins.run('failed', 'upload: --user carol:gone-dest-pw something')
    ins.run('completed', 'file changed')
    ins.run('completed', null)
    return s
  }
  const errors = (s: Database.Database) =>
    (s.prepare('SELECT error FROM backup_logs ORDER BY id').all() as { error: string | null }[]).map(r => r.error)

  it('遮罩含密碼的列、其他列不動，並記旗標', () => {
    const s = makeDb()
    const n = redactStoredBackupLogErrors(s)
    expect(n).toBe(3)
    const e = errors(s)
    expect(e.join('\n')).not.toContain('Hunter-22')
    expect(e.join('\n')).not.toContain('gone-dest-pw')
    expect(e[0]).toContain('--user ***')
    expect(e[0]).toContain('本機備份檔已保留：/a.tar.gz')
    expect(e[1]).toBe('upload: 530 Login incorrect for ***')
    expect(e[3]).toBe('file changed')
    expect(e[4]).toBeNull()
    const flag = s.prepare('SELECT value FROM settings WHERE key = ?').get(BACKUP_LOG_REDACTION_FLAG) as { value: string } | undefined
    expect(flag).toBeTruthy()
  })

  it('冪等：第二次呼叫不改任何列（旗標已設）；手動清掉旗標再跑結果也相同', () => {
    const s = makeDb()
    redactStoredBackupLogErrors(s)
    const after1 = errors(s)
    expect(redactStoredBackupLogErrors(s)).toBe(0)
    expect(errors(s)).toEqual(after1)
    s.prepare('DELETE FROM settings WHERE key = ?').run(BACKUP_LOG_REDACTION_FLAG)
    expect(redactStoredBackupLogErrors(s)).toBe(0)
    expect(errors(s)).toEqual(after1)
  })
})
