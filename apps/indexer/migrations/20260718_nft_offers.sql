create table if not exists nft_offers (
  chain_id integer not null,
  offer_hash text not null,
  maker text not null,
  taker text not null,
  recipient text not null,
  collection text not null,
  token_id numeric not null,
  unit_price numeric not null,
  quantity numeric not null,
  filled_quantity numeric not null default 0,
  start_time numeric not null,
  end_time numeric not null,
  nonce numeric not null,
  standard smallint not null check (standard in (1,2)),
  offer_type smallint not null check (offer_type in (0,1)),
  signature text not null,
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, offer_hash)
);
create index if not exists nft_offers_collection_idx on nft_offers (chain_id, collection, token_id, offer_type, end_time desc);
create index if not exists nft_offers_maker_idx on nft_offers (chain_id, maker, updated_at desc);

create table if not exists nft_offer_fills (
  chain_id integer not null,
  offer_hash text not null,
  maker text not null,
  seller text not null,
  collection text not null,
  token_id numeric not null,
  quantity numeric not null,
  gross_amount numeric not null,
  platform_fee numeric not null,
  royalty_recipient text not null,
  royalty_amount numeric not null,
  standard smallint not null,
  offer_type smallint not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric,
  created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists nft_offer_fills_offer_idx on nft_offer_fills (chain_id, offer_hash, block_number desc);

create table if not exists nft_offer_nonce_floors (
  chain_id integer not null,
  maker text not null,
  minimum_nonce numeric not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, maker)
);

create or replace function apply_nft_offer_fill(
  p_chain_id integer, p_offer_hash text, p_quantity numeric
) returns void language sql security definer set search_path = public as $$
  update nft_offers set filled_quantity = least(quantity, filled_quantity + greatest(p_quantity, 0)), updated_at = now()
  where chain_id = p_chain_id and offer_hash = lower(p_offer_hash);
$$;
revoke all on function apply_nft_offer_fill(integer,text,numeric) from public;
grant execute on function apply_nft_offer_fill(integer,text,numeric) to service_role;

create or replace function apply_nft_offer_nonce_floor(
  p_chain_id integer, p_maker text, p_minimum_nonce numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into nft_offer_nonce_floors(chain_id,maker,minimum_nonce)
  values(p_chain_id,lower(p_maker),p_minimum_nonce)
  on conflict(chain_id,maker) do update set minimum_nonce=greatest(nft_offer_nonce_floors.minimum_nonce,excluded.minimum_nonce),updated_at=now();
  update nft_offers set cancelled=true,updated_at=now()
  where chain_id=p_chain_id and maker=lower(p_maker) and nonce<p_minimum_nonce and cancelled=false;
end $$;
revoke all on function apply_nft_offer_nonce_floor(integer,text,numeric) from public;
grant execute on function apply_nft_offer_nonce_floor(integer,text,numeric) to service_role;

alter table nft_offers enable row level security;
alter table nft_offer_fills enable row level security;
alter table nft_offer_nonce_floors enable row level security;
drop policy if exists "public read nft offers" on nft_offers;
create policy "public read nft offers" on nft_offers for select using (true);
drop policy if exists "public read nft offer fills" on nft_offer_fills;
create policy "public read nft offer fills" on nft_offer_fills for select using (true);
drop policy if exists "public read nft offer nonce floors" on nft_offer_nonce_floors;
create policy "public read nft offer nonce floors" on nft_offer_nonce_floors for select using (true);
