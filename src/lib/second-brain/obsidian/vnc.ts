import { execFileSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'

const VNC_DIR = path.join(os.homedir(), '.vnc')
const PASSWD_FILE = path.join(VNC_DIR, 'passwd-obsidian')

export function setVncPassword(password: string): void {
  fs.mkdirSync(VNC_DIR, { recursive: true })

  if (!password) return

  execFileSync('x11vnc', ['-storepasswd', password, PASSWD_FILE], {
    timeout: 10000,
  })
}

export function hasVncPassword(): boolean {
  return fs.existsSync(PASSWD_FILE)
}
