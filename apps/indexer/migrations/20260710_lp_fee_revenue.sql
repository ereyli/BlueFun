alter table launches add column if not exists position_id text;

create index if not exists launches_scope_position_idx
  on launches (scope, position_id)
  where position_id is not null;
