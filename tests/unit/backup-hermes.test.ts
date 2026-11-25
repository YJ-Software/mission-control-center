import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { processMocks } from './helpers/offline-owner-mocks'
import { stubHermesHome } from './helpers/hermes-test-home'
import type { JobSpec } from '@/lib/jobs/runner'
import native from './fixtures/hermes-0.21.5-reads.json'

vi.mock('@/lib/version', () => ({ getVersionInfo: () => ({ version: '0.4.10', mccVersion: '0.4.10' }) }))

const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const liveKey = 'fixture-live-key-0123456789'
const restoredKey = 'fixture-restored-key-0123456789'
let state: ReturnType<typeof stubHermesHome>
let bin: string
let dotenv: string
let order: string[]
let jobLogs: string[]
let job: JobSpec

beforeEach(() => {
  vi.resetModules()
  state = stubHermesHome()
  const dir = path.join(state.home, 'bin')
  fs.mkdirSync(dir)
  bin = path.join(dir, 'hermes')
  fs.writeFileSync(bin, '', { mode: 0o700 })
  vi.stubEnv('HERMES_BIN', bin)
  dotenv = path.join(state.hermes, '.env')
  fs.writeFileSync(dotenv, `API_SERVER_KEY=${liveKey}\n`)
  order = []
  jobLogs = []
})

