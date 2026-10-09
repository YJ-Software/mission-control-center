import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 備份檔內含 MCC 登入密碼與 OpenClaw 憑證，FTP 明文傳輸：兩個 FTP 表單都必須顯示警告，三種語系都要有字串
const root = path.resolve(__dirname, '../..')
const KEY = 'ftpInsecureWarning'

describe('FTP 目的地明文警告', () => {
  it.each(['zh-TW', 'zh-CN', 'en'])('%s 有 backup.destinations.ftpInsecureWarning', (locale) => {
    const msgs = JSON.parse(fs.readFileSync(path.join(root, 'messages', `${locale}.json`), 'utf8'))
    const v = msgs.backup.destinations[KEY]
    expect(typeof v).toBe('string')
    expect(v.length).toBeGreaterThan(10)
    expect(v).toMatch(/MCC/)
    expect(v).toMatch(/OpenClaw/)
  })
  it.each(['backup-destinations.tsx', 'backup-wizard.tsx'])('%s 的 FTP 表單顯示警告', (file) => {
    const src = fs.readFileSync(path.join(root, 'src/components/backup', file), 'utf8')
    expect(src).toContain(`destinations.${KEY}`)
  })
})
