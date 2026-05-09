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

function postJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Length': '0', 'Accept': 'application/json' },
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null }) }
        catch { resolve({ status: res.statusCode, json: null, raw: body }) }
      })
    })
    req.on('error', reject)
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

export async function rebuildVps(env) {
  const url = buildEnduserUrl({
    panel: env.VIRTUALIZOR_PANEL,
    apiKey: env.VIRTUALIZOR_API_KEY,
    apiPass: env.VIRTUALIZOR_API_PASS,
    act: 'rebuild',
    params: {
      vpsid: env.VIRTUALIZOR_VPS_ID,
      osid: env.VIRTUALIZOR_OS_TEMPLATE_ID,
      newos: env.VIRTUALIZOR_OS_TEMPLATE_ID,
    },
  })
  return postJson(url)
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
