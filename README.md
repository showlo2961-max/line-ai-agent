# LINE AI Agent + n8n 自動化客服系統

> 串接 LINE 官方帳號 → Node.js Webhook → n8n → Claude/OpenAI → Supabase
> 自動回覆、知識庫、人工轉接、工單、管理員通知一條龍。

---

## 一、系統總架構（文字版）

```
            ┌─────────────────────────┐
            │      LINE 使用者         │
            └──────────┬──────────────┘
                       │ HTTPS (text message)
                       ▼
            ┌─────────────────────────┐
            │  LINE Messaging Platform │
            └──────────┬──────────────┘
                       │ Webhook (POST + x-line-signature)
                       ▼
   ┌────────────────────────────────────────────┐
   │ Node.js / Express  (Railway / Render)      │
   │  - 驗證 signature                          │
   │  - 200 OK 立刻回                           │
   │  - upsert user / insert message            │
   │  - forward → n8n Webhook                   │
   └──────────┬──────────────────┬──────────────┘
              │                  │
              ▼                  ▼
     ┌──────────────┐   ┌──────────────────┐
     │  Supabase     │   │      n8n         │
     │ (Postgres)    │   │  Workflow Engine │
     │  users        │◀──│  - Auth          │
     │  messages     │   │  - KB Lookup     │
     │  knowledge_…  │   │  - Claude API    │
     │  tickets      │   │  - Parse JSON    │
     │  admin_notif  │   │  - IF needs_human│
     └──────────────┘   │  - Create ticket │
                        │  - LINE Reply    │
                        │  - LINE Push 管理│
                        └────────┬─────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ LINE Reply / Push │
                       │   給使用者 / 管理 │
                       └──────────────────┘
```

---

## 二、資料流流程圖

```
[LINE User] ──msg──▶ [LINE Platform] ──webhook──▶ [Node Backend]
                                                        │
                                                        ├─ 驗 signature
                                                        ├─ 立即 200 OK
                                                        ├─ upsert users
                                                        ├─ insert messages(role=user)
                                                        ▼
                                              [n8n Webhook (x-shared-secret)]
                                                        │
                            ┌───────────────────────────┼──────────────────────────┐
                            ▼                           ▼                          ▼
                  [Supabase: kb 查詢]         [Supabase: 最近 10 則歷史]      (合併 context)
                            └───────────────┬───────────┘
                                            ▼
                                  [HTTP: Claude / OpenAI]
                                            │ JSON → {reply, intent, needs_human, priority, summary}
                                            ▼
                                  [Function: Parse JSON]
                                            │
                       ┌────────────────────┴────────────────────┐
                       ▼                                         ▼
       [Supabase: insert messages(role=assistant)]   [IF needs_human == true]
                       │                                         │
                       ▼                                         ▼ true
              [HTTP: LINE Reply]                  [Supabase: create ticket]
                                                                 ▼
                                                  [HTTP: LINE Push to ADMIN]
                                                                 ▼
                                                  [Supabase: log admin_notifications]
```

---

## 三、檔案結構

```
agent/
├── README.md                  ← 你正在看
├── package.json
├── .env.example
├── .gitignore
├── src/
│   ├── index.js               ← Express 入口
│   ├── routes/
│   │   ├── lineWebhook.js     ← /webhook/line
│   │   └── admin.js           ← /admin/*  (n8n callback)
│   └── lib/
│       ├── verifySignature.js
│       ├── lineClient.js
│       ├── supabaseClient.js
│       └── n8nClient.js
├── sql/
│   └── schema.sql             ← Supabase 一鍵建表
├── n8n/
│   └── workflow.json          ← 直接 import 進 n8n
├── prompts/
│   └── system-prompt.md       ← AI Agent System Prompt
└── scripts/
    └── test-webhook.js        ← 本地測試送一則模擬 LINE 訊息
```

---

## 四、部署教學

### 4.1 LINE Developers 設定

1. 到 <https://developers.line.biz/> 建立 Provider → Messaging API channel。
2. 在 **Basic settings** 取得 `Channel secret` → 填入 `LINE_CHANNEL_SECRET`。
3. 在 **Messaging API** 頁籤：
   - Issue 一個 long-lived `Channel access token` → 填 `LINE_CHANNEL_ACCESS_TOKEN`。
   - **關閉** Auto-reply messages、Greeting messages（避免和 AI 撞回覆）。
   - Webhook URL 先暫填 placeholder（部署後再更新），開啟 **Use webhook**。
4. 把官方帳號加為好友，傳一則訊息給 bot；後台「LINE Official Account Manager → 一對一聊天」可以看到自己的 `userId`，填入 `LINE_ADMIN_USER_ID`（也可在 Node 後端 log 觀察）。

