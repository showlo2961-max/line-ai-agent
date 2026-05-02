import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createLineWebhookRouter } from './routes/lineWebhook.js';
import { createAdminRouter } from './routes/admin.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const app = express();
app.use(pinoHttp({ logger }));

// LINE Webhook 必須使用 raw body 才能驗證 signature
app.use('/webhook/line', express.raw({ type: '*/*' }), createLineWebhookRouter(logger));

// 後台 / 工具用 JSON
app.use(express.json({ limit: '1mb' }));
app.use('/admin', createAdminRouter(logger));

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  logger.info({ port }, 'LINE AI Agent server started');
});