afterEach(async () => {
  const { closeDb } = await import('@/lib/db')
  closeDb()
  const { setRunningLogId } = await import('@/lib/backup/lock')
  setRunningLogId(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  state.cleanup()
})

function startJob(spec: JobSpec) {
  job = spec
  return { id: 'fixture-job' } as ReturnType<typeof import('@/lib/jobs/runner')['startJob']>
}

async function runPhases() {
  try {
    for (const phase of job.phases) {
      const code = await phase.inline!((_stream, line) => jobLogs.push(line), { setExpectedVersion() {}, setExtra() {} })
      if (code !== 0) return code
    }
    return 0
  } finally {
    job.onSettled?.()
  }
}

function mockHealth(key = restoredKey) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url === 'http://127.0.0.1:8642/health') {
      order.push('health')
      return Response.json(native.health)
    }
    expect(url).toBe('http://127.0.0.1:8642/health/detailed')
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${key}`)
    order.push('detailed')
    return Response.json(native.detailedHealth)
  }))
}

function mockSystemctl(action: 'start' | 'stop') {
  return (file: string, args: string[], options: { env: NodeJS.ProcessEnv }, done: (error: Error | null, stdout: string, stderr: string) => void) => {
    expect([file, ...args]).toEqual(['systemctl', '--user', action, 'hermes-gateway.service'])
    expect(options.env.HOME).toBe(state.home)
    order.push(action)
    done(null, '', '')
  }
}

describe('Hermes native backup and restore through MCC', () => {
  it('packages a private native ZIP, MCC snapshot and env, then restores in gateway/MCC/readiness order', async () => {
    const { initDb, DB_PATH } = await import('@/lib/db')
    const { startBackupRun } = await import('@/lib/backup/run-backup')
    const { startRestore, describeBackup } = await import('@/lib/backup/run-restore')
    const { isBackupOrRestoreBusy } = await import('@/lib/backup/lock')
    const { parseManifest } = await import('@/lib/backup/archive-format')
    const { commitPendingDbRestore } = await import('@/lib/backup/mcc-state')
    initDb()
    const envPath = path.join(state.home, 'mcc.env')
    fs.writeFileSync(envPath, 'MCC_AGENT_RUNTIME=hermes\n')
    const outDir = path.join(state.home, 'backup')
    const file = path.join(outDir, 'mcc-backup_hermes_fixture_20261126_000000.tar.gz')
    const members = new Map<string, Buffer>()
    mockHealth()

    processMocks.execFile
      .mockImplementationOnce((cmd, args, opts, done) => {
        expect(cmd).toBe(bin)
        expect(args.slice(0, 2)).toEqual(['backup', '--output'])
        expect(opts.env.HERMES_HOME).toBe(state.hermes)
        expect(path.basename(args[2])).toBe('hermes.zip')
        expect(fs.statSync(path.dirname(args[2])).mode & 0o777).toBe(0o700)
        fs.writeFileSync(args[2], zip, { mode: 0o664 })
        order.push('backup')
        done(null, '', '')
      })
      .mockImplementationOnce((cmd, args, _opts, done) => {
        expect(cmd).toBe('tar')
        expect(args[0]).toBe('czf')
        const stage = args[args.indexOf('-C') + 1]
        expect(fs.statSync(path.join(stage, 'hermes.zip')).mode & 0o777).toBe(0o600)
        for (const member of fs.readdirSync(stage)) members.set(member, fs.readFileSync(path.join(stage, member)))
        fs.writeFileSync(args[1], 'mocked outer tar', { mode: 0o664 })
        order.push('package')
        done(null, '', '')
      })

    startBackupRun({ triggeredBy: 'api' }, {
      startJob, dbPath: DB_PATH, envPath, now: () => new Date(2026, 10, 26), hostname: () => 'fixture',
      findBlockingJob: () => null,
      openclawCreate: async () => { throw new Error('OpenClaw backup called in Hermes mode') },
    })
    expect(isBackupOrRestoreBusy()).toBe(true)
    expect(await runPhases()).toBe(0)
    expect(order).toEqual(['backup', 'health', 'package'])
    expect([...members.keys()].sort()).toEqual(['hermes.zip', 'manifest.json', 'mcc.env', 'mcc.sqlite'])
    expect(parseManifest(JSON.parse(String(members.get('manifest.json'))))).toMatchObject({
      format: 1, backend: 'hermes', backendVersion: native.health.version,
      parts: { backend: 'hermes.zip', mccDb: 'mcc.sqlite', mccEnv: 'mcc.env' },
    })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(outDir)).toEqual([path.basename(file)])
    expect(isBackupOrRestoreBusy()).toBe(false)

    const tar = async (args: string[]) => {
      if (args.includes('-xOzf')) return String(members.get('manifest.json'))
      if (args.includes('-tzf')) return [...members.keys()].join('\n')
      if (args.includes('-tzvf')) return [...members.keys()].map((name) => `-rw------- fixture ${name}`).join('\n')
      expect(args).toContain('-xzf')
      const target = args[args.indexOf('-C') + 1]
      for (const [name, buffer] of members) fs.writeFileSync(path.join(target, name), buffer)
      return ''
    }

    expect((await describeBackup(file, { tar })).manifest?.backend).toBe('hermes')
    processMocks.execFile
      .mockImplementationOnce(mockSystemctl('stop'))
      .mockImplementationOnce((cmd, args, opts, done) => {
        expect(cmd).toBe(bin)
        expect(args).toEqual(['import', expect.stringMatching(/\/hermes\.zip$/), '--force'])
        expect(opts.env.HERMES_HOME).toBe(state.hermes)
        expect(fs.readFileSync(args[1])).toEqual(zip)
        fs.writeFileSync(dotenv, `API_SERVER_KEY=${restoredKey}\n`)
        order.push('import')
        done(null, '', '')
      })
      .mockImplementationOnce(mockSystemctl('start'))
    order = []
    const never = () => { throw new Error('OpenClaw restore path used') }
    startRestore(file, 'api', {
      startJob, tar, dbPath: DB_PATH, workRoot: state.home, findBlockingJob: () => null,
      getInstall: () => ({ mode: 'dev', service: 'fixture-mcc' }),
      commitDb: (dbPath) => { commitPendingDbRestore(dbPath); order.push('stage-mcc') },
      openclawVerify: never, openclawRestore: never, gatewayPreflight: never, recheckLegacyCron: never,
    })
    expect(await runPhases()).toBe(0)
    expect(order).toEqual(['stop', 'import', 'stage-mcc', 'start', 'health', 'detailed'])
    expect(fs.statSync(`${DB_PATH}.restore-pending`).mode & 0o777).toBe(0o600)
    expect(jobLogs.join('\n')).toContain('健康檢查均已通過')
    expect(jobLogs.join('\n')).toContain('需手動重啟 MCC')
    expect(isBackupOrRestoreBusy()).toBe(false)
  })

  it('probes the native CLI discovered on PATH without consulting OpenClaw', async () => {
    const { getBackupAvailability } = await import('@/lib/backup/availability')
    vi.stubEnv('HERMES_BIN', undefined)
    vi.stubEnv('PATH', path.dirname(bin))
    processMocks.execFile.mockImplementationOnce((cmd, args, opts, done) => {
      expect(cmd).toBe(bin)
      expect(args).toEqual(['backup', '--help'])
      expect(opts.env.HERMES_HOME).toBe(state.hermes)
      done(null, 'mock help', '')
    })
    const openclaw = vi.fn()
    await expect(getBackupAvailability({ run: openclaw })).resolves.toEqual({ available: true, reason: null })
    expect(openclaw).not.toHaveBeenCalled()
  })

  it('rejects OpenClaw archives and an invalid native ZIP before stopping anything', async () => {
    const { describeBackup, startRestore } = await import('@/lib/backup/run-restore')
    const { restoreHermesBackup } = await import('@/lib/backup/hermes-backend')
    const oldManifest = {
      format: 1, backend: 'openclaw', backendVersion: null, mccVersion: '0.4.10',
      createdAt: '2026-11-26', hostname: 'fixture', parts: { backend: null, mccDb: 'mcc.sqlite', mccEnv: null },
    }
    await expect(describeBackup(path.join(state.home, 'mcc-backup_openclaw_fixture.tar.gz'), {
      tar: async () => JSON.stringify(oldManifest),
    })).rejects.toThrow('目前只支援 hermes')
    expect(() => startRestore(path.join(state.home, 'openclaw-backup_fixture.tar.gz'), 'api')).toThrow('此後端不支援')
    const invalid = path.join(state.home, 'invalid.zip')
    fs.writeFileSync(invalid, 'not a zip')
    const stageMcc = vi.fn()
    await expect(restoreHermesBackup(invalid, stageMcc, vi.fn(), vi.fn())).rejects.toThrow('ZIP 標頭')
    expect(stageMcc).not.toHaveBeenCalled()
  })

  it('starts Hermes after a failed import and leaves MCC unstaged', async () => {
    const { restoreHermesBackup } = await import('@/lib/backup/hermes-backend')
    const archive = path.join(state.home, 'hermes.zip')
    fs.writeFileSync(archive, zip)
    mockHealth(liveKey)
    processMocks.execFile
      .mockImplementationOnce(mockSystemctl('stop'))
      .mockImplementationOnce((cmd, args, _opts, done) => {
        expect([cmd, ...args]).toEqual([bin, 'import', archive, '--force'])
        order.push('failed-import')
        done(Object.assign(new Error('redacted fixture'), { code: 1 }), '', 'private fixture output')
      })
      .mockImplementationOnce(mockSystemctl('start'))
    const stage = vi.fn()
    const undo = vi.fn()
    await expect(restoreHermesBackup(archive, stage, undo, vi.fn())).rejects.toThrow('MCC 資料庫尚未還原')
    expect(order).toEqual(['stop', 'failed-import', 'start', 'health', 'detailed'])
    expect(stage).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
  })

  it.each([{ code: 1 }, { code: null, signal: 'SIGTERM', killed: true }])(
    'attempts start and authenticated readiness after a stop error %j',
    async (failure) => {
      const { restoreHermesBackup } = await import('@/lib/backup/hermes-backend')
      const archive = path.join(state.home, 'hermes.zip')
      fs.writeFileSync(archive, zip)
      mockHealth(liveKey)
      processMocks.execFile
        .mockImplementationOnce((cmd, args, opts, done) => {
          expect([cmd, ...args]).toEqual(['systemctl', '--user', 'stop', 'hermes-gateway.service'])
          expect(opts.timeout).toBe(120_000)
          order.push('failed-stop')
          done(Object.assign(new Error('fixture stop failure'), failure), '', '')
        })
        .mockImplementationOnce(mockSystemctl('start'))
      const stage = vi.fn()
      const undo = vi.fn()
      await expect(restoreHermesBackup(archive, stage, undo, vi.fn())).rejects.toThrow(
        `Hermes gateway stop failed (${failure.code ?? failure.signal})`,
      )
      expect(order).toEqual(['failed-stop', 'start', 'health', 'detailed'])
      expect(stage).not.toHaveBeenCalled()
      expect(undo).not.toHaveBeenCalled()
    },
  )

  it('preserves both the stop and recovery errors', async () => {
    const { restoreHermesBackup } = await import('@/lib/backup/hermes-backend')
    const archive = path.join(state.home, 'hermes.zip')
    fs.writeFileSync(archive, zip)
    mockHealth(liveKey)
    processMocks.execFile
      .mockImplementationOnce((_cmd, _args, _opts, done) => done(Object.assign(new Error('stop failed'), { code: 1 }), '', ''))
      .mockImplementationOnce((_cmd, _args, _opts, done) => done(Object.assign(new Error('start failed'), { code: 2 }), '', ''))
    await expect(restoreHermesBackup(archive, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'Hermes gateway stop failed (1)。Hermes gateway start failed (2)',
    )
    expect(order).toEqual(['health', 'detailed'])
  })

  it('undoes pending MCC staging if the restored Hermes service fails to start', async () => {
    const { restoreHermesBackup } = await import('@/lib/backup/hermes-backend')
    const archive = path.join(state.home, 'hermes.zip')
    fs.writeFileSync(archive, zip)
    mockHealth(liveKey)
    processMocks.execFile
      .mockImplementationOnce(mockSystemctl('stop'))
      .mockImplementationOnce((_cmd, _args, _opts, done) => done(null, '', ''))
      .mockImplementationOnce((_cmd, _args, _opts, done) => done(Object.assign(new Error('start failed'), { code: 1 }), '', ''))
    const stage = vi.fn()
    const undo = vi.fn()
    await expect(restoreHermesBackup(archive, stage, undo, vi.fn())).rejects.toThrow('Hermes gateway start failed')
    expect(stage).toHaveBeenCalledOnce()
    expect(undo).toHaveBeenCalledOnce()
  })
})

it('runs scheduled MCC backups in Hermes mode without legacy OpenClaw cron cleanup', async () => {
  const { startBackupScheduler } = await import('@/lib/backup/scheduler')
  const start = vi.fn<() => 'started'>(() => 'started')
  const cleanup = vi.fn(async () => true)
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date(2026, 10, 26, 2, 59))
    startBackupScheduler({
      skipLegacyCron: true,
      jobs: () => [{ id: 'fixture-scheduled', enabled: 1, scheduleType: 'daily', scheduleConfig: { time: '03:00', days: [4] } }],
      isRunning: () => false,
      start,
      cleanLegacy: cleanup,
      log: () => {},
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(start).toHaveBeenCalledWith('fixture-scheduled')
    expect(cleanup).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
    delete (globalThis as Record<string, unknown>).__mccBackupSchedulerStarted
  }
})
