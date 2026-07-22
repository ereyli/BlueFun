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
  launch_mode text not null default 'bond',
  pool_fee integer not null default 3000,
  tick_spacing integer not null default 60,
  liquidity_locker text,
  raised_eth numeric not null default 0,
  graduation_target_eth numeric not null default 0,
  progress integer not null default 0,
  volume_eth numeric not null default 0,
  creator_allocation numeric not null default 0,
  created_tx text not null,
  created_block numeric,
  token_created_at numeric,
  position_id text,
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
alter table launches add column if not exists position_id text;
alter table launches add column if not exists launch_mode text not null default 'bond';
alter table launches add column if not exists pool_fee integer not null default 3000;
alter table launches add column if not exists tick_spacing integer not null default 60;
alter table launches add column if not exists liquidity_locker text;
alter table launches add column if not exists description text;
alter table launches add column if not exists image_url text;
alter table launches add column if not exists website_url text;
alter table launches add column if not exists twitter_url text;
alter table launches add column if not exists telegram_url text;
alter table launches add column if not exists discord_url text;
alter table launches add column if not exists current_market_cap_eth numeric;
alter table launches add column if not exists last_trade_block numeric;
create index if not exists launches_scope_market_cap_idx
  on launches(scope, current_market_cap_eth desc nulls last, created_block desc);

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
create index if not exists trades_scope_block_idx on trades (scope, block_number);
create index if not exists trades_scope_trader_block_idx on trades (scope, lower(trader), block_number desc);

create table if not exists graduations (
  scope text not null default 'legacy',
  launch_id numeric not null,
  token text not null,
  position_id text not null,
  pool_id text,
  tx_hash text not null,
  block_number numeric,
  created_at timestamptz not null default now(),
  primary key (scope, launch_id)
);

alter table graduations add column if not exists scope text not null default 'legacy';
alter table graduations add column if not exists block_number numeric;
alter table graduations add column if not exists pool_id text;

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

create index if not exists launches_scope_created_id_idx on launches (scope, created_block, id desc);
create index if not exists launches_scope_status_id_idx on launches (scope, status, id desc);
create index if not exists launches_scope_progress_id_idx on launches (scope, progress desc, id desc);
create index if not exists launches_scope_creator_idx on launches (scope, creator);

create table if not exists nft_collections (
  chain_id integer not null,
  collection_id numeric not null,
  collection text not null,
  factory text not null,
  creator text not null,
  name text not null,
  symbol text not null,
  standard text not null default 'ERC1155' check (standard in ('ERC1155', 'ERC721')),
  contract_uri text not null,
  initial_token_id numeric not null default 1,
  initial_max_supply numeric not null,
  royalty_bps integer not null default 0,
  created_tx text not null,
  created_block numeric,
  created_at timestamptz not null default now(),
  primary key (chain_id, collection),
  unique (chain_id, factory, collection_id)
);
create index if not exists nft_collections_creator_idx on nft_collections (chain_id, lower(creator), created_block desc);
create index if not exists nft_collections_standard_idx on nft_collections (chain_id, standard, created_block desc);

create table if not exists nft_items (
  chain_id integer not null,
  collection text not null,
  token_id numeric not null,
  max_supply numeric not null,
  lifetime_minted numeric not null default 0,
  metadata_uri text not null,
  created_tx text,
  created_block numeric,
  created_at timestamptz not null default now(),
  primary key (chain_id, collection, token_id)
);

create table if not exists nft_mint_phases (
  chain_id integer not null,
  collection text not null,
  token_id numeric not null,
  phase_id numeric not null,
  phase_type integer not null,
  limit_mode integer not null,
  currency text not null,
  mint_price numeric not null,
  start_time numeric not null,
  end_time numeric not null,
  phase_supply_cap numeric not null,
  default_wallet_limit numeric not null,
  max_per_transaction numeric not null,
  merkle_root text not null,
  cancelled boolean not null default false,
  created_tx text,
  created_block numeric,
  updated_at timestamptz not null default now(),
  primary key (chain_id, collection, token_id, phase_id)
);

