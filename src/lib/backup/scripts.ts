import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { backupExtraFolder } from './extra-folder'
import { getScriptsDir, getBackupOutputDir, formatBytes, checkScriptsAvailable } from './helpers'
import { classifyBackupFile, type BackupKind } from './archive-format'
import { resolveInsideDirs } from './path-guard'

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
export async function uploadToFtp(
  localFile: string,
  config: { ip: string; port: number; user: string; password: string; mode: string; path: string }
): Promise<void> {
  const remotePath = `ftp://${config.ip}:${config.port}${config.path}/`
  const args = [
    '-T', localFile,
    remotePath,
    '--user', `${config.user}:${config.password}`,
  ]
  if (config.mode === 'passive') args.push('--ftp-pasv')
  args.push('--connect-timeout', '30', '--max-time', '600')

  await execFileAsync('/usr/bin/curl', args, { timeout: 620000 })
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
