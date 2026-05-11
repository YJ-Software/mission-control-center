import { request } from 'node:https'

export function buildEnduserUrl({ panel, apiKey, apiPass, act, params = {} }) {
  const qs = new URLSearchParams({
    act,
    api: 'json',
    apikey: apiKey,
    apipass: apiPass,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  return `${panel.replace(/\/$/, '')}/index.php?${qs.toString()}`
}

function postJson(url, formBody = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const body = formBody ? new URLSearchParams(formBody).toString() : ''
    const headers = body
      ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json',
        }
      : { 'Content-Length': '0', 'Accept': 'application/json' }
    const req = request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers,
    }, res => {
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }) }
        catch { resolve({ status: res.statusCode, json: null, raw: buf }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export async function vpsStatus(env) {
  const url = buildEnduserUrl({
    panel: env.VIRTUALIZOR_PANEL,
    apiKey: env.VIRTUALIZOR_API_KEY,
    apiPass: env.VIRTUALIZOR_API_PASS,
    act: 'vpsmanage',
    params: { vpsid: env.VIRTUALIZOR_VPS_ID },
  })
  return postJson(url)
}

function randomPassword(len = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

/** Query the reinstall form to discover saved SSH key IDs. */
export async function listSshKeys(env) {
  const url = buildEnduserUrl({
    panel: env.VIRTUALIZOR_PANEL,
    apiKey: env.VIRTUALIZOR_API_KEY,
    apiPass: env.VIRTUALIZOR_API_PASS,
    act: 'ostemplate',
    params: { svs: env.VIRTUALIZOR_VPS_ID },
  })
  const { json } = await postJson(url)
  const keys = json?.info?.ssh_keys ?? {}
  return Object.values(keys).map(k => ({ id: k.keyid, name: k.name }))
}

export async function rebuildVps(env) {
  const newpass = env.E2E_REBUILD_PASSWORD || randomPassword()

  let sshKeyId = env.VIRTUALIZOR_SSH_KEY_ID || null
  if (!sshKeyId) {
    const saved = await listSshKeys(env)
    if (saved.length === 0) {
      process.stdout.write(`[phase-1] WARNING: no SSH keys saved in Virtualizor panel — rebuild will have no key auth\n`)
    } else {
      sshKeyId = saved[0].id
      const names = saved.map(k => `${k.name}#${k.id}`).join(', ')
      process.stdout.write(`[phase-1] using saved SSH key ${saved[0].name} (id=${sshKeyId}) from panel [available: ${names}]\n`)
    }
  } else {
    process.stdout.write(`[phase-1] using configured VIRTUALIZOR_SSH_KEY_ID=${sshKeyId}\n`)
  }

  const formBody = {
    svs:     env.VIRTUALIZOR_VPS_ID,
    vid:     env.VIRTUALIZOR_VPS_ID,
    reinsos: 1,
    newos:   env.VIRTUALIZOR_OS_TEMPLATE_ID,
    newpass,
    conf:    newpass,
  }
  if (sshKeyId) formBody.rebuild_sshkey = sshKeyId

  // URL carries only auth + act; reinstall payload goes in POST form body.
  const url = buildEnduserUrl({
    panel: env.VIRTUALIZOR_PANEL,
    apiKey: env.VIRTUALIZOR_API_KEY,
    apiPass: env.VIRTUALIZOR_API_PASS,
    act: 'ostemplate',
    params: { svs: env.VIRTUALIZOR_VPS_ID },
  })
  return postJson(url, formBody)
}

/** Poll vpsStatus until status indicates running. Logs each tick. */
export async function waitForRunning(env, { timeoutMs = 8 * 60_000, intervalMs = 10_000 } = {}) {
  const start = Date.now()
  let lastStatus = null
  while (Date.now() - start < timeoutMs) {
    const { json } = await vpsStatus(env)
    const status = json?.info?.status ?? json?.vps_status ?? null
    lastStatus = status
    process.stdout.write(`[phase-1] vps status: ${JSON.stringify(status)}\n`)
    if (status === 1 || status === '1' || status === 'Running' || status === 'On') return json
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`VPS not running after ${timeoutMs / 1000}s (last status: ${JSON.stringify(lastStatus)})`)
}
