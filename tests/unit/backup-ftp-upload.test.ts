import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uploadToFtp } from '@/lib/backup/scripts'

// 假的 curl：記下 argv 與 stdin，依 FAKE_CURL_EXIT 決定結束碼並在 stderr 印出 FAKE_CURL_STDERR
let tmp: string
let fakeCurl: string
const cfg = { ip: '10.0.0.9', port: 2121, user: 'bob', password: 'Pa ss"w\\rd-XYZ', mode: 'passive', path: '/bk' }

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-ftp-upload-'))
  fakeCurl = path.join(tmp, 'curl')
  fs.writeFileSync(fakeCurl, `#!/bin/bash
printf '%s\\n' "$@" > "${tmp}/argv"
cat > "${tmp}/stdin"
if [ -n "$FAKE_CURL_STDERR" ]; then printf '%s\\n' "$FAKE_CURL_STDERR" >&2; fi
exit "\${FAKE_CURL_EXIT:-0}"
`, { mode: 0o755 })
})
afterEach(() => {
  delete process.env.FAKE_CURL_EXIT
  delete process.env.FAKE_CURL_STDERR
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('uploadToFtp（M7：帳密不進 argv）', () => {
  it('argv 不含密碼與帳號；帳密以 curl 設定語法從 stdin 送入', async () => {
    const file = path.join(tmp, 'a.tar.gz'); fs.writeFileSync(file, 'x')
    await uploadToFtp(file, cfg, { curlBin: fakeCurl })
    const argv = fs.readFileSync(path.join(tmp, 'argv'), 'utf8').split('\n').filter(Boolean)
    expect(argv.join(' ')).not.toContain('XYZ')
    expect(argv).not.toContain('--user')
    expect(argv).not.toContain('-u')
    expect(argv.slice(0, 2)).toEqual(['-K', '-'])
    expect(argv).toContain('-T')
    expect(argv).toContain(file)
    expect(argv).toContain('ftp://10.0.0.9:2121/bk/')
    expect(argv).toContain('--ftp-pasv')
    expect(fs.readFileSync(path.join(tmp, 'stdin'), 'utf8')).toBe('user = "bob:Pa ss\\"w\\\\rd-XYZ"\n')
  })

  it('active 模式不加 --ftp-pasv', async () => {
    const file = path.join(tmp, 'a.tar.gz'); fs.writeFileSync(file, 'x')
    await uploadToFtp(file, { ...cfg, mode: 'active' }, { curlBin: fakeCurl })
    const argv = fs.readFileSync(path.join(tmp, 'argv'), 'utf8').split('\n')
    expect(argv).not.toContain('--ftp-pasv')
  })

  it('失敗時錯誤訊息含結束碼與 stderr，但不含密碼、不含命令列', async () => {
    const file = path.join(tmp, 'a.tar.gz'); fs.writeFileSync(file, 'x')
    process.env.FAKE_CURL_EXIT = '67'
    process.env.FAKE_CURL_STDERR = `curl: (67) Access denied: 530 for user bob pass ${cfg.password}`
    const err = await uploadToFtp(file, cfg, { curlBin: fakeCurl }).then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('67')
    expect(err!.message).toContain('Access denied')
    expect(err!.message).not.toContain('XYZ')
    expect(err!.message).not.toContain('Command failed')
    expect(err!.message).not.toContain(fakeCurl)
  })

  it('curl 執行檔不存在時丟出明確錯誤（不洩漏 argv）', async () => {
    const err = await uploadToFtp(path.join(tmp, 'a'), cfg, { curlBin: path.join(tmp, 'nope') }).then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('curl')
    expect(err!.message).not.toContain('XYZ')
  })
})
