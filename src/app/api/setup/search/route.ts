import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getServerEnv } from '@/lib/server-env'
import { allowPlugins } from '@/lib/plugins/allowlist'
import { resolveSecretRef, isSecretRef } from '@/lib/openclaw/secret-ref'

const execFileAsync = promisify(execFile)
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

function readConfig(): Record<string, any> {
  if (!existsSync(OPENCLAW_CONFIG)) return {}
  return JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'))
}

function writeConfig(config: Record<string, any>) {
  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8')
}

/** GET — read current search config status */
export async function GET() {
  try {
    const config = readConfig()

    const tavilyEntry = config.plugins?.entries?.tavily
    // The key may be a SecretRef object rather than a string. A store-backed
    // ref means the key IS configured but is deliberately unreadable here, so
    // report it as configured without trying to mask an object.
    const rawTavilyKey = tavilyEntry?.config?.webSearch?.apiKey
    const tavilyApiKey = resolveSecretRef(rawTavilyKey).value ?? ''
    const tavilyKeyIsRef = isSecretRef(rawTavilyKey)
    const tavilyEnabled = tavilyEntry?.enabled ?? false

    const searchProvider = config.tools?.web?.search?.provider ?? ''
    const searchEnabled = config.tools?.web?.search?.enabled ?? false
    const fetchEnabled = config.tools?.web?.fetch?.enabled ?? false

    return NextResponse.json({
      // A store-backed ref is configured but unreadable here — say so
      // rather than masking an object into nonsense.
      tavilyApiKey: tavilyApiKey
        ? maskApiKey(tavilyApiKey)
        : tavilyKeyIsRef
          ? '(secret store)'
          : '',
      tavilyEnabled,
      searchProvider,
      searchEnabled,
      fetchEnabled,
      hasApiKey: !!tavilyApiKey || tavilyKeyIsRef,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — save tavily API key and enable search, then restart gateway */
export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json()
    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'API Key is required' }, { status: 400 })
    }

    const config = readConfig()

    // Ensure plugins structure
    if (!config.plugins) config.plugins = {}
    if (!config.plugins.entries) config.plugins.entries = {}

    // Permit tavily WITHOUT activating an inert allowlist — pushing onto an
    // empty `allow` would silently block Telegram and every other unlisted
    // plugin (see lib/plugins/allowlist.ts). tavily runs off its entry below.
    allowPlugins(config, ['tavily'])

    // Set tavily plugin entry
    config.plugins.entries.tavily = {
      enabled: true,
      config: {
        webSearch: {
          apiKey,
        },
      },
    }

    // Ensure tools structure
    if (!config.tools) config.tools = {}
    if (!config.tools.web) config.tools.web = {}

    // Enable web search with tavily provider
    config.tools.web.search = {
      enabled: true,
      provider: 'tavily',
    }

    // Enable web fetch
    config.tools.web.fetch = {
      enabled: true,
    }

    writeConfig(config)

    // Restart gateway
    let restartOutput = ''
    try {
      const result = await execFileAsync('openclaw', ['gateway', 'restart'], {
        timeout: 15000,
        encoding: 'utf-8',
        env: getServerEnv(),
      })
      restartOutput = result.stdout || result.stderr || ''
    } catch (err: any) {
      restartOutput = err.stderr || err.message || 'Gateway restart failed'
    }

    return NextResponse.json({ ok: true, restartOutput })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 12) return '***'
  return key.slice(0, 8) + '...' + key.slice(-4)
}
