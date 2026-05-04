'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FolderOpen } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'

interface VaultPathDialogProps {
  open: boolean
  onOpenChangeAction: (open: boolean) => void
  onConfirmAction: (vaultPath: string) => void
}

export function VaultPathDialog({ open, onOpenChangeAction, onConfirmAction }: VaultPathDialogProps) {
  const t = useTranslations('secondBrain.obsidian.vaultDialog')
  const [vaultPath, setVaultPath] = useState('')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChangeAction}>
      <AlertDialogContent className="border-white/[0.08] bg-[#1a1a2e]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-white">
            <FolderOpen className="w-5 h-5 text-amber-400" />
            {t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-white/50">
            {t('description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <label className="text-xs text-white/40 mb-1.5 block">{t('label')}</label>
          <input
            type="text"
            value={vaultPath}
            onChange={(e) => setVaultPath(e.target.value)}
            placeholder={t('placeholder')}
            className="w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/40"
          />
          <p className="text-[11px] text-white/30 mt-1.5">{t('hint')}</p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!vaultPath.trim()}
            onClick={() => onConfirmAction(vaultPath.trim())}
            className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40"
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
