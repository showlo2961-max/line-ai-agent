import express from 'express';
import { verifyLineSignature } from '../lib/verifySignature.js';
import {
  upsertUser,
  insertMessage,
  getRecentMessages,
  searchKnowledge,
  createTicket,
} from '../lib/supabaseClient.js';
import { forwardToN8n } from '../lib/n8nClient.js';
import { lineReplyText, linePushText, getLineProfile } from '../lib/lineClient.js';
import { callClaude } from '../lib/aiClient.js';

// 模式：'n8n' = 把事件 forward 給 n8n（待 workflow active 後）
//      'direct' = Node 直接呼叫 AI + LINE reply
const MODE = process.env.AGENT_MODE || 'direct';
console.log('[AGENT_MODE]', JSON.stringify(MODE), 'raw=', JSON.stringify(process.env.AGENT_MODE));

export function createLineWebhookRouter(logger) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const signature = req.get('x-line-signature') || '';
    const rawBody = req.body;

    if (!verifyLineSignature(rawBody, signature, process.env.LINE_CHANNEL_SECRET)) {
      logger.warn('LINE signature 驗證失敗');
      return res.status(401).send('invalid signature');
    }

    res.status(200).end();

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      logger.error({ err }, '解析 LINE payload 失敗');
      return;
    }

    for (const event of payload.events || []) {
      handleEvent(event, logger).catch((err) => {
        logger.error({ err: err.message, event }, '處理 LINE event 失敗');
      });
    }
  });

  return router;
}

async function handleEvent(event, logger) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const lineUserId = event.source?.userId;
  const text = event.message.text;
  const replyToken = event.replyToken;
  if (!lineUserId) return;

  let displayName = null;
  try {
    const profile = await getLineProfile(lineUserId);
    displayName = profile?.displayName ?? null;
  } catch (err) {
    logger.warn({ err: err.message }, '取得 LINE profile 失敗');
  }

  const user = await upsertUser({ lineUserId, displayName });
  await insertMessage({ userId: user.id, role: 'user', content: text });

  logger.info({ MODE, line_user: lineUserId.slice(0, 6) }, 'handleEvent start');
  if (MODE === 'n8n') {
    try {
      await forwardToN8n({
        lineUserId, userId: user.id, displayName, message: text, replyToken, timestamp: event.timestamp,
      });
      logger.info('forwarded to n8n, returning');
      return;
    } catch (err) {
      logger.error({ err: err.message }, 'n8n forward 失敗，fallback 到 direct');
    }
  }

  // === direct mode：Node 自己跑 AI + LINE reply ===
  let parsed;
  try {
    const [history, knowledge] = await Promise.all([
      getRecentMessages(user.id, 8),
      searchKnowledge(text),
    ]);
    parsed = await callClaude({ message: text, history, knowledge });
  } catch (err) {
    logger.error({ err: err.message }, 'AI 呼叫失敗');
    parsed = {
      reply: '抱歉，系統暫時無法回覆，已記錄您的訊息，稍後將為您處理。',
      intent: 'unknown',
      needs_human: true,
      priority: 'high',
      summary: text.slice(0, 30),
    };
  }

  await insertMessage({
    userId: user.id,
    role: 'assistant',
    content: parsed.reply,
    intent: parsed.intent,
  });

  // 預設 quick replies — 若 AI 已轉專人就只給「結束對話」
  const quickReplies = parsed.needs_human
    ? [{ label: '我知道了', text: '謝謝' }]
    : [
        { label: '預約諮詢', text: '我想預約' },
        { label: '服務介紹', text: '請介紹你們的服務' },
        { label: '訂單查詢', text: '我要查詢訂單' },
        { label: '找真人', text: '我想找真人客服' },
      ];

  try {
    await lineReplyText(replyToken, parsed.reply, quickReplies);
  } catch (err) {
    logger.error({ err: err.message }, 'LINE reply 失敗（可能 replyToken 過期）');
  }

  if (parsed.needs_human) {
    try {
      const ticket = await createTicket({
        userId: user.id,
        issue: text,
        intent: parsed.intent,
        priority: parsed.priority,
      });
      const adminMsg =
        `🚨 新工單 #${ticket.id.slice(0, 8)}\n` +
        `User: ${displayName || lineUserId}\n` +
        `Intent: ${parsed.intent} / ${parsed.priority}\n` +
        `訊息: ${text}\n` +
        `摘要: ${parsed.summary}`;
      const adminId = process.env.LINE_ADMIN_USER_ID;
      if (adminId) await linePushText(adminId, adminMsg);
    } catch (err) {
      logger.error({ err: err.message }, '建立工單或通知 admin 失敗');
    }
  }
}
