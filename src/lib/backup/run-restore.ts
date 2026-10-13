import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { startJob, type PhaseSpec } from '@/lib/jobs/runner'
import type { JobMeta, TriggerSource } from '@/lib/jobs/types'
import { getVersionInfo } from '@/lib/version'
import { getInstallInfo, scheduleServiceRestart } from '@/lib/upgrade/manager'
import { GATEWAY_HTTP } from '@/lib/openclaw'
import { DB_PATH } from '@/lib/db'
import { classifyBackupFile, parseManifest, type BackupKind, type BackupManifest } from './archive-format'
import {
  verifyOpenClawBackup, restoreOpenClawBackup, defaultOpenClawBackendRun, type OpenClawBackendDeps,
} from './openclaw-backend'
import { preparePendingDbRestore, commitPendingDbRestore, discardPreparedDbRestore, discardPendingDbRestore } from './mcc-state'
import { checkScriptsAvailable } from './helpers'
import { BackupBusyError, isBackupOrRestoreBusy, acquireLock, releaseLock } from './lock'
import { assertNoBlockingJob } from './job-guard'
import { runRestore } from './scripts'

export { BackupBusyError }

/** 請求本身不被接受（類型不支援、舊腳本不在…）：route 回 400 */
export class RestoreRejectedError extends Error {}

type Log = (stream: 'stdout' | 'stderr' | 'system', text: string) => void

/** 還原與備份共用 globalThis 鎖；還原沒有 backupLogs 紀錄，用哨兵值 */
const RESTORE_LOCK = -1

export interface RestoreDeps {
  startJob: (spec: Parameters<typeof startJob>[0]) => JobMeta
  /** 執行 tar，回傳 stdout */
  tar: (args: string[]) => Promise<string>
  openclawVerify: (archive: string, log: Log) => Promise<unknown>
  openclawRestore: (archive: string, log: Log) => Promise<{ preRestoreDir: string | null; parkedSkillsDir: string | null }>
  /** 第一步：驗證快照並複製成暫存名（OpenClaw 換掉之前；會失敗的事都在這裡）；archive 用來補上快照當下未知的備份大小 */
  prepareDb: (snapshot: string, dbPath: string, archive: string) => void
  /** 第二步：OpenClaw 換掉之後，只做 rename */
  commitDb: (dbPath: string) => void
  discardPreparedDb: (dbPath: string) => void
  discardPendingDb: (dbPath: string) => void
  /** 動 OpenClaw 之前確認 gateway 由 openclaw-gateway user unit 管理；不合格丟錯 */
  gatewayPreflight: () => Promise<void>
  scheduleRestart: (service: string) => void
  getInstall: () => { mode: string; service: string }
  mccVersion: () => string
  findBlockingJob?: () => JobMeta | null
  /** 現行 MCC 的裸 semver，用來比對備份是否來自較新的版本 */
  runningSemver: () => string
  /** release 重啟前持有鎖的最長時間（行程若仍活著就釋放） */
  restartLockHoldMs: number
  legacyRestore: (file: string) => Promise<string>
  legacyDryRun: (file: string) => Promise<string>
  legacyScriptsOk: () => boolean
  now: () => Date
  dbPath: string
  /** 解壓暫存目錄的父目錄（~/.mission-control，與家目錄同一個檔案系統） */
  workRoot: string
}

export function defaultTar(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tar', args, { timeout: 30 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`tar failed: ${String(stderr).slice(-300) || err.message}`))
      else resolve(String(stdout))
    })
  })
}

function systemctlUser(action: 'stop' | 'start'): Promise<void> {
  // stop 可能等到 systemd 預設的 TimeoutStopSec（90 s），逾時要比它長
  const timeout = action === 'stop' ? 120_000 : 60_000
  return new Promise((resolve, reject) => {
    execFile('systemctl', ['--user', action, 'openclaw-gateway'], { timeout }, (err, _o, stderr) => {
      if (err) reject(new Error(`systemctl --user ${action} openclaw-gateway failed: ${String(stderr).trim().slice(-300) || err.message}`))
      else resolve()
    })
  })
}

function isGatewayUnitActive(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('systemctl', ['--user', 'is-active', 'openclaw-gateway'], { timeout: 15_000 }, (err) => resolve(!err))
  })
}

