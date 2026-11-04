-- 机房课堂系统 · 云端数据表
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 可以重复执行，不会报错。

create table if not exists public.app_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 行级安全：每行只属于创建它的账号
alter table public.app_data enable row level security;

drop policy if exists "app_data_select_own" on public.app_data;
create policy "app_data_select_own" on public.app_data
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "app_data_insert_own" on public.app_data;
create policy "app_data_insert_own" on public.app_data
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "app_data_update_own" on public.app_data;
create policy "app_data_update_own" on public.app_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 权限这道门也要单独开：只给登录用户，匿名用户一律拒绝
grant select, insert, update on public.app_data to authenticated;
revoke all on public.app_data from anon;
