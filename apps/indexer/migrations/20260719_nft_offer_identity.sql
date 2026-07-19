-- Keep legacy and V2 offer books completely independent. Existing rows predate V2.
alter table nft_offers add column if not exists offers_contract text;
update nft_offers set offers_contract='0x5bdb354b162df83392cf852a86b31194c1d3906f' where offers_contract is null;
alter table nft_offers alter column offers_contract set not null;
alter table nft_offers alter column offers_contract set default '0x58b7e9f6c980800754cde5c9458e2ec42ebeb0ca';
create index if not exists nft_offers_contract_idx on nft_offers(chain_id,offers_contract,collection,end_time desc);

alter table nft_offer_fills add column if not exists offers_contract text;
update nft_offer_fills set offers_contract='0x5bdb354b162df83392cf852a86b31194c1d3906f' where offers_contract is null;
alter table nft_offer_fills alter column offers_contract set not null;
alter table nft_offer_fills alter column offers_contract set default '0x58b7e9f6c980800754cde5c9458e2ec42ebeb0ca';

alter table nft_offer_nonce_floors add column if not exists offers_contract text;
update nft_offer_nonce_floors set offers_contract='0x5bdb354b162df83392cf852a86b31194c1d3906f' where offers_contract is null;
alter table nft_offer_nonce_floors alter column offers_contract set not null;
alter table nft_offer_nonce_floors alter column offers_contract set default '0x58b7e9f6c980800754cde5c9458e2ec42ebeb0ca';
alter table nft_offer_nonce_floors drop constraint if exists nft_offer_nonce_floors_pkey;
alter table nft_offer_nonce_floors add primary key(chain_id,offers_contract,maker);

drop function if exists apply_nft_offer_fill(integer,text,numeric);
create function apply_nft_offer_fill(
  p_chain_id integer, p_offers_contract text, p_offer_hash text, p_quantity numeric
) returns void language sql security definer set search_path = public as $$
  update nft_offers set filled_quantity=least(quantity,filled_quantity+greatest(p_quantity,0)),updated_at=now()
  where chain_id=p_chain_id and offers_contract=lower(p_offers_contract) and offer_hash=lower(p_offer_hash);
$$;
revoke all on function apply_nft_offer_fill(integer,text,text,numeric) from public;
grant execute on function apply_nft_offer_fill(integer,text,text,numeric) to service_role;

drop function if exists apply_nft_offer_nonce_floor(integer,text,numeric);
create function apply_nft_offer_nonce_floor(
  p_chain_id integer, p_offers_contract text, p_maker text, p_minimum_nonce numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into nft_offer_nonce_floors(chain_id,offers_contract,maker,minimum_nonce)
  values(p_chain_id,lower(p_offers_contract),lower(p_maker),p_minimum_nonce)
  on conflict(chain_id,offers_contract,maker) do update
  set minimum_nonce=greatest(nft_offer_nonce_floors.minimum_nonce,excluded.minimum_nonce),updated_at=now();
  update nft_offers set cancelled=true,updated_at=now()
  where chain_id=p_chain_id and offers_contract=lower(p_offers_contract) and maker=lower(p_maker)
    and nonce<p_minimum_nonce and cancelled=false;
end $$;
revoke all on function apply_nft_offer_nonce_floor(integer,text,text,numeric) from public;
grant execute on function apply_nft_offer_nonce_floor(integer,text,text,numeric) to service_role;
