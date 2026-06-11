# Mission Control Center


<!-- AUTO-PACKAGE-BADGES:START -->

<!-- AUTO-PACKAGE-BADGES:END -->
繁體中文 | [English](README.en.md)

OpenClaw 任務控制面板 — 集中管理 AI Agent、任務排程、日報產出、備份、瀏覽器自動化與多項營運功能的儀表板系統。

---

## 為什麼是這個 dashboard

Mission Control 是 **為遠端 VPS / headless Linux server 量身打造**，不是 local desktop 工具。從這個前提衍生出的設計：

- 🌐 **瀏覽器內直接操作伺服器** — 終端機（xterm.js + node-pty）、Chrome（headless + noVNC）、Docker、systemd unit 全部走 dashboard，不用 SSH 客戶端、不用 X11 forwarding，OpenCLI 瀏覽器自動化
- 🖥️ **Headless Chrome + VNC** — 在 server 上跑真正的瀏覽器（Xvfb + Openbox + x11vnc + websockify），瀏覽器內 VNC 看畫面，CDP port 9222 給自動化腳本接，登入狀態 / cookie 都留在 server 上
- 📅 **晨報、備份、cron 都是 server-resident** — 跑在 VPS 上 24/7，不卡你的 local 電腦，也不會因為你關電腦而中斷
- 🔒 **走 Tailscale 私網最舒服** — 一台 throwaway VPS + Tailscale，從任何裝置（手機、平板、別人的電腦）都能像本機一樣存取
- **第二大腦 Obsidian / Notebooklm** - 你還在付費給 Notion/Evernote? UI 一鍵安裝 Obsidian + Self-hosted LiveSync +  local CouchDB server(docker) 讓 Agent 瞬間成為你的雲端大腦，同步你電腦/手機上的 Obsidian：免費！
- **支援 fail2ban** - 避免被密碼暴力破解

---

## 快速試玩

```bash
git clone https://github.com/YJ-Software/mission-control-center.git
cd mission-control-center
npm install
npm run dev
```

開瀏覽器到 `http://{tailscale_內網_ip}:3737`。第一次啟動會自動產生 `.env.local`，初始登入密碼會印在 console。

