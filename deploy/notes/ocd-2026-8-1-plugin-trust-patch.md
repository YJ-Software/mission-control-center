# OCD deployer patch — OpenClaw 2026.8.1 plugin trust gate

> **RESOLVED 2026-09-01.** TWNoC shipped the deployer fix and a fresh
> WHMCS/OCD deploy onto a rebuilt throwaway VPS now completes green in 7.4
> minutes. Verified on the deployed box:
>
> | Issue | Outcome |
> |---|---|
> | 1 — `plugins install` trust gate | **Fixed.** `lossless-claw` 1.0.0 installs and comes up `enabled`, sourced from `~/.openclaw/npm/…`. Not a stale config entry — the plugin is really there. |
> | 2 — rescue block blames the gateway | **Not exercised.** Nothing failed this run, so the rescue path never ran. The fix is unverified, not disproven. |
> | 3 — qwen key seeded in one lane only | **Fixed.** The key is in both `models.providers.qwen-portal.apiKey` and the auth store, and the `cron-job` E2E spec passes on a fresh deploy — it had failed for the entire previous run. |
> | 3b — the issued key was dead | **Fixed.** This deploy's key authenticates and lists models against `https://spark.gbox.tw/v1`. |
>
> One incidental note for whoever reads the logs next: on 2026.8.1 the auth
> store moved to `~/.openclaw/state/openclaw.sqlite`, so the path in Issue 3
> below is out of date. The lane split itself still holds.
>
> Everything below is the original report, kept as filed.

**Status:** deployer-side fix (TWNoC OCD ansible). NOT a Mission Control bug.
Found during the OpenClaw 2026.8.1 E2E on the throwaway VPS, 2026-08-31.

**Impact:** every fresh WHMCS/OCD deploy fails once the target installs OpenClaw
2026.8.1. `PLAY RECAP: ok=96 changed=38 unreachable=0 failed=1 skipped=13
rescued=2`, surfaced in WHMCS as `Ansible playbook exited with code 2`.

Three things need fixing: the failing task (Issue 1), a rescue block that
reports the wrong cause and will send whoever debugs this down a dead end
(Issue 2), and a long-standing auth-seeding gap that silently breaks every cron
job on a successfully deployed box (Issue 3).

---

## Issue 1 — `plugins install` is refused for npm-registry plugins (PRIORITY)

### Problem

OCD ansible `roles/openclaw/tasks/main.yml:528`:

```yaml
- name: Install lossless-claw plugin
  command: openclaw plugins install @martian-engineering/lossless-claw
```

fails on 2026.8.1:

```
WARNING - Installing plugin from npm registry: @martian-engineering/lossless-claw
This source is outside ClawHub review and trust metadata. Only continue if you
trust the publisher, package contents, and install source.
Install cancelled; rerun with --force after reviewing the source.
```

2026.8.1 refuses, by default, to install any plugin that comes from the npm
registry rather than from ClawHub's reviewed index. Earlier versions installed
it silently, so the playbook never had to ask.

### `--force` alone is NOT sufficient (verified)

The obvious patch — appending `--force` — was tested on the box and still fails,
because the forced path wants a terminal:

```
$ openclaw plugins install @martian-engineering/lossless-claw --force
This source is outside ClawHub review and trust metadata. ...
[openclaw] Could not start the CLI.
[openclaw] Reason: Command failed during launch or output capture (EACCES)
```

Ansible's `command`/`shell` modules give the child no TTY, so a `--force` patch
would turn a clean "cancelled" failure into a confusing `EACCES` failure.

### Suggested fixes, best first

1. **Install from ClawHub instead**, if the plugin is (or can be) published
   there — that path is not gated:
   `openclaw plugins install clawhub:@<scope>/<name> --accept-capabilities`.
   Verified working on 2026.8.1 for `clawhub:@openclaw/kimi-provider`.
2. **Drop the task** if lossless-claw is not actually required for the deploy.
   Note the config still carries a stale `plugins.entries.lossless-claw` /
   `plugins.allow` entry, which makes the gateway log a warning on every start:
   `plugin not found: lossless-claw (stale config entry ignored...)`. Remove the
   config entry along with the task.
3. If it must come from npm, run it with a PTY (`ansible ... expect`, or a small
   `script`/`socat` wrapper) **and** `--force`, then verify the exit code.

