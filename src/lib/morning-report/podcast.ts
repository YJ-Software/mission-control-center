import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  copyFileSync,
} from 'fs'
import { execSync, execFile } from 'child_process'
import { unlinkSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { morningReportConfig } from '@/lib/schema'
import { getTmpDir, getDateVars } from './utils'
import { getTemplate, parsePodcastScript } from './template-helpers'
import { findOpenclawBin } from './openclaw'
import { getServerEnv } from '@/lib/server-env'
import type { ProgressCallback } from './finalize'

function getConfigValue(key: string): string {
  const row = db
    .select()
    .from(morningReportConfig)
    .all()
    .find((r) => r.key === key)
  return row?.value ?? ''
}

function hasEdgeTts(): boolean {
  try {
    execSync('which edge-tts', { stdio: 'pipe', env: getServerEnv() })
    return true
  } catch {
    return false
  }
}

function installEdgeTts(): void {
  const env = getServerEnv()
  // Try uv first (faster), fall back to pip
  try {
    execSync('which uv', { stdio: 'pipe', env })
    execSync('uv tool install edge-tts', { stdio: 'pipe', timeout: 120_000, env })
    return
  } catch { /* uv not available or install failed */ }
  try {
    execSync('pip install edge-tts', { stdio: 'pipe', timeout: 120_000, env })
    return
  } catch { /* pip failed */ }
  execSync('pip3 install edge-tts', { stdio: 'pipe', timeout: 120_000, env })
}

function hasFfmpeg(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'pipe', env: getServerEnv() })
    return true
  } catch {
    return false
  }
}

/**
 * Use openclaw agent to polish markdown into podcast-friendly script.
 * Returns the polished markdown path, or the original path on failure.
 */
/** A polished file is "good" iff it has at least as many `## ` section
 *  markers as the input. parseMarkdownSegments splits on those, so a
 *  polish that strips them collapses the whole podcast into one segment. */
function polishedFileLooksOk(inputPath: string, outputPath: string): boolean {
  try {
    const inHeads = (readFileSync(inputPath, 'utf-8').match(/^## /gm) || []).length
    const outHeads = (readFileSync(outputPath, 'utf-8').match(/^## /gm) || []).length
    // Allow some slack: agent might combine adjacent sections, but if
    // it returned 0 (or far less than half) something is wrong.
    return outHeads > 0 && outHeads * 2 >= inHeads
  } catch {
    return false
  }
}

async function polishForPodcast(
  mdPath: string,
  outputPath: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  // Cache: reuse only if the polished file still preserves the section
  // structure. Old runs that swallowed the `## ` headers used to get
  // permanently cached and produce single-segment audio forever.
  if (existsSync(outputPath)) {
    if (polishedFileLooksOk(mdPath, outputPath)) {
      onProgress?.('polish', '使用已存在的潤飾逐字稿')
      return outputPath
    }
    onProgress?.('polish', '已存在的潤飾稿缺少段落標題，重新潤飾')
  }

  const template = getTemplate('podcastPolishTemplate')
  const model = getConfigValue('podcastModel')
  const bin = findOpenclawBin()

  // Build prompt with file paths substituted
  const prompt = template
    .replace(/\$\{INPUT_FILE\}/g, mdPath)
    .replace(/\$\{OUTPUT_FILE\}/g, outputPath)

  const tmpDir = getTmpDir()
  const promptPath = join(tmpDir, `podcast-polish-prompt-${Date.now()}.md`)
  writeFileSync(promptPath, prompt, 'utf-8')

  const message = `讀取並嚴格執行以下 prompt 檔案中的完整指令：\n\n\`${promptPath}\`\n\n請先讀取該檔案的完整內容，然後按照檔案中的所有指示執行。`

  const args = [
    '--no-color',
    'agent',
    '--session-id', `mr-podcast-polish-${Date.now()}`,
    '--message', message,
    '--timeout', '600',
    '--json',
  ]
  if (model) {
    args.push('--model', model)
  }

  onProgress?.('polish', '正在使用 AI 潤飾逐字稿...')

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(bin, args, {
        timeout: 630_000,
        env: { ...getServerEnv(), NO_COLOR: '1' },
      }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message))
        } else {
          resolve()
        }
      })
    })

    if (existsSync(outputPath)) {
      if (!polishedFileLooksOk(mdPath, outputPath)) {
        // Agent stripped the `## ` markers — would collapse to one segment.
        // Throw the bad output away so cache logic doesn't reuse it next run.
        try { unlinkSync(outputPath) } catch { /* noop */ }
        onProgress?.('polish', 'Agent 輸出缺少段落標題，使用原始內容')
        return mdPath
      }
      onProgress?.('polish', '逐字稿潤飾完成')
      return outputPath
    } else {
      onProgress?.('polish', 'Agent 執行完成但未產生輸出檔，使用原始內容')
      return mdPath
    }
  } catch (err: any) {
    onProgress?.('polish', `逐字稿潤飾失敗，使用原始內容: ${err.message}`)
    return mdPath
  }
}

interface Segment {
  index: number
  title: string
  text: string
  audioPath: string
}

