/**
 * Server-side wrapper that invokes the python mem0 CLI shim
 * (deploy/mcp/openclaw-mem0/cli.py) via uv to perform list/search/add/delete.
 *
 * The MCP env vars (LLM provider + Qdrant + Ollama) are read from
 * openclaw.json#mcp.servers.openclaw-mem0.env so the CLI shim sees the same
 * config as the running MCP server.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getServerEnv } from '@/lib/server-env'

const execFileAsync = promisify(execFile)

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')
const MCP_DIR = resolve(process.cwd(), 'deploy', 'mcp', 'openclaw-mem0')
const UV_BIN = `${homedir()}/.local/bin/uv`

function readMcpEnv(): NodeJS.ProcessEnv {
  const base = getServerEnv()
  if (!existsSync(OPENCLAW_CONFIG)) return base
  try {
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>
    const entry = cfg?.mcp?.servers?.['openclaw-mem0'] ?? cfg?.mcpServers?.['openclaw-mem0']
    if (!entry?.env) return base
    return { ...base, ...(entry.env as Record<string, string>) }
  } catch {
    return base
  }
}

async function runCli(args: string[]): Promise<unknown> {
  if (!existsSync(MCP_DIR)) {
    throw new Error(`mem0 MCP source dir missing at ${MCP_DIR}`)
  }
  const fullArgs = ['run', '--directory', MCP_DIR, 'python', 'cli.py', ...args]
  const result = await execFileAsync(UV_BIN, fullArgs, {
    encoding: 'utf-8',
    timeout: 60000,
    env: readMcpEnv(),
  })
  const out = (result.stdout || '').trim()
  if (!out) throw new Error('cli returned empty output: ' + (result.stderr || ''))
  try {
    return JSON.parse(out)
  } catch (err) {
    throw new Error(`cli returned non-json: ${out.slice(0, 300)}`)
  }
}

export async function listMemories(userId: string, limit = 50) {
  return runCli(['list', '--user-id', userId, '--limit', String(limit)])
}

export async function searchMemories(userId: string, query: string, limit = 10) {
  return runCli(['search', '--user-id', userId, '--query', query, '--limit', String(limit)])
}

export async function addMemory(userId: string, content: string, metadata?: Record<string, unknown>) {
  const args = ['add', '--user-id', userId, '--content', content]
  if (metadata && Object.keys(metadata).length > 0) {
    args.push('--metadata', JSON.stringify(metadata))
  }
  return runCli(args)
}

export async function deleteMemory(memoryId: string) {
  return runCli(['delete', '--memory-id', memoryId])
}

export async function deleteAllMemories(userId: string) {
  return runCli(['delete-all', '--user-id', userId])
}
