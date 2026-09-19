/**
 * Which backend versions a given MCC release was E2E-validated against, and
 * whether the version running here is one of them.
 *
 * Replaces the `<openclawVersion>-v<mcc>` prefix. The prefix could name only
 * one backend and one version, and bumping it forced a release; the manifest
 * now lists what was actually validated and the UI warns (never blocks) when
 * the local combination is not on the list.
 *
 * 'unknown' is a real answer, distinct from 'unvalidated': an old manifest
 * entry that says nothing, a backend the entry never mentions, or a local
 * version we could not read must not raise a warning.
 */

import { parseMccVersion } from '@/lib/version'

export type Backend = 'openclaw' | 'hermes'
export interface ValidatedBackends { openclaw?: string[]; hermes?: string[] }
export type ValidationStatus = 'validated' | 'unvalidated' | 'unknown'

export interface ManifestEntryLike {
  version: string
  mccVersion?: string
  openclawVersion?: string | null
  validated?: ValidatedBackends
}

export function validatedOf(entry: ManifestEntryLike): ValidatedBackends | null {
  if (entry.validated) return entry.validated
  // Pre-P1 entries: the paired prefix WAS the validation claim.
  if (entry.openclawVersion) return { openclaw: [entry.openclawVersion] }
  return null
}

export function validatedForMcc(
  manifest: { latest: ManifestEntryLike; history?: ManifestEntryLike[] },
  mccVersion: string,
): ValidatedBackends | null {
  const entries = [manifest.latest, ...(manifest.history ?? [])]
  const hit = entries.find((e) => (e.mccVersion || parseMccVersion(e.version)) === mccVersion)
  return hit ? validatedOf(hit) : null
}

export function validationStatus(
  validated: ValidatedBackends | null,
  backend: Backend,
  localVersion: string | null,
): ValidationStatus {
  if (!validated || !localVersion) return 'unknown'
  const list = validated[backend]
  if (!list) return 'unknown'
  return list.includes(localVersion) ? 'validated' : 'unvalidated'
}
