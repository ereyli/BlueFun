-- Publish launch and trade changes so the web UI updates as soon as an indexer
-- commits a new block. The short client poll remains only as a recovery path.
do $$
begin
  alter publication supabase_realtime add table launches;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table trades;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

insert into app_schema_metadata(component, version, applied_at)
values ('indexer', '20260807_low_latency_realtime', now())
on conflict(component) do update
set version = excluded.version,
    applied_at = excluded.applied_at;
