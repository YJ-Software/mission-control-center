#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL || ''
const WHISPER_API_KEY = process.env.WHISPER_API_KEY || ''
const DEFAULT_MODEL = process.env.WHISPER_MODEL || 'Systran/faster-whisper-large-v3'
const JOBS_DIR = process.env.TRANSCRIPT_JOBS_DIR || join(homedir(), '.cache', 'youtube-transcript', 'jobs')

export function sanitizeFilename(input) {
  return input.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function extractVideoId(url) {
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (short) return short[1]
  const long = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (long) return long[1]
  const p = url.match(/\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]{11})/)
  if (p) return p[1]
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url
  throw new Error(`Cannot extract video ID from: ${url}`)
}

async function fetchTitle(videoId) {
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--print', 'title', '--no-download', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: 15000 },
    )
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function fetchCaptions(videoId) {
  const { YoutubeTranscript } = await import('youtube-transcript')
  const segments = await YoutubeTranscript.fetchTranscript(`https://www.youtube.com/watch?v=${videoId}`)
  if (!segments || segments.length === 0) throw new Error('No caption segments')
  return { text: segments.map(s => s.text).join(' ') }
}

async function downloadAudio(videoId) {
  const dir = await mkdtemp(join(tmpdir(), 'yt-transcript-'))
  await execFileAsync(
    'yt-dlp',
    ['-f', 'bestaudio', '--no-playlist', '--no-warnings', '-o', join(dir, 'audio.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`],
    { timeout: 600000 },
  )
  const files = fs.readdirSync(dir).filter(Boolean)
  if (!files.length) throw new Error('yt-dlp produced no file')
  return { dir, file: join(dir, files[0]) }
}

async function parseWhisperSSE(resp) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const parts = []
  let language
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') continue
      try {
        const chunk = JSON.parse(payload)
        const t = chunk.delta || chunk.text
        if (t) parts.push(t)
        if (chunk.language && !language) language = chunk.language
      } catch {
        /* skip */
      }
    }
  }
  return { text: parts.join(''), language }
}

async function whisperTranscribe(file, baseUrl, apiKey, model) {
  const buf = await readFile(file)
  const form = new FormData()
  form.append('file', new Blob([buf]), file.split('/').pop() || 'audio.webm')
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('stream', 'true')
  const headers = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`
  const resp = await fetch(url, { method: 'POST', headers, body: form })
  if (!resp.ok) throw new Error(`Whisper API ${resp.status}: ${await resp.text()}`)
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) return parseWhisperSSE(resp)
  const json = await resp.json()
  return { text: json.text || '', language: json.language }
}

export async function getTranscript(params) {
  const videoId = extractVideoId(params.url)
  const titlePromise = fetchTitle(videoId)
  if (params.prefer_captions !== false && !params.force_download) {
    try {
      const cap = await fetchCaptions(videoId)
      const title = await titlePromise
      return { source: 'captions', videoId, title, text: cap.text, language: cap.language }
    } catch {
      /* fall through */
    }
  }
  const baseUrl = params.whisper_base_url || WHISPER_BASE_URL
  if (!baseUrl) throw new Error('Captions unavailable and WHISPER_BASE_URL not configured')
  const dl = await downloadAudio(videoId)
  try {
    const w = await whisperTranscribe(dl.file, baseUrl, params.whisper_api_key || WHISPER_API_KEY, params.model || DEFAULT_MODEL)
    const title = await titlePromise
    return { source: 'whisper', videoId, title, text: w.text, language: w.language }
  } finally {
    await rm(dl.dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function saveMarkdown(result, url, saveDir) {
  if (!saveDir) return undefined
  const resolved = resolve(saveDir)
  await mkdir(resolved, { recursive: true })
  const base = sanitizeFilename(result.title || result.videoId) || result.videoId
  const p = join(resolved, `${base}.md`)
  const md = `# ${result.title || result.videoId}\n\n- url: ${url}\n- videoId: ${result.videoId}\n- source: ${result.source}${result.language ? `\n- language: ${result.language}` : ''}\n\n---\n\n${result.text}\n`
  await writeFile(p, md, 'utf8')
  return p
}

async function writeJob(job) {
  await mkdir(JOBS_DIR, { recursive: true })
  await writeFile(join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job, null, 2), 'utf8')
}

async function readJob(id) {
  try {
    const buf = await readFile(join(JOBS_DIR, `${id}.json`), 'utf8')
    return JSON.parse(buf)
  } catch {
    return null
  }
}

async function runJob(id) {
  const job = await readJob(id)
  if (!job || job.status !== 'queued') return
  job.status = 'running'
  job.startedAt = Date.now()
  await writeJob(job)
  try {
    const result = await getTranscript(job.params)
    if (job.params.save_dir) {
      result.saved_path = await saveMarkdown(result, job.params.url, job.params.save_dir)
    }
    job.status = 'succeeded'
    job.result = result
  } catch (e) {
    job.status = 'failed'
    job.error = String(e.message || e)
  } finally {
    job.finishedAt = Date.now()
    await writeJob(job)
  }
}

async function startAsync(params) {
  const id = randomUUID()
  const job = { id, status: 'queued', createdAt: Date.now(), params }
  await writeJob(job)
  const __file = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [__file, '--run-job', id], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
  return { jobId: id, status: 'queued', jobs_dir: JOBS_DIR }
}

function parseArgs(argv) {
  const args = { mode: 'sync', params: {} }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--async') args.mode = 'async'
    else if (a === '--status') args.mode = 'status'
    else if (a === '--result') args.mode = 'result'
    else if (a === '--run-job') args.mode = 'run-job'
    else if (a === '--save-dir') args.params.save_dir = argv[++i]
    else if (a === '--force-download') args.params.force_download = true
    else if (a === '--whisper-base-url') args.params.whisper_base_url = argv[++i]
    else if (a === '--whisper-api-key') args.params.whisper_api_key = argv[++i]
    else if (a === '--model') args.params.model = argv[++i]
    else positional.push(a)
  }
  if (positional[0]) {
    if (args.mode === 'status' || args.mode === 'result' || args.mode === 'run-job') args.jobId = positional[0]
    else args.params.url = positional[0]
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (args.mode === 'sync') {
      if (!args.params.url) throw new Error('URL required')
      const result = await getTranscript(args.params)
      if (args.params.save_dir) {
        result.saved_path = await saveMarkdown(result, args.params.url, args.params.save_dir)
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else if (args.mode === 'async') {
      if (!args.params.url) throw new Error('URL required')
      process.stdout.write(JSON.stringify(await startAsync(args.params), null, 2) + '\n')
    } else if (args.mode === 'status') {
      const job = await readJob(args.jobId)
      if (!job) throw new Error('job not found')
      const { result, ...rest } = job
      void result
      process.stdout.write(JSON.stringify(rest, null, 2) + '\n')
    } else if (args.mode === 'result') {
      const job = await readJob(args.jobId)
      if (!job) throw new Error('job not found')
      if (job.status === 'failed') throw new Error(job.error || 'job failed')
      if (job.status !== 'succeeded') {
        process.stdout.write(
          JSON.stringify({ jobId: args.jobId, status: job.status, message: 'Not ready yet' }, null, 2) + '\n',
        )
        return
      }
      process.stdout.write(JSON.stringify(job.result, null, 2) + '\n')
    } else if (args.mode === 'run-job') {
      await runJob(args.jobId)
    }
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