Whichever path is chosen, the task should assert the plugin is actually present
afterwards (`openclaw plugins list`) instead of trusting the exit code.

---

## Issue 2 — the rescue block blames the gateway for an unrelated failure

### Problem

When the task above fails, the rescue block collects diagnostics and ends with:

```
TASK [openclaw : Fail with diagnosis]
fatal: [deploy_target]: FAILED! =>
  {"msg": "openclaw-gateway failed to start. See service status and journal
   logs above."}
```

**The gateway had not failed.** Checked on the box at that moment:

```
Active: active (running) since Mon 2026-08-31 13:59:47 CST
[gateway] ready
curl http://127.0.0.1:18789/  → 200
```

The playbook's own captured `svc_status` even shows `active (running)` and
`[gateway] ready` immediately above the "failed to start" verdict.

### Root cause

The rescue path is reached by any failure in that block, but its diagnosis is
hard-coded to the gateway case. The plugin-install failure inherits a message
about something that is demonstrably healthy.

### Suggested fix

Make the diagnosis conditional on what actually failed — check the gateway's
health explicitly (systemd state, or `curl` the gateway port) and only claim
"gateway failed to start" when that check fails. Otherwise report the failed
task name and its stderr.

---

## Issue 3 — the qwen key is seeded in only one of the two places auth is read from

### Problem

Chat works on a deployed box, but **every cron job fails**:

```
No API key found for provider "qwen-portal".
Auth store: ~/.openclaw/agents/main/agent/openclaw-agent.sqlite
```

OpenClaw resolves provider auth differently per lane:

| lane | reads from |
|---|---|
| interactive / main (chat) | `models.providers.<id>.apiKey` in `openclaw.json` |
| **cron / isolated / nested** | **the SQLite auth store** `openclaw-agent.sqlite` |

The OCD deploy writes the key only into `openclaw.json`, so the interactive lane
finds it and cron does not. This was first reported for OpenClaw 2026.6.5 and
**still applies on 2026.8.1** — it is not a regression, just never fixed.

### Verified fix

On the throwaway box, with a working key, adding it to the SQLite store as well
made the `cron-job` E2E spec pass in 22.9s (it had failed for the whole run
before that):

```bash
printf '%s\n' "$KEY" | openclaw models auth --agent main \
  paste-api-key --provider qwen-portal
# → Auth profile: qwen-portal:manual (qwen-portal/api_key)
```

The ansible should run this (key on stdin, never in argv) right after it writes
`models.providers.qwen-portal.apiKey`, then assert the profile exists:

```bash
openclaw models auth --agent main list   # must list qwen-portal:*
```

Note Mission Control's own LLM-management UI already goes through
`paste-api-key`, so keys added by the customer in the dashboard work in cron
today. Only the deploy's pre-seeded key is affected.

### Separately: the key OCD issued on this deploy was dead

The deploy log line `Issued llmgw key sk-13d9c… (k_887b835cf72265d9) bound to
103.1.222.141` produced a key that returns `401 API key 無效或已註銷`. A
freshly issued key against the same endpoint (`https://spark.gbox.tw/v1`)
returned HTTP 200 immediately. Since this deploy aborted at Issue 1, the key
was likely never finished provisioning (or was reclaimed afterwards) — worth
checking whether a failed deploy leaves dead keys behind.

---

## Also worth knowing (no action needed)

- **The old Homebrew `bwrap` blocker is gone.** `brew install
  openclaw/tap/gogcli` now fails once with `Error: openclaw/tap/gogcli: Broken
  pipe` and succeeds on the existing retry block (`rescued=2`). The tap also
  logs `Skipping openclaw/tap because it is not trusted` twice before trusting
  the formula — noisy but harmless.
- **Gateway startup races once on first boot** and self-heals:
  `Refusing to run automatic gateway startup migrations because the selected
  config changed during startup. Retry startup so the new config can be
  validated.` systemd restarts it and the second start is clean. The existing
  "Wait for gateway to become reachable (self-healing)" retry absorbs this, so
  no change is needed — but expect one `FAILED - RETRYING` line in the log.

---

## Reproducing

Fresh WHMCS deploy onto Ubuntu 24.04 with OpenClaw at npm `latest` (2026.8.1 as
of 2026-08-31). The failure is version-triggered, not host-specific: any target
that resolves OpenClaw ≥2026.8.1 hits it.
