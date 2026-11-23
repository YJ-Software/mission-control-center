import { execFile } from 'node:child_process'
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

function tempRootCandidates(env: NodeJS.ProcessEnv) {
  const home = homedir()
  const cache = env.XDG_CACHE_HOME?.trim()
  const state = env.OPENCLAW_STATE_DIR?.trim() || '.openclaw'
  const stateDir = path.resolve(home, state.replace(/^~(?=\/|$)/, home))
  return {
    cacheDir: cache && path.isAbsolute(cache)
      ? path.resolve(cache)
      : path.join(home, process.platform === 'darwin' ? 'Library/Caches' : '.cache'),
    stateDir,
    stateTmp: path.join(stateDir, 'tmp'),
  }
}

function displayPath(dir: string): string {
  const home = homedir()
  return dir.startsWith(home + path.sep) ? '~' + dir.slice(home.length) : dir
}

/** OpenClaw checks the ancestors of its SQLite temp root, including the cache
 * dir and the state fallback's tmp dir. Only tighten these private candidates. */
export function tightenOpenclawTempRoots(
  log: (text: string) => void,
  env = process.env,
  uid = process.getuid?.(),
  chmod = fchmodSync,
): void {
  if (uid === undefined) return
  const { cacheDir, stateDir, stateTmp } = tempRootCandidates(env)

  function tighten(dir: string): boolean {
    let isDirectory = false
    try {
      const initial = lstatSync(dir, { throwIfNoEntry: false })
      if (!initial?.isDirectory()) return false
      isDirectory = true
      if (initial.uid === uid && (initial.mode & 0o022) !== 0) {
        // Use the directory descriptor so a path swap cannot redirect chmod.
        const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
        try {
          const current = fstatSync(fd)
          if (current.uid === uid && current.dev === initial.dev && current.ino === initial.ino) {
            const before = current.mode & 0o7777
            const after = before & ~0o022
            if (after !== before) {
              chmod(fd, after)
              log(`tightened ${displayPath(dir)} ${before.toString(8)}→${after.toString(8)}`)
            }
          }
        } finally {
          closeSync(fd)
        }
      }
    } catch (err) {
      log(`Warning: could not tighten ${displayPath(dir)}: ${(err as Error).message}`)
    }
    return isDirectory
  }

  if (cacheDir !== stateDir && cacheDir !== stateTmp) tighten(cacheDir)
  if (tighten(stateDir)) tighten(stateTmp)
}

export async function logTempRootFailureHint(
  unit: string,
  userUnit: boolean,
  since: number,
  log: (text: string) => void,
  env = process.env,
): Promise<void> {
  const journal = await new Promise<string>((resolve) => {
    execFile('journalctl', [
      ...(userUnit ? ['--user'] : []), '-u', unit,
      `--since=@${Math.floor(since / 1000)}`, '-n', '60', '--no-pager', '-o', 'cat',
    ], { timeout: 5_000, maxBuffer: 256 * 1024 }, (_err, stdout) => resolve(stdout ?? ''))
  }).catch(() => '')
  if (!/without sticky protection|No safe OpenClaw temp root/i.test(journal)) return
  const dirs = [...new Set(Object.values(tempRootCandidates(env)))].map(displayPath).join(', ')
  log(`OpenClaw could not use a safe temp root. Have the owner run chmod go-w on writable private directories (${dirs}) or on the private ancestor named in the gateway journal, then retry. For an intentionally shared ancestor, use chmod +t instead.`)
}
