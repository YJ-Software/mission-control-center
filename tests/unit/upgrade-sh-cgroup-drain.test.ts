import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server } from 'node:http'

/**
 * upgrade.sh 停 MCC 時，unit 是 KillMode=control-group：cgroup 內的 sudo apt-get 會一起被 SIGTERM，
 * 留下 dpkg interrupted。所以：
 *   1. stop 之前，cgroup 裡有 apt/dpkg 就先等它結束（有上限）；
 *   2. stop 之後等 cgroup.procs 清空（有上限）才換 current、再 start。
 * cgroup 與 /proc 用 CGROUP_ROOT / PROC_ROOT 指到假目錄，systemctl 是 stub。
 */

const SCRIPT = resolve(__dirname, '../../deploy/release/upgrade.sh')
const CG = '/test.slice/mission-control.service'
const execFileAsync = promisify(execFile)

let dir: string
let server: Server | null = null

function startHealth(servedFile: string): Promise<number> {
  return new Promise((res) => {
    server = createServer((req, resp) => {
      const v = existsSync(servedFile) ? readFileSync(servedFile, 'utf8').trim() : ''
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.end(JSON.stringify({ status: 'ok', mccVersion: v }))
    })
    server.listen(0, '127.0.0.1', () => res((server!.address() as { port: number }).port))
  })
}

function fixture(opts: { clearProcsAfterStop: boolean }) {
  const prefix = join(dir, 'mission-control')
  const state = join(dir, '.mission-control')
  mkdirSync(join(prefix, 'versions', 'v0.9.0'), { recursive: true })
  mkdirSync(join(state, 'data'), { recursive: true })
  symlinkSync(join(prefix, 'versions', 'v0.9.0'), join(prefix, 'current'))

  const cgroupRoot = join(dir, 'cgroup')
  const cgDir = join(cgroupRoot, CG)
  mkdirSync(cgDir, { recursive: true })
  const procs = join(cgDir, 'cgroup.procs')
  writeFileSync(procs, '4242\n4243\n')
  const procRoot = join(dir, 'proc')
  mkdirSync(join(procRoot, '4242'), { recursive: true })
  mkdirSync(join(procRoot, '4243'), { recursive: true })
  writeFileSync(join(procRoot, '4242', 'comm'), 'node\n')
  writeFileSync(join(procRoot, '4243', 'comm'), 'bash\n')

  const servedFile = join(dir, 'served-version')
  writeFileSync(servedFile, '0.9.0')
  const calls = join(dir, 'calls')

  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
args="$*"
case "$args" in
  *"show -p ControlGroup"*) echo "${CG}"; exit 0 ;;
esac
for a in "$@"; do
  if [[ "$a" == "stop" ]]; then
    echo "stop current=$(basename "$(readlink '${join(prefix, 'current')}')") procs=$(tr '\\n' ',' < '${procs}')" >> '${calls}'
    ${opts.clearProcsAfterStop ? `( sleep 1.5; : > '${procs}' ) >/dev/null 2>&1 &` : ''}
  fi
  if [[ "$a" == "start" || "$a" == "restart" ]]; then
    echo "$a current=$(basename "$(readlink '${join(prefix, 'current')}')") procs=$(tr '\\n' ',' < '${procs}')" >> '${calls}'
    printf '%s' 1.0.0 > '${servedFile}'
  fi
