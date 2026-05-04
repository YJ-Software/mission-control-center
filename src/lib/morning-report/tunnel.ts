import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { createServer as createNetServer } from 'net'
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, chmodSync, writeFileSync } from 'fs'
import { join, extname } from 'path'
import { randomBytes } from 'crypto'
import os from 'os'

const ALLOWED_EXTENSIONS = new Set(['.html', '.mp3', '.opus', '.pdf'])

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.pdf': 'application/pdf',
}

let staticServer: HttpServer | null = null
let cloudflaredProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelPort: number | null = null
let tunnelToken: string | null = null

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        srv.close()
        reject(new Error('Cannot get port'))
        return
      }
      const port = addr.port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function createStaticFileServer(publicDir: string, token: string): HttpServer {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const urlObj = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const urlPath = decodeURIComponent(urlObj.pathname)

    // Token verification
    if (urlObj.searchParams.get('token') !== token) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Forbidden: invalid or missing token')
      return
    }

    const filePath = join(publicDir, urlPath)

    // Prevent directory traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // Directory: list only allowed file types
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      const files = readdirSync(filePath)
        .filter(f => ALLOWED_EXTENSIONS.has(extname(f).toLowerCase()))
        .sort((a, b) => b.localeCompare(a)) // newest first by filename
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Index of ${urlPath}</title>
        <style>body{font-family:monospace;padding:2em;background:#1a1a2e;color:#e0e0e0}
        a{color:#64b5f6;text-decoration:none}a:hover{text-decoration:underline}
        li{margin:0.3em 0}</style></head>
        <body><h1>Index of ${urlPath}</h1><ul>${files.map(f => `<li><a href="${urlPath}${urlPath.endsWith('/') ? '' : '/'}${f}?token=${token}">${f}</a></li>`).join('')}</ul></body></html>`
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    // File: check existence and allowed type
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const ext = extname(filePath).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.writeHead(403)
      res.end('Forbidden: file type not allowed')
      return
    }

    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
    const content = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  })
}

export async function startTunnel(publicDir: string): Promise<{ url: string; port: number; token: string }> {
  // Already running
  if (cloudflaredProcess && tunnelUrl && tunnelToken) {
    return { url: tunnelUrl, port: tunnelPort!, token: tunnelToken }
  }

  // Clean up any previous state
  stopTunnel()

  const port = await findFreePort()
  const token = randomBytes(16).toString('hex')

  // Start static file server
  const server = createStaticFileServer(publicDir, token)
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })
  staticServer = server
  tunnelPort = port
  tunnelToken = token

  // Start cloudflared
  const cfProcess = spawn(getCloudflaredPath(), [
    'tunnel', '--no-autoupdate', '--config', '/dev/null', '--url', `http://127.0.0.1:${port}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cloudflaredProcess = cfProcess

  // Parse URL from stderr
  const url = await new Promise<string>((resolve, reject) => {
    const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('Timeout waiting for cloudflared URL (30s)'))
      }
    }, 30000)

    const onData = (data: Buffer) => {
      if (resolved) return
      const text = data.toString()
      const match = text.match(urlRegex)
      if (match) {
        resolved = true
        clearTimeout(timeout)
        resolve(match[0])
      }
    }

    cfProcess.stderr?.on('data', onData)
    cfProcess.stdout?.on('data', onData)

    cfProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    cfProcess.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`cloudflared exited with code ${code}`))
      }
    })
  })

  tunnelUrl = url
  console.log(`[tunnel] Started: ${url} → localhost:${port} → ${publicDir}`)
  return { url, port, token }
}

export function stopTunnel(): void {
  if (cloudflaredProcess) {
    cloudflaredProcess.kill('SIGTERM')
    cloudflaredProcess = null
  }
  if (staticServer) {
    staticServer.close()
    staticServer = null
  }
  if (tunnelUrl) {
    console.log(`[tunnel] Stopped: ${tunnelUrl}`)
  }
  tunnelUrl = null
  tunnelPort = null
  tunnelToken = null
}

