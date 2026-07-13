create index if not exists launches_scope_token_suffix_idx
  on launches (scope, right(lower(token), 8));
