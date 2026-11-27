import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { hermesHome } from './hermes-config'

// Python tempfile 的隨機字元含底線（例：.state.db.k_3x9a.dbimport-wal）
const sidecarName = /^\..+\.[A-Za-z0-9_]+\.dbimport-(wal|shm)$/
const skippedDirs = new Set(['.cache', '.git', '.venv', 'node_modules', 'sandboxes', 'skills'])
const maxDepth = 3

export function cleanupHermesDbImportSidecars(log: (level: 'info' | 'warn', message: string) => void): void {
  let removed = 0
  let failures = 0

  function recordFailure(error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures++
  }

  function scan(directory: string, depth: number) {
    let entries: fs.Dirent[]
    try {
      if (!fs.lstatSync(directory).isDirectory()) return
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      recordFailure(error)
      return
    }

    for (const entry of entries) {
      const file = join(directory, entry.name)
      if (entry.isDirectory() && depth < maxDepth && !skippedDirs.has(entry.name)) {
        scan(file, depth + 1)
      } else if (entry.isFile() && sidecarName.test(entry.name)) {
        try {
          const main = file.slice(0, -4) // Strip "-wal" or "-shm".
          if (fs.lstatSync(main, { throwIfNoEntry: false })) continue
          fs.unlinkSync(file)
          removed++
        } catch (error) {
          recordFailure(error)
        }
      }
    }
  }

  scan(resolve(hermesHome()), 0)
  log('info', `已移除 ${removed} 個 Hermes 匯入暫存的 SQLite 附屬檔案`)
  if (failures) log('warn', `警告：清理 Hermes 匯入暫存檔案時發生 ${failures} 個錯誤`)
}
