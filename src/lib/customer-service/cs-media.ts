import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

export const CS_MEDIA_DIR = join(homedir(), '.mission-control', 'cs-uploads')

const ALLOWED_TYPES: Record<string, { ext: string; mime: string }> = {
  'image/jpeg': { ext: 'jpg', mime: 'image/jpeg' },
  'image/jpg':  { ext: 'jpg', mime: 'image/jpeg' },
  'image/png':  { ext: 'png', mime: 'image/png' },
  'image/gif':  { ext: 'gif', mime: 'image/gif' },
  'image/webp': { ext: 'webp', mime: 'image/webp' },
}

const FILE_ALLOWED_MIME_PREFIXES = ['application/', 'text/', 'audio/', 'video/']

const MAX_BYTES = 10 * 1024 * 1024  // LINE allows up to 10 MB original / 1 MB preview

function ensureDir() {
  if (!existsSync(CS_MEDIA_DIR)) mkdirSync(CS_MEDIA_DIR, { recursive: true })
}

export interface SavedMedia {
  id: string
  filename: string
  path: string
  mime: string
  size: number
}

export function saveImage(buffer: Buffer, contentType: string): SavedMedia {
  const t = ALLOWED_TYPES[contentType.toLowerCase()]
  if (!t) throw new Error(`unsupported content-type: ${contentType}`)
  if (buffer.byteLength > MAX_BYTES) throw new Error(`file too large (${buffer.byteLength} bytes, max ${MAX_BYTES})`)
  ensureDir()
  const id = randomUUID()
  const filename = `${id}.${t.ext}`
  const filepath = join(CS_MEDIA_DIR, filename)
  writeFileSync(filepath, buffer)
  return { id: filename, filename, path: filepath, mime: t.mime, size: buffer.byteLength }
}

// Allow images + common file/audio/video extensions for the broader
// operator-uploads-a-document use case (LINE has no "file" message type,
// so we send these as a text message linking to the public URL).
const FILE_EXT_PATTERN = /^[a-f0-9-]{36}\.(jpg|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|csv|json|zip|mp4|mov|m4a|mp3|aac|wav|bin)$/i

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  zip: 'application/zip',
  mp4: 'video/mp4', mov: 'video/quicktime',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav',
  bin: 'application/octet-stream',
}

export function readImage(id: string): { buffer: Buffer; mime: string } | null {
  // Hard-block path traversal: id must be <uuid>.<ext> from the allowlist
  if (!FILE_EXT_PATTERN.test(id)) return null
  const filepath = join(CS_MEDIA_DIR, basename(id))
  if (!existsSync(filepath)) return null
  const extMatch = id.match(/\.([a-z0-9]+)$/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : 'bin'
  const mime = EXT_MIME[ext] ?? 'application/octet-stream'
  return { buffer: readFileSync(filepath), mime }
}

export function mediaExists(id: string): boolean {
  if (!FILE_EXT_PATTERN.test(id)) return false
  const filepath = join(CS_MEDIA_DIR, basename(id))
  if (!existsSync(filepath)) return false
  try { return statSync(filepath).isFile() } catch { return false }
}

export interface SavedFile {
  id: string
  filename: string
  path: string
  mime: string
  size: number
  originalName: string
}

/** Save a non-image file (PDF, docx, …) — used for the operator's
 *  document-link send flow. We accept anything with a recognised MIME
 *  prefix or an ext we have a known mapping for. */
export function saveFile(buffer: Buffer, contentType: string, originalName: string): SavedFile {
  if (buffer.byteLength > MAX_BYTES) throw new Error(`file too large (${buffer.byteLength} bytes, max ${MAX_BYTES})`)
  ensureDir()
  const lowerCt = contentType.toLowerCase()
  const accepted = FILE_ALLOWED_MIME_PREFIXES.some(p => lowerCt.startsWith(p)) || lowerCt.startsWith('image/')
  if (!accepted) throw new Error(`unsupported content-type: ${contentType}`)

  const nameExt = (originalName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const ext = nameExt && EXT_MIME[nameExt] ? nameExt : 'bin'
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const filepath = join(CS_MEDIA_DIR, filename)
  writeFileSync(filepath, buffer)
  return {
    id: filename,
    filename,
    path: filepath,
    mime: EXT_MIME[ext] ?? contentType,
    size: buffer.byteLength,
    originalName,
  }
}
