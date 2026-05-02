import crypto from 'node:crypto';

/**
 * 驗證 LINE Webhook signature
 * @param {Buffer} rawBody - 原始 body（必須是 Buffer / string，未經 JSON.parse）
 * @param {string} signature - x-line-signature header
 * @param {string} channelSecret
 * @returns {boolean}
 */
export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!rawBody || !signature || !channelSecret) return false;
  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(rawBody);
  const expected = hmac.digest('base64');
  // timing-safe 比較
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
