import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { backupExtraFolder } from './extra-folder'
import { getScriptsDir, getBackupOutputDir, formatBytes, checkScriptsAvailable } from './helpers'
import { classifyBackupFile, type BackupKind } from './archive-format'
import { resolveInsideDirs } from './path-guard'
import { buildCurlAuthConfig, redactSecretValues } from './secrets'

const execFileAsync = promisify(execFile)

export interface BackupResult {
  filename: string
  size: number
  sizeHuman: string
  filePath: string
  warning?: string
}

export interface BackupFile {
  filename: string
  size: number
  sizeHuman: string
  createdAt: string
  filePath: string
  kind: BackupKind
  legacyRestorable: boolean
}

// --- Concurrency lock（實作在 lock.ts：無其他依賴，讓 action/upgrade 路由不必載入資料庫） ---
import { isBackupRunning, setRunningLogId, isBackupOrRestoreBusy, getRunningLogId } from './lock'
export { isBackupRunning, setRunningLogId, isBackupOrRestoreBusy, getRunningLogId }

// --- Run OpenClaw backup ---
export async function runBackup(outputDir?: string): Promise<BackupResult> {
  const dir = outputDir || getBackupOutputDir()
  const scriptsDir = getScriptsDir()
  const backupScript = path.join(scriptsDir, 'backup.sh')

  fs.mkdirSync(dir, { recursive: true })

  const { stdout } = await execFileAsync('/bin/bash', [backupScript, dir], {
    timeout: 300000,
    env: { ...process.env, HOME: process.env.HOME },
  })

  const lines = stdout.trim().split('\n')
  const archiveLine = lines.find(l => l.includes('.tar.gz'))
  let filename = ''
  if (archiveLine) {
    const match = archiveLine.match(/(openclaw-backup_[^\s]+\.tar\.gz)/)
    if (match) filename = match[1]
  }

  if (!filename) {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('openclaw-backup_') && f.endsWith('.tar.gz'))
      .sort().reverse()
    filename = files[0] || 'unknown'
  }

  const filePath = path.join(dir, filename)
  const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0

  return { filename, size, sizeHuman: formatBytes(size), filePath }
}

// --- Run extra folder backup ---
export async function runExtraBackup(
  sourcePath: string, outputDir: string, name: string
): Promise<BackupResult> {
  const { filename, filePath, size, warning } = await backupExtraFolder(sourcePath, outputDir, name)
  return { filename, size, sizeHuman: formatBytes(size), filePath, ...(warning ? { warning } : {}) }
}

// --- Run restore ---
export async function runRestore(file: string, dryRun = false): Promise<string> {
  const scriptsDir = getScriptsDir()
  const restoreScript = path.join(scriptsDir, 'restore.sh')
  const args = [restoreScript, file]
  if (dryRun) args.push('--dry-run')

  const { stdout, stderr } = await execFileAsync('/bin/bash', args, {
    timeout: 180000,
    env: { ...process.env, HOME: process.env.HOME },
  })

  return stdout + (stderr ? '\n' + stderr : '')
}

// --- FTP upload ---
const FTP_UPLOAD_TIMEOUT_MS = 620000
const STDERR_TAIL_CHARS = 500

/**
 * 帳密不放 argv（同機 `ps`/`/proc/<pid>/cmdline` 看得到，且 execFile 失敗時會把整條命令列寫進錯誤訊息）：
 * 用 `curl -K -` 從 stdin 讀 `user = "帳:密"`。失敗時自己組錯誤訊息（結束碼＋stderr 尾段，已遮罩），
 * 絕不讓 `Command failed: <argv>` 流出。
 */
export async function uploadToFtp(
  localFile: string,
  config: { ip: string; port: number; user: string; password: string; mode: string; path: string },
  opts: { curlBin?: string } = {},
): Promise<void> {
  const curlBin = opts.curlBin ?? '/usr/bin/curl'
  const remotePath = `ftp://${config.ip}:${config.port}${config.path}/`
  const args = ['-K', '-', '-sS', '-T', localFile, remotePath]
  if (config.mode === 'passive') args.push('--ftp-pasv')
  args.push('--connect-timeout', '30', '--max-time', '600')
  const creds = [{ user: config.user, password: config.password }]

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let timedOut = false
    let stderr = ''
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const child = spawn(curlBin, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, FTP_UPLOAD_TIMEOUT_MS)
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(new Error(`無法執行 curl（${err.code ?? 'unknown'}）`))
    })
    child.on('close', (code, signal) => {
      if (code === 0) return finish()
      const tail = redactSecretValues(stderr.trim().slice(-STDERR_TAIL_CHARS), creds)
      const reason = timedOut
        ? `逾時（${FTP_UPLOAD_TIMEOUT_MS / 1000} 秒）`
        : code !== null ? `curl 結束碼 ${code}` : `curl 被訊號 ${signal} 終止`
      finish(new Error(`FTP 上傳失敗（${reason}）${tail ? `：${tail}` : ''}`))
    })
    // curl 提早結束時寫 stdin 會 EPIPE：結果以 close 事件為準
    child.stdin?.on('error', () => { /* ignore */ })
    child.stdin?.end(buildCurlAuthConfig(config.user, config.password))
  })
}

// --- List backup files ---
export function listBackupFiles(dir?: string): BackupFile[] {
  const backupDir = dir || getBackupOutputDir()
  if (!fs.existsSync(backupDir)) return []
  const legacyRestorable = checkScriptsAvailable().ok

  return fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.tar.gz'))
    .map(filename => {
      const filePath = path.join(backupDir, filename)
      const stat = fs.statSync(filePath)
      return {
        filename,
        size: stat.size,
        sizeHuman: formatBytes(stat.size),
        createdAt: stat.birthtime.toISOString(),
        filePath,
        kind: classifyBackupFile(filename),
        legacyRestorable,
      }
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// --- Delete backup file (with path traversal protection) ---
/**
 * 與還原路由同一套範圍檢查（resolveInsideDirs：解開 symlink 後必須在允許目錄「底下」），
 * 不用字串前綴比對（/a/backup 會誤含 /a/backup-old）。刪除的是解析後的真實檔案。
 */
export function deleteBackupFile(filePath: string, allowedDirs?: string[]): void {
  if (!path.resolve(filePath).endsWith('.tar.gz')) {
    throw new Error('Can only delete .tar.gz files')
  }
  const dirs = allowedDirs || [getBackupOutputDir()]
  let target: string
  try {
    target = resolveInsideDirs(filePath, dirs)
  } catch {
    throw new Error('Cannot delete files outside backup directories')
  }
  if (!target.endsWith('.tar.gz')) throw new Error('Can only delete .tar.gz files')
  if (fs.existsSync(target)) fs.unlinkSync(target)
}
