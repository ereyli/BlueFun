create table if not exists nft_allowlist_entries (
  chain_id bigint not null,
  collection text not null,
  token_id numeric(78, 0) not null,
  phase_id numeric(78, 0) not null,
  wallet text not null,
  allowance numeric(78, 0) not null,
  unit_price numeric(78, 0) not null,
  merkle_root text not null,
  proof jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, collection, token_id, phase_id, wallet)
);

create index if not exists nft_allowlist_wallet_lookup
  on nft_allowlist_entries (chain_id, wallet, collection, token_id, phase_id);

alter table nft_allowlist_entries enable row level security;
