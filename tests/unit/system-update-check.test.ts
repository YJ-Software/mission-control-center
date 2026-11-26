import { processMocks } from './helpers/offline-owner-mocks'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GET } from '@/app/api/upgrade/system-check/route'
import { invalidateAptCheck } from '@/lib/system-update/check'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync) }
})

const actualFs = await vi.importActual<typeof fs>('node:fs')
const aptCheck = '/usr/lib/update-notifier/apt-check'
const rebootFlag = '/var/run/reboot-required'
const rebootPkgs = '/var/run/reboot-required.pkgs'
let home: string
let aptExists: boolean
let rebootRequired: boolean
type Complete = (err: Error | null, stdout: string, stderr: string) => void

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-apt-check-'))
  for (const key of [
    'HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'OPENCLAW_STATE_DIR',
  ]) vi.stubEnv(key, home)
  vi.useFakeTimers()
  invalidateAptCheck()
  processMocks.execFile.mockClear()
  aptExists = true
  rebootRequired = false
  vi.mocked(fs.existsSync).mockImplementation(file => {
    if (file === aptCheck) return aptExists
    if (file === rebootFlag || file === rebootPkgs) return rebootRequired
    return actualFs.existsSync(file)
  })
  vi.mocked(fs.readFileSync).mockImplementation((file, options) =>
    file === rebootPkgs ? ' linux-image-generic\n\n' : actualFs.readFileSync(file, options as 'utf8'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  fs.rmSync(home, { recursive: true, force: true })
})

function mockApt(run: (finish: Complete) => void) {
  processMocks.execFile.mockImplementationOnce((file, args, options, finish) => {
    expect(file).toBe(aptCheck)
    expect(args).toEqual([])
    expect(options).toMatchObject({ timeout: 30_000, env: { HOME: home } })
    run(finish)
  })
}

const check = async () => (await GET()).json()

it('shares one apt process and caches its stderr counts for 30 minutes while reading reboot flags live', async () => {
  let complete!: Complete
  mockApt(finish => { complete = finish })
  const first = check()
  const second = check()
  expect(processMocks.execFile).toHaveBeenCalledOnce()
  complete(null, '100;100', '28;7')
  const initial = { manager: 'apt', updates: 28, security: 7, rebootRequired: false, rebootPackages: [] }
  await expect(Promise.all([first, second])).resolves.toEqual([initial, initial])
  vi.advanceTimersByTime(30 * 60_000 - 1)
  rebootRequired = true
  await expect(check()).resolves.toEqual({
    ...initial, rebootRequired: true, rebootPackages: ['linux-image-generic'],
  })
  expect(processMocks.execFile).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(1)
  mockApt(finish => finish(null, '', '0;0'))
  await expect(check()).resolves.toMatchObject({ manager: 'apt', updates: 0, security: 0 })
  expect(processMocks.execFile).toHaveBeenCalledTimes(2)
})

it('refreshes after invalidation without overlapping an older apt process or caching its stale output', async () => {
  let complete!: Complete
  mockApt(finish => { complete = finish })
  const first = check()
  invalidateAptCheck()
  const second = check()
  expect(processMocks.execFile).toHaveBeenCalledOnce()
  mockApt(finish => finish(null, '', '2;1'))
  complete(null, '', '30;20')
  const results = await Promise.all([first, second, check()])
  expect(results.map(({ updates, security }) => [updates, security])).toEqual([[2, 1], [2, 1], [2, 1]])
  expect(processMocks.execFile).toHaveBeenCalledTimes(2)
})

it.each(['missing', 'invalid counts', 'command failed'])('caches an unknown result when apt-check is %s', async reason => {
  aptExists = reason !== 'missing'
  if (aptExists) mockApt(finish => finish(reason === 'command failed' ? new Error('apt failure') : null, '', 'unknown'))
  const unknown = { manager: null, updates: 0, security: 0, rebootRequired: false, rebootPackages: [] }
  await expect(check()).resolves.toEqual(unknown)
  await expect(check()).resolves.toEqual(unknown)
  expect(processMocks.execFile).toHaveBeenCalledTimes(aptExists ? 1 : 0)
})
