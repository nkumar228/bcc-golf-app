-- Fixed tee times per season, and handicap variations computed exactly like GolfSoftware:
-- (adjusted gross - rating) x 113 / slope, to one decimal. (The stored rounds.variation column is no longer used.)
alter table public.seasons add column if not exists first_tee time not null default '17:00', add column if not exists tee_gap int not null default 8 check (tee_gap > 0);
create or replace function public.round_variation(gross int, rating numeric, slope int) returns numeric
language sql immutable set search_path = '' as $$ select round((gross - rating) * 113.0 / slope, 1) $$;
create or replace view public.player_handicaps with (security_invoker = true) as
with s as (select handicap_rounds n, handicap_best k, handicap_percent pct from public.seasons where is_current limit 1),
recent as (
  select r.player_id, public.round_variation(r.adjusted_gross, r.rating, r.slope) as variation,
         row_number() over (partition by r.player_id order by coalesce(r.played_on, date '2000-01-01') desc, r.seq desc, r.id desc) rn
  from public.rounds r
),
lastn as (select recent.* from recent, s where rn <= s.n),
cnt as (select player_id, count(*) c from lastn group by player_id),
ranked as (
  select l.player_id, l.variation, c.c,
         row_number() over (partition by l.player_id order by l.variation, l.rn) best_rank
  from lastn l join cnt c using (player_id)
),
used as (
  select r.player_id, r.c, r.variation from ranked r, s
  where r.best_rank <= case when r.c >= s.n then s.k
    else (array[1,1,1,1,1,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8])[least(r.c, 20)] end
)
select u.player_id,
       max(u.c)::int as rounds_available,
       count(*)::int as rounds_used,
       trunc(avg(u.variation), 3) as pre_handicap,
       trunc(avg(u.variation) * (select pct from s) / 100.0, 4) as handicap_index
from used u group by u.player_id;
