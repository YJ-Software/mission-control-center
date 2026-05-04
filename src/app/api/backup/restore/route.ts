import { NextRequest, NextResponse } from 'next/server'
import { verifyBackupToken } from '@/lib/backup/helpers'
import { runRestore } from '@/lib/backup/scripts'
import { initDb } from '@/lib/db'

initDb()

export async function POST(req: NextRequest) {
  if (!verifyBackupToken(req)) {
    return NextResponse.json({ error: 'Invalid backup token' }, { status: 401 })
  }

  const { file, dryRun } = await req.json()
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  try {
    const output = await runRestore(file, !!dryRun)
    return NextResponse.json({ ok: true, output })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
