-- Who's available each Cup round. Side players are available unless marked out;
-- a sub plays in a round only once the commissioner names the side they sub for.
create table public.cup_availability (
  round_id bigint not null references public.cup_rounds(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  available boolean not null default true,
  sub_side_id bigint references public.cup_sides(id) on delete set null,
  primary key (round_id, player_id)
);
alter table public.cup_availability enable row level security;
create policy "members read" on public.cup_availability for select to authenticated using (public.is_player());
create policy "admins write" on public.cup_availability for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- May this player play for this side in this round?
create or replace function public.cup_can_play(p_round bigint, p_side bigint, p_player bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cup_rounds r join public.cup_players cp on cp.cup_id = r.cup_id and cp.player_id = p_player
      left join public.cup_availability a on a.round_id = r.id and a.player_id = p_player
    where r.id = p_round and (
      (cp.side_id = p_side and coalesce(a.available, true))
      or (cp.side_id is null and a.sub_side_id = p_side)));
$$;

-- Matches in a round: the bigger side counting who's available (and the subs named for it)
create or replace function public.cup_match_count(p_round bigint) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(r.matches, (select greatest(1, ceil(max(n)::numeric / case when r.format = 'singles' then 1 else 2 end)::int)
    from (select s.id, (select count(*) from public.cup_players cp where cp.cup_id = r.cup_id and public.cup_can_play(r.id, s.id, cp.player_id)) n
          from public.cup_sides s where s.cup_id = r.cup_id) q))
  from public.cup_rounds r where r.id = p_round;
$$;

create or replace function public.cup_place(p_round bigint, p_side bigint, p_player bigint, p_partner bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds; t record;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status <> 'lineups' then raise exception 'Lineups aren''t open for this round'; end if;
  if r.blind then raise exception 'This round is a blind draw'; end if;
  if not public.cup_is_captain(p_side) then raise exception 'Only this side''s captain can do that'; end if;
  select * into t from public.cup_turn(p_round);
  if t.side_id is null then raise exception 'Every match is already set'; end if;
  if t.side_id <> p_side then raise exception 'It''s the other captain''s turn'; end if;
  if p_player is null then raise exception 'Pick a player'; end if;
  if r.format <> 'singles' and p_partner is null then raise exception 'Pick a partner'; end if;
  if p_player = p_partner then raise exception 'Pick two different players'; end if;
  if not public.cup_can_play(p_round, p_side, p_player) or (r.format <> 'singles' and not public.cup_can_play(p_round, p_side, p_partner)) then
    raise exception 'That player isn''t available for your side this round'; end if;
  if exists (select 1 from public.cup_entries e where e.round_id = p_round and (e.player_id in (p_player, p_partner) or e.partner_id in (p_player, p_partner))) then
    raise exception 'That player is already in a match this round'; end if;
  insert into public.cup_entries (round_id, side_id, slot, player_id, partner_id)
    values (p_round, p_side, t.slot, p_player, case when r.format = 'singles' then null else p_partner end);
end $$;

revoke execute on function public.cup_can_play(bigint, bigint, bigint) from public, anon;
grant execute on function public.cup_can_play(bigint, bigint, bigint) to authenticated, service_role;
