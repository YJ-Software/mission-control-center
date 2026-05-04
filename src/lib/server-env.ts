import { homedir } from 'os'
import { join } from 'path'

/**
 * Get process.env with extended PATH for server-side execFile calls.
 * Ensures ~/.local/bin (uv tools like nlm) and other common paths are included.
 */
export function getServerEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extraPaths = [
    join(home, '.local/bin'),
    join(home, '.cargo/bin'),
    join(home, '.npm-global/bin'),
    '/usr/local/bin',
  ]
  const currentPath = process.env.PATH || '/usr/bin:/bin'
  const pathSet = new Set([...extraPaths, ...currentPath.split(':')])

  return {
    ...process.env,
    HOME: home,
    PATH: [...pathSet].join(':'),
  }
}
