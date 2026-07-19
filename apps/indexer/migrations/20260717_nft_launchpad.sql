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

create index if not exists nft_collections_creator_idx
  on nft_collections (chain_id, lower(creator), created_block desc);
create index if not exists nft_collections_standard_idx
  on nft_collections (chain_id, standard, created_block desc);

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

create index if not exists nft_mints_collection_idx
  on nft_mints (chain_id, collection, token_id, block_number desc);

create or replace function increment_nft_lifetime_minted(p_chain_id integer, p_collection text, p_token_id numeric, p_quantity numeric)
returns void language sql security definer set search_path = public as $$
  update nft_items set lifetime_minted = lifetime_minted + greatest(p_quantity, 0)
  where chain_id = p_chain_id and collection = lower(p_collection) and token_id = p_token_id;
$$;
revoke all on function increment_nft_lifetime_minted(integer, text, numeric, numeric) from public;
grant execute on function increment_nft_lifetime_minted(integer, text, numeric, numeric) to service_role;

create table if not exists nft_listings (
  chain_id integer not null, listing_id numeric not null, seller text not null, collection text not null,
  token_id numeric not null, original_quantity numeric not null, remaining_quantity numeric not null,
  unit_price numeric not null, start_time numeric not null, end_time numeric not null,
  cancelled boolean not null default false, created_tx text not null, created_block numeric,
  updated_at timestamptz not null default now(), primary key (chain_id, listing_id)
);
create index if not exists nft_listings_item_idx on nft_listings (chain_id, collection, token_id, updated_at desc);

create table if not exists nft_sales (
  chain_id integer not null, listing_id numeric not null, buyer text not null, recipient text not null,
  quantity numeric not null, gross_amount numeric not null, platform_fee numeric not null,
  royalty_recipient text not null, royalty_amount numeric not null, tx_hash text not null,
  log_index integer not null, block_number numeric, created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists nft_sales_item_idx on nft_sales (chain_id, listing_id, block_number desc);

create or replace function apply_nft_sale(p_chain_id integer, p_listing_id numeric, p_quantity numeric)
returns void language sql security definer set search_path = public as $$
  update nft_listings set remaining_quantity = greatest(remaining_quantity - greatest(p_quantity, 0), 0), updated_at = now()
  where chain_id = p_chain_id and listing_id = p_listing_id;
$$;
revoke all on function apply_nft_sale(integer, numeric, numeric) from public;
grant execute on function apply_nft_sale(integer, numeric, numeric) to service_role;

alter table nft_collections enable row level security;
alter table nft_items enable row level security;
alter table nft_mint_phases enable row level security;
alter table nft_mints enable row level security;
alter table nft_listings enable row level security;
alter table nft_sales enable row level security;

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
