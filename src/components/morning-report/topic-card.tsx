'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, CheckSquare, Square, Trash2, Save, GripVertical, Loader2, CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TemplateEditor } from './template-editor'

export interface Topic {
  id: string
  name: string
  emoji: string
  enabled: boolean
  sortOrder: number
  template: string
  cronTime: string
  timeoutSeconds: number
  outputFilename: string
  model: string
  deliveryMode: string
}

interface TopicCardProps {
  topic: Topic
  isExpanded: boolean
  onToggleExpand: () => void
  onUpdate: (data: Partial<Topic>) => Promise<void> | void
  onDelete: () => void
  dragHandleProps?: Record<string, any>
  availableModels?: { id: string; name: string }[]
  globalModel?: string
}

export function TopicCard({ topic, isExpanded, onToggleExpand, onUpdate, onDelete, dragHandleProps, availableModels = [], globalModel = '' }: TopicCardProps) {
  const t = useTranslations('morningReport')
  const tc = useTranslations('common')
  const [editState, setEditState] = useState({
    name: topic.name,
    emoji: topic.emoji,
    timeoutSeconds: topic.timeoutSeconds,
    outputFilename: topic.outputFilename,
    template: topic.template,
    model: topic.model || '',
    deliveryMode: topic.deliveryMode || 'none',
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Sync edit state when topic prop changes (e.g. after loading defaults)
  useEffect(() => {
    setEditState({
      name: topic.name,
      emoji: topic.emoji,
      timeoutSeconds: topic.timeoutSeconds,
      outputFilename: topic.outputFilename,
      template: topic.template,
      model: topic.model || '',
      deliveryMode: topic.deliveryMode || 'none',
    })
  }, [topic.name, topic.emoji, topic.timeoutSeconds, topic.outputFilename, topic.template, topic.model, topic.deliveryMode])

  const resetEdit = () => {
    setEditState({
      name: topic.name,
      emoji: topic.emoji,
      timeoutSeconds: topic.timeoutSeconds,
      outputFilename: topic.outputFilename,
      template: topic.template,
      model: topic.model || '',
      deliveryMode: topic.deliveryMode || 'none',
    })
  }

  const hasChanges =
    editState.name !== topic.name ||
    editState.emoji !== topic.emoji ||
    editState.timeoutSeconds !== topic.timeoutSeconds ||
    editState.outputFilename !== topic.outputFilename ||
    editState.template !== topic.template ||
    editState.model !== (topic.model || '') ||
    editState.deliveryMode !== (topic.deliveryMode || 'none')

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      await onUpdate(editState)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }, [editState, onUpdate])

  const handleToggleEnabled = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setToggling(true)
    try {
      await onUpdate({ enabled: !topic.enabled })
    } finally {
      setToggling(false)
    }
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(true)
  }

  const handleConfirmYes = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete()
    setConfirmDelete(false)
  }

  const handleConfirmNo = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(false)
  }

  const badgesAndActions = (
    <>
      {(topic.model || globalModel) && (
        <Badge className="text-[10px] font-mono border-purple-400/30 text-purple-400/70 bg-purple-400/5">
          {(() => {
            const mid = topic.model || globalModel
            const matched = availableModels?.find(m => m.id === mid)
            if (matched?.name) return matched.name
            // Show short form: last segment of model id
            const parts = mid.split('/')
            return parts[parts.length - 1]
          })()}
        </Badge>
      )}
      <Badge className="text-[10px] font-mono" variant="outline">
        {(() => {
          const parts = topic.cronTime?.split(' ').map(Number)
          if (parts?.length === 2) return `${String(parts[1]).padStart(2, '0')}:${String(parts[0]).padStart(2, '0')}`
          return topic.cronTime
        })()}
      </Badge>
      <button
        onClick={handleDeleteClick}
        className="p-1 transition-colors text-white/20 hover:text-red-400/70"
        title={t('topicCard.deleteTopic')}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      {confirmDelete && (
        <span className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="text-red-400">{tc('confirmQuestion')}</span>
          <button
            onClick={handleConfirmYes}
            className="text-red-400 hover:text-red-300 underline"
          >
            {tc('yes')}
          </button>
          <button
            onClick={handleConfirmNo}
            className="text-white/40 hover:text-white/60 underline"
          >
            {tc('no')}
          </button>
        </span>
      )}
    </>
  )

  return (
    <div className="cyber-card hover:border-white/[0.12] transition-all">
      {/* Collapsed header */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        {/* Row 1: drag + checkbox + emoji + title + (desktop badges) + chevron */}
        <div className="flex items-center gap-3">
          {dragHandleProps && (
            <button
              className="text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing touch-none shrink-0"
              onClick={e => e.stopPropagation()}
              {...dragHandleProps}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleToggleEnabled}
            className="transition-colors p-0.5 shrink-0"
            title={topic.enabled ? tc('disabled') : tc('enabled')}
          >
            {topic.enabled ? (
              <CheckSquare className="w-5 h-5 text-cyan-400" />
            ) : (
              <Square className="w-5 h-5 text-white/25 hover:text-white/40" />
            )}
          </button>
          <span className="text-2xl shrink-0">{topic.emoji}</span>
          <span
            className={`text-sm font-medium flex-1 min-w-0 truncate ${
              topic.enabled ? 'text-white/80' : 'text-white/30 line-through'
            }`}
          >
            {topic.name}
          </span>
          {toggling && (
            <span className="hidden sm:flex items-center gap-1 text-xs text-amber-400 animate-in fade-in duration-300 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('topicManager.backgroundSaving')}
            </span>
          )}
          {/* Desktop: inline badges + actions */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {badgesAndActions}
          </div>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-white/30 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
          )}
        </div>

        {/* Row 2 (mobile only): badges + actions */}
        <div className="flex sm:hidden items-center gap-2 mt-2 pl-8 flex-wrap">
          {toggling && (
            <span className="flex items-center gap-1 text-xs text-amber-400 animate-in fade-in duration-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('topicManager.backgroundSaving')}
            </span>
          )}
          {badgesAndActions}
        </div>
      </div>

      {/* Expanded edit form */}
      {isExpanded && (
        <div className="p-4 pt-0 border-t border-white/[0.06] space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
            <div className="space-y-1">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.name')}
              </label>
              <Input
                value={editState.name}
                onChange={e => setEditState(s => ({ ...s, name: e.target.value }))}
                className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.emoji')}
              </label>
              <Input
                value={editState.emoji}
                onChange={e => setEditState(s => ({ ...s, emoji: e.target.value }))}
                className="bg-white/[0.03] border-white/[0.08] text-sm text-white/80"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.cronSchedule')}
              </label>
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white/50">
                {(() => {
                  if (topic.cronTime === '—') return '—'
                  const parts = topic.cronTime?.split(' ').map(Number)
                  if (parts?.length === 2) return `${String(parts[1]).padStart(2, '0')}:${String(parts[0]).padStart(2, '0')}`
                  return topic.cronTime
                })()}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.timeout')}
              </label>
              <Input
                type="number"
                value={editState.timeoutSeconds}
                onChange={e =>
                  setEditState(s => ({ ...s, timeoutSeconds: Number(e.target.value) || 0 }))
                }
                className="bg-white/[0.03] border-white/[0.08] text-sm font-mono text-white/80"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.model')}
              </label>
              <select
                value={editState.model}
                onChange={e => setEditState(s => ({ ...s, model: e.target.value }))}
                className="w-full bg-white/[0.03] border border-white/[0.08] text-sm font-mono text-white/80 rounded-md px-3 py-2 outline-none focus:border-purple-400/50"
              >
                <option value="" className="bg-[#0a0a1a] text-white/80">
                  {globalModel ? t('topicManager.useDefaultModelWithName', { model: availableModels.find(m => m.id === globalModel)?.name || globalModel }) : t('topicManager.useDefaultModel')}
                </option>
                {availableModels.map(m => (
                  <option key={m.id} value={m.id} className="bg-[#0a0a1a] text-white/80">{m.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.deliveryMode')}
              </label>
              <div className="flex flex-wrap gap-2">
                {(['none', 'announce', 'webhook'] as const).map(mode => {
                  const active = editState.deliveryMode === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setEditState(s => ({ ...s, deliveryMode: mode }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                        active
                          ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                          : 'bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/70 hover:border-white/[0.15]'
                      }`}
                      title={t(`topicCard.delivery${mode.charAt(0).toUpperCase() + mode.slice(1)}Desc` as any)}
                    >
                      {t(`topicCard.delivery${mode.charAt(0).toUpperCase() + mode.slice(1)}` as any)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                {t('topicCard.outputFilename')}
              </label>
              <Input
                value={editState.outputFilename}
                onChange={e => setEditState(s => ({ ...s, outputFilename: e.target.value }))}
                className="bg-white/[0.03] border-white/[0.08] text-sm font-mono text-white/80"
              />
            </div>
          </div>

          {/* Template editor */}
          <div className="space-y-1">
            <label className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
              {t('topicCard.promptTemplate')}
            </label>
            <TemplateEditor
              value={editState.template}
              onChange={template => setEditState(s => ({ ...s, template }))}
              rows={10}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/20
                disabled:opacity-30 disabled:cursor-not-allowed text-xs"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-3 h-3 mr-1.5" />
              )}
              {t('topicCard.saveChanges')}
            </Button>
            {hasChanges && !saving && (
              <Button
                size="sm"
                variant="ghost"
                onClick={resetEdit}
                className="text-white/40 hover:text-white/60 text-xs"
              >
                {tc('reset')}
              </Button>
            )}
            {saving && (
              <span className="flex items-center gap-1 text-xs text-amber-400 animate-in fade-in duration-300">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('topicManager.backgroundSaving')}
              </span>
            )}
            {saved && !hasChanges && !saving && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 animate-in fade-in duration-300">
                <CheckCircle2 className="w-3 h-3" />
                {t('topicManager.settingsSaved')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