async function gatewayAnswers(): Promise<boolean> {
  try {
    await fetch(GATEWAY_HTTP, { signal: AbortSignal.timeout(3000) })
    return true
  } catch { return false }
}

/** 輪詢直到 gateway 有任何 HTTP 回應（含 401/404）或逾時 */
async function waitGatewayHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await gatewayAnswers()) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

/** 動手前：unit 沒在跑但連接埠有回應，代表 gateway 不是由它管理，停不掉就不能安全換檔 */
async function gatewayPreflight(): Promise<void> {
  if (!(await isGatewayUnitActive()) && (await gatewayAnswers())) {
    throw new Error('gateway 不是由 openclaw-gateway user unit 管理，無法安全還原（尚未更動任何資料）')
  }
}

/** stop 之後確認連接埠真的不再回應，才可以換檔 */
async function stopGatewayAndConfirm(): Promise<void> {
  await systemctlUser('stop')
  const deadline = Date.now() + 30_000
  while (await gatewayAnswers()) {
    if (Date.now() > deadline) throw new Error('openclaw-gateway 已 stop 但連接埠仍有回應，為避免在執行中的行程底下換檔而中止')
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const defaultDeps = (): RestoreDeps => ({
  startJob,
  tar: defaultTar,
  openclawVerify: (archive, log) => verifyOpenClawBackup(archive, { run: defaultOpenClawBackendRun, log }),
  openclawRestore: (archive, log) => {
    const deps: OpenClawBackendDeps = {
      run: defaultOpenClawBackendRun,
      fs,
      home: os.homedir(),
      gateway: {
        stop: stopGatewayAndConfirm,
        start: () => systemctlUser('start'),
        waitHealthy: waitGatewayHealthy,
      },
      now: () => new Date(),
      log,
    }
    return restoreOpenClawBackup(archive, deps)
  },
  prepareDb: preparePendingDbRestore,
  commitDb: commitPendingDbRestore,
  discardPreparedDb: discardPreparedDbRestore,
  discardPendingDb: discardPendingDbRestore,
  gatewayPreflight,
  scheduleRestart: scheduleServiceRestart,
  getInstall: () => getInstallInfo(),
  mccVersion: () => getVersionInfo().version,
  runningSemver: () => getVersionInfo().mccVersion,
  restartLockHoldMs: 120_000,
  legacyRestore: (file) => runRestore(file, false),
  legacyDryRun: (file) => runRestore(file, true),
  legacyScriptsOk: () => checkScriptsAvailable().ok,
  now: () => new Date(),
  dbPath: DB_PATH,
  workRoot: path.dirname(DB_PATH),
})

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const RESTORE_DIR_PREFIX = '.restore-'

/** 列出封存內容並拒絕：絕對路徑、任何 .. 段、以及 檔案/目錄 以外的成員（symlink、hardlink、裝置…）。 */
export async function assertSafeArchive(tar: RestoreDeps['tar'], file: string): Promise<string[]> {
  const names = (await tar(['--force-local', '-tzf', file])).split('\n').filter((l) => l !== '')
  const verbose = (await tar(['--force-local', '-tzvf', file])).split('\n').filter((l) => l !== '')
  for (const line of verbose) {
    const t = line[0]
    if (t !== '-' && t !== 'd') {
      throw new RestoreRejectedError(`封存檔含有不允許的成員類型（${t === 'l' ? 'symlink' : t === 'h' ? 'hardlink' : `type ${t}`}），已拒絕：${line.slice(0, 200)}`)
    }
  }
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new RestoreRejectedError(`封存檔含有不安全的路徑，已拒絕：${name}`)
    }
  }
  return names
}

function makeWorkDir(deps: RestoreDeps): string {
  fs.mkdirSync(deps.workRoot, { recursive: true })
  const dir = path.join(deps.workRoot, `${RESTORE_DIR_PREFIX}${deps.now().getTime()}`)
  fs.mkdirSync(dir, { mode: 0o700 })
  fs.chmodSync(dir, 0o700)
  return dir
}

function inside(dir: string, rel: string): string {
  const p = path.resolve(dir, rel)
  const r = path.relative(dir, p)
  if (r === '' || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`路徑超出解壓目錄：${rel}`)
  return p
}