export function getTunnelStatus(): { active: boolean; url?: string; port?: number; token?: string } {
  if (cloudflaredProcess && tunnelUrl) {
    return { active: true, url: tunnelUrl, port: tunnelPort!, token: tunnelToken! }
  }
  return { active: false }
}

// --- cloudflared auto-install & SSE streaming tunnel start ---

function getCloudflaredPath(): string {
  const candidates = [
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
    join(os.homedir(), '.local', 'bin', 'cloudflared'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  try {
    return execFileSync('which', ['cloudflared'], { encoding: 'utf-8' }).trim()
  } catch {}
  return join(os.homedir(), '.local', 'bin', 'cloudflared')
}

function getArch(): string {
  const arch = os.arch()
  if (arch === 'x64' || arch === 'x86_64') return 'amd64'
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  return arch
}

async function installCloudflared(onLog: (msg: string) => void): Promise<string> {
  const arch = getArch()
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`
  const binDir = join(os.homedir(), '.local', 'bin')
  const binPath = join(binDir, 'cloudflared')

  onLog(`Downloading cloudflared (${arch})...`)

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true })
  }

  const res = await fetch(downloadUrl)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(binPath, buffer)
  chmodSync(binPath, 0o755)

  try {
    const version = execFileSync(binPath, ['--version'], { encoding: 'utf-8' }).trim()
    onLog(`Installed: ${version}`)
  } catch {
    onLog('Installed cloudflared')
  }

  return binPath
}

export function startTunnelStream(publicDir: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Ensure publicDir
        if (!existsSync(publicDir)) {
          send('log', { message: `Creating ${publicDir}` })
          mkdirSync(publicDir, { recursive: true })
        }

        // Check / install cloudflared
        let cfPath = getCloudflaredPath()
        if (!existsSync(cfPath)) {
          send('log', { message: 'cloudflared not found, installing...' })
          cfPath = await installCloudflared((msg) => send('log', { message: msg }))
        } else {
          send('log', { message: 'cloudflared ready' })
        }

        // Already running?
        if (cloudflaredProcess && tunnelUrl && tunnelToken) {
          send('log', { message: 'Tunnel already running' })
          send('done', { url: tunnelUrl, port: tunnelPort, token: tunnelToken })
          controller.close()
          return
        }

        stopTunnel()
        send('log', { message: 'Starting tunnel...' })

        const port = await findFreePort()
        const token = randomBytes(16).toString('hex')

        const server = createStaticFileServer(publicDir, token)
        await new Promise<void>((resolve) => server.listen(port, () => resolve()))
        staticServer = server
        tunnelPort = port
        tunnelToken = token

        send('log', { message: `Static server on port ${port}` })

        const cfProcess = spawn(cfPath, [
          'tunnel', '--no-autoupdate', '--config', '/dev/null', '--url', `http://127.0.0.1:${port}`,
        ], { stdio: ['ignore', 'pipe', 'pipe'] })
        cloudflaredProcess = cfProcess

        const url = await new Promise<string>((resolve, reject) => {
          const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
          let resolved = false

          const timeout = setTimeout(() => {
            if (!resolved) { resolved = true; reject(new Error('Timeout waiting for tunnel URL (30s)')) }
          }, 30000)

          const onData = (data: Buffer) => {
            if (resolved) return
            const text = data.toString()
            const match = text.match(urlRegex)
            if (match) {
              resolved = true
              clearTimeout(timeout)
              resolve(match[0])
            }
          }

          cfProcess.stderr?.on('data', onData)
          cfProcess.stdout?.on('data', onData)
          cfProcess.on('error', (err) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(err) } })
          cfProcess.on('exit', (code) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`cloudflared exited with code ${code}`)) } })
        })

        tunnelUrl = url
        console.log(`[tunnel] Started: ${url} → localhost:${port} → ${publicDir}`)
        send('done', { url, port, token })
      } catch (err: any) {
        send('error', { message: err.message ?? String(err) })
      } finally {
        controller.close()
      }
    },
  })
}
