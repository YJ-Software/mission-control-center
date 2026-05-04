'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'

interface PodcastPlayerProps {
  date: string
  compact?: boolean
}

export function PodcastPlayer({ date, compact = false }: PodcastPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [exists, setExists] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioUrl = `/api/morning-report?type=podcast&date=${date}`

  // Check if podcast exists for this date
  useEffect(() => {
    setExists(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)

    const controller = new AbortController()
    fetch(audioUrl, { method: 'HEAD', signal: controller.signal })
      .then(res => {
        if (res.ok && res.headers.get('content-type')?.startsWith('audio/')) {
          setExists(true)
        }
      })
      .catch(() => {
        // ignore
      })

    return () => controller.abort()
  }, [audioUrl])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
    setPlaying(!playing)
  }, [playing])

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentTime(audio.currentTime)
  }

  const handleLoadedMetadata = () => {
    const audio = audioRef.current
    if (!audio) return
    setDuration(audio.duration)
  }

  const handleEnded = () => {
    setPlaying(false)
    setCurrentTime(0)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
    setCurrentTime(audio.currentTime)
  }

  const formatTime = (t: number) => {
    if (!isFinite(t)) return '0:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (!exists) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (compact) {
    return (
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-3">
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
        <button
          onClick={togglePlay}
          className="shrink-0 w-7 h-7 rounded-full bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-400 hover:bg-cyan-400/20 transition-colors"
        >
          {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
        </button>
        <Volume2 className="w-3 h-3 text-white/30 shrink-0" />
        <span className="font-mono text-[10px] text-white/40 shrink-0">Podcast</span>
        <div
          className="flex-1 h-1 bg-white/[0.06] rounded-full cursor-pointer group"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-cyan-400/40 rounded-full transition-all group-hover:bg-cyan-400/60"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-mono text-[9px] text-white/30 shrink-0 tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    )
  }

  // Full mode
  return (
    <div className="cyber-card p-4 space-y-3">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="shrink-0 w-10 h-10 rounded-full bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-400 hover:bg-cyan-400/20 transition-colors"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-white/40" />
            <span className="text-sm text-white/70 font-medium">{date} Podcast</span>
          </div>
          <div
            className="h-1.5 bg-white/[0.06] rounded-full cursor-pointer group"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-cyan-400/40 rounded-full transition-all group-hover:bg-cyan-400/60"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between">
            <span className="font-mono text-[10px] text-white/30 tabular-nums">
              {formatTime(currentTime)}
            </span>
            <span className="font-mono text-[10px] text-white/30 tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
