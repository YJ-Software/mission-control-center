# 🌅 晨報 (${TOPIC_INDEX}/${TOPIC_TOTAL}) — ${TOPIC_NAME}

> ⚠️ **日期已預填**：今日為 `${DATE_HYPHEN}`。嚴禁自行推測或執行 date 命令。

---

## 本段要產出的區塊
- `## ${TOPIC_EMOJI} X (Twitter) AI 圈動態`
- `## 🔥 Reddit 熱門`
- `## 💡 Hacker News 熱門`

---

## X (Twitter) — 使用 bird CLI

### 步驟（必須按順序執行）

1. **載入環境變數**（關鍵！不可跳過）：
```bash
export $(grep -v '^#' ~/.openclaw/.env | xargs 2>/dev/null)
```

2. **確認 bird 可用**：
```bash
bird --version
```

3. **搜尋 AI 圈重點**（每個指令間隔 5 秒）：
```bash
bird search "(from:rowancheung OR from:bindureddy OR from:OpenAI OR from:AnthropicAI)" -n 5
sleep 5
bird search "(OpenAI OR Anthropic OR DeepSeek OR GPT-5 OR Claude)" -n 5
sleep 5
bird search "(agentic OR AI agents OR MCP)" -n 5
```

4. **展開串文**（若需要）：
```bash
bird read <tweet-url>
bird thread <tweet-url>
```

5. **輸出**：每則 1–2 句中文摘要 + 推文連結

### 備援（僅在 bird 完全失敗時）
```bash
web_search query:"site:x.com AI news" freshness:"pd"
```

---

## Reddit — 使用 JSON API

### 步驟（必須按順序執行）

對以下每個 subreddit，用 curl 抓取 top posts：

```bash
SUBS="singularity LocalLLaMA AI_Agents ClaudeAI AgentsOfAI"
for SUB in $SUBS; do
  echo "=== r/$SUB ==="
  curl -s -H "User-Agent: OpenClaw/1.0" \
    "https://www.reddit.com/r/${SUB}/top.json?t=day&limit=3" \
    | jq -r '.data.children[].data | "[\(.score)↑ \(.num_comments)💬] \(.title)\nhttps://reddit.com\(.permalink)\n"'
  sleep 2
done
```

**目標**：每個 subreddit 取 top 2 則，共 10 則

**每則輸出格式**：
- **標題中文摘要**：一句話重點 + 補充 + 👍 score + 💬 comments + [來源](permalink)

### 備援（僅在 JSON API 回 403/429 時）
1. `web_search query:"site:reddit.com r/singularity AI" freshness:"pd"`
2. 最後備援：Browser Relay（`browser action:open profile:chrome`）

---

## Hacker News — 使用 API

### 步驟

```bash
# 取 top 10 story IDs
TOP_IDS=$(curl -s "https://hacker-news.firebaseio.com/v0/topstories.json" | jq '.[0:10][]')

# 取每則詳情
for ID in $TOP_IDS; do
  curl -s "https://hacker-news.firebaseio.com/v0/item/${ID}.json" \
    | jq -r '"\(.score)↑ \(.descendants // 0)💬 | \(.title) | https://news.ycombinator.com/item?id=\(.id)"'
  sleep 0.5
done
```

**目標**：Top 5 則

**每則輸出**：標題 + 1–2 句說明 + 連結

### 備援
`web_search query:"site:news.ycombinator.com" freshness:"pd"`

---

## 輸出格式（重要）
1. 產出完整晨報內容（維持現有格式）
2. 將內容寫入檔案：`${OUTPUT_FILE}`
3. 輸出時只回報「已寫入 ${OUTPUT_FILE}」，不要輸出完整內容到對話
