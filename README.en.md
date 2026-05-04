# Mission Control Center

[繁體中文](README.md) | English

OpenClaw mission control dashboard — a centralized panel for managing AI agent teams, scheduled tasks, daily report generation, backups, browser automation, and other operational features.

---

## Quick Start

```bash
git clone https://github.com/YJ-Software/mission-control-center.git
cd mission-control-center
npm install
npm run dev
```

Open `http://localhost:3737` in your browser. On first launch, `.env.local` is auto-generated and the initial login password is printed to the console.

**Prerequisites:**
- Node.js 24+
- Platform: **developed and tested only on Ubuntu Linux**. macOS / Windows / other Linux distributions are unverified — some features (systemd user units, headless Chrome + VNC, apt-based installers) will fail outright on those platforms.
- Full functionality (agent chat, live feed, cron sync, …) requires OpenClaw running locally on `ws://127.0.0.1:18789`

For production deployment (systemd unit + tarball), grab the [release tarball](https://github.com/YJ-Software/mission-control-center/releases/latest) and run `deploy/release/install.sh` — see the Release / Deployment section below for details.

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
- **Destination management** — supports S3, rsync, and local destinations
- **Schedule management** — daily / weekly / monthly / custom cron
- **Job management** — combine source + destination + schedule with retention count
- **Execution history** — full backup log with file size and error messages
- **Restore** — restore from a backup path
- **API token auth** — supports `X-Backup-Token` for external invocation

### Second Brain
- **NotebookLM integration** — login management, notebook CRUD, source management, AI chat, research mode, Studio artifacts
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
- **Hours control** — on/off-hours toggle, AI master switch, business-hours-gate plugin auto-install
- **Customer long-term memory** — mem0 (self-hosted Qdrant + Ollama bge-m3 + Gemini, available) vs wiki-person (currently unavailable on OpenClaw 4.29, see limitation below)
- **customer-id-injector plugin** — auto-create customer entity stub, inject profile into prompt, override mem0 user_id
- **LINE async-ack patch + systemd drop-in** — fixes LINE webhook timeouts caused by OpenClaw's synchronous handling; the drop-in keeps the patch in place after `npm update -g openclaw`

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

### Release workflow

```bash
# 1. Confirm a clean main branch
git status && git branch --show-current

# 2. Bump version + tag + push
npm version patch                    # or minor / major
git push --follow-tags

# 3. Build (rm -rf .next; stop the dev server first)
systemctl --user stop mission-control
npm run build:release                # outputs dist/mission-control-vX.Y.Z-linux-x64.tar.gz

# 4. Publish: upload to GitHub Releases + update release-manifest.json + git push
MCC_NOTES="- fixed X" npm run publish:release

# 5. Restart dev
systemctl --user start mission-control
```

`publish:release` will:
1. Compute sha256 / size and update `release-manifest.json` (rotating the previous entry into `history[]`)
2. `gh release create|upload v$VERSION dist/*.tar.gz` (requires `gh` CLI logged in)
3. `git add release-manifest.json && git commit && git push origin HEAD`

Environment variables: `MCC_REPO` (defaults to the parsed git remote), `MCC_NO_GH=1` to skip the GitHub upload, `MCC_NO_PUSH=1` to skip the git push.

Public manifest URL: `https://raw.githubusercontent.com/<owner>/<repo>/main/release-manifest.json`.

### fail2ban Integration (optional)

Failed `/api/auth` logins write `[mc-auth] failed login from <ip>` to the log for fail2ban to match. Configuration templates live in `deploy/fail2ban/` (the jail is `mission-control.conf.tmpl`, with the log path placeholder `__LOGPATH__`); see `deploy/fail2ban/README.md` for details. When running behind a proxy / tunnel, set `TRUST_PROXY=1` in `.env.local` so the real client IP is recorded.

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
