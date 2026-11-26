import { processMocks } from './helpers/offline-owner-mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { logTempRootFailureHint, tightenOpenclawTempRoots } from '@/lib/openclaw/temp-root-perms'
import { restartOpenclawGateway } from '@/lib/openclaw/restart-gateway'

let root: string
let cache: string
let state: string
let temp: string
let env: NodeJS.ProcessEnv
const mode = (dir: string) => fs.lstatSync(dir).mode & 0o7777
const setMode = (dir: string, value: number) => fs.chmodSync(dir, value)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'mcc-temp-root-'))
  cache = path.join(root, 'cache')
  state = path.join(root, 'state')
  temp = path.join(state, 'tmp')
  for (const dir of [cache, state, temp]) fs.mkdirSync(dir, { mode: 0o755 })
  env = { NODE_ENV: 'test', HOME: root, XDG_CACHE_HOME: cache, OPENCLAW_STATE_DIR: state }
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) env[key] = root
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('tightenOpenclawTempRoots', () => {
  it('only removes group/other write and reports changes once', () => {
    setMode(cache, 0o775)
    setMode(state, 0o777)
    setMode(temp, 0o1777)
    const log = vi.fn()
    tightenOpenclawTempRoots(log, env)
    tightenOpenclawTempRoots(log, env)
    expect([mode(cache), mode(state), mode(temp)]).toEqual([0o755, 0o755, 0o1755])
    expect(log.mock.calls.flat()).toEqual([
      'tightened ~/cache 775→755', 'tightened ~/state 777→755', 'tightened ~/state/tmp 1777→1755',
    ])
  })

  it('does not create missing roots or follow symlink candidates, including a linked state dir', () => {
    const target = path.join(root, 'state-target')
    fs.renameSync(state, target)
    fs.symlinkSync(target, state)
    setMode(target, 0o775)
    setMode(path.join(target, 'tmp'), 0o775)
    fs.rmSync(cache, { recursive: true })
    fs.symlinkSync(target, cache)
    const log = vi.fn()
    tightenOpenclawTempRoots(log, env)
    const missing = path.join(root, 'missing')
    tightenOpenclawTempRoots(log, { ...env, XDG_CACHE_HOME: missing })
    expect(fs.lstatSync(cache).isSymbolicLink()).toBe(true)
    expect(mode(target)).toBe(0o775)
    expect(mode(path.join(target, 'tmp'))).toBe(0o775)
    expect(fs.existsSync(missing)).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('skips directories with a different owner', () => {
    setMode(cache, 0o775)
    const log = vi.fn()
    tightenOpenclawTempRoots(log, env, fs.lstatSync(cache).uid + 1)
    expect(mode(cache)).toBe(0o775)
    expect(log).not.toHaveBeenCalled()
  })

  it('warns on chmod failure and continues with the other candidates', () => {
    setMode(state, 0o775)
    setMode(temp, 0o775)
    const chmod = vi.fn(fs.fchmodSync).mockImplementationOnce(() => { throw new Error('EACCES') })
    const log = vi.fn()
    expect(() => tightenOpenclawTempRoots(log, env, undefined, chmod)).not.toThrow()
    expect(mode(state)).toBe(0o775)
    expect(mode(temp)).toBe(0o755)
    expect(log).toHaveBeenCalledWith('Warning: could not tighten ~/state: EACCES')
  })
})

describe('gateway failure diagnostics', () => {
  it.each([
    ['Temp workspace ancestor is group/world writable without sticky protection', true],
    ['No safe OpenClaw temp root is available', true],
    ['Gateway exited for a different reason', false],
  ])('checks bounded journal output for %s', async (output, expected) => {
    processMocks.execFile.mockImplementationOnce((bin, args, options, callback) => {
      expect(bin).toBe('journalctl')
      expect(args).toEqual(['--user', '-u', 'openclaw-gateway.service', '--since=@12', '-n', '60', '--no-pager', '-o', 'cat'])
      expect(options).toEqual({ timeout: 5000, maxBuffer: 256 * 1024 })
      callback(null, output, '')
    })
    const log = vi.fn()
    await logTempRootFailureHint('openclaw-gateway.service', true, 12_345, log, env)
    if (expected) {
      expect(log).toHaveBeenCalledOnce()
      expect(log.mock.calls[0][0]).toContain('chmod go-w on writable private directories (~/cache, ~/state, ~/state/tmp)')
    } else {
      expect(log).not.toHaveBeenCalled()
    }
  })

  it('normalizes the restart environment before invoking the OpenClaw CLI', async () => {
    setMode(temp, 0o775)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    processMocks.execFile.mockImplementationOnce((bin, args, options, callback) => {
      expect(bin).toBe('systemctl')
      expect(args.slice(0, 3)).toEqual(['--user', 'show', 'openclaw-gateway.service'])
      expect(options.env).toBe(env)
      callback(null, 'LoadState=loaded\nActiveState=active\nTimeoutStopUSec=5min 30s\nTimeoutStartUSec=30s', '')
    })
    processMocks.execFile.mockImplementationOnce((bin, args, options, callback) => {
      expect(bin).toBe('openclaw')
      expect(args).toEqual(['gateway', 'restart'])
      expect(options.env).toBe(env)
      expect(options.timeout).toBe(395_000)
      expect(mode(temp)).toBe(0o755)
      callback(null, 'restarted', '')
    })
    await expect(restartOpenclawGateway({ timeout: 60_000, env })).resolves.toMatchObject({ stdout: 'restarted' })
  })
})
