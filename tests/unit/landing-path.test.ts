import { describe, it, expect } from 'vitest'
import { resolveLandingPath, LANDING_KEY, CHAT_PATH, DASHBOARD_PATH } from '@/lib/landing'

// Customers arriving on their chat subdomain should land in a chat window, not
// the full operator dashboard. Which one is a per-box setting (`ui.landingPage`)
// so the operator's own install is unaffected and OCD can flip it at deploy.
describe('resolveLandingPath', () => {
  it('sends a chat-first box to the simple chat window', () => {
    expect(resolveLandingPath('chat')).toBe(CHAT_PATH)
  })

  it('sends an explicitly dashboard box to the dashboard', () => {
    expect(resolveLandingPath('dashboard')).toBe(DASHBOARD_PATH)
  })

  // Existing installs have no such row. They must behave exactly as before —
  // a settings-driven redirect that defaults the other way would silently move
  // every operator's landing page on upgrade.
  it('defaults to the dashboard when unset', () => {
    expect(resolveLandingPath(undefined)).toBe(DASHBOARD_PATH)
    expect(resolveLandingPath(null)).toBe(DASHBOARD_PATH)
    expect(resolveLandingPath('')).toBe(DASHBOARD_PATH)
  })

  // A typo in the settings row must not strand anyone on a blank page.
  it('falls back to the dashboard for an unrecognised value', () => {
    expect(resolveLandingPath('Chat')).toBe(DASHBOARD_PATH)
    expect(resolveLandingPath('nonsense')).toBe(DASHBOARD_PATH)
  })

  it('exposes the settings key it reads', () => {
    expect(LANDING_KEY).toBe('ui.landingPage')
  })

  it('never returns an external or protocol-relative path', () => {
    for (const v of ['chat', 'dashboard', 'nonsense', undefined]) {
      const p = resolveLandingPath(v)
      expect(p.startsWith('/')).toBe(true)
      expect(p.startsWith('//')).toBe(false)
    }
  })
})
