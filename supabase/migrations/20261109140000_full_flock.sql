-- Full Flock Award: better than par on all 18 Avon Fields holes over a lifetime.
-- ringer_history holds each player's best score per hole per season before this system (from Nitin's Lifetime Ringer sheet);
-- seasons played in the app add their finalized scores automatically.
create table public.ringer_history (
  player_id bigint not null references public.players(id) on delete cascade,
  year int not null,
  hole int not null check (hole between 1 and 18),
  strokes int not null,
  primary key (player_id, year, hole)
);
alter table public.ringer_history enable row level security;
create policy "members read" on public.ringer_history for select to authenticated using (public.is_player());
create policy "admins write" on public.ringer_history for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.full_flock_awards (
  player_id bigint primary key references public.players(id) on delete cascade,
  achieved_year int not null,
  created_at timestamptz not null default now()
);
alter table public.full_flock_awards enable row level security;
create policy "members read" on public.full_flock_awards for select to authenticated using (public.is_player());
create policy "admins write" on public.full_flock_awards for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Each player's lifetime best on every hole, and the first year they beat par there
create or replace function public.lifetime_ringer()
returns table (player_id bigint, hole int, best int, first_under int) language sql stable security definer set search_path = '' as $$
  with s as (
    select h.player_id, h.year, h.hole, h.strokes from public.ringer_history h
    union all
    select sc.player_id, extract(year from e.play_date)::int, sc.hole, sc.strokes
      from public.scores sc join public.events e on e.id = sc.event_id
      where e.status = 'final' and sc.strokes is not null
        and exists (select 1 from public.results r where r.event_id = e.id and r.player_id = sc.player_id)
  ), par as (
    select th.hole, min(th.par) par from public.tee_holes th join public.tees t on t.id = th.tee_id where t.name = 'Blue' group by th.hole
  )
  select s.player_id, s.hole, min(s.strokes)::int, (min(s.year) filter (where s.strokes < par.par))::int
  from s join par on par.hole = s.hole group by s.player_id, s.hole;
$$;
grant execute on function public.lifetime_ringer() to authenticated;

-- After a week is finalized: record anyone who just completed all 18 and return them (admins only)
create or replace function public.full_flock_check()
returns table (player_id bigint, achieved_year int, name text) language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  with done as (
    select l.player_id, max(l.first_under) y from public.lifetime_ringer() l
    group by l.player_id having count(l.first_under) = 18
  ), ins as (
    insert into public.full_flock_awards (player_id, achieved_year)
    select d.player_id, d.y from done d on conflict do nothing returning full_flock_awards.player_id, full_flock_awards.achieved_year
  )
  select i.player_id, i.achieved_year, p.first_name || ' ' || p.last_name from ins i join public.players p on p.id = i.player_id;
end $$;
grant execute on function public.full_flock_check() to authenticated;
