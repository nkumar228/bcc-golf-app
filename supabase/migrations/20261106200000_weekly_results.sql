-- Results saved when an admin finalizes a week (one row per lineup slot, ghosts included)
create table public.results (
  event_id bigint not null references public.events(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,
  slot int not null,
  player_id bigint references public.players(id),
  kind text not null default 'regular' check (kind in ('regular','sub','ghost')),
  tee text,
  gross int,
  handicap_index numeric(5,2),
  course_handicap int,
  net int not null,
  place int,
  tied boolean not null default false,
  points numeric(5,2) not null default 0,
  primary key (event_id, team_id, slot)
);
create table public.team_results (
  event_id bigint not null references public.events(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,
  opponent_id bigint references public.teams(id),
  team_net int not null,
  match_points numeric(5,2) not null default 0,
  player_points numeric(6,2) not null default 0,
  total numeric(6,2) not null default 0,
  primary key (event_id, team_id)
);
alter table public.results enable row level security;
alter table public.team_results enable row level security;
create policy "members read" on public.results for select to authenticated using (public.is_player());
create policy "admins write" on public.results for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "members read" on public.team_results for select to authenticated using (public.is_player());
create policy "admins write" on public.team_results for all to authenticated using (public.is_admin()) with check (public.is_admin());
