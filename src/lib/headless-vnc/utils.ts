// src/lib/headless-vnc/utils.ts
import os from 'os'
import { randomBytes } from 'crypto'

export function resolveHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', os.homedir())
  }
  return p
}

export function generatePassword(length = 16): string {
  return randomBytes(length).toString('base64url').slice(0, length)
}
