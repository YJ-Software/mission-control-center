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
