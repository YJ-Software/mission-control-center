import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, type Server } from 'node:http'

/**
 * 從 MCC 的網頁終端機跑 upgrade.sh 時，shell 在 mission-control 的 cgroup 裡：`systemctl stop` 會先殺掉
 * 腳本自己，current 沒換、服務也沒啟動，儀表板停機。腳本要偵測 /proc/self/cgroup，轉交給 systemd-run
 * 的獨立 transient unit；沒有 systemd-run 就拒絕並請改用 SSH。不在 cgroup 裡（SSH、OCD）照原流程。
 */

const SCRIPT = resolve(__dirname, '../../deploy/release/upgrade.sh')
const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/mission-control.service'
const execFileAsync = promisify(execFile)

let dir: string
let server: Server | null = null

function startHealth(servedFile: string): Promise<number> {
  return new Promise((res) => {
    server = createServer((_req, resp) => {
      const v = existsSync(servedFile) ? readFileSync(servedFile, 'utf8').trim() : ''
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.end(JSON.stringify({ status: 'ok', mccVersion: v }))
    })
    server.listen(0, '127.0.0.1', () => res((server!.address() as { port: number }).port))
  })
}

function fixture(opts: { showCgroup: boolean }) {
  const prefix = join(dir, 'mission-control')
  const state = join(dir, '.mission-control')
  mkdirSync(join(prefix, 'versions', 'v0.9.0'), { recursive: true })
  mkdirSync(join(state, 'data'), { recursive: true })
  symlinkSync(join(prefix, 'versions', 'v0.9.0'), join(prefix, 'current'))
  const servedFile = join(dir, 'served-version')
  writeFileSync(servedFile, '0.9.0')
  const calls = join(dir, 'calls')
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
case "$*" in
  *"show -p ControlGroup"*) ${opts.showCgroup ? `echo "${CG}"` : 'true'}; exit 0 ;;
esac
for a in "$@"; do
  case "$a" in
    stop|start|restart) echo "systemctl $a" >> '${calls}' ;;
  esac
  if [[ "$a" == "start" || "$a" == "restart" ]]; then printf '%s' 1.0.0 > '${servedFile}'; fi
done
exit 0
`)
  chmodSync(join(bin, 'systemctl'), 0o755)
  const systemdRun = join(bin, 'fake-systemd-run')
  writeFileSync(systemdRun, `#!/usr/bin/env bash
