# OCD 需求單 —— 以子網域提供客戶對話介面

（本文為 `ocd-subdomain-chat-request.md` 的中文版，內容一致。）

**我們要達成的事：** WHMCS/OCD 部署完成後，客戶打開我們給的網址就能跟自己的
agent 對話，不需要開 SSH tunnel。

現在 WHMCS 的部署成功頁是教客戶執行
`ssh -L 3737:127.0.0.1:3737 openclaw@<ip>`，跑完才看得到 Mission Control。
這就是本需求要拿掉的門檻 —— 它不是錦上添花的功能，而是
「客戶買了但必須會 SSH 才能用」與「客戶打開網址就能用」的差別。

**Mission Control 這邊幾乎不需要修改。** `HOST=0.0.0.0` 維持現狀不動。只有一項
是 MCC 側的，即下方 §9：一行設定，讓客戶連進來先看到對話視窗而不是操作主控台。
該項需要 Mission Control **2026.8.2-v0.3.85 以上**；其餘全部都是 deployer 側的
工作。

---

## 架構

```
客戶瀏覽器
  └─ https://chat-<slug>.<vendor-domain>          ← DNS A record → 客戶的 VPS
       └─ 客戶 VPS 上的 Caddy   (TLS + basic auth)
            └─ 127.0.0.1:3737  Mission Control
                 └─ 127.0.0.1:18789  客戶自己的 OpenClaw gateway
```

Caddy 跑在**客戶的 VPS 上**，不是我們的 edge。這個選擇的後果值得向決策者說明：

- 對話流量完全不經過我們的機器。我們不在資料路徑上，也不接觸對話內容。
- 不需要 tunnel、不需要 VPN，我們與客戶之間沒有需要長期維持的連線。
- 我們唯一的持續性義務是「每個客戶一筆 DNS 記錄」。

有兩層認證：Caddy 的 basic auth（由 OCD 產生的憑證），以及 Mission Control
本身的登入（`AUTH_PASSWORD`，OCD 現在就已經在產生、也已經顯示在客戶區）。

---

## OCD 需要新增的工作

### 1. 安裝並設定 Caddy

已在實際部署的 throwaway 機器上驗證（Ubuntu 24.04）：`apt-get install caddy`
安裝的是 **Caddy 2.6.2**，且機器上沒有其他 web server，80 與 443 都是空的。

Caddyfile：

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

兩個版本地雷，都已在 2.6.2 上實測。請釘住你們測試的版本，不要假設 latest：

- 指令是 **`basicauth`**（一個字）。在 2.6.2 上寫成 `basic_auth`（新版寫法）
  會被判為 `unrecognized directive`，Caddy 會直接啟動失敗。若改裝官方 repo
  的 2.7+，則相反，要用 `basic_auth`。請擇一並釘住版本。
- `caddy hash-password --plaintext '<pw>'` 在 2.6.2 可用。新版改了這個參數。

**請不要**加 `header_up Host {upstream_hostport}` —— 網路上不少 Caddy 範例會
這樣寫。它會改寫 Mission Control 看到的 Host，導致登入導向出錯。Host 與
`X-Forwarded-For` 都維持 Caddy 預設即可。

### 2. 產生 basic auth 憑證並呈現給客戶

部署時產生一組隨機密碼，bcrypt hash 寫進 Caddyfile，明文在 WHMCS 客戶區
**顯示一次**，放在你們現在已經在顯示的那些憑證旁邊即可。

客戶最終會拿到兩組憑證，都來自他現在就會看的同一頁：

- Caddy：`customer` / `<產生的密碼>`
- Mission Control 登入：你們已經在顯示的 `AUTH_PASSWORD`

### 3. 防火牆

`ufw` 目前已經是啟用且 `default deny incoming` —— 這點我們從乾淨部署的
`/var/log/ufw.log` 確認過，部署進行中的 19:13 就已經在擋掃描流量了。
需要新增兩條規則：

```
ufw allow 80,443/tcp
ufw allow in on tailscale0 to any port 3737 proto tcp
```

