create table if not exists launches (
  scope text not null default 'legacy',
  id numeric not null,
  token text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  contract_uri text not null,
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

create table if not exists trades (
  id bigserial primary key,
  scope text not null default 'legacy',
  launch_id numeric not null,
  trader text not null,
  side text not null check (side in ('buy', 'sell')),
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
drop index if exists trades_tx_side_launch_idx;
create unique index if not exists trades_scope_tx_side_launch_idx on trades (scope, tx_hash, side, launch_id);
create index if not exists trades_scope_launch_id_idx on trades (scope, launch_id);

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

create table if not exists indexer_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

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
