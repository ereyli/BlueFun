alter table launches add column if not exists dex_provider text not null default 'uniswap';

insert into app_schema_metadata(component, version, applied_at)
values ('indexer', '20260805_ekubo_launches', now())
on conflict(component) do update set version = excluded.version, applied_at = excluded.applied_at;
