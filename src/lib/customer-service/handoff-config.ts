/**
 * Manages the openclaw-handoff MCP server's runtime config.
 *
 * The MCP server (deploy/mcp/openclaw-handoff/server.py) reads its
 * destinations from env vars, declared in ~/.openclaw/openclaw.json under
 *   mcp.servers.openclaw-handoff.env
 *
 * This module is the only place that writes to that env block from the
 * dashboard. After a write, callers should restart openclaw so the MCP
 * server picks the new env up.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const HANDOFF_SERVER_KEY = 'openclaw-handoff'

export interface HandoffConfig {
  telegram: {
    botToken: string
    chatId: string
  }
  email: {
    apiKey: string
    inboxId: string
    to: string
  }
}

export interface HandoffStatus {
  installed: boolean
  config: HandoffConfig
  emailReady: boolean
  telegramReady: boolean
}

const EMPTY: HandoffConfig = {
  telegram: { botToken: '', chatId: '' },
  email: { apiKey: '', inboxId: '', to: '' },
}

function readConfig(): Record<string, any> {
  if (!existsSync(OPENCLAW_CONFIG)) return {}
  return JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
}

function writeConfig(cfg: Record<string, any>): void {
  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
}

function readEnv(): Record<string, string> {
  const cfg = readConfig()
  const env = cfg?.mcp?.servers?.[HANDOFF_SERVER_KEY]?.env
  return env && typeof env === 'object' ? (env as Record<string, string>) : {}
}

export function getStatus(): HandoffStatus {
  const cfg = readConfig()
  const installed = Boolean(cfg?.mcp?.servers?.[HANDOFF_SERVER_KEY])
  const env = readEnv()
  const config: HandoffConfig = {
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: env.TELEGRAM_CHAT_ID ?? '',
    },
    email: {
      apiKey: env.AGENTMAIL_API_KEY ?? '',
      inboxId: env.AGENTMAIL_INBOX_ID ?? '',
      to: env.HANDOFF_EMAIL_TO ?? '',
    },
  }
  return {
    installed,
    config,
    telegramReady: Boolean(config.telegram.botToken && config.telegram.chatId),
    emailReady: Boolean(config.email.apiKey && config.email.inboxId && config.email.to),
  }
}

function sanitize(input: any): HandoffConfig {
  const t = input?.telegram ?? {}
  const e = input?.email ?? {}
  const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
  return {
    telegram: { botToken: str(t.botToken), chatId: str(t.chatId) },
    email: { apiKey: str(e.apiKey), inboxId: str(e.inboxId), to: str(e.to) },
  }
}

export function saveConfig(input: HandoffConfig): HandoffConfig {
  const next = sanitize(input ?? EMPTY)
  const cfg = readConfig()
  if (!cfg.mcp) cfg.mcp = {}
  if (!cfg.mcp.servers) cfg.mcp.servers = {}
  const server = cfg.mcp.servers[HANDOFF_SERVER_KEY]
  if (!server || typeof server !== 'object') {
    throw new Error(
      `MCP server "${HANDOFF_SERVER_KEY}" is not registered in ${OPENCLAW_CONFIG}. ` +
        `Run the openclaw-line-cs-agent skill or register the server first.`,
    )
  }
  const env = (server.env && typeof server.env === 'object' ? server.env : {}) as Record<string, string>

  // Empty string from the form means "unset" — drop the key entirely so the
  // MCP server's missing-env detection works (it returns ok=false instead of
  // hitting an API with empty creds).
  const apply = (key: string, val: string) => {
    if (val) env[key] = val
    else delete env[key]
  }
  apply('TELEGRAM_BOT_TOKEN', next.telegram.botToken)
  apply('TELEGRAM_CHAT_ID', next.telegram.chatId)
  apply('AGENTMAIL_API_KEY', next.email.apiKey)
  apply('AGENTMAIL_INBOX_ID', next.email.inboxId)
  apply('HANDOFF_EMAIL_TO', next.email.to)

  server.env = env
  cfg.mcp.servers[HANDOFF_SERVER_KEY] = server
  writeConfig(cfg)
  return next
}

export async function restartGateway(): Promise<string> {
  try {
    const r = await execFileAsync('openclaw', ['gateway', 'restart'], {
      timeout: 60000,
      env: getServerEnv(),
    })
    return (r.stdout || '') + (r.stderr || '')
  } catch (err: any) {
    return err?.stderr ?? err?.message ?? 'gateway restart failed'
  }
}
