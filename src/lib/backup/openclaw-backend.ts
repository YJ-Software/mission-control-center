import { join } from 'node:path'
import type * as NodeFs from 'node:fs'
import { runOpenclaw, extractJson } from '@/lib/openclaw/models-config'
import { planCarryOver } from './restore-plan'

export interface OpenClawBackendDeps {
  run(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>
  fs: Pick<
    typeof NodeFs,
    'existsSync' | 'lstatSync' | 'readdirSync' | 'renameSync' | 'rmSync' | 'cpSync' | 'mkdirSync' | 'mkdtempSync'
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

/** stdout 前面可能有非 JSON 的雜訊（例如 doctor 警告框）：用 extractJson 跳過。 */
function parseJson(stdout: string, what: string, stderr: string): Record<string, unknown> {
  try {
    const v = extractJson(stdout)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not a JSON object')
    return v as Record<string, unknown>
  } catch (e) {
    throw new Error(`${what}: unparseable output (${(e as Error).message}) ${tail(stderr)}`)
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
): Promise<{ preRestoreDir: string | null; parkedSkillsDir: string | null }> {
  const { fs, home, gateway, log } = deps
  const ts = stamp(deps.now())
  const liveDir = join(home, '.openclaw')
  const preDir = join(home, `.openclaw.pre-restore-${ts}`)
  const failedDir = join(home, `.openclaw.failed-restore-${ts}`)
  const agentsDir = join(home, '.agents')
  const liveSkills = join(agentsDir, 'skills')
  // 被取代的 skill 停放在 skills 的「兄弟」目錄，不可放在 skills 裡（OpenClaw 會把它當成重複 skill 載入）
  const parkDir = join(agentsDir, `skills.pre-restore-${ts}`)

  // 前置檢查：~/.openclaw 若是 symlink，整目錄互換無法保留語意，直接拒絕（尚未動任何東西）
  const st = fs.lstatSync(liveDir, { throwIfNoEntry: false })
  if (st && st.isSymbolicLink()) {
    throw new Error(
      `Refusing to restore: ${liveDir} is a symbolic link. Swap-restore needs a real directory; nothing was changed.`,
    )
  }

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
  } catch (e) {
    cleanStaging() // 尚未動到現行資料
    throw e
  }

  // 動現行資料之後：每一步都登記 undo，失敗時反向執行；同時追蹤「資料現在實際在哪」，供錯誤訊息使用
  const undo: Array<{ label: string; fn: () => void }> = []
  const where: { orig: string | null; restored: string } = { orig: st ? liveDir : null, restored: stagedOpenclaw }
  const carriedIn = new Set<string>() // 原資料的項目，目前在 liveDir 內
  const parked = new Set<string>() // 被取代的原 skill，目前在 parkDir 內
  const copiedSkills = new Set<string>() // 還原進來的 skill，目前在 liveSkills 內
  let hadLive = false
  let carry: string[] = []
  let stopErr: string | null = null
  let startErr: string | null = null

  /** rename 並更新位置追蹤（只在 rename 成功後更新） */
  const mv = (from: string, to: string) => {
    fs.renameSync(from, to)
    if (from === where.orig) where.orig = to
    else if (from === where.restored) where.restored = to
  }

  const failure = async (reason: string): Promise<never> => {
    log('stderr', `還原失敗，開始回滾：${reason}`)
    stopErr = null // 以回滾時的 stop 結果為準
    try {
      await gateway.stop()
    } catch (e) {
      stopErr = (e as Error).message
    }
    const undoErrors: string[] = []
    for (const u of undo.reverse()) {
      try {
        u.fn()
      } catch (e) {
        undoErrors.push(`${u.label}: ${(e as Error).message}`)
      }
    }
    try {
      await gateway.start()
    } catch (e) {
      startErr = (e as Error).message
    }

    const filesOk = undoErrors.length === 0
    // 檔案回滾成功時 staging 已無用處（pre 目錄絕不刪）；失敗時保留供人工復原
    if (filesOk) cleanStaging()
    if (filesOk && stopErr === null && startErr === null) {
      throw new Error(
        `Restore failed (${reason}); rolled back to previous state. ` +
          (where.orig === liveDir ? `Previous data intact at ${liveDir}.` : 'There was no previous ~/.openclaw to restore.'),
      )
    }

    // 以下訊息依「實際狀態」組成，只提到真的存在的路徑
    const lines: string[] = [`Restore failed (${reason}).`]
    if (filesOk) {
      lines.push(
        where.orig === liveDir
          ? `Files were rolled back: your original data is at ${liveDir}.`
          : 'Files were rolled back; there was no original ~/.openclaw, so no original data exists to recover.',
      )
    } else {
      lines.push(`Rollback of files FAILED (${undoErrors.join('; ')}). Manual recovery needed.`)
      if (where.orig !== null) {
        lines.push(
          `Your ORIGINAL data is at ${where.orig}` + (where.orig === liveDir ? '.' : ` (not at ${liveDir}); it was never deleted.`),
        )
      }
      if (fs.existsSync(where.restored)) {
        lines.push(
          `The RESTORED copy is at ${where.restored}` +
            (where.restored === liveDir ? ' (so ' + liveDir + ' currently holds RESTORED data, not your original).' : '.'),
        )
      }
      if (carriedIn.size) {
        // 搬進來的項目跟著「還原副本」目錄走（where.restored 會隨 rename 更新），所以實際位置是它底下
        const items = [...carriedIn].map((x) => join(where.restored, x))
        lines.push(
          `These items of your original data are currently at: ${items.join(', ')}` +
            (where.orig ? `; move each back into ${where.orig}.` : '.'),
        )
      }
      if (parked.size) lines.push(`Replaced skills still parked in ${parkDir}: ${[...parked].join(', ')}.`)
      if (copiedSkills.size) lines.push(`Restored skills copied into ${liveSkills}: ${[...copiedSkills].join(', ')}.`)
      if (fs.existsSync(staging)) lines.push(`Staging directory kept at ${staging}.`)
    }
    if (stopErr !== null) {
      lines.push(`The gateway could not be stopped (${stopErr}); it may still be running against the old files, so restart the OpenClaw gateway after fixing the above.`)
    }
    if (startErr !== null) {
      lines.push(`The gateway could not be started (${startErr}); start the OpenClaw gateway manually.`)
    }
    if (!filesOk && stopErr === null && startErr === null) lines.push('Restart the OpenClaw gateway once the files are fixed.')
    throw new Error(lines.join(' '))
  }

  let reason: string | null = null
  try {
    await gateway.stop()

    // 停掉之後才列舉（gateway 停止前可能還在建立新項目）
    hadLive = fs.existsSync(liveDir)
    const liveEntries = hadLive ? (fs.readdirSync(liveDir) as string[]) : []
    carry = planCarryOver(liveEntries, fs.readdirSync(stagedOpenclaw) as string[])

    // 4. 整個目錄互換
    if (hadLive) {
      mv(liveDir, preDir)
      undo.push({ label: `rename ${preDir} -> ${liveDir}`, fn: () => mv(preDir, liveDir) })
    } else {
      where.orig = null
    }
    mv(stagedOpenclaw, liveDir)
    undo.push({ label: `rename ${liveDir} -> ${failedDir}`, fn: () => mv(liveDir, failedDir) })

    // 5. 把原 live 的項目搬回來（extensions/npm/tmp 等歸檔不含的部分）
    for (const x of carry) {
      const dst = join(liveDir, x)
      const src = join(preDir, x)
      fs.rmSync(dst, { recursive: true, force: true })
      fs.renameSync(src, dst)
      carriedIn.add(x)
      undo.push({
        label: `carry back ${x}`,
        fn: () => {
          fs.renameSync(dst, src)
          carriedIn.delete(x)
        },
      })
    }

    // 6. managed skills
    if (stagedSkillNames.length) {
      if (!fs.existsSync(liveSkills)) {
        fs.mkdirSync(liveSkills, { recursive: true })
        undo.push({ label: `remove created ${liveSkills}`, fn: () => rmdirIfEmpty(liveSkills) })
      }
      let parkCreated = false
      for (const name of stagedSkillNames) {
        const dst = join(liveSkills, name)
        const aside = join(parkDir, name)
        if (fs.existsSync(dst)) {
          if (!parkCreated) {
            parkCreated = true
            fs.mkdirSync(parkDir, { recursive: true })
            undo.push({ label: `remove created ${parkDir}`, fn: () => rmdirIfEmpty(parkDir) })
          }
          fs.renameSync(dst, aside)
          parked.add(name)
          undo.push({
            label: `restore skill ${name}`,
            fn: () => {
              fs.renameSync(aside, dst)
              parked.delete(name)
            },
          })
        }
        // 先登記 undo（複製到一半失敗也要能清掉）；反向執行時先 rm 副本，再把原 skill 搬回來
        copiedSkills.add(name)
        undo.push({
          label: `remove copied skill ${name}`,
          fn: () => {
            fs.rmSync(dst, { recursive: true, force: true })
            copiedSkills.delete(name)
          },
        })
        fs.cpSync(join(stagedSkills, name), dst, { recursive: true, verbatimSymlinks: true })
      }
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
  const preRestoreDir = hadLive ? preDir : null
  log('system', preRestoreDir ? `還原完成，舊資料保留於 ${preDir}` : '還原完成（原本沒有 ~/.openclaw，無舊資料可保留）')
  return { preRestoreDir, parkedSkillsDir: parked.size ? parkDir : null }

  function rmdirIfEmpty(dir: string) {
    if (fs.existsSync(dir) && (fs.readdirSync(dir) as string[]).length === 0) fs.rmSync(dir, { recursive: true })
  }
}
