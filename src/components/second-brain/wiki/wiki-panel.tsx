'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import * as Tabs from '@radix-ui/react-tabs'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2, AlertCircle, Loader2, Search, Upload,
  PlayCircle, Settings, ExternalLink, Headset,
} from 'lucide-react'
import { WikiAboutPanel } from './wiki-about-panel'
import { WikiAdvancedCard } from './wiki-advanced-card'

interface WikiDetect {
  ollamaBin: string
  ollamaRunning: boolean
  bgeM3Available: boolean
  embeddingsWork: boolean
  openclawConfigured: boolean
  lancedbPluginInstalled: boolean
  vaultExists: boolean
  defuddleBin: string
}

interface WikiStatus {
  vaultMode: string
  vaultPath: string
  vaultReady: boolean
  obsidianAvailable: boolean
  pages: { sources: number; entities: number; concepts: number; syntheses: number; reports: number }
  raw?: string
  error?: string
}

interface WikiSettings {
  dualWrite: boolean
  synthesisCron: string
  synthesisModel: string
  tunnelUrl: string
  localReportUrl: string
  lastSynthesisAt: string
}

interface SynthesisProgress {
  stage: string
  message: string
  startedAt: string
  finishedAt: string
  error: string
  running: boolean
}

const STAGE_ORDER = [
  'preparing', 'agent-running', 'compile', 'lint',
  'render-html', 'publish', 'announce', 'done',
]
const STAGE_LABELS: Record<string, string> = {
  preparing: '準備',
  'agent-running': 'Agent 綜合整理',
  compile: '編譯索引',
  lint: 'Lint 檢查',
  'render-html': '產生 HTML',
  publish: '發佈 + tunnel',
  announce: '通知',
  done: '完成',
}

export function WikiPanel() {
  const t = useTranslations('secondBrain.wikiSubTabs')

  const subTab = (value: string, label: string) => (
    <Tabs.Trigger
      value={value}
      className="px-3 py-2 text-sm text-white/50 border-b-2 border-transparent -mb-px
        data-[state=active]:border-violet-400 data-[state=active]:text-white
        hover:text-white/80 transition-colors font-medium"
    >
      {label}
    </Tabs.Trigger>
  )

  return (
    <Tabs.Root defaultValue="about">
      <Tabs.List className="flex gap-1 mb-4 border-b border-white/[0.08]">
        {subTab('about', t('about'))}
        {subTab('manage', t('manage'))}
      </Tabs.List>

      <Tabs.Content value="about">
        <WikiAboutPanel />
      </Tabs.Content>

      <Tabs.Content value="manage">
        <WikiManagePanel />
      </Tabs.Content>
    </Tabs.Root>
  )
}

