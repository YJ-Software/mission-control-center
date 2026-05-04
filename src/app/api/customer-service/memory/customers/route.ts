import { NextResponse } from 'next/server'
import { listCustomers } from '@/lib/customer-service/mem0-customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ customers: listCustomers() })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
  }
}
