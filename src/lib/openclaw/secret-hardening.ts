/** Move plaintext credentials out of openclaw.json into a file SecretRef provider.
 *
 * A fresh deploy leaves every credential as a bare string in openclaw.json —
 * no `secrets` block at all — so anything that can read that file (an agent, a
 * workspace tool) can read every key in it. OpenClaw's answer is a SecretRef
 * pointing at a configured provider.
 *
 * This uses ONE json-mode file provider: a single 0600 file holding every
 * migrated secret, each addressed by a JSON pointer mirroring its config path.
 * One provider and one file beats one-per-secret, and json mode is verified
 * working against real OpenClaw 2026.8.2 (gateway starts, audit unresolved=0).
 *
 * `store` refs would be stronger — the store refuses to hand a secret back —
 * but Mission Control has to read gateway.auth.token itself, and a store entry
 * is write-only by design. A file ref is readable by both sides. The file is
 * still plaintext on disk behind 0600/0700: the win is getting secrets out of
 * the config agents read, not encryption at rest.
 */

export interface AuditFinding {
  code: string
  file: string
  jsonPath?: string
  [k: string]: unknown
}

export interface HardenTarget {
  /** Config path as the audit reports it, e.g. `channels.telegram.accounts["x"].botToken`. */
  jsonPath: string
  /** RFC 6901 pointer into the bundle file. */
  pointer: string
}

/** Split a config path into segments, unwrapping ["quoted"] keys. */
function pathSegments(jsonPath: string): string[] {
  const out: string[] = []
  const re = /\[["']([^"']*)["']\]|\[(\d+)\]|([^.[\]]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonPath)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Config path → JSON pointer, escaping per RFC 6901 (~ → ~0, / → ~1). */
export function configPathToPointer(jsonPath: string): string {
  return pathSegments(jsonPath)
    .map((s) => '/' + s.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('')
}

/** Which fields to move, taken from `openclaw secrets audit --json` rather than
 * a hardcoded list — OpenClaw already knows which fields are secret-bearing, and
 * that list grows with each release. Findings for other files (the sqlite auth
 * store) are out of scope for config SecretRefs. */
export function planHardening(findings: AuditFinding[], configPath: string): HardenTarget[] {
  const seen = new Set<string>()
  const out: HardenTarget[] = []
  for (const f of findings) {
    if (f.code !== 'PLAINTEXT_FOUND') continue
    if (f.file !== configPath) continue
    if (!f.jsonPath || seen.has(f.jsonPath)) continue
    seen.add(f.jsonPath)
    out.push({ jsonPath: f.jsonPath, pointer: configPathToPointer(f.jsonPath) })
  }
  return out
}

type Obj = Record<string, any>

function getAt(root: Obj, segs: string[]): unknown {
  return segs.reduce<any>((a, k) => (a == null ? a : a[k]), root)
}

function setAt(root: Obj, segs: string[], value: unknown): void {
  const last = segs[segs.length - 1]
  let cur: Obj = root
  for (const k of segs.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  cur[last] = value
}

export interface HardenOptions {
  /** Provider alias — must match /^[a-z][a-z0-9_-]{0,63}$/. */
  provider: string
  /** Absolute path of the bundle file the provider reads. */
  path: string
  /** Existing bundle contents, so a re-run does not drop already-moved values. */
  existingBundle?: Obj
}

export interface HardenResult {
  config: Obj
  bundle: Obj
  /** How many fields were actually moved this run (0 on a no-op re-run). */
  moved: number
}

/** Pure transform: returns the rewritten config and the bundle to write.
 * Fields that are already SecretRefs, or absent, are left untouched — so this
 * is safe to run repeatedly. */
export function buildHardenedConfig(
  config: Obj,
  plan: HardenTarget[],
  opts: HardenOptions,
): HardenResult {
  const next: Obj = structuredClone(config)
  const bundle: Obj = structuredClone(opts.existingBundle ?? {})
  let moved = 0

  for (const target of plan) {
    const segs = pathSegments(target.jsonPath)
    const current = getAt(next, segs)
    // Only plaintext strings move. An object is already a ref; undefined means
    // the field is gone since the audit ran.
    if (typeof current !== 'string' || current.length === 0) continue

    setAt(bundle, pathSegments(target.jsonPath), current)
    setAt(next, segs, { source: 'file', provider: opts.provider, id: target.pointer })
    moved += 1
  }

  next.secrets = next.secrets ?? {}
  next.secrets.providers = {
    ...(next.secrets.providers ?? {}),
    [opts.provider]: { source: 'file', path: opts.path, mode: 'json' },
  }

  return { config: next, bundle, moved }
}
