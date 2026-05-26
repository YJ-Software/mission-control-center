'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, RefreshCw, X, Send, Image as ImageIcon, Plus, AlertCircle, Upload, Paperclip, FileText, Sparkles, HelpCircle, Clock, Smile } from 'lucide-react'
import { AgentTimelineDrawer } from './agent-timeline-drawer'
import { StickerPicker } from './sticker-picker'

interface ConversationRow {
  userId: string
  displayName: string | null
  pictureUrl: string | null
  lastMessageAt: number | null
  paused: boolean
  pauseInfo: { pausedAt: number; resumeAt: number; operatorId: string | null } | null
}

interface MessageRow {
  id: string
  userId: string
  direction: 'user' | 'bot' | 'operator' | string
  type: string
  text: string | null
  payload: string | null
  lineMessageId: string | null
  operatorId: string | null
  createdAt: number | null
}

function fmtClock(unixSec: number | null): string {
  if (!unixSec) return ''
  const d = new Date(unixSec * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.max(0, secs % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Props {
  userId: string
  initial: ConversationRow
}

export function ConversationView({ userId, initial }: Props) {
  const t = useTranslations('customerService.conversations')
  const qc = useQueryClient()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const { data: detail } = useQuery<{ conversation: ConversationRow; messages: MessageRow[] }>({
    queryKey: ['cs-messages', userId],
    queryFn: () => fetch(`/api/customer-service/conversations/${encodeURIComponent(userId)}/messages`).then(r => r.json()),
    refetchInterval: 3000,
  })

  const conv = detail?.conversation ?? initial
  const messages = detail?.messages ?? []

  // pause countdown ticker
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(v => v + 1), 1000)
    return () => clearInterval(id)
  }, [])
  void tick

  const now = Math.floor(Date.now() / 1000)
  const isPaused = conv.paused && conv.pauseInfo && conv.pauseInfo.resumeAt > now
  const remaining = isPaused && conv.pauseInfo ? conv.pauseInfo.resumeAt - now : 0

  // auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [messages.length])

  // Live invalidation when a cs:new-message for THIS user arrives, and on
  // pause toggles from any source. Coupling to window CustomEvents keeps
  // this component decoupled from the websocket store implementation.
  useEffect(() => {
    const onNew = (e: Event) => {
      const detail = (e as CustomEvent).detail as { userId?: string } | undefined
      if (detail?.userId === userId) {
        qc.invalidateQueries({ queryKey: ['cs-messages', userId] })
      }
    }
    const onPause = (e: Event) => {
      const detail = (e as CustomEvent).detail as { userId?: string } | undefined
      if (detail?.userId === userId) {
        qc.invalidateQueries({ queryKey: ['cs-messages', userId] })
      }
    }
    window.addEventListener('cs:new-message', onNew)
    window.addEventListener('cs:pause-changed', onPause)
    return () => {
      window.removeEventListener('cs:new-message', onNew)
      window.removeEventListener('cs:pause-changed', onPause)
    }
  }, [userId, qc])

  const [draft, setDraft] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [quickReplies, setQuickReplies] = useState<string[]>([])
  const [qrInput, setQrInput] = useState('')
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false)

  // AI quick-reply suggestions — toggle is per-browser via localStorage,
  // suggestions live as ephemeral state.
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('cs-quick-reply-ai') === '1'
  })
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [showAiHelp, setShowAiHelp] = useState(false)
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cs-quick-reply-ai', aiEnabled ? '1' : '0')
    }
  }, [aiEnabled])

  // Fetch suggestions on debounced draft change when AI is enabled.
  // Reusable so the manual refresh button can hit it immediately.
  // Per operator's preference, suggestions are AUTO-merged into the
  // staging row — they edit (× to remove) what they don't want rather
  // than tapping each chip to accept. Manual refresh REPLACES the
  // previously-suggested set so it's a clean regen.
  const fetchSuggestions = async (forceReplace = false) => {
    if (!draft.trim() || draft.trim().length < 3) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/customer-service/quick-replies/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, draft }),
      })
      if (!res.ok) throw new Error('suggest failed')
      const data = await res.json() as { suggestions?: string[] }
      const fresh = Array.isArray(data.suggestions) ? data.suggestions : []
      // For manual refresh, drop the previous AI set first; for the
      // debounced fetch we just additively merge.
      setQuickReplies(prev => {
        let base = prev
        if (forceReplace) base = prev.filter(x => !aiSuggestions.includes(x))
        const seen = new Set(base)
        const merged = [...base]
        for (const s of fresh) {
          if (!seen.has(s) && merged.length < 13) {
            merged.push(s)
            seen.add(s)
          }
        }
        return merged
      })
      setAiSuggestions(fresh)
    } catch {
      /* fail-open */
    } finally {
      setAiLoading(false)
    }
  }
  useEffect(() => {
    if (!aiEnabled) {
      setAiSuggestions([])
      return
    }
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current)
    aiDebounceRef.current = setTimeout(() => { void fetchSuggestions(false) }, 1500)
    return () => { if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, draft, userId])

  const sendMutation = useMutation({
    mutationFn: async (input: 'text' | 'image' | 'file' | { mode: 'sticker'; packageId: string; stickerId: string }) => {
      const mode = typeof input === 'string' ? input : input.mode
      const body: Record<string, unknown> = { type: mode, quickReplies: quickReplies.length > 0 ? quickReplies : undefined }
      if (mode === 'text') body.text = draft
      else if (mode === 'image') body.imageUrl = imageUrl
      else if (mode === 'file') {
        body.fileUrl = fileUrl
        body.fileName = fileName
        body.text = draft  // optional leading text composed with the link
      } else if (typeof input === 'object' && input.mode === 'sticker') {
        body.packageId = input.packageId
        body.stickerId = input.stickerId
        body.quickReplies = undefined  // LINE rejects quickReply on sticker messages
      }
      const res = await fetch(`/api/customer-service/conversations/${encodeURIComponent(userId)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'send failed')
      return data
    },
    onSuccess: () => {
      setDraft('')
      setImageUrl('')
      setFileUrl('')
      setFileName('')
      setQuickReplies([])
      setStickerPickerOpen(false)
      qc.invalidateQueries({ queryKey: ['cs-messages', userId] })
      qc.invalidateQueries({ queryKey: ['cs-conversations'] })
    },
  })

  const pauseMutation = useMutation({
    mutationFn: async (target: boolean) => {
      const res = await fetch(`/api/customer-service/conversations/${encodeURIComponent(userId)}/pause-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: target }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'toggle failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-conversations'] })
      qc.invalidateQueries({ queryKey: ['cs-messages', userId] })
    },
  })

  const refreshProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/customer-service/conversations/${encodeURIComponent(userId)}/refresh-profile`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'refresh failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs-conversations'] })
      qc.invalidateQueries({ queryKey: ['cs-messages', userId] })
    },
  })

  return (
    <>
      {/* header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
        {conv.pictureUrl ? (
          <img src={conv.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-600 to-purple-600 flex items-center justify-center text-xs font-semibold">
            {(conv.displayName?.[0] || userId[1] || '?').toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm text-white/90 truncate">
            {conv.displayName || <span className="font-mono text-white/55">{userId.slice(0, 12)}…</span>}
          </div>
          <div className="text-[10px] text-white/30 font-mono truncate max-w-[280px]">{userId}</div>
        </div>
        <button
          onClick={() => refreshProfileMutation.mutate()}
          disabled={refreshProfileMutation.isPending}
          className="text-[10px] text-white/40 hover:text-white/70 flex items-center gap-1"
          title={t('refreshProfile')}
        >
          {refreshProfileMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
        <button
          onClick={() => setTimelineOpen(true)}
          className="text-[11px] text-white/45 hover:text-cyan-300 flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] hover:border-cyan-400/30 transition-colors"
          title={t('openAgentTimeline')}
        >
          <Clock className="w-3 h-3" />
          {t('agentTimeline')}
        </button>

        {/* pause toggle */}
        <div className={`ml-auto flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${isPaused ? 'border-amber-400/30 bg-amber-400/[0.08]' : 'border-emerald-400/30 bg-emerald-400/[0.08]'}`}>
          <button
            onClick={() => pauseMutation.mutate(!isPaused)}
            disabled={pauseMutation.isPending}
            className={`w-8 h-4 rounded-full relative transition-colors ${isPaused ? 'bg-amber-400/70' : 'bg-emerald-400/70'}`}
            title={isPaused ? t('resumeAgent') : t('takeOver')}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isPaused ? 'right-0.5' : 'left-0.5'}`} />
          </button>
          {isPaused ? (
            <div className="text-[11px]">
              <div className="text-amber-300">{t('takenOver')}</div>
              <div className="font-mono text-[10px] text-amber-200/70">{fmtCountdown(remaining)} {t('untilResume')}</div>
            </div>
          ) : (
            <div className="text-[11px] text-emerald-300">{t('agentReplying')}</div>
          )}
        </div>
      </div>

      {/* messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-white/30 text-xs py-8">{t('noMessages')}</div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} userDisplayName={conv.displayName} userId={userId} />)
        )}
      </div>

      {/* composer */}
      <div className="border-t border-white/[0.06] p-3 space-y-2">
        {quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quickReplies.map((q, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300">
                {q}
                <button onClick={() => setQuickReplies(arr => arr.filter((_, j) => j !== i))} className="text-white/40 hover:text-white/80 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* AI suggestion bar — toggle + help + manual refresh + suggested chips */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-white/60 hover:text-white/85">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={e => setAiEnabled(e.target.checked)}
                className="accent-purple-500"
              />
              <Sparkles className="w-3 h-3 text-purple-300" />
              {t('aiQuickReplyEnable')}
            </label>
            <div className="relative inline-flex">
              <button
                onMouseEnter={() => setShowAiHelp(true)}
                onMouseLeave={() => setShowAiHelp(false)}
                onClick={() => setShowAiHelp(v => !v)}
                className="text-white/40 hover:text-white/80"
              >
                <HelpCircle className="w-3 h-3" />
              </button>
              {showAiHelp && (
                <div className="absolute bottom-full mb-1 left-0 z-10 w-72 p-2.5 rounded-md bg-[#0a0a1a] border border-white/[0.1] shadow-xl text-[11px] text-white/70 leading-relaxed">
                  {t('aiQuickReplyHelp')}
                </div>
              )}
            </div>
            {aiEnabled && (
              <button
                onClick={() => void fetchSuggestions(true)}
                disabled={aiLoading || draft.trim().length < 3}
                className="ml-auto p-1 rounded text-white/40 hover:text-purple-300 disabled:opacity-30"
                title={t('aiQuickReplyRefresh')}
              >
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5">
          <input
            value={qrInput}
            onChange={e => setQrInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && qrInput.trim()) {
                setQuickReplies(arr => [...arr, qrInput.trim()].slice(0, 13))
                setQrInput('')
              }
            }}
            placeholder={t('quickReplyPlaceholder')}
            className="flex-1 px-2 py-1 rounded-md bg-white/[0.03] border border-dashed border-purple-500/30 text-[11px] text-white/80 focus:outline-none focus:border-purple-500/60"
          />
          <button
            onClick={() => {
              if (qrInput.trim()) {
                setQuickReplies(arr => [...arr, qrInput.trim()].slice(0, 13))
                setQrInput('')
              }
            }}
            className="px-2.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 text-[11px]"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {imageUrl && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-cyan-500/[0.06] border border-cyan-500/25 text-[11px]">
            <img src={imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
            <span className="font-mono text-cyan-200/80 truncate flex-1">{imageUrl}</span>
            <button onClick={() => setImageUrl('')} className="text-white/40 hover:text-white/80">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {fileUrl && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-500/[0.06] border border-amber-500/25 text-[11px]">
            <FileText className="w-4 h-4 text-amber-300" />
            <div className="flex-1 min-w-0">
              <div className="text-amber-200/90 truncate">{fileName}</div>
              <div className="text-[9px] text-amber-200/50 font-mono">{t('fileWillBeSentAsLink')}</div>
            </div>
            <button onClick={() => { setFileUrl(''); setFileName('') }} className="text-white/40 hover:text-white/80">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        {uploadError && (
          <div className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/25 text-[11px] text-red-300">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('messagePlaceholder')}
            rows={2}
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white/85 focus:outline-none focus:border-cyan-500/40 resize-none"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/zip,video/mp4,audio/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setUploadError(null)
              setUploadingImage(true)
              try {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/customer-service/cs-media/upload', { method: 'POST', body: fd })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error ?? 'upload failed')
                if (data.kind === 'image') {
                  setImageUrl(data.url as string)
                  setFileUrl('')
                  setFileName('')
                } else {
                  setFileUrl(data.url as string)
                  setFileName(data.originalName || file.name)
                  setImageUrl('')
                }
              } catch (err) {
                setUploadError(err instanceof Error ? err.message : String(err))
              } finally {
                setUploadingImage(false)
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white/90 disabled:opacity-40 flex items-center gap-1.5"
            title={t('attachImage')}
          >
            {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setStickerPickerOpen(o => !o)}
            className={`px-3 py-2 rounded-lg border flex items-center gap-1.5 ${
              stickerPickerOpen
                ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200'
                : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white/90'
            }`}
            title={t('sendSticker')}
          >
            <Smile className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const mode: 'text' | 'image' | 'file' = fileUrl ? 'file' : imageUrl ? 'image' : 'text'
              sendMutation.mutate(mode)
            }}
            disabled={sendMutation.isPending || (!draft.trim() && !imageUrl && !fileUrl)}
            className="px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40 flex items-center gap-1.5"
          >
            {sendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {t('send')}
          </button>
        </div>

        {sendMutation.isError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/25 text-[12px] text-red-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{(sendMutation.error as Error).message}</span>
          </div>
        )}
      </div>

      <AgentTimelineDrawer userId={userId} open={timelineOpen} onOpenChange={setTimelineOpen} />

      <StickerPicker
        open={stickerPickerOpen}
        onOpenChange={setStickerPickerOpen}
        onPick={(packageId, stickerId) => {
          sendMutation.mutate({ mode: 'sticker', packageId, stickerId })
        }}
        sending={sendMutation.isPending}
      />
    </>
  )
}

function MessageBubble({ msg, userDisplayName, userId }: { msg: MessageRow; userDisplayName: string | null; userId: string }) {
  const isUser = msg.direction === 'user'
  const isBot = msg.direction === 'bot'
  const isOp = msg.direction === 'operator'
  const alignment = isUser ? 'items-start' : 'items-end'
  const bubbleClass = isUser
    ? 'bg-white/[0.04] border-white/[0.08]'
    : isBot
      ? 'bg-cyan-500/[0.08] border-cyan-500/25'
      : 'bg-purple-500/[0.10] border-purple-500/35'
  const tagClass = isUser ? 'text-white/40' : isBot ? 'text-cyan-300' : 'text-purple-300'
  // Prefer the LINE display name for inbound bubbles; fall back to a
  // shortened userId so something always renders.
  const userLabel = userDisplayName?.trim() || `${userId.slice(0, 8)}…`
  const tag = isUser ? userLabel : isBot ? 'BOT' : 'OPERATOR'

  let body: React.ReactNode = msg.text
  let imageUrl: string | null = null
  let fileUrl: string | null = null
  let fileName: string | null = null
  let mime: string | null = null
  let quickReplies: string[] = []
  let stickerId: string | null = null
  if (msg.payload) {
    try {
      const p = JSON.parse(msg.payload) as {
        imageUrl?: string;
        fileUrl?: string;
        fileName?: string;
        mime?: string;
        storedFilename?: string;
        quickReplies?: string[];
        packageId?: string;
        stickerId?: string;
      }
      // Inbound rich messages store only the filename — build the URL
      // relative to the current host so it works whether you're on
      // farfar-mcc.gbox.tw or http://localhost:3737.
      const relative = p.storedFilename ? `/api/customer-service/cs-media/${p.storedFilename}` : null
      if (p.imageUrl) imageUrl = p.imageUrl
      else if (relative && (msg.type === 'image' || msg.type === 'video' || msg.type === 'audio')) imageUrl = relative
      if (p.fileUrl) fileUrl = p.fileUrl
      else if (relative && msg.type === 'file') fileUrl = relative
      if (p.fileName) fileName = p.fileName
      else if (p.storedFilename) fileName = p.storedFilename
      if (p.mime) mime = p.mime
      if (Array.isArray(p.quickReplies)) quickReplies = p.quickReplies
      if (p.stickerId) stickerId = String(p.stickerId)
    } catch { /* ignore */ }
  }
  if (msg.type === 'image' && imageUrl) {
    body = <a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt="" className="rounded-md max-w-[220px]" /></a>
  } else if (msg.type === 'video' && imageUrl) {
    body = <video src={imageUrl} controls className="rounded-md max-w-[220px]" />
  } else if (msg.type === 'audio' && imageUrl) {
    body = <audio src={imageUrl} controls className="w-[220px]" />
  } else if (msg.type === 'file') {
    const href = fileUrl ?? imageUrl
    if (href) {
      body = (
        <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline">
          <span>📎</span>
          <span className="truncate max-w-[180px]">{fileName ?? href.split('/').pop()}</span>
          {mime && <span className="text-[9px] text-white/30 font-mono">{mime.split('/')[1]}</span>}
        </a>
      )
    }
  } else if (msg.type === 'sticker') {
    if (stickerId) {
      const url = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/android/sticker.png`
      body = <img src={url} alt={`sticker ${stickerId}`} className="w-[120px] h-[120px] object-contain" loading="lazy" />
    } else {
      body = <span className="text-2xl">🏷️ sticker</span>
    }
  } else if (msg.type === 'deleted_media') {
    body = <span className="text-white/40 italic text-[12px]">{msg.text || '[已逾保存期限]'}</span>
  }

  return (
    <div className={`flex flex-col ${alignment}`}>
      <div className={`max-w-[78%] flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
        <div className={`text-[9px] font-mono tracking-widest mb-1 ${tagClass}`}>{tag}</div>
        <div className={`px-3.5 py-2 rounded-2xl border text-[13px] text-white/85 ${bubbleClass} ${isUser ? 'rounded-tl-sm' : 'rounded-tr-sm'} ${msg.type === 'image' ? 'p-1' : ''}`}>
          {body}
        </div>
        {quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {quickReplies.map((q, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.12] text-white/65">{q}</span>
            ))}
          </div>
        )}
        <div className={`text-[9px] font-mono text-white/30 mt-1 px-1 ${isUser ? 'text-left' : 'text-right'}`}>
          {fmtClock(msg.createdAt)}
        </div>
      </div>
    </div>
  )
}
