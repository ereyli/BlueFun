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

create index if not exists staking_events_vault_block_idx
  on staking_events (chain_id, vault, block_number);

create index if not exists staking_events_vault_account_idx
  on staking_events (chain_id, vault, lower(account)) where account is not null;

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
language sql
stable
security definer
set search_path = public
as $$
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
