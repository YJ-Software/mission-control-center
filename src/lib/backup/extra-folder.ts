import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

const EXCLUDES = ['node_modules', '.git', '*.tar.gz', '__pycache__', '.next']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 與原 backup-extra.sh 的 `date +%Y%m%d_%H%M%S` 相同：本地時間
function timestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

interface TarResult { code: number | null; stderr: string; error?: Error }

function runTar(args: string[]): Promise<TarResult> {
  return new Promise((resolve) => {
    execFile('tar', args, { timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolve({ code: 0, stderr: String(stderr) })
      const code = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
        ? ((err as unknown as { code: number }).code) : null
      resolve({ code, stderr: String(stderr), error: err })
    })
  })
}

export async function backupExtraFolder(
  sourcePath: string, outputDir: string, name: string, now = new Date()
): Promise<{ filename: string; filePath: string; size: number; warning?: string }> {
  let isDir = false
  try { isDir = fs.statSync(sourcePath).isDirectory() } catch { /* 不存在 */ }
  if (!isDir) throw new Error(`Source directory does not exist: ${sourcePath}`)

  const safeName = name.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[.-]+/, '') || 'folder'
  const stem = `extra-backup_${safeName}_${timestamp(now)}`
  fs.mkdirSync(outputDir, { recursive: true })
  // 絕不覆蓋既有備份：同名時加 _2、_3 …
  let filename = `${stem}.tar.gz`
  for (let i = 2; fs.existsSync(path.join(outputDir, filename)); i++) filename = `${stem}_${i}.tar.gz`
  const filePath = path.join(outputDir, filename)

  const resolved = path.resolve(sourcePath)
  const args = [
    'czf', filePath,
    ...EXCLUDES.map((e) => `--exclude=${e}`),
    '-C', path.dirname(resolved), '--', path.basename(resolved),
  ]
  const r = await runTar(args)

  let warning: string | undefined
  if (r.code === 1 && fs.existsSync(filePath)) {
    warning = `${sourcePath}：tar 回報檔案在讀取時變動（exit 1），備份可能不一致`
    console.warn(`[backup] ${warning}`)
  } else if (r.code !== 0) {
    fs.rmSync(filePath, { force: true })
    const tail = r.stderr.trim().split('\n').slice(-5).join('\n') || r.error?.message || ''
    throw new Error(`tar 失敗（exit ${r.code ?? 'unknown'}）：${tail}`)
  }

  fs.chmodSync(filePath, 0o600)
  return { filename, filePath, size: fs.statSync(filePath).size, ...(warning ? { warning } : {}) }
}
