import { expect, type APIRequestContext } from '@playwright/test'
import { sshExec } from '../../../scripts/e2e/twnoc/lib/ssh.mjs'

const nativeRequest = String.raw`
import json, pathlib, re, sys, urllib.error, urllib.request
method, path, data, headers, approval = json.loads(sys.argv[1])
dotenv = (pathlib.Path.home() / '.hermes/.env').read_text()
key = re.search(r'^API_SERVER_KEY\s*=([^\r\n]+)', dotenv, re.M)[1].strip().strip('"\'')
headers.update({'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})

def call(method, path, data=None):
    request = urllib.request.Request('http://127.0.0.1:8642' + path, method=method, headers=headers,
        data=None if data is None else json.dumps(data).encode())
    try:
        return urllib.request.urlopen(request, timeout=100)
    except urllib.error.HTTPError as error:
        return error

with call(method, path, data) as response:
    if response.headers.get_content_type() == 'text/event-stream':
        events = []
        control = None
        for line in response:
            if not line.startswith(b'data: '):
                continue
            event = json.loads(line[6:])
            events.append(event)
            if approval and event.get('event') == 'approval.request' and control is None:
                run_path = path.removesuffix('/events')
                with call('GET', run_path) as waiting:
                    state = json.load(waiting)
                with call('POST', run_path + '/approval', {'choice': approval, 'request_id': event['request_id']}) as answer:
                    control = {'waiting': state, 'status': answer.status, 'body': json.load(answer)}
        body = {'events': events, 'control': control} if approval else events
    else:
        body = json.load(response)
    print(json.dumps({'status': response.status, 'body': body}))
`

export async function requireHermes(request: APIRequestContext, baseURL: string | undefined) {
  const { E2E_SSH_HOST, HERMES_E2E_TUNNEL_PORT } = process.env
  const url = baseURL ? new URL(baseURL) : undefined
  const isTunnel = url?.protocol === 'http:' && url.hostname === 'localhost' &&
    !!HERMES_E2E_TUNNEL_PORT && url.port === HERMES_E2E_TUNNEL_PORT && url.port !== '3737'
  if (!E2E_SSH_HOST || (url?.hostname !== E2E_SSH_HOST && !isTunnel)) {
    throw new Error('Set PLAYWRIGHT_BASE_URL to the Hermes throwaway or its explicit localhost SSH tunnel port')
  }
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect((await health.json()).backend?.kind).toBe('hermes')
}

function quote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export async function onHermes<T>(script: string, args: string[] = [], timeoutMs = 25_000): Promise<T> {
  const { E2E_SSH_HOST: host, E2E_SSH_USER: user, E2E_SSH_KEY: keyPath } = process.env
  if (!host || !user || !keyPath) throw new Error('Set E2E_SSH_HOST, E2E_SSH_USER, and E2E_SSH_KEY')
  const command = 'cd / && sudo -u hermes -H env XDG_RUNTIME_DIR=/run/user/$(id -u hermes) ' +
    'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u hermes)/bus ' +
    ['/opt/hermes/.venv/bin/python', '-c', script, ...args].map(quote).join(' ')
  const { code, stdout, stderr } = await sshExec({ host, user, keyPath, command, timeoutMs })
  if (code !== 0) {
    // Only include the exception class. Remote diagnostics may contain config values.
    const errorType = stderr.trim().split('\n').at(-1)?.match(/^([\w.]+):/)?.[1]
    throw new Error(`Hermes SSH command failed (exit ${code}${errorType ? `, ${errorType}` : ''})`)
  }
  try {
    return JSON.parse(stdout) as T
  } catch {
    throw new Error('Hermes SSH command returned invalid JSON')
  }
}

export function hermesApi<T>(method: string, path: string, data?: unknown, headers = {}, approval?: 'deny') {
  return onHermes<{ status: number; body: T }>(
    nativeRequest, [JSON.stringify([method, path, data ?? null, headers, approval ?? null])],
    path.endsWith('/events') ? 110_000 : 25_000,
  )
}

export async function native<T>(method: string, path: string, status = 200, data?: unknown, headers = {}) {
  const response = await hermesApi<T>(method, path, data, headers)
  expect(response.status, `${method} ${path}`).toBe(status)
  return response.body
}

export function unitPid(unit: 'hermes-gateway' | 'mission-control') {
  return onHermes<number>(`
import subprocess, sys
print(int(subprocess.check_output(['systemctl', '--user', 'show', '--value', '-p', 'MainPID', sys.argv[1]])))
`, [unit])
}

export async function expectJobSuccess(request: APIRequestContext, id: string, timeout = 90_000) {
  let status: string | undefined
  await expect.poll(async () => {
    try {
      const response = await request.get(`/api/jobs/${id}`, { timeout: 5_000 })
      if (response.ok()) status = (await response.json()).meta.status
    } catch {
      // A restore can restart MCC while the job is being polled.
    }
    return status
  }, { timeout }).toMatch(/^(success|failed|cancelled)$/)
  expect(status, `MCC job ${id}`).toBe('success')
}
