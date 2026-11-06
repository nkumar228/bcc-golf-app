-- Fixed tee times per season: first time, then one every tee_gap minutes
alter table public.seasons add column first_tee time not null default '17:00', add column tee_gap int not null default 8 check (tee_gap > 0);
