create index if not exists launches_scope_created_id_idx
  on launches (scope, created_block, id desc);

create index if not exists launches_scope_status_id_idx
  on launches (scope, status, id desc);

create index if not exists launches_scope_progress_id_idx
  on launches (scope, progress desc, id desc);

create index if not exists launches_scope_creator_idx
  on launches (scope, creator);

create index if not exists trades_scope_block_idx
  on trades (scope, block_number);

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
