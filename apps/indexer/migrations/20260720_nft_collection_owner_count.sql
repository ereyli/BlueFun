create or replace function nft_collection_owner_count(p_chain_id integer, p_collection text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct lower(owner))::bigint
  from nft_balances
  where chain_id = p_chain_id
    and collection = lower(p_collection)
    and balance > 0;
$$;

revoke all on function nft_collection_owner_count(integer, text) from public;
grant execute on function nft_collection_owner_count(integer, text) to anon, authenticated, service_role;
