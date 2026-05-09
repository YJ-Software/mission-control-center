export function expandHome(path: string | null | undefined): string | null | undefined

export interface BuildSshArgsInput {
  user: string
  host: string
  keyPath: string
  command: string
  extraOpts?: string[]
}

export function buildSshArgs(input: BuildSshArgsInput): string[]

export interface SshExecInput {
  user: string
  host: string
  keyPath: string
  command: string
  timeoutMs?: number
}

export interface SshExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export function sshExec(input: SshExecInput): Promise<SshExecResult>

export interface WaitForSshInput {
  user: string
  host: string
  keyPath: string
  timeoutMs?: number
}

export function waitForSsh(input: WaitForSshInput): Promise<void>