printf '%s\\n' "$@" > '${join(dir, 'systemd-run-args')}'
echo "Running as unit: fake.service"
exit 0
`)
  chmodSync(systemdRun, 0o755)

  const staging = join(dir, 'staging')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'version.json'), JSON.stringify({ mccVersion: '1.0.0' }))
  const tarball = join(dir, 'mission-control-v1.0.0-linux-x64.tar.gz')
  execFileSync('tar', ['czf', tarball, '-C', staging, '.'])
  const selfCgroup = join(dir, 'self-cgroup')
  return { prefix, state, bin, tarball, calls, systemdRun, selfCgroup, servedFile }
}

async function run(f: ReturnType<typeof fixture>, port: number, selfCgroupLine: string | null, extra: Record<string, string> = {}) {
  if (selfCgroupLine !== null) writeFileSync(f.selfCgroup, selfCgroupLine + '\n')
  writeFileSync(join(f.state, '.env.local'), `PORT=${port}\n`)
  const env = {
    ...process.env,
    PATH: `${f.bin}:${process.env.PATH}`,
    PREFIX: f.prefix,
    STATE: f.state,
    HEALTH_TIMEOUT: '5',
    SELF_CGROUP_FILE: selfCgroupLine === null ? join(dir, 'missing') : f.selfCgroup,
    SYSTEMD_RUN: f.systemdRun,
    CGROUP_ROOT: join(dir, 'no-cgroupfs'),
    ...extra,
  }
  try {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT, f.tarball], { encoding: 'utf8', env })
    return { ok: true, out: stdout, err: stderr }
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string }
    return { ok: false, out: String(x.stdout ?? ''), err: String(x.stderr ?? '') }
  }
}

const systemctlCalls = (f: ReturnType<typeof fixture>) => (existsSync(f.calls) ? readFileSync(f.calls, 'utf8') : '')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcc-upgrade-self-')) })
afterEach(() => {
  server?.close(); server = null
  rmSync(dir, { recursive: true, force: true })
})

describe('upgrade.sh：在 mission-control 自己的 cgroup 裡執行', () => {
  it('在服務 cgroup 底下（網頁終端機的子 cgroup）→ 轉交 systemd-run，自己不 stop、exit 0', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `0::${CG}/pty-1`)

    expect(r.ok).toBe(true)
    expect(r.out).toMatch(/升級已轉交 systemd 背景執行（unit: mission-control-upgrade-\d{14}），查看進度：journalctl --user -u mission-control-upgrade-\d{14} -f/)
    expect(systemctlCalls(f)).toBe('')
    const args = readFileSync(join(dir, 'systemd-run-args'), 'utf8').trim().split('\n')
    expect(args.slice(0, 3)).toEqual(['--user', '--collect', '--unit'])
    expect(args[3]).toMatch(/^mission-control-upgrade-\d{14}$/)
    expect(args).toContain('--setenv=MCC_UPGRADE_DETACHED=1')
    expect(args).toContain(`--setenv=PREFIX=${f.prefix}`)
    expect(args.slice(-3)).toEqual(['bash', SCRIPT, f.tarball])
    // 還沒動任何東西：沒有解壓、current 沒變
    expect(existsSync(join(f.prefix, 'versions', 'v1.0.0'))).toBe(false)
  }, 20_000)

  it('就在服務 cgroup 本身也轉交', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `0::${CG}`)
    expect(r.out).toContain('升級已轉交')
    expect(systemctlCalls(f)).toBe('')
  }, 20_000)

  it('systemd 給不出 unit 的 cgroup 時，以 unit 名稱比對', async () => {
    const f = fixture({ showCgroup: false })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `0::${CG}`)
    expect(r.out).toContain('升級已轉交')
  }, 20_000)

  it('在服務 cgroup 裡但沒有 systemd-run → 拒絕並請改用 SSH，不 stop', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `0::${CG}`, { SYSTEMD_RUN: '' })
    expect(r.ok).toBe(false)
    expect(r.err).toContain('run upgrade.sh over SSH instead')
    expect(systemctlCalls(f)).toBe('')
  }, 20_000)

  it('SSH／OCD（不在服務 cgroup）→ 原流程 stop → start，不轉交', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, '0::/user.slice/user-1000.slice/session-3.scope')
    expect(r.ok).toBe(true)
    expect(r.out).not.toContain('升級已轉交')
    expect(existsSync(join(dir, 'systemd-run-args'))).toBe(false)
    expect(systemctlCalls(f)).toBe('systemctl stop\nsystemctl start\n')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)

  it('名稱只是前綴相同的其他 unit（mission-control-foo.service）不算', async () => {
    const f = fixture({ showCgroup: false })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, '0::/user.slice/user-1000.slice/user@1000.service/app.slice/mission-control-foo.service')
    expect(r.out).not.toContain('升級已轉交')
    expect(systemctlCalls(f)).toContain('systemctl stop')
  }, 20_000)

  it('轉交後的那一次（MCC_UPGRADE_DETACHED=1）不再轉交', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `0::${CG}`, { MCC_UPGRADE_DETACHED: '1' })
    expect(r.out).not.toContain('升級已轉交')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)

  it('讀不到 /proc/self/cgroup（沒有 systemd 的環境）→ 安靜跳過偵測', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, null)
    expect(r.out).not.toContain('升級已轉交')
    expect(r.err).not.toContain('cgroup')
    expect(r.out).toContain('upgraded to Mission Control v1.0.0')
  }, 20_000)

  it('cgroup v1：取 name=systemd 那行比對', async () => {
    const f = fixture({ showCgroup: true })
    const port = await startHealth(f.servedFile)
    const r = await run(f, port, `12:cpu,cpuacct:/\n1:name=systemd:${CG}`)
    expect(r.out).toContain('升級已轉交')
  }, 20_000)
})
