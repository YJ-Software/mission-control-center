'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { formatLongRunList, parseLongRunBusy } from '@/lib/long-run-client'

/** 重啟／升級／還原被 409（長時間安裝作業進行中）時的在地化訊息；其他回應回傳 null */
export function useLongRunMessage(): (data: unknown) => string | null {
  const t = useTranslations('longRun')
  return useCallback((data: unknown) => {
    const list = parseLongRunBusy(data)
    if (!list) return null
    return t('busy', { list: formatLongRunList(list, (name, time) => t('item', { name, time }), undefined, t('sep')) })
  }, [t])
}
