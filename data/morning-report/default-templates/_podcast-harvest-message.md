收割今天的 podcast 結果並回報用戶。本 cron 在 podcast 觸發後 N 分鐘執行（預設 15 分鐘）。

## 步驟

1. 用今天的日期查詢結果：

```
curl -fsS '${BASE_URL}/api/morning-report?type=podcast-result&date='$(date +%F)
```

回傳 JSON：

```json
{
  "date": "2026-05-03",
  "ready": true | false,
  "status": "done" | "running" | "error" | "unknown",
  "tunnelUrl": "https://....trycloudflare.com/morning-report-XXX.mp3?token=...",
  "audioUrl": "/api/morning-report?type=podcast&date=2026-05-03",
  "progress": { "stage": "...", "message": "..." },
  "error": "...",
  "source": "in-memory-job" | "public-dir-fallback" | "none"
}
```

2. 依結果處理：

- **`ready=true` 且有 `tunnelUrl`**：回報給用戶
  ```
  今日晨報 Podcast 已準備完畢：
  <tunnelUrl>
  ```

- **`status="error"`**：回報錯誤
  ```
  今日晨報 Podcast 生成失敗：<error>
  ```

- **`ready=false` 且 `status="running"`**：podcast 還沒跑完，回報進度
  ```
  今日晨報 Podcast 仍在生成中（<progress.stage>: <progress.message>），請稍後到 dashboard 查看。
  ```

- **`status="unknown"` 或 `source="none"`**：今天根本沒被觸發
  ```
  今天還沒觸發 Podcast 生成。
  ```

完成回報就結束。
