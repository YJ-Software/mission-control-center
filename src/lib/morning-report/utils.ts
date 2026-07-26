import { format } from 'date-fns'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

export function getDataDir() {
  return join(process.cwd(), 'data', 'morning-report')
}

export function getGeneratedDir() {
  return join(getDataDir(), 'generated')
}

export function getTmpDir() {
  return join(getDataDir(), 'tmp')
}

export function getDateVars(date: Date = new Date()) {
  const today = format(date, 'yyyyMMdd')
  const dateHyphen = format(date, 'yyyy-MM-dd')
  const year = format(date, 'yyyy')
  return { today, dateHyphen, year }
}

/** Read agents.defaults.model.primary from ~/.openclaw/openclaw.json */
export function getOpenClawDefaultModel(): string {
  try {
    const ocPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(ocPath)) {
      const oc = JSON.parse(readFileSync(ocPath, 'utf-8'))
      return oc?.agents?.defaults?.model?.primary || ''
    }
  } catch { /* ignore */ }
  return ''
}

/**
 * Model IDs listed under agents.defaults.models in ~/.openclaw/openclaw.json.
 * An empty result means no allowlist is configured, which OpenClaw treats as
 * "anything goes" — callers must not read it as "nothing is allowed".
 */
export function getOpenClawAllowedModels(): string[] {
  try {
    const ocPath = join(homedir(), '.openclaw', 'openclaw.json')
    if (existsSync(ocPath)) {
      const oc = JSON.parse(readFileSync(ocPath, 'utf-8'))
      const models = oc?.agents?.defaults?.models
      if (models && typeof models === 'object') return Object.keys(models)
    }
  } catch { /* ignore */ }
  return []
}

/**
 * Pick a model OpenClaw will actually accept for a cron job.
 *
 * OpenClaw rejects a job whose payload.model is absent from the agent
 * allowlist — the run fails at its scheduled second, before doing any work,
 * and the topic silently turns into "⚠️ 此段落尚未生成" in the report. That is
 * how a stale `cronModel` pointing at a long-removed provider took out a whole
 * section for a day. Substitute the fallback at sync time rather than writing
 * a job that can never run.
 */
export function resolveAllowedModel(
  model: string,
  allowed: string[],
  fallback: string,
): string {
  // Empty model = "use the agent default", which needs no validation.
  if (!model) return model
  // No allowlist configured means no restriction to enforce.
  if (allowed.length === 0) return model
  if (allowed.includes(model)) return model
  // Only swap for something that can actually run; otherwise keep the
  // original so the failure stays visible instead of moving somewhere odd.
  return fallback && allowed.includes(fallback) ? fallback : model
}

export function substituteVars(
  template: string,
  vars: Record<string, string>
): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`\${${key}}`, value)
  }
  return result
}
