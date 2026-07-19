create table if not exists nft_transfers (
  chain_id integer not null, collection text not null, token_id numeric not null,
  from_wallet text not null, to_wallet text not null, quantity numeric not null,
  tx_hash text not null, log_index integer not null, batch_index integer not null default 0,
  block_number numeric, created_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index, batch_index)
);

create table if not exists nft_balances (
  chain_id integer not null, collection text not null, token_id numeric not null,
  owner text not null, balance numeric not null default 0,
  updated_block numeric, updated_at timestamptz not null default now(),
  primary key (chain_id, collection, token_id, owner)
);
create index if not exists nft_balances_owner_idx on nft_balances (chain_id, lower(owner), balance desc);

create or replace function apply_nft_transfer(
  p_chain_id integer, p_collection text, p_token_id numeric, p_from text, p_to text,
  p_quantity numeric, p_tx_hash text, p_log_index integer, p_batch_index integer, p_block_number numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  insert into nft_transfers(chain_id,collection,token_id,from_wallet,to_wallet,quantity,tx_hash,log_index,batch_index,block_number)
  values(p_chain_id,lower(p_collection),p_token_id,lower(p_from),lower(p_to),p_quantity,lower(p_tx_hash),p_log_index,p_batch_index,p_block_number)
  on conflict do nothing;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  if lower(p_from) <> '0x0000000000000000000000000000000000000000' then
    update nft_balances set balance=greatest(balance-p_quantity,0),updated_block=p_block_number,updated_at=now()
    where chain_id=p_chain_id and collection=lower(p_collection) and token_id=p_token_id and owner=lower(p_from);
  end if;
  if lower(p_to) <> '0x0000000000000000000000000000000000000000' then
    insert into nft_balances(chain_id,collection,token_id,owner,balance,updated_block)
    values(p_chain_id,lower(p_collection),p_token_id,lower(p_to),p_quantity,p_block_number)
    on conflict(chain_id,collection,token_id,owner) do update set
      balance=nft_balances.balance+excluded.balance,updated_block=excluded.updated_block,updated_at=now();
  end if;
  return true;
end $$;

revoke all on function apply_nft_transfer(integer,text,numeric,text,text,numeric,text,integer,integer,numeric) from public;
grant execute on function apply_nft_transfer(integer,text,numeric,text,text,numeric,text,integer,integer,numeric) to service_role;

alter table nft_transfers enable row level security;
alter table nft_balances enable row level security;
drop policy if exists "public read nft transfers" on nft_transfers;
create policy "public read nft transfers" on nft_transfers for select using (true);
drop policy if exists "public read nft balances" on nft_balances;
create policy "public read nft balances" on nft_balances for select using (true);
