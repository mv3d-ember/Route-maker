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

-- ─── Visitor tracking ────────────────────────────────────────────────────────
-- Replace 'your@email.com' with your actual admin email before running

create table if not exists public.visitors (
  id          uuid        primary key default gen_random_uuid(),
  ip          text,
  country     text,
  city        text,
  region      text,
  latitude    float,
  longitude   float,
  os          text,
  browser     text,
  user_agent  text,
  visited_at  timestamptz not null default now()
);

alter table public.visitors enable row level security;

create policy "insert_visitors" on public.visitors
  for insert with check (true);

create policy "read_visitors" on public.visitors
  for select using (auth.email() = 'mvwhytemail@gmail.com');

-- ─── Admin: list registered users ────────────────────────────────────────────

create or replace function public.admin_get_users()
returns table (
  id                  uuid,
  email               text,
  created_at          timestamptz,
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz,
  route_count         bigint
)
language sql
security definer
stable
as $$
  select
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    count(r.id) as route_count
  from auth.users u
  left join public.routes r on r.user_id = u.id
  where auth.email() = 'mvwhytemail@gmail.com'
  group by u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at
  order by u.created_at desc;
$$;