第二條很重要而且容易寫錯。**每個客戶跑的是他自己的 tailnet** —— 成功頁上那顆
「設定 Tailscale VPN」是把 VPS 加入*客戶的*網路，不是我們的，所以我們從來就
不在裡面。因此 `:3737` 必須用**介面**放行，不能用 IP 網段：寫成
`100.64.0.0/10` 對我們毫無用處（我們不在他們的 tailnet 裡），而且開得太寬。
此規則已用 `ufw --dry-run` 在 throwaway 上驗證，會產生
`-A ufw-user-input -i tailscale0 -p tcp --dport 3737 -j ACCEPT` 以及對應的
v6 規則。

設定完成後，`:3737` 只剩兩條路徑可達：loopback（Caddy 以及 Mission Control
自己的排程）與客戶自己的 tailnet。對公開網路仍然是關閉的，與現況相同。

### 4. 在 Mission Control 的 `.env.local` 設定 `TRUST_PROXY=1`

不設的話，所有請求在 MCC 看起來都來自 `127.0.0.1`（Caddy），登入稽核紀錄與
fail2ban 都會把嘗試歸因到 loopback 而不是真實的客戶端 IP。這個變數 Mission
Control 已經支援，只是在 Caddy 前置的情況下需要打開。

### 5. DNS

每個客戶一筆 A record：`chat-<slug>.<vendor-domain>`（`<vendor-domain>` 即我們的網域）→ 該 VPS 的 IP，部署時建立、
終止服務時移除。`<slug>` 可以用 WHMCS 的 service id，或讓客戶自選。

### 6. 服務終止與憑證更換

- 終止：移除 DNS 記錄即可，Caddy 可順手停掉。
- 更換或撤銷存取：透過 SSH 改寫 Caddyfile 裡的 hash，再 `systemctl reload caddy`。

### 7. 憑證自動續約 —— 需要持續成立的條件

Caddy 會自己申請與續約憑證，沒有東西要另外寫排程。但續約是**在 Caddy 行程內
排程的，不是 cron、也不是 systemd timer** —— 已在 throwaway 上確認：
`systemctl list-timers` 裡沒有任何 Caddy 項目。請不要去找續約的 unit，也不要
把 Caddy 當成可以長期停著的服務。Caddy 會在憑證壽命剩下約三分之一時續約，
也就是 90 天的 Let's Encrypt 憑證大約在到期前 30 天。

以下四件事必須**持續成立**，不是部署當下成立就好：

- `caddy.service` 保持 enabled 且執行中。已確認：Ubuntu 的套件預設就會
  enable，我們測試機上也是 `enabled`。這點很重要，因為 Mission Control 現在
  有重新開機按鈕，客戶是會重開機器的。
- **80 與 443 必須長期開著**，不是只在第一次簽發時開。續約會重跑 ACME 挑戰。
  請不要在拿到第一張憑證後「順手」把 80 關掉：Caddy 用它做 HTTP-01 挑戰，也用
  它做 HTTP→HTTPS 轉址。
- DNS 記錄仍然解析到那台 VPS。如果服務還在但記錄被移除，續約會失敗，然後憑證
  在大約 30 天後過期。
- `/var/lib/caddy` 要保留。帳戶金鑰與憑證存放在
  `/var/lib/caddy/.local/share/caddy`（屬主 `caddy:caddy`，權限 700）。清空或
  重灌而沒有保留它，就得重新簽發，而重新簽發會計入下面的用量限制。

**失效是無聲的。** 上述任何一項壞掉，當下都看不出異狀，要等一個月後憑證過期、
那台機器上的客戶全部看到瀏覽器安全警告才會發現。建議從外部定期檢查到期日，
例如：

```
echo | openssl s_client -connect chat-<slug>.<vendor-domain>:443 2>/dev/null | openssl x509 -noout -enddate
```

剩餘天數低於約 14 天就告警。Caddy 本身也會把續約的嘗試與失敗寫進它的 journal。

### 8. Let's Encrypt 的用量限制 —— 這是開通速度的實際上限

所有客戶都是**同一個註冊網域**底下的子網域，所以「每個註冊網域」的限制是
全部客戶共用的。依 Let's Encrypt 公布的限制：

- **New Certificates per Registered Domain：每 7 天 50 張。** 這直接限制了
  每週能開通多少新客戶 —— 滾動 7 天內的第 51 次部署會拿不到憑證。
- New Certificates per Exact Set of Identifiers：每 7 天 5 張。對同一個主機名
  重複測試時撞到的就是這條。
- Authorization Failures per Identifier per Account：每小時 5 次。設定錯誤又
  一直重試的部署，會讓該主機名被鎖一小時。

