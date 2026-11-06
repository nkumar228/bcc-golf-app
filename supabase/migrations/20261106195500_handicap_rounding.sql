-- Nitin 2026-11-06: pre-handicap and handicap index rounded to 2 decimals (course handicap for the night is rounded to a whole number in the app)
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
       round(avg(u.variation), 2) as pre_handicap,
       round(round(avg(u.variation), 2) * (select pct from s) / 100.0, 2) as handicap_index
from used u group by u.player_id;
