import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json')

export async function GET() {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) {
      return NextResponse.json({
        installed: false,
        vaultMode: 'unknown',
        wikiSearchType: 'unknown',
        embeddingBackendAvailable: false,
        conflict: 'none',
      })
    }
    const cfg = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8')) as Record<string, any>

    const wikiEntry = cfg?.plugins?.entries?.['memory-wiki']
    const wikiConfig = wikiEntry?.config ?? {}
    const installed = Boolean(wikiEntry?.enabled)
    const vaultMode: 'isolated' | 'bridge' | 'unsafe-local' | 'unknown' = wikiConfig.vaultMode ?? 'unknown'

    const memorySlot = cfg?.plugins?.slots?.memory
    const memoryEntry = memorySlot ? cfg?.plugins?.entries?.[memorySlot] : null
    const hasMemoryBackend = Boolean(memorySlot && memoryEntry?.enabled)
    const wikiSearchBackend = wikiConfig?.search?.backend ?? 'shared'

    let embeddingBackendAvailable = false
    if (hasMemoryBackend && memorySlot === 'memory-lancedb') {
      const embedConfig = memoryEntry?.config?.embedding
      embeddingBackendAvailable = Boolean(embedConfig?.model)
    }

    // Wiki actually uses embeddings only when search.backend !== 'local' AND a backend is wired.
    const wikiSearchType: 'text' | 'semantic' | 'unknown' = !installed
      ? 'unknown'
      : wikiSearchBackend === 'local' || !embeddingBackendAvailable
        ? 'text'
        : 'semantic'

    let conflict: 'none' | 'isolated-no-embedding' | 'embedding-not-bound' = 'none'
    if (installed && vaultMode === 'isolated' && wikiSearchType === 'text') {
      conflict = 'isolated-no-embedding'
    } else if (installed && embeddingBackendAvailable && wikiSearchBackend === 'local') {
      conflict = 'embedding-not-bound'
    }

    return NextResponse.json({
      installed,
      vaultMode,
      wikiSearchType,
      embeddingBackendAvailable,
      conflict,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
