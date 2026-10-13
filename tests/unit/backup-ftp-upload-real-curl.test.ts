import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { uploadToFtp } from '@/lib/backup/scripts'

// 用真實 /usr/bin/curl 對本機假 FTP 伺服器上傳：鎖住 `curl -K -` 的引號契約與成功／失敗路徑。
// 只在本機 loopback 監聽，不碰任何外部環境；沒有 curl 的機器跳過。
const HAS_CURL = fs.existsSync('/usr/bin/curl')

interface Session { user?: string; pass?: string; cwd: string[]; stored?: { name: string; data: Buffer } }

function startFakeFtp(opts: { acceptLogin: boolean }) {
  const sessions: Session[] = []
  const server = net.createServer((sock) => {
    const sess: Session = { cwd: [] }
    sessions.push(sess)
    let data: net.Server | null = null
    let dataSock: Promise<net.Socket> | null = null
    let buf = ''
    sock.on('error', () => {})
    sock.write('220 fake\r\n')
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const lineStr = buf.slice(0, i); buf = buf.slice(i + 2)
        const sp = lineStr.indexOf(' ')
        const cmd = (sp < 0 ? lineStr : lineStr.slice(0, sp)).toUpperCase()
        const arg = sp < 0 ? '' : lineStr.slice(sp + 1)
        if (cmd === 'USER') { sess.user = arg; sock.write('331 pw\r\n') }
        else if (cmd === 'PASS') { sess.pass = arg; sock.write(opts.acceptLogin ? '230 ok\r\n' : '530 Login incorrect\r\n') }
        else if (cmd === 'PWD') sock.write('257 "/"\r\n')
        else if (cmd === 'CWD') { sess.cwd.push(arg); sock.write('250 ok\r\n') }
        else if (cmd === 'TYPE') sock.write('200 ok\r\n')
        else if (cmd === 'EPSV') {
          data = net.createServer()
          dataSock = new Promise((res) => data!.once('connection', res))
          data.listen(0, '127.0.0.1', () => {
            sock.write(`229 Entering Extended Passive Mode (|||${(data!.address() as net.AddressInfo).port}|)\r\n`)
          })
        } else if (cmd === 'STOR') {
          sock.write('150 go\r\n')
          void dataSock!.then((ds) => {
            const chunks: Buffer[] = []
            ds.on('data', (c) => chunks.push(c))
            ds.on('end', () => {
              sess.stored = { name: arg, data: Buffer.concat(chunks) }
              sock.write('226 done\r\n')
              data?.close()
            })
          })
        } else if (cmd === 'QUIT') { sock.end('221 bye\r\n') }
        else sock.write('502 nope\r\n')
      }
    })
  })
  const ready = new Promise<number>((res) => server.listen(0, '127.0.0.1', () => res((server.address() as net.AddressInfo).port)))
  return { sessions, ready, close: () => new Promise<void>((res) => server.close(() => res())) }
}

let tmp: string
let file: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-ftp-real-'))
  file = path.join(tmp, 'mcc-backup_test.tar.gz')
  fs.writeFileSync(file, 'payload-123')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe.skipIf(!HAS_CURL)('uploadToFtp × 真實 curl × 假 FTP 伺服器', () => {
  const tricky: Array<[string, string]> = [
    ['bob', 'Pa ss"w\\rd:x\ty'],
    ['bob', 'a\\b\\\\c"'],
    ['bob', ' lead and trail '],
    ['bob', '#hash ;semi =eq \'sq\''],
    ['us er', '中文密碼'],
  ]

  it('成功上傳：伺服器收到的帳密逐字相同、檔案內容正確', async () => {
    for (const [user, password] of tricky) {
      const ftp = startFakeFtp({ acceptLogin: true })
      const port = await ftp.ready
      try {
        await uploadToFtp(file, { ip: '127.0.0.1', port, user, password, mode: 'passive', path: '/bk' })
        const s = ftp.sessions[0]
        expect(s.user).toBe(user)
        expect(s.pass).toBe(password)
        expect(s.cwd).toEqual(['bk'])
        expect(s.stored?.name).toBe('mcc-backup_test.tar.gz')
        expect(s.stored?.data.toString()).toBe('payload-123')
      } finally {
        await ftp.close()
      }
    }
  }, 30_000)

  it('登入失敗：錯誤訊息有結束碼與伺服器回應，沒有密碼', async () => {
    const ftp = startFakeFtp({ acceptLogin: false })
    const port = await ftp.ready
    try {
      const password = 'Real-Curl-Secret-77'
      const err = await uploadToFtp(file, { ip: '127.0.0.1', port, user: 'bob', password, mode: 'passive', path: '/bk' })
        .then(() => null, (e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err!.message).toMatch(/FTP 上傳失敗（curl 結束碼 67）/)
      expect(err!.message).not.toContain(password)
      expect(ftp.sessions[0].pass).toBe(password)
    } finally {
      await ftp.close()
    }
  }, 30_000)
})
