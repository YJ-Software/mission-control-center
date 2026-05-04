import { NextResponse } from 'next/server'
import { getCostData } from '@/lib/sessions'

export async function GET() {
  try {
    const data = getCostData()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { total: 0, today: 0, week: 0, perModel: {}, perDay: {}, perSession: {}, error: String(err) },
      { status: 500 },
    )
  }
}
