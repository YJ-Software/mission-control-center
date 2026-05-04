'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Wand2, Eye, RefreshCw } from 'lucide-react'
import { SkillPreviewDialog } from './skill-preview-dialog'

interface SkillState {
  name: string
  displayName: string
  description: string
  templateVersion: number
  installedAt: string
  installedVersion: number
  installedPath: string
  upgradeAvailable: boolean
}

export function SkillsPanel() {
  const t = useTranslations('secondBrain.skills')
  const [skills, setSkills] = useState<SkillState[]>([])
  const [preview, setPreview] = useState<{ name: string; displayName: string } | null>(null)

  const refresh = async () => {
    const res = await fetch('/api/second-brain/skills')
    if (res.ok) setSkills((await res.json()).skills)
  }
  useEffect(() => { refresh() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-cyan-400" />
          <h3 className="text-white/90 font-medium">{t('title')}</h3>
        </div>
        <button onClick={refresh} className="text-white/40 hover:text-white/80">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <p className="text-white/50 text-xs">{t('intro')}</p>
      <div className="space-y-2">
        {skills.map(s => (
          <div key={s.name} className="rounded bg-white/[0.04] border border-white/[0.08] p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white/90 text-sm font-medium">{s.displayName}</span>
                {s.installedAt && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                    v{s.installedVersion} {t('installed')}
                  </span>
                )}
                {s.upgradeAvailable && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-200">
                    {t('upgrade_available', { v: s.templateVersion })}
                  </span>
                )}
              </div>
              <p className="text-white/50 text-xs">{s.description}</p>
              {s.installedPath && (
                <p className="text-white/30 text-[10px] mt-1 truncate" title={s.installedPath}>
                  {s.installedPath}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setPreview({ name: s.name, displayName: s.displayName })}
                className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-white/70 text-xs"
              >
                <Eye className="w-3 h-3" />
                {t('preview')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <SkillPreviewDialog
          name={preview.name}
          displayName={preview.displayName}
          open={!!preview}
          onOpenChangeAction={(o: boolean) => !o && setPreview(null)}
          onInstalledAction={refresh}
        />
      )}
    </div>
  )
}
