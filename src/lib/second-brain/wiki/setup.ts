/**
 * Wiki + Ollama setup orchestration.
 *
 * Encodes every pitfall we hit setting this up by hand:
 *   - openclaw plugins enable does NOT add to plugins.allow and OVERWRITES
 *     other config edits. Edit the JSON ourselves, don't use the CLI.
 *   - memory.backend is the WRONG key. Real one is plugins.slots.memory.
 *   - Ollama needs a systemd user unit; nohup dies on logout.
 *   - bge-m3 is 1024d, must match memory-lancedb config.embedding.dimensions.
 *   - Pick an installer: prefer linuxbrew, fall back to apt for ollama.
 *
 * Each step is idempotent — if Ollama is already there, skip the install;
 * if openclaw.json already has the right shape, leave it alone.
 */

import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { applyPurposeToConfig, getPurpose } from '@/lib/wiki/purpose'

const execFileAsync = promisify(execFile)

export type StepName =
  | 'detect-ollama'
  | 'install-ollama'
  | 'systemd-unit'
  | 'pull-bge-m3'
  | 'verify-embedding'
  | 'edit-openclaw-json'
  | 'init-wiki-vault'
  | 'register-obsidian-vault'
  | 'mcc-defaults'
  | 'install-defuddle'

export type Progress = (stage: StepName | 'log' | 'error', message: string) => void

const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')
const SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user')
const OLLAMA_UNIT = join(SYSTEMD_USER_DIR, 'ollama.service')
const OBSIDIAN_JSON = join(homedir(), '.config', 'obsidian', 'obsidian.json')
const DEFAULT_WIKI_VAULT = join(homedir(), '.openclaw', 'wiki', 'main')

interface DetectResult {
  ollamaBin: string
  ollamaRunning: boolean
  bgeM3Available: boolean
  embeddingsWork: boolean
  openclawConfigured: boolean
  vaultExists: boolean
  defuddleBin: string
}

async function which(cmd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function ollamaApiOk(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('curl', ['-sf', 'http://127.0.0.1:11434/'], {
      timeout: 3000,
    })
    return stdout.trim().toLowerCase().includes('ollama is running')
  } catch {
    return false
  }
}

async function ollamaHasBgeM3(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('curl', ['-sf', 'http://127.0.0.1:11434/api/tags'], {
      timeout: 5000,
    })
    return stdout.includes('bge-m3')
  } catch {
    return false
  }
}

async function embeddingsRoundtrip(): Promise<boolean> {
  try {
    await execFileAsync(
      'curl',
      [
        '-sf',
        'http://127.0.0.1:11434/v1/embeddings',
        '-H', 'Content-Type: application/json',
        '-d', '{"model":"bge-m3","input":"hello"}',
      ],
      { timeout: 30_000 },
    )
    return true
  } catch {
    return false
  }
}

function readOpenclawJson(): Record<string, unknown> {
  if (!existsSync(OPENCLAW_JSON)) return {}
  return JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8'))
}

function writeOpenclawJson(obj: Record<string, unknown>): void {
  // Backup first — every edit, paranoid.
  if (existsSync(OPENCLAW_JSON)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    copyFileSync(OPENCLAW_JSON, `${OPENCLAW_JSON}.bak.mcc-wiki-${ts}`)
  }
  mkdirSync(dirname(OPENCLAW_JSON), { recursive: true })
  writeFileSync(OPENCLAW_JSON, JSON.stringify(obj, null, 2))
}

export async function detect(): Promise<DetectResult> {
  const ollamaBin = await which('ollama')
  const ollamaRunning = ollamaBin ? await ollamaApiOk() : false
  const bgeM3Available = ollamaRunning ? await ollamaHasBgeM3() : false
  const embeddingsWork = bgeM3Available ? await embeddingsRoundtrip() : false

  let openclawConfigured = false
  try {
    const c = readOpenclawJson() as any
    const allow: string[] = c?.plugins?.allow ?? []
    const slot = c?.plugins?.slots?.memory
    const lancedb = c?.plugins?.entries?.['memory-lancedb']
    const wiki = c?.plugins?.entries?.['memory-wiki']
    // Purpose-agnostic: either slot is valid. The wiki.purpose setting (not the
    // slot value here) decides agent vs customer-service, so don't pin the slot.
    openclawConfigured =
      allow.includes('memory-lancedb') &&
      allow.includes('memory-wiki') &&
      (slot === 'memory-lancedb' || slot === 'memory-wiki') &&
      lancedb?.enabled === true &&
      wiki?.enabled === true
  } catch { /* invalid json -> not configured */ }

  return {
    ollamaBin,
    ollamaRunning,
    bgeM3Available,
    embeddingsWork,
    openclawConfigured,
    vaultExists: existsSync(DEFAULT_WIKI_VAULT),
    defuddleBin: await which('defuddle'),
  }
}

