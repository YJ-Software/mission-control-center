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
import { stagePendingDbRestore } from './mcc-state'
import { isSqliteDbHealthy } from './pending-db-restore'
import { checkScriptsAvailable } from './helpers'
import { isBackupOrRestoreBusy, setRunningLogId, runRestore } from './scripts'
import { BackupBusyError } from './run-backup'

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
  stageDb: (snapshot: string, dbPath: string) => void
  dbHealthy: (file: string) => boolean
  scheduleRestart: (service: string) => void
  getInstall: () => { mode: string; service: string }
  mccVersion: () => string
  legacyRestore: (file: string) => Promise<string>
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
  return new Promise((resolve, reject) => {
    execFile('systemctl', ['--user', action, 'openclaw-gateway'], { timeout: 60_000 }, (err, _o, stderr) => {
      if (err) reject(new Error(`systemctl --user ${action} openclaw-gateway failed: ${String(stderr).trim().slice(-300) || err.message}`))
      else resolve()
    })
  })
}

/** 輪詢直到 gateway 有任何 HTTP 回應（含 401/404）或逾時 */
async function waitGatewayHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(GATEWAY_HTTP, { signal: AbortSignal.timeout(3000) })
      return true
    } catch { /* 尚未起來 */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
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
        stop: () => systemctlUser('stop'),
        start: () => systemctlUser('start'),
        waitHealthy: waitGatewayHealthy,
      },
      now: () => new Date(),
      log,
    }
    return restoreOpenClawBackup(archive, deps)
  },
  stageDb: stagePendingDbRestore,
  dbHealthy: isSqliteDbHealthy,
  scheduleRestart: scheduleServiceRestart,
  getInstall: () => getInstallInfo(),
  mccVersion: () => getVersionInfo().version,
  legacyRestore: (file) => runRestore(file, false),
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
      throw new Error(`封存檔含有不允許的成員類型（${t === 'l' ? 'symlink' : t === 'h' ? 'hardlink' : `type ${t}`}），已拒絕：${line.slice(0, 200)}`)
    }
  }
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`封存檔含有不安全的路徑，已拒絕：${name}`)
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

/** 解壓到 dir 並讀出 manifest，確認 manifest 指到的檔案都在 dir 內且存在 */
async function extractAndRead(deps: RestoreDeps, file: string, dir: string): Promise<BackupManifest> {
  await deps.tar(['--force-local', '--no-same-owner', '-xzf', file, '-C', dir])
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  } catch (e) {
    throw new Error(`manifest.json 無法讀取：${errText(e)}`)
  }
  const manifest = parseManifest(raw)
  const parts = [manifest.parts.mccDb, manifest.parts.backend].filter((x): x is string => !!x)
  for (const part of parts) {
    const p = inside(dir, part)
    if (!fs.existsSync(p)) throw new Error(`備份檔缺少 manifest 指定的項目：${part}`)
  }
  return manifest
}

