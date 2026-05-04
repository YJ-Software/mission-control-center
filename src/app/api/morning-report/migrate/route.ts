import { NextResponse } from 'next/server'
import { loadDefaultTemplates } from '@/lib/morning-report/load-defaults'

export async function POST() {
  try {
    const result = loadDefaultTemplates()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
