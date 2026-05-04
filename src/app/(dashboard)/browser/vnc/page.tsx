'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'

const RfbViewer = dynamic(() => import('@/components/browser/rfb-viewer'), { ssr: false })

export default function VncPage() {
  const t = useTranslations('browser')

  return (
    <div className="flex flex-col h-full">
      <div className="block md:hidden mx-4 mt-4 px-4 py-3 rounded-2xl text-sm text-amber-300/80"
        style={{
          background: 'linear-gradient(135deg, hsla(43, 96%, 56%, 0.08), hsla(43, 96%, 56%, 0.03))',
          border: '1px solid hsla(43, 96%, 56%, 0.15)',
        }}
      >
        <p>{t('vncMobileNotice')}</p>
      </div>
      <div className="flex-1 min-h-0">
        <RfbViewer />
      </div>
    </div>
  )
}
