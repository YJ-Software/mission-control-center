'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function SkillPreviewDialog({
  name, displayName, open, onOpenChangeAction, onInstalledAction,
}: {
  name: string
  displayName: string
  open: boolean
  onOpenChangeAction: (v: boolean) => void
  onInstalledAction: () => void
}) {
  const t = useTranslations('secondBrain.skills')
  const [content, setContent] = useState<string>('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch(`/api/second-brain/skills/${name}/preview`)
      .then(r => r.json())
      .then(d => setContent(d.content || d.error || ''))
  }, [open, name])

  const install = async () => {
    setInstalling(true)
    try {
      const res = await fetch(`/api/second-brain/skills/${name}/install`, { method: 'POST' })
      if (res.ok) {
        onInstalledAction()
        onOpenChangeAction(false)
      }
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChangeAction}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] max-w-[90vw] max-h-[85vh] bg-[#1a1a1a] border border-white/[0.08] rounded-lg z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
            <Dialog.Title className="text-white/90 font-medium">{displayName}</Dialog.Title>
            <Dialog.Close className="text-white/40 hover:text-white/80"><X className="w-4 h-4" /></Dialog.Close>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs text-white/70 whitespace-pre-wrap font-mono">
            {content}
          </pre>
          <div className="flex justify-end gap-2 p-4 border-t border-white/[0.08]">
            <Dialog.Close className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-white/70 text-sm">
              {t('close')}
            </Dialog.Close>
            <button
              onClick={install}
              disabled={installing}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              {t('install')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
