import { createClient } from '@supabase/supabase-js';

let _client = null;
export function supabase() {
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  return _client;
}

export async function upsertUser({ lineUserId, displayName }) {
  const sb = supabase();
  // 先 select，再 insert/update — 避免 upsert 對 conflict 欄位有額外要求
  const { data: existing, error: selErr } = await sb
    .from('users')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    if (displayName && existing.display_name !== displayName) {
      const { data, error } = await sb
        .from('users')
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    return existing;
  }

  const { data, error } = await sb
    .from('users')
    .insert({ line_user_id: lineUserId, display_name: displayName })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertMessage({ userId, role, content, intent = null }) {
  const sb = supabase();
  const { data, error } = await sb
    .from('messages')
    .insert({ user_id: userId, role, content, intent })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRecentMessages(userId, limit = 10) {
  const sb = supabase();
  const { data, error } = await sb
    .from('messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

export async function searchKnowledge(text) {
  const sb = supabase();
  if (!text) return [];
  // 去除標點，再切 token；中文大多 1 字成義，採取「整句 + 2 字以上的子串」混合
  const cleaned = text.replace(/[?？!！,，。.、:：;；()（）"'\s]+/g, ' ').trim();
  if (!cleaned) return [];

  const candidates = new Set();
  candidates.add(cleaned);
  for (const t of cleaned.split(/\s+/)) if (t.length >= 2) candidates.add(t);
  // 中文情境再加 2-gram，提高命中率
  const flat = cleaned.replace(/\s+/g, '');
  for (let i = 0; i + 2 <= flat.length; i++) {
    const g = flat.slice(i, i + 2);
    if (/[一-鿿]/.test(g)) candidates.add(g);
  }

  const orParts = [...candidates]
    .slice(0, 12) // 限制 OR 條件數量
    .flatMap((t) => {
      const safe = t.replace(/[%,]/g, '');
      return [`title.ilike.%${safe}%`, `content.ilike.%${safe}%`, `keywords.ilike.%${safe}%`];
    })
    .join(',');

  const { data, error } = await sb
    .from('knowledge_base')
    .select('id, title, content, category')
    .or(orParts)
    .eq('is_active', true)
    .limit(5);
  if (error) throw error;
  return data || [];
}

export async function createTicket({ userId, issue, intent, priority = 'medium' }) {
  const sb = supabase();
  const { data, error } = await sb
    .from('tickets')
    .insert({ user_id: userId, issue, intent, status: 'open', priority })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function logAdminNotification({ ticketId, channel, status }) {
  const sb = supabase();
  const { error } = await sb
    .from('admin_notifications')
    .insert({ ticket_id: ticketId, channel, status });
  if (error) throw error;
}
