import fetch from 'node-fetch';

const LINE_API = 'https://api.line.me/v2/bot';

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function lineReplyText(replyToken, text, quickReplies = null) {
  const message = { type: 'text', text: truncate(text, 4900) };
  if (quickReplies?.length) {
    message.quickReply = {
      items: quickReplies.slice(0, 13).map((q) => ({
        type: 'action',
        action: {
          type: 'message',
          label: (q.label || q.text || '').slice(0, 20),
          text: q.text || q.label,
        },
      })),
    };
  }
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages: [message] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed ${res.status}: ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function linePushText(to, text) {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: truncate(text, 4900) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed ${res.status}: ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function getLineProfile(userId) {
  const res = await fetch(`${LINE_API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`LINE getProfile ${res.status}`);
  }
  return res.json();
}

function truncate(s, max) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
