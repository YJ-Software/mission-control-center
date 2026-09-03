# OCD change request — customer web chat on a vendor subdomain

**What we want:** after a WHMCS/OCD deploy finishes, the customer opens a URL we
give them and talks to their agent. No SSH tunnel.

Today the WHMCS success page tells the customer to run
`ssh -L 3737:127.0.0.1:3737 openclaw@<ip>` before they can reach Mission
Control at all. That is the barrier this removes — the feature is not a nicety,
it is the difference between "the customer can use what they bought" and "the
customer must know SSH".

**Nothing changes on the Mission Control side.** No new MCC version is required
for this; the items below are all deployer-side. `HOST=0.0.0.0` stays as-is.

---

## The shape

```
customer browser
  └─ https://chat-<slug>.<vendor-domain>       ← DNS A record → the customer's VPS
       └─ Caddy on the customer's VPS  (TLS + basic auth)
            └─ 127.0.0.1:3737  Mission Control
                 └─ 127.0.0.1:18789  the customer's own OpenClaw gateway
```

Caddy runs **on the customer VPS**, not on a vendor edge. Consequences worth
stating to whoever signs this off:

- Chat traffic never transits vendor infrastructure. We are not in the data
  path and not a party to the conversation content.
- No tunnel, no vendor VPN, nothing to keep alive between us and the customer.
- Our only ongoing obligation is one DNS record per customer.

Two layers of auth guard it: Caddy basic auth (a credential OCD generates), then
Mission Control's own login (`AUTH_PASSWORD`, which OCD already generates and
already surfaces in the client area).

---

## What OCD needs to add

### 1. Install and configure Caddy

Verified on a deployed throwaway (Ubuntu 24.04): `apt-get install caddy` gives
**Caddy 2.6.2**, and no other web server is present — 80 and 443 are free.

Caddyfile:

```
chat-<slug>.<vendor-domain> {
	basicauth {
		customer <bcrypt-hash>
	}
	reverse_proxy 127.0.0.1:3737
	log {
		output file /var/log/caddy/access.log
	}
}
```

Two version traps, both verified on 2.6.2 — please pin the version you test
against rather than assuming latest:

- The directive is **`basicauth`**, one word. `basic_auth` (the newer spelling)
  is rejected on 2.6.2 with `unrecognized directive`, and Caddy then fails to
  start. If you install Caddy from the official repo instead of Ubuntu's, you
  get 2.7+ where it is `basic_auth`. Pick one and pin it.
- `caddy hash-password --plaintext '<pw>'` works on 2.6.2. Newer versions
  changed that flag.

**Do not** add `header_up Host {upstream_hostport}` — several Caddy examples on
the web do. It rewrites the Host that Mission Control sees and breaks the login
redirect. Leave Host and `X-Forwarded-For` at Caddy's defaults.

### 2. Generate and surface the basic-auth credential

At deploy time: generate a random password, store the bcrypt hash in the
Caddyfile, and show the plaintext **once** in the WHMCS client area next to the
credentials you already display there.

The customer therefore ends up with two credentials, both from the same page
they already read today:
- Caddy: `customer` / `<generated>`
- Mission Control login: the `AUTH_PASSWORD` you already show

### 3. Firewall

`ufw` is already enabled with `default deny incoming` — confirmed from
`/var/log/ufw.log` on a fresh deploy, blocking scanners from 19:13 mid-playbook.
Two rules to add:

```
ufw allow 80,443/tcp
ufw allow in on tailscale0 to any port 3737 proto tcp
```

The second one matters and is easy to get wrong. **Each customer runs their own
tailnet** — the "設定 Tailscale VPN" button on the success page joins the VPS to
*the customer's* network, not ours. So gate `:3737` by **interface, not by IP
range**: a `100.64.0.0/10` rule would be both useless to us (we are not in their
tailnet) and far too wide. Verified with `ufw --dry-run` on the throwaway; it
emits `-A ufw-user-input -i tailscale0 -p tcp --dport 3737 -j ACCEPT` plus the
v6 equivalent.

After this, `:3737` is reachable only over loopback (Caddy, and Mission
Control's own cron) and over the customer's tailnet. It stays closed on the
public interface, exactly as it is today.

### 4. Set `TRUST_PROXY=1` in Mission Control's `.env.local`

Without it every request appears to come from `127.0.0.1` (Caddy), so the login
audit log and any fail2ban jail would attribute attempts to loopback instead of
the real client. The variable already exists in Mission Control; it just needs
to be set when Caddy is in front.

### 5. DNS

One A record per customer, `chat-<slug>.<vendor-domain>` → the VPS IP, created
at deploy and removed at termination. `<slug>` can be the WHMCS service id or
something the customer picks.

### 6. Termination / credential rotation

- Terminate: remove the DNS record. Optionally stop Caddy.
- Rotate or revoke access: rewrite the Caddyfile hash over SSH and
  `systemctl reload caddy`.

### 7. Suggested: a fail2ban jail on Caddy's access log

fail2ban is already installed (Mission Control has a tab for it). A jail
matching Caddy 401s gives basic-auth some brute-force protection, which it
otherwise has none of.

---

## What we verified, and what we did not

Verified on a real OCD-deployed throwaway (Ubuntu 24.04, OpenClaw 2026.8.2,
Mission Control 2026.8.2-v0.3.84):

- Caddy with `basicauth` in front of Mission Control: no credentials → Caddy
  returns 401 before the request reaches MCC; with credentials → the MCC login
  page loads.
- **The chat WebSocket works through Caddy's basic auth.** This was the one
  genuine technical unknown — browsers' handling of Basic credentials on a WS
  handshake is not uniform. The `agents-chat` end-to-end spec (send a message,
  receive a reply) passes through Caddy.
- The session cookie comes back with `Secure` set, because Mission Control
  already honours `X-Forwarded-Proto` and Caddy sends it. No MCC change needed.
- `ufw --dry-run` accepts the interface-scoped rule above.

**Not verified — the one thing left:** real certificate issuance. The throwaway
has no DNS name pointing at it, so the test used `tls internal` (a self-signed
cert). Caddy's automatic Let's Encrypt flow needs the public name to resolve to
the box and port 80 reachable. Nothing suggests it will not work, but nobody has
run it end to end. Please prove it on the first customer-shaped deploy with a
real name before this goes out widely — and note the rate limits if you script
repeated test deploys against the same domain.

---

## Open product decisions (not deployer questions)

These are ours to answer, listed so the deployer work is not blocked waiting on
them:

1. **Is WHMCS-native single sign-on a requirement?** Basic auth is a credential
   the customer reads off the client area — it is not "log in with WHMCS". If
   real SSO is required later, Caddy's `forward_auth` can replace `basicauth`
   with **no change to Mission Control**, so this is a clean upgrade path rather
   than a rewrite.
2. **Should the customer see all of Mission Control?** Today one password opens
   everything, including the terminal, backups, system updates and reboot. The
   customer owns the VPS, so that is arguable — but if we want chat-only access
   for this entry point, that is a Mission Control change and we should scope it
   before promising it.
3. Basic auth has no logout and no session expiry (it clears when the browser
   closes). Acceptable for an MVP; worth knowing.
