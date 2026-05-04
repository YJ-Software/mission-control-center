'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, Plus, FileText, Save, Loader2, ChevronDown, ChevronRight, Clock, GripVertical, Lock, Power, CheckSquare, Square, CheckCircle2, Cloud, Copy, ExternalLink, Rocket } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TopicCard, type Topic } from './topic-card'
import { TemplateEditor } from './template-editor'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Compute cron time string for a topic at given index, starting from startTime
function computeCronTime(startTime: string, index: number, interval: number = 5): string {
  const [h, m] = startTime.split(':').map(Number)
  const totalMin = h * 60 + m + index * interval
  const hour = Math.floor(totalMin / 60) % 24
  const min = totalMin % 60
  return `${min} ${hour}`
}

function formatCronDisplay(cronTime: string): string {
  const [min, hour] = cronTime.split(' ').map(Number)
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Compute offset cron time from a base cron string (e.g. last topic + N minutes)
function offsetCronTime(baseCron: string, offsetMin: number): string {
  const [min, hour] = baseCron.split(' ').map(Number)
  const totalMin = hour * 60 + min + offsetMin
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${m} ${h}`
}

// Tunnel toolbar control for the topic manager toolbar row
function TunnelToolbarControl({ enabled }: { enabled: boolean }) {
  const t = useTranslations('morningReport')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()

  const { data: status } = useQuery<{ active: boolean; url?: string; port?: number; token?: string }>({
    queryKey: ['tunnel-status'],
    queryFn: () => fetch('/api/morning-report?type=tunnel-status').then(r => r.json()),
    refetchInterval: (query) => query.state.data?.active ? 5000 : false,
  })

  const active = status?.active ?? false

  // Auto-start tunnel when morning report is enabled and tunnel is not active
  useEffect(() => {
    if (enabled && !active && !starting && status !== undefined) {
      setStarting(true)
      setError(null)
      fetch('/api/morning-report?action=tunnel-start&mode=background', { method: 'POST' })
        .then(() => queryClient.invalidateQueries({ queryKey: ['tunnel-status'] }))
        .catch((err: any) => setError(err.message))
        .finally(() => setStarting(false))
    }
  }, [enabled, active, starting, status, queryClient])

  // Full URL with token for sharing
  const fullUrl = status?.url && status?.token ? `${status.url}/?token=${status.token}` : status?.url ?? ''

  const handleCopy = () => {
    if (!fullUrl) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(fullUrl)
    } else {
      const ta = document.createElement('textarea')
      ta.value = fullUrl
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Extract short domain for display
  const shortUrl = status?.url?.replace('https://', '').replace('.trycloudflare.com', '') ?? ''

  return (
    <div className="flex items-center gap-1.5">
      {starting ? (
        <Loader2 className="w-4 h-4 animate-spin text-white/30" />
      ) : active ? (
        <CheckSquare className="w-4 h-4 text-green-400" />
      ) : (
        <Square className="w-4 h-4 text-white/30" />
      )}
      <Cloud className={`w-4 h-4 ${active ? 'text-orange-400' : 'text-white/30'}`} />
      <span className={`text-sm font-medium ${active ? 'text-white/80' : 'text-white/40'}`}>
        Tunnel
      </span>
      {starting && (
        <span className="text-[10px] text-white/30">{t('tunnel.starting')}</span>
      )}
      {active && fullUrl && (
        <>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-400 hover:text-cyan-300 font-mono max-w-[140px] truncate"
            title={fullUrl}
          >
            {shortUrl}
          </a>
          <button
            onClick={handleCopy}
            className="p-0.5 text-white/30 hover:text-white/60 transition-colors"
            title={t('tunnel.title')}
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => window.open(fullUrl, '_blank')}
            className="p-0.5 text-white/30 hover:text-white/60 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      {error && (
        <span className="text-[10px] text-red-400 max-w-[120px] truncate" title={error}>!</span>
      )}
    </div>
  )
}

// Sortable wrapper for TopicCard
function SortableTopicCard({
  topic, isExpanded, onToggleExpand, onUpdate, onDelete, availableModels, globalModel,
}: {
  topic: Topic; isExpanded: boolean; onToggleExpand: () => void
  onUpdate: (data: Partial<Topic>) => Promise<void> | void; onDelete: () => void
  availableModels?: { id: string; name: string }[]; globalModel?: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: topic.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <TopicCard
        topic={topic}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        onUpdate={onUpdate}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
        availableModels={availableModels}
        globalModel={globalModel}
      />
    </div>
  )
}

export function TopicManager() {
  const t = useTranslations('morningReport')
  const tc = useTranslations('common')
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedFixedJob, setExpandedFixedJob] = useState<string | null>(null)
  const [formatExpanded, setFormatExpanded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTopic, setNewTopic] = useState({ id: '', name: '', emoji: '📝' })
  const [configSavedJob, setConfigSavedJob] = useState<string | null>(null)
  const [editingTemplates, setEditingTemplates] = useState<Record<string, string>>({})

  // Fetch topics
  const { data: topics = [], isLoading } = useQuery<Topic[]>({
    queryKey: ['morning-topics'],
    queryFn: () => fetch('/api/morning-report?type=topics').then(r => r.json()),
  })

  // Fetch config (for startTime)
  const { data: config } = useQuery<Record<string, string>>({
    queryKey: ['morning-report-config'],
    queryFn: () => fetch('/api/morning-report?type=config').then(r => r.json()),
  })

  // Fetch default templates
  const { data: defaultTemplates } = useQuery<Record<string, string>>({
    queryKey: ['morning-report-default-templates'],
    queryFn: () => fetch('/api/morning-report?type=default-templates').then(r => r.json()),
  })

  // Fetch available models
  const { data: modelsData } = useQuery<{ models: { id: string; name: string }[]; defaultModel: string }>({
    queryKey: ['morning-report-models'],
    queryFn: () => fetch('/api/morning-report?type=models').then(r => r.json()),
  })
  const availableModels = modelsData?.models ?? []
  const defaultModel = modelsData?.defaultModel ?? ''

  // Derive startTime and interval from config (only on initial load)
  const [startTime, setStartTime] = useState('08:00')
  const [interval, setInterval] = useState(5)
  const configInitialized = useRef(false)
  useEffect(() => {
    if (configInitialized.current) return
    if (!config) return
    configInitialized.current = true
    if (config.startTime) {
      setStartTime(config.startTime)
    } else if (topics.length > 0) {
      const sorted = [...topics].sort((a, b) => a.sortOrder - b.sortOrder)
      const first = sorted[0].cronTime ?? '0 8'
      const [min, hour] = first.split(' ').map(Number)
      setStartTime(`${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
    }
    if (config.interval) {
      setInterval(Number(config.interval) || 5)
    }
  }, [config, topics])

  // Fetch format template
  const { data: formatTemplate } = useQuery<{ content: string }>({
    queryKey: ['morning-topics', 'format-template'],
    queryFn: () => fetch('/api/morning-report?type=format-template').then(r => r.json()),
  })

  const [formatContent, setFormatContent] = useState<string | null>(null)
  const displayFormatContent = formatContent ?? formatTemplate?.content ?? ''

  // Update topic mutation (also syncs cron when enabled changes)
  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Topic> & { id: string }) => {
      await fetch('/api/morning-report', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json())
      // Backend PUT handler already calls syncCronJobs()
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ['morning-topics'] })
      const previous = queryClient.getQueryData<Topic[]>(['morning-topics'])
      if (previous) {
        queryClient.setQueryData<Topic[]>(['morning-topics'],
          previous.map(t => t.id === data.id ? { ...t, ...data } : t)
        )
      }
      return { previous }
    },
    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['morning-topics'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
    },
  })

  // Create topic mutation
  const createMutation = useMutation({
    mutationFn: (data: { id: string; name: string; emoji: string }) => {
      const payload = {
        ...data,
        outputFilename: `morning-report-${data.id}-\${TODAY}.md`,
      }
      return fetch('/api/morning-report?action=create-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
      setCreateOpen(false)
      setNewTopic({ id: '', name: '', emoji: '📝' })
    },
  })

  // Delete topic mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/morning-report?id=${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
    },
  })

  // Reorder + sync cron mutation
  const reorderMutation = useMutation({
    mutationFn: (payload: { topics: { id: string; sortOrder: number; cronTime: string }[]; startTime: string }) =>
      fetch('/api/morning-report?action=reorder-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
    },
  })

  // Save format template mutation
  const formatMutation = useMutation({
    mutationFn: (content: string) =>
      fetch('/api/morning-report?type=format-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics', 'format-template'] })
      setFormatContent(null)
    },
  })

  // Update config + sync cron mutation
  const configMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      fetch('/api/morning-report?type=config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json()),
      // Backend PUT handler already calls syncCronJobs()
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      const keys = Object.keys(variables)
      const jobKey = keys.some(k => k.toLowerCase().includes('finalize')) ? 'finalize'
        : keys.some(k => k.toLowerCase().includes('podcast')) ? 'podcast'
          : null
      if (jobKey) {
        setConfigSavedJob(jobKey)
        setTimeout(() => setConfigSavedJob(null), 5000)
      }
      // Auto-start tunnel when enabling, auto-stop when disabling
      if (variables.enabled === 'true') {
        fetch('/api/morning-report?action=tunnel-start&mode=background', { method: 'POST' })
          .then(() => queryClient.invalidateQueries({ queryKey: ['tunnel-status'] }))
          .catch(() => {})
      } else if (variables.enabled === 'false') {
        fetch('/api/morning-report?action=tunnel-stop', { method: 'POST' })
          .then(() => queryClient.invalidateQueries({ queryKey: ['tunnel-status'] }))
          .catch(() => {})
      }
    },
  })

  // Save template mutation (without cron sync)
  const templateMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      await fetch('/api/morning-report?type=config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json())
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      setEditingTemplates(prev => {
        const next = { ...prev }
        for (const key of Object.keys(variables)) delete next[key]
        return next
      })
      const keys = Object.keys(variables)
      const jobKey = keys.some(k => k.includes('finalize')) ? 'finalize' : 'podcast'
      setConfigSavedJob(jobKey)
      setTimeout(() => setConfigSavedJob(null), 5000)
    },
  })

  const masterEnabled = config?.enabled === 'true'
  const finalizeEnabled = config?.finalizeEnabled !== 'false' // default true
  const podcastEnabled = config?.podcastEnabled !== 'false' // default true
  const podcastHarvestEnabled = config?.podcastHarvestEnabled !== 'false' // default true
  const cronModel = config?.cronModel || defaultModel || 'zai/glm-5'
  const isFirstTime = !isLoading && topics.length === 0 && !masterEnabled

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/morning-report?action=bootstrap', { method: 'POST' })
      if (!res.ok) throw new Error('Bootstrap failed')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      queryClient.invalidateQueries({ queryKey: ['morning-topics', 'format-template'] })
    },
  })

  const handleToggleMaster = () => {
    configMutation.mutate({ enabled: masterEnabled ? 'false' : 'true' })
  }

  const handleToggleFinalize = () => {
    configMutation.mutate({ finalizeEnabled: finalizeEnabled ? 'false' : 'true' })
  }

  const handleTogglePodcast = () => {
    configMutation.mutate({ podcastEnabled: podcastEnabled ? 'false' : 'true' })
  }

  const handleTogglePodcastHarvest = () => {
    configMutation.mutate({ podcastHarvestEnabled: podcastHarvestEnabled ? 'false' : 'true' })
  }

  const getTemplateValue = (key: string) =>
    editingTemplates[key] ?? config?.[key] ?? defaultTemplates?.[key] ?? ''

  const hasTemplateChanges = (key: string) =>
    key in editingTemplates && editingTemplates[key] !== (config?.[key] ?? defaultTemplates?.[key] ?? '')

  const handleTemplateSave = (key: string) =>
    templateMutation.mutate({ [key]: getTemplateValue(key) })

  const handleTemplateReset = (key: string) => {
    if (!defaultTemplates?.[key]) return
    templateMutation.mutate({ [key]: defaultTemplates[key] })
  }

  const handleUpdate = async (topicId: string, data: Partial<Topic>) => {
    await updateMutation.mutateAsync({ id: topicId, ...data })
    // When enabled status changes, recalculate all cron times
    if ('enabled' in data) {
      const updated = sortedTopics.map(t =>
        t.id === topicId ? { ...t, ...data } : t
      )
      saveReorder(updated, startTime, interval)
    }
  }

  const handleCreateSubmit = () => {
    if (!newTopic.id.trim() || !newTopic.name.trim()) return
    createMutation.mutate(newTopic)
  }

  const sortedTopics = [...topics].sort((a, b) => a.sortOrder - b.sortOrder)
  const hasFormatChanges = formatContent !== null && formatContent !== formatTemplate?.content

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Save reorder with auto cron times (disabled topics are skipped in time slots)
  const saveReorder = useCallback((reordered: Topic[], time: string, gap: number = interval) => {
    let activeIdx = 0
    const payload = reordered.map((t, i) => {
      const cronTime = t.enabled ? computeCronTime(time, activeIdx++, gap) : (t.cronTime ?? '0 8')
      return { id: t.id, sortOrder: i, cronTime }
    })
    reorderMutation.mutate({ topics: payload, startTime: time })
  }, [reorderMutation, interval])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortedTopics.findIndex(t => t.id === active.id)
    const newIndex = sortedTopics.findIndex(t => t.id === over.id)
    const reordered = arrayMove(sortedTopics, oldIndex, newIndex)
    saveReorder(reordered, startTime)
  }

  const handleStartTimeChange = (newTime: string) => {
    setStartTime(newTime)
  }
  const handleStartTimeBlur = () => {
    if (sortedTopics.length > 0) {
      saveReorder(sortedTopics, startTime, interval)
    }
  }

  const handleIntervalChange = (newInterval: number) => {
    setInterval(newInterval)
    configMutation.mutate({ interval: String(newInterval) })
    if (sortedTopics.length > 0) {
      saveReorder(sortedTopics, startTime, newInterval)
    }
  }

  // First-time activation panel
  if (isFirstTime) {
    return (
      <div className="space-y-6">
        <div className="cyber-card p-8 flex flex-col items-center justify-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Rocket className="w-8 h-8 text-purple-400" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-white/90">{t('topicManager.firstTimeTitle')}</h3>
            <p className="text-sm text-white/40 max-w-md">{t('topicManager.firstTimeDescription')}</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => bootstrapMutation.mutate()}
              disabled={bootstrapMutation.isPending}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
            >
              {bootstrapMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Rocket className="w-4 h-4" />
              )}
              {bootstrapMutation.isPending ? t('topicManager.activating') : t('topicManager.activateButton')}
            </button>
            <p className="text-[10px] text-white/25 font-mono">{t('topicManager.activateHint')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-purple-400" />
          {t('tabs.topics')}
          <span className="text-[10px] text-white/30 font-mono">
            {t('topicManager.topicCount', { count: topics.length })}
          </span>
        </h3>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/20 text-xs"
            >
              <Plus className="w-3 h-3 mr-1.5" />
              {t('topicManager.addTopic')}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#0a0a1a] border-white/[0.1]">
            <DialogHeader>
              <DialogTitle className="text-white/90">{t('topicManager.createTopic')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                  {t('topicManager.topicId')}
                </label>
                <Input
                  value={newTopic.id}
                  onChange={e => {
                    const v = e.target.value.replace(/[^a-zA-Z0-9-]/g, '')
                    setNewTopic(s => ({ ...s, id: v }))
                  }}
                  pattern="[a-zA-Z0-9-]+"
                  placeholder={t('topicManager.topicIdPlaceholder')}
                  className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                  {t('topicManager.topicName')}
                </label>
                <Input
                  value={newTopic.name}
                  onChange={e => setNewTopic(s => ({ ...s, name: e.target.value }))}
                  placeholder={t('topicManager.topicNamePlaceholder')}
                  className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                  Emoji
                </label>
                <Input
                  value={newTopic.emoji}
                  onChange={e => setNewTopic(s => ({ ...s, emoji: e.target.value }))}
                  className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80 w-24"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateOpen(false)}
                  className="text-white/40 text-xs"
                >
                  {tc('cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateSubmit}
                  disabled={!newTopic.id.trim() || !newTopic.name.trim() || createMutation.isPending}
                  className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/20
                    disabled:opacity-30 text-xs"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3 mr-1.5" />
                  )}
                  {tc('build')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Master toggle + Start Time + Interval (single row) */}
      <div className="cyber-card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Master toggle */}
          <button
            onClick={handleToggleMaster}
            disabled={configMutation.isPending}
            className="p-1 transition-colors"
            title={masterEnabled ? t('topicManager.disableMorningReport') : t('topicManager.enableMorningReport')}
          >
            {configMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/30" />
            ) : masterEnabled ? (
              <CheckSquare className="w-4 h-4 text-green-400" />
            ) : (
              <Square className="w-4 h-4 text-white/30 hover:text-white/50" />
            )}
          </button>
          <span className={`text-sm font-medium ${masterEnabled ? 'text-white/80' : 'text-white/40'}`}>
            {t('topicManager.morningReportFeature')}
          </span>
          <Badge
            className={`text-[10px] font-mono ${masterEnabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/5 text-white/30 border-white/10'}`}
            variant="outline"
          >
            {masterEnabled ? tc('enabled') : tc('disabled')}
          </Badge>

          {/* Divider */}
          <div className="w-px h-5 bg-white/[0.08]" />

          {/* Start time + interval */}
          <Clock className="w-4 h-4 text-amber-400" />
          <Input
            type="time"
            value={startTime}
            onChange={e => handleStartTimeChange(e.target.value)}
            onBlur={handleStartTimeBlur}
            disabled={!masterEnabled}
            className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80 font-mono w-32 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="text-[10px] text-white/40 font-mono">{t('topicManager.every')}</span>
          <select
            value={interval}
            onChange={e => handleIntervalChange(Number(e.target.value))}
            disabled={!masterEnabled}
            className="bg-white/[0.03] border border-white/[0.08] text-sm text-white/80 font-mono rounded-md px-2 py-1.5 outline-none focus:border-amber-400/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {Array.from({ length: 16 }, (_, i) => i + 5).map(n => (
              <option key={n} value={n} className="bg-[#0a0a1a] text-white/80">{n}</option>
            ))}
          </select>
          <span className="text-[10px] text-white/40 font-mono">{t('topicManager.minutes')}</span>
          <span className="text-[10px] text-white/40 font-mono">{t('topicManager.runOneTopic')}</span>

          {/* Divider */}
          <div className="w-px h-5 bg-white/[0.08]" />

          {/* Podcast toggle */}
          <button
            onClick={handleTogglePodcast}
            disabled={!masterEnabled || configMutation.isPending}
            className="p-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={podcastEnabled ? t('topicManager.disablePodcast') : t('topicManager.enablePodcast')}
          >
            {masterEnabled && podcastEnabled ? (
              <CheckSquare className="w-4 h-4 text-green-400" />
            ) : (
              <Square className="w-4 h-4 text-white/30 hover:text-white/50" />
            )}
          </button>
          <span className={`text-sm font-medium ${masterEnabled && podcastEnabled ? 'text-white/80' : 'text-white/40'}`}>
            Podcast
          </span>
          <Badge
            className={`text-[10px] font-mono ${masterEnabled && podcastEnabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-white/5 text-white/30 border-white/10'}`}
            variant="outline"
          >
            {masterEnabled && podcastEnabled ? tc('enabled') : tc('disabled')}
          </Badge>
          {/* Divider */}
          <div className="w-px h-5 bg-white/[0.08]" />

          {/* Quick Tunnel */}
          <TunnelToolbarControl enabled={masterEnabled} />

          {(reorderMutation.isPending || configMutation.isPending) && (
            <span className="flex items-center gap-1 text-xs text-amber-400 animate-in fade-in duration-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('topicManager.backgroundSaving')}
            </span>
          )}
        </div>
      </div>

      {/* Format Template (collapsible, same style as topic cards) */}
      <div className="cyber-card hover:border-white/[0.12] transition-all">
        <div
          className="p-4 flex items-center gap-3 cursor-pointer select-none"
          onClick={() => setFormatExpanded(prev => !prev)}
        >
          <span className="text-2xl">📋</span>
          <span className="text-sm font-medium flex-1 text-white/80">
            {t('topicManager.globalFormatTemplate')}
          </span>
          {formatExpanded ? (
            <ChevronDown className="w-4 h-4 text-white/30" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/30" />
          )}
        </div>
        {formatExpanded && (
          <div className="p-4 pt-0 border-t border-white/[0.06] space-y-3">
            <p className="text-[10px] text-white/30 font-mono pt-3">
              {t('topicManager.formatTemplateDesc')}
            </p>
            <TemplateEditor
              value={displayFormatContent}
              onChange={setFormatContent}
              rows={14}
              placeholder={t('topicManager.loadingFormatTemplate')}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => formatMutation.mutate(displayFormatContent)}
                disabled={!hasFormatChanges || formatMutation.isPending}
                className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20
                  disabled:opacity-30 disabled:cursor-not-allowed text-xs"
              >
                {formatMutation.isPending ? (
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-3 h-3 mr-1.5" />
                )}
                {t('topicManager.saveFormatTemplate')}
              </Button>
              {hasFormatChanges && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFormatContent(null)}
                  className="text-white/40 hover:text-white/60 text-xs"
                >
                  {tc('reset')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Topic List (sortable) */}
      {configMutation.isPending && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-amber-400 animate-in fade-in duration-300">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('topicManager.backgroundSaving')}
        </div>
      )}
      <div className={masterEnabled ? '' : 'opacity-40 pointer-events-none'}>
        {/* generate-prompts pre-processing job */}
        {sortedTopics.length > 0 && (() => {
          const enabledTopics = sortedTopics.filter(t => t.enabled)
          const firstCron = (enabledTopics.length > 0 ? enabledTopics[0] : sortedTopics[0])
          const firstCronTime = firstCron?.enabled ? computeCronTime(startTime, 0, interval) : '0 8'
          const gpCron = offsetCronTime(firstCronTime, -interval)
          const gpEmoji = config?.generatePromptsEmoji || '🔧'
          const gpModel = config?.generatePromptsModel || ''
          const gpMessageTemplate = config?.generatePromptsMessageTemplate || ''
          const isGpExp = expandedFixedJob === 'generate-prompts'
          return (
            <div className="space-y-2 mb-4">
              <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider px-1">
                {t('topicManager.preProcessing')}
              </div>
              <div className="cyber-card hover:border-white/[0.12] transition-all">
                <div
                  className="p-4 cursor-pointer select-none"
                  onClick={() => setExpandedFixedJob(isGpExp ? null : 'generate-prompts')}
                >
                  {(() => {
                    const modelBadge = (gpModel || defaultModel) ? (
                      <Badge className="text-[10px] font-mono border-purple-400/30 text-purple-400/70 bg-purple-400/5" variant="outline">
                        {(() => {
                          const mid = gpModel || defaultModel
                          const matched = availableModels?.find(m => m.id === mid)
                          if (matched?.name) return matched.name
                          const parts = mid.split('/')
                          return parts[parts.length - 1]
                        })()}
                      </Badge>
                    ) : null
                    const timeBadge = (
                      <Badge className="text-[10px] font-mono" variant="outline">
                        {formatCronDisplay(gpCron)}
                      </Badge>
                    )
                    return (
                      <>
                        {/* Row 1 */}
                        <div className="flex items-center gap-3">
                          <Lock className="w-4 h-4 text-white/15 shrink-0" />
                          <CheckSquare className="w-5 h-5 text-cyan-400 shrink-0" />
                          <span className="text-2xl shrink-0">{gpEmoji}</span>
                          <span className="text-sm font-medium flex-1 min-w-0 truncate text-white/80">
                            {t('topicManager.generatePromptsName')}
                          </span>
                          <div className="hidden sm:flex items-center gap-2 shrink-0">
                            {modelBadge}
                            {timeBadge}
                          </div>
                          {isGpExp ? <ChevronDown className="w-4 h-4 text-white/30 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />}
                        </div>
                        {/* Row 2 (mobile only) */}
                        <div className="flex sm:hidden items-center gap-2 mt-2 pl-8 flex-wrap">
                          {modelBadge}
                          {timeBadge}
                        </div>
                      </>
                    )
                  })()}
                </div>
                {isGpExp && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06] pt-3">
                    <div className="text-xs text-white/40">
                      {t('topicManager.generatePromptsDesc')}
                    </div>
                    {/* Emoji editor */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/40 w-16 shrink-0">Emoji</span>
                      <Input
                        value={gpEmoji}
                        onChange={e => configMutation.mutate({ generatePromptsEmoji: e.target.value })}
                        className="w-20 h-7 text-lg text-center bg-white/[0.04] border-white/[0.08]"
                      />
                    </div>
                    {/* Model selector */}
                    <div className="space-y-1">
                      <p className="text-xs text-white/50 font-medium">{t('topicCard.model')}</p>
                      {availableModels && (
                        <select
                          value={gpModel}
                          onChange={e => configMutation.mutate({ generatePromptsModel: e.target.value })}
                          className="w-full bg-white/[0.03] border border-white/[0.08] text-sm font-mono text-white/80 rounded-md px-3 py-2 outline-none focus:border-purple-400/50"
                        >
                          <option value="" className="bg-[#0a0a1a] text-white/80">
                            {defaultModel ? t('topicManager.useDefaultModelWithName', { model: availableModels.find(m => m.id === defaultModel)?.name || defaultModel }) : t('topicManager.useDefaultModel')}
                          </option>
                          {availableModels.map(m => (
                            <option key={m.id} value={m.id} className="bg-[#0a0a1a] text-white/80">
                              {m.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="text-[10px] text-amber-400/60 pt-1">
                        💡 {t('topicManager.simpleCurlJobHint')}
                      </p>
                    </div>
                    {/* Message template */}
                    <div className="space-y-2">
                      <p className="text-xs text-white/50 font-medium">{t('topicManager.agentMessageTemplate')}</p>
                      <p className="text-[10px] text-white/25">{t('topicManager.generatePromptsTemplateDesc')}</p>
                      <TemplateEditor
                        value={gpMessageTemplate || `使用 exec 工具執行以下指令來生成晨報 prompts：\ncurl -s -X POST '\${BASE_URL}/api/morning-report?action=generate-prompts'\n回報產生了幾個 prompt 檔案。`}
                        onChange={v => configMutation.mutate({ generatePromptsMessageTemplate: v })}
                        rows={4}
                        variables={['BASE_URL', 'TODAY', 'DATE_HYPHEN']}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Topics section label */}
        {sortedTopics.length > 0 && (
          <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider px-1 mb-2">
            {t('topicManager.topicsSection')}
          </div>
        )}

        {isLoading ? (
          <div className="cyber-card p-12 flex items-center justify-center">
            <span className="font-mono text-white/20 tracking-[0.3em] text-xs">{t('topicManager.loadingTopics')}</span>
          </div>
        ) : sortedTopics.length === 0 ? (
          <div className="cyber-card p-12 flex flex-col items-center justify-center gap-2">
            <Settings2 className="w-6 h-6 text-white/15" />
            <p className="font-mono text-white/20 tracking-[0.3em] text-xs">{t('topicManager.noTopics')}</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedTopics.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {(() => {
                  let activeIdx = 0
                  return sortedTopics.map((topic) => {
                    const cronTime = topic.enabled
                      ? computeCronTime(startTime, activeIdx++, interval)
                      : '—'
                    return (
                      <SortableTopicCard
                        key={topic.id}
                        topic={{ ...topic, cronTime }}
                        isExpanded={expandedId === topic.id}
                        onToggleExpand={() =>
                          setExpandedId(prev => (prev === topic.id ? null : topic.id))
                        }
                        onUpdate={data => handleUpdate(topic.id, data)}
                        onDelete={() => deleteMutation.mutate(topic.id)}
                        availableModels={availableModels}
                        globalModel={defaultModel}
                      />
                    )
                  })
                })()}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Fixed post-processing jobs (finalize + podcast) */}
        {sortedTopics.length > 0 && (() => {
          const finalizeCron = config?.finalizeCron || '0 8'
          const podcastCron = config?.podcastCron || '0 8'
          const podcastHarvestCron = config?.podcastHarvestCron || '0 8'
          const finalizeModel = config?.finalizeModel || ''
          const podcastModel = config?.podcastModel || ''
          const podcastTriggerModel = config?.podcastTriggerModel || ''
          const podcastHarvestModel = config?.podcastHarvestModel || ''
          // Jobs whose agent body is just `curl + parse JSON + announce`.
          // The actual heavy lifting runs server-side; the agent does no
          // reasoning. Surface a hint so operators know cheap models are fine.
          // Note: 'podcast' is also in this list — that hint applies to the
          // model selector for the trigger agent. The polish-model selector
          // (a 2nd row inside the podcast card) gets a different hint.
          const SIMPLE_CURL_JOBS = new Set(['finalize', 'podcast', 'podcast-harvest'])
          const fixedJobs = [
            { key: 'finalize', configKey: 'finalizeModel', emojiKey: 'finalizeEmoji', emoji: config?.finalizeEmoji || '📑', name: t('topicManager.finalizeName'), cron: finalizeCron, enabled: finalizeEnabled, onToggle: handleToggleFinalize, model: finalizeModel },
            { key: 'podcast', configKey: 'podcastTriggerModel', emojiKey: 'podcastEmoji', emoji: config?.podcastEmoji || '🎙️', name: t('topicManager.podcastName'), cron: podcastCron, enabled: podcastEnabled, onToggle: handleTogglePodcast, model: podcastTriggerModel },
            { key: 'podcast-harvest', configKey: 'podcastHarvestModel', emojiKey: 'podcastHarvestEmoji', emoji: config?.podcastHarvestEmoji || '📬', name: t('topicManager.podcastHarvestName'), cron: podcastHarvestCron, enabled: podcastHarvestEnabled, onToggle: handleTogglePodcastHarvest, model: podcastHarvestModel },
          ]
          return (
            <div className="space-y-2">
              <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider px-1">
                {t('topicManager.postProcessing')}
              </div>
              {fixedJobs.map(job => {
                const isExp = expandedFixedJob === job.key
                return (
                  <div key={job.key} className="cyber-card hover:border-white/[0.12] transition-all">
                    {/* Collapsed header */}
                    <div
                      className="p-4 cursor-pointer select-none"
                      onClick={() => setExpandedFixedJob(isExp ? null : job.key)}
                    >
                      {(() => {
                        const modelBadge = (job.model || defaultModel) ? (
                          <Badge className="text-[10px] font-mono border-purple-400/30 text-purple-400/70 bg-purple-400/5">
                            {(() => {
                              const mid = job.model || defaultModel
                              const matched = availableModels?.find(m => m.id === mid)
                              if (matched?.name) return matched.name
                              const parts = mid.split('/')
                              return parts[parts.length - 1]
                            })()}
                          </Badge>
                        ) : null
                        const timeBadge = (
                          <Badge className="text-[10px] font-mono" variant="outline">
                            {formatCronDisplay(job.cron)}
                          </Badge>
                        )
                        return (
                          <>
                            {/* Row 1 */}
                            <div className="flex items-center gap-3">
                              <Lock className="w-4 h-4 text-white/15 shrink-0" />
                              <button
                                onClick={e => { e.stopPropagation(); job.onToggle() }}
                                disabled={!masterEnabled || configMutation.isPending}
                                className="transition-colors p-0.5 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                title={job.enabled ? t('disable') : t('enable')}
                              >
                                {job.enabled ? (
                                  <CheckSquare className="w-5 h-5 text-cyan-400" />
                                ) : (
                                  <Square className="w-5 h-5 text-white/25 hover:text-white/40" />
                                )}
                              </button>
                              <span className="text-2xl shrink-0">{job.emoji}</span>
                              <span className={`text-sm font-medium flex-1 min-w-0 truncate ${job.enabled ? 'text-white/80' : 'text-white/30 line-through'}`}>
                                {job.name}
                              </span>
                              {(configMutation.isPending || templateMutation.isPending) && (
                                <span className="hidden sm:flex items-center gap-1 text-xs text-amber-400 animate-in fade-in duration-300 shrink-0">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  {t('topicManager.backgroundSaving')}
                                </span>
                              )}
                              {configSavedJob === job.key && !configMutation.isPending && !templateMutation.isPending && (
                                <span className="hidden sm:flex items-center gap-1 text-xs text-emerald-400 animate-in fade-in duration-300 shrink-0">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t('topicManager.settingsSaved')}
                                </span>
                              )}
                              <div className="hidden sm:flex items-center gap-2 shrink-0">
                                {modelBadge}
                                {timeBadge}
                              </div>
                              {isExp ? (
                                <ChevronDown className="w-4 h-4 text-white/30 shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
                              )}
                            </div>
                            {/* Row 2 (mobile only) */}
                            <div className="flex sm:hidden items-center gap-2 mt-2 pl-8 flex-wrap">
                              {modelBadge}
                              {timeBadge}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                    {/* Expanded edit form */}
                    {isExp && (
                      <div className="p-4 pt-0 border-t border-white/[0.06] space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">{t('topicCard.name')}</label>
                            <div className="bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-sm text-white/50">
                              {job.name}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">{t('topicCard.emoji')}</label>
                            <Input
                              value={job.emoji}
                              onChange={e => configMutation.mutate({ [job.emojiKey]: e.target.value })}
                              className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">{t('topicCard.cronSchedule')}</label>
                            <div className="bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white/50">
                              {formatCronDisplay(job.cron)}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">{t('topicCard.timeout')}</label>
                            <div className="bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white/50">
                              600
                            </div>
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">{t('topicCard.model')}</label>
                            <select
                              value={job.model}
                              onChange={e => configMutation.mutate({ [job.configKey]: e.target.value })}
                              className="w-full bg-white/[0.03] border border-white/[0.08] text-sm font-mono text-white/80 rounded-md px-3 py-2 outline-none focus:border-purple-400/50"
                            >
                              <option value="" className="bg-[#0a0a1a] text-white/80">
                                {defaultModel ? t('topicManager.useDefaultModelWithName', { model: availableModels.find(m => m.id === defaultModel)?.name || defaultModel }) : t('topicManager.useDefaultModel')}
                              </option>
                              {availableModels.map(m => (
                                <option key={m.id} value={m.id} className="bg-[#0a0a1a] text-white/80">{m.name}</option>
                              ))}
                            </select>
                            {SIMPLE_CURL_JOBS.has(job.key) && (
                              <p className="text-[10px] text-amber-400/60 pt-1">
                                💡 {t('topicManager.simpleCurlJobHint')}
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Template Editors */}
                        {job.key === 'finalize' && (
                          <>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.agentMessageTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.agentMessageTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('finalizeMessageTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, finalizeMessageTemplate: v }))}
                                rows={5}
                                variables={['BASE_URL', 'DATE_HYPHEN', 'TODAY']}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('finalizeMessageTemplate')}
                                  disabled={!hasTemplateChanges('finalizeMessageTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('finalizeMessageTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.htmlTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.htmlTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('finalizeHtmlTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, finalizeHtmlTemplate: v }))}
                                rows={10}
                                variables={['DATE_HYPHEN', 'DATE_ENGLISH', 'TOC', 'CONTENT', 'GENERATED_AT']}
                                variableFormat="mustache"
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('finalizeHtmlTemplate')}
                                  disabled={!hasTemplateChanges('finalizeHtmlTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('finalizeHtmlTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                        {job.key === 'podcast' && (
                          <>
                            <div className="space-y-1 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.podcastPolishModel')}
                              </label>
                              <select
                                value={podcastModel}
                                onChange={e => configMutation.mutate({ podcastModel: e.target.value })}
                                className="w-full bg-white/[0.03] border border-white/[0.08] text-sm font-mono text-white/80 rounded-md px-3 py-2 outline-none focus:border-purple-400/50"
                              >
                                <option value="" className="bg-[#0a0a1a] text-white/80">
                                  {defaultModel ? t('topicManager.useDefaultModelWithName', { model: availableModels.find(m => m.id === defaultModel)?.name || defaultModel }) : t('topicManager.useDefaultModel')}
                                </option>
                                {availableModels.map(m => (
                                  <option key={m.id} value={m.id} className="bg-[#0a0a1a] text-white/80">{m.name}</option>
                                ))}
                              </select>
                              <p className="text-[10px] text-white/40 pt-1">
                                {t('topicManager.podcastPolishModelDesc')}
                              </p>
                            </div>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.polishTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.polishTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('podcastPolishTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, podcastPolishTemplate: v }))}
                                rows={10}
                                variables={['INPUT_FILE', 'OUTPUT_FILE']}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('podcastPolishTemplate')}
                                  disabled={!hasTemplateChanges('podcastPolishTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('podcastPolishTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.agentMessageTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.agentMessageTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('podcastMessageTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, podcastMessageTemplate: v }))}
                                rows={5}
                                variables={['BASE_URL', 'DATE_HYPHEN', 'TODAY']}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('podcastMessageTemplate')}
                                  disabled={!hasTemplateChanges('podcastMessageTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('podcastMessageTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.scriptTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.scriptTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('podcastScriptTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, podcastScriptTemplate: v }))}
                                rows={10}
                                variables={['DATE_HYPHEN', 'SEGMENT_COUNT', 'SEGMENT_TITLE']}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('podcastScriptTemplate')}
                                  disabled={!hasTemplateChanges('podcastScriptTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('podcastScriptTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                        {job.key === 'podcast-harvest' && (
                          <>
                            <div className="space-y-2">
                              <p className="text-[10px] text-white/40">
                                {t('topicManager.podcastHarvestDesc')}
                              </p>
                            </div>
                            <div className="space-y-2 pt-2">
                              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                {t('topicManager.agentMessageTemplate')}
                              </label>
                              <p className="text-[10px] text-white/25">{t('topicManager.podcastHarvestTemplateDesc')}</p>
                              <TemplateEditor
                                value={getTemplateValue('podcastHarvestMessageTemplate')}
                                onChange={v => setEditingTemplates(prev => ({ ...prev, podcastHarvestMessageTemplate: v }))}
                                rows={10}
                                variables={['BASE_URL', 'DATE_HYPHEN', 'TODAY']}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleTemplateSave('podcastHarvestMessageTemplate')}
                                  disabled={!hasTemplateChanges('podcastHarvestMessageTemplate') || templateMutation.isPending}
                                  className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20 disabled:opacity-30 text-xs"
                                >
                                  {templateMutation.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Save className="w-3 h-3 mr-1.5" />}
                                  {tc('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTemplateReset('podcastHarvestMessageTemplate')}
                                  className="text-white/40 hover:text-white/60 text-xs"
                                >
                                  {t('topicManager.resetToDefault')}
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
