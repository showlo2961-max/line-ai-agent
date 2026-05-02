# n8n Workflow 節點規格

> 對應 `n8n/workflow.json`。下表為每個節點的「用途 / 輸入 / 輸出 / 設定要點」，方便手動建置或除錯。

| # | 節點 | 類型 | 用途 |
|---|------|------|------|
| 1 | Webhook (from Node backend) | Webhook | 接收 Node 後端 forward 的 LINE 事件 |
| 2 | Auth Check | IF | 比對 `x-shared-secret` header |
| 3 | Function: Normalize | Function | 把 body 攤平成乾淨欄位 |
| 4 | Supabase: Knowledge Base | Supabase | 拉啟用中的知識庫 |
| 5 | Supabase: Recent Messages | Supabase | 拉該使用者最近 10 則對話 |
| 6 | HTTP: Claude API | HTTP Request | 呼叫 Anthropic / OpenAI |
| 7 | Function: Parse AI JSON | Function | 強制解析 AI 的 JSON 輸出 |
| 8 | Supabase: Save Assistant Msg | Supabase | 寫入 messages (role=assistant) |
| 9 | HTTP: LINE Reply | HTTP Request | 用 replyToken 回覆使用者 |
| 10 | IF: Needs Human? | IF | `needs_human === true` |
| 11 | Supabase: Create Ticket | Supabase | 建立工單 |
| 12 | HTTP: LINE Notify Admin | HTTP Request | Push 給 admin |
| 13 | Supabase: Log Notification | Supabase | 記錄通知結果 |
| 14 | Respond 200 | Respond to Webhook | 回 Node 後端 |
| 15 | Respond 401 | Respond to Webhook | Auth fail |

---

## 1. Webhook (Trigger)

| 設定 | 值 |
|---|---|
| HTTP Method | `POST` |
| Path | `line-agent` |
| Response | `Using "Respond to Webhook" Node` |

**輸入**：無
**輸出**：
```json
{
  "headers": { "x-shared-secret": "..." },
  "body": {
    "lineUserId": "Uxxxxxxxx",
    "userId": "uuid-from-supabase",
    "displayName": "小明",
    "message": "請問營業時間？",
    "replyToken": "xxxxxxxx",
    "timestamp": 1714000000000
  }
}
```

---

## 2. Auth Check (IF)

| 設定 | 值 |
|---|---|
| Condition | `{{$json.headers['x-shared-secret']}} == {{$env.N8N_SHARED_SECRET}}` |

**true** → 繼續流程；**false** → 走到 `Respond 401`。

---

## 3. Function: Normalize

```js
const b = $json.body || $json;
return [{ json: {
  lineUserId: b.lineUserId,
  userId:     b.userId,
  displayName: b.displayName || null,
  message:    b.message,
  replyToken: b.replyToken,
  timestamp:  b.timestamp,
  receivedAt: new Date().toISOString()
}}];
```

---

## 4. Supabase: Knowledge Base

| 設定 | 值 |
|---|---|
| Operation | `Get Many` |
| Table | `knowledge_base` |
| Filter | `is_active = true` |
| Limit | `50` |

> 之後升級向量檢索時，把這個節點換成「HTTP Request → Supabase RPC `match_kb(query_embedding)`」。

---

## 5. Supabase: Recent Messages

| 設定 | 值 |
|---|---|
| Operation | `Get Many` |
| Table | `messages` |
| Filter | `user_id = {{$('Function: Normalize').item.json.userId}}` |
| Sort | `created_at DESC` |
| Limit | `10` |

---

## 6. HTTP: Claude API（也可換 OpenAI）

| 設定 | 值 |
|---|---|
| Method | `POST` |
| URL | `https://api.anthropic.com/v1/messages` |
| Headers | `x-api-key: {{$env.ANTHROPIC_API_KEY}}`、`anthropic-version: 2023-06-01`、`content-type: application/json` |

