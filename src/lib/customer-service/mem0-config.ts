import { execFile } from 'child_process'
import { promisify } from 'util'
import { getServerEnv } from '@/lib/server-env'
import { OPENCLAW_WRITE_TIMEOUT_MS } from '@/lib/openclaw/models-config'
import { gatewayConfigPatchWithFallback } from '@/lib/openclaw/rpc-fallback'
import { withOpenclawCli } from '@/lib/openclaw/cli-limiter'

const execFileAsync = promisify(execFile)

/** 以可線上套用的 config set 取代需要 gateway 停機的 mcp set，保留完整 server 設定。 */
export async function writeMem0McpConfig(value: Record<string, unknown>): Promise<string> {
  return gatewayConfigPatchWithFallback('mcp.servers.openclaw-mem0', value,
    () => writeMem0McpConfigCli(value), '', (err) => {
      const message = err instanceof Error ? err.message : String(err)
      // 呼叫端沿用 execFile 的 stderr / message 契約，不在錯誤中附帶設定值（可能含 API key）。
      throw Object.assign(new Error(`config set mcp.servers.openclaw-mem0 failed: ${message}`), {
        code: 1, stdout: '', stderr: message,
      })
    })
}

async function writeMem0McpConfigCli(value: Record<string, unknown>): Promise<string> {
  const out = await withOpenclawCli(() => execFileAsync(
    'openclaw',
    ['config', 'set', 'mcp.servers.openclaw-mem0', JSON.stringify(value), '--strict-json'],
    { timeout: OPENCLAW_WRITE_TIMEOUT_MS, env: getServerEnv() },
  ))
  return (out.stdout || '') + (out.stderr || '')
}
