-- Run this once in: https://app.supabase.com → SQL Editor

create table if not exists public.routes (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users(id) on delete cascade,
  name           text        not null default 'My Route',
  segments       jsonb       not null,        -- [{coords:[[lat,lng],...], distance:number}]
  total_distance float       not null,
  share_token    text        not null unique default encode(gen_random_bytes(12), 'hex'),
  is_shared      boolean     not null default false,
  created_at     timestamptz not null default now()
);

alter table public.routes enable row level security;

-- Users can read their own routes, or any shared route
create policy "read_routes" on public.routes
  for select using (auth.uid() = user_id or is_shared = true);

create policy "insert_routes" on public.routes
  for insert with check (auth.uid() = user_id);

create policy "update_routes" on public.routes
  for update using (auth.uid() = user_id);

create policy "delete_routes" on public.routes
  for delete using (auth.uid() = user_id);
