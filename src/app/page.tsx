import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { resolveLandingPath, LANDING_KEY } from '@/lib/landing'

export default function RootPage() {
  // Chat-first boxes (the customer subdomain) land in the chat window; every
  // other install keeps going to the dashboard, which is the default.
  const row = db.select().from(settings).where(eq(settings.key, LANDING_KEY)).all()[0]
  redirect(resolveLandingPath(row?.value))
}
