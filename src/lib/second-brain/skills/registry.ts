import path from 'path'
import { SkillDescriptor } from './types'

const ROOT = path.join(process.cwd(), 'src/lib/second-brain/skills/templates')

export const SKILLS: SkillDescriptor[] = [
  {
    name: 'link-capture',
    displayName: 'Link Capture',
    description:
      '收到 URL 時自動抓取、摘要、評分並存入 Obsidian vault/raw/。',
    templateVersion: 2,
    templatePath: path.join(ROOT, 'link-capture/SKILL.md.tmpl'),
    requiresVault: true,
  },
  {
    name: 'youtube-transcript',
    displayName: 'YouTube Transcript',
    description:
      '抓取 YouTube 字幕或 Whisper 轉錄；摘要寫入 vault/raw/，完整逐字稿寫入 vault/transcripts/。支援 async 長影片。',
    templateVersion: 2,
    templatePath: path.join(ROOT, 'youtube-transcript/SKILL.md.tmpl'),
    scriptsDir: path.join(ROOT, 'youtube-transcript/scripts'),
    requiresVault: true,
  },
]

export function getSkillByName(name: string): SkillDescriptor | undefined {
  return SKILLS.find(s => s.name === name)
}