create table if not exists nft_mints (
  chain_id integer not null,
  collection text not null,
  token_id numeric not null,
  phase_id numeric not null,
  payer text not null,
  recipient text not null,
  quantity numeric not null,
  unit_price numeric not null,
  gross_amount numeric not null,
  platform_fee numeric not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric,
  created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists nft_mints_collection_idx on nft_mints (chain_id, collection, token_id, block_number desc);

create or replace function increment_nft_lifetime_minted(p_chain_id integer, p_collection text, p_token_id numeric, p_quantity numeric)
returns void language sql security definer set search_path = public as $$
  update nft_items set lifetime_minted = lifetime_minted + greatest(p_quantity, 0)
  where chain_id = p_chain_id and collection = lower(p_collection) and token_id = p_token_id;
$$;
revoke all on function increment_nft_lifetime_minted(integer, text, numeric, numeric) from public;
grant execute on function increment_nft_lifetime_minted(integer, text, numeric, numeric) to service_role;

create table if not exists nft_listings (
  chain_id integer not null, marketplace text not null, listing_id numeric not null, seller text not null, collection text not null,
  token_id numeric not null, original_quantity numeric not null, remaining_quantity numeric not null,
  unit_price numeric not null, start_time numeric not null, end_time numeric not null,
  cancelled boolean not null default false, created_tx text not null, created_block numeric,
  updated_at timestamptz not null default now(), primary key (chain_id, marketplace, listing_id)
);
create index if not exists nft_listings_item_idx on nft_listings (chain_id, collection, token_id, updated_at desc);
create index if not exists nft_listings_active_collection_price_idx
  on nft_listings (chain_id, collection, unit_price)
  where cancelled = false and remaining_quantity > 0;
create index if not exists nft_listings_active_item_updated_idx
  on nft_listings (chain_id, collection, token_id, updated_at desc)
  where cancelled = false and remaining_quantity > 0;

create table if not exists nft_sales (
  chain_id integer not null, marketplace text not null, listing_id numeric not null, buyer text not null, recipient text not null,
  quantity numeric not null, gross_amount numeric not null, platform_fee numeric not null,
  royalty_recipient text not null, royalty_amount numeric not null, tx_hash text not null,
  log_index integer not null, block_number numeric, created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists nft_sales_item_idx on nft_sales (chain_id, listing_id, block_number desc);

create table if not exists nft_offers (
  chain_id integer not null, offers_contract text not null, offer_hash text not null, maker text not null, taker text not null,
  recipient text not null, collection text not null, token_id numeric not null, unit_price numeric not null,
  quantity numeric not null, filled_quantity numeric not null default 0, start_time numeric not null,
  end_time numeric not null, nonce numeric not null, standard smallint not null check (standard in (1,2)),
  offer_type smallint not null check (offer_type in (0,1)), signature text not null,
  cancelled boolean not null default false, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), primary key (chain_id,offer_hash)
);
create index if not exists nft_offers_collection_idx on nft_offers (chain_id,collection,token_id,offer_type,end_time desc);
create index if not exists nft_offers_maker_idx on nft_offers (chain_id,maker,updated_at desc);
create table if not exists nft_offer_fills (
  chain_id integer not null, offers_contract text not null, offer_hash text not null, maker text not null, seller text not null,
  collection text not null, token_id numeric not null, quantity numeric not null, gross_amount numeric not null,
  platform_fee numeric not null, royalty_recipient text not null, royalty_amount numeric not null,
  standard smallint not null, offer_type smallint not null, tx_hash text not null, log_index integer not null,
  block_number numeric, created_at timestamptz not null default now(), primary key(chain_id,tx_hash,log_index)
);
create index if not exists nft_offer_fills_offer_idx on nft_offer_fills (chain_id,offer_hash,block_number desc);
create table if not exists nft_offer_nonce_floors (
  chain_id integer not null, offers_contract text not null, maker text not null, minimum_nonce numeric not null,
  updated_at timestamptz not null default now(), primary key(chain_id,offers_contract,maker)
);
create or replace function apply_nft_offer_fill(p_chain_id integer,p_offers_contract text,p_offer_hash text,p_quantity numeric)
returns void language sql security definer set search_path=public as $$
  update nft_offers set filled_quantity=least(quantity,filled_quantity+greatest(p_quantity,0)),updated_at=now()
  where chain_id=p_chain_id and offers_contract=lower(p_offers_contract) and offer_hash=lower(p_offer_hash);
$$;
revoke all on function apply_nft_offer_fill(integer,text,text,numeric) from public;
grant execute on function apply_nft_offer_fill(integer,text,text,numeric) to service_role;
create or replace function apply_nft_offer_nonce_floor(p_chain_id integer,p_offers_contract text,p_maker text,p_minimum_nonce numeric)
returns void language plpgsql security definer set search_path=public as $$ begin
  insert into nft_offer_nonce_floors(chain_id,offers_contract,maker,minimum_nonce) values(p_chain_id,lower(p_offers_contract),lower(p_maker),p_minimum_nonce)
  on conflict(chain_id,offers_contract,maker) do update set minimum_nonce=greatest(nft_offer_nonce_floors.minimum_nonce,excluded.minimum_nonce),updated_at=now();
  update nft_offers set cancelled=true,updated_at=now() where chain_id=p_chain_id and offers_contract=lower(p_offers_contract) and maker=lower(p_maker) and nonce<p_minimum_nonce and cancelled=false;
end $$;
revoke all on function apply_nft_offer_nonce_floor(integer,text,text,numeric) from public;
grant execute on function apply_nft_offer_nonce_floor(integer,text,text,numeric) to service_role;

create or replace function apply_nft_sale(p_chain_id integer, p_marketplace text, p_listing_id numeric, p_quantity numeric)
returns void language sql security definer set search_path = public as $$
  update nft_listings set remaining_quantity = greatest(remaining_quantity - greatest(p_quantity, 0), 0), updated_at = now()
  where chain_id = p_chain_id and marketplace=lower(p_marketplace) and listing_id = p_listing_id;
$$;
revoke all on function apply_nft_sale(integer, text, numeric, numeric) from public;
grant execute on function apply_nft_sale(integer, text, numeric, numeric) to service_role;

alter table nft_collections enable row level security;
alter table nft_items enable row level security;
alter table nft_mint_phases enable row level security;
alter table nft_mints enable row level security;
alter table nft_listings enable row level security;
alter table nft_sales enable row level security;
alter table nft_offers enable row level security;
alter table nft_offer_fills enable row level security;
alter table nft_offer_nonce_floors enable row level security;

drop policy if exists "public read nft collections" on nft_collections;
create policy "public read nft collections" on nft_collections for select using (true);
drop policy if exists "public read nft items" on nft_items;
create policy "public read nft items" on nft_items for select using (true);
drop policy if exists "public read nft phases" on nft_mint_phases;
create policy "public read nft phases" on nft_mint_phases for select using (true);
drop policy if exists "public read nft mints" on nft_mints;
create policy "public read nft mints" on nft_mints for select using (true);
drop policy if exists "public read nft listings" on nft_listings;
create policy "public read nft listings" on nft_listings for select using (true);
drop policy if exists "public read nft sales" on nft_sales;
create policy "public read nft sales" on nft_sales for select using (true);
drop policy if exists "public read nft offers" on nft_offers;
create policy "public read nft offers" on nft_offers for select using (true);
drop policy if exists "public read nft offer fills" on nft_offer_fills;
create policy "public read nft offer fills" on nft_offer_fills for select using (true);
drop policy if exists "public read nft offer nonce floors" on nft_offer_nonce_floors;
create policy "public read nft offer nonce floors" on nft_offer_nonce_floors for select using (true);

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

create or replace function get_scope_launchpad_metrics(p_scope text, p_start_block numeric)
returns table(total_volume_eth numeric, total_tokens bigint, total_creators bigint, total_graduated bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select sum(eth_amount) from trades where scope = p_scope and block_number >= p_start_block), 0)::numeric,
    count(*)::bigint,
    count(distinct creator)::bigint,
    count(*) filter (where status = 'graduated')::bigint
  from launches
  where scope = p_scope and created_block >= p_start_block;
