'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { STICKER_PACKS, stickerImageUrl } from '@/lib/customer-service/line-stickers'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (packageId: string, stickerId: string) => void
  sending: boolean
}

export function StickerPicker({ open, onOpenChange, onPick, sending }: Props) {
  const t = useTranslations('customerService.stickerPicker')
  const [activePack, setActivePack] = useState(STICKER_PACKS[0]?.packageId ?? '')

  const pack = STICKER_PACKS.find(p => p.packageId === activePack) ?? STICKER_PACKS[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden bg-zinc-950 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-base text-white/90">{t('title')}</DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-white/45 leading-relaxed -mt-2 mb-1">{t('hint')}</p>

        <div className="flex gap-1.5 flex-wrap mb-3 -mx-1 px-1 overflow-x-auto">
          {STICKER_PACKS.map(p => (
            <button
              key={p.packageId}
              onClick={() => setActivePack(p.packageId)}
              className={`px-2.5 py-1 rounded-md text-[11px] border whitespace-nowrap ${
                activePack === p.packageId
                  ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:text-white/85'
              }`}
            >
              {p.name}
              <span className="ml-1.5 text-white/35 font-mono text-[10px]">#{p.packageId}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {pack && (
            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {pack.stickerIds.map(sid => (
                <button
                  key={sid}
                  disabled={sending}
                  onClick={() => onPick(pack.packageId, sid)}
                  className="aspect-square rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.08] hover:border-yellow-500/30 transition-colors p-1 disabled:opacity-40"
                  title={`${pack.name} · ${sid}`}
                >
                  <img
                    src={stickerImageUrl(sid)}
                    alt={sid}
                    loading="lazy"
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {sending && (
          <div className="flex items-center gap-2 text-xs text-yellow-300 mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('sending')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
