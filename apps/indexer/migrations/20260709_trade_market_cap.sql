alter table trades add column if not exists market_cap_eth numeric;

create index if not exists trades_scope_launch_block_idx on trades (scope, launch_id, block_number desc);
