import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function writePhaseRecord(phase, payload) {
  const dir = resolve(process.cwd(), 'test-results/last-run')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `phase-${phase}.json`)
  writeFileSync(file, JSON.stringify({
    phase,
    ts: new Date().toISOString(),
    ...payload,
  }, null, 2))
}
