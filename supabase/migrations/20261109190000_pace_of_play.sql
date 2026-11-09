-- Pace of play on the scorecard (Nitin 2026-11-09): when each hole was first entered, and the season's target time for 9 holes.
alter table public.scores add column if not exists created_at timestamptz default now();
alter table public.seasons add column if not exists pace_minutes int not null default 135 check (pace_minutes between 30 and 600);
alter table public.seasons alter column pace_minutes set default 135;
update public.seasons set pace_minutes = 135 where pace_minutes = 120;
