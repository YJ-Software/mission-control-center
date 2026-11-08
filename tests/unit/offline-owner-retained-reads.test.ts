import { processMocks } from './helpers/offline-owner-mocks'
import { expect, it, vi } from 'vitest'
import { withOpenclawCli } from '@/lib/openclaw/cli-limiter'
import * as wiki from '@/lib/second-brain/wiki/cli'
import { GET as auditSecrets } from '@/app/api/setup/secrets/route'

vi.mock('@/lib/morning-report/openclaw', () => ({ findOpenclawBin: () => 'openclaw' }))
vi.mock('@/lib/server-env', () => ({ getServerEnv: () => ({}) }))

it.each([
  { args: ['wiki', 'status'], read: wiki.status, output: 'Wiki vault mode: isolated\nVault: ready (test-vault)' },
  { args: ['wiki', 'search', 'test'], read: () => wiki.search('test'), output: 'found' },
  { args: ['wiki', 'lint'], read: wiki.lint, output: 'ok' },
  { args: ['wiki', 'doctor'], read: wiki.doctor, output: 'ok' },
  { args: ['wiki', 'get', 'entity.test'], read: () => wiki.get('entity.test'), output: 'test page' },
  { args: ['secrets', 'audit', '--json'], read: auditSecrets, output: '{"findings":[]}' },
])('keeps retained read $args behind the shared CLI limiter', async ({ args, read, output }) => {
  processMocks.execFile.mockClear().mockImplementation((bin, actualArgs, _opts, callback) => {
    expect(bin).toBe('openclaw')
    expect(actualArgs).toEqual(args)
    callback(null, output, '')
  })
  const releases: (() => void)[] = []
  const holders = [0, 1].map(() => withOpenclawCli(() => new Promise<void>((resolve) => releases.push(resolve))))
  try {
    const pending = read()
    await Promise.resolve()
    expect(processMocks.execFile).not.toHaveBeenCalled()
    releases[0]()
    await pending
    expect(processMocks.execFile).toHaveBeenCalledTimes(1)
    expect(processMocks.execFile.mock.calls[0].slice(0, 2)).toEqual(['openclaw', args])
  } finally {
    releases.forEach((release) => release())
    await Promise.all(holders)
  }
})
