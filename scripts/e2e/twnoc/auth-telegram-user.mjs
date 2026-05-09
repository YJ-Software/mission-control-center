#!/usr/bin/env node
import input from 'input'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('>>>') || t.startsWith('<<<')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

const env = loadEnv(resolve(process.cwd(), '.env.e2e.local'))
if (!env.TG_API_ID || !env.TG_API_HASH) {
  console.error('Set TG_API_ID and TG_API_HASH in .env.e2e.local first (from my.telegram.org)')
  process.exit(2)
}

const client = new TelegramClient(new StringSession(''), Number(env.TG_API_ID), env.TG_API_HASH, {
  connectionRetries: 5,
})

await client.start({
  phoneNumber:    async () => await input.text('Phone (with country code, e.g. +886912345678): '),
  password:       async () => await input.text('2FA password (blank if none): '),
  phoneCode:      async () => await input.text('Code from Telegram (or SMS): '),
  onError: err => console.error('Telegram auth error:', err),
})

const sessionString = client.session.save()
console.log('\n────────────────────────────────────────')
console.log('Paste this into .env.e2e.local as TG_USER_SESSION:')
console.log(sessionString)
console.log('────────────────────────────────────────\n')
await client.disconnect()
