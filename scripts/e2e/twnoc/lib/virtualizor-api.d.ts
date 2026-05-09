export interface BuildEnduserUrlInput {
  panel: string
  apiKey: string
  apiPass: string
  act: string
  params?: Record<string, string | number | boolean>
}

export function buildEnduserUrl(input: BuildEnduserUrlInput): string

export interface PostJsonResult {
  status: number | undefined
  json: any
  raw?: string
}

export interface VirtualizorEnv {
  VIRTUALIZOR_PANEL: string
  VIRTUALIZOR_API_KEY: string
  VIRTUALIZOR_API_PASS: string
  VIRTUALIZOR_VPS_ID: string | number
  VIRTUALIZOR_OS_TEMPLATE_ID?: string | number
  [key: string]: unknown
}

export function vpsStatus(env: VirtualizorEnv): Promise<PostJsonResult>
export function rebuildVps(env: VirtualizorEnv): Promise<PostJsonResult>

export interface WaitForRunningOptions {
  timeoutMs?: number
  intervalMs?: number
}

export function waitForRunning(env: VirtualizorEnv, options?: WaitForRunningOptions): Promise<unknown>
