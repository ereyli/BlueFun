create index if not exists trades_scope_trader_block_idx
  on trades (scope, lower(trader), block_number desc);