function checkManifest(raw: unknown): BackupManifest {
  let manifest: BackupManifest
  try { manifest = parseManifest(raw) } catch (e) {
    throw new RestoreRejectedError(`manifest 無效：${errText(e)}`)
  }
  if (manifest.backend !== 'openclaw') {
    throw new RestoreRejectedError(`不支援還原 ${manifest.backend} 後端的備份（目前只支援 openclaw）`)
  }
  return manifest
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

function newerWarning(m: BackupManifest, running: string): string | null {
  return semverGt(m.mccVersion, running)
    ? `警告：此備份來自較新的 MCC（${m.mccVersion}），目前執行的是 ${running}；資料庫快照的結構可能比現行程式新`
    : null
}

/** 只從外層封存讀 manifest.json（不解壓到磁碟）。Task 7 以 `-C staging .` 打包，成員名是 ./manifest.json。 */
async function readManifestOnly(deps: RestoreDeps, file: string): Promise<BackupManifest> {
  let out: string | null = null
  let lastErr: unknown
  for (const member of ['./manifest.json', 'manifest.json']) {
    try { out = await deps.tar(['--force-local', '-xOzf', file, '--occurrence=1', member]); break } catch (e) { lastErr = e }
  }
  if (out === null) throw new RestoreRejectedError(`封存檔內讀不到 manifest.json：${errText(lastErr)}`)
  let raw: unknown
  try { raw = JSON.parse(out) } catch (e) { throw new RestoreRejectedError(`manifest.json 不是有效的 JSON：${errText(e)}`) }
  return checkManifest(raw)
}

/** 解壓到 content 並讀出 manifest，確認 manifest 指到的檔案都在 content 內且存在 */
async function extractAndRead(deps: RestoreDeps, file: string, content: string): Promise<BackupManifest> {
  await deps.tar(['--force-local', '--no-same-owner', '-xzf', file, '-C', content])
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path.join(content, 'manifest.json'), 'utf8'))
  } catch (e) {
    throw new RestoreRejectedError(`manifest.json 無法讀取：${errText(e)}`)
  }
  const manifest = checkManifest(raw)
  const parts = [manifest.parts.mccDb, manifest.parts.backend].filter((x): x is string => !!x)
  for (const part of parts) {
    const p = inside(content, part)
    if (!fs.existsSync(p)) throw new Error(`備份檔缺少 manifest 指定的項目：${part}`)
  }
  return manifest
}

function summarize(m: BackupManifest, warning: string | null): string {
  const lines = [
    '備份類型：MCC 備份',
    `建立時間：${m.createdAt}`,
    `主機：${m.hostname}`,
    `後端：${m.backend} ${m.backendVersion ?? '（版本未知）'}`,
    `MCC 版本：${m.mccVersion}`,
    '內含項目：',
    m.parts.backend
      ? `  - ${m.backend} 資料（${m.parts.backend}）；還原時才會驗證內容`
      : `  - 不含 ${m.backend} 資料（建立備份時未勾選），還原時只會還原 MCC 資料庫`,
    `  - MCC 資料庫（${m.parts.mccDb}），於 MCC 重新啟動時套用`,
    m.parts.mccEnv
      ? `  - .env.local 副本（${m.parts.mccEnv}）`
      : '  - 此備份沒有 .env.local 副本',
    '注意：.env.local 不會自動還原。',
  ]
  if (m.parts.mccEnv) {
    lines.push(`如需還原，請手動解開封存檔，取出其中的 ${m.parts.mccEnv}（位於封存檔根目錄）自行比對後放回 MCC 目錄的 .env.local。`)
  }
  if (warning) lines.push(warning)
  return lines.join('\n')
}

/** 預覽：只讀 manifest.json，不解壓、不驗證內層；真正的閘門是還原工作的 verify 階段。 */
export async function describeBackup(
  filePath: string,
  depsOverride?: Partial<RestoreDeps>,
): Promise<{ kind: BackupKind; manifest?: BackupManifest; legacyRestorable: boolean; summary: string }> {
  const deps: RestoreDeps = { ...defaultDeps(), ...depsOverride }
  const kind = classifyBackupFile(path.basename(filePath))
  if (kind === 'legacy-openclaw') {
    const legacyRestorable = deps.legacyScriptsOk()
    if (!legacyRestorable) {
      return { kind, legacyRestorable, summary: '這是舊格式的 OpenClaw 備份，需要舊版備份腳本才能還原，但目前找不到這些腳本。' }
    }
    return { kind, legacyRestorable, summary: await deps.legacyDryRun(filePath) }
  }
  if (kind !== 'mcc') throw new RestoreRejectedError(`不支援還原此類型的檔案：${path.basename(filePath)}`)

  const manifest = await readManifestOnly(deps, filePath)
  return { kind, manifest, legacyRestorable: false, summary: summarize(manifest, newerWarning(manifest, deps.runningSemver())) }
}

