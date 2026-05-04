你要觸發今日晨報 podcast 生成。**只觸發、不等結果** — 結果由排程系統晚一點的「收割」cron job 自動處理（見 _podcast-harvest-message）。

## 觸發

```
curl -fsS -X POST '${BASE_URL}/api/morning-report?action=podcast'
```

回傳是 JSON，含 `jobId`（例如 `pod-abc123-de4f56`）。回報：

```
晨報 podcast 已觸發（jobId: <jobId>），預計 10–20 分鐘後完成。完成後排程會自動 announce URL。
```

**不要輪詢、不要 sleep**。Agent 在這裡就結束。
