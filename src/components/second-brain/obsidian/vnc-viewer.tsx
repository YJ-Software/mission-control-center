'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, RefreshCw, Monitor, Loader2 } from 'lucide-react'

interface VncViewerProps {
  websockifyPort: number
  vncPassword?: string
}

export function VncViewer({ websockifyPort, vncPassword }: VncViewerProps) {
  const t = useTranslations('secondBrain.obsidian.vnc')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [iframeKey, setIframeKey] = useState(0)

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const passwordParam = vncPassword ? `&password=${encodeURIComponent(vncPassword)}` : ''
  const novncUrl = `http://${host}:${websockifyPort}/vnc.html?autoconnect=true&resize=scale${passwordParam}`

  const reconnect = () => {
    setStatus('loading')
    setIframeKey(k => k + 1)
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-white/40" />
          <h3 className="text-sm font-medium text-white">{t('title')}</h3>
          {status === 'loading' && (
            <span className="text-[11px] font-mono text-yellow-400">
              {t('connecting')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={reconnect}
            className="p-1.5 rounded-md hover:bg-white/[0.08] text-white/40 hover:text-white/80 transition-colors"
            title={t('reconnect')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a
            href={novncUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white/[0.08] text-white/70 hover:bg-white/[0.15] hover:text-white transition-colors"
            title={t('openNewTab')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('openNewTab')}
          </a>
        </div>
      </div>

      <div className="relative w-full bg-black" style={{ minHeight: '400px', maxHeight: '600px' }}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="w-6 h-6 animate-spin text-white/30" />
          </div>
        )}
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={novncUrl}
          onLoad={() => setStatus('ready')}
          className="w-full border-0"
          style={{ height: '400px' }}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
