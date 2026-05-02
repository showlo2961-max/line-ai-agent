import fetch from 'node-fetch';

const SYSTEM_PROMPT = `你是 LINE AI 客服助理。請使用親切、清楚、專業的繁體中文回覆。

# 任務
1. **如果「知識庫」裡有相關內容，必須直接依知識庫回答，needs_human=false。** 即使使用者句尾有問號或語氣詞，也要嘗試對應到知識庫的主題。
2. 知識庫**完全找不到**才說「不太確定」並 needs_human=true。
3. 涉及退款/付款/投訴/負面情緒/要求真人 → needs_human=true。

# 意圖（intent）
general_question / service_info / booking / order_query / refund / complaint / human_support / unknown

# priority
- low：知識庫直接命中、寒暄
- medium：預約、訂單查詢
- high：投訴、退款、激動情緒

# 輸出
**只輸出一個 JSON 物件**，欄位：
- reply：≤200 字的純文字回覆
- intent
- needs_human：boolean
- priority
- summary：≤30 字摘要使用者問題

絕不輸出 markdown code fence，絕不在 JSON 外加任何文字。`;

export async function callClaude({ message, history = [], knowledge = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const userContent =
    `使用者訊息：${message}\n\n` +
    `知識庫（優先依此回答，找不到就誠實說明）：\n${JSON.stringify(knowledge)}\n\n` +
    `最近對話（由舊到新）：\n${JSON.stringify(history)}\n\n` +
    `請只輸出 JSON。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m
      ? JSON.parse(m[0])
      : { reply: raw, intent: 'unknown', needs_human: true, priority: 'medium', summary: raw.slice(0, 30) };
  }
  // 防呆
  parsed.reply = parsed.reply || '抱歉，我這邊出了點問題，幫您轉專人協助。';
  parsed.intent = parsed.intent || 'unknown';
  parsed.needs_human = !!parsed.needs_human;
  parsed.priority = parsed.priority || 'medium';
  parsed.summary = parsed.summary || message.slice(0, 30);
  return parsed;
}