$$;

revoke all on function get_scope_launchpad_metrics(text, numeric) from public;
grant execute on function get_scope_launchpad_metrics(text, numeric) to anon, authenticated, service_role;

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

create or replace function increment_launch_volume(p_scope text, p_launch_id numeric, p_delta numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update launches
  set volume_eth = volume_eth + greatest(p_delta, 0)
  where scope = p_scope and id = p_launch_id;
$$;

revoke all on function increment_launch_volume(text, numeric, numeric) from public;
grant execute on function increment_launch_volume(text, numeric, numeric) to service_role;

create or replace function get_launchpad_metrics(p_scopes text[], p_start_block numeric)
returns table(total_volume_eth numeric, total_tokens bigint, total_creators bigint, total_graduated bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select sum(eth_amount) from trades where scope = any(p_scopes) and block_number >= p_start_block), 0)::numeric,
    count(*)::bigint,
    count(distinct creator)::bigint,
    count(*) filter (where status = 'graduated')::bigint
  from launches
  where scope = any(p_scopes) and created_block >= p_start_block;
$$;

revoke all on function get_launchpad_metrics(text[], numeric) from public;
grant execute on function get_launchpad_metrics(text[], numeric) to anon, authenticated, service_role;

do $$
begin
  perform pg_advisory_xact_lock(hashtext('bluefun_schema_volume_backfill_v1'));
  if not exists (select 1 from indexer_state where key = 'schema:volume_backfill_v1') then
    update launches l
    set volume_eth = coalesce((
      select sum(t.eth_amount) from trades t
      where t.scope = l.scope and t.launch_id = l.id
    ), 0);
    insert into indexer_state (key, value) values ('schema:volume_backfill_v1', 'complete');
  end if;
