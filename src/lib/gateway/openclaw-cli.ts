/**
 * Helpers for spawning the `openclaw` CLI from the server (pure, unit-tested).
 */
import { dirname } from 'path'

/**
 * Env for an `openclaw` child process: the running node's own bin dir goes
 * first on PATH. An nvm-installed openclaw is a `#!/usr/bin/env node` script,
 * and under systemd nvm's node dir is not on PATH, so without this the CLI
 * dies with "env: node: No such file or directory" — on every retry, forever.
 */
export function openclawCliEnv<T extends Record<string, string | undefined>>(base: T, execPath: string): T {
  const nodeDir = dirname(execPath)
  const parts = (base.PATH ?? '').split(':').filter((p) => p && p !== nodeDir)
  return { ...base, PATH: [nodeDir, ...parts].join(':') }
}

export const CLI_ERROR_STDERR_MAX = 500

/**
 * One-line description of a failed execFile call: exit code, signal, whether
 * our timeout killed it, and stderr collapsed to a single truncated line.
 * execFile's own message is "Command failed: <cmd>\n<whole stderr>" — multi-
 * line, often led by a clack "Doctor warnings" box, and silent on exit code /
 * timeout, so a 10s timeout and a real failure looked the same in the log.
 */
export function describeCliError(step: string, err: unknown, max = CLI_ERROR_STDERR_MAX): string {
  const e = (err ?? {}) as {
    code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown; message?: unknown; name?: unknown
  }
  if (e.name === 'AbortError') return `${step} aborted`
  const exit = typeof e.code === 'number' || typeof e.code === 'string' ? String(e.code) : 'null'
  const signal = typeof e.signal === 'string' ? e.signal : 'null'
  const killed = e.killed === true
  const rawStderr = typeof e.stderr === 'string' && e.stderr.trim()
    ? e.stderr
    : typeof e.message === 'string' ? e.message : String(err)
  // Strip box-drawing / ANSI noise and collapse whitespace into one line.
  // eslint-disable-next-line no-control-regex
  let text = rawStderr.replace(/\x1b\[[0-9;]*m/g, '').replace(/[│┃┌┐└┘├┤─━◇◆●]/g, ' ').replace(/\s+/g, ' ').trim()
  if (text.length > max) text = `${text.slice(0, max)}…`
  return `${step} failed: exit=${exit} signal=${signal} killed=${killed} stderr="${text}"`
}
