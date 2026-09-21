import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderServiceUnit, validateRenderedUnit, decideUnitUpdate } from '@/lib/upgrade/service-unit'

const TMPL = [
  '[Unit]',
  'Description=Mission Control Center',
  '',
  '[Service]',
  'WorkingDirectory=__PREFIX__/current',
  'ExecStart=__NODE_BIN__ __PREFIX__/current/server.js',
  'StandardOutput=append:__STATE__/logs/mission-control.log',
  'StandardError=append:__STATE__/logs/mission-control.log',
  'Environment=PATH=__NODE_DIR__:%h/.npm-global/bin:/usr/bin:/bin',
  'EnvironmentFile=__STATE__/.env.local',
  '',
].join('\n')

const vars = { nodeBin: '/usr/bin/node', state: '/home/u/.mission-control', prefix: '/home/u/mission-control' }

describe('renderServiceUnit', () => {
  it('substitutes every placeholder, including repeated ones', () => {
    const out = renderServiceUnit(TMPL, vars)
    expect(out).toContain('ExecStart=/usr/bin/node /home/u/mission-control/current/server.js')
    expect(out).toContain('WorkingDirectory=/home/u/mission-control/current')
    // __STATE__ appears three times — a non-global replace would leave two.
    expect(out).toContain('StandardOutput=append:/home/u/.mission-control/logs/mission-control.log')
    expect(out).toContain('StandardError=append:/home/u/.mission-control/logs/mission-control.log')
    expect(out).toContain('EnvironmentFile=/home/u/.mission-control/.env.local')
    expect(out).not.toMatch(/__[A-Z_]+__/)
  })

  it('derives __NODE_DIR__ from the node binary path', () => {
    expect(renderServiceUnit(TMPL, vars)).toContain('Environment=PATH=/usr/bin:%h/.npm-global/bin:/usr/bin:/bin')
  })

  it('leaves systemd specifiers such as %h alone', () => {
    expect(renderServiceUnit(TMPL, vars)).toContain('%h/.npm-global/bin')
  })
})

describe('validateRenderedUnit', () => {
  it('accepts a fully rendered unit', () => {
    expect(validateRenderedUnit(renderServiceUnit(TMPL, vars))).toBeNull()
  })

  it('rejects leftover placeholders — a half-rendered unit would not start', () => {
    const half = renderServiceUnit(TMPL, vars).replace('/home/u/.mission-control/.env.local', '__STATE__/.env.local')
    expect(validateRenderedUnit(half)).toBe('placeholders-left')
  })

  it('rejects a unit with no [Service] section', () => {
    expect(validateRenderedUnit('[Unit]\nDescription=x\n')).toBe('missing-service-section')
  })

  it('rejects a unit with no ExecStart', () => {
    expect(validateRenderedUnit('[Unit]\nDescription=x\n\n[Service]\nType=simple\n')).toBe('missing-execstart')
  })
})

describe('decideUnitUpdate', () => {
  const next = renderServiceUnit(TMPL, vars)

  it('writes when there is no unit yet', () => {
    expect(decideUnitUpdate(null, next)).toBe('write')
  })

  it('writes when the content differs', () => {
    expect(decideUnitUpdate(next.replace('Description=Mission Control Center', 'Description=old'), next)).toBe('write')
  })

  it('does nothing when identical — no daemon-reload churn on every boot', () => {
    expect(decideUnitUpdate(next, next)).toBe('unchanged')
  })

  it('ignores a trailing-newline-only difference', () => {
    expect(decideUnitUpdate(next + '\n', next)).toBe('unchanged')
  })
})

describe('the real shipped template', () => {
  // Regression guard: a future edit to the real template (a new placeholder,
  // a dropped ExecStart) must fail CI rather than silently produce a unit
  // ensure-service-unit.ts writes but the dashboard cannot start from — the
  // fixture TMPL above is a hand-maintained copy and would not catch drift.
  it('renders and validates cleanly from deploy/release/mission-control.service.tmpl', () => {
    const realTemplate = fs.readFileSync(
      path.join(__dirname, '..', '..', 'deploy', 'release', 'mission-control.service.tmpl'),
      'utf8'
    )
    expect(validateRenderedUnit(renderServiceUnit(realTemplate, vars))).toBeNull()
  })
})