async function installDefuddle(progress: Progress): Promise<void> {
  // npm global install. Test machine has node from openclaw's setup;
  // dev box has it via brew. defuddle-cli is small.
  try {
    await execFileAsync('npm', ['install', '-g', 'defuddle-cli'], { timeout: 180_000 })
    progress('install-defuddle', 'defuddle-cli 安裝完成')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Non-fatal — URL ingest will fall back to raw fetch.
    progress('install-defuddle', `defuddle 安裝失敗（非致命，URL ingest 會降級為 raw fetch）: ${message.slice(0, 200)}`)
  }
}

async function installOllama(progress: Progress): Promise<void> {
  // Prefer linuxbrew (quiet, user-scoped, what the test machine and dev box use).
  // Fall back to the ollama upstream installer.
  const brew = await which('brew')
  if (brew) {
    progress('install-ollama', '使用 linuxbrew 安裝 ollama...')
    await execFileAsync('brew', ['install', 'ollama'], { timeout: 300_000 })
    return
  }
  progress('install-ollama', '未找到 brew，改用 ollama 官方 installer...')
  await execFileAsync(
    'bash',
    ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'],
    { timeout: 600_000 },
  )
}

function ensureOllamaUnit(progress: Progress): void {
  if (existsSync(OLLAMA_UNIT)) {
    progress('systemd-unit', 'ollama.service 已存在')
    return
  }
  mkdirSync(SYSTEMD_USER_DIR, { recursive: true })
  // Resolve the binary at unit-write time so PATH is captured for systemd.
  let bin = ''
  try { bin = execFileSync('which', ['ollama'], { encoding: 'utf-8' }).trim() } catch { /* */ }
  if (!bin) bin = '/home/linuxbrew/.linuxbrew/bin/ollama'
  const unit = `[Unit]
Description=Ollama local model server
After=network.target

[Service]
Type=simple
ExecStart=${bin} serve
Environment="OLLAMA_HOST=127.0.0.1:11434"
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`
  writeFileSync(OLLAMA_UNIT, unit)
  progress('systemd-unit', `寫入 ${OLLAMA_UNIT}`)
}

