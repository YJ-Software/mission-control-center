'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'next-intl'
import { Mic, RefreshCw, Calendar, Loader2, Music, Play } from 'lucide-react'
import { PodcastPlayer } from './podcast-player'

function todayStr() {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

export function PodcastManager() {
  const t = useTranslations('morningReport')
  const queryClient = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [generateDate, setGenerateDate] = useState(todayStr)

  // Fetch reports list to find dates that may have podcasts
  const { data: reports = [] } = useQuery<
    { filename: string; date: string; size: number; format: string }[]
  >({
    queryKey: ['morning-reports'],
    queryFn: () =>
      fetch('/api/morning-report?type=reports').then((r) => r.json()),
  })

  // Check which dates have podcasts
  const { data: podcastDates = [] } = useQuery<string[]>({
    queryKey: ['podcast-dates', reports.map((r) => r.date).join(',')],
    enabled: reports.length > 0,
    queryFn: async () => {
      const dates = Array.from(new Set(reports.map((r) => r.date)))
      const checks = await Promise.all(
        dates.map(async (date) => {
          try {
            const res = await fetch(
              `/api/morning-report?type=podcast&date=${date}`,
              { method: 'HEAD' },
            )
            return res.ok &&
              res.headers.get('content-type')?.startsWith('audio/')
              ? date
              : null
          } catch {
            return null
          }
        }),
      )
      return checks.filter(Boolean) as string[]
    },
  })

  // Generate podcast mutation
  const generateMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch(
        `/api/morning-report?action=podcast&date=${date}&wait=1`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || t('podcast.generateFailed'))
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast-dates'] })
    },
  })

  // Regenerate current podcast
  const regenerateMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch(
        `/api/morning-report?action=podcast&date=${date}&wait=1`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || t('podcast.regenerateFailed'))
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast-dates'] })
    },
  })

  const isGenerating = generateMutation.isPending || regenerateMutation.isPending

  return (
    <div className="space-y-4">
      {/* A. Featured Player */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Mic className="w-4 h-4 text-purple-400" />
            {t('podcast.player')}
          </h3>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px] border-white/10 text-white/50"
            >
              {selectedDate}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-white/60 hover:text-white hover:bg-white/[0.06]"
              disabled={regenerateMutation.isPending}
              onClick={() => regenerateMutation.mutate(selectedDate)}
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              {t('podcast.regenerate')}
            </Button>
          </div>
        </div>
        <div className="p-6">
          <PodcastPlayer
            key={`${selectedDate}-${regenerateMutation.isSuccess}`}
            date={selectedDate}
            compact={false}
          />
          {regenerateMutation.isSuccess && (
            <p className="mt-2 text-xs text-green-400/70">{t('podcast.regenerateSuccess')}</p>
          )}
          {regenerateMutation.isError && (
            <p className="mt-2 text-xs text-red-400/70">
              {(regenerateMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>

      {/* B. Generate Podcast */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Music className="w-4 h-4 text-cyan-400" />
            {t('podcast.generatePodcast')}
          </h3>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
              <Input
                type="date"
                value={generateDate}
                onChange={(e) => setGenerateDate(e.target.value)}
                className="pl-9 bg-white/[0.03] border-white/[0.08] text-white/80 text-sm h-9 [color-scheme:dark]"
              />
            </div>
            <Button
              size="sm"
              className="h-9 px-4 bg-purple-500/20 border border-purple-400/30 text-purple-300 hover:bg-purple-500/30 hover:text-purple-200"
              disabled={isGenerating || !generateDate}
              onClick={() => generateMutation.mutate(generateDate)}
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Mic className="w-3.5 h-3.5 mr-1.5" />
              )}
              {t('podcast.generatePodcast')}
            </Button>
          </div>
          {generateMutation.isSuccess && (
            <p className="mt-2 text-xs text-green-400/70">
              {t('podcast.generateSuccess')}
            </p>
          )}
          {generateMutation.isError && (
            <p className="mt-2 text-xs text-red-400/70">
              {(generateMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>

      {/* C. History List */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-cyan-400" />
            {t('podcast.historyPodcast')}
            {podcastDates.length > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] border-cyan-400/20 text-cyan-400/60"
              >
                {podcastDates.length}
              </Badge>
            )}
          </h3>
        </div>
        <div className="p-3 space-y-1 max-h-64 overflow-y-auto">
          {podcastDates.length === 0 && (
            <p className="text-xs text-white/30 text-center py-4">
              {t('podcast.noHistory')}
            </p>
          )}
          {podcastDates
            .sort((a, b) => b.localeCompare(a))
            .map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  date === selectedDate
                    ? 'bg-cyan-400/10 border border-cyan-400/20'
                    : 'hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Play
                  className={`w-3.5 h-3.5 shrink-0 ${
                    date === selectedDate
                      ? 'text-cyan-400'
                      : 'text-white/30'
                  }`}
                />
                <span
                  className={`text-sm font-mono ${
                    date === selectedDate
                      ? 'text-cyan-400'
                      : 'text-white/60'
                  }`}
                >
                  {date}
                </span>
                {date === todayStr() && (
                  <Badge
                    variant="outline"
                    className="ml-auto text-[9px] border-purple-400/20 text-purple-400/60"
                  >
                    {t('podcast.today')}
                  </Badge>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