end $$;

create table if not exists staking_events (
  chain_id integer not null,
  vault text not null,
  event_type text not null check (event_type in ('staked', 'rewards_funded', 'reward_paid')),
  account text,
  recipient text,
  amount numeric not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric not null,
  created_at timestamptz not null default now(),
  primary key (chain_id, vault, tx_hash, log_index)
);
create index if not exists staking_events_vault_block_idx on staking_events (chain_id, vault, block_number);
create index if not exists staking_events_vault_account_idx on staking_events (chain_id, vault, lower(account)) where account is not null;

create table if not exists staking_snapshots (
  chain_id integer not null,
  vault text not null,
  indexed_block numeric not null,
  total_active numeric not null,
  total_cooling numeric not null,
  reward_balance numeric not null,
  queued_rewards numeric not null,
  remaining_rewards numeric not null,
  reward_rate numeric not null,
  rewards_duration numeric not null,
  period_finish numeric not null,
  staking_share_bps integer not null,
  lifetime_funded numeric not null,
  lifetime_claimed numeric not null,
  unique_stakers integer not null,
  active_stakers integer not null,
  paused boolean not null,
  emergency boolean not null,
  stakers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (chain_id, vault)
);

create or replace function get_staking_event_summary(p_chain_id integer, p_vault text)
returns table(lifetime_funded numeric, lifetime_claimed numeric, accounts text[])
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(amount) filter (where event_type = 'rewards_funded'), 0)::numeric,
    coalesce(sum(amount) filter (where event_type = 'reward_paid'), 0)::numeric,
    coalesce(array_agg(distinct lower(account)) filter (where event_type = 'staked' and account is not null), array[]::text[])
  from staking_events
  where chain_id = p_chain_id and vault = lower(p_vault);
$$;
revoke all on function get_staking_event_summary(integer, text) from public;
grant execute on function get_staking_event_summary(integer, text) to service_role;

alter table staking_events enable row level security;
alter table staking_snapshots enable row level security;
drop policy if exists "public read staking snapshots" on staking_snapshots;
create policy "public read staking snapshots" on staking_snapshots for select using (true);

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

do $$
begin
  alter publication supabase_realtime add table nft_listings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create table if not exists nft_transfers (
  chain_id integer not null, collection text not null, token_id numeric not null,
  from_wallet text not null, to_wallet text not null, quantity numeric not null,
  tx_hash text not null, log_index integer not null, batch_index integer not null default 0,
  block_number numeric, created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index, batch_index)
);
create table if not exists nft_balances (
  chain_id integer not null, collection text not null, token_id numeric not null,
  owner text not null, balance numeric not null default 0,
  updated_block numeric, updated_at timestamptz not null default now(),
  primary key (chain_id, collection, token_id, owner)
);
create index if not exists nft_balances_owner_idx on nft_balances (chain_id, lower(owner), balance desc);

create or replace function nft_collection_owner_count(p_chain_id integer, p_collection text)
returns bigint language sql stable security definer set search_path = public as $$
  select count(distinct lower(owner))::bigint from nft_balances
  where chain_id = p_chain_id and collection = lower(p_collection) and balance > 0;
