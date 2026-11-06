-- People
create table public.players (
  id bigint generated always as identity primary key,
  last_name text not null,
  first_name text not null,
  email text unique,
  phone text,
  user_id uuid unique references auth.users(id) on delete set null,
  is_admin boolean not null default false,
  default_tee text not null default 'Blue' check (default_tee in ('White','Blue','Gold')),
  active boolean not null default true,
  golfsoftware_id int,
  created_at timestamptz not null default now()
);

-- Courses: one row per nine, one row per tee, one row per hole
create table public.courses (
  id bigint generated always as identity primary key,
  name text not null unique
);
create table public.tees (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses(id) on delete cascade,
  name text not null,
  rating numeric(4,1) not null,
  slope int not null,
  par int not null,
  unique (course_id, name)
);
create table public.tee_holes (
  tee_id bigint not null references public.tees(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  par int not null,
  yards int not null,
  stroke_index int not null,
  primary key (tee_id, hole)
);
create table public.greens (
  course_id bigint not null references public.courses(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  front_lat double precision, front_lon double precision,
  mid_lat double precision, mid_lon double precision,
  back_lat double precision, back_lon double precision,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (course_id, hole)
);

-- Season setup
create table public.seasons (
  id bigint generated always as identity primary key,
  name text not null unique,
  year int not null,
  ghost_net int not null default 36,
  points_table int[] not null default array[20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
  team_win int not null default 10,
  team_tie int not null default 5,
  best_of int not null default 15,
  handicap_rounds int not null default 20,
  handicap_best int not null default 8,
  handicap_percent int not null default 100,
  is_current boolean not null default false
);
create table public.teams (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons(id) on delete cascade,
  number int not null,
  name text not null,
  unique (season_id, number)
);
create table public.team_players (
  team_id bigint not null references public.teams(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  primary key (team_id, player_id)
);
create table public.events (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons(id) on delete cascade,
  number int not null,
  play_date date not null,
  course_id bigint not null references public.courses(id),
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','final','rained_out')),
  note text,
  unique (season_id, number)
);
-- Tee sheet: one row per team matchup per event
create table public.matchups (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  tee_time time not null,
  start_hole int not null default 1,
  team_a bigint not null references public.teams(id),
  team_b bigint not null references public.teams(id)
);
-- Who actually played for a team that night (regular, sub or ghost)
create table public.lineups (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  team_id bigint not null references public.teams(id),
  player_id bigint references public.players(id),
  plays_for bigint references public.players(id),
  kind text not null default 'regular' check (kind in ('regular','sub','ghost')),
  tee text not null default 'Blue',
  course_handicap numeric(5,2),
  unique (event_id, player_id)
);
-- Hole-by-hole scores
create table public.scores (
  event_id bigint not null references public.events(id) on delete cascade,
  player_id bigint not null references public.players(id),
  hole int not null check (hole between 1 and 18),
  strokes int not null check (strokes between 1 and 20),
  putts int check (putts between 0 and 10),
  fairway boolean,
  green boolean,
  entered_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id, hole)
);
-- Weekly skins game
create table public.skins (
  event_id bigint primary key references public.events(id) on delete cascade,
  game text not null,
  details text,
  winner text,
  posted_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Link a new sign-in to the player with the same email
create function public.link_player_on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.players set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_player_on_signup();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.players where user_id = auth.uid() and is_admin);
$$;
create function public.is_player() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.players where user_id = auth.uid() and active);
$$;

-- Row level security: league members read everything; admins change setup; players enter scores until a week is final
do $$
declare t text;
begin
  foreach t in array array['players','courses','tees','tee_holes','greens','seasons','teams','team_players','events','matchups','lineups','scores','skins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_player())', t);
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

create policy "players enter scores" on public.scores for insert to authenticated
  with check (public.is_player() and exists (select 1 from public.events e where e.id = event_id and e.status in ('scheduled','in_progress')));
create policy "players fix scores" on public.scores for update to authenticated
  using (public.is_player() and exists (select 1 from public.events e where e.id = event_id and e.status in ('scheduled','in_progress')))
  with check (public.is_player());
create policy "players read own record" on public.players for select to authenticated using (user_id = auth.uid());