**Body (JSON)**：
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 800,
  "system": "{{$env.SYSTEM_PROMPT}}",
  "messages": [
    {
      "role": "user",
      "content": "使用者訊息：{{...}}\n\n知識庫：{{...}}\n\n歷史：{{...}}\n\n請只回 JSON。"
    }
  ]
}
```

> 換 OpenAI 時：URL `https://api.openai.com/v1/chat/completions`，Header `Authorization: Bearer {{$env.OPENAI_API_KEY}}`，body 用 `messages: [{role:'system', ...}, {role:'user', ...}]`，`response_format: { "type": "json_object" }`。

---

## 7. Function: Parse AI JSON

```js
const raw = $json.content?.[0]?.text                       // Claude
         || $json.choices?.[0]?.message?.content          // OpenAI
         || '{}';
let parsed;
try { parsed = JSON.parse(raw); }
catch (e) {
  const m = raw.match(/\{[\s\S]*\}/);
  parsed = m ? JSON.parse(m[0])
             : { reply: raw, intent: 'unknown', needs_human: true,
                 priority: 'medium', summary: raw.slice(0,80) };
}
return [{ json: parsed }];
```

---

## 8. Supabase: Save Assistant Msg

| Field | Value |
|---|---|
| `user_id` | `{{$('Function: Normalize').item.json.userId}}` |
| `role` | `assistant` |
| `content` | `{{$json.reply}}` |
| `intent` | `{{$json.intent}}` |

---

## 9. HTTP: LINE Reply

| 設定 | 值 |
|---|---|
| Method | `POST` |
| URL | `https://api.line.me/v2/bot/message/reply` |
| Headers | `Authorization: Bearer {{$env.LINE_CHANNEL_ACCESS_TOKEN}}` |

**Body**：
```json
{
  "replyToken": "{{$('Function: Normalize').item.json.replyToken}}",
  "messages": [{ "type": "text", "text": "{{$('Function: Parse AI JSON').item.json.reply}}" }]
}
```

> ⚠ replyToken 只能用一次、需在 30 秒內回。若超時改用 push API。

---

## 10. IF: Needs Human?

`{{$('Function: Parse AI JSON').item.json.needs_human}} === true`

**true** → 建立工單 + 通知。
**false** → 流程結束。

---

## 11. Supabase: Create Ticket

| Field | Value |
|---|---|
| `user_id` | `={{$('Function: Normalize').item.json.userId}}` |
| `issue` | `={{$('Function: Normalize').item.json.message}}` |
| `intent` | `={{$('Function: Parse AI JSON').item.json.intent}}` |
| `priority` | `={{$('Function: Parse AI JSON').item.json.priority}}` |
| `status` | `open` |

---

## 12. HTTP: LINE Notify Admin

| 設定 | 值 |
|---|---|
| Method | `POST` |
| URL | `https://api.line.me/v2/bot/message/push` |

**Body**：
```json
{
  "to": "{{$env.LINE_ADMIN_USER_ID}}",
  "messages": [{
    "type": "text",
    "text": "🚨 新工單 #{{$('Supabase: Create Ticket').item.json.id}}\nUser: {{...displayName...}}\nIntent: {{...}}\n訊息: {{...}}\n摘要: {{...}}"
  }]
}
```

---

## 13. Supabase: Log Notification

| Field | Value |
|---|---|
| `ticket_id` | `={{$('Supabase: Create Ticket').item.json.id}}` |
| `channel` | `line` |
| `status` | `sent` |

---

## 14 / 15. Respond to Webhook

回 Node 後端 200 / 401，讓 Node 端可以把錯誤寫 log。

---

## 錯誤處理流程

每個 HTTP / Supabase 節點建議在 **Settings → Continue On Fail** 開啟，並在後面接：

```
[Set] error_summary
   └─▶ [HTTP: LINE Notify Admin]   "🛑 workflow failed: ..."
        └─▶ [Supabase: admin_notifications]   status='failed'
             └─▶ [Respond 500]
```

或用 n8n 的 **Error Trigger** 建立一個獨立 workflow，所有 workflow 失敗都集中處理。
