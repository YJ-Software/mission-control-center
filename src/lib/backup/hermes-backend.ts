import fs from 'node:fs'
import path from 'node:path'
import { getHermesVersion, hermesService, runHermesCli, waitForHermesHealth } from '@/lib/agent-runtime/hermes-host'

const NATIVE_BACKUP_TIMEOUT_MS = 30 * 60_000
type Log = (stream: 'stdout' | 'stderr' | 'system', text: string) => void

export async function createHermesBackup(directory: string, log: Log) {
  const archivePath = path.join(directory, 'hermes.zip')
  await runHermesCli(['backup', '--output', archivePath], NATIVE_BACKUP_TIMEOUT_MS)
  if (!fs.lstatSync(archivePath).isFile()) throw new Error('Hermes backup did not create a regular ZIP file')
  fs.chmodSync(archivePath, 0o600)
  log('system', 'Hermes 原生備份已建立')
  return { archivePath, version: await getHermesVersion() }
}

function assertHermesZip(archive: string) {
  if (!archive.endsWith('.zip') || !fs.lstatSync(archive).isFile()) throw new Error('Hermes 備份必須是 ZIP 檔案')
  const magic = Buffer.alloc(4)
  const fd = fs.openSync(archive, 'r')
  try {
    fs.readSync(fd, magic, 0, magic.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (!magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('Hermes 備份缺少 ZIP 標頭')
}

/** Finish the staged MCC restore only when the imported Hermes state answers health checks. */
export async function restoreHermesBackup(
  archive: string,
  stageMcc: () => void,
  undoMcc: () => void,
  log: Log,
): Promise<void> {
  assertHermesZip(archive)
  await hermesService('stop')

  let staged = false
  let failure: unknown
  try {
    await runHermesCli(['import', archive, '--force'], NATIVE_BACKUP_TIMEOUT_MS)
    stageMcc()
    staged = true
  } catch (err) {
    failure = err
  }

  try {
    // Restart even when native import or MCC staging failed.
    await hermesService('start')
    await waitForHermesHealth({ detailed: true })
  } catch (err) {
    failure = failure
      ? new Error(`${(failure as Error).message}。Hermes 啟動檢查也失敗：${(err as Error).message}`)
      : err
  }

  if (failure) {
    if (staged) undoMcc()
    throw new Error(`${(failure as Error).message}。Hermes 資料可能已變更，MCC 資料庫尚未還原。`)
  }
  log('system', 'Hermes 還原完成，公開與驗證後的健康檢查均已通過')
}