**前置需求：**
- Node.js 24+
- 平台：**只在 Ubuntu Linux 上開發測試**。macOS / Windows / 其他 Linux 發行版未驗證，部分功能（systemd user unit、headless Chrome + VNC、apt-based 安裝流程）會直接失敗
- 完整功能（Agent 對話、Live Feed、Cron 同步…）需要 OpenClaw 在本機 `ws://127.0.0.1:18789` 跑著
- 可選：Python 3.10+ 與 [uv](https://github.com/astral-sh/uv) — 只在你想用 `deploy/mcp/` 底下的 OpenClaw MCP 服務（客服 handoff / mem0 客戶記憶等）時才需要
- 後續一些套件部署流程可能要 sudo 權限，我自己測試時會開免密碼 sudo，你們自己斟酌是否要開

正式部署（systemd unit + tarball），一行安裝：

```bash
curl -fsSL https://raw.githubusercontent.com/YJ-Software/mission-control-center/main/install.sh | bash
```

腳本會抓 `release-manifest.json`、下載對應 tarball、驗證 sha256，然後幫你跑 `install.sh` 建好 `~/mission-control/` 目錄結構與 systemd user unit。詳見下方 Release / 部署 章節。

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
- **目的地管理** — 支援 FTP、local 兩種目的地（S3、rsync coming soon）
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

一整套 LINE Bot AI 客服的後台 — 不只跑 agent，operator 隨時能接手、看到 agent 內部過程、保證對話記憶累積。完整流程在 dashboard 內，不必開 SSH 看 log。

#### 對話介面（Conversations）
- **客戶清單** — 顯示 LINE displayName + 頭像（不是難讀的 userId），未讀標記、最近一句預覽
- **operator 接手** — 一鍵切換「agent 回應中／我接手」，接手會自動暫停 agent 30 分鐘（送任何訊息都會 reset 倒數）
- **訊息類型完整支援**
  - 入站：text / image / video / audio / file / sticker（sticker 從 LINE CDN 渲染真實貼圖圖片）
  - 出站：text / image / file（自動產 `📎 檔名 + 公開 URL`，LINE 沒有原生 file 訊息）/ sticker
- **Sticker picker** — 對話框 😊 按鈕，5 個 LINE 官方免費包共 ~180 個貼圖 grid，點圖即送
- **Quick Reply 按鈕** — 每則訊息可附最多 13 個快速回覆 chip（LINE 上限）
- **AI 自動建議 Quick Reply** — 邊打字邊用 LLM 生 N 個客戶可能想點的回應（debounce 400ms，可在 Settings 設定數量 1–13）
- **接手 catch-up** — 解除 pause 時自動掃 pause 期間對話，丟給 LLM 萃取「值得長期記憶的客戶事實」並寫入 mem0，操作員不必手動整理
- **Agent 時間軸 drawer** — 對話頁右上一鍵打開：列出該客戶所有 agent session、每個 session 完整事件流（user msg / thinking / tool call / tool result / agent text），自動標記 `✅ 已送達 LINE` 或 `⚠️ 未送達`（偵測 openclaw 中途插話訊息被吞掉這種 race condition）

#### 客戶長期記憶（mem0）
- **mem0 自架堆疊** — Qdrant 向量庫 + Ollama bge-m3 embedding + Gemini LLM 全部自架，免外部 API 依賴
- **記憶瀏覽器** — Settings 下可瀏覽每位客戶累積的 facts，以 LINE displayName 分群，可手動編輯／刪除
- **customer-id-injector plugin** — 自動建立客戶 entity stub、把 profile 注入 system prompt、覆寫 mem0 user_id，agent 看到的永遠是該客戶專屬的記憶
- **共用 LLM 設定** — Quick Reply suggester + handoff catch-up extractor 都從 mem0 的 LLM env 借用（單一 Gemini API key），不必管多組設定

#### Settings（CS 集中設定區）
- **LINE Channel 憑證** — Channel access token / channel secret / channel ID 一鍵驗證
- **Memory Provider** — mem0 / wiki-person 切換（後者見限制）
- **Quick Reply LLM** — 共用 mem0 LLM，可調建議數量 (1–13)
- **Storage** — 媒體檔保存期限 / 容量警告閾值 / 立即清理；超過保存期限自動 tombstone（對話歷史保留、檔案內容變「[檔案已逾保存期限]」）
- **PluginConfigCard** — 業務時段、AI 暫停總開關、預設回覆訊息、套用頻道過濾
- **WikiConflictBanner** — 偵測 wiki / memory 模式衝突時顯示警示

#### Overview 統計 + 推薦
- **即時數字** — 24h 對話數 / 接手率 / 平均回覆延遲 / 客戶總數 / 媒體佔用
- **自動建議** — 偵測異常（接手率過高、儲存接近上限、profile 抓不到、保存期限設為「永不刪除」等）並給出可操作建議

#### 系統整合
- **business-hours-gate plugin** — 上班時段 / 下班時段切換、AI 暫停總開關、per-user pause 檢查、自動安裝
- **LINE async-ack patch + systemd drop-in** — 修復 LINE webhook 被 OpenClaw 同步處理導致的 timeout；drop-in 確保 `npm update -g openclaw` 後仍生效
- **Notification 中心（全 dashboard 統一）** — Storage 警告、CS 系統事件（包含「沉澱 N 條客戶記憶」）、MCC / openclaw 升級提醒，右上鈴鐺集中顯示，dedup 不洗版

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

### 版本命名規則

從 v0.3.52 起，每個 release **與一個 openclaw 版本配對**，顯示形式：

```
<openclawVersion>-v<mccVersion>
例：2026.6.1-v0.3.53
```

這個 tag 同時出現在 GitHub release tag / title、`release-manifest.json` 的 `latest.version`、`/api/health` 的 `version` 欄位，以及 dashboard 左側 sidebar。

**配對的語意：「這個 MCC tarball 在 throwaway 環境上跑過完整 Playwright E2E，搭配的 openclaw 版本就是前綴」**，所以前綴是個事實宣告，不只是 metadata。

**前綴 sticky / 後綴自由：**

| 情境 | 是否要 throwaway E2E | 怎麼跑 |
|------|---------------------|--------|
| 純 MCC 改動（bug fix、小功能） — 前綴不變 | ❌ 不用 | `npm run build:release`（前綴自動沿用 manifest 上一筆） |
| 升 openclaw 版本 — 前綴改動 | ✅ 必須跑且全綠 | `MCC_OPENCLAW_VERSION=<新版> npm run build:release` |

`build-release.mjs` 解析 openclaw 版本的優先順序：
1. `MCC_OPENCLAW_VERSION` 環境變數（operator 明確宣告剛驗證過新 openclaw）
2. `release-manifest.json` 的 `latest.openclawVersion`（sticky — 沿用上一筆驗證過的配對）
3. 本機 `openclaw --version`（首次部署、manifest 尚未存在）
4. 都拿不到 → unpaired，display 退回純 `v0.3.53`

`/api/health` 同步暴露三個欄位給 client 區分：
```json
{
  "version": "2026.6.1-v0.3.53",   // 顯示用組合字串
  "mccVersion": "0.3.53",          // 純 semver，升級比對用
  "openclawVersion": "2026.6.1"    // 配對的 openclaw
}
```

升級比對統一用 `mccVersion` — 直接拿組合字串做 `split('.')` 會把 openclaw 前綴拆爛。

### Release 發版流程

#### MCC-only patch（常見：bug fix、小功能，前綴不變）

```bash
# 1. 乾淨 main + 升 semver
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. 打包（前綴自動 sticky）
systemctl --user stop mission-control
npm run build:release

# 3. 發佈
MCC_NOTES="- 修了 X" npm run publish:release

# 4. 恢復 dev
systemctl --user start mission-control
```

#### openclaw prefix 升版（rare：要升 openclaw 配對）

需要先在 throwaway 上完整 E2E 過再發版，否則配對宣告就是說謊。

```bash
# 1. 乾淨 main + 升 semver
git status && git branch --show-current
npm version patch
git push --follow-tags

# 2. 讀 throwaway 跑的 openclaw 版本，並用它打包
systemctl --user stop mission-control
source <(grep -v '^#' .env.e2e.local | grep -v '^$')
OC_VER="$(ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw /home/openclaw/.npm-global/bin/openclaw --version' | sed -En 's/OpenClaw ([0-9.]+).*/\1/p')"
MCC_OPENCLAW_VERSION="$OC_VER" npm run build:release

# 3. 推 tarball 到 throwaway + 升級 + 全套 E2E（必須全綠才能進下一步）
scp dist/mission-control-v*.tar.gz $E2E_SSH_USER@$E2E_SSH_HOST:/tmp/
ssh $E2E_SSH_USER@$E2E_SSH_HOST 'sudo -u openclaw bash /home/openclaw/mission-control/current/install/upgrade.sh /tmp/mission-control-v*.tar.gz'
PLAYWRIGHT_BASE_URL=http://$E2E_SSH_HOST:3737 AUTH_PASSWORD=$AUTH_PASSWORD npm run test:e2e

# 4. E2E 通過才能發版
MCC_NOTES="- 升 openclaw 至 X 並驗證" npm run publish:release

# 5. 恢復 dev
systemctl --user start mission-control
```

`publish:release` 預設會：
1. 從 tarball 內 `version.json` 讀 `openclawVersion`（或環境變數覆寫），組合成 GitHub release tag（`2026.6.1-v0.3.53`）
2. 算 sha256 / size，更新 `release-manifest.json`（`latest.version` 為組合字串，另存 `mccVersion` + `openclawVersion`，舊版進 `history[]`）
3. `gh release create|upload <tag> dist/*.tar.gz`（需要 `gh` CLI 已登入）
4. `git add release-manifest.json && git commit && git push origin HEAD`

環境變數：`MCC_REPO`（預設從 git remote 解析）、`MCC_OPENCLAW_VERSION`（覆寫配對的 openclaw 版本）、`MCC_NO_GH=1` skip GitHub upload、`MCC_NO_PUSH=1` skip git push。

Manifest 公開網址：`https://raw.githubusercontent.com/<owner>/<repo>/main/release-manifest.json`。

完整步驟與排錯指引在 `.claude/skills/release/SKILL.md`；E2E 為什麼是 release gate 的解釋在 `tests/README.md`。

### fail2ban 整合（optional）

`/api/auth` 失敗登入會寫 `[mc-auth] failed login from <ip>` 到 log，供 fail2ban 比對。設定檔模板在 `deploy/fail2ban/`（jail 是 `mission-control.conf.tmpl`，log 路徑以 `__LOGPATH__` 佔位），詳見 `deploy/fail2ban/README.md`。若走 proxy/tunnel，要在 `.env.local` 加 `TRUST_PROXY=1`，才能拿到真實客戶端 IP。

---

## 近期重大更新

> 完整 commit 紀錄請看 `git log` 或 GitHub Releases；以下只列影響使用者操作或語意的關鍵變動。

### 2026.6.1-v0.3.53（2026-06-04）— 升 openclaw 帶 plugin sync
- **dashboard 的「Update OpenClaw」按鈕改跑 `openclaw update --yes`**，原本只跑 `npm install -g openclaw@latest` + `openclaw doctor --fix`，會把外掛 plugin（如 `@openclaw/codex`）留在舊版的 nested openclaw → 升完 host 後跑 codex 模型噴 `ERR_PACKAGE_PATH_NOT_EXPORTED`。`openclaw update` 內建「plugin update sync after core update」，一指令搞定 host + 所有 plugin
- 若你的晨報主題選 `codex/gpt-5.5` 一直失敗，多半就是這個 — 在 dashboard 點一次升級即可

### 2026.6.1-v0.3.52（2026-06-04）— release 與 openclaw 版本配對
- **新增配對版本格式 `<openclawVersion>-v<mccVersion>`**（例：`2026.6.1-v0.3.53`），同步出現在 GitHub release tag / title、`release-manifest.json`、`/api/health`、dashboard sidebar
- 配對的意義：tarball **在 throwaway 跑過 Playwright E2E 全綠**，配對的 openclaw 版本就是前綴 → 是個事實宣告而非裝飾
- 前綴 sticky / 後綴自由：純 MCC 修補不用重跑 E2E，前綴自動沿用 `release-manifest.json` 的上一筆；換 openclaw 配對才要重跑 E2E（用 `MCC_OPENCLAW_VERSION=<新版>` 宣告）
- `/api/health` 多了 `mccVersion` 與 `openclawVersion` 兩個欄位，升級比對改用 `mccVersion`（純 semver），避免 openclaw 前綴搞壞 `split('.')` 排序
- 詳見上面「版本命名規則」與 `.claude/skills/release/SKILL.md`

### 2026.6.1-v0.3.51（2026-06-04）— openclaw 2026.6.1 兼容
- **openclaw 2026.6.1 開始把 Doctor warnings 框寫到 stdout** → MCC 的 `JSON.parse` 在 `/api/openclaw/models`、`/api/openclaw/auth` 等路由噴錯，導致 LLM 管理頁面模型下拉選空白
- 修法：openclaw spawn 全面加 `--log-level silent --no-color`，並在 JSON 解析前剝掉非 JSON 前綴（防止上游又把 banner 寫到 stdout）

### v0.3.50（2026-06-04）— release tarball 包 morning-report 預設模板
- `data/morning-report/default-templates/` 的預設模板搬到 `assets/`，避開 `install.sh` 的 `ln -sf $STATE/data` 把模板 symlink 蓋掉的問題（過去 fresh install 會噴 `ENOENT _format.md`）

### v0.3.49（2026-06-03）— Dashboard 快速操作精簡
- 移除 5 個 unused 按鈕：Disk Cleanup / Restart Claude Tmux / Usage Scrape / Git GC All / Kill Tmux Sessions（含後端 dead code + i18n key）

### v0.3.41 → v0.3.48（2026-06-03）— LLM 管理頁面
- 新增 `/llm-auth` 頁，整合：
  - **Auth profiles**：8 個 provider（OpenAI Codex / Anthropic / Z.ai / Kimi / Google / MiniMax / MiniMax CN / DeepSeek）、OAuth device-code 與 API key 兩種登入方式，支援複製到其他 agent
  - **Models 分頁**：全域預設 + per-agent override，模型 / 備用模型 / Alias 全部走 UI，optimistic update 即時回顯
- E2E spec `tests/e2e/llm-auth-kimi.spec.ts` 把 add-key → set-override → chat 全流程包進 release gate

---

## 致謝

部分靈感來自 [tugcantopaloglu/openclaw-dashboard](https://github.com/tugcantopaloglu/openclaw-dashboard)。

Mission Control 站在許多開源專案肩上。以下整理 dashboard 直接 wrap、安裝或依賴的外部工具（不含 `package.json` 內的 npm 套件）：

**Agent / AI 基礎**
- [OpenClaw](https://openclaw.ai/) — 核心 agent runtime，dashboard 的 RPC、event stream、cron、skill 等都靠它
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
- [@jackwener/opencli](https://github.com/jackwener/opencli) — OpenCLI Chrome extension + daemon，dashboard 的 browser 自動化 / capture 流程透過它操作 Chrome

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
