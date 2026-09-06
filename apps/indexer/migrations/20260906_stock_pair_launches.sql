alter table launches add column if not exists quote_token text;
alter table launches add column if not exists quote_symbol text;
alter table launches add column if not exists quote_name text;
alter table launches add column if not exists quote_price_usd18 numeric;

create index if not exists launches_scope_quote_token_idx
  on launches(scope, lower(quote_token)) where quote_token is not null;

insert into app_schema_metadata(component, version, applied_at)
values ('indexer', '20260906_stock_pair_launches', now())
on conflict(component) do update
set version = excluded.version,
    applied_at = excluded.applied_at;
