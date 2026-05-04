'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Globe, FileText, Youtube, X } from 'lucide-react'

type SourceType = 'url' | 'text' | 'youtube'

export function SourceAddDialog({ notebookId, onClose, onSuccess }: {
  notebookId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const t = useTranslations('secondBrain.notebooklm.sourcePanel.addDialog')
  const [type, setType] = useState<SourceType>('url')
  const [value, setValue] = useState('')

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/second-brain/notebooklm/${notebookId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value }),
      })
      if (!res.ok) throw new Error('Add failed')
      return res.json()
    },
    onSuccess,
  })

  const types: { key: SourceType; icon: typeof Globe; label: string }[] = [
    { key: 'url', icon: Globe, label: t('url') },
    { key: 'text', icon: FileText, label: t('text') },
    { key: 'youtube', icon: Youtube, label: t('youtube') },
  ]

  return (
    <div className="cyber-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-white">{t('title')}</h4>
        <button onClick={onClose} className="p-1 text-white/30 hover:text-white/60"><X className="w-4 h-4" /></button>
      </div>

      {/* Type selector */}
      <div className="flex gap-1">
        {types.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => { setType(key); setValue('') }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              type === key
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:text-white/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Input */}
      {type === 'text' ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('textPlaceholder')}
          rows={4}
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40 resize-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'url' ? t('urlPlaceholder') : t('youtubePlaceholder')}
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
        />
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending || !value.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {addMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t('submit')}
        </button>
        <button onClick={onClose} className="text-white/40 hover:text-white/60 text-xs px-3 py-2">{t('cancel')}</button>
      </div>
    </div>
  )
}
