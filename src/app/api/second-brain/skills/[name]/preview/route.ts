import { NextRequest, NextResponse } from 'next/server'
import { getSkillByName } from '@/lib/second-brain/skills/registry'
import { buildTemplateVariables, renderSkill } from '@/lib/second-brain/skills/installer'
import { getObsidianConfig } from '@/lib/second-brain/obsidian/config'

export async function GET(_: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const skill = getSkillByName(name)
  if (!skill) return NextResponse.json({ error: 'skill not found' }, { status: 404 })
  const vault = getObsidianConfig('vault_path')
  if (skill.requiresVault && !vault) {
    return NextResponse.json({ error: 'vault_path not set' }, { status: 400 })
  }
  try {
    const vars = buildTemplateVariables(vault)
    const content = renderSkill(skill, vars)
    return NextResponse.json({ name, content })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
