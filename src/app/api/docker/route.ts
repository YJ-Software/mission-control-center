import { NextRequest, NextResponse } from 'next/server'
import { execFileSync } from 'child_process'

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { timeout: 10000 }).toString()
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; message?: string }
    return err.stdout ? err.stdout.toString() : 'Error: ' + (err.message || '')
  }
}

function runShell(script: string): string {
  try {
    return execFileSync('/bin/sh', ['-c', script], { timeout: 10000 }).toString()
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; message?: string }
    return err.stdout ? err.stdout.toString() : 'Error: ' + (err.message || '')
  }
}

export async function GET() {
  try {
    const containers = JSON.parse(runShell('docker ps -a --format "{{json .}}" | jq -s "."') || '[]')
    const images = JSON.parse(runShell('docker images --format "{{json .}}" | jq -s "."') || '[]')
    const system = run('docker', ['system', 'df'])
    return NextResponse.json({ containers, images, system })
  } catch {
    return NextResponse.json({ containers: [], images: [], system: 'Docker not available' })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, id } = await req.json()
    const allowed: Record<string, boolean> = {
      start: true, stop: true, restart: true,
      'prune-containers': true, 'prune-images': true,
    }
    if (!allowed[action]) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    let result: string
    if (action === 'prune-containers') {
      result = execFileSync('docker', ['container', 'prune', '-f'], { timeout: 30000 }).toString()
    } else if (action === 'prune-images') {
      result = execFileSync('docker', ['image', 'prune', '-f'], { timeout: 30000 }).toString()
    } else {
      if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id)) {
        return NextResponse.json({ error: 'Invalid container ID' }, { status: 400 })
      }
      result = execFileSync('docker', [action, id], { timeout: 15000 }).toString()
    }

    return NextResponse.json({ ok: true, result })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
