-- Atomic trade ingestion, deploy-time schema visibility, and event-driven NFT refreshes.

create table if not exists app_schema_metadata (
  component text primary key,
  version text not null,
  applied_at timestamptz not null default now()
);
alter table app_schema_metadata enable row level security;

alter table launches add column if not exists current_market_cap_eth numeric;
alter table launches add column if not exists last_trade_block numeric;
create index if not exists launches_scope_market_cap_idx
  on launches(scope, current_market_cap_eth desc nulls last, created_block desc);

create or replace function record_trade(
  p_scope text,
  p_launch_id numeric,
  p_trader text,
  p_side text,
  p_source text,
  p_eth_amount numeric,
  p_token_amount numeric,
  p_market_cap_eth numeric,
  p_tx_hash text,
  p_block_number numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_previous_amount numeric;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'invalid trade side';
  end if;

  insert into trades (
    scope, launch_id, trader, side, source, eth_amount, token_amount,
    market_cap_eth, tx_hash, block_number
  ) values (
    p_scope, p_launch_id, lower(p_trader), p_side, p_source, p_eth_amount,
    p_token_amount, p_market_cap_eth, lower(p_tx_hash), p_block_number
  )
  on conflict (scope, tx_hash, side, launch_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update launches
    set volume_eth = volume_eth + p_eth_amount,
        current_market_cap_eth = coalesce(p_market_cap_eth, current_market_cap_eth),
        last_trade_block = greatest(coalesce(last_trade_block, 0), coalesce(p_block_number, 0))
    where scope = p_scope and id = p_launch_id;
    return true;
  end if;

  select eth_amount into v_previous_amount
  from trades
  where scope = p_scope and launch_id = p_launch_id
    and tx_hash = lower(p_tx_hash) and side = p_side
  for update;

  update trades set
    trader = lower(p_trader), source = p_source, eth_amount = p_eth_amount,
    token_amount = p_token_amount, market_cap_eth = p_market_cap_eth,
    block_number = p_block_number
  where scope = p_scope and launch_id = p_launch_id
    and tx_hash = lower(p_tx_hash) and side = p_side;

  update launches
  set volume_eth = greatest(0, volume_eth + p_eth_amount - coalesce(v_previous_amount, 0)),
      current_market_cap_eth = case
        when p_market_cap_eth is not null and coalesce(p_block_number, 0) >= coalesce(last_trade_block, 0)
          then p_market_cap_eth else current_market_cap_eth end,
      last_trade_block = greatest(coalesce(last_trade_block, 0), coalesce(p_block_number, 0))
  where scope = p_scope and id = p_launch_id;
  return false;
end;
$$;

revoke all on function record_trade(text,numeric,text,text,text,numeric,numeric,numeric,text,numeric) from public;
grant execute on function record_trade(text,numeric,text,text,text,numeric,numeric,numeric,text,numeric) to service_role;

update launches l set
  current_market_cap_eth = latest.market_cap_eth,
  last_trade_block = latest.block_number
from (
  select distinct on(scope, launch_id) scope, launch_id, market_cap_eth, block_number
  from trades where market_cap_eth is not null
  order by scope, launch_id, block_number desc nulls last, id desc
) latest
where l.scope=latest.scope and l.id=latest.launch_id
  and (l.last_trade_block is null or latest.block_number >= l.last_trade_block);

do $$
begin
  alter publication supabase_realtime add table nft_listings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

insert into app_schema_metadata(component, version, applied_at)
values ('indexer', '20260722_production_hardening', now())
on conflict(component) do update set version=excluded.version, applied_at=excluded.applied_at;
