/**
 * 本機測試：用正確的 LINE signature 模擬一則訊息打 /webhook/line
 *
 * 用法：
 *   1) 先 cp .env.example .env 並填值
 *   2) 另開一個 terminal: npm run dev
 *   3) node scripts/test-webhook.js "請問營業時間？"
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fetch from 'node-fetch';

const text = process.argv[2] || '請問營業時間？';
const url = process.env.TEST_WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}/webhook/line`;
const secret = process.env.LINE_CHANNEL_SECRET;
if (!secret) {
  console.error('LINE_CHANNEL_SECRET 未設定');
  process.exit(1);
}

const body = {
  destination: 'Uadminxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  events: [
    {
      type: 'message',
      message: { id: 'test-' + Date.now(), type: 'text', text },
      timestamp: Date.now(),
      source: { type: 'user', userId: 'Utest_user_1234567890abcdef' },
      replyToken: 'replytoken_test_' + Math.random().toString(36).slice(2),
      mode: 'active',
    },
  ],
};
const raw = JSON.stringify(body);
const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
  body: raw,
});
console.log('status:', res.status);
console.log('body:', await res.text());
