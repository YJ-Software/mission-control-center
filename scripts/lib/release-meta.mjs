/**
 * Pure release metadata shared by build-release.mjs and publish-release.mjs.
 *
 * Kept import-safe (no side effects) so the compatibility invariants with
 * already-deployed dashboards are unit-tested — see
 * tests/unit/release-meta.test.ts. In short: `mccVersion` must stay, and
 * version.json.version must equal manifest.latest.version.
 */

/**
 * @typedef {object} ValidatedVersions
 * @property {string[]} [openclaw]
 * @property {string[]} [hermes]
 */

/**
 * @typedef {object} Artifact
 * @property {string} platform
 * @property {string} arch
 * @property {string} url
 * @property {string} sha256
 * @property {number} size
 */

/**
 * @typedef {object} ManifestLatest
 * @property {string} version
 * @property {string} mccVersion
 * @property {string | null} openclawVersion
 * @property {ValidatedVersions} [validated]
 * @property {string} releaseDate
 * @property {string} [notes]
 * @property {Artifact[]} artifacts
 */

/**
 * @typedef {object} HistoryEntry
 * @property {string} version
 * @property {string} mccVersion
 * @property {string | null} openclawVersion
 * @property {ValidatedVersions} [validated]
 * @property {string | null} releaseDate
 */

/**
 * @typedef {object} Manifest
 * @property {ManifestLatest} latest
 * @property {HistoryEntry[]} history
 */

/**
 * @typedef {object} VersionJson
 * @property {string} version
 * @property {string} mccVersion
 * @property {string} commit
 * @property {string} buildTime
 */

/**
 * What the tarball bakes as version.json.
 * @param {object} opts
 * @param {string} opts.mccVersion
 * @param {string} opts.commit
 * @param {string} opts.buildTime
 * @returns {VersionJson}
 */
export function bakedVersionJson({ mccVersion, commit, buildTime }) {
  return { version: mccVersion, mccVersion, commit, buildTime }
}

/**
 * @param {string} mccVersion
 * @returns {string}
 */
export function releaseTag(mccVersion) {
  return `v${mccVersion}`
}

/**
 * Resolve the commit sha a tag points to on origin, from the raw output of
 * `git ls-remote --tags origin '<tag>*'`.
 *
 * Why the glob: `git ls-remote --tags origin <tag>` with an exact ref only
 * ever prints the tag-object line (`refs/tags/<tag>`) — for an annotated
 * tag (what `npm version` creates) that sha is the TAG OBJECT, not the
 * commit it points at, so comparing it against `git rev-parse
 * <tag>^{commit}` (a commit sha) always mismatches. Querying with a glob
 * (`<tag>*`) makes git also emit the peeled `refs/tags/<tag>^{}` line,
 * which is the commit sha. This function prefers that peeled line when
 * present (annotated tag) and falls back to the plain line's sha
 * (lightweight tag, which has no peel).
 *
 * Because the query is a glob, it can also match unrelated refs such as
 * `refs/tags/<tag>-rc1` or `refs/tags/<tag>x` — those are ignored; only an
 * exact `refs/tags/<tag>` or `refs/tags/<tag>^{}` counts.
 *
 * @param {string} lsRemoteOutput raw stdout of `git ls-remote --tags origin '<tag>*'`
 * @param {string} tag the exact tag name to resolve, e.g. `v0.3.92`
 * @returns {string | null} the commit sha, or null when the tag is absent
 */
export function remoteTagCommit(lsRemoteOutput, tag) {
  const wantPlain = `refs/tags/${tag}`
  const wantPeeled = `refs/tags/${tag}^{}`
  let plainSha = null
  let peeledSha = null
  for (const line of String(lsRemoteOutput).split('\n')) {
    if (!line.trim()) continue
    const [sha, ref] = line.split('\t')
    if (ref === wantPeeled) peeledSha = sha
    else if (ref === wantPlain) plainSha = sha
  }
  return peeledSha ?? plainSha
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
 *
 * @param {object} env
 * @param {object | null} [prevLatest]
 * @returns {ValidatedVersions | null}
 */
export function resolveValidated(env, prevLatest) {
  const out = { ...(prevValidated(prevLatest) ?? {}) }
  // A blank/whitespace-only value (" ", ",") is truthy but splits to an empty
  // list — treat that the same as unset, i.e. keep the sticky value, rather
  // than writing `[]` and making every customer see "not validated".
  const openclaw = env.MCC_VALIDATED_OPENCLAW ? splitList(env.MCC_VALIDATED_OPENCLAW) : []
  if (openclaw.length) out.openclaw = openclaw
  const hermes = env.MCC_VALIDATED_HERMES ? splitList(env.MCC_VALIDATED_HERMES) : []
  if (hermes.length) out.hermes = hermes
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

/**
 * @param {object} opts
 * @param {string} opts.mccVersion
 * @param {ValidatedVersions} [opts.validated]
 * @param {string} [opts.notes]
 * @param {Artifact} opts.artifact
 * @param {Manifest} [opts.prevManifest]
 * @param {string} opts.now
 * @returns {Manifest}
 */
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
    history: [],
  }

  const prevMcc = prevLatest?.mccVersion || prevLatest?.version
  if (prevLatest && prevMcc !== mccVersion) {
    manifest.history = [historyEntry(prevLatest), ...(prevManifest.history || []).slice(0, 9)]
  } else if (prevManifest?.history) {
    manifest.history = prevManifest.history
  }

  return manifest
}