/** Strip TTS-hostile characters from a section title before feeding it
 *  into edge-tts. The polished markdown intentionally keeps the original
 *  `## 🤖 AI - 科技新聞` form (emoji + `/` + `（X/Reddit/HN）`) for human
 *  readability and as the parser's segment marker — but none of it reads
 *  well aloud. Source markdown is not modified. */
export function cleanTitleForTTS(title: string): string {
  return title
    // emoji (🤖 🪙 📈 …) including the trailing variation selector
    // (U+FE0F) and zero-width joiner (U+200D) used in compound emojis.
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[‍︎️]/g, '')
    // parenthesized acronym lists like （X/Reddit/HN） or (foo/bar) — drop
    .replace(/[（(][^()）]*[)）]/g, '')
    // structural separators that read awkwardly: / \ | + → space
    .replace(/[\\/|+]/g, ' ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse markdown into segments split by ## headings.
 * Strips markdown syntax (bold, italic, links, list markers, blockquotes).
 */
export function parseMarkdownSegments(md: string): { title: string; text: string }[] {
  const segments: { title: string; text: string }[] = []
  const parts = md.split(/^## /m)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const newlineIndex = trimmed.indexOf('\n')
    if (newlineIndex === -1) continue

    // Extract title (strip {#anchor} suffixes)
    const title = trimmed
      .slice(0, newlineIndex)
      .replace(/\s*\{#[\w-]+\}/, '')
      .trim()
    const body = trimmed.slice(newlineIndex + 1).trim()

    // Clean markdown syntax for TTS
    const cleaned = body
      // Remove links but keep text: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove bold: **text** → text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      // Remove italic: *text* → text
      .replace(/\*(.+?)\*/g, '$1')
      // Remove blockquote markers
      .replace(/^>\s*/gm, '')
      // Remove list markers
      .replace(/^[-*]\s+/gm, '')
      // Remove headings (###)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove horizontal rules
      .replace(/^---+$/gm, '')
      // Collapse multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    if (cleaned) {
      segments.push({ title, text: cleaned })
    }
  }

  return segments
}

export async function generatePodcast(date?: Date, onProgress?: ProgressCallback) {
  const now = date ?? new Date()
  const { today, dateHyphen } = getDateVars(now)
  const tmpDir = getTmpDir()

  // Check edge-tts availability, auto-install if missing
  if (!hasEdgeTts()) {
    onProgress?.('install', '正在自動安裝 edge-tts...')
    try {
      installEdgeTts()
      onProgress?.('install', 'edge-tts 安裝完成')
    } catch (err: any) {
      throw new Error(`edge-tts 自動安裝失敗: ${err.message}`)
    }
    if (!hasEdgeTts()) {
      throw new Error('edge-tts 安裝後仍無法偵測，請手動執行 pip install edge-tts')
    }
  }

  // Get TTS voice from config
  const voice = getConfigValue('ttsVoice') || 'zh-TW-HsiaoChenNeural'

  // Read merged markdown
  const mdPath = join(tmpDir, `morning-report-${today}.md`)
  if (!existsSync(mdPath)) {
    throw new Error(`合併報告不存在: ${mdPath}`)
  }

  // Polish markdown into podcast-friendly script via agent
  const polishedPath = join(tmpDir, `morning-report-${today}-podcast.md`)
  const actualMdPath = await polishForPodcast(mdPath, polishedPath, onProgress)
  const markdown = readFileSync(actualMdPath, 'utf-8')

  // Parse segments
  const rawSegments = parseMarkdownSegments(markdown)
  onProgress?.('parsing', `解析出 ${rawSegments.length} 個段落`)

  // Create segments dir
  const segDir = join(tmpDir, 'podcast-segments')
  if (!existsSync(segDir)) {
    mkdirSync(segDir, { recursive: true })
  }

  const segments: Segment[] = []

  // Generate intro audio
  const scriptTemplate = getTemplate('podcastScriptTemplate')
  const script = parsePodcastScript(scriptTemplate)
  const introText = script.intro
    .replace(/\$\{DATE_HYPHEN\}/g, dateHyphen)
    .replace(/\$\{SEGMENT_COUNT\}/g, String(rawSegments.length))
  const introSegPath = join(segDir, `00-intro-${today}.mp3`)
  if (!existsSync(introSegPath)) {
    onProgress?.('tts', '生成開場白音訊...')
    const introTextFile = join(segDir, `00-intro-${today}.txt`)
    writeFileSync(introTextFile, introText, 'utf-8')
    try {
      execSync(
        `edge-tts --voice "${voice}" -f "${introTextFile}" --write-media "${introSegPath}"`,
        { stdio: 'pipe', timeout: 120_000, env: getServerEnv() }
      )
    } catch (err: any) {
      throw new Error(`edge-tts 開場白生成失敗: ${err.message}`)
    }
  }
  segments.push({ index: 0, title: '開場白', text: introText, audioPath: introSegPath })

  // Generate audio for each segment
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i]
    const segIndex = String(i + 1).padStart(2, '0')
    const segPath = join(segDir, `${segIndex}-${today}.mp3`)

    // Skip already-existing segments (resumable)
    if (existsSync(segPath)) {
      onProgress?.('tts', `跳過已存在段落 ${i + 1}/${rawSegments.length}: ${seg.title}`)
      segments.push({ index: i + 1, title: seg.title, text: seg.text, audioPath: segPath })
      continue
    }

    onProgress?.('tts', `生成音訊 ${i + 1}/${rawSegments.length}: ${seg.title}`)

    // Prepend segment title for natural transition. Title comes straight
    // from the polished `## ...` heading which preserves emoji, `/`, `+`,
    // and parenthesized aliases like `（X/Reddit/HN）` for source-file
    // readability — none of which read well aloud. Clean for TTS only.
    const transitionText = script.transition
      .replace(/\$\{SEGMENT_TITLE\}/g, cleanTitleForTTS(seg.title))
    const fullText = transitionText ? `${transitionText}\n\n${seg.text}` : seg.text
    const textFile = join(segDir, `${segIndex}-${today}.txt`)
    writeFileSync(textFile, fullText, 'utf-8')

    try {
      execSync(
        `edge-tts --voice "${voice}" -f "${textFile}" --write-media "${segPath}"`,
        { stdio: 'pipe', timeout: 300_000, env: getServerEnv() }
      )
    } catch (err: any) {
      onProgress?.('tts-error', `段落 ${i + 1} 音訊生成失敗: ${err.message}`)
      continue
    }

    segments.push({ index: i + 1, title: seg.title, text: seg.text, audioPath: segPath })
  }

  // Generate outro audio if configured
  if (script.outro) {
    const outroText = script.outro
      .replace(/\$\{DATE_HYPHEN\}/g, dateHyphen)
      .replace(/\$\{SEGMENT_COUNT\}/g, String(rawSegments.length))
    const outroIndex = String(rawSegments.length + 1).padStart(2, '0')
    const outroSegPath = join(segDir, `${outroIndex}-outro-${today}.mp3`)
    if (!existsSync(outroSegPath)) {
      onProgress?.('tts', '生成結語音訊...')
      const outroTextFile = join(segDir, `${outroIndex}-outro-${today}.txt`)
      writeFileSync(outroTextFile, outroText, 'utf-8')
      try {
        execSync(
          `edge-tts --voice "${voice}" -f "${outroTextFile}" --write-media "${outroSegPath}"`,
          { stdio: 'pipe', timeout: 120_000, env: getServerEnv() }
        )
      } catch (err: any) {
        onProgress?.('tts-error', `結語音訊生成失敗: ${err.message}`)
      }
    }
    if (existsSync(outroSegPath)) {
      segments.push({ index: rawSegments.length + 1, title: '結語', text: outroText, audioPath: outroSegPath })
    }
  }

  // Merge all audio segments
  const outputPath = join(tmpDir, `morning-report-${today}.mp3`)
  const existingSegments = segments.filter((s) => existsSync(s.audioPath))

  if (existingSegments.length === 0) {
    throw new Error('沒有成功生成任何音訊段落')
  }

  onProgress?.('merging', `合併 ${existingSegments.length} 個音訊段落...`)

  if (hasFfmpeg()) {
    // Use ffmpeg concat demuxer
    const filelistPath = join(segDir, `filelist-${today}.txt`)
    const filelistContent = existingSegments
      .map((s) => `file '${s.audioPath}'`)
      .join('\n')
    writeFileSync(filelistPath, filelistContent, 'utf-8')

    try {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${filelistPath}" -c copy "${outputPath}"`,
        { stdio: 'pipe', timeout: 120_000, env: getServerEnv() }
      )
    } catch (err: any) {
      onProgress?.('merging', `ffmpeg 合併失敗，改用直接串接: ${err.message}`)
      directConcatMp3(existingSegments, outputPath)
    }
  } else {
    // Fallback: direct MP3 concatenation
    onProgress?.('merging', '未找到 ffmpeg，使用直接串接...')
    directConcatMp3(existingSegments, outputPath)
  }

  // Copy MP3 to publicDir if configured
  const publicDir = getConfigValue('publicDir')
  if (publicDir) {
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true })
    }
    const audioFilename = `morning-report-${today}.mp3`
    copyFileSync(outputPath, join(publicDir, audioFilename))
    onProgress?.('publishing', `發布到 ${publicDir}/${audioFilename}`)
  }

  onProgress?.('done', `Podcast 生成完成: ${outputPath}`)

  return {
    audioPath: outputPath,
    segments: segments.map((s) => ({
      index: s.index,
      title: s.title,
      audioPath: s.audioPath,
    })),
  }
}

/**
 * Fallback: concatenate MP3 files by appending raw bytes.
 * Not ideal (may cause playback glitches) but works without ffmpeg.
 */
function directConcatMp3(segments: Segment[], outputPath: string) {
  // Start fresh
  writeFileSync(outputPath, Buffer.alloc(0))
  for (const seg of segments) {
    const data = readFileSync(seg.audioPath)
    appendFileSync(outputPath, data)
  }
}