export function startRestore(
  filePath: string,
  triggeredBy: TriggerSource,
  depsOverride?: Partial<RestoreDeps>,
): JobMeta {
  const deps: RestoreDeps = { ...defaultDeps(), ...depsOverride }
  const file = path.resolve(filePath)
  const kind = classifyBackupFile(path.basename(file))
  if (kind !== 'mcc' && kind !== 'legacy-openclaw') {
    throw new RestoreRejectedError(`不支援還原此類型的檔案：${path.basename(file)}`)
  }
  if (kind === 'legacy-openclaw' && !deps.legacyScriptsOk()) {
    throw new RestoreRejectedError('這是舊格式的 OpenClaw 備份，需要舊版備份腳本才能還原，但目前找不到這些腳本。')
  }
  const mode = kind === 'mcc' ? deps.getInstall().mode : 'n/a'
  if (kind === 'mcc' && mode !== 'release' && mode !== 'dev') {
    // 判斷不出安裝型態就無法確定重啟後會不會套用資料庫還原；在動任何東西之前拒絕
    throw new RestoreRejectedError(`無法判斷 MCC 的安裝型態（${mode}），為避免資料庫還原停在半途，已拒絕還原；尚未更動任何資料`)
  }

  // 單一執行：同步檢查並上鎖（與備份共用）
  if (isBackupOrRestoreBusy()) throw new BackupBusyError()
  assertNoBlockingJob(deps.findBlockingJob)
  const lockToken = acquireLock(RESTORE_LOCK)

  const st = {
    dir: null as string | null,      // .restore-<ts>（0700）
    content: null as string | null,  // dir 底下的子目錄；封存內容解在這裡，封存自帶的 ./ 權限動不到 dir
    finished: false,
    holdLock: false,                 // release：重啟前持有鎖，onSettled 不可釋放
    manifest: null as BackupManifest | null,
    openclawRestored: false,
    preRestoreDir: null as string | null,
    timer: null as ReturnType<typeof setTimeout> | null,
  }
  const rmDir = () => {
    if (st.dir) { try { fs.rmSync(st.dir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
  /** 清理與解鎖：無條件、可重複呼叫、絕不丟錯 */
  const finalize = () => {
    if (st.finished) return
    st.finished = true
    if (st.timer) { clearTimeout(st.timer); st.timer = null }
    try { rmDir() } catch { /* ignore */ }
    try { deps.discardPreparedDb(deps.dbPath) } catch { /* ignore */ }
    releaseLock(lockToken)
  }
  const safeLog = (log?: Log): Log => (s, t) => { try { log?.(s, t) } catch { /* log I/O 不可打斷清理 */ } }
  const phase = (name: string, fn: (log: Log) => Promise<void>, opts: { last?: boolean } = {}): PhaseSpec => ({
    name,
    inline: async (rawLog) => {
      const log = safeLog(rawLog)
      try {
        await fn(log)
        if (opts.last) finalize()
        return 0
      } catch (e) {
        log('stderr', `${name}: ${errText(e)}`)
        finalize()
        return 1
      }
    },
  })

  try {
    // 單一執行保證：殘留的 .restore-* 與準備階段的 .tmp 一定是上次中斷的孤兒
    try {
      for (const n of fs.readdirSync(deps.workRoot)) {
        if (n.startsWith(RESTORE_DIR_PREFIX)) fs.rmSync(path.join(deps.workRoot, n), { recursive: true, force: true })
      }
    } catch { /* workRoot 可能還不存在 */ }
    deps.discardPreparedDb(deps.dbPath)

    const phases: PhaseSpec[] = []
    const release = mode === 'release'

    if (kind === 'legacy-openclaw') {
      phases.push(phase('legacy restore', async (log) => {
        log('system', await deps.legacyRestore(file))
      }, { last: true }))
    } else {
      phases.push(phase('verify', async (log) => {
        const names = await assertSafeArchive(deps.tar, file)
        if (!names.some((n) => n === 'manifest.json' || n === './manifest.json')) {
          throw new RestoreRejectedError('封存檔內沒有 manifest.json，這不是有效的 MCC 備份')
        }
        log('system', `封存檔結構檢查通過（${names.length} 個成員）`)
      }))

      phases.push(phase('extract', async (log) => {
        st.dir = makeWorkDir(deps)
        st.content = path.join(st.dir, 'content')
        fs.mkdirSync(st.content, { mode: 0o700 })
        log('system', `解壓到 ${st.content}`)
        st.manifest = await extractAndRead(deps, file, st.content)
        const warn = newerWarning(st.manifest, deps.runningSemver())
        if (warn) log('stderr', warn)
        // 會失敗的事（快照完整性、空間、權限）都在動現行資料之前做完
        deps.prepareDb(inside(st.content, st.manifest.parts.mccDb), deps.dbPath, file)
      }))

      phases.push(phase('restore OpenClaw', async (log) => {
        const m = st.manifest!
        if (!m.parts.backend) {
          log('system', '此備份不含 OpenClaw 資料，略過 OpenClaw 驗證與還原')
          return
        }
        const archive = inside(st.content!, m.parts.backend)
        await deps.gatewayPreflight()
        await deps.openclawVerify(archive, log)
        const r = await deps.openclawRestore(archive, log)
        st.openclawRestored = true
        st.preRestoreDir = r.preRestoreDir
        log('system', r.preRestoreDir ? `舊的 ~/.openclaw 保留於 ${r.preRestoreDir}` : '原本沒有 ~/.openclaw，無舊資料可保留')
        if (r.parkedSkillsDir) log('system', `被取代的 skill 停放於 ${r.parkedSkillsDir}`)
      }))

      phases.push(phase('stage MCC database', async (log) => {
        try {
          deps.commitDb(deps.dbPath)
        } catch (e) {
          throw new Error(
            `${errText(e)}。${st.openclawRestored ? 'OpenClaw 已還原' : 'OpenClaw 未更動'}，但 MCC 資料庫未還原。` +
            (st.preRestoreDir ? `原 OpenClaw 資料保留於 ${st.preRestoreDir}，可手動換回；` : '') +
            '重新執行同一份備份的還原是安全的。',
          )
        }
        rmDir() // 重啟之前先清掉解壓內容（含機敏檔）
        log('system', '資料庫還原已排程，將於 MCC 下次啟動時套用')
        if (!release) {
          log('system', '需手動重啟 MCC 才會套用資料庫還原')
          log('system', '注意：資料庫還原會在 1 小時後失效；超過期限未重啟，下次啟動時會被拒絕而不套用')
        }
      }, { last: !release }))

      if (release) {
        phases.push(phase('schedule MCC restart', async (log) => {
          const service = deps.getInstall().service
          log('system', `2 秒後重啟 MCC（service: ${service}）`)
          // runner 在這個 phase 回傳時就把工作標為 success，此時 MCC 還沒重啟、資料庫也還沒套用
          log('system', '此工作在排程重啟後即標示完成；資料庫是否成功套用，請在 MCC 重啟後到備份頁查看還原結果')
          rmDir()
          // 重啟前持續持有鎖，避免備份或第二次還原闖進這 2 秒；行程若仍活著則在期限後釋放
          st.holdLock = true
          st.timer = setTimeout(() => { st.holdLock = false; finalize() }, deps.restartLockHoldMs)
          st.timer.unref?.()
          try {
            deps.scheduleRestart(service)
          } catch (e) {
            st.holdLock = false
            try { deps.discardPendingDb(deps.dbPath) } catch { /* ignore */ }
            log('stderr', st.openclawRestored
              ? 'OpenClaw 已還原；MCC 資料庫未還原（排程重啟失敗）'
              : 'MCC 資料庫未還原（排程重啟失敗）')
            throw e
          }
        }))
      }
    }

    return deps.startJob({
      kind: 'backup-restore',
      label: 'MCC 還原',
      triggeredBy,
      phases,
      ...(release && kind === 'mcc' ? { expectedVersion: deps.mccVersion(), restartingBeforeLastPhase: true } : {}),
      // 保底：runner 自己丟錯或中斷時，一定清理並解鎖（等重啟的 release job 例外，由計時器釋放）
      onSettled: () => { if (!st.holdLock) finalize() },
    })
  } catch (e) {
    st.holdLock = false
    finalize()
    throw e
  }
}