$$;
revoke all on function nft_collection_owner_count(integer, text) from public;
grant execute on function nft_collection_owner_count(integer, text) to anon, authenticated, service_role;
create or replace function apply_nft_transfer(
  p_chain_id integer, p_collection text, p_token_id numeric, p_from text, p_to text,
  p_quantity numeric, p_tx_hash text, p_log_index integer, p_batch_index integer, p_block_number numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  insert into nft_transfers(chain_id,collection,token_id,from_wallet,to_wallet,quantity,tx_hash,log_index,batch_index,block_number)
  values(p_chain_id,lower(p_collection),p_token_id,lower(p_from),lower(p_to),p_quantity,lower(p_tx_hash),p_log_index,p_batch_index,p_block_number)
  on conflict do nothing;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  if lower(p_from) <> '0x0000000000000000000000000000000000000000' then
    update nft_balances set balance=greatest(balance-p_quantity,0),updated_block=p_block_number,updated_at=now()
    where chain_id=p_chain_id and collection=lower(p_collection) and token_id=p_token_id and owner=lower(p_from);
  end if;
  if lower(p_to) <> '0x0000000000000000000000000000000000000000' then
    insert into nft_balances(chain_id,collection,token_id,owner,balance,updated_block)
    values(p_chain_id,lower(p_collection),p_token_id,lower(p_to),p_quantity,p_block_number)
    on conflict(chain_id,collection,token_id,owner) do update set
      balance=nft_balances.balance+excluded.balance,updated_block=excluded.updated_block,updated_at=now();
  end if;
  return true;
end $$;
revoke all on function apply_nft_transfer(integer,text,numeric,text,text,numeric,text,integer,integer,numeric) from public;
grant execute on function apply_nft_transfer(integer,text,numeric,text,text,numeric,text,integer,integer,numeric) to service_role;
alter table nft_transfers enable row level security;
alter table nft_balances enable row level security;
drop policy if exists "public read nft transfers" on nft_transfers;
create policy "public read nft transfers" on nft_transfers for select using (true);
drop policy if exists "public read nft balances" on nft_balances;
create policy "public read nft balances" on nft_balances for select using (true);

create table if not exists app_schema_metadata (
  component text primary key,
  version text not null,
  applied_at timestamptz not null default now()
);
alter table app_schema_metadata enable row level security;

create or replace function record_trade(
  p_scope text, p_launch_id numeric, p_trader text, p_side text, p_source text,
  p_eth_amount numeric, p_token_amount numeric, p_market_cap_eth numeric,
  p_tx_hash text, p_block_number numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_inserted integer; v_previous_amount numeric;
begin
  if p_side not in ('buy', 'sell') then raise exception 'invalid trade side'; end if;
  insert into trades(scope,launch_id,trader,side,source,eth_amount,token_amount,market_cap_eth,tx_hash,block_number)
  values(p_scope,p_launch_id,lower(p_trader),p_side,p_source,p_eth_amount,p_token_amount,p_market_cap_eth,lower(p_tx_hash),p_block_number)
  on conflict(scope,tx_hash,side,launch_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    update launches set volume_eth=volume_eth+p_eth_amount,
      current_market_cap_eth=coalesce(p_market_cap_eth,current_market_cap_eth),
      last_trade_block=greatest(coalesce(last_trade_block,0),coalesce(p_block_number,0))
    where scope=p_scope and id=p_launch_id;
    return true;
  end if;
  select eth_amount into v_previous_amount from trades
  where scope=p_scope and launch_id=p_launch_id and tx_hash=lower(p_tx_hash) and side=p_side for update;
  update trades set trader=lower(p_trader),source=p_source,eth_amount=p_eth_amount,token_amount=p_token_amount,
    market_cap_eth=p_market_cap_eth,block_number=p_block_number
  where scope=p_scope and launch_id=p_launch_id and tx_hash=lower(p_tx_hash) and side=p_side;
  update launches set volume_eth=greatest(0,volume_eth+p_eth_amount-coalesce(v_previous_amount,0)),
    current_market_cap_eth=case when p_market_cap_eth is not null and coalesce(p_block_number,0)>=coalesce(last_trade_block,0)
      then p_market_cap_eth else current_market_cap_eth end,
    last_trade_block=greatest(coalesce(last_trade_block,0),coalesce(p_block_number,0))
  where scope=p_scope and id=p_launch_id;
  return false;
end $$;
revoke all on function record_trade(text,numeric,text,text,text,numeric,numeric,numeric,text,numeric) from public;
grant execute on function record_trade(text,numeric,text,text,text,numeric,numeric,numeric,text,numeric) to service_role;

update launches l set current_market_cap_eth=latest.market_cap_eth,last_trade_block=latest.block_number
from (
  select distinct on(scope,launch_id) scope,launch_id,market_cap_eth,block_number
  from trades where market_cap_eth is not null
  order by scope,launch_id,block_number desc nulls last,id desc
) latest
where l.scope=latest.scope and l.id=latest.launch_id
  and (l.last_trade_block is null or latest.block_number>=l.last_trade_block);

insert into app_schema_metadata(component,version,applied_at)
values('indexer','20260722_production_hardening',now())
on conflict(component) do update set version=excluded.version,applied_at=excluded.applied_at;
