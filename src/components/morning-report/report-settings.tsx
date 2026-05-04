'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from 'next-intl'
import { Settings, FolderOpen, Globe, Volume2, Languages, Download, CheckCircle2, Loader2, Info } from 'lucide-react'

const ALL_KEYS = ['publicDir', 'obsidianDir', 'reportBaseUrl', 'ttsVoice', 'ttsEngine', 'language']

export function ReportSettings() {
  const t = useTranslations('morningReport')
  const tc = useTranslations('common')

  const CONFIG_FIELDS = [
    {
      group: t('settings.pathSettings'),
      icon: FolderOpen,
      iconColor: 'text-cyan-400',
      fields: [
        { key: 'publicDir', label: t('settings.htmlPublishDir') },
        { key: 'obsidianDir', label: t('settings.obsidianArchivePath') },
      ],
    },
    {
      group: t('settings.websiteSettings'),
      icon: Globe,
      iconColor: 'text-blue-400',
      fields: [
        { key: 'reportBaseUrl', label: t('settings.publicUrl') },
      ],
    },
    {
      group: t('settings.ttsSettings'),
      icon: Volume2,
      iconColor: 'text-purple-400',
      fields: [
        { key: 'ttsVoice', label: t('settings.ttsVoiceName') },
        { key: 'ttsEngine', label: t('settings.ttsEngine') },
      ],
    },
    {
      group: t('settings.otherSettings'),
      icon: Languages,
      iconColor: 'text-amber-400',
      fields: [
        { key: 'language', label: t('settings.language') },
      ],
    },
  ]
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState<Record<string, string>>({})
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [migrateResult, setMigrateResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const { data: config, isLoading } = useQuery<Record<string, string>>({
    queryKey: ['morning-report-config'],
    queryFn: () => fetch('/api/morning-report?type=config').then(r => r.json()),
  })

  useEffect(() => {
    if (config) {
      const values: Record<string, string> = {}
      for (const key of ALL_KEYS) {
        values[key] = config[key] ?? ''
      }
      setForm(values)
      setLoaded(values)
    }
  }, [config])

  const isDirty = ALL_KEYS.some(k => (form[k] ?? '') !== (loaded[k] ?? ''))

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await fetch('/api/morning-report?type=config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(t('settings.saveFailed'))
      return res.json()
    },
    onSuccess: () => {
      setLoaded({ ...form })
      setSaveMsg(t('settings.settingsSaved'))
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (err: Error) => {
      setSaveMsg(t('settings.errorPrefix', { message: err.message }))
      setTimeout(() => setSaveMsg(null), 4000)
    },
  })

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/morning-report/migrate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('settings.loadFailed'))
      return data
    },
    onSuccess: (data) => {
      setMigrateResult({ ok: true, message: t('settings.loadComplete', { topicsUpdated: data.topicsUpdated ?? 0, formatUpdated: data.formatUpdated ? '✓' : '✗' }) })
      queryClient.invalidateQueries({ queryKey: ['morning-report-config'] })
      queryClient.invalidateQueries({ queryKey: ['morning-topics'] })
    },
    onError: (err: Error) => {
      setMigrateResult({ ok: false, message: err.message })
    },
  })

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    const data: Record<string, string> = {}
    for (const key of ALL_KEYS) {
      if (form[key] !== undefined) data[key] = form[key]
    }
    saveMutation.mutate(data)
  }

  if (isLoading) {
    return (
      <div className="cyber-card p-8 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
        <span className="text-white/40 text-sm">{t('settings.loadingSettings')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-cyan-400" />
        <h2 className="text-lg font-semibold text-white/90">{t('settings.title')}</h2>
      </div>

      {/* Config Groups */}
      {CONFIG_FIELDS.map(group => {
        const Icon = group.icon
        return (
          <div key={group.group} className="cyber-card">
            <div className="p-4 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Icon className={`w-4 h-4 ${group.iconColor}`} />
                {group.group}
              </h3>
            </div>
            <div className="p-4 space-y-4">
              {group.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-white/40 mb-1">{field.label}</label>
                  <Input
                    value={form[field.key] ?? ''}
                    onChange={e => handleChange(field.key, e.target.value)}
                    className="bg-white/[0.03] border-white/[0.08] text-white/80 font-mono text-sm"
                    placeholder={field.key}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Auto-detected Paths */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Info className="w-4 h-4 text-white/40" />
            {t('settings.autoDetectedPaths')}
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <span className="text-xs text-white/40">{t('settings.outputDir')}</span>
            <p className="text-sm text-white/50 font-mono mt-0.5">data/morning-report/generated</p>
          </div>
          <div>
            <span className="text-xs text-white/40">{t('settings.tempDir')}</span>
            <p className="text-sm text-white/50 font-mono mt-0.5">data/morning-report/tmp</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!isDirty || saveMutation.isPending}
          className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 disabled:opacity-40"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {tc('savingInProgress')}
            </>
          ) : (
            t('settings.saveSettings')
          )}
        </Button>
        {saveMsg && (
          <span className="text-sm flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            {saveMsg}
          </span>
        )}
      </div>

      {/* Load Default Templates */}
      <div className="cyber-card">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Download className="w-4 h-4 text-orange-400" />
            {t('settings.loadDefaultTemplates')}
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-white/40">
            {t('settings.loadDefaultTemplatesDesc')}
          </p>
          <p className="text-xs text-orange-400/70">
            {t('settings.loadDefaultTemplatesWarning')}
          </p>
          {!confirmReset ? (
            <Button
              onClick={() => setConfirmReset(true)}
              variant="outline"
              className="border-orange-500/30 text-orange-300 hover:bg-orange-500/10"
            >
              {t('settings.loadDefaultTemplates')}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">{t('settings.confirmOverwrite')}</span>
              <Button
                onClick={() => {
                  setConfirmReset(false)
                  setMigrateResult(null)
                  migrateMutation.mutate()
                }}
                disabled={migrateMutation.isPending}
                size="sm"
                className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 text-xs"
              >
                {migrateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    {t('settings.loadingTemplates')}
                  </>
                ) : (
                  t('settings.confirmOverwriteButton')
                )}
              </Button>
              <Button
                onClick={() => setConfirmReset(false)}
                size="sm"
                variant="ghost"
                className="text-white/40 hover:text-white/60 text-xs"
              >
                {tc('cancel')}
              </Button>
            </div>
          )}
          {migrateResult && (
            <p className={`text-sm ${migrateResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {migrateResult.ok && <CheckCircle2 className="w-4 h-4 inline mr-1.5" />}
              {migrateResult.message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