function WikiManagePanel() {
  const t = useTranslations('secondBrain.wiki.manage')

  const purposeQuery = useQuery<{ purpose: string }>({
    queryKey: ['wiki-purpose'],
    queryFn: () => fetch('/api/second-brain/wiki?type=purpose').then(r => r.json()),
  })
  const detectQuery = useQuery<WikiDetect>({
    queryKey: ['wiki-detect'],
    queryFn: () => fetch('/api/second-brain/wiki?type=detect').then(r => r.json()),
    refetchInterval: 10_000,
  })
  const statusQuery = useQuery<WikiStatus>({
    queryKey: ['wiki-status'],
    queryFn: () => fetch('/api/second-brain/wiki?type=status').then(r => r.json()),
    refetchInterval: 30_000,
    enabled: detectQuery.data?.openclawConfigured === true,
  })
  const settingsQuery = useQuery<WikiSettings>({
    queryKey: ['wiki-settings'],
    queryFn: () => fetch('/api/second-brain/wiki?type=settings').then(r => r.json()),
  })

  const ready = !!detectQuery.data?.openclawConfigured && !!detectQuery.data?.embeddingsWork && !!detectQuery.data?.lancedbPluginInstalled
  const isCustomerService = purposeQuery.data?.purpose === 'customer-service'

  // Under customer-service purpose the personal management surface (ingest,
  // synthesis schedule, ad-hoc search) belongs to the support agent's knowledge
  // base — managed from the customer-service page — so we lock it here.
  if (isCustomerService) {
    return (
      <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-5">
        <div className="flex items-start gap-3">
          <Headset className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-white mb-1.5">{t('csLockTitle')}</h3>
            <p className="text-sm text-white/55 leading-relaxed">{t('csLockBody')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SetupCard detect={detectQuery.data} ready={ready} onRefresh={() => {
        detectQuery.refetch()
        statusQuery.refetch()
      }} />

      {ready && statusQuery.data && (
        <>
          <StatusCard status={statusQuery.data} />
          <IngestCard onIngested={() => statusQuery.refetch()} />
          <SearchCard />
          {settingsQuery.data && (
            <SynthesisCard settings={settingsQuery.data} onChanged={() => settingsQuery.refetch()} />
          )}
          <WikiAdvancedCard />
        </>
      )}
    </div>
  )
}

function Row({
  ok, label, hint,
}: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {ok
        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        : <AlertCircle className="w-4 h-4 text-amber-400" />}
      <span className={ok ? 'text-white/80' : 'text-white/60'}>{label}</span>
      {hint && <span className="text-xs text-white/40 ml-auto">{hint}</span>}
    </div>
  )
}

function SetupCard({
  detect, ready, onRefresh,
}: { detect?: WikiDetect; ready: boolean; onRefresh: () => void }) {
  const [installing, setInstalling] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const runInstall = async () => {
    setInstalling(true); setLogs([]); setError(null)
    try {
      const res = await fetch('/api/second-brain/wiki/install', { method: 'POST' })
      if (!res.body) throw new Error('no SSE body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const e of events) {
          const m = e.match(/^data:\s*(.+)$/m)
          if (!m) continue
          try {
            const evt = JSON.parse(m[1]) as { type: string; data: string }
            if (evt.type === 'error') setError(evt.data)
            setLogs((prev) => [...prev, `${evt.type === 'error' ? '❌' : evt.type === 'done' ? '✅' : '•'} ${evt.data}`])
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setInstalling(false)
      onRefresh()
    }
  }

  if (ready) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-medium text-white/90">Wiki 環境就緒</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Row ok label={`Ollama: ${detect?.ollamaBin || '?'}`} />
          <Row ok label="bge-m3 已載入" />
          <Row ok label="OpenClaw 已配置 wiki/lancedb" />
          <Row ok label="memory-lancedb plugin 已安裝" />
          <Row ok label="Wiki vault 存在" />
          <Row ok={!!detect?.defuddleBin} label={detect?.defuddleBin ? 'defuddle 已裝（URL ingest 會用 readability 萃取）' : 'defuddle 未裝（URL ingest 走 raw fetch）'} />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white/90">Wiki 環境檢測</h3>
        <button
          onClick={runInstall}
          disabled={installing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
          {installing ? '安裝中...' : '一鍵安裝'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Row ok={!!detect?.ollamaBin} label="Ollama 已安裝" hint={detect?.ollamaBin || '未安裝'} />
        <Row ok={!!detect?.ollamaRunning} label="Ollama 服務運行中" />
        <Row ok={!!detect?.bgeM3Available} label="bge-m3 已 pull" />
        <Row ok={!!detect?.embeddingsWork} label="/v1/embeddings 可用" />
        <Row ok={!!detect?.openclawConfigured} label="OpenClaw 配置 wiki/lancedb" />
        <Row ok={!!detect?.lancedbPluginInstalled} label="memory-lancedb plugin 已安裝" hint={detect?.lancedbPluginInstalled ? undefined : '需安裝外部 plugin'} />
        <Row ok={!!detect?.vaultExists} label="Wiki vault 已建立" />
        <Row ok={!!detect?.defuddleBin} label="defuddle (URL extractor)" hint={detect?.defuddleBin || '未安裝（可選）'} />
      </div>
      {(installing || logs.length > 0) && (
        <pre className="mt-3 text-xs text-white/60 bg-black/40 rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap">
          {logs.join('\n')}
        </pre>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  )
}

function StatusCard({ status }: { status: WikiStatus }) {
  if (status.error) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4 text-sm text-amber-300">
        ⚠ wiki status 取得失敗：{status.error}
      </div>
    )
  }
  const cells: { label: string; value: number | string }[] = [
    { label: 'Sources', value: status.pages.sources },
    { label: 'Entities', value: status.pages.entities },
    { label: 'Concepts', value: status.pages.concepts },
    { label: 'Syntheses', value: status.pages.syntheses },
    { label: 'Reports', value: status.pages.reports },
  ]
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white/90">Vault 狀態</h3>
        <span className="text-xs text-white/40">{status.vaultMode} · {status.vaultPath}</span>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded bg-black/30 border border-white/[0.06] p-3 text-center">
            <div className="text-2xl font-semibold text-cyan-300">{c.value}</div>
            <div className="text-xs text-white/50 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IngestCard({ onIngested }: { onIngested: () => void }) {
  const [target, setTarget] = useState('')
  const [output, setOutput] = useState('')
  const ingestMutation = useMutation({
    mutationFn: async (t: string) => {
      const r = await fetch('/api/second-brain/wiki?action=ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.output || 'ingest failed')
      return data
    },
    onSuccess: (data) => {
      setOutput(typeof data === 'object' ? data.output ?? JSON.stringify(data) : String(data))
      setTarget('')
      onIngested()
    },
    onError: (err: Error) => setOutput(`❌ ${err.message}`),
  })

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Upload className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white/90">Ingest source</h3>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="檔案路徑或 URL（例：/path/to/note.md 或 https://...）"
          className="flex-1 bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white/90 placeholder:text-white/30"
          disabled={ingestMutation.isPending}
        />
        <button
          onClick={() => target.trim() && ingestMutation.mutate(target.trim())}
          disabled={!target.trim() || ingestMutation.isPending}
          className="px-3 py-1.5 rounded-md text-xs bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          {ingestMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Ingest'}
        </button>
      </div>
      {output && (
        <pre className="mt-3 text-xs text-white/60 bg-black/40 rounded p-3 max-h-40 overflow-auto whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}

function SearchCard() {
  const [q, setQ] = useState('')
  const [output, setOutput] = useState('')
  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const r = await fetch(`/api/second-brain/wiki?type=search&q=${encodeURIComponent(query)}`)
      return r.json()
    },
    onSuccess: (data) => setOutput(typeof data === 'object' ? data.output ?? JSON.stringify(data, null, 2) : String(data)),
    onError: (err: Error) => setOutput(`❌ ${err.message}`),
  })

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white/90">搜尋 wiki</h3>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && q.trim() && searchMutation.mutate(q.trim())}
          placeholder="關鍵字..."
          className="flex-1 bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white/90 placeholder:text-white/30"
        />
        <button
          onClick={() => q.trim() && searchMutation.mutate(q.trim())}
          disabled={!q.trim() || searchMutation.isPending}
          className="px-3 py-1.5 rounded-md text-xs bg-white/[0.06] text-white/80 border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-50"
        >
          {searchMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
        </button>
      </div>
      {output && (
        <pre className="mt-3 text-xs text-white/60 bg-black/40 rounded p-3 max-h-72 overflow-auto whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}

function SynthesisCard({ settings, onChanged }: { settings: WikiSettings; onChanged: () => void }) {
  const [cronExpr, setCronExpr] = useState(settings.synthesisCron)
  const [model, setModel] = useState(settings.synthesisModel)
  const [dualWrite, setDualWrite] = useState(settings.dualWrite)

  const progressQuery = useQuery<SynthesisProgress>({
    queryKey: ['wiki-synthesis-progress'],
    queryFn: () => fetch('/api/second-brain/wiki?type=synthesis-progress').then(r => r.json()),
    refetchInterval: (query) => (query.state.data?.running ? 5_000 : 60_000),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/second-brain/wiki?action=settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synthesisCron: cronExpr,
          synthesisModel: model,
          dualWrite,
        }),
      })
      return r.json()
    },
    onSuccess: () => onChanged(),
  })

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/second-brain/wiki?action=synthesize-now', { method: 'POST' })
      return r.json()
    },
    onSuccess: () => onChanged(),
  })

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Settings className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-medium text-white/90">綜合整理排程（Synthesis）</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <label className="text-xs text-white/60">
          Cron expression
          <input
            type="text"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 3 * * 0"
            className="w-full mt-1 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-white/90"
          />
        </label>
        <label className="text-xs text-white/60">
          Model（留空 = 系統預設）
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="例：openai/gpt-5.4-mini"
            className="w-full mt-1 bg-black/40 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-white/90"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60 mt-5">
          <input
            type="checkbox"
            checked={dualWrite}
            onChange={(e) => setDualWrite(e.target.checked)}
            className="accent-cyan-500"
          />
          Dual-write（同時 ingest 個人 vault 的 raw 檔）
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-3 py-1.5 rounded-md text-xs bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          {saveMutation.isPending ? '儲存中...' : '儲存設定'}
        </button>
        <button
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending}
          className="px-3 py-1.5 rounded-md text-xs bg-white/[0.06] text-white/80 border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-50"
        >
          {triggerMutation.isPending ? '啟動中...' : '立即綜合整理'}
        </button>
        {(settings.tunnelUrl || settings.localReportUrl) && (
          <a
            href={settings.tunnelUrl || settings.localReportUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
          >
            最近一次 report{settings.tunnelUrl ? '' : '（本機）'} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      {settings.lastSynthesisAt && (
        <p className="text-xs text-white/40 mt-2">最後執行：{settings.lastSynthesisAt}</p>
      )}
      {progressQuery.data && (progressQuery.data.running || progressQuery.data.stage) && (
        <ProgressTracker progress={progressQuery.data} />
      )}
      {triggerMutation.isSuccess && (
        <p className="text-xs text-emerald-400 mt-2">已啟動，agent 在背景跑（10–30 分鐘）。完成時會 announce。</p>
      )}
    </div>
  )
}

function ProgressTracker({ progress }: { progress: SynthesisProgress }) {
  const idx = STAGE_ORDER.indexOf(progress.stage)
  const isError = progress.stage === 'error'
  return (
    <div className="mt-4 p-3 rounded border border-white/[0.06] bg-black/30">
      <div className="flex items-center justify-between text-xs text-white/60 mb-2">
        <span>
          {progress.running ? '🟡 執行中' : isError ? '🔴 失敗' : '✅ 已完成'} · {STAGE_LABELS[progress.stage] ?? progress.stage}
        </span>
        {progress.startedAt && (
          <span className="text-white/30">started {new Date(progress.startedAt).toLocaleString('zh-TW')}</span>
        )}
      </div>
      <div className="flex gap-1">
        {STAGE_ORDER.map((s, i) => {
          const done = idx >= 0 && i < idx
          const current = idx === i && !isError
          const failed = isError && i === idx
          return (
            <div
              key={s}
              title={STAGE_LABELS[s]}
              className={`h-1.5 flex-1 rounded ${
                failed ? 'bg-red-500'
                  : current ? 'bg-cyan-400 animate-pulse'
                    : done ? 'bg-emerald-400'
                      : 'bg-white/[0.08]'
              }`}
            />
          )
        })}
      </div>
      {progress.message && (
        <p className="text-xs text-white/50 mt-2 break-words">{progress.message}</p>
      )}
      {progress.error && (
        <p className="text-xs text-red-400 mt-1 break-words">錯誤：{progress.error}</p>
      )}
    </div>
  )
}
