'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation } from '@tanstack/react-query'
import { Plug, Loader2, CheckCircle2 } from 'lucide-react'

export function LiveSyncSetup() {
  const t = useTranslations('secondBrain.obsidian.livesync')
  const [installed, setInstalled] = useState(false)

  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/second-brain/obsidian/livesync', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => setInstalled(true),
  })

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">{t('title')}</h3>
          <p className="text-xs text-white/40 mt-1">{t('description')}</p>
        </div>
        <button
          onClick={() => installMutation.mutate()}
          disabled={installMutation.isPending || installed}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
            bg-green-500/20 text-green-400 hover:bg-green-500/30"
        >
          {installMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{t('installing')}</>
          ) : installed ? (
            <><CheckCircle2 className="w-4 h-4" />{t('installed')}</>
          ) : (
            <><Plug className="w-4 h-4" />{t('install')}</>
          )}
        </button>
      </div>
      {installMutation.isError && (
        <div className="mt-2 text-xs text-red-400">
          {(installMutation.error as Error).message}
        </div>
      )}
    </div>
  )
}
