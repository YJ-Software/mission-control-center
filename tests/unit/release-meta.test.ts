import { describe, it, expect } from 'vitest'
import { bakedVersionJson, releaseTag, resolveValidated, buildManifest, remoteTagCommit } from '../../scripts/lib/release-meta.mjs'
import { parseMccVersion } from '@/lib/version'
import { validatedOf, validationStatus } from '@/lib/release-validation'

const artifact = { platform: 'linux', arch: 'x64', url: 'https://x/v0.3.93/t.tar.gz', sha256: 'ab', size: 1 }
const prevManifest = {
  latest: {
    version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', openclawVersion: '2026.9.3',
    releaseDate: '2026-09-16T00:00:00.000Z', artifacts: [artifact],
  },
  history: [{ version: '2026.9.3-v0.3.91', mccVersion: '0.3.91', openclawVersion: '2026.9.3', releaseDate: null }],
}

describe('bakedVersionJson', () => {
  it('uses the bare semver as the display version and keeps mccVersion', () => {
    expect(bakedVersionJson({ mccVersion: '0.3.93', commit: 'abc1234', buildTime: 't' }))
      .toEqual({ version: '0.3.93', mccVersion: '0.3.93', commit: 'abc1234', buildTime: 't' })
  })
})

describe('releaseTag', () => {
  it('is v<mcc>', () => expect(releaseTag('0.3.93')).toBe('v0.3.93'))
})

describe('resolveValidated', () => {
  it('takes explicit env lists (the operator just ran E2E)', () => {
    expect(resolveValidated({ MCC_VALIDATED_OPENCLAW: '2026.9.3, 2026.9.4', MCC_VALIDATED_HERMES: '2026.9.14' }, prevManifest.latest))
      .toEqual({ openclaw: ['2026.9.3', '2026.9.4'], hermes: ['2026.9.14'] })
  })

  it('is sticky from the previous release when env is unset — an MCC-only patch inherits validation', () => {
    expect(resolveValidated({}, prevManifest.latest)).toEqual({ openclaw: ['2026.9.3'] })
  })

  it('env for one backend keeps the sticky value of the other', () => {
    expect(resolveValidated({ MCC_VALIDATED_HERMES: '2026.9.14' }, { version: '0.3.93', validated: { openclaw: ['2026.9.3'] } }))
      .toEqual({ openclaw: ['2026.9.3'], hermes: ['2026.9.14'] })
  })

  it('null when nothing is known', () => {
    expect(resolveValidated({}, null)).toBeNull()
  })

  it('a blank MCC_VALIDATED_OPENCLAW (e.g. " ") is treated as unset, not as "validated against nothing"', () => {
    expect(resolveValidated({ MCC_VALIDATED_OPENCLAW: ' ' }, prevManifest.latest)).toEqual({ openclaw: ['2026.9.3'] })
  })

  it('a blank MCC_VALIDATED_HERMES (e.g. ",") is treated as unset, not as "validated against nothing"', () => {
    expect(
      resolveValidated({ MCC_VALIDATED_HERMES: ',' }, { version: '0.3.93', validated: { openclaw: ['2026.9.3'], hermes: ['2026.9.14'] } }),
    ).toEqual({ openclaw: ['2026.9.3'], hermes: ['2026.9.14'] })
  })

  // Drift guard: the legacy-derivation rule is duplicated in
  // src/lib/release-validation.ts (validatedOf) for the dashboard's own
  // reads. Both must agree on every legacy/new shape.
  it.each([
    { name: 'legacy entry with only openclawVersion', entry: { version: 'x', openclawVersion: '2026.9.3' } },
    { name: 'new entry with validated', entry: { version: 'x', validated: { openclaw: ['2026.9.3'], hermes: ['2026.9.14'] } } },
    { name: 'entry with neither', entry: { version: 'x' } },
  ])('resolveValidated({}, entry) matches validatedOf(entry) — $name', ({ entry }) => {
    expect(resolveValidated({}, entry)).toEqual(validatedOf(entry))
  })

  it('validatedOf: an explicit-but-empty validated object is not treated as legacy fallback, but has no per-backend list', () => {
    expect(validationStatus(validatedOf({ version: 'x', validated: {} }), 'openclaw', '2026.9.3')).toBe('unknown')
  })

  it('validatedOf: an empty-string openclawVersion is not a legacy validation claim', () => {
    expect(validationStatus(validatedOf({ version: 'x', openclawVersion: '' }), 'openclaw', '2026.9.3')).toBe('unknown')
  })
})

describe('buildManifest', () => {
  const m = buildManifest({
    mccVersion: '0.3.93', validated: { openclaw: ['2026.9.3'] }, notes: 'n',
    artifact, prevManifest, now: '2026-09-21T00:00:00.000Z',
  })

  it('writes the new latest with validated and bare version', () => {
    expect(m.latest).toMatchObject({ version: '0.3.93', mccVersion: '0.3.93', validated: { openclaw: ['2026.9.3'] } })
  })

  it('keeps openclawVersion for dashboards still on the old code', () => {
    expect(m.latest.openclawVersion).toBe('2026.9.3')
  })

  it('rotates the previous latest into history', () => {
    expect(m.history[0]).toMatchObject({ version: '2026.9.3-v0.3.92', mccVersion: '0.3.92', openclawVersion: '2026.9.3' })
    expect(m.history[1].mccVersion).toBe('0.3.91')
  })

  // The two invariants that keep v0.3.92 dashboards able to upgrade. They
  // replay exactly what the OLD code does with the new manifest + tarball.
  it('old /api/upgrade/check still sees 0.3.93 as the latest semver', () => {
    const latestMcc = m.latest.mccVersion || parseMccVersion(m.latest.version)
    expect(latestMcc).toBe('0.3.93')
  })

  it('job recovery after restart: job.expectedVersion === version.json.version (src/lib/jobs/recovery.ts), else a successful upgrade is misreported as failed/stale', () => {
    const baked = bakedVersionJson({ mccVersion: '0.3.93', commit: 'c', buildTime: 't' })
    expect(m.latest.version).toBe(baked.version)
  })
})

describe('remoteTagCommit', () => {
  it('annotated tag: prefers the peeled refs/tags/<tag>^{} line over the tag-object line', () => {
    const out = [
      'a2d33fd1111111111111111111111111111111a\trefs/tags/v0.3.92',
      'f32f032222222222222222222222222222222b\trefs/tags/v0.3.92^{}',
    ].join('\n')
    expect(remoteTagCommit(out, 'v0.3.92')).toBe('f32f032222222222222222222222222222222b')
  })

  it('lightweight tag: single line, no peel — returns its own sha', () => {
    const out = 'c3d44fe333333333333333333333333333333c\trefs/tags/v0.3.92'
    expect(remoteTagCommit(out, 'v0.3.92')).toBe('c3d44fe333333333333333333333333333333c')
  })

  it('tag absent on origin: empty output returns null', () => {
    expect(remoteTagCommit('', 'v0.3.92')).toBeNull()
  })

  it('ignores unrelated refs a glob query can also return, e.g. v0.3.93-rc1 or v0.3.92x', () => {
    const out = [
      'd4e55gf444444444444444444444444444444d\trefs/tags/v0.3.93-rc1',
      'e5f66hg555555555555555555555555555555e\trefs/tags/v0.3.92x',
    ].join('\n')
    expect(remoteTagCommit(out, 'v0.3.92')).toBeNull()
  })
})
