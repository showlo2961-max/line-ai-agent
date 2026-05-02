import express from 'express';
import { linePushText } from '../lib/lineClient.js';

/**
 * 後台 / 工具用 endpoint
 * 由 n8n 或內部系統呼叫，不對外開放（請以 N8N_SHARED_SECRET 保護）
 */
export function createAdminRouter(logger) {
  const router = express.Router();

  router.use((req, res, next) => {
    const secret = req.get('x-shared-secret');
    if (!secret || secret !== process.env.N8N_SHARED_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });

  // n8n 透過此 endpoint 回覆 LINE 使用者（也可由 n8n 直接 call LINE API）
  router.post('/line/push', async (req, res) => {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'to and text are required' });
    try {
      await linePushText(to, text);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err: err.message }, 'admin push 失敗');
      res.status(500).json({ error: err.message });
    }
  });

  // n8n 通知管理員的捷徑
  router.post('/notify-admin', async (req, res) => {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      await linePushText(process.env.LINE_ADMIN_USER_ID, text);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err: err.message }, 'notify admin 失敗');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
