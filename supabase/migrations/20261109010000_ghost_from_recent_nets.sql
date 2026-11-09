-- Past weekly net scores from before this system (2026 GolfSoftware reports), one row per golfer per week.
create table public.net_history (
  id bigint generated always as identity primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  course_id bigint not null references public.courses(id),
  played_on date not null,
  net integer not null,
  label text,
  unique (player_id, played_on)
);
alter table public.net_history enable row level security;
create policy "members read" on public.net_history for select to authenticated using (public.is_player());
create policy "admins write" on public.net_history for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ghost net for a missing regular: average of their last 3 nets on this nine before the date
-- (past seasons count), rounded to a whole number; the season's ghost net until they have 3.
create or replace function public.ghost_net(p_player bigint, p_course bigint, p_before date, p_default int)
returns int language sql stable security definer set search_path = '' as $$
  select case when count(*) >= 3 then round(avg(net))::int else p_default end
  from (
    select net from (
      select h.played_on d, h.net from public.net_history h
        where h.player_id = p_player and h.course_id = p_course and h.played_on < p_before
      union all
      select e.play_date, r.net from public.results r join public.events e on e.id = r.event_id
        where r.player_id = p_player and r.kind <> 'ghost' and e.course_id = p_course and e.play_date < p_before
    ) x order by d desc limit 3
  ) y;
$$;
grant execute on function public.ghost_net(bigint, bigint, date, int) to authenticated;

-- Every player's ghost net for one week, in one call.
create or replace function public.ghost_nets(p_course bigint, p_before date, p_default int)
returns table (player_id bigint, net int) language sql stable security definer set search_path = '' as $$
  select p.id, public.ghost_net(p.id, p_course, p_before, p_default) from public.players p;
$$;
grant execute on function public.ghost_nets(bigint, date, int) to authenticated;
