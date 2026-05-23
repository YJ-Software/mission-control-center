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

export function readImage(id: string): { buffer: Buffer; mime: string } | null {
  // Hard-block path traversal: id must look like <uuid>.<ext> with no slashes
  if (!/^[a-f0-9-]{36}\.(jpg|png|gif|webp)$/i.test(id)) return null
  const filepath = join(CS_MEDIA_DIR, basename(id))
  if (!existsSync(filepath)) return null
  const extMatch = id.match(/\.(jpg|png|gif|webp)$/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return { buffer: readFileSync(filepath), mime }
}

export function mediaExists(id: string): boolean {
  if (!/^[a-f0-9-]{36}\.(jpg|png|gif|webp)$/i.test(id)) return false
  const filepath = join(CS_MEDIA_DIR, basename(id))
  if (!existsSync(filepath)) return false
  try { return statSync(filepath).isFile() } catch { return false }
}
