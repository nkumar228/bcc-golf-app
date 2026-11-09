-- On the clock (Nitin 2026-11-09): minutes behind the group in front (while behind pace) that puts a group on the clock.
alter table public.seasons add column if not exists clock_minutes int not null default 15 check (clock_minutes between 1 and 120);
