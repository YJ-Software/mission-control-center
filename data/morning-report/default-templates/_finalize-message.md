使用 exec 工具執行以下指令來合併發佈晨報：
curl -s -X POST '${BASE_URL}/api/morning-report?action=finalize'
如果結果包含 tunnelUrl，請回報一個完整的 URL 給用戶：
```
今日晨報已經準備完畢：
$tunnelUrl
```
如果執行結果不成功，請回報錯誤原因。