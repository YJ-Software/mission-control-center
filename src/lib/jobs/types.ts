export type JobKind =
  | 'upgrade-openclaw'
  | 'upgrade-mcc'
  | 'upgrade-mcc-tarball'
  | 'upgrade-nlm'
  | 'restart-openclaw'
  | 'restart-mcc'
  | 'restart-tailscale'
  | 'sys-update'
  | 'doctor'
  | 'provider-login'

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
  /** free-form key/value the runner publishes during execution (e.g. device-code prompt URL + code) */
  extra?: Record<string, string>
}

export type LogStream = 'stdout' | 'stderr' | 'phase' | 'system'

export interface LogLine {
  ts: string
  stream: LogStream
  text: string
  /** index of the phase this line belongs to (if any) */
  phaseIndex?: number
}
