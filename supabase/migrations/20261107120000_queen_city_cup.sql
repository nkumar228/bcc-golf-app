-- Queen City Cup: season-ending match play between two sides (Article XII of the rulebook).
-- Captains enter lineups; a lineup stays hidden from everyone but its captain and admins until the
-- other captain may respond (after it is submitted) or until an admin reveals the round.

create table public.cups (
  id bigint generated always as identity primary key,
  name text not null,
  year int not null,
  active boolean not null default false,          -- the app's Cup mode toggle
  defending_side_id bigint,
  created_at timestamptz not null default now()
);
create table public.cup_sides (
  id bigint generated always as identity primary key,
  cup_id bigint not null references public.cups(id) on delete cascade,
  name text not null,
  color text not null default '#e8711c',
  captain_id bigint references public.players(id) on delete set null,
  sort int not null default 0
);
alter table public.cups add constraint cups_defending_side_fk foreign key (defending_side_id) references public.cup_sides(id) on delete set null;
create table public.cup_players (
  cup_id bigint not null references public.cups(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  side_id bigint not null references public.cup_sides(id) on delete cascade,
  handicap_index numeric(5,2),                    -- frozen when the player is added or refreshed
  primary key (cup_id, player_id)
);
create table public.cup_rounds (
  id bigint generated always as identity primary key,
  cup_id bigint not null references public.cups(id) on delete cascade,
  number int not null,
  name text not null,
  play_date date,
  tee_time time,
  course_id bigint references public.courses(id),
  course2_id bigint references public.courses(id),   -- back nine for an 18-hole round made of two nines
  holes int not null default 9 check (holes in (9, 18)),
  format text check (format in ('four_ball','four_ball_agg','alternate_shot','greensome','chapman','scramble','singles')),
  format_side_id bigint references public.cup_sides(id) on delete set null,   -- captain who picks the format
  order_side_id bigint references public.cup_sides(id) on delete set null,    -- captain who picks submit first / respond
  first_side_id bigint references public.cup_sides(id) on delete set null,    -- side that submits first
  allow_blind boolean not null default false,
  blind boolean not null default false,
  status text not null default 'setup' check (status in ('setup','lineups','revealed','final')),
  revealed_at timestamptz,
  unique (cup_id, number)
);
create table public.cup_entries (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.cup_rounds(id) on delete cascade,
  side_id bigint not null references public.cup_sides(id) on delete cascade,
  slot int not null check (slot between 1 and 30),
  player_id bigint references public.players(id),
  partner_id bigint references public.players(id),
  unique (round_id, side_id, slot)
);
create table public.cup_submissions (
  round_id bigint not null references public.cup_rounds(id) on delete cascade,
  side_id bigint not null references public.cup_sides(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (round_id, side_id)
);
-- Admin result for a match: forfeits, halves for equal absences, or a hand-entered result
create table public.cup_match_overrides (
  round_id bigint not null references public.cup_rounds(id) on delete cascade,
  slot int not null,
  winner_side_id bigint references public.cup_sides(id) on delete cascade,  -- null = halved
  note text,
  primary key (round_id, slot)
);
create table public.cup_scores (
  round_id bigint not null references public.cup_rounds(id) on delete cascade,
  side_id bigint not null references public.cup_sides(id) on delete cascade,
  slot int not null,
  player_id bigint not null references public.players(id),   -- one-ball formats score under the first player
  hole int not null check (hole between 1 and 18),
  strokes int not null check (strokes between 1 and 20),
  entered_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (round_id, side_id, slot, player_id, hole)
);

-- Helpers
create function public.my_player_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.players where user_id = auth.uid() and active limit 1;
$$;
create function public.cup_is_captain(p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cup_sides s join public.players p on p.id = s.captain_id
                 where s.id = p_side and p.user_id = auth.uid());
$$;
create function public.cup_submitted(p_round bigint, p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cup_submissions where round_id = p_round and side_id = p_side);
$$;
-- Who may see a side's lineup for a round
create function public.cup_can_see(p_round bigint, p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or public.cup_is_captain(p_side)
      or exists (select 1 from public.cup_rounds r where r.id = p_round and (
           r.status in ('revealed','final')
           or (not r.blind and r.first_side_id = p_side and public.cup_submitted(r.id, p_side)
               and exists (select 1 from public.cup_sides o where o.cup_id = r.cup_id and o.id <> p_side and public.cup_is_captain(o.id)))));
$$;
-- May a captain change this side's lineup now
create function public.cup_can_edit(p_round bigint, p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.cup_is_captain(p_side) and exists (
    select 1 from public.cup_rounds r where r.id = p_round and r.status = 'lineups'
      and not public.cup_submitted(r.id, p_side)
      and (r.blind or r.first_side_id = p_side or (r.first_side_id is not null and public.cup_submitted(r.id, r.first_side_id))));
$$;

-- Captain actions
create function public.cup_set_format(p_round bigint, p_format text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status not in ('setup','lineups') then raise exception 'This round is not open'; end if;
  if not (public.is_admin() or (r.format_side_id is not null and public.cup_is_captain(r.format_side_id))) then raise exception 'Only the captain picking the format can do that'; end if;
  if exists (select 1 from public.cup_submissions where round_id = p_round) then raise exception 'A lineup is already in'; end if;
  if p_format not in ('four_ball','four_ball_agg','alternate_shot','greensome','chapman','scramble','singles') then raise exception 'Unknown format'; end if;
  update public.cup_rounds set format = p_format where id = p_round;
end $$;
create function public.cup_set_order(p_round bigint, p_first_side bigint, p_blind boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status not in ('setup','lineups') then raise exception 'This round is not open'; end if;
  if not (public.is_admin() or (r.order_side_id is not null and public.cup_is_captain(r.order_side_id))) then raise exception 'Only the captain picking the order can do that'; end if;
  if exists (select 1 from public.cup_submissions where round_id = p_round) then raise exception 'A lineup is already in'; end if;
  if coalesce(p_blind, false) and not r.allow_blind then raise exception 'Blind draw is only for the Final'; end if;
  if not coalesce(p_blind, false) and not exists (select 1 from public.cup_sides where id = p_first_side and cup_id = r.cup_id) then raise exception 'Pick a side'; end if;
  update public.cup_rounds set blind = coalesce(p_blind, false), first_side_id = case when coalesce(p_blind, false) then null else p_first_side end where id = p_round;
end $$;
create function public.cup_submit(p_round bigint, p_side bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds; n int; dup int;
begin
  select * into r from public.cup_rounds where id = p_round;
  if not public.cup_can_edit(p_round, p_side) then raise exception 'You can''t submit this lineup now'; end if;
  if r.format is null then raise exception 'The format hasn''t been picked yet'; end if;
  select count(*) into n from public.cup_entries where round_id = p_round and side_id = p_side and player_id is not null;
  if n = 0 then raise exception 'The lineup is empty'; end if;
  select count(*) - count(distinct x) into dup from (
    select player_id x from public.cup_entries where round_id = p_round and side_id = p_side and player_id is not null
    union all select partner_id from public.cup_entries where round_id = p_round and side_id = p_side and partner_id is not null) q;
  if dup > 0 then raise exception 'Someone is in the lineup twice'; end if;
  insert into public.cup_submissions (round_id, side_id) values (p_round, p_side);
end $$;

revoke execute on function public.my_player_id(), public.cup_is_captain(bigint), public.cup_submitted(bigint, bigint),
  public.cup_can_see(bigint, bigint), public.cup_can_edit(bigint, bigint),
  public.cup_set_format(bigint, text), public.cup_set_order(bigint, bigint, boolean), public.cup_submit(bigint, bigint) from public, anon;
grant execute on function public.my_player_id(), public.cup_is_captain(bigint), public.cup_submitted(bigint, bigint),
  public.cup_can_see(bigint, bigint), public.cup_can_edit(bigint, bigint),
  public.cup_set_format(bigint, text), public.cup_set_order(bigint, bigint, boolean), public.cup_submit(bigint, bigint) to authenticated;

-- Row level security
do $$
declare t text;
begin
  foreach t in array array['cups','cup_sides','cup_players','cup_rounds','cup_submissions','cup_match_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_player())', t);
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

alter table public.cup_entries enable row level security;
create policy "see allowed lineups" on public.cup_entries for select to authenticated using (public.is_player() and public.cup_can_see(round_id, side_id));
create policy "admins write" on public.cup_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "captains add" on public.cup_entries for insert to authenticated with check (public.cup_can_edit(round_id, side_id));
create policy "captains change" on public.cup_entries for update to authenticated using (public.cup_can_edit(round_id, side_id)) with check (public.cup_can_edit(round_id, side_id));
create policy "captains remove" on public.cup_entries for delete to authenticated using (public.cup_can_edit(round_id, side_id));

alter table public.cup_scores enable row level security;
create policy "members read" on public.cup_scores for select to authenticated using (public.is_player());
create policy "admins write" on public.cup_scores for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "players enter cup scores" on public.cup_scores for insert to authenticated
  with check (public.is_player() and exists (select 1 from public.cup_rounds r where r.id = round_id and r.status = 'revealed'));
create policy "players fix cup scores" on public.cup_scores for update to authenticated
  using (public.is_player() and exists (select 1 from public.cup_rounds r where r.id = round_id and r.status = 'revealed'))
  with check (public.is_player());
