/**
 * Version parsing + ordering shared by every "is there an update?" check.
 *
 * Each endpoint used to carry its own copy and they disagreed. `/api/services`
 * decided with `installed !== latest`, which cannot tell an upgrade from a
 * downgrade; `/api/upgrade/openclaw-check` compared per dotted segment with
 * `parseInt`, and OpenClaw's build-counter suffix made that silently wrong —
 * `parseInt('1-2')` and `parseInt('1-3')` are both `1`, so `2026.7.1-2` and
 * `2026.7.1-3` read as the same build and a real upgrade never surfaced.
 *
 * One parser, one comparator, so the header badge and the settings card can no
 * longer reach opposite conclusions about the same pair of versions.
 */

/** Matches `2026.7.1`, `2026.7.1-2`, `0.3.76`, `1.2.3-beta.1`. */
const VERSION_TOKEN = String.raw`\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)*`

/**
 * Pull a version out of a `--version` line, suffix included.
 *
 * `product` anchors the match on the tool's own banner so a commit hash or
 * tagline can't win: `OpenClaw 2026.7.1-2 (0790d9f) — …` → `2026.7.1-2`.
 * Falls back to the first version-shaped token in the string.
 */
export function parseCliVersion(raw: string, product?: string): string {
  if (!raw) return ''
  if (product) {
    const anchored = raw.match(new RegExp(`${product}\\s+v?(${VERSION_TOKEN})`, 'i'))
    if (anchored) return anchored[1]
  }
  const loose = raw.match(new RegExp(`\\bv?(${VERSION_TOKEN})`))
  return loose ? loose[1] : ''
}

/** Every number in the version, left to right: `2026.7.1-2` → `[2026, 7, 1, 2]`. */
function numericSegments(v: string): number[] {
  return (v.match(/\d+/g) ?? []).map(Number)
}

/** Whatever is left once digits and separators are gone: `1.2.3-beta.1` → `beta`. */
function tag(v: string): string {
  return v.replace(/[\d.\-+]/g, '').toLowerCase()
}

/**
 * Compare two versions. Returns <0 / 0 / >0 like a sort comparator.
 *
 * A `-N` suffix is treated as one more numeric segment rather than a semver
 * prerelease, because that is what OpenClaw means by it: `2026.7.1-2` is a
 * rebuild *after* `2026.7.1`, so it must sort higher. A missing suffix reads as
 * 0. Non-numeric tags (`-beta`) only break ties between otherwise equal
 * versions, and sort after the bare version for the same reason.
 */
export function compareVersions(a: string, b: string): number {
  const na = numericSegments(a)
  const nb = numericSegments(b)
  const len = Math.max(na.length, nb.length, 3)
  for (let i = 0; i < len; i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  const ta = tag(a)
  const tb = tag(b)
  if (ta === tb) return 0
  return ta < tb ? -1 : 1
}

/**
 * True when `latest` is genuinely newer than `installed`. Missing either side
 * means "we can't tell" — never prompt an update on a failed lookup.
 */
export function isUpdateAvailable(installed: string, latest: string): boolean {
  if (!installed || !latest) return false
  return compareVersions(latest, installed) > 0
}
