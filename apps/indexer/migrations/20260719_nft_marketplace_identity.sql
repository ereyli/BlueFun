alter table nft_listings add column if not exists marketplace text;
update nft_listings set marketplace = case when listing_id < 0
  then '0xd16ef0dcf1e7b430d38fe2e26ecfc73f099f25d0'
  else '0xf08f44ac84632c7e3df2e63804fb8eecb4b346bb' end
where marketplace is null;
alter table nft_listings alter column marketplace set not null;
alter table nft_listings drop constraint if exists nft_listings_pkey;
alter table nft_listings add primary key (chain_id, marketplace, listing_id);
create index if not exists nft_listings_legacy_id_idx on nft_listings(chain_id, listing_id);

alter table nft_sales add column if not exists marketplace text;
update nft_sales set marketplace = case when listing_id < 0
  then '0xd16ef0dcf1e7b430d38fe2e26ecfc73f099f25d0'
  else '0xf08f44ac84632c7e3df2e63804fb8eecb4b346bb' end
where marketplace is null;
alter table nft_sales alter column marketplace set not null;

drop function if exists apply_nft_sale(integer, numeric, numeric);
create function apply_nft_sale(p_chain_id integer, p_marketplace text, p_listing_id numeric, p_quantity numeric)
returns void language sql security definer set search_path = public as $$
  update nft_listings set remaining_quantity = greatest(remaining_quantity - greatest(p_quantity, 0), 0), updated_at = now()
  where chain_id = p_chain_id and marketplace = lower(p_marketplace) and listing_id = p_listing_id;
$$;
revoke all on function apply_nft_sale(integer, text, numeric, numeric) from public;
grant execute on function apply_nft_sale(integer, text, numeric, numeric) to service_role;
