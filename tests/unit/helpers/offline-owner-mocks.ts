import { afterEach, expect, vi } from 'vitest'

// 每個行程入口預設拒絕執行；即使受測程式吞掉例外，afterEach 仍會讓測試失敗。
const mocks = vi.hoisted(() => {
  const unmocked: string[] = []
  const guard = (name: string) => vi.fn<(...args: any[]) => any>(() => {
    unmocked.push(name)
    throw new Error(`Unmocked child_process.${name}: refusing to run a real process`)
  })
  const cp = Object.fromEntries(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((name) => [name, guard(name)]))
  // Node 的 execFile promisify 會同時回傳 stdout/stderr；保留這個契約。
  Object.assign(cp.execFile, { [Symbol.for('nodejs.util.promisify.custom')]: (...args: any[]) => new Promise((resolve, reject) => {
    cp.execFile(...args, (err: Error | null, stdout: string, stderr: string) => err ? reject(err) : resolve({ stdout, stderr }))
  }) })
  return {
    unmocked,
    cp,
    rpc: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(() => { throw new Error('Unmocked gateway RPC') }),
    ptySpawn: guard('pty.spawn'),
  }
})
vi.mock('child_process', () => ({ ...mocks.cp, default: mocks.cp }))
vi.mock('node:child_process', () => ({ ...mocks.cp, default: mocks.cp }))
vi.mock('node-pty', () => ({ spawn: mocks.ptySpawn }))
vi.mock('@/lib/gateway-rpc', () => ({ gatewayRequest: mocks.rpc }))

afterEach(() => {
  const attempts = mocks.unmocked.splice(0)
  expect(attempts, 'No unmocked processes may run').toEqual([])
})

export const processMocks = mocks.cp
export const gatewayMock = mocks.rpc
export const ptySpawnMock = mocks.ptySpawn