如果預期開通量會超過每週約 50 個，這件事必須事先解決，不要等撞到才處理。
可行方向：向 Let's Encrypt 申請提高限制、把客戶分散到一個以上的註冊網域，
或改用 DNS-01 簽發萬用憑證。另外 Caddy 在 Let's Encrypt 拒絕時會自動改用
ZeroSSL，這能提供一些緩衝，但不能當成計畫。

### 9. 把首頁設成對話視窗

Mission Control 現在內建了給客戶用的對話視窗 `/talk`：只有對話，以及一顆通往
完整主控台的按鈕。沒有側邊欄、沒有終端機、沒有備份面板。

這個功能**預設關閉**，所以既有的操作型安裝不受影響。部署時寫一次設定即可開啟：

```
PUT /api/settings   {"ui.landingPage":"chat"}
```

設定後 `/` 會導向 `/talk`，登入後也會落在這裡。客戶仍然可以透過「完整控制台」
按鈕進入全部功能 —— 這改變的是他**先看到什麼**，不是他**能看到什麼**。

需要 Mission Control 2026.8.2-v0.3.85 以上。舊版會直接忽略這個設定、客戶照舊
落在儀表板，所以無條件寫入是安全的。

### 10. 建議：對 Caddy 的 access log 加一條 fail2ban jail

fail2ban 已經安裝（Mission Control 裡就有它的分頁）。針對 Caddy 的 401 加一條
jail，可以給 basic auth 一些暴力破解防護 —— 它本身完全沒有這層保護。

---

## 我們驗證了什麼、沒驗證什麼

已在真實 OCD 部署的 throwaway 上驗證（Ubuntu 24.04、OpenClaw 2026.8.2、
Mission Control 2026.8.2-v0.3.84）：

- Caddy 加 `basicauth` 前置於 Mission Control：未帶憑證時 Caddy 回 401，請求
  根本到不了 MCC；帶了憑證則正常載入 MCC 登入頁。
- **對話的 WebSocket 可以穿過 Caddy 的 basic auth。** 這是整件事唯一真正的
  技術未知數 —— 瀏覽器在 WebSocket 握手時如何處理 Basic 憑證，各家行為並不
  一致。我們用 `agents-chat` 這支端對端測試（送出訊息、收到回覆）透過 Caddy
  實際跑過，通過。
- Session cookie 回來時 `Secure` 旗標正確帶上，因為 Mission Control 本來就
  信任 `X-Forwarded-Proto`，而 Caddy 預設會送。MCC 不需要修改。
- 上面那條介面式 ufw 規則語法正確（`--dry-run` 驗證）。

**唯一沒有驗證的：真實憑證簽發。** throwaway 沒有指向它的公開網域名稱，所以
測試時用的是 `tls internal`（自簽憑證）。Caddy 的 Let's Encrypt 自動流程需要
公開網域解析到該機器，且 80 埠可達。目前沒有任何跡象顯示它不會成功，但確實
沒有人跑過完整流程。**請在第一台有真實網域的機器上先證明這一段**，另外提醒：
如果要對同一個網域重複測試部署，請留意 Let's Encrypt 的速率限制。

---

## 尚待我們自己決定的產品問題（不是 deployer 的問題）

列在這裡是為了讓 deployer 的工作不必等這些答案就能開始：

1. **是否必須是 WHMCS 原生單一登入？** basic auth 的本質是「客戶去客戶區看
   密碼」，不是「用 WHMCS 帳號登入」。如果之後確定要真正的 SSO，Caddy 的
   `forward_auth` 可以直接取代 `basicauth`，而且 **Mission Control 完全不用
   改** —— 所以這是一條乾淨的升級路徑，不是打掉重做。
2. **客戶是否應該看到整個 Mission Control？** 已部分回答：§9 讓對話成為客戶
   **最先看到**的畫面。但那是首頁設定，不是權限邊界 —— 同一組密碼後面仍然是
   全部功能，包含終端機、備份、系統更新與重新開機。客戶是 VPS 的擁有者，全開
   也說得通。若要真正的「只能對話」，那是 Mission Control 的實質修改（要做角色
   權限，不是導向），需要先確定範圍再對外承諾。
3. basic auth 沒有登出機制，也沒有過期（關掉瀏覽器才清除）。以 MVP 而言可以
   接受，但要知道。
