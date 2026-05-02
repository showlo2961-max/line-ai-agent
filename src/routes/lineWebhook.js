import express from 'express';
import { verifyLineSignature } from '../lib/verifySignature.js';
import { upsertUser, insertMessage } from '../lib/supabaseClient.js';
import { forwardToN8n } from '../lib/n8nClient.js';
import { lineReplyText, getLineProfile } from '../lib/lineClient.js';

export function createLineWebhookRouter(logger) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const signature = req.get('x-line-signature') || '';
    const rawBody = req.body; // Buffer，因 express.raw

    if (!verifyLineSignature(rawBody, signature, process.env.LINE_CHANNEL_SECRET)) {
      logger.warn('LINE signature 驗證失敗');
      return res.status(401).send('invalid signature');
    }

    // LINE 平台要求 webhook 必須在數秒內回應 200，否則會 retry
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
        logger.error({ err, event }, '處理 LINE event 失敗');
      });
    }
  });

  return router;
}

async function handleEvent(event, logger) {
  if (event.type !== 'message' || event.message?.type !== 'text') {
    // 目前僅處理文字訊息；圖片、貼圖可在此擴充
    return;
  }

  const lineUserId = event.source?.userId;
  const text = event.message.text;
  const replyToken = event.replyToken;
  const timestamp = event.timestamp;

  if (!lineUserId) {
    logger.warn({ event }, '缺少 source.userId，略過');
    return;
  }

  // 取得使用者顯示名稱（可能因為未加好友而失敗，要容錯）
  let displayName = null;
  try {
    const profile = await getLineProfile(lineUserId);
    displayName = profile?.displayName ?? null;
  } catch (err) {
    logger.warn({ err: err.message, lineUserId }, '取得 LINE profile 失敗，略過');
  }

  // 1. upsert 使用者
  const user = await upsertUser({ lineUserId, displayName });

  // 2. 寫入訊息（user 角色）
  await insertMessage({
    userId: user.id,
    role: 'user',
    content: text,
  });

  // 3. 把事件 forward 給 n8n，讓 n8n 跑 AI / 知識庫 / 工單流程
  try {
    await forwardToN8n({
      lineUserId,
      userId: user.id,
      displayName,
      message: text,
      replyToken,
      timestamp,
    });
  } catch (err) {
    logger.error({ err: err.message }, 'forward to n8n 失敗，回退預設訊息');
    // n8n 掛掉時的 fallback：直接回覆使用者讓他不要等
    try {
      await lineReplyText(replyToken, '系統忙碌中，已記錄您的訊息，稍後將為您回覆，謝謝。');
    } catch (e) {
      logger.error({ err: e.message }, 'fallback reply 失敗');
    }
  }
}
