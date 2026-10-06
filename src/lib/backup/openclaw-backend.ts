import { join } from 'node:path'
import type * as NodeFs from 'node:fs'
import { runOpenclaw } from '@/lib/openclaw/models-config'
import { planCarryOver } from './restore-plan'

export interface OpenClawBackendDeps {
  run(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>
  fs: Pick<
    typeof NodeFs,
    'existsSync' | 'readdirSync' | 'renameSync' | 'rmSync' | 'cpSync' | 'mkdirSync' | 'mkdtempSync'
  >
  home: string
  gateway: { stop(): Promise<void>; start(): Promise<void>; waitHealthy(timeoutMs: number): Promise<boolean> }
  now(): Date
  log(stream: 'stdout' | 'stderr' | 'system', text: string): void
}

const CREATE_TIMEOUT_MS = 600_000
const VERIFY_TIMEOUT_MS = 300_000
const RESTORE_TIMEOUT_MS = 600_000
const HEALTH_TIMEOUT_MS = 120_000

function tail(s: string, n = 300): string {
  return s.length > n ? s.slice(-n) : s
}

/** stdout 前面可能有非 JSON 的雜訊行：取第一個 '{' 到最後一個 '}'。 */
function parseJson(stdout: string, what: string, stderr: string): Record<string, unknown> {
  const a = stdout.indexOf('{')
  const b = stdout.lastIndexOf('}')
  if (a < 0 || b < a) {
    throw new Error(`${what}: no JSON in output (${tail(stdout, 120)}) ${tail(stderr)}`)
  }
  try {
    return JSON.parse(stdout.slice(a, b + 1)) as Record<string, unknown>
  } catch (e) {
    throw new Error(`${what}: invalid JSON (${(e as Error).message}) ${tail(stderr)}`)
  }
}

export function defaultOpenClawBackendRun(args: string[], timeoutMs: number) {
  return runOpenclaw(args, timeoutMs)
}

export async function verifyOpenClawBackup(
  archivePath: string,
  deps: Pick<OpenClawBackendDeps, 'run' | 'log'>,
): Promise<{ runtimeVersion: string | null }> {
  const r = await deps.run(['backup', 'verify', archivePath, '--json'], VERIFY_TIMEOUT_MS)
  if (r.code !== 0) throw new Error(`openclaw backup verify failed (exit ${r.code}): ${tail(r.stderr)}`)
  const j = parseJson(r.stdout, 'openclaw backup verify', r.stderr)
  if (j.ok !== true) throw new Error(`openclaw backup verify reported not ok: ${tail(r.stderr)}`)
  return { runtimeVersion: typeof j.runtimeVersion === 'string' ? j.runtimeVersion : null }
}

export async function createOpenClawBackup(
  outDir: string,
  deps: OpenClawBackendDeps,
): Promise<{ archivePath: string; version: string | null; warnings: string[] }> {
  const r = await deps.run(['backup', 'create', '--output', outDir, '--verify', '--json'], CREATE_TIMEOUT_MS)
  if (r.code !== 0) throw new Error(`openclaw backup create failed (exit ${r.code}): ${tail(r.stderr)}`)
  const j = parseJson(r.stdout, 'openclaw backup create', r.stderr)
  if (j.verified !== true) throw new Error(`openclaw backup create: archive not verified: ${tail(r.stderr)}`)
  if (typeof j.archivePath !== 'string' || !j.archivePath) {
    throw new Error('openclaw backup create: no archivePath in output')
  }
  const warnings = Array.isArray(j.warnings) ? j.warnings.filter((w): w is string => typeof w === 'string') : []
  for (const w of warnings) deps.log('system', w)
  // 未驗證的備份不可當成好的：verify 失敗就拋錯
  const v = await verifyOpenClawBackup(j.archivePath, deps)
  return { archivePath: j.archivePath, version: v.runtimeVersion, warnings }
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

export async function restoreOpenClawBackup(
  archivePath: string,
  deps: OpenClawBackendDeps,
): Promise<{ preRestoreDir: string }> {
  const { fs, home, gateway, log } = deps
  const ts = stamp(deps.now())
  const liveDir = join(home, '.openclaw')
  const preDir = join(home, `.openclaw.pre-restore-${ts}`)
  const failedDir = join(home, `.openclaw.failed-restore-${ts}`)
  const liveSkills = join(home, '.agents', 'skills')

  // 1. staging（放在 home 底下，確保與 live 同一個檔案系統，rename 不會 EXDEV）
  const staging = fs.mkdtempSync(join(home, '.openclaw-restore-staging-'))
  const cleanStaging = () => {
    try {
      fs.rmSync(staging, { recursive: true, force: true })
    } catch (e) {
      log('stderr', `無法清除暫存目錄 ${staging}: ${(e as Error).message}`)
    }
  }

  let stagedOpenclaw: string
  let stagedSkills: string
  let stagedSkillNames: string[] = []
  let liveEntries: string[] = []
  let carry: string[] = []
  try {
    const r = await deps.run(['backup', 'restore', archivePath, '--target', staging, '--json'], RESTORE_TIMEOUT_MS)
    if (r.code !== 0) throw new Error(`openclaw backup restore failed (exit ${r.code}): ${tail(r.stderr)}`)
    const j = parseJson(r.stdout, 'openclaw backup restore', r.stderr)
    let root = typeof j.archiveRoot === 'string' ? j.archiveRoot : ''
    if (!root) {
      const entries = fs.readdirSync(staging) as string[]
      if (entries.length === 1) root = entries[0]
    }
    if (!root) throw new Error('openclaw backup restore: cannot determine archive root')
    const payload = join(staging, root, 'payload', 'posix', home)
    stagedOpenclaw = join(payload, '.openclaw')
    stagedSkills = join(payload, '.agents', 'skills')
    if (!fs.existsSync(stagedOpenclaw)) {
      throw new Error(`restored archive has no .openclaw at ${stagedOpenclaw}`)
    }
    if (fs.existsSync(stagedSkills)) stagedSkillNames = fs.readdirSync(stagedSkills) as string[]
    liveEntries = fs.existsSync(liveDir) ? (fs.readdirSync(liveDir) as string[]) : []
    carry = planCarryOver(liveEntries, fs.readdirSync(stagedOpenclaw) as string[])
  } catch (e) {
    cleanStaging() // 尚未動到現行資料
    throw e
  }

  // 3. 開始動現行資料：每一步都登記 undo，失敗時反向執行
  const undo: Array<{ label: string; fn: () => void }> = []
  const failure = async (reason: string): Promise<never> => {
    log('stderr', `還原失敗，開始回滾：${reason}`)
    const errors: string[] = []
    try {
      await gateway.stop()
    } catch (e) {
      errors.push(`gateway stop: ${(e as Error).message}`)
    }
    for (const u of undo.reverse()) {
      try {
        u.fn()
      } catch (e) {
        errors.push(`${u.label}: ${(e as Error).message}`)
      }
    }
    try {
      await gateway.start()
    } catch (e) {
      errors.push(`gateway start: ${(e as Error).message}`)
    }
    if (errors.length) {
      throw new Error(
        `Restore failed (${reason}) AND rollback failed (${errors.join('; ')}). ` +
          `Manual recovery needed: your previous data is at ${preDir} (never deleted); ` +
          `restored data may be at ${liveDir} / ${failedDir}; staging at ${staging}.`,
      )
    }
    cleanStaging()
    throw new Error(`Restore failed (${reason}); rolled back to previous data. Previous data intact at ${liveDir}.`)
  }

  let reason: string | null = null
  try {
    await gateway.stop()

    // 4. 整個目錄互換
    const hadLive = fs.existsSync(liveDir)
    if (hadLive) {
      fs.renameSync(liveDir, preDir)
      undo.push({ label: `rename ${preDir} -> ${liveDir}`, fn: () => fs.renameSync(preDir, liveDir) })
    }
    fs.renameSync(stagedOpenclaw, liveDir)
    undo.push({ label: `rename ${liveDir} -> ${failedDir}`, fn: () => fs.renameSync(liveDir, failedDir) })

    // 5. 把原 live 的項目搬回來（extensions/npm/tmp 等歸檔不含的部分）
    for (const x of carry) {
      const dst = join(liveDir, x)
      const src = join(preDir, x)
      fs.rmSync(dst, { recursive: true, force: true })
      fs.renameSync(src, dst)
      undo.push({ label: `carry back ${x}`, fn: () => fs.renameSync(dst, src) })
    }

    // 6. managed skills
    if (stagedSkillNames.length) fs.mkdirSync(liveSkills, { recursive: true })
    for (const name of stagedSkillNames) {
      const dst = join(liveSkills, name)
      const aside = `${dst}.pre-restore-${ts}`
      const existed = fs.existsSync(dst)
      if (existed) {
        fs.renameSync(dst, aside)
        undo.push({ label: `restore skill ${name}`, fn: () => fs.renameSync(aside, dst) })
      }
      // 先登記 undo（複製到一半失敗也要能清掉）；反向執行時先 rm 副本，再把原 skill 改名回來
      undo.push({ label: `remove copied skill ${name}`, fn: () => fs.rmSync(dst, { recursive: true, force: true }) })
      fs.cpSync(join(stagedSkills, name), dst, { recursive: true, verbatimSymlinks: true })
    }

    // 7. 啟動並等健康
    await gateway.start()
    const healthy = await gateway.waitHealthy(HEALTH_TIMEOUT_MS).catch(() => false)
    if (!healthy) reason = 'gateway not healthy after restore'
  } catch (e) {
    reason = (e as Error).message
  }
  if (reason !== null) return failure(reason)

  cleanStaging()
  log('system', `還原完成，舊資料保留於 ${preDir}`)
  return { preRestoreDir: preDir }
}
