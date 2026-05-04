# Fail2Ban integration for Mission Control

Bans clients that brute-force the dashboard login. Works off the stable log
line emitted by `/api/auth` (`[mc-auth] failed login from <ip>`).

## Install (one-off on the dashboard host)

The jail config is a template (`mission-control.conf.tmpl`) with a
`__LOGPATH__` placeholder, because the log file now lives under the
operator's state dir (`~/.mission-control/logs/mission-control.log` by
default) and the absolute path is per-user.

```bash
sudo apt-get install -y fail2ban

# Filter is static — copy as-is.
sudo cp deploy/fail2ban/filter.d/mission-control.conf /etc/fail2ban/filter.d/

# Jail config — substitute the log path for the user running the dashboard.
LOGPATH="$HOME/.mission-control/logs/mission-control.log"   # adjust if MCC runs as a different user
sudo sed "s|__LOGPATH__|$LOGPATH|" deploy/fail2ban/jail.d/mission-control.conf.tmpl \
  | sudo tee /etc/fail2ban/jail.d/mission-control.conf > /dev/null

sudo systemctl restart fail2ban
sudo fail2ban-client status mission-control   # sanity-check the jail is live
```

## Log path

The dashboard writes stdout to `$STATE/logs/mission-control.log` (default
`~/.mission-control/logs/mission-control.log`). The release install.sh
creates the dir + file owned by the running user (mode 640) and the
systemd unit template appends stdout to it. fail2ban runs as root so it
can read the file regardless of ownership.

Installs made before the path moved (log was at `/var/log/mission-control.log`)
will transition automatically on upgrade — `upgrade.sh` re-renders the
systemd unit from the new template, so the next restart starts writing
to the new path. The old `/var/log/mission-control.log` becomes stale;
delete it manually if you care.

**Why a file instead of journald?** The fail2ban `systemd` backend on
Ubuntu 24.04 does not pick up entries from systemd *user* units (the
Python journal reader filters them out). Writing to a dedicated file
sidesteps that entirely and makes the setup portable.

## Defaults

| Setting | Value | Meaning |
|---------|-------|---------|
| `maxretry` | 5 | failed POSTs before banning |
| `findtime` | 600s | window the count is measured in |
| `bantime`  | 3600s | how long the IP stays blocked |
| `action`   | `ufw[blocktype=reject]` | inserts a UFW reject rule at position 1 — bans the IP on every port |

Tune in `/etc/fail2ban/jail.d/mission-control.conf` — don't edit the
template in the repo on the target machine, it'll be overwritten on the
next release.

## Running behind a proxy / Cloudflare tunnel

Set `TRUST_PROXY=1` in the Mission Control env so the logged IP comes from
`X-Forwarded-For` (first element) instead of the proxy's loopback address.
Without this, every failed login will show up as coming from `127.0.0.1` and
fail2ban's `ignoreip` default will skip it.

```bash
# For a release install, drop this into ~/.mission-control/.env.local
echo 'TRUST_PROXY=1' >> ~/.mission-control/.env.local
systemctl --user restart mission-control
```

## Verification

Hammer the login endpoint from a box that isn't in `ignoreip`:

```bash
for i in $(seq 1 6); do
  curl -s -X POST -H "Content-Type: application/json" \
    -d '{"password":"wrong"}' http://<dashboard>:3737/api/auth
done
# after the 5th attempt, the 6th should hang / reject because UFW dropped you.
sudo fail2ban-client status mission-control   # shows the banned IP
```

## Unbanning

```bash
sudo fail2ban-client set mission-control unbanip <ip>
```

## How this interacts with the UFW rule set

The `ufw` fail2ban action inserts a `reject` rule at **position 1** in the
UFW chain, so a banned IP is cut off from **every** port — SSH (22),
dashboard (3737), whatever you expose next. When `bantime` elapses, the
rule is removed automatically. UFW's main allow rules are untouched.
