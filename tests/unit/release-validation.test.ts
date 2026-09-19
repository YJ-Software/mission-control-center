import { describe, it, expect } from 'vitest'
import { validatedOf, validatedForMcc, validationStatus } from '@/lib/release-validation'

describe('validatedOf', () => {
  it('reads the explicit validated field', () => {
    expect(validatedOf({ version: '0.3.93', validated: { openclaw: ['2026.9.3'], hermes: [] } }))
      .toEqual({ openclaw: ['2026.9.3'], hermes: [] })
  })

  it('derives from the legacy openclawVersion pairing — every pre-P1 entry meant "validated with this"', () => {
    expect(validatedOf({ version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', openclawVersion: '2026.9.3' }))
      .toEqual({ openclaw: ['2026.9.3'] })
  })

  it('returns null when the entry says nothing — unknown, not "validated with nothing"', () => {
    expect(validatedOf({ version: '0.3.10' })).toBeNull()
    expect(validatedOf({ version: '0.3.10', openclawVersion: null })).toBeNull()
  })
})

describe('validatedForMcc', () => {
  const manifest = {
    latest: { version: '0.3.93', mccVersion: '0.3.93', validated: { openclaw: ['2026.9.3'] } },
    history: [
      { version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', openclawVersion: '2026.9.3' },
      { version: '2026.9.2-v0.3.87', mccVersion: '0.3.87', openclawVersion: '2026.9.2' },
    ],
  }

  it('finds latest', () => {
    expect(validatedForMcc(manifest, '0.3.93')).toEqual({ openclaw: ['2026.9.3'] })
  })

  it('finds a history entry by mccVersion, including legacy ones', () => {
    expect(validatedForMcc(manifest, '0.3.87')).toEqual({ openclaw: ['2026.9.2'] })
  })

  it('matches legacy entries that lack mccVersion via the display suffix', () => {
    const m = { latest: { version: '2026.6.1-v0.3.52', openclawVersion: '2026.6.1' } }
    expect(validatedForMcc(m, '0.3.52')).toEqual({ openclaw: ['2026.6.1'] })
  })

  it('returns null for a version no longer in the manifest', () => {
    expect(validatedForMcc(manifest, '0.3.1')).toBeNull()
  })
})

describe('validationStatus', () => {
  const v = { openclaw: ['2026.9.3', '2026.9.4'], hermes: [] }

  it('validated on exact match', () => {
    expect(validationStatus(v, 'openclaw', '2026.9.3')).toBe('validated')
  })

  it('unvalidated when the backend list exists but lacks the version', () => {
    expect(validationStatus(v, 'openclaw', '2026.9.5')).toBe('unvalidated')
    expect(validationStatus(v, 'hermes', '2026.9.14')).toBe('unvalidated')
  })

  it('compares build suffixes exactly — 2026.7.1-2 is not 2026.7.1-3', () => {
    expect(validationStatus({ openclaw: ['2026.7.1-2'] }, 'openclaw', '2026.7.1-3')).toBe('unvalidated')
  })

  it('unknown when we cannot tell — never a false warning', () => {
    expect(validationStatus(null, 'openclaw', '2026.9.3')).toBe('unknown')
    expect(validationStatus(v, 'openclaw', null)).toBe('unknown')
    expect(validationStatus({ openclaw: ['2026.9.3'] }, 'hermes', '2026.9.14')).toBe('unknown')
  })
})
