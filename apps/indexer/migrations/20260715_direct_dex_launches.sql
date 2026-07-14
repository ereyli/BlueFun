alter table graduations add column if not exists pool_id text;
alter table launches add column if not exists launch_mode text not null default 'bond';
alter table launches add column if not exists pool_fee integer not null default 3000;
alter table launches add column if not exists tick_spacing integer not null default 60;
alter table launches add column if not exists liquidity_locker text;
