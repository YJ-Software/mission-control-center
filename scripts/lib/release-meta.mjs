/**
 * Pure release metadata shared by build-release.mjs and publish-release.mjs.
 *
 * Kept import-safe (no side effects) so the compatibility invariants with
 * already-deployed dashboards are unit-tested — see
 * tests/unit/release-meta.test.ts. In short: `mccVersion` must stay, and
 * version.json.version must equal manifest.latest.version.
 */

/** What the tarball bakes as version.json. */
export function bakedVersionJson({ mccVersion, commit, buildTime }) {
  return { version: mccVersion, mccVersion, commit, buildTime }
}

export function releaseTag(mccVersion) {
  return `v${mccVersion}`
}

function splitList(s) {
  return String(s).split(',').map((x) => x.trim()).filter(Boolean)
}

function prevValidated(prevLatest) {
  if (!prevLatest) return null
  if (prevLatest.validated) return prevLatest.validated
  if (prevLatest.openclawVersion) return { openclaw: [prevLatest.openclawVersion] }
  return null
}

/**
 * Validated backend versions for this release.
 *   MCC_VALIDATED_OPENCLAW / MCC_VALIDATED_HERMES (comma lists) — set after a
 *   green throwaway E2E, with the versions the run ACTUALLY used.
 *   Otherwise sticky from the previous release, per backend.
 */
export function resolveValidated(env, prevLatest) {
  const out = { ...(prevValidated(prevLatest) ?? {}) }
  if (env.MCC_VALIDATED_OPENCLAW) out.openclaw = splitList(env.MCC_VALIDATED_OPENCLAW)
  if (env.MCC_VALIDATED_HERMES) out.hermes = splitList(env.MCC_VALIDATED_HERMES)
  return Object.keys(out).length ? out : null
}

function historyEntry(latest) {
  return {
    version: latest.version,
    mccVersion: latest.mccVersion || latest.version,
    openclawVersion: latest.openclawVersion || null,
    ...(latest.validated ? { validated: latest.validated } : {}),
    releaseDate: latest.releaseDate || null,
  }
}

export function buildManifest({ mccVersion, validated, notes, artifact, prevManifest, now }) {
  const prevLatest = prevManifest?.latest
  const artifacts = [artifact]
  for (const a of prevLatest?.artifacts || []) {
    if (a.platform === artifact.platform && a.arch === artifact.arch) continue
    artifacts.push(a)
  }

  const manifest = {
    latest: {
      version: mccVersion,
      mccVersion,
      // Dashboards on pre-P1 code show this; keep it meaningful.
      openclawVersion: validated?.openclaw?.at(-1) ?? null,
      ...(validated ? { validated } : {}),
      releaseDate: now,
      ...(notes ? { notes } : {}),
      artifacts,
    },
  }

  const prevMcc = prevLatest?.mccVersion || prevLatest?.version
  if (prevLatest && prevMcc !== mccVersion) {
    manifest.history = [historyEntry(prevLatest), ...(prevManifest.history || []).slice(0, 9)]
  } else if (prevManifest?.history) {
    manifest.history = prevManifest.history
  }
  return manifest
}
