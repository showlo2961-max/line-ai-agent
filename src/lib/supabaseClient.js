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

export async function searchKnowledge(keyword) {
  const sb = supabase();
  // 簡易關鍵字搜尋；若需向量搜尋可改用 pgvector
  const { data, error } = await sb
    .from('knowledge_base')
    .select('id, title, content, category')
    .or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%,keywords.ilike.%${keyword}%`)
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
