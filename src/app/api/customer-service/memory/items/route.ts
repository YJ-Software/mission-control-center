import { NextResponse } from 'next/server'
import {
  listMemories,
  searchMemories,
  addMemory,
  deleteMemory,
  deleteAllMemories,
} from '@/lib/customer-service/mem0-cli'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const userId = url.searchParams.get('userId')
  const query = url.searchParams.get('query')
  const limit = Number(url.searchParams.get('limit') ?? '50')

  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  try {
    const result = query
      ? await searchMemories(userId, query, limit)
      : await listMemories(userId, limit)
    return NextResponse.json({ result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const action = body?.action
  try {
    if (action === 'add') {
      if (!body.userId || !body.content) {
        return NextResponse.json({ error: 'userId + content required' }, { status: 400 })
      }
      const r = await addMemory(body.userId, body.content, body.metadata)
      return NextResponse.json({ result: r })
    }
    if (action === 'search') {
      if (!body.userId || !body.query) {
        return NextResponse.json({ error: 'userId + query required' }, { status: 400 })
      }
      const r = await searchMemories(body.userId, body.query, body.limit ?? 10)
      return NextResponse.json({ result: r })
    }
    if (action === 'delete') {
      if (!body.memoryId) return NextResponse.json({ error: 'memoryId required' }, { status: 400 })
      const r = await deleteMemory(body.memoryId)
      return NextResponse.json({ result: r })
    }
    if (action === 'delete-all') {
      if (!body.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
      const r = await deleteAllMemories(body.userId)
      return NextResponse.json({ result: r })
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
