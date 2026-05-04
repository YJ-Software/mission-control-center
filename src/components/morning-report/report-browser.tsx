'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Newspaper, Calendar, ChevronLeft, ChevronRight, Cloud, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PodcastPlayer } from './podcast-player'

interface Report {
  filename: string
  date: string
  size: number
  format: string
}

interface ReportContent {
  content: string | null
  format?: string
  date: string
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ReportBrowser() {
  const t = useTranslations('morningReport')
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)

  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ['morning-reports'],
    queryFn: () => fetch('/api/morning-report?type=reports').then(r => r.json()),
  })

  const { data: reportContent, isLoading: reportLoading } = useQuery<ReportContent>({
    queryKey: ['morning-report-content', selectedDate],
    queryFn: () =>
      fetch(`/api/morning-report?type=report&date=${selectedDate}`).then(r => r.json()),
  })

  const { data: tunnelStatus } = useQuery<{ active: boolean; url?: string; token?: string }>({
    queryKey: ['tunnel-status'],
    queryFn: () => fetch('/api/morning-report?type=tunnel-status').then(r => r.json()),
    refetchInterval: (query) => query.state.data?.active ? 5000 : false,
  })

  // Build tunnel URL for the selected date's HTML report
  const tunnelReportUrl = tunnelStatus?.active && tunnelStatus?.url && tunnelStatus?.token && selectedDate
    ? `${tunnelStatus.url}/morning-report-${selectedDate.replace(/-/g, '')}.html?token=${tunnelStatus.token}`
    : null

  const navigateDate = (direction: 'prev' | 'next') => {
    const idx = reports.findIndex(r => r.date === selectedDate)
    if (direction === 'prev') {
      // Go to older report (next index since sorted desc)
      if (idx >= 0 && idx < reports.length - 1) {
        setSelectedDate(reports[idx + 1].date)
      } else if (idx === -1 && reports.length > 0) {
        // current date not in list — find the closest older date
        const older = reports.find(r => r.date < selectedDate)
        if (older) setSelectedDate(older.date)
      }
    } else {
      // Go to newer report (prev index)
      if (idx > 0) {
        setSelectedDate(reports[idx - 1].date)
      } else if (idx === -1 && reports.length > 0) {
        const newer = [...reports].reverse().find(r => r.date > selectedDate)
        if (newer) setSelectedDate(newer.date)
      }
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Report list */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-purple-400" />
            {t('browser.reportRecords')}
          </h3>
        </div>
        <div className="p-3">
          <div className="space-y-0.5 max-h-[70vh] overflow-y-auto">
            {reports.filter((r, i, arr) => arr.findIndex(x => x.date === r.date) === i).map(report => (
              <button
                key={report.date}
                onClick={() => setSelectedDate(report.date)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all text-sm ${
                  selectedDate === report.date
                    ? 'bg-white/[0.08] border border-white/[0.12] text-white'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span className="font-mono text-[10px]">{report.date}</span>
                  <span className="ml-auto font-mono text-[9px] text-white/20 uppercase">
                    {report.format}
                  </span>
                </div>
              </button>
            ))}
            {reports.length === 0 && (
              <p className="font-mono text-[10px] text-white/20 tracking-[0.3em] text-center py-4">
                {t('browser.noRecords')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Right: Report content */}
      <div className="lg:col-span-2">
        <div className="cyber-card h-full">
          {/* Header with date nav */}
          <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-cyan-400" />
              <span className="font-mono text-yellow-400/70 tracking-wide text-xs">
                {selectedDate}
              </span>{' '}
              {t('browser.report')}
            </h3>
            <div className="flex items-center gap-2">
              {tunnelReportUrl && (
                <a
                  href={tunnelReportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-orange-300/70 hover:text-orange-300 font-mono transition-colors"
                  title={tunnelReportUrl}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                className="rounded-lg border border-white/[0.08] text-white/35 hover:text-white/70 transition-colors p-1.5 hover:bg-white/[0.05]"
                onClick={() => navigateDate('prev')}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                className="rounded-lg border border-white/[0.08] text-white/35 hover:text-white/70 transition-colors p-1.5 hover:bg-white/[0.05]"
                onClick={() => navigateDate('next')}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Podcast mini player */}
          <PodcastPlayer date={selectedDate} compact />

          {/* Report body */}
          <div className="p-4">
            {reportLoading ? (
              <div className="flex items-center justify-center h-64">
                <span className="font-mono text-white/20 tracking-[0.3em] text-xs typewriter">
                  {t('browser.loadingReport')}
                </span>
              </div>
            ) : !reportContent?.content ? (
              <div className="flex flex-col items-center justify-center h-64">
                <Newspaper className="w-8 h-8 mb-2 opacity-20 text-cyan-400" />
                <p className="font-mono text-white/20 tracking-[0.3em] text-xs">
                  {t('browser.noReportForDate', { date: selectedDate })}
                </p>
                <p className="font-mono text-[10px] text-white/15 mt-1 tracking-wide">
                  {t('browser.autoGenerateNote')}
                </p>
              </div>
            ) : reportContent.format === 'html' ? (
              <div
                className="prose prose-invert prose-sm max-w-none max-h-[70vh] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: reportContent.content }}
              />
            ) : (
              <pre className="font-mono text-xs text-white/75 whitespace-pre-wrap max-h-[70vh] overflow-y-auto p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl tracking-wide">
                {reportContent.content}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
