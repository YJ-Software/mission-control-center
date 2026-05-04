import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { SKILLS } from '@/lib/second-brain/skills/registry'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { SkillInstallState } from '@/lib/second-brain/skills/types'

export async function GET() {
  const states: SkillInstallState[] = SKILLS.map(skill => {
    const installedAt = getSetting(`skills.${skill.name}.installed_at`)
    const installedVersion = parseInt(
      getSetting(`skills.${skill.name}.template_version`) || '0',
      10,
    )
    const installedPath = getSetting(`skills.${skill.name}.installed_path`)
    const actuallyInstalled =
      !!installedPath && fs.existsSync(path.join(installedPath, 'SKILL.md'))
    return {
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      templateVersion: skill.templateVersion,
      installedAt: actuallyInstalled ? installedAt : '',
      installedVersion: actuallyInstalled ? installedVersion : 0,
      installedPath: actuallyInstalled ? installedPath : '',
      upgradeAvailable: actuallyInstalled && installedVersion < skill.templateVersion,
    }
  })
  return NextResponse.json({ skills: states })
}

function getSetting(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? ''
}
