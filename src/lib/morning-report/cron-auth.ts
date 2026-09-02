import { INTERNAL_TOKEN_HEADER } from '@/lib/internal-token'

// The morning-report / wiki crons drive the OpenClaw agent to `curl` the local
// MCC API. proxy.ts used to wave those through on `Host: localhost`; that was a
// forgeable bypass and is gone. The curls now carry an internal token header.
//
// The header is injected here, at the moment a cron command is materialised,
// rather than baked into each template as a `${…}` placeholder — a customer who
// customised a template would otherwise drop the placeholder and silently break
// their cron with a 401. Injecting in code covers the bundled templates, any
// customised template, and the inline command strings alike.

const HEADER = INTERNAL_TOKEN_HEADER
  .split('-')
  .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
  .join('-') // x-internal-token → X-Internal-Token

/** Substitute ${BASE_URL} and add the internal-token header to every curl that
 * targets the local API. Idempotent; a no-op when the token is empty (auth
 * disabled, so the header would be meaningless). */
export function injectCronAuth(template: string, baseUrl: string, token: string): string {
  let out = template
  if (token) {
    const headerArg = `-H "${HEADER}: ${token}"`
    // Line-based: only curls whose line references the local API marker, and
    // only when the header is not already there.
    out = out
      .split('\n')
      .map((line) => {
        if (!/\bcurl\b/.test(line)) return line
        if (!line.includes('${BASE_URL}')) return line
        if (line.includes(HEADER)) return line
        return line.replace(/\bcurl\b/, `curl ${headerArg}`)
      })
      .join('\n')
  }
  return out.replace(/\$\{BASE_URL\}/g, baseUrl)
}
