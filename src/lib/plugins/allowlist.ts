/**
 * Safe manipulation of OpenClaw's `plugins.allow` allowlist.
 *
 * OpenClaw enforces `plugins.allow` as an allowlist ONLY when it is a non-empty
 * array. An absent or empty list means "every plugin is permitted"; enforcement
 * flips ON the instant the list becomes non-empty, and any plugin NOT in it is
 * then blocked — surfacing later as e.g. "Cannot enable Telegram: blocked by
 * allowlist" when someone tries to add that channel. (OpenClaw only
 * auto-materialises the allowlist for one bundled plugin, `clickclack`; every
 * other plugin, Telegram included, must already be listed.)
 *
 * That makes a naive `allow.push(id)` on an empty list a footgun: it silently
 * ACTIVATES the allowlist and disables every OTHER plugin (Telegram, browser,
 * providers, …) that isn't in our short list. A feature-setup flow that just
 * wants tavily or the memory plugins permitted must never do that.
 *
 * Root cause of the 2026-07 Telegram-pairing regression: a deployed box's
 * `allow` was seeded non-empty but WITHOUT `telegram`, and MCC's Search /
 * Second-Brain setup flows extended it (still without telegram) — so any
 * customer who set those up before pairing Telegram hit the allowlist block.
 * `allowPlugins` makes MCC's half safe: it never activates an inert allowlist,
 * and it only ever extends an active one additively (never dropping what the
 * deployer/operator already permitted). Seeding `telegram` into the deployed
 * baseline is the deployer's responsibility.
 */
export function allowPlugins(cfg: Record<string, any>, ids: string[]): void {
  cfg.plugins ??= {}
  const current = cfg.plugins.allow

  // Inert allowlist (absent or empty) already permits everything, including the
  // plugins we want. Adding our ids here would flip enforcement on and block
  // every unlisted plugin. Leave it inert — our plugins are enabled via their
  // `entries`, which an inert allowlist permits.
  if (!Array.isArray(current) || current.length === 0) return

  // Allowlist already active (an operator/deployer set one). Extend it, but
  // only additively — never drop an id that is already permitted.
  for (const id of ids) {
    if (!current.includes(id)) current.push(id)
  }
}
