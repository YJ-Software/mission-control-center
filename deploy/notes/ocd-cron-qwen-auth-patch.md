# OCD deployer patches (OpenClaw 2026.6.x on Ubuntu 24.04)

**Status:** deployer-side fixes (TWNoC OCD ansible). NOT Mission Control bugs.
Two independent issues found during the OpenClaw 2026.6.6 E2E:

1. **Homebrew bwrap sandbox blocks every fresh deploy** (priority — fails before
   OpenClaw is even installed; version-independent).
2. **qwen auth missing for cron/isolated agent lanes** (cron jobs fail although
   chat works).

---

## Issue 1 — Homebrew `bwrap` sandbox blocks fresh deploys (PRIORITY)

### Problem

A fresh WHMCS/OCD deploy now fails early at `brew install openclaw/tap/gogcli`
(OCD ansible `roles/openclaw/tasks/install_tools.yml`), **before** OpenClaw is
installed (PLAY RECAP `ok=54 failed=1`):

```
Error: Bubblewrap is required to use the Linux sandbox but was not found.
```

This is **independent of the OpenClaw version** — it blocks all fresh deploys.

### Root cause (verified)

Homebrew on Linux now enforces a `bwrap` (Bubblewrap) sandbox for installs. On a
fresh Ubuntu 24.04 box:
- bubblewrap isn't installed, and
- the kernel defaults `kernel.apparmor_restrict_unprivileged_userns=1`, which
  blocks unprivileged user namespaces — so even after installing bubblewrap,
  `bwrap` can't create its sandbox.

### The fix (verified)

**Recommended — disable Homebrew's Linux sandbox for brew commands** (one env
var, no system/kernel changes). Add `HOMEBREW_NO_SANDBOX_LINUX=1` to the
environment of the brew tasks in `install_tools.yml` (the Homebrew install step
and `Install gogcli via brew`):

```yaml
- name: Install gogcli via brew
  ansible.builtin.command:
    cmd: "{{ brew_bin }} install openclaw/tap/gogcli"
  become: true
  become_user: openclaw
  environment:
    HOMEBREW_NO_SANDBOX_LINUX: "1"   # <-- add this (and to any other brew task)
    HOME: /home/openclaw
    PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin"
```

Verified on the box: with `kernel.apparmor_restrict_unprivileged_userns=1`
(default), `HOMEBREW_NO_SANDBOX_LINUX=1 brew install openclaw/tap/gogcli` →
`Warning: Sandbox unavailable: building without sandboxing!` → installs, exit 0.

**Alternative — keep the sandbox** (also verified, but more invasive: installs a
package and relaxes a kernel security setting system-wide):

```yaml
- name: Install bubblewrap for Homebrew's Linux sandbox
  ansible.builtin.apt: { name: bubblewrap, state: present, update_cache: true }
- name: Allow unprivileged user namespaces for bwrap
  ansible.posix.sysctl: { name: "{{ item.k }}", value: "{{ item.v }}", state: present }
  loop:
    - { k: kernel.apparmor_restrict_unprivileged_userns, v: "0" }
    - { k: user.max_user_namespaces, v: "28633" }
```

### Verify

```bash
sudo -u openclaw bash -lc 'cd ~ && brew install openclaw/tap/gogcli'   # exit 0
```

---

## Issue 2 — qwen auth for cron / isolated agent lanes

### Problem

A fresh deploy makes qwen usable for interactive chat but **cron / isolated /
background agent runs fail** with:

```
ProviderAuthError: No API key found for provider "qwen-oauth".
Auth store: ~/.openclaw/agents/main/agent/openclaw-agent.sqlite
```

### Root cause (verified)

OpenClaw resolves provider auth **differently per lane**:

| Lane | Auth source |
|------|-------------|
| interactive / main (chat) | static `apiKey` in `~/.openclaw/agents/<id>/agent/models.json` |
| cron / isolated / nested  | the SQLite auth store `openclaw-agent.sqlite` (`auth_profile_store`) |

The deploy seeds the qwen key **only in `models.json`** (`providers.qwen-portal.apiKey`),
so chat works but cron/isolated lanes find no qwen auth in the SQLite store and
fail. (`qwen-portal` is canonicalized to the built-in id `qwen-oauth`, hence the
error names `qwen-oauth`.)

**Proof:** registering the same key in the SQLite store with
`openclaw models auth --agent main paste-api-key --provider qwen-portal`
made a previously-failing cron run succeed.

### The fix

After the role writes the qwen provider into `models.json`, add one task that
also registers the credential in the per-agent SQLite auth store (OpenClaw need
not be running — `paste-api-key` writes the store directly):

```yaml
- name: Register qwen credential in the agent auth store (cron/isolated lanes read here, not models.json)
  ansible.builtin.command:
    cmd: openclaw models auth --agent main paste-api-key --provider qwen-portal
    stdin: "{{ qwen_api_key }}\n"          # same key written to models.json's qwen-portal.apiKey
  become: true
  become_user: openclaw
  environment:
    HOME: /home/openclaw
    PATH: "/home/openclaw/.npm-global/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin"
  register: qwen_auth_paste
  changed_when: "'Auth profile' in qwen_auth_paste.stdout"
```

Notes:
- `paste-api-key` reads the key from **stdin** (no TTY needed) — safe in ansible.
- Idempotent: re-running overwrites the same profile with the same key.
- `--provider qwen-portal` is correct — OpenClaw stores it as
  `qwen-portal:manual [qwen-oauth/api_key]`, which is what the cron lane looks up.
- `--agent main` suffices: isolated agents spawned from `main` inherit its
  **portable** static auth profiles. If you provision additional named agents
  that run jobs, repeat the task per agent id.

### Verify

```bash
sudo -u openclaw HOME=/home/openclaw openclaw models auth --agent main list
# Profiles:
# - qwen-portal:manual [qwen-oauth/api_key]
```
Then a cron/isolated job using `coder-model` should complete with status `ok`.

### Is the SQLite store enough? (yes — `models.json` apiKey not needed)

Verified: with the qwen key in the SQLite store, `models status` reports
`qwen-portal effective=profiles:~/.openclaw/.../openclaw-agent.sqlite` — i.e. the
SQLite profile is the **authoritative** auth source. Stripping the static
`apiKey` out of `models.json` and restarting the gateway, **both** the chat
(interactive) and cron specs still pass. OpenClaw keeps the two in sync, so the
SQLite profile is the single source of truth.

So the **cleanest** deploy shape is:
- `models.json` / config: keep only the provider **definition** (`baseUrl`,
  `models`, `api`) — no static `apiKey`.
- auth: `openclaw models auth ... paste-api-key --provider qwen-portal` (SQLite).

The task above (just adding `paste-api-key` while leaving `models.json` as-is)
also works — the keys are identical and the SQLite profile takes precedence — so
adding the one task is the minimal change; dropping the `models.json` apiKey is
optional simplification.

### Optional secondary cleanup

The deploy's `models.json` also defines custom providers under the **reserved
built-in ids** `qwen-oauth` and `qwen-cli` (same gbox endpoint as `qwen-portal`).
These collide with OpenClaw's built-in catalog. Recommend defining only
`qwen-portal` and dropping the `qwen-oauth` / `qwen-cli` provider entries.
