import fetch from 'node-fetch';

export async function forwardToN8n(payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error('N8N_WEBHOOK_URL not set');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-shared-secret': process.env.N8N_SHARED_SECRET || '',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n forward failed ${res.status}: ${body}`);
  }
  return res.json().catch(() => ({}));
}
