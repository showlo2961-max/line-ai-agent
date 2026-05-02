# 測試案例

## A. 單元 / 本地

### A1. Signature 驗證
- 用 `scripts/test-webhook.js` 預期 200 OK。
- 將 `LINE_CHANNEL_SECRET` 改錯一碼 → 預期 401 `invalid signature`。

### A2. n8n forward 失敗 fallback
- 把 `.env` 的 `N8N_WEBHOOK_URL` 改成不存在的網址。
- 跑 `npm run test:webhook` → LINE 應收到「系統忙碌中…」，且 server log 有 `forward to n8n 失敗`。

---

## B. 端對端（實際 LINE 對話）

| # | 使用者輸入 | 期望 AI intent | needs_human | 期望 LINE 回覆關鍵字 | DB 副作用 |
|---|---|---|---|---|---|
| B1 | `你好` | general_question | false | 您好 / 嗨 | messages +2 |
| B2 | `請問營業時間？` | general_question | false | 09:00 / 18:00 | messages +2 |
| B3 | `我想預約星期五下午兩點` | booking | false | 預約 / 確認 | messages +2 |
| B4 | `我訂單還沒到，編號 123456` | order_query | true（需查資料） | 轉專人 / 稍後 | tickets +1, admin_notifications +1 |
| B5 | `刷卡刷兩次幫我退！` | refund | true | 轉專人 | tickets priority=high |
| B6 | `我要找真人客服` | human_support | true | 已轉交 / 專人 | tickets +1 |
| B7 | `你們服務超爛我要去申訴` | complaint | true | 抱歉 / 轉專人 | tickets priority=high |
| B8 | `5+5 等於多少？` | unknown | false 或 true | 任意（最好引導回業務） | messages +2 |

---

## C. 工單流程驗證

1. 觸發 B6（要求真人）。
2. 在 Supabase **tickets** 應出現 1 筆 `status=open, intent=human_support`。
3. 你的 LINE_ADMIN_USER_ID 收到 push：
   ```
   🚨 新工單 #<uuid>
   User: <displayName 或 userId>
   Intent: human_support / medium
   訊息: 我要找真人客服
   摘要: 使用者要求真人客服
   ```
4. **admin_notifications** 多一筆 `channel=line, status=sent`。

---

## D. 知識庫優先驗證

1. 在 Supabase 新增一筆 `knowledge_base`：
   - title: `寵物友善`
   - content: `本店允許 5 公斤以下寵物入內，須使用提袋。`
   - keywords: `寵物,狗,貓,毛小孩`
2. 在 LINE 問：「可以帶狗進去嗎？」
3. AI 回覆內應出現「5 公斤以下」「提袋」字樣（代表確實參考知識庫，沒有幻想）。

---

## E. 壓測 / 安全

- 連發 20 則訊息：messages 應正確序列、replyToken 不重複錯誤。
- 用 `curl` 直接打 `/admin/notify-admin` 不帶 `x-shared-secret` → 401。
- 把 LINE Webhook URL 換成 https，但故意把 signature 拿掉 → 401。
- 觀察 Railway / Render log 是否有 PII 外洩（不應 log 完整 access token）。

---

## F. 回歸 checklist（每次 deploy 前）

- [ ] `/healthz` 回 200
- [ ] `npm run test:webhook "ping"` 收到 200 + 正確 reply
- [ ] LINE 後台 Webhook URL 「Verify」按鈕 → success
- [ ] n8n workflow 是 **Active**
- [ ] Supabase RLS 設定符合預期（service role 用於後端 OK，但前台 dashboard 必須有 row-level policy）
- [ ] AI Provider 額度未超
