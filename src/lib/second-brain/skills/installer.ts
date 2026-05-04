import fs from 'fs'
import path from 'path'
import os from 'os'
import { SkillDescriptor, TemplateVariables } from './types'
import { renderTemplate } from './render'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const SKILLS_ROOT = path.join(os.homedir(), '.agents', 'skills')

export function buildTemplateVariables(vaultPath: string): TemplateVariables {
  if (!vaultPath) throw new Error('vault_path is empty')
  const home = os.homedir()
  const vault = vaultPath.startsWith('~')
    ? path.join(home, vaultPath.slice(1).replace(/^\//, ''))
    : vaultPath
  const raw = path.join(vault, 'raw')
  const transcripts = path.join(vault, 'transcripts')
  return {
    vault_path: vault,
    raw_dir: raw,
    transcripts_dir: transcripts,
    whisper_base_url: getSetting('skills.youtube-transcript.whisper_base_url', ''),
    whisper_api_key: getSetting('skills.youtube-transcript.whisper_api_key', ''),
    home_dir: home,
  }
}

export function renderSkill(skill: SkillDescriptor, vars: TemplateVariables): string {
  const src = fs.readFileSync(skill.templatePath, 'utf8')
  return renderTemplate(src, vars as unknown as Record<string, string | boolean>)
}

export function installSkill(skill: SkillDescriptor, vars: TemplateVariables): string {
  const dest = path.join(SKILLS_ROOT, skill.name)
  fs.mkdirSync(dest, { recursive: true })

  const rendered = renderSkill(skill, vars)
  fs.writeFileSync(path.join(dest, 'SKILL.md'), rendered, 'utf8')

  if (skill.scriptsDir && fs.existsSync(skill.scriptsDir)) {
    const target = path.join(dest, 'scripts')
    fs.rmSync(target, { recursive: true, force: true })
    copyDirSync(skill.scriptsDir, target)
  }

  const now = new Date().toISOString()
  upsertSetting(`skills.${skill.name}.installed_at`, now)
  upsertSetting(`skills.${skill.name}.template_version`, String(skill.templateVersion))
  upsertSetting(`skills.${skill.name}.installed_path`, dest)
  return dest
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirSync(s, d)
    else fs.copyFileSync(s, d)
  }
}

function getSetting(key: string, fallback: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? fallback
}

function upsertSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
