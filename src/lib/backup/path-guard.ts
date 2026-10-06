import fs from 'node:fs'
import path from 'node:path'

function real(p: string): string {
  try { return fs.realpathSync(p) } catch { return path.resolve(p) }
}

/**
 * 檔案（解開 symlink 後）必須位於允許目錄之一的「底下」。
 * 回傳解析後的真實路徑；不合格丟錯。不用 startsWith 比字串，避免 /a/backup 與 /a/backup-evil 混淆。
 */
export function resolveInsideDirs(file: string, allowedDirs: string[]): string {
  const resolved = path.resolve(file)
  const target = real(resolved)
  const ok = allowedDirs.some((d) => {
    for (const base of new Set([path.resolve(d), real(d)])) {
      const rel = path.relative(base, target)
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return true
    }
    return false
  })
  if (!ok) throw new Error('Backup file must be inside a backup directory')
  return target
}
