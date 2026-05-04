export interface TemplateVariables {
  vault_path: string
  raw_dir: string
  transcripts_dir: string
  whisper_base_url?: string
  whisper_api_key?: string
  home_dir: string
}

export interface SkillScript {
  src: string
  dest: string
}

export interface SkillDescriptor {
  name: string
  displayName: string
  description: string
  templateVersion: number
  templatePath: string
  scriptsDir?: string
  requiresVault: boolean
}

export interface SkillInstallState {
  name: string
  displayName: string
  description: string
  templateVersion: number
  installedAt: string
  installedVersion: number
  installedPath: string
  upgradeAvailable: boolean
}
