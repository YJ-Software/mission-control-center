import { describe, expect, it, vi } from 'vitest'
import { guardAgentsDuring, waitForAgentOverride } from '@/lib/openclaw/config-guard'
import { writeAgentOverride } from '@/lib/openclaw/models-config'

const withModel = (model?: unknown) => ({ entries: { main: model === undefined ? {} : { model } } })

describe('waitForAgentOverride', () => {
  it('returns true once the third read matches, sleeping twice', async () => {
    const reads = [withModel(), withModel(), withModel({ primary: 'a/b' })]
    const read = vi.fn(async () => reads.shift())
    const sleep = vi.fn(async () => {})
    const ok = await waitForAgentOverride('main', { primary: 'a/b' }, { read, sleep })
    expect(ok).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('returns false on timeout', async () => {
    const read = vi.fn(async () => withModel({ primary: 'old' }))
    const sleep = vi.fn(async () => {})
    const ok = await waitForAgentOverride(
      'main', { primary: 'new' }, { read, sleep }, { timeoutMs: 2000, intervalMs: 500 },
    )
    expect(ok).toBe(false)
    expect(sleep).toHaveBeenCalledTimes(4)
  })

  it('caps the window by elapsed time, not just by sleeps, when each read is slow', async () => {
    // 10.7 on a 2 vCPU box: every read is a `config get` of several seconds.
    // Counting only sleeps let a 10 s window run 21 reads.
    let clock = 0
    const read = vi.fn(async () => {
      clock += 6_000
      return withModel({ primary: 'old' })
    })
    const sleep = vi.fn(async (ms: number) => { clock += ms })
    const ok = await waitForAgentOverride('main', { primary: 'new' }, { read, sleep, now: () => clock })
    expect(ok).toBe(false)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('treats a missing model as a match when expected is undefined', async () => {
    const sleep = vi.fn(async () => {})
    expect(await waitForAgentOverride('main', undefined, { read: async () => withModel(), sleep })).toBe(true)
    expect(
      await waitForAgentOverride('main', undefined, { read: async () => withModel({ primary: 'x' }) , sleep },
        { timeoutMs: 1000, intervalMs: 500 }),
    ).toBe(false)
  })

  it('works with the legacy list shape', async () => {
    const read = async () => ({ list: [{ id: 'main', model: { primary: 'a/b' } }] })
    expect(await waitForAgentOverride('main', { primary: 'a/b' }, { read, sleep: async () => {} })).toBe(true)
  })
})

describe('writeAgentOverride', () => {
  function makeDeps(persistOnWrite: number[]) {
    let state: unknown = withModel({ primary: 'old' })
    let writes = 0
    return {
      writes: () => writes,
      deps: {
        read: async () => state,
        write: async (_p: string, value: unknown) => {
          writes++
          if (persistOnWrite.includes(writes)) state = { entries: value }
        },
        sleep: async () => {},
      },
    }
  }

  it('rewrites once when the first write did not take effect', async () => {
    const { deps, writes } = makeDeps([2])
    await writeAgentOverride('main', undefined, deps)
    expect(writes()).toBe(2)
  })

  it('throws naming the agent when neither write persists', async () => {
    const { deps, writes } = makeDeps([])
    await expect(writeAgentOverride('main', undefined, deps)).rejects.toThrow(
      /agent override did not persist for main/,
    )
    expect(writes()).toBe(2)
  })

  it('writes only once when the first write persists', async () => {
    const { deps, writes } = makeDeps([1])
    await writeAgentOverride('main', undefined, deps)
    expect(writes()).toBe(1)
  })
})

describe('guardAgentsDuring', () => {
  const snapshot = { entries: { main: {} } }
  const clobbered = { entries: { main: { model: { primary: 'kimi/x' } } } }

  it('restores the snapshot when fn changed agents, returning fn result', async () => {
    let state: unknown = snapshot
    const writeAgents = vi.fn(async (v: unknown) => { state = v })
    const log = vi.fn()
    const out = await guardAgentsDuring(
      async () => { state = clobbered; return 42 },
      { readAgents: async () => state, writeAgents, log },
    )
    expect(out).toBe(42)
    expect(writeAgents).toHaveBeenCalledWith(snapshot)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('已還原'))
  })

  it('does not write when agents are unchanged', async () => {
    const writeAgents = vi.fn(async () => {})
    await guardAgentsDuring(async () => 1, {
      readAgents: async () => ({ entries: { a: { x: 1, y: 2 } } }), writeAgents, log: vi.fn(),
    })
    expect(writeAgents).not.toHaveBeenCalled()
  })

  it('rethrows fn errors without restoring', async () => {
    let state: unknown = snapshot
    const writeAgents = vi.fn(async () => {})
    await expect(
      guardAgentsDuring(async () => { state = clobbered; throw new Error('boom') },
        { readAgents: async () => state, writeAgents, log: vi.fn() }),
    ).rejects.toThrow('boom')
    expect(writeAgents).not.toHaveBeenCalled()
  })

  it('throws when the restore does not stick', async () => {
    let state: unknown = snapshot
    await expect(
      guardAgentsDuring(async () => { state = clobbered },
        { readAgents: async () => state, writeAgents: async () => {}, log: vi.fn() }),
    ).rejects.toThrow()
  })
})