async function startOllama(progress: Progress): Promise<void> {
  await execFileAsync('systemctl', ['--user', 'daemon-reload'], { timeout: 10_000 })
  await execFileAsync('systemctl', ['--user', 'enable', '--now', 'ollama'], { timeout: 10_000 })
  // Wait up to 15s for the API to come up.
  for (let i = 0; i < 15; i++) {
    if (await ollamaApiOk()) {
      progress('systemd-unit', 'ollama 已啟動 (active)')
      return
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('ollama 啟動逾時，systemctl --user status ollama 看細節')
}

async function pullBgeM3(progress: Progress): Promise<void> {
  if (await ollamaHasBgeM3()) {
    progress('pull-bge-m3', 'bge-m3 已存在，跳過 pull')
    return
  }
  progress('pull-bge-m3', '正在下載 bge-m3 (~1.2 GB)...')
  await execFileAsync('ollama', ['pull', 'bge-m3'], { timeout: 600_000 })
}

function editOpenclawJson(progress: Progress): void {
  const c = readOpenclawJson() as any

  // The plugin block (allow + slots + entries) is owned by the shared purpose
  // resolver so this install flow can never disagree with the customer-service
  // flow. Fresh installs default to 'agent'; an existing choice is respected.
  const purpose = getPurpose()
  applyPurposeToConfig(c, purpose)

  // memory.backend (wrong key) — strip if present.
  if (c.memory && typeof c.memory === 'object' && 'backend' in c.memory) {
    const memObj = c.memory as Record<string, unknown>
    delete memObj.backend
    if (Object.keys(memObj).length === 0) delete c.memory
  }

  writeOpenclawJson(c)
  progress('edit-openclaw-json', `寫入 ~/.openclaw/openclaw.json (purpose=${purpose})`)
}

async function initWikiVault(progress: Progress): Promise<void> {
  if (existsSync(join(DEFAULT_WIKI_VAULT, 'WIKI.md'))) {
    progress('init-wiki-vault', 'wiki vault 已初始化')
    return
  }
  await execFileAsync('openclaw', ['wiki', 'init'], { timeout: 30_000 })
  progress('init-wiki-vault', `vault: ${DEFAULT_WIKI_VAULT}`)
}

function registerObsidianVault(progress: Progress): void {
  if (!existsSync(OBSIDIAN_JSON)) {
    progress('register-obsidian-vault', 'obsidian.json 不存在，跳過註冊（Obsidian 未安裝？）')
    return
  }
  const obs = JSON.parse(readFileSync(OBSIDIAN_JSON, 'utf-8'))
  obs.vaults = obs.vaults || {}
  const exists = Object.values(obs.vaults).some(
    (v: any) => v?.path === DEFAULT_WIKI_VAULT,
  )
  if (exists) {
    progress('register-obsidian-vault', 'wiki vault 已註冊到 Obsidian')
    return
  }
  // 16-char hex id, matching Obsidian's own vault-id format.
  const part = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  const id = `${part()}${part()}`
  obs.vaults[id] = { path: DEFAULT_WIKI_VAULT, ts: Date.now() }
  writeFileSync(OBSIDIAN_JSON, JSON.stringify(obs, null, 2))
  progress('register-obsidian-vault', `加入 obsidian.json (id=${id})`)
}

function setMccDefaults(progress: Progress): void {
  // Fresh-install default: vault path = wiki vault, no dual-write.
  // Capture skills will land directly in the wiki vault's raw/ + transcripts/
  // (siblings of sources/, OK because memory-wiki only manages its own dirs).
  const get = (k: string) => db.select().from(settings).where(eq(settings.key, k)).all()[0]?.value
  const set = (k: string, v: string) => db
    .insert(settings)
    .values({ key: k, value: v })
    .onConflictDoUpdate({ target: settings.key, set: { value: v } })
    .run()

  if (!get('obsidian.vault_path')) {
    set('obsidian.vault_path', DEFAULT_WIKI_VAULT)
    progress('mcc-defaults', `obsidian.vault_path -> ${DEFAULT_WIKI_VAULT}`)
  }
  if (!get('wiki.dualWrite')) {
    set('wiki.dualWrite', 'false')
    progress('mcc-defaults', 'wiki.dualWrite = false (single-write)')
  }
  if (!get('wiki.synthesisCron')) {
    // Default: every Sunday 03:00 local
    set('wiki.synthesisCron', '0 3 * * 0')
    progress('mcc-defaults', 'wiki.synthesisCron = "0 3 * * 0" (週日 03:00)')
  }
  if (!get('wiki.synthesisModel')) {
    set('wiki.synthesisModel', '')  // empty = use openclaw default
    progress('mcc-defaults', 'wiki.synthesisModel = (default)')
  }
}

/** End-to-end setup. Each step is idempotent and skips if already done.
 *  progress() is called for every meaningful step so the SSE stream can show it. */
export async function runSetup(progress: Progress): Promise<DetectResult> {
  const before = await detect()

  if (!before.ollamaBin) {
    await installOllama(progress)
  } else {
    progress('detect-ollama', `ollama 已安裝: ${before.ollamaBin}`)
  }

  ensureOllamaUnit(progress)
  if (!before.ollamaRunning) {
    await startOllama(progress)
  } else {
    progress('systemd-unit', 'ollama 已在跑')
  }

  await pullBgeM3(progress)

  if (!(await embeddingsRoundtrip())) {
    throw new Error('bge-m3 embedding endpoint 測試失敗，請檢查 ollama 服務')
  }
  progress('verify-embedding', 'bge-m3 /v1/embeddings 1024d ✓')

  if (!before.openclawConfigured) {
    editOpenclawJson(progress)
  } else {
    progress('edit-openclaw-json', 'openclaw.json 已配置完成')
  }

  await initWikiVault(progress)
  registerObsidianVault(progress)
  setMccDefaults(progress)

  if (!before.defuddleBin && !(await which('defuddle'))) {
    await installDefuddle(progress)
  } else {
    progress('install-defuddle', 'defuddle 已安裝')
  }

  return await detect()
}
