import { execFile } from 'child_process'
import { promisify } from 'node:util'
import { logTempRootFailureHint, tightenOpenclawTempRoots } from './temp-root-perms'

const execFileAsync = promisify(execFile)

/** Setup and configuration actions use the CLI to restart the managed gateway. */
export async function restartOpenclawGateway(options: { timeout: number; env?: NodeJS.ProcessEnv }) {
  const log = (text: string) => console.log(`[OpenClawRestart] ${text}`)
  tightenOpenclawTempRoots(log, options.env)
  const since = Date.now()
  try {
    return await execFileAsync('openclaw', ['gateway', 'restart'], { ...options, encoding: 'utf8' })
  } catch (err) {
    await logTempRootFailureHint('openclaw-gateway.service', true, since, log, options.env)
    throw err
  }
}
