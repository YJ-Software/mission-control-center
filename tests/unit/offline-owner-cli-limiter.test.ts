import { gatewayMock, processMocks, ptySpawnMock } from './helpers/offline-owner-mocks'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runOpenclaw } from '@/lib/openclaw/models-config'
import { withOpenclawCli } from '@/lib/openclaw/cli-limiter'
import * as authProfiles from '@/lib/openclaw/auth-profiles'
import { buildDeviceCodeLoginJob, buildPasteApiKeyJob, realPluginProbe } from '@/lib/openclaw/auth-jobs'

it('releases slots on synchronous throws and rejected work', async () => {
  await Promise.all([
    expect(withOpenclawCli(() => { throw new Error('sync failure') })).rejects.toThrow('sync failure'),
    expect(withOpenclawCli(async () => { throw new Error('async failure') })).rejects.toThrow('async failure'),
  ])
  expect(await withOpenclawCli(async () => 'next')).toBe('next')
})

describe('shared OpenClaw CLI limit', () => {
  it('caps overlapping list/logout/plugin/config/paste-login processes at two and drains the queue', async () => {
    gatewayMock.mockRejectedValue(new Error('Gateway WebSocket not connected'))
    const dir = mkdtempSync(join(tmpdir(), 'cli-cap-'))
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ auth: { profiles: { 'kimi:manual': { provider: 'kimi', mode: 'api_key' } } } }))
    const readers = vi.spyOn(authProfiles, 'readProfiles').mockResolvedValue({ profiles: {} })
    let active = 0
    let peak = 0
    let started = 0
    const exits: (() => void)[] = []
    const start = (exit: () => void) => {
      started++
      active++
      peak = Math.max(peak, active)
      exits.push(() => { active--; exit() })
    }
    processMocks.spawn.mockImplementation((bin, args) => {
      expect(bin).toBe('openclaw')
      const child = new EventEmitter() as any
      child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
      child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
      child.stdin = { end() {} }
      child.kill = () => true
      start(() => {
        if (args.includes('list') && args.includes('auth')) child.stdout.emit('data', '{"profiles":[]}')
        child.emit('close', args.includes('get') ? 1 : 0)
      })
      return child
    })
    ptySpawnMock.mockImplementation((bin) => {
      expect(bin).toBe('openclaw')
      let onExit: (event: { exitCode: number }) => void
      start(() => onExit({ exitCode: 0 }))
      return { onData() {}, onExit(fn: typeof onExit) { onExit = fn } }
    })
    try {
      const log = vi.fn()
      const ctx = { setExtra: vi.fn() } as any
      const paste = buildPasteApiKeyJob({ provider: 'kimi', agent: 'main', apiKey: 'test-key', triggeredBy: 'api' })
      const pending = [
        runOpenclaw(['models', 'list']),
        runOpenclaw(['models', '--status-json']),
        authProfiles.listStoredProfiles('main', { configPath }),
        authProfiles.removeProfile('main', 'kimi:manual', { configPath }),
        realPluginProbe.listed('kimi'),
        paste.phases[1].inline!(log, ctx),
        paste.phases[3].inline!(log, ctx), // config get; then config set if absent
      ]
      await vi.waitFor(() => expect(started).toBe(2))
      expect(active).toBe(2)
      for (let completed = 0; completed < 8; completed++) {
        await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0))
        exits.shift()!()
      }
      await Promise.all(pending)
      expect(peak).toBe(2)
      expect(active).toBe(0)
      expect(started).toBe(8)
      expect(ptySpawnMock).not.toHaveBeenCalled()
    } finally {
      while (exits.length) exits.shift()!()
      readers.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('device-code PTY login does not wait for or occupy a CLI slot', async () => {
    const release: (() => void)[] = []
    const holders = [0, 1].map(() => withOpenclawCli(() => new Promise<void>((r) => release.push(r))))
    await vi.waitFor(() => expect(release.length).toBe(2))
    const readers = vi.spyOn(authProfiles, 'readProfiles').mockResolvedValue({ profiles: {} })
    let onExit: ((event: { exitCode: number }) => void) | undefined
    ptySpawnMock.mockImplementation(() => ({ onData() {}, onExit(fn: typeof onExit) { onExit = fn } }))
    try {
      const device = buildDeviceCodeLoginJob({ provider: 'kimi', agent: 'main', triggeredBy: 'api' })
      const login = device.phases[1].inline!(vi.fn(), { setExtra: vi.fn() } as any)
      await vi.waitFor(() => expect(ptySpawnMock).toHaveBeenCalledTimes(1))
      onExit!({ exitCode: 0 })
      await login
    } finally {
      release.forEach((r) => r())
      await Promise.all(holders)
      readers.mockRestore()
    }
  })
})
