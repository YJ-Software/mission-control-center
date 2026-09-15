'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { HelpCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { PRICED_MODEL_LABELS, PRICING_CHECKED_AT } from '@/lib/usage-pricing'

/**
 * "?" beside a spend title explaining how the figures are computed. Hover or
 * keyboard focus opens it; a tap toggles it, since touch screens have no hover.
 * The model list reads the pricing table itself so the text cannot drift from it.
 */
export function CostInfoHint() {
  const t = useTranslations('costs.info')
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('ariaLabel')}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white/40
              hover:text-cyan-300 focus-visible:text-cyan-300 focus:outline-none transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-sm p-3 text-[11px] leading-relaxed text-white/75 space-y-1.5"
        >
          <p className="text-xs font-semibold text-white/90">{t('title')}</p>
          <p>{t('source')}</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>{t('openclaw')}</li>
            <li>{t('estimate')}</li>
            <li>{t('unknown')}</li>
            <li>{t('zeroTokens')}</li>
          </ul>
          <p className="text-white/50">
            {t('models', { date: PRICING_CHECKED_AT, models: PRICED_MODEL_LABELS.join(t('listSeparator')) })}
          </p>
          <p className="text-white/40">{t('disclaimer')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
