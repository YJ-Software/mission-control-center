import { readFileSync } from 'node:fs'

/** OpenClaw 2026.8.x lets an operator move plaintext secrets out of
 * openclaw.json into a secret store, leaving a structured reference behind:
 *
 *   "token": { "source": "store", "provider": "default", "id": "GATEWAY_TOKEN" }
 *
 * Any MCC code that reads such a field as a raw string gets an object. An
 * object is truthy, so the usual `?? ''` / `|| ''` guards do not fire and the
 * object travels onward as if it were the credential — which is how the
 * dashboard silently lost its gateway connection. Route every read of a
 * secret-bearing config field through resolveSecretRef so that never happens. */

export interface SecretRef {
  source: string
  provider?: string
  id: string
}

export function isSecretRef(v: unknown): v is SecretRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as SecretRef).source === 'string' &&
    typeof (v as SecretRef).id === 'string'
  )
}

export interface ResolvedSecret {
  /** The secret, or null when it could not be resolved. Never an object. */
  value: string | null
  /** Why it could not be resolved — safe to log, names no secret material. */
  reason?: string
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

/** Resolve a config field that may be a plain string or a SecretRef.
 *
 * `env` and `file` refs resolve here. `store` refs deliberately cannot:
 * secret-kind store entries are write-only by design (`openclaw secrets store
 * get` refuses them), so the value is only ever available to OpenClaw itself.
 * For those, callers get null plus a reason naming the way out. */
export function resolveSecretRef(raw: unknown, opts: ResolveOptions = {}): ResolvedSecret {
  if (typeof raw === 'string') return { value: raw.length > 0 ? raw : null }
  if (raw == null) return { value: null }

  if (!isSecretRef(raw)) {
    return { value: null, reason: `not a secret or SecretRef (got ${typeof raw})` }
  }

  const env = opts.env ?? process.env

  switch (raw.source) {
    case 'env': {
      const v = env[raw.id]
      return v
        ? { value: v }
        : { value: null, reason: `env SecretRef ${raw.id} is not set in the environment` }
    }
    case 'file': {
      try {
        // Trailing newline is near-universal in secret files and never part of
        // the credential.
        const v = readFileSync(raw.id, 'utf8').replace(/\r?\n$/, '')
        return v ? { value: v } : { value: null, reason: `file SecretRef ${raw.id} is empty` }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { value: null, reason: `file SecretRef ${raw.id} unreadable: ${msg}` }
      }
    }
    case 'store':
      return {
        value: null,
        reason:
          `store SecretRef "${raw.id}" cannot be read back — secret-kind store entries are ` +
          `write-only by design. Set OPENCLAW_TOKEN in .env.local (it takes precedence), or ` +
          `use an env/file SecretRef for fields Mission Control has to read itself.`,
      }
    default:
      return { value: null, reason: `unsupported SecretRef source "${raw.source}"` }
  }
}
