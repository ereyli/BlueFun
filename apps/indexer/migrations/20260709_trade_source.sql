alter table trades add column if not exists source text not null default 'curve';

update trades t
set source = 'uniswap_v4'
from graduations g
where t.scope = g.scope
  and t.launch_id = g.launch_id
  and t.block_number is not null
  and g.block_number is not null
  and t.block_number >= g.block_number;
