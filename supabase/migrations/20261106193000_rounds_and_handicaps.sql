-- Every round that counts toward a handicap, across all seasons.
-- App rounds are added when a week is finalized; older GolfSoftware rounds were imported once.
create table public.rounds (
  id bigint generated always as identity primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  season_id bigint references public.seasons(id) on delete set null,
  event_id bigint references public.events(id) on delete set null,
  played_on date,            -- null for imported history; those sort before every dated round
  seq int not null default 0, -- order among rounds with the same date (imported history keeps GolfSoftware's order)
  label text,
  adjusted_gross int not null,
  rating numeric(4,1) not null,
  slope int not null,
  -- Same as GolfSoftware: (adjusted gross - rating) / tee difficulty, tee difficulty = slope/113 to 3 places, result to 1 place
  variation numeric(5,1) generated always as (round((adjusted_gross - rating) / round(slope / 113.0, 3), 1)) stored,
  source text not null default 'app',
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);
create index rounds_player_order on public.rounds (player_id, (coalesce(played_on, date '2000-01-01')) desc, seq desc);

alter table public.rounds enable row level security;
create policy "members read" on public.rounds for select to authenticated using (public.is_player());
create policy "admins write" on public.rounds for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Handicap per player from their most recent rounds, using the current season's settings.
-- With fewer than a full set of rounds, the number used follows GolfSoftware's table (1 of 1..5, 2 of 6..8, ... 8 of 20).
create view public.player_handicaps with (security_invoker = true) as
with s as (select handicap_rounds n, handicap_best k, handicap_percent pct from public.seasons where is_current limit 1),
recent as (
  select r.player_id, r.variation,
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
grant select on public.player_handicaps to authenticated;