function summarize(m: BackupManifest, openclawVerified: boolean): string {
  const lines = [
    '備份類型：MCC 備份',
    `建立時間：${m.createdAt}`,
    `主機：${m.hostname}`,
    `後端：${m.backend} ${m.backendVersion ?? '（版本未知）'}`,
    `MCC 版本：${m.mccVersion}`,
    '內含項目：',
    m.parts.backend
      ? `  - ${m.backend} 資料（${m.parts.backend}）${openclawVerified ? '，已通過 openclaw backup verify' : ''}`
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
  return lines.join('\n')
}

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
    return { kind, legacyRestorable, summary: '舊格式 OpenClaw 備份，將以舊腳本還原（不含 MCC 資料庫）。' }
  }
  if (kind !== 'mcc') throw new RestoreRejectedError(`不支援還原此類型的檔案：${path.basename(filePath)}`)

  await assertSafeArchive(deps.tar, filePath)
  const dir = makeWorkDir(deps)
  try {
    const manifest = await extractAndRead(deps, filePath, dir)
    let verified = false
    if (manifest.parts.backend) {
      await deps.openclawVerify(inside(dir, manifest.parts.backend), () => {})
      verified = true
    }
    return { kind, manifest, legacyRestorable: false, summary: summarize(manifest, verified) }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
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

  // 單一執行：同步檢查並上鎖（與備份共用）
  if (isBackupOrRestoreBusy()) throw new BackupBusyError()
  setRunningLogId(RESTORE_LOCK)

  const st = { dir: null as string | null, finished: false, manifest: null as BackupManifest | null }
  const rmDir = () => {
    if (st.dir) { try { fs.rmSync(st.dir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
  /** 清理與解鎖：無條件、可重複呼叫、絕不丟錯 */
  const finalize = () => {
    if (st.finished) return
    st.finished = true
    try { rmDir() } catch { /* ignore */ }
    setRunningLogId(null)
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
    const phases: PhaseSpec[] = []
    let release = false

    if (kind === 'legacy-openclaw') {
      phases.push(phase('legacy restore', async (log) => {
        log('system', await deps.legacyRestore(file))
      }, { last: true }))
    } else {
      release = deps.getInstall().mode === 'release'

      phases.push(phase('verify', async (log) => {
        const names = await assertSafeArchive(deps.tar, file)
        if (!names.some((n) => n === 'manifest.json' || n === './manifest.json')) {
          throw new Error('封存檔內沒有 manifest.json，這不是有效的 MCC 備份')
        }
        log('system', `封存檔結構檢查通過（${names.length} 個成員）`)
      }))

      phases.push(phase('extract', async (log) => {
        st.dir = makeWorkDir(deps)
        log('system', `解壓到 ${st.dir}`)
        st.manifest = await extractAndRead(deps, file, st.dir)
        // 在動任何現行資料之前先確認資料庫快照可用，避免 OpenClaw 已換掉才發現
        if (!deps.dbHealthy(inside(st.dir, st.manifest.parts.mccDb))) {
          throw new Error('備份中的資料庫快照無法通過完整性檢查，已中止還原（尚未更動任何現行資料）')
        }
      }))

      phases.push(phase('restore OpenClaw', async (log) => {
        const m = st.manifest!
        if (!m.parts.backend) {
          log('system', '此備份不含 OpenClaw 資料，略過 OpenClaw 驗證與還原')
          return
        }
        const archive = inside(st.dir!, m.parts.backend)
        await deps.openclawVerify(archive, log)
        const r = await deps.openclawRestore(archive, log)
        log('system', r.preRestoreDir ? `舊的 ~/.openclaw 保留於 ${r.preRestoreDir}` : '原本沒有 ~/.openclaw，無舊資料可保留')
        if (r.parkedSkillsDir) log('system', `被取代的 skill 停放於 ${r.parkedSkillsDir}`)
      }))

      phases.push(phase('stage MCC database', async (log) => {
        try {
          deps.stageDb(inside(st.dir!, st.manifest!.parts.mccDb), deps.dbPath)
        } catch (e) {
          throw new Error(`${errText(e)}（OpenClaw 資料${st.manifest!.parts.backend ? '已還原' : '未動'}，MCC 資料庫未更動）`)
        }
        rmDir() // 重啟之前先清掉解壓內容（含機敏檔）
        log('system', '資料庫還原已排程，將於 MCC 下次啟動時套用')
        if (!release) log('system', '需手動重啟 MCC 才會套用資料庫還原')
      }, { last: !release }))

      if (release) {
        phases.push(phase('schedule MCC restart', async (log) => {
          const service = deps.getInstall().service
          log('system', `2 秒後重啟 MCC（service: ${service}），重啟後此工作將標示完成`)
          finalize()
          deps.scheduleRestart(service)
        }))
      }
    }

    return deps.startJob({
      kind: 'backup-restore',
      label: 'MCC 還原',
      triggeredBy,
      phases,
      ...(release ? { expectedVersion: deps.mccVersion(), restartingBeforeLastPhase: true } : {}),
      // 保底：runner 自己丟錯或中斷時，一定清理並解鎖
      onSettled: finalize,
    })
  } catch (e) {
    finalize()
    throw e
  }
}
