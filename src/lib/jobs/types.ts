export type JobKind =
  | 'upgrade-openclaw'
  | 'upgrade-mcc'
  | 'upgrade-mcc-tarball'
  | 'restart-openclaw'
  | 'restart-mcc'
  | 'restart-tailscale'
  | 'restart-claude'
  | 'sys-update'
  | 'disk-cleanup'
  | 'gc'
  | 'doctor'

export type JobStatus = 'running' | 'restarting' | 'success' | 'failed' | 'cancelled'

export type TriggerSource = 'header-button' | 'settings-card' | 'quick-action' | 'cron' | 'api'

export interface JobPhase {
  name: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  startedAt?: string
  finishedAt?: string
  exitCode?: number | null
}

export interface JobMeta {
  id: string
  kind: JobKind
  label: string
  status: JobStatus
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  triggeredBy: TriggerSource
  phases: JobPhase[]
  /** for self-restart jobs: target version we expect after restart */
  expectedVersion?: string
}

export type LogStream = 'stdout' | 'stderr' | 'phase' | 'system'

export interface LogLine {
  ts: string
  stream: LogStream
  text: string
  /** index of the phase this line belongs to (if any) */
  phaseIndex?: number
}
