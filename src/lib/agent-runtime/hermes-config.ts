import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

export function hermesHome(): string {
  return process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
}

export function hermesBaseUrl(): string {
  return (process.env.HERMES_API_URL?.trim() || 'http://127.0.0.1:8642').replace(/\/+$/, '')
}

export function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return undefined
  }
}

function usableKey(value: string | undefined): value is string {
  return !!value && value.length >= 16 && !/^(?:[<{]|(?:your|replace|change|insert|paste|example|placeholder)[-_ ]|api[-_]server[-_]key$)/i.test(value)
}

export function resolveHermesConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = dotenvKey(keyAssignment(readOptionalFile(join(hermesHome(), '.env')) ?? ''))
  if (!usableKey(apiKey)) throw new Error('Hermes requires a usable API_SERVER_KEY in its .env')
  return { baseUrl: hermesBaseUrl(), apiKey }
}

// Consume whole assignments before looking at the next line. Quoted values can
// span lines, and dotenv files can also contain quoted keys.
const dotenvAssignments = /^[ \t]*(?:export[ \t]+)?([^=\r\n#]+?)[ \t]*=[ \t]*('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`[^`]*`|[^\r\n#]*)/gm

function keyAssignment(text: string) {
  return [...text.matchAll(dotenvAssignments)].findLast((match) => match[1] === 'API_SERVER_KEY')
}

function dotenvKey(assignment: RegExpExecArray | undefined): string | undefined {
  return assignment && parseEnv(`API_SERVER_KEY=${assignment[2]}`).API_SERVER_KEY?.trim()
}

export function ensureHermesDotenvKey(): boolean {
  const home = hermesHome()
  const path = join(home, '.env')
  const text = readOptionalFile(path) ?? ''
  const assignment = keyAssignment(text)
  if (usableKey(dotenvKey(assignment))) return false

  const key = randomBytes(32).toString('hex')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let updated: string
  if (assignment) {
    const line = assignment[0]
    const value = assignment[2]
    const suffix = text.slice(assignment.index + line.length)
    const trailingSpace = value.match(/[ \t]*$/)?.[0] || (suffix.startsWith('#') ? ' ' : '')
    const start = assignment.index + line.length - value.length
    updated = text.slice(0, start) + key + trailingSpace + suffix
  } else {
    updated = text + (text && !text.endsWith('\n') ? newline : '') + `API_SERVER_KEY=${key}${newline}`
  }

  mkdirSync(home, { recursive: true, mode: 0o700 })
  const staging = mkdtempSync(join(home, '.mcc-dotenv-'))
  try {
    const temp = join(staging, '.env')
    writeFileSync(temp, updated, { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, path)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return true
}
