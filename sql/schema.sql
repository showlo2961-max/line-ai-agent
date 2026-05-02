-- =====================================================
-- LINE AI Agent - Supabase / PostgreSQL schema
-- 在 Supabase SQL Editor 一次貼上執行
-- =====================================================

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ----------- users -----------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text not null unique,
  display_name  text,
  picture_url   text,
  language      text default 'zh-TW',
  is_blocked    boolean default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_users_line_user_id on public.users(line_user_id);

-- ----------- messages -----------
-- role: user / assistant / system
-- intent: AI 判斷後寫回（user / assistant 都可填）
create table if not exists public.messages (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  intent      text,
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_user_id on public.messages(user_id);
create index if not exists idx_messages_created_at on public.messages(created_at desc);

-- ----------- knowledge_base -----------
create table if not exists public.knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  category    text,
  keywords    text,                          -- 逗號分隔，方便 ilike 查詢
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_kb_category on public.knowledge_base(category);
-- 全文檢索（中文建議搭配 pg_trgm 或外部向量庫）
create index if not exists idx_kb_keywords_trgm on public.knowledge_base using gin (keywords gin_trgm_ops);
create index if not exists idx_kb_content_trgm on public.knowledge_base using gin (content gin_trgm_ops);

-- ----------- tickets -----------
-- status: open / in_progress / resolved / closed
-- priority: low / medium / high / urgent
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  issue       text not null,
  intent      text,
  status      text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority    text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee    text,
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tickets_user_id on public.tickets(user_id);
create index if not exists idx_tickets_status on public.tickets(status);

-- ----------- admin_notifications -----------
-- channel: line / email / slack / discord
-- status:  pending / sent / failed
create table if not exists public.admin_notifications (
  id          bigserial primary key,
  ticket_id   uuid references public.tickets(id) on delete cascade,
  channel     text not null check (channel in ('line','email','slack','discord')),
  status      text not null default 'pending' check (status in ('pending','sent','failed')),
  payload     jsonb default '{}'::jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_admin_notifications_ticket_id on public.admin_notifications(ticket_id);

-- =====================================================
-- updated_at 自動更新 trigger
-- =====================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_kb_updated on public.knowledge_base;
create trigger trg_kb_updated before update on public.knowledge_base
for each row execute function public.set_updated_at();

drop trigger if exists trg_tickets_updated on public.tickets;
create trigger trg_tickets_updated before update on public.tickets
for each row execute function public.set_updated_at();

-- =====================================================
-- 範例知識庫資料
-- =====================================================
insert into public.knowledge_base (title, content, category, keywords) values
  ('營業時間', '我們的營業時間為週一至週五 09:00 - 18:00，週六日公休。', 'general', '營業時間,上班時間,幾點,開門,休息'),
  ('如何預約', '可直接於 LINE 聊天室告訴我們您想預約的日期、時間與服務項目，我們會於 1 個工作日內回覆確認。', 'booking', '預約,訂位,booking,如何預約'),
  ('退款政策', '商品收到 7 日內未拆封可申請退款。請提供訂單編號，我們會於 3 個工作日內處理。', 'refund', '退款,退貨,退費,refund'),
  ('付款方式', '我們支援信用卡、LINE Pay、ATM 轉帳與貨到付款。', 'payment', '付款,信用卡,linepay,轉帳,付錢')
on conflict do nothing;
