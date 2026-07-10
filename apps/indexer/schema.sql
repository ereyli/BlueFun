create table if not exists launches (
  scope text not null default 'legacy',
  id numeric not null,
  token text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  contract_uri text not null,
  image_url text,
  description text,
  website_url text,
  twitter_url text,
  telegram_url text,
  discord_url text,
  status text not null default 'live',
  raised_eth numeric not null default 0,
  graduation_target_eth numeric not null default 0,
  progress integer not null default 0,
  volume_eth numeric not null default 0,
  creator_allocation numeric not null default 0,
  created_tx text not null,
  created_block numeric,
  token_created_at numeric,
  created_at timestamptz not null default now(),
  primary key (scope, id)
);

alter table launches add column if not exists scope text not null default 'legacy';
alter table launches add column if not exists raised_eth numeric not null default 0;
alter table launches add column if not exists graduation_target_eth numeric not null default 0;
alter table launches add column if not exists progress integer not null default 0;
alter table launches add column if not exists volume_eth numeric not null default 0;
alter table launches add column if not exists creator_allocation numeric not null default 0;
alter table launches add column if not exists created_block numeric;
alter table launches add column if not exists token_created_at numeric;
alter table launches add column if not exists description text;
alter table launches add column if not exists image_url text;
alter table launches add column if not exists website_url text;
alter table launches add column if not exists twitter_url text;
alter table launches add column if not exists telegram_url text;
alter table launches add column if not exists discord_url text;

create table if not exists trades (
  id bigserial primary key,
  scope text not null default 'legacy',
  launch_id numeric not null,
  trader text not null,
  side text not null check (side in ('buy', 'sell')),
  source text not null default 'curve',
  eth_amount numeric not null,
  token_amount numeric not null,
  market_cap_eth numeric,
  tx_hash text not null,
  block_number numeric,
  created_at timestamptz not null default now()
);

alter table trades add column if not exists scope text not null default 'legacy';
alter table trades add column if not exists block_number numeric;
alter table trades add column if not exists market_cap_eth numeric;
alter table trades add column if not exists source text not null default 'curve';
drop index if exists trades_tx_side_launch_idx;
create unique index if not exists trades_scope_tx_side_launch_idx on trades (scope, tx_hash, side, launch_id);
create index if not exists trades_scope_launch_id_idx on trades (scope, launch_id);
create index if not exists trades_scope_launch_block_idx on trades (scope, launch_id, block_number desc);

create table if not exists graduations (
  scope text not null default 'legacy',
  launch_id numeric not null,
  token text not null,
  position_id text not null,
  tx_hash text not null,
  block_number numeric,
  created_at timestamptz not null default now(),
  primary key (scope, launch_id)
);

alter table graduations add column if not exists scope text not null default 'legacy';
alter table graduations add column if not exists block_number numeric;

update trades t
set source = 'uniswap_v4'
from graduations g
where t.scope = g.scope
  and t.launch_id = g.launch_id
  and t.block_number is not null
  and g.block_number is not null
  and t.block_number >= g.block_number;

create table if not exists indexer_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists api_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);
create index if not exists api_rate_limits_reset_idx on api_rate_limits (reset_at);

create table if not exists chat_messages (
  id text primary key,
  scope text not null,
  chain_id integer not null,
  launch_id numeric not null,
  token text not null,
  wallet text not null,
  text text not null check (char_length(text) between 1 and 240),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_scope_created_idx on chat_messages (scope, created_at desc);
alter table chat_messages enable row level security;

alter table api_rate_limits enable row level security;

create or replace function consume_api_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  delete from api_rate_limits where reset_at < now() - interval '1 hour';
  insert into api_rate_limits (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count = case when api_rate_limits.reset_at <= now() then 1 else api_rate_limits.count + 1 end,
    reset_at = case when api_rate_limits.reset_at <= now() then now() + make_interval(secs => p_window_seconds) else api_rate_limits.reset_at end
  returning count into next_count;
  return next_count <= p_limit;
end;
$$;

revoke all on function consume_api_rate_limit(text, integer, integer) from public;
grant execute on function consume_api_rate_limit(text, integer, integer) to service_role;

create or replace function get_scope_trade_metrics(p_scope text, p_start_block numeric)
returns table(total_volume_eth numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(eth_amount), 0)::numeric
  from trades
  where scope = p_scope and block_number >= p_start_block;
$$;

revoke all on function get_scope_trade_metrics(text, numeric) from public;
grant execute on function get_scope_trade_metrics(text, numeric) to anon, authenticated, service_role;

create or replace function refresh_launch_volume(p_scope text, p_launch_id numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update launches
  set volume_eth = coalesce((
    select sum(eth_amount) from trades
    where scope = p_scope and launch_id = p_launch_id
  ), 0)
  where scope = p_scope and id = p_launch_id;
$$;

revoke all on function refresh_launch_volume(text, numeric) from public;
grant execute on function refresh_launch_volume(text, numeric) to service_role;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'trades_launch_id_fkey') then
    alter table trades drop constraint trades_launch_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'graduations_launch_id_fkey') then
    alter table graduations drop constraint graduations_launch_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'graduations_pkey') then
    alter table graduations drop constraint graduations_pkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'launches_pkey') then
    alter table launches drop constraint launches_pkey;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'launches_pkey') then
    alter table launches add primary key (scope, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'graduations_pkey') then
    alter table graduations add primary key (scope, launch_id);
  end if;
end $$;

alter table launches enable row level security;
alter table trades enable row level security;
alter table graduations enable row level security;

drop policy if exists "public read launches" on launches;
create policy "public read launches" on launches for select using (true);

drop policy if exists "public read trades" on trades;
create policy "public read trades" on trades for select using (true);

drop policy if exists "public read graduations" on graduations;
create policy "public read graduations" on graduations for select using (true);

do $$
begin
  alter publication supabase_realtime add table trades;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
