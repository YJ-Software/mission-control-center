# Mission Control Center

繁體中文 | [English](README.en.md)

OpenClaw 任務控制面板 — 集中管理 AI Agent 團隊、任務排程、日報產出、備份、瀏覽器自動化與多項營運功能的儀表板系統。

---

## 快速試玩

```bash
git clone https://github.com/YJ-Software/mission-control-center.git
cd mission-control-center
npm install
npm run dev
```

開瀏覽器到 `http://localhost:3737`。第一次啟動會自動產生 `.env.local`，初始登入密碼會印在 console。

**前置需求：**
- Node.js 24+
- 平台：**只在 Ubuntu Linux 上開發測試**。macOS / Windows / 其他 Linux 發行版未驗證，部分功能（systemd user unit、headless Chrome + VNC、apt-based 安裝流程）會直接失敗
- 完整功能（Agent 對話、Live Feed、Cron 同步…）需要 OpenClaw 在本機 `ws://127.0.0.1:18789` 跑著
- 可選：Python 3.10+ 與 [uv](https://github.com/astral-sh/uv) — 只在你想用 `deploy/mcp/` 底下的 OpenClaw MCP 服務（客服 handoff / mem0 客戶記憶等）時才需要

正式部署（systemd unit + tarball）：下載 [release tarball](https://github.com/YJ-Software/mission-control-center/releases/latest) 後執行 `deploy/release/install.sh`，詳見下方 Release / 部署 章節。

> 🔒 **強烈建議走 [Tailscale](https://tailscale.com/) 等私網存取**，不要把 dashboard 直接暴露到公網 IP。系統含終端機、Docker 控制、瀏覽器自動化等高權限功能，被未授權存取後果嚴重。如果一定要走公網，至少要：強密碼 + fail2ban + reverse proxy + TLS。

---

## 功能總覽

### 儀表板
- 系統健康狀態（CPU、記憶體、磁碟）
- 服務狀態監控（OpenClaw、Tailscale）
- 每日花費圖表
- 快速操作（重啟服務、清除快取）
- 近期活動紀錄
- 即將執行的 Cron 排程預覽

### AI Agent 管理
- **Agent 團隊** — 列出所有 Agent、角色分類（operators / developers / researchers）、即時狀態
- **Chat** — 與 Agent 即時對話，支援串流回應與工具呼叫追蹤
- **Sessions** — 檢視歷史工作階段，含逐筆對話、工具使用、模型成本分析
- **Live Feed** — 即時監控 Agent 思考過程、工具呼叫、輸出結果
- **費用分析** — 依模型 / 日期 / Session 統計花費

### 晨報系統（Morning Report）
- **主題管理** — 自訂晨報主題（名稱、emoji、模板、排程時間、模型、投遞方式）
- **格式模板** — 統一 HTML 格式模板，支援變數替換（`${TODAY}`、`${LANGUAGE}` 等）
- **URL 去重** — 自動讀取前一天報告中的 URL，避免重複引用
- **執行管線** — generate-prompts → 各主題執行 → finalize（合併 + HTML 轉換）→ podcast
- **Podcast 生成** — edge-tts 語音合成 + ffmpeg 音訊合併，支援段落切分與 Agent 潤稿
- **Cron 同步** — 主題自動同步為 OpenClaw cron jobs（`mr-*` 前綴）
- **公開發佈** — 可設定 public tunnel 對外提供晨報與 Podcast 存取
- **Obsidian 匯出** — 完成後自動匯出至指定 Obsidian vault

### Cron 排程管理
- 完整 CRUD（建立、讀取、更新、刪除）
- 支援三種排程方式：cron 表達式、一次性 `at`、間隔 `every`
- 支援兩種執行模式：`main`（系統事件）、`isolated`（獨立 agent）
- 支援多種投遞方式：`announce`（頻道通知）、`webhook`、`none`
- 手動觸發執行、執行歷史查詢
- 每個 job 可設定 timezone、timeout、model override、thinking mode

### 備份系統（Backup）
- **來源管理** — 定義要備份的目錄 / 檔案路徑
- **目的地管理** — 支援 S3、rsync、local 三種目的地
- **排程管理** — daily / weekly / monthly / custom cron
- **Job 管理** — 組合來源 + 目的地 + 排程，設定保留份數
- **執行紀錄** — 完整的備份歷史、檔案大小、錯誤訊息
- **還原功能** — 從備份路徑還原
- **API Token 認證** — 支援 `X-Backup-Token` 外部呼叫

### 第二大腦（Second Brain）
- **NotebookLM 整合** — 登入管理、筆記本 CRUD、來源管理、AI 對話、研究功能、Studio 工件（wrap `notebooklm-mcp-cli` 的 `nlm` 指令，詳見「致謝」）
- **Obsidian 整合** — Headless 安裝（Xvfb + Openbox + x11vnc + websockify）、VNC 遠端存取、CouchDB LiveSync 同步
- **Capture Skills** — 兩個可安裝的 OpenClaw 全域 skill，模板內已寫死你的 vault 絕對路徑
  - `link-capture` — URL-only 訊息自動抓取、摘要、評分，存入 `{vault}/raw/`
  - `youtube-transcript` — 字幕/Whisper async 轉錄；摘要寫入 `{vault}/raw/`、完整逐字稿寫入 `{vault}/transcripts/`
  - 安裝位置：`~/.agents/skills/{name}/`（OpenClaw 標準全域路徑）

### 瀏覽器自動化（Browser）
- **Headless Chrome** — 自動偵測與安裝 Chrome + Xvfb + Openbox + x11vnc + websockify
- **VNC 存取** — 透過 noVNC 在瀏覽器內操作遠端桌面
- **Chrome DevTools Protocol** — CDP port 9222 供自動化腳本使用
- **服務管理** — systemd user services，可啟動 / 停止 / 查看 logs
- **OpenClaw CLI 整合** — 自動安裝與管理 OpenClaw CLI

### 終端機（Terminal）
- 多分頁終端機（最多 5 個）
- xterm.js 終端模擬器 + WebSocket 串流
- 浮動視窗模式
- 敏感資訊（密碼、token）自動過濾

### Docker 管理
- 列出 containers 和 images
- 啟動 / 停止 / 重啟 container
- 清理未使用的 containers / images
- 磁碟使用量檢視

### LINE 客服 Ops（Customer Service）
- **時段控制** — 上班 / 下班時段切換、AI 暫停總開關、business-hours-gate plugin 自動安裝
- **客戶長期記憶** — mem0（自架 Qdrant + Ollama bge-m3 + Gemini，可用）vs wiki-person（OpenClaw 4.29 暫不可用，見下方限制）
- **customer-id-injector plugin** — 自動建立客戶 entity stub、把 profile 注入 prompt、覆寫 mem0 user_id
- **LINE async-ack patch + systemd drop-in** — 修復 LINE webhook 被 OpenClaw 同步處理導致的 timeout，drop-in 確保 `npm update -g openclaw` 後仍生效

> ⚠️ wiki-person 模式在 OpenClaw 4.29 無法運作：plugin 透過 `api.registerTool` 註冊的 `wiki_apply` / `wiki_get` 等工具不會暴露給 agent 模型，agent 看不到。預設走 mem0，wiki-person UI 為 scaffolding，等 OpenClaw 補上 plugin tool 暴露機制再啟用。

### 其他功能模組
- **任務管理（Tasks）** — 待辦事項追蹤（todo / in-progress / done）、優先度、指派、專案、到期日
- **聯絡人（Contacts）** — 聯絡人資料庫（角色、handle、時區、備註）
- **行事曆（Calendar）** — 事件管理，可與 Google Calendar 同步
- **內容管理（Content）** — 內容排程與發佈追蹤（idea → draft → published）
- **系統設定（Settings）** — 密碼、Gateway Token、偏好設定
- **設定精靈（Setup）** — 首次安裝引導（Tailscale、搜尋引擎、NotebookLM）

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 框架 | Next.js 16 (App Router) + 自訂 Server (`tsx server.ts`) |
| 樣式 | Tailwind CSS + Radix UI + shadcn/ui |
| 狀態管理 | Zustand + TanStack Query |
| 即時通訊 | WebSocket（Gateway 連線 + 瀏覽器即時更新） |
| 資料庫 | SQLite via Drizzle ORM（`~/.mission-control/db.sqlite`） |
| 多語系 | next-intl（zh-TW / zh-CN / en） |
| 終端機 | node-pty + xterm.js |
| 動畫 | Framer Motion |
| 富文字編輯 | TipTap |
| 行事曆 | FullCalendar |
| 拖放 | @dnd-kit |

---

## 安裝與啟動

```bash
# 安裝依賴
npm install

# 啟動開發伺服器 (port 3737)
npm run dev
```

## 可用指令

| 指令 | 說明 |
|------|------|
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | 建置生產版本 |
| `npm run start` | 啟動生產伺服器 |
| `npm run lint` | 執行 ESLint 檢查 |
| `npm test` | 執行 Vitest 單元測試 |
| `npm run test:watch` | 單元測試 watch 模式 |
| `npm run test:e2e` | 執行 Playwright E2E 測試 |
| `npm run test:e2e:ui` | 開啟 Playwright UI 模式 |
| `npm run db:generate` | 產生資料庫 migration |
| `npm run db:migrate` | 執行資料庫 migration |
| `npm run db:studio` | 開啟 Drizzle Studio |

---

## 測試

分兩層，看 `tests/README.md` 有詳細說明。

### 單元測試（Vitest，任何環境都可跑）

純邏輯測試，外部依賴全 mock，~1 秒跑完。放在 `tests/unit/*.test.ts`。

```bash
npm test              # 單次跑完
npm run test:watch    # 檔案變動自動重跑
```

### E2E 測試（Playwright，需要 throwaway 環境）

打真實的 install/uninstall 流程，會污染系統（apt、dpkg、systemd）— **不要在生產或日常開發環境跑**。推薦在一次性 VPS / LXC / VM snapshot 上執行。

```bash
# 首次：安裝 chromium
npx playwright install chromium

# 對目標環境執行
PLAYWRIGHT_BASE_URL=http://<目標 host>:3737 \
  AUTH_PASSWORD=<儀表板密碼> \
  npm run test:e2e
```

測試檔位置：`tests/e2e/*.spec.ts`，每個 setup 流程一個 spec。

---

## 設定項目

### 環境變數（`.env.local`，首次啟動自動產生）

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 伺服器 Port | `3737` |
| `HOST` | 綁定地址 | `0.0.0.0` |
| `AUTH_PASSWORD` | 登入密碼 | 首次啟動時設定 |
| `AUTH_SECRET` | Session 簽章密鑰 | 自動產生 |
| `OPENCLAW_TOKEN` | OpenClaw Gateway Token | 自動從 `~/.openclaw/openclaw.json` 讀取 |
| `OPENCLAW_GATEWAY_WS` | Gateway WebSocket URL | `ws://127.0.0.1:18789` |
| `OPENCLAW_GATEWAY_HTTP` | Gateway HTTP URL | `http://127.0.0.1:18789` |
| `TRUST_PROXY` | 是否信任上游 proxy 的 `X-Forwarded-For`（fail2ban 需要） | `0` |
| `NODE_ENV` | 環境模式 | `development` |

### 資料庫設定（`settings` 表 key-value）

系統設定儲存於 SQLite 的 `settings` 表，透過 UI 或 API 管理：

- `auth.password` / `auth.secret` — 認證相關
- `gateway.token` / `gateway.ws` / `gateway.http` — Gateway 連線
- `browser.*` — 瀏覽器設定（display、resolution、VNC port、CDP port 等）
- 晨報、Obsidian 等模組各有專屬 config key

---

## 專案結構

```
src/
├── app/
│   ├── (dashboard)/        # 主要頁面（15+ 頁面）
│   │   ├── dashboard/      # 總覽儀表板
│   │   ├── chat/           # Agent 對話
│   │   ├── terminal/       # 終端機
│   │   ├── browser/        # 瀏覽器管理 + VNC
│   │   ├── sessions/       # 工作階段歷史
│   │   ├── costs/          # 費用分析
│   │   ├── live-feed/      # 即時活動串流
│   │   ├── cron-jobs/      # 排程管理
│   │   ├── morning-report/ # 晨報系統
│   │   ├── second-brain/   # NotebookLM + Obsidian
│   │   ├── backup/         # 備份管理
│   │   ├── docker/         # Docker 管理
│   │   └── settings/       # 系統設定
│   ├── api/                # API Routes（25+ 目錄）
│   └── login/              # 登入頁
├── components/             # UI 元件（60+ 元件）
│   ├── layout/             # App Shell、Sidebar、Header
│   ├── dashboard/          # 儀表板元件
│   ├── chat/               # 對話介面
│   ├── terminal/           # 終端機元件
│   ├── browser/            # 瀏覽器 / VNC 元件
│   ├── morning-report/     # 晨報元件
│   ├── second-brain/       # NotebookLM + Obsidian 元件
│   ├── backup/             # 備份元件
│   ├── cron/               # Cron 元件
│   └── ui/                 # shadcn/ui 基礎元件
├── lib/                    # 核心邏輯
│   ├── morning-report/     # 晨報管線（prompt、finalize、podcast、sync）
│   ├── browser/            # 瀏覽器設定與服務管理
│   ├── headless-vnc/       # VNC 堆疊安裝與管理
│   ├── second-brain/       # NotebookLM CLI + Obsidian 管理
│   ├── backup/             # 備份 schema、腳本、cron 同步
│   ├── terminal/           # 終端 session 管理
│   ├── openclaw.ts         # Gateway WebSocket 客戶端
│   ├── gateway-rpc.ts      # Gateway JSON-RPC
│   ├── sessions.ts         # Session 讀取與成本分析
│   ├── schema.ts           # Drizzle ORM Schema（15 張表）
│   └── db.ts               # 資料庫初始化
├── store/                  # Zustand + WebSocket Context
├── i18n/                   # 多語系設定
└── messages/               # 翻譯檔（zh-TW、zh-CN、en）
```

---

## 資料庫 Schema

系統使用 SQLite + Drizzle ORM，共 15 張表：

| 表名 | 說明 |
|------|------|
| `settings` | 系統設定（key-value） |
| `tasks` | 任務管理 |
| `contentItems` | 內容管理 |
| `contacts` | 聯絡人 |
| `calendarEvents` | 行事曆事件 |
| `morningReportTopics` | 晨報主題定義 |
| `morningReportConfig` | 晨報設定 |
| `morningReportRuns` | 晨報執行歷史 |
| `morningReportRunTopics` | 晨報主題執行歷史 |
| `morningReportFormatTemplate` | 晨報格式模板 |
| `backupDestinations` | 備份目的地 |
| `backupSources` | 備份來源 |
| `backupSchedules` | 備份排程 |
| `backupJobs` | 備份 Job |
| `backupLogs` | 備份執行紀錄 |

---

## 即時通訊架構

```
OpenClaw Gateway (ws://127.0.0.1:18789)
     ↕ WebSocket + Challenge-Response Auth
Mission Control Server (server.ts)
     ↕ WebSocket (Event Relay + RPC Proxy)
Browser Client (WebSocket Context)
```

- **Gateway 連線** — 持久 WebSocket，自動重連，Challenge-Response 驗證
- **事件中繼** — Gateway 事件即時廣播至所有瀏覽器客戶端
- **RPC 代理** — JSON-RPC 請求轉發至 Gateway（10 秒 timeout）
- **終端 WebSocket** — `/ws/terminal?sessionId=xxx`
- **VNC 代理** — `/ws/vnc-proxy?port=xxxx`（TCP 雙向代理）

---

## 認證機制

- HMAC-SHA256 Token 驗證（Cookie based）
- 公開路徑：`/login`、`/api/auth`、`/api/health`
- Localhost 請求免認證（供 cron jobs 使用）
- `X-Backup-Token` Header 認證（供備份腳本使用）

---

## 多語系支援

支援以下語言，可於介面右上角切換：

- 繁體中文（zh-TW）— 預設
- 簡體中文（zh-CN）
- English（en）

---

## 健康檢查

```bash
curl http://localhost:3737/api/health
```

---

## Release / 部署

正式環境採 **tarball + symlink swap** 的部署模式。tarball 上 GitHub Releases，manifest 是 repo 根目錄的 `release-manifest.json`（透過 `raw.githubusercontent.com` 公開）。customer dashboard 會輪詢 manifest，看到新版就透過 UI（`/api/upgrade/apply`）自動升級。

### 目錄結構

```
~/mission-control/
  current -> versions/vX.Y.Z           # 原子切換用的 symlink
  versions/vX.Y.Z/                     # 解壓過的 tarball 內容
~/.mission-control/
  .env.local                           # AUTH_PASSWORD / AUTH_SECRET / OPENCLAW_TOKEN…
  data/                                # 晨報、備份等資料（跨版本保留）
  logs/mission-control.log             # dashboard stdout（systemd unit append）
  db.sqlite                            # Drizzle 資料庫（首次啟動自動建立）
```

### 部署腳本（`deploy/release/`）

| 檔案 | 用途 |
|------|------|
| `install.sh` | 第一次部署：建立目錄、產生 `.env.local`、渲染並啟動 systemd user unit |
| `upgrade.sh` | 後續版本切換：解壓 → 切 symlink → 重新渲染 unit → `daemon-reload` → 重啟 → `/api/health` 驗證 → 失敗回滾 |
| `mission-control.service.tmpl` | systemd user unit 模板，`__PREFIX__` / `__STATE__` / `__NODE_BIN__` 於渲染時替換 |

`upgrade.sh` 會比對新舊 unit 內容，有差才 `daemon-reload`。這讓 service template 的更動（例如 PATH、`StandardOutput`）能在下一次 upgrade 自動套用，operator 不用 SSH 手動改。

### Release 發版流程

```bash
# 1. 確認乾淨 main 分支
git status && git branch --show-current

# 2. 版號 + tag + push
npm version patch                    # 或 minor / major
git push --follow-tags

# 3. 打包（會 rm -rf .next，先停掉 dev server）
systemctl --user stop mission-control
npm run build:release                # 產出 dist/mission-control-vX.Y.Z-linux-x64.tar.gz

# 4. 發佈：上 GitHub Releases + 更新 release-manifest.json + git push
MCC_NOTES="- 修了 X" npm run publish:release

# 5. 恢復 dev
systemctl --user start mission-control
```

`publish:release` 預設會：
1. 算 sha256 / size，更新 `release-manifest.json`（舊版進 `history[]`）
2. `gh release create|upload v$VERSION dist/*.tar.gz`（需要 `gh` CLI 已登入）
3. `git add release-manifest.json && git commit && git push origin HEAD`

環境變數：`MCC_REPO`（預設從 git remote 解析）、`MCC_NO_GH=1` skip GitHub upload、`MCC_NO_PUSH=1` skip git push。

Manifest 公開網址：`https://raw.githubusercontent.com/<owner>/<repo>/main/release-manifest.json`。

### fail2ban 整合（optional）

`/api/auth` 失敗登入會寫 `[mc-auth] failed login from <ip>` 到 log，供 fail2ban 比對。設定檔模板在 `deploy/fail2ban/`（jail 是 `mission-control.conf.tmpl`，log 路徑以 `__LOGPATH__` 佔位），詳見 `deploy/fail2ban/README.md`。若走 proxy/tunnel，要在 `.env.local` 加 `TRUST_PROXY=1`，才能拿到真實客戶端 IP。

---

## 致謝

Mission Control 站在許多開源專案肩上。以下整理 dashboard 直接 wrap、安裝或依賴的外部工具（不含 `package.json` 內的 npm 套件）：

**Agent / AI 基礎**
- [OpenClaw](https://www.openclaw.tw/) — 核心 agent runtime，dashboard 的 RPC、event stream、cron、skill 等都靠它
- [jacob-bd/notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) — NotebookLM 整合（`nlm` CLI）
- [mem0ai/mem0](https://github.com/mem0ai/mem0) — 客服長期記憶
- [Qdrant](https://qdrant.tech/) + [Ollama](https://ollama.com/)（`bge-m3`） — 自架 mem0 向量 / embedding backend

**晨報 / Podcast**
- [edge-tts](https://github.com/rany2/edge-tts) — Microsoft Edge TTS 語音合成
- [FFmpeg](https://ffmpeg.org/) — Podcast 音訊合併

**Headless 桌面 / 瀏覽器**
- [noVNC](https://novnc.com/) — 瀏覽器內 VNC client（`src/lib/novnc/` 內含上游檔案）
- [Xvfb](https://en.wikipedia.org/wiki/Xvfb) + [Openbox](http://openbox.org/) + [x11vnc](http://www.karlrunge.com/x11vnc/) + [websockify](https://github.com/novnc/websockify) — headless display stack
- [Chromium](https://www.chromium.org/) headless — 瀏覽器自動化

**第二大腦**
- [Obsidian](https://obsidian.md/) — 知識管理應用
- [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) — CouchDB-backed 跨裝置同步插件

**Setup 流程整合**
- [Tailscale](https://tailscale.com/) — 私網存取（首次安裝引導）
- [ImunifyAV](https://www.imunify.com/imunifyav/) — 惡意檔案掃描（首次安裝引導）

完整 npm 依賴清單見 `package.json`。

---

## 免責聲明

本專案以 **as-is** 提供（已包含於 Apache-2.0 授權的免責條款），由個人開發者業餘維護：

- ❌ **無商業 support / SLA** — 不保證 issue / PR 的回應時間
- ⚠️ **0.x 期間 API 可能 breaking** — 升級前請看 release notes
- 🛠️ **不保證 production-ready** — 部署到正式環境前請自行評估
- 🐧 **僅在 Ubuntu Linux 上開發測試** — 其他作業系統請自行 port
- 💬 歡迎開 issue / 送 PR，但無法保證 review 速度或 merge 結果

如果你想拿這個 code 做商用、或有客製化需求，自己 fork 走比期待專案維護來得實際。

---

## License

Licensed under the [Apache License 2.0](LICENSE). See `NOTICE` for attribution.

---

Built by [遠振資訊 / YJ-Software](https://github.com/YJ-Software).
