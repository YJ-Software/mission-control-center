# Mission Control Center

[繁體中文](README.md) | English

OpenClaw mission control dashboard — a centralized panel for managing AI agents, scheduled tasks, daily report generation, backups, browser automation, and other operational features.

---

## Why This Dashboard

Mission Control is built **for remote VPSes and headless Linux servers**, not for local desktops. The design follows from that:

- 🌐 **Operate the server entirely from a browser** — terminal (xterm.js + node-pty), Chrome (headless + noVNC), Docker, and systemd units are all served from the dashboard. No SSH client, no X11 forwarding, browser automation via OpenCLI.
- 🖥️ **Headless Chrome + VNC** — runs an actual browser on the server (Xvfb + Openbox + x11vnc + websockify), watch it through in-browser VNC, and connect automation to CDP port 9222. Login state and cookies stay on the server.
- 📅 **Morning reports, backups, and cron are server-resident** — they run on the VPS 24/7, unaffected by your local machine being asleep or offline.
- 🔒 **Best paired with Tailscale** — a throwaway VPS + Tailscale lets you reach the dashboard from any device (phone, tablet, someone else's machine) as if it were local.
- 🧠 **Second Brain (Obsidian + NotebookLM)** — still paying Notion / Evernote? One-click install Obsidian + Self-hosted LiveSync + a local CouchDB server (Docker). Your agent gets an instant cloud brain that syncs with the Obsidian apps on your laptop and phone — for free.
- 🛡️ **fail2ban support** — built-in log format ready for fail2ban to block password brute-force attempts.

---

## Quick Start

```bash
git clone https://github.com/YJ-Software/mission-control-center.git
cd mission-control-center
npm install
npm run dev
```

Open `http://{tailscale_internal_ip}:3737` in your browser. On first launch, `.env.local` is auto-generated and the initial login password is printed to the console.

**Prerequisites:**
- Node.js 24+
- Platform: **developed and tested only on Ubuntu Linux**. macOS / Windows / other Linux distributions are unverified — some features (systemd user units, headless Chrome + VNC, apt-based installers) will fail outright on those platforms.
- Full functionality (agent chat, live feed, cron sync, …) requires OpenClaw running locally on `ws://127.0.0.1:18789`
- Optional: Python 3.10+ and [uv](https://github.com/astral-sh/uv) — only required if you want to run the OpenClaw MCP servers under `deploy/mcp/` (customer-service handoff, mem0 long-term memory, etc.)
- Some package install flows need sudo. The author runs the dashboard with passwordless sudo locally — decide for yourself whether that's acceptable in your environment.

For production deployment (systemd unit + tarball), one-line install:

```bash
curl -fsSL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/install.sh | bash
```

The script fetches `release-manifest.json`, downloads the matching tarball, verifies its sha256, then runs the bundled `install.sh` to create `~/mission-control/` and the systemd user unit. See the Release / Deployment section below for details.

> 🔒 **Strongly prefer private-network access via [Tailscale](https://tailscale.com/) (or similar)**; do not expose the dashboard on a public IP. It ships with high-privilege features (terminal, Docker control, browser automation) — unauthorized access has serious consequences. If a public endpoint is unavoidable, at minimum use a strong password + fail2ban + reverse proxy + TLS.

---

## Feature Overview

### Dashboard
- System health (CPU, memory, disk)
- Service status monitoring (OpenClaw, Tailscale)
- Daily cost charts
- Quick actions (restart services, clear cache)
- Recent activity log
- Upcoming cron schedule preview

### AI Agent Management
- **Agent team** — list of all agents, role grouping (operators / developers / researchers), live status
- **Chat** — real-time conversation with agents, streaming responses, tool-call tracking
- **Sessions** — historical session viewer with per-message conversation, tool usage, and model cost analysis
- **Live feed** — live monitoring of agent reasoning, tool calls, and outputs
- **Cost analysis** — spending breakdown by model / date / session

### Morning Report
- **Topic management** — custom morning report topics (name, emoji, template, schedule, model, delivery method)
- **Format template** — unified HTML format template with variable substitution (`${TODAY}`, `${LANGUAGE}`, …)
- **URL deduplication** — automatically reads URLs from the previous day's report to avoid duplicate citations
- **Pipeline** — generate-prompts → per-topic execution → finalize (merge + HTML conversion) → podcast
- **Podcast generation** — edge-tts speech synthesis + ffmpeg audio merging, supports section splitting and agent post-editing
- **Cron sync** — topics auto-sync to OpenClaw cron jobs (`mr-*` prefix)
- **X/Twitter source workflow**: social topics can use [TweetClaw](https://github.com/Xquik-dev/tweetclaw) (`openclaw plugins install @xquik/tweetclaw`) to search tweets, search replies, monitor public accounts, and cite X/Twitter sources before report finalization
- **Public publishing** — optional public tunnel for serving morning reports and podcasts
- **Obsidian export** — auto-export to a configured Obsidian vault on completion

### Cron Job Management
- Full CRUD (create, read, update, delete)
- Three scheduling styles: cron expressions, one-shot `at`, interval `every`
- Two execution modes: `main` (system events) and `isolated` (standalone agent)
- Multiple delivery methods: `announce` (channel notification), `webhook`, `none`
- Manual trigger; execution history viewer
- Per-job timezone, timeout, model override, and thinking-mode settings

### Backup
- **Source management** — define directories / file paths to back up
- **Destination management** — supports FTP and local destinations (S3 and rsync coming soon)
- **Schedule management** — daily / weekly / monthly / custom cron
- **Job management** — combine source + destination + schedule with retention count
- **Execution history** — full backup log with file size and error messages
- **Restore** — restore from a backup path
- **API token auth** — supports `X-Backup-Token` for external invocation

### Second Brain
- **NotebookLM integration** — login management, notebook CRUD, source management, AI chat, research mode, Studio artifacts (wraps the `nlm` command from `notebooklm-mcp-cli`; see Acknowledgements)
- **Obsidian integration** — headless install (Xvfb + Openbox + x11vnc + websockify), VNC remote access, CouchDB LiveSync sync
- **Capture skills** — two installable OpenClaw global skills (templates contain hardcoded vault paths)
  - `link-capture` — auto-fetch / summarize / score URL-only messages and store under `{vault}/raw/`
  - `youtube-transcript` — async caption / Whisper transcription; summary into `{vault}/raw/`, full transcript into `{vault}/transcripts/`
  - Install location: `~/.agents/skills/{name}/` (OpenClaw global skill path)

### Browser Automation
- **Headless Chrome** — auto-detect and install Chrome + Xvfb + Openbox + x11vnc + websockify
- **VNC access** — control the remote desktop in-browser via noVNC
- **Chrome DevTools Protocol** — CDP port 9222 for automation scripts
- **Service management** — systemd user services with start / stop / log inspection
- **OpenClaw CLI integration** — auto-install and manage the OpenClaw CLI

### Terminal
- Multi-tab terminal (up to 5 sessions)
- xterm.js terminal emulator + WebSocket streaming
- Floating-window mode
- Sensitive output (passwords, tokens) automatically filtered

### Docker Management
- List containers and images
- Start / stop / restart containers
- Prune unused containers / images
- Disk-usage view

### LINE Customer Service Ops

A full LINE Bot AI customer-service back office — not just an agent runtime. Operators can take over any conversation at will, inspect the agent's internal turns, and ensure long-term customer memory keeps accumulating. The whole flow lives in the dashboard; no SSH log-tailing required.

#### Conversations
- **Customer list** — Shows LINE displayName + avatar (not the cryptic userId), unread badge, last-message preview
- **Operator handoff** — One-click toggle "agent replying / I'm handling it"; taking over auto-pauses the agent for 30 minutes (any operator send resets the countdown)
- **Full message-type support**
  - Inbound: text / image / video / audio / file / sticker (stickers render as real images via the LINE sticker CDN)
  - Outbound: text / image / file (composed as `📎 filename + public URL` since LINE has no native file message) / sticker
- **Sticker picker** — 😊 button in the composer; modal grid across 5 LINE official free packs (~180 stickers), click to send
- **Quick-reply buttons** — Up to 13 chips per message (LINE's hard limit)
- **AI quick-reply suggestions** — While the operator types, an LLM proposes N candidate replies the customer might tap (400ms debounce; count configurable 1–13 in Settings)
- **Handoff catch-up** — When pause ends, the conversation that happened during handoff is fed to the LLM to extract "customer facts worth remembering" and persisted into mem0 — operators don't have to summarize anything
- **Agent timeline drawer** — One click on the conversation header opens every agent session for that customer, with the complete event stream per session (user messages / thinking / tool calls / results / agent text). Each agent text is tagged `✅ delivered to LINE` or `⚠️ NOT delivered`, surfacing openclaw mid-turn race conditions where a reply was generated but dropped

#### Customer long-term memory (mem0)
- **Self-hosted mem0 stack** — Qdrant vector store + Ollama bge-m3 embeddings + Gemini LLM, all local. No external API dependency
- **Memory browser** — In Settings: browse the facts accumulated per customer, grouped by LINE displayName, with manual edit / delete
- **customer-id-injector plugin** — Auto-creates a customer entity stub, injects profile into the system prompt, and overrides the mem0 user_id so the agent always sees that customer's own memory
- **Shared LLM config** — The quick-reply suggester and the handoff catch-up extractor both borrow the LLM env from mem0 (single Gemini API key), so there's no second config to maintain

#### Settings (CS hub)
- **LINE Channel credentials** — Channel access token / channel secret / channel ID with built-in verification
- **Memory provider** — mem0 / wiki-person toggle (see limitation below)
- **Quick Reply LLM** — Reuses mem0's LLM; adjustable suggestion count (1–13)
- **Storage** — Media retention window / capacity warning threshold / on-demand sweep. Files past retention are tombstoned (history kept; content replaced with "[file expired]")
- **PluginConfigCard** — Business hours, AI master switch, default reply text, applicable channel filter
- **WikiConflictBanner** — Warns when wiki / memory mode is misconfigured

#### Overview stats + recommendations
- **Live numbers** — 24h conversations / handoff rate / avg reply latency / total customers / media footprint
- **Auto recommendations** — Detects anomalies (high handoff rate, storage approaching cap, missing LINE profiles, retention set to "never") and surfaces actionable suggestions

#### System integration
- **business-hours-gate plugin** — On-hours / off-hours toggle, AI master switch, per-user pause check; auto-installed
- **LINE async-ack patch + systemd drop-in** — Fixes LINE webhook timeouts caused by OpenClaw's synchronous handling; the drop-in keeps the patch in place after `npm update -g openclaw`
- **Notification center (dashboard-wide)** — Storage warnings, CS system events (e.g. "extracted N customer memories"), MCC / openclaw upgrade alerts; centralized in the top-right bell with dedup so it never spams

> ⚠️ wiki-person mode does not work on OpenClaw 4.29: tools registered via `api.registerTool` (e.g. `wiki_apply` / `wiki_get`) are not exposed to the agent model, so the agent cannot see them. The customer-service feature defaults to mem0; the wiki-person UI is scaffolding that will activate once OpenClaw exposes plugin-registered tools.

### Other Modules
- **Tasks** — to-do tracking (todo / in-progress / done), priority, assignee, project, due date
- **Contacts** — contact directory (role, handle, timezone, notes)
- **Calendar** — event management with optional Google Calendar sync
- **Content** — content scheduling and publishing pipeline (idea → draft → published)
- **Settings** — password, gateway token, preferences
- **Setup wizard** — first-run guidance (Tailscale, search engine, NotebookLM)

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) + custom server (`tsx server.ts`) |
| Styling | Tailwind CSS + Radix UI + shadcn/ui |
| State management | Zustand + TanStack Query |
| Real-time | WebSocket (gateway connection + browser updates) |
| Database | SQLite via Drizzle ORM (`~/.mission-control/db.sqlite`) |
| i18n | next-intl (zh-TW / zh-CN / en) |
| Terminal | node-pty + xterm.js |
| Animation | Framer Motion |
| Rich text | TipTap |
| Calendar | FullCalendar |
| Drag and drop | @dnd-kit |

---

## Install and Run

```bash
# Install dependencies
npm install

# Start the dev server (port 3737)
npm run dev
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Build the production bundle |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Watch-mode unit tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Open Playwright UI mode |
| `npm run db:generate` | Generate database migration |
| `npm run db:migrate` | Apply database migration |
| `npm run db:studio` | Open Drizzle Studio |

---

## Testing

Two layers — see `tests/README.md` for full details.

### Unit tests (Vitest, safe everywhere)

Pure logic tests with all external dependencies mocked, ~1 s to complete. Located at `tests/unit/*.test.ts`.

```bash
npm test              # one-shot
npm run test:watch    # auto-rerun on changes
```

### E2E tests (Playwright, requires throwaway environment)

Exercises the real install/uninstall flow and mutates the system (apt, dpkg, systemd) — **do not run on production or daily-use machines**. Use a disposable VPS / LXC / VM snapshot.

```bash
# First time: install chromium
npx playwright install chromium

# Run against the target host
PLAYWRIGHT_BASE_URL=http://<target-host>:3737 \
  AUTH_PASSWORD=<dashboard-password> \
  npm run test:e2e
```

Test files live under `tests/e2e/*.spec.ts`, one spec per setup flow.

---

## Configuration

### Environment variables (`.env.local`, generated on first launch)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3737` |
| `HOST` | Bind address | `0.0.0.0` |
| `AUTH_PASSWORD` | Login password | Set on first launch |
| `AUTH_SECRET` | Session signing secret | Auto-generated |
| `OPENCLAW_TOKEN` | OpenClaw gateway token | Auto-detected from `~/.openclaw/openclaw.json` |
| `OPENCLAW_GATEWAY_WS` | Gateway WebSocket URL | `ws://127.0.0.1:18789` |
| `OPENCLAW_GATEWAY_HTTP` | Gateway HTTP URL | `http://127.0.0.1:18789` |
| `TRUST_PROXY` | Trust upstream proxy `X-Forwarded-For` (required for fail2ban) | `0` |
| `NODE_ENV` | Environment mode | `development` |

### Database settings (`settings` table, key-value)

System settings live in the SQLite `settings` table and are managed via the UI or API:

- `auth.password` / `auth.secret` — auth-related
- `gateway.token` / `gateway.ws` / `gateway.http` — gateway connection
- `browser.*` — browser settings (display, resolution, VNC port, CDP port, …)
- Morning report, Obsidian, and other modules each have their own config keys

---

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/        # Main pages (15+ routes)
│   │   ├── dashboard/      # Overview dashboard
│   │   ├── chat/           # Agent chat
│   │   ├── terminal/       # Terminal
│   │   ├── browser/        # Browser management + VNC
│   │   ├── sessions/       # Session history
│   │   ├── costs/          # Cost analysis
│   │   ├── live-feed/      # Live activity stream
│   │   ├── cron-jobs/      # Cron management
│   │   ├── morning-report/ # Morning report system
│   │   ├── second-brain/   # NotebookLM + Obsidian
│   │   ├── backup/         # Backup management
│   │   ├── docker/         # Docker management
│   │   └── settings/       # System settings
│   ├── api/                # API routes (25+ directories)
│   └── login/              # Login page
├── components/             # UI components (60+)
│   ├── layout/             # App shell, sidebar, header
│   ├── dashboard/          # Dashboard widgets
│   ├── chat/               # Chat UI
│   ├── terminal/           # Terminal components
│   ├── browser/            # Browser / VNC components
│   ├── morning-report/     # Morning report widgets
│   ├── second-brain/       # NotebookLM + Obsidian widgets
│   ├── backup/             # Backup widgets
│   ├── cron/               # Cron widgets
│   └── ui/                 # shadcn/ui primitives
├── lib/                    # Core logic
│   ├── morning-report/     # Morning report pipeline (prompt, finalize, podcast, sync)
│   ├── browser/            # Browser config and service management
│   ├── headless-vnc/       # VNC stack install and management
│   ├── second-brain/       # NotebookLM CLI + Obsidian management
│   ├── backup/             # Backup schema, scripts, cron sync
│   ├── terminal/           # Terminal session management
│   ├── openclaw.ts         # Gateway WebSocket client
│   ├── gateway-rpc.ts      # Gateway JSON-RPC
│   ├── sessions.ts         # Session reader and cost analysis
│   ├── schema.ts           # Drizzle ORM schema (15 tables)
│   └── db.ts               # Database initialization
├── store/                  # Zustand + WebSocket context
├── i18n/                   # i18n config
└── messages/               # Translation files (zh-TW, zh-CN, en)
```

---

## Database Schema

Mission Control uses SQLite + Drizzle ORM with 15 tables:

| Table | Description |
|-------|-------------|
| `settings` | System settings (key-value) |
| `tasks` | Task management |
| `contentItems` | Content management |
| `contacts` | Contacts |
| `calendarEvents` | Calendar events |
| `morningReportTopics` | Morning report topic definitions |
| `morningReportConfig` | Morning report config |
| `morningReportRuns` | Morning report run history |
| `morningReportRunTopics` | Morning report per-topic run history |
| `morningReportFormatTemplate` | Morning report format template |
| `backupDestinations` | Backup destinations |
| `backupSources` | Backup sources |
| `backupSchedules` | Backup schedules |
| `backupJobs` | Backup jobs |
| `backupLogs` | Backup execution logs |

---

## Real-time Architecture

```
OpenClaw Gateway (ws://127.0.0.1:18789)
     ↕ WebSocket + Challenge-Response Auth
Mission Control Server (server.ts)
     ↕ WebSocket (Event Relay + RPC Proxy)
Browser Client (WebSocket Context)
```

- **Gateway connection** — persistent WebSocket, auto-reconnect, challenge-response auth
- **Event relay** — gateway events broadcast in real time to every browser client
- **RPC proxy** — JSON-RPC requests forwarded to the gateway (10 s timeout)
- **Terminal WebSocket** — `/ws/terminal?sessionId=xxx`
- **VNC proxy** — `/ws/vnc-proxy?port=xxxx` (bidirectional TCP proxy)

---

## Authentication

- HMAC-SHA256 token verification (cookie-based)
- Public paths: `/login`, `/api/auth`, `/api/health`
- Localhost requests bypass auth (used by cron jobs)
- `X-Backup-Token` header authentication (used by backup scripts)

---

## i18n Support

Three languages, switchable from the top-right of the UI:

- 繁體中文 (zh-TW) — default
- 简体中文 (zh-CN)
- English (en)

---

## Health Check

```bash
curl http://localhost:3737/api/health
```

---

## Release / Deployment

Production uses a **tarball + symlink swap** model. Tarballs live on GitHub Releases, and the manifest sits at `release-manifest.json` in the repo root (served via `raw.githubusercontent.com`). Customer dashboards poll the manifest and upgrade through the UI (`/api/upgrade/apply`) when a new version appears.

### Layout

```
~/mission-control/
  current -> versions/vX.Y.Z           # Atomic-swap symlink
  versions/vX.Y.Z/                     # Extracted tarball contents
~/.mission-control/
  .env.local                           # AUTH_PASSWORD / AUTH_SECRET / OPENCLAW_TOKEN…
  data/                                # Morning report, backup, etc. (preserved across upgrades)
  logs/mission-control.log             # Dashboard stdout (systemd unit append)
  db.sqlite                            # Drizzle database (auto-created on first launch)
```

### Deployment scripts (`deploy/release/`)

| File | Purpose |
|------|---------|
| `install.sh` | First-time deploy: create directories, generate `.env.local`, render and start the systemd user unit |
| `upgrade.sh` | Subsequent version swaps: extract → swap symlink → re-render unit → `daemon-reload` → restart → verify `/api/health` → roll back on failure |
| `mission-control.service.tmpl` | systemd user unit template; `__PREFIX__` / `__STATE__` / `__NODE_BIN__` are substituted at render time |

`upgrade.sh` diffs the new and existing unit content and only runs `daemon-reload` when they differ. This makes service-template changes (e.g. `PATH`, `StandardOutput`) ship automatically on the next upgrade — no SSH-into-machine needed.

### Version naming convention

Starting with v0.3.52, every release is **paired with an openclaw version**:

```
<openclawVersion>-v<mccVersion>
e.g. 2026.6.1-v0.3.53
```

This combined string appears in the GitHub release tag / title, `release-manifest.json` `latest.version`, `/api/health` `version`, and the dashboard sidebar.

**The pairing is a fact, not metadata: "this MCC tarball passed the full Playwright E2E on a throwaway box running that openclaw version."**

**Prefix is sticky, suffix is free:**

| Case | Throwaway E2E required? | How to build |
|------|-------------------------|--------------|
| MCC-only change (bug fix / small feature) — prefix unchanged | ❌ No | `npm run build:release` (prefix sticks from manifest) |
| Openclaw prefix bump — claiming a new pairing | ✅ Yes, must be green | `MCC_OPENCLAW_VERSION=<new> npm run build:release` |

`build-release.mjs` resolution precedence:
1. `MCC_OPENCLAW_VERSION` env override (operator attestation — fresh E2E pass)
2. `release-manifest.json`'s `latest.openclawVersion` (sticky — reuse last validated pairing)
3. Local `openclaw --version` (first-time setup before any manifest exists)
4. Unpaired — display falls back to `v0.3.53`

`/api/health` exposes the breakdown so clients can pick the right field:
```json
{
  "version": "2026.6.1-v0.3.53",   // combined display string
  "mccVersion": "0.3.53",          // pure semver — use for upgrade comparison
  "openclawVersion": "2026.6.1"    // paired openclaw
}
```

Upgrade comparison uses `mccVersion` only — splitting the combined string with `split('.')` would smash the openclaw prefix.

### Release workflow

#### MCC-only patch (common: bug fix / small feature, prefix unchanged)

```bash
# 1. Clean main + bump semver
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. Build (prefix auto-sticks from manifest)
systemctl --user stop mission-control
npm run build:release

# 3. Publish
MCC_NOTES="- fixed X" npm run publish:release

# 4. Restart dev
systemctl --user start mission-control
```

#### Openclaw prefix bump (rare: claiming a new pairing)

Requires a full throwaway E2E pass first — without it, the pairing claim would be a lie.

```bash
# 1. Clean main + bump semver
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. Read the throwaway's openclaw version and build paired
systemctl --user stop mission-control
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
OC_VER="$(ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version' | sed -En 's/OpenClaw ([0-9.]+).*/\1/p')"
MCC_OPENCLAW_VERSION="$OC_VER" npm run build:release

# 3. Push tarball to throwaway + upgrade + full E2E (must be green to proceed)
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e

# 4. Only after E2E green: publish
MCC_NOTES="- bumped openclaw to X and validated" npm run publish:release

# 5. Restart dev
systemctl --user start mission-control
```

`publish:release` will:
1. Read `openclawVersion` from the tarball's `version.json` (or env override) and assemble the GitHub release tag (`2026.6.1-v0.3.53`)
2. Compute sha256 / size and update `release-manifest.json` (combined `latest.version` plus separate `mccVersion` / `openclawVersion`; rotate prior entry into `history[]`)
3. `gh release create|upload <tag> dist/*.tar.gz` (requires `gh` CLI logged in)
4. `git add release-manifest.json && git commit && git push origin HEAD`

Environment variables: `MCC_REPO` (defaults to the parsed git remote), `MCC_OPENCLAW_VERSION` (override the paired openclaw version), `MCC_NO_GH=1` to skip the GitHub upload, `MCC_NO_PUSH=1` to skip the git push.

Public manifest URL: `https://raw.githubusercontent.com/<owner>/<repo>/main/release-manifest.json`.

Full procedure plus troubleshooting in `.claude/skills/release/SKILL.md`; the rationale for E2E as a release gate lives in `tests/README.md`.

### fail2ban Integration (optional)

Failed `/api/auth` logins write `[mc-auth] failed login from <ip>` to the log for fail2ban to match. Configuration templates live in `deploy/fail2ban/` (the jail is `mission-control.conf.tmpl`, with the log path placeholder `__LOGPATH__`); see `deploy/fail2ban/README.md` for details. When running behind a proxy / tunnel, set `TRUST_PROXY=1` in `.env.local` so the real client IP is recorded.

---

## Recent major changes

> Full history is in `git log` or GitHub Releases; this section lists only the changes that touch user-facing behaviour or release semantics.

### 2026.6.1-v0.3.53 (2026-06-04) — openclaw upgrade now syncs plugins
- **The dashboard's "Update OpenClaw" quick action now runs `openclaw update --yes`** instead of `npm install -g openclaw@latest` + `openclaw doctor --fix`. The old flow only updated the host package, leaving externally-installed plugins (e.g. `@openclaw/codex`) pinned to their old nested openclaw and breaking with `ERR_PACKAGE_PATH_NOT_EXPORTED` when their code reached for a subpath the new host openclaw didn't export. `openclaw update` runs the bundled "plugin update sync after core update" step, fixing host + plugins in one shot
- If your morning-report topics on `codex/gpt-5.5` keep failing, this is most likely it — click upgrade once in the dashboard

### 2026.6.1-v0.3.52 (2026-06-04) — release paired with openclaw version
- **New paired version format `<openclawVersion>-v<mccVersion>`** (e.g. `2026.6.1-v0.3.53`), surfacing in the GitHub release tag / title, `release-manifest.json`, `/api/health`, and the dashboard sidebar
- The pairing is a **fact, not metadata**: the tarball has passed the full Playwright E2E on a throwaway box running the openclaw version in the prefix
- **Prefix sticky, suffix free**: MCC-only patches don't re-run E2E (prefix auto-inherits from `release-manifest.json`); only openclaw prefix bumps need a fresh throwaway E2E pass (set `MCC_OPENCLAW_VERSION=<new>` to attest)
- `/api/health` adds `mccVersion` and `openclawVersion` fields. Upgrade comparison switched to `mccVersion` (pure semver) so the openclaw prefix doesn't break per-segment `split('.')`
- See "Version naming convention" above plus `.claude/skills/release/SKILL.md`

### 2026.6.1-v0.3.51 (2026-06-04) — openclaw 2026.6.1 compatibility
- **openclaw 2026.6.1 started writing its Doctor warnings box to stdout** → MCC's `JSON.parse` blew up in `/api/openclaw/models`, `/api/openclaw/auth`, etc., leaving the LLM management dropdown empty
- Fix: every openclaw spawn now passes `--log-level silent --no-color`, and JSON parsing strips any non-JSON prefix so future upstream banners can't break us again

### v0.3.50 (2026-06-04) — bundle morning-report default templates outside `data/`
- Moved `data/morning-report/default-templates/` into `assets/` in the release tarball. `install.sh`'s `ln -sf $STATE/data` symlink used to clobber the bundled templates and fresh installs threw `ENOENT _format.md`

### v0.3.49 (2026-06-03) — quick-action cleanup
- Removed 5 unused dashboard buttons: Disk Cleanup, Restart Claude Tmux, Usage Scrape, Git GC All, Kill Tmux Sessions (with their backend dead code + i18n keys)

### v0.3.41 → v0.3.48 (2026-06-03) — LLM management page
- New `/llm-auth` page combining:
  - **Auth profiles** for 8 providers (OpenAI Codex / Anthropic / Z.ai / Kimi / Google / MiniMax / MiniMax CN / DeepSeek), OAuth device-code + API key login methods, copy-profile-to-other-agents support
  - **Models tab**: global defaults + per-agent overrides; primary model / fallbacks / aliases all editable from the UI with optimistic updates
- E2E spec `tests/e2e/llm-auth-kimi.spec.ts` now covers add-key → set-override → chat as part of the release gate

---

## Acknowledgements

Inspired in part by [tugcantopaloglu/openclaw-dashboard](https://github.com/tugcantopaloglu/openclaw-dashboard).

Mission Control stands on the shoulders of many open-source projects. The list below covers external tools that the dashboard directly wraps, installs, or depends on (npm packages live in `package.json`):

**Agent / AI foundation**
- [OpenClaw](https://openclaw.ai/) — the core agent runtime; everything from RPC and event streams to cron and skills rides on top of it
- [jacob-bd/notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) — NotebookLM integration (`nlm` CLI)
- [mem0ai/mem0](https://github.com/mem0ai/mem0) — customer-service long-term memory
- [Qdrant](https://qdrant.tech/) + [Ollama](https://ollama.com/) (`bge-m3`) — self-hosted vector / embedding backend for mem0

**Morning report / podcast**
- [edge-tts](https://github.com/rany2/edge-tts) — Microsoft Edge TTS speech synthesis
- [FFmpeg](https://ffmpeg.org/) — podcast audio assembly

**Headless desktop / browser**
- [noVNC](https://novnc.com/) — in-browser VNC client (upstream files vendored under `src/lib/novnc/`)
- [Xvfb](https://en.wikipedia.org/wiki/Xvfb) + [Openbox](http://openbox.org/) + [x11vnc](https://github.com/LibVNC/x11vnc) + [websockify](https://github.com/novnc/websockify) - headless display stack
- [Chromium](https://www.chromium.org/) headless — browser automation
- [@jackwener/opencli](https://github.com/jackwener/opencli) — OpenCLI Chrome extension + daemon; the dashboard drives Chrome automation / capture flows through it

**Second brain**
- [Obsidian](https://obsidian.md/) — personal knowledge base
- [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) — CouchDB-backed cross-device sync plugin

**Setup integrations**
- [Tailscale](https://tailscale.com/) — private-network access (first-run wizard)
- [ImunifyAV](https://www.imunify.com/imunifyav/) — malware scan (first-run wizard)

The full npm dependency list lives in `package.json`.

---

## Disclaimer

This project is provided **as is** (the Apache-2.0 license already covers the legal disclaimer). It is maintained by a single developer in their spare time:

- ❌ **No commercial support or SLA** — no guaranteed response time on issues or pull requests
- ⚠️ **APIs may break during the 0.x line** — read release notes before upgrading
- 🛠️ **Not certified production-ready** — evaluate carefully before deploying to a production environment
- 🐧 **Developed and tested only on Ubuntu Linux** — other operating systems require your own porting effort
- 💬 Issues and PRs are welcome, but review speed and merge decisions are not guaranteed

If you want to use this code commercially or need customization, forking is more practical than waiting on upstream changes.

---

## License

Licensed under the [Apache License 2.0](LICENSE). See `NOTICE` for attribution.

---

Built by [遠振資訊 / YJ-Software](https://github.com/YJ-Software).
