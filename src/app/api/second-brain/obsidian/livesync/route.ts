import { NextResponse } from 'next/server'
import { installLiveSyncPlugin } from '@/lib/second-brain/obsidian/livesync'

export async function POST() {
  const result = await installLiveSyncPlugin()
  if (result.success) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: result.error }, { status: 500 })
}
