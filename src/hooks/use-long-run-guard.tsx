'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { parseLongRunBusy, type LongRunInfo } from '@/lib/long-run-client'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { hour12: false })
}

/**
 * 重啟／升級／重開機／還原被 409（長時間安裝作業進行中）時：列出作業（名稱、開始時間、PID、目前步驟），
 * 讓使用者選擇等待，或按「仍要重啟」並在對話框內再確認一次，之後以 force 重送。
 *
 * 用法：`const guard = useLongRunGuard()`；收到失敗回應時 `if (guard.handle(data, () => doIt({ force: true }))) return`；
 * 並在元件裡渲染 `{guard.dialog}`。
 */
export function useLongRunGuard(): { handle: (data: unknown, retryWithForce: () => void) => boolean; dialog: ReactNode } {
  const t = useTranslations('longRun')
  const [state, setState] = useState<{ list: LongRunInfo[]; retry: () => void; confirming: boolean } | null>(null)

  const handle = useCallback((data: unknown, retryWithForce: () => void) => {
    const list = parseLongRunBusy(data)
    if (!list) return false
    setState({ list, retry: retryWithForce, confirming: false })
    return true
  }, [])

  const dialog = state ? (
    <AlertDialog open onOpenChange={(open) => { if (!open) setState(null) }}>
      <AlertDialogContent className="border-white/[0.08] bg-[#1a1a2e]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-white">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            {t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-white/60">
            {state.confirming ? t('forceConfirm') : t('intro')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {state.list.map((r, i) => (
            <li key={`${r.name}-${i}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <div className="text-sm text-white/90 break-words">{r.name}</div>
              <div className="text-[11px] text-white/50 font-mono mt-0.5">
                {t('started', { time: fmtTime(r.startedAt) })} · {r.pid !== null ? t('pid', { pid: r.pid }) : t('noPid')}
              </div>
              {r.step && <div className="text-[11px] text-white/40 mt-0.5 break-words">{t('step', { step: r.step })}</div>}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/[0.08] bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white">
            {t('wait')}
          </AlertDialogCancel>
          {state.confirming ? (
            <AlertDialogAction
              onClick={() => { const retry = state.retry; setState(null); retry() }}
              className="bg-red-500/80 text-white hover:bg-red-500"
            >
              {t('forceConfirmButton')}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              // 第一次按只切到確認畫面，不關閉對話框
              onClick={(e) => { e.preventDefault(); setState({ ...state, confirming: true }) }}
              className="bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
            >
              {t('force')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

  return { handle, dialog }
}