### 4.2 Supabase 建表

1. <https://supabase.com> 建立新專案。
2. 左側 **SQL Editor** → New query → 貼上 `sql/schema.sql` 全文 → Run。
3. 在 **Project Settings → API** 拿 `Project URL` 與 `service_role` key，填入：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. **Project Settings → Database → Connection string (URI)** 取得 `DATABASE_URL`（給 n8n credential）。

### 4.3 n8n Workflow 建置

1. 自架 (`docker run -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n`) 或用 n8n Cloud。
2. 在 n8n **Settings → Variables / Env**（自架可寫到 docker compose env）：
   - `N8N_SHARED_SECRET`（同 Node 後端的值）
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_ADMIN_USER_ID`
   - `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`
   - `SYSTEM_PROMPT`（貼 `prompts/system-prompt.md` 內文）
3. 在 n8n **Credentials → Supabase** 建一組 `Supabase main`：
   - Host: `db.xxxxxxxx.supabase.co`
   - Service Role Secret: 同 `SUPABASE_SERVICE_ROLE_KEY`
4. 左上選單 → **Import from File** → 選 `n8n/workflow.json`。
5. 啟用 workflow，複製 Webhook URL（形如 `https://your-n8n.example.com/webhook/line-agent`），填到 Node 後端的 `N8N_WEBHOOK_URL`。

### 4.4 Node 後端部署（Railway 範例）

1. `git init && git add . && git commit -m "init"`，推到 GitHub。
2. <https://railway.app> → New Project → Deploy from GitHub。
3. 在 **Variables** 把 `.env.example` 的所有變數補上實際值。
4. Railway 會自動 `npm install` 並啟動 `npm start`，分配一個公開域名 e.g. `https://line-agent.up.railway.app`。
5. 回到 LINE Developers → Messaging API → Webhook URL 填：
   ```
   https://line-agent.up.railway.app/webhook/line
   ```
   按 **Verify** 應該回 200。

> Render / Vercel 同理；Vercel 因為是 Serverless，務必用 `app.use(express.raw(...))` 並把 raw body 留給 signature 驗證（本專案 `src/routes/lineWebhook.js` 已處理）。

### 4.5 測試流程

1. 用 LINE 加官方帳號為好友，傳「請問營業時間？」應收到 AI 回覆。
2. 傳「我要找真人」→ 預期：
   - LINE 回覆轉專人訊息
   - Supabase `tickets` 新增一筆 `intent=human_support, status=open`
   - 你的 LINE_ADMIN_USER_ID 收到工單通知
   - Supabase `admin_notifications` 多一筆 `channel=line, status=sent`
3. 本機開發時可用 `npm run test:webhook` 模擬 LINE 訊息（見 `scripts/test-webhook.js`）。

---

## 五、環境變數

完整見 `.env.example`，重點：

| 變數 | 用途 |
|---|---|
| `LINE_CHANNEL_SECRET` | 驗證 webhook signature |
| `LINE_CHANNEL_ACCESS_TOKEN` | 呼叫 reply / push API |
| `LINE_ADMIN_USER_ID` | 工單通知對象 |
| `N8N_WEBHOOK_URL` | Node → n8n |
| `N8N_SHARED_SECRET` | Node ↔ n8n 雙向驗證 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase JS client |
| `DATABASE_URL` | n8n Supabase / Postgres credential |
| `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` | n8n 呼叫 LLM |

---

## 六、未來可擴充功能

- **pgvector + embedding 知識庫**：把 `knowledge_base.content` 轉 embedding，n8n 用 cosine similarity 取 top-K，準確度大幅提升。
- **多輪對話 session**：以 `users.id` 為 key 在 Redis 存最近 N 輪 context，AI 直接吃。
- **Rich Menu / Flex Message**：n8n LINE Reply node 換用 Flex JSON，呈現預約卡、商品圖。
- **Quick Reply**：在 LLM 輸出加 `quick_replies` 欄位，n8n 組成 LINE Quick Reply。
- **後台 dashboard**：用 Next.js + Supabase Auth 做 ticket / knowledge_base / messages CRUD。
- **語音/圖片**：擴充 `lineWebhook.js` 處理 `message.type === 'image' / 'audio'`，下載後丟 Whisper / Vision。
- **A/B Prompt**：把 system prompt 版本存 DB，可在後台切換。
- **觀測性**：Sentry + Logtail + Grafana，n8n workflow 失敗自動發 Slack。
- **多品牌 / 多帳號**：以 `LINE_CHANNEL_SECRET` 為 key 路由到不同 brand 設定。
- **GDPR / 個資**：`messages.content` 加密儲存；建立刪除 webhook（使用者解除好友時清資料）。
