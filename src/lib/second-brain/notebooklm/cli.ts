import { execFile } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import http from 'http'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const CDP_PORT = 9222
const COOKIES_URL = 'https://notebooklm.google.com'
const NLM_PROFILE_DIR = join(homedir(), '.notebooklm-mcp-cli', 'profiles', 'default')
const COOKIES_FILE = join(NLM_PROFILE_DIR, 'cookies.json')
const METADATA_FILE = join(NLM_PROFILE_DIR, 'metadata.json')

export { getServerEnv as getEnvWithPath }

/**
 * Sync cookies from the running Chrome CDP session to nlm's stored credentials.
 * Google rotates PSIDTS cookies every few minutes, so nlm's stored cookies
 * become stale quickly. This function fetches fresh cookies from Chrome
 * before each API call.
 */
export async function syncCookiesFromChrome(): Promise<boolean> {
  try {
    // 1. Get a page WS URL from Chrome CDP
    const pagesJson = await httpGet(`http://127.0.0.1:${CDP_PORT}/json`)
    const pages = JSON.parse(pagesJson)
    const nbPage = pages.find((p: any) =>
      p.type === 'page' && p.url?.includes('notebooklm.google.com'),
    )

    // Use any page if no NotebookLM page found
    const targetPage = nbPage || pages.find((p: any) => p.type === 'page')
    if (!targetPage?.webSocketDebuggerUrl) return false

    const wsUrl = targetPage.webSocketDebuggerUrl.replace('://localhost:', '://127.0.0.1:')

    // 2. Get cookies via CDP WebSocket
    const WebSocket = require('ws')
    const cookies = await new Promise<any[]>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 10000)

      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Network.getCookies',
          params: { urls: [COOKIES_URL] },
        }))
      })

      ws.on('message', (data: Buffer) => {
        clearTimeout(timeout)
        try {
          const msg = JSON.parse(data.toString())
          if (msg.id === 1) {
            ws.close()
            resolve(msg.result?.cookies || [])
          }
        } catch { /* ignore */ }
      })

      ws.on('error', (err: Error) => { clearTimeout(timeout); reject(err) })
    })

    if (cookies.length === 0) return false

    // 3. Convert CDP cookies to nlm format
    const nlmCookies = cookies.map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }))

    // 4. Write to nlm's cookies file
    mkdirSync(NLM_PROFILE_DIR, { recursive: true })
    writeFileSync(COOKIES_FILE, JSON.stringify(nlmCookies, null, 2), 'utf-8')

    // 5. Update metadata timestamp
    if (existsSync(METADATA_FILE)) {
      try {
        const meta = JSON.parse(readFileSync(METADATA_FILE, 'utf-8'))
        meta.last_validated = new Date().toISOString()
        writeFileSync(METADATA_FILE, JSON.stringify(meta, null, 2), 'utf-8')
      } catch { /* ignore */ }
    }

    return true
  } catch {
    return false
  }
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

export async function execNlm(
  args: string[],
  options?: { timeout?: number; skipSync?: boolean },
): Promise<{ stdout: string; stderr: string }> {
  // Auto-sync cookies before API-calling commands
  if (!options?.skipSync) {
    const isLoginOnly = args[0] === 'login' && !args.includes('--check')
    const needsSync = !isLoginOnly && !['--help', '--version', 'config'].some(k => args.includes(k))
    if (needsSync) {
      await syncCookiesFromChrome()
    }
  }

  return execFileAsync('nlm', args, {
    timeout: options?.timeout ?? 30000,
    env: getServerEnv(),
    encoding: 'utf-8',
  })
}

export async function execNlmJson<T = unknown>(args: string[], options?: { timeout?: number }): Promise<T> {
  const { stdout } = await execNlm([...args, '--json'], options)
  return JSON.parse(stdout)
}