done
exit 0
`)
  chmodSync(join(bin, 'systemctl'), 0o755)

  const staging = join(dir, 'staging')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'version.json'), JSON.stringify({ mccVersion: '1.0.0' }))
  const tarball = join(dir, 'mission-control-v1.0.0-linux-x64.tar.gz')
  execFileSync('tar', ['czf', tarball, '-C', staging, '.'])

  return { prefix, state, bin, tarball, servedFile, calls, procs, procRoot, cgroupRoot }
}

async function runUpgrade(f: ReturnType<typeof fixture>, port: number, extra: Record<string, string> = {}) {
  writeFileSync(join(f.state, '.env.local'), `PORT=${port}\n`)
  const env = {
    ...process.env,
    PATH: `${f.bin}:${process.env.PATH}`,
    PREFIX: f.prefix,
    STATE: f.state,
    HEALTH_TIMEOUT: '5',
    // 不受跑測試那個 shell 自己的 cgroup 影響（例如從儀表板網頁終端機跑 npm test）
    SELF_CGROUP_FILE: '/nonexistent/cgroup',
    CGROUP_ROOT: f.cgroupRoot,
    PROC_ROOT: f.procRoot,
    ...extra,
  }
  try {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT, f.tarball], { encoding: 'utf8', env })
    return { out: stdout, err: stderr, ok: true }
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string }
    return { out: String(x.stdout ?? ''), err: String(x.stderr ?? ''), ok: false }
  }
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcc-upgrade-cg-')) })
afterEach(() => {
  server?.close(); server = null
  rmSync(dir, { recursive: true, force: true })
})

describe('upgrade.sh：stop 後等 cgroup 清空才換版、啟動', () => {
  it('stop 時 current 仍是舊版；cgroup 清空後才換 current 並 start（不是 restart）', async () => {
    const f = fixture({ clearProcsAfterStop: true })
    const port = await startHealth(f.servedFile)
    const r = await runUpgrade(f, port)

    expect(r.ok).toBe(true)
    expect(r.out).toContain('cgroup drained')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
    const calls = readFileSync(f.calls, 'utf8').trim().split('\n')
    expect(calls[0]).toBe('stop current=v0.9.0 procs=4242,4243,')
    expect(calls[1]).toBe('start current=v1.0.0 procs=')
    expect(calls.some((c) => c.startsWith('restart'))).toBe(false)
  }, 20_000)

  it('cgroup 遲遲不清空：到上限就警告並照常完成升級（不會永遠卡住）', async () => {
    const f = fixture({ clearProcsAfterStop: false })
    const port = await startHealth(f.servedFile)
    const r = await runUpgrade(f, port, { CGROUP_DRAIN_TIMEOUT: '2' })

    expect(r.err).toContain('cgroup still has processes after 2s')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
    const calls = readFileSync(f.calls, 'utf8').trim().split('\n')
    expect(calls[1]).toBe('start current=v1.0.0 procs=4242,4243,')
  }, 20_000)

  it('cgroup 裡有 apt-get 在跑：先等它結束才 stop', async () => {
    const f = fixture({ clearProcsAfterStop: true })
    writeFileSync(join(f.procRoot, '4243', 'comm'), 'apt-get\n')
    const port = await startHealth(f.servedFile)
    // 1.5 秒後 apt-get 結束（行程變回一般 bash）
    const t = setTimeout(() => writeFileSync(join(f.procRoot, '4243', 'comm'), 'bash\n'), 1500)
    const r = await runUpgrade(f, port)
    clearTimeout(t)

    expect(r.out).toContain('apt/dpkg is running inside mission-control (4243:apt-get )')
    expect(r.out).toContain('apt/dpkg finished')
    // stop 發生時 apt-get 已經結束
    expect(readFileSync(join(f.procRoot, '4243', 'comm'), 'utf8').trim()).toBe('bash')
    const out = r.out
    expect(out.indexOf('apt/dpkg finished')).toBeLessThan(out.indexOf('cgroup drained'))
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)

  it('apt-get 一直不結束：到上限就警告並照常 stop', async () => {
    const f = fixture({ clearProcsAfterStop: true })
    writeFileSync(join(f.procRoot, '4243', 'comm'), 'apt-get\n')
    const port = await startHealth(f.servedFile)
    const r = await runUpgrade(f, port, { APT_WAIT_TIMEOUT: '1' })

    expect(r.err).toContain('apt/dpkg still running after 1s')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)

  it('cgroup 裡有 sudo（第三方安裝腳本還沒進到 apt）也視為忙碌，先等', async () => {
    const f = fixture({ clearProcsAfterStop: true })
    writeFileSync(join(f.procRoot, '4243', 'comm'), 'sudo\n')
    const port = await startHealth(f.servedFile)
    const t = setTimeout(() => writeFileSync(join(f.procRoot, '4243', 'comm'), 'bash\n'), 1500)
    const r = await runUpgrade(f, port)
    clearTimeout(t)
    expect(r.out).toContain('(4243:sudo )')
    expect(r.out).toContain('apt/dpkg finished')
  }, 20_000)

  it('systemd 給不出 cgroup（舊版、cgroup v1）：直接 stop/start，不等待', async () => {
    const f = fixture({ clearProcsAfterStop: false })
    const port = await startHealth(f.servedFile)
    // 指到不存在的 cgroup 根目錄：讀不到 procs 就視為已清空
    const r = await runUpgrade(f, port, { CGROUP_ROOT: join(dir, 'nope') })

    expect(r.out).not.toContain('cgroup to drain')
    expect(r.out).not.toContain('apt/dpkg is running')
    // 保護沒生效時要說出來，而不是靜默跳過
    expect(r.out).toContain('cannot read')
    expect(r.out).toContain('skipping the apt/drain wait')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)
})
