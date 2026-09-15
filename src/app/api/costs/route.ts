import { NextResponse } from 'next/server'
import { getCostData } from '@/lib/sessions'

export async function GET() {
  try {
    const data = await getCostData()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { total: 0, today: 0, week: 0, perModel: {}, perDay: {}, perSession: {}, estimated: false, windowDays: 0, error: String(err) },
      { status: 500 },
    )
  }
}
