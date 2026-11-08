import { execFile } from 'child_process'
import { promisify } from 'util'
import { getServerEnv } from '@/lib/server-env'
import { OPENCLAW_WRITE_TIMEOUT_MS } from '@/lib/openclaw/models-config'

const execFileAsync = promisify(execFile)

/** 以可線上套用的 config set 取代需要 gateway 停機的 mcp set，保留完整 server 設定。 */
export async function writeMem0McpConfig(value: Record<string, unknown>): Promise<string> {
  const out = await execFileAsync(
    'openclaw',
    ['config', 'set', 'mcp.servers.openclaw-mem0', JSON.stringify(value), '--strict-json'],
    { timeout: OPENCLAW_WRITE_TIMEOUT_MS, env: getServerEnv() },
  )
  return (out.stdout || '') + (out.stderr || '')
}
