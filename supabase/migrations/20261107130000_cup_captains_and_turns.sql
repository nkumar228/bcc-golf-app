-- Captains are a tag on a Cup player (more than one per side is fine).
alter table public.cup_players add column if not exists is_captain boolean not null default false;
-- (No side had a captain set yet, so nothing to copy from cup_sides.captain_id.)
-- Optional fixed number of matches for a round (null = worked out from the side sizes)
alter table public.cup_rounds add column if not exists matches int check (matches between 1 and 30);

create or replace function public.cup_is_captain(p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cup_players cp join public.players p on p.id = cp.player_id
                 where cp.side_id = p_side and cp.is_captain and p.user_id = auth.uid());
$$;

-- How many matches a round has
create or replace function public.cup_match_count(p_round bigint) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(r.matches, (select ceil(max(n)::numeric / case when r.format = 'singles' then 1 else 2 end)::int
                              from (select count(*) n from public.cup_players cp where cp.cup_id = r.cup_id and cp.side_id is not null group by cp.side_id) q))
  from public.cup_rounds r where r.id = p_round;
$$;

-- Whose turn it is in a round that isn't blind. Match 1: first side throws out, other side answers;
-- match 2: the other side throws out, first side answers; and so on, alternating.
create or replace function public.cup_turn(p_round bigint, out side_id bigint, out slot int)
language plpgsql stable security definer set search_path = '' as $$
declare r public.cup_rounds; a bigint; b bigint; n int; thrower bigint; answerer bigint;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.blind or r.first_side_id is null or r.format is null then return; end if;
  a := r.first_side_id;
  select s.id into b from public.cup_sides s where s.cup_id = r.cup_id and s.id <> a order by s.sort, s.id limit 1;
  n := public.cup_match_count(p_round);
  for i in 1..coalesce(n, 0) loop
    thrower := case when i % 2 = 1 then a else b end;
    answerer := case when i % 2 = 1 then b else a end;
    if not exists (select 1 from public.cup_entries e where e.round_id = p_round and e.side_id = thrower and e.slot = i and e.player_id is not null) then
      side_id := thrower; slot := i; return; end if;
    if not exists (select 1 from public.cup_entries e where e.round_id = p_round and e.side_id = answerer and e.slot = i and e.player_id is not null) then
      side_id := answerer; slot := i; return; end if;
  end loop;
end $$;

-- Who may see a side's lineup: admins, that side's captains, and once revealed everyone.
-- In a round that isn't blind, the other captain sees each pick as soon as it's thrown out.
create or replace function public.cup_can_see(p_round bigint, p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or public.cup_is_captain(p_side)
      or exists (select 1 from public.cup_rounds r where r.id = p_round and (
           r.status in ('revealed','final')
           or (not r.blind and exists (select 1 from public.cup_sides o where o.cup_id = r.cup_id and o.id <> p_side and public.cup_is_captain(o.id)))));
$$;

-- Captains edit directly only in a blind round (until they submit). Otherwise picks go through cup_place.
create or replace function public.cup_can_edit(p_round bigint, p_side bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.cup_is_captain(p_side) and exists (
    select 1 from public.cup_rounds r where r.id = p_round and r.status = 'lineups' and r.blind
      and not public.cup_submitted(r.id, p_side));
$$;

create or replace function public.cup_set_order(p_round bigint, p_first_side bigint, p_blind boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status not in ('setup','lineups') then raise exception 'This round is not open'; end if;
  if not (public.is_admin() or (r.order_side_id is not null and public.cup_is_captain(r.order_side_id))) then raise exception 'Only the captain picking the order can do that'; end if;
  if exists (select 1 from public.cup_entries where round_id = p_round) or exists (select 1 from public.cup_submissions where round_id = p_round) then raise exception 'Lineups have already started'; end if;
  if not coalesce(p_blind, false) and not exists (select 1 from public.cup_sides where id = p_first_side and cup_id = r.cup_id) then raise exception 'Pick a side'; end if;
  update public.cup_rounds set blind = coalesce(p_blind, false), first_side_id = case when coalesce(p_blind, false) then null else p_first_side end where id = p_round;
end $$;

create or replace function public.cup_set_format(p_round bigint, p_format text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status not in ('setup','lineups') then raise exception 'This round is not open'; end if;
  if not (public.is_admin() or (r.format_side_id is not null and public.cup_is_captain(r.format_side_id))) then raise exception 'Only the captain picking the format can do that'; end if;
  if exists (select 1 from public.cup_entries where round_id = p_round) or exists (select 1 from public.cup_submissions where round_id = p_round) then raise exception 'Lineups have already started'; end if;
  if p_format not in ('four_ball','four_ball_agg','alternate_shot','greensome','chapman','scramble','singles') then raise exception 'Unknown format'; end if;
  update public.cup_rounds set format = p_format where id = p_round;
end $$;

-- Throw out (or answer with) a pair or a player when it's your turn
create or replace function public.cup_place(p_round bigint, p_side bigint, p_player bigint, p_partner bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds; t record; bad int;
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
  select count(*) into bad from public.players p where p.id in (p_player, p_partner) and not exists (
    select 1 from public.cup_players cp where cp.cup_id = r.cup_id and cp.player_id = p.id and (cp.side_id = p_side or cp.side_id is null));
  if bad > 0 then raise exception 'That player isn''t on your side or in the sub pool'; end if;
  if exists (select 1 from public.cup_entries e where e.round_id = p_round and (e.player_id in (p_player, p_partner) or e.partner_id in (p_player, p_partner))) then
    raise exception 'That player is already in a match this round'; end if;
  insert into public.cup_entries (round_id, side_id, slot, player_id, partner_id)
    values (p_round, p_side, t.slot, p_player, case when r.format = 'singles' then null else p_partner end);
end $$;

-- Take back your last pick, as long as the other captain hasn't picked since
create or replace function public.cup_undo(p_round bigint, p_side bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds; e public.cup_entries;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status <> 'lineups' or r.blind then raise exception 'Nothing to take back'; end if;
  if not public.cup_is_captain(p_side) then raise exception 'Only this side''s captain can do that'; end if;
  select * into e from public.cup_entries where round_id = p_round order by id desc limit 1;
  if e.id is null or e.side_id <> p_side then raise exception 'The other captain has already answered'; end if;
  delete from public.cup_entries where id = e.id;
end $$;

-- Captains build their own side: add any active player who isn't on the other side, or send one of theirs back.
create or replace function public.cup_set_member(p_cup bigint, p_player bigint, p_join boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare mine bigint; cur public.cup_players;
begin
  select cp.side_id into mine from public.cup_players cp join public.players p on p.id = cp.player_id
    where cp.cup_id = p_cup and cp.is_captain and p.user_id = auth.uid() and cp.side_id is not null limit 1;
  if mine is null then raise exception 'Only a captain can do that'; end if;
  select * into cur from public.cup_players where cup_id = p_cup and player_id = p_player;
  if p_join then
    if cur.side_id is not null and cur.side_id <> mine then raise exception 'That player is on the other side'; end if;
    if not exists (select 1 from public.players where id = p_player and active) then raise exception 'Unknown player'; end if;
    if cur.player_id is null then
      insert into public.cup_players (cup_id, player_id, side_id, handicap_index)
        select p_cup, p_player, mine, h.handicap_index from (select 1) x left join public.player_handicaps h on h.player_id = p_player;
    else
      update public.cup_players set side_id = mine where cup_id = p_cup and player_id = p_player;
    end if;
  else
    if cur.side_id is distinct from mine then raise exception 'That player isn''t on your side'; end if;
    if cur.is_captain then raise exception 'A captain can''t be removed here'; end if;
    update public.cup_players set side_id = null where cup_id = p_cup and player_id = p_player;
  end if;
end $$;

revoke execute on function public.cup_match_count(bigint), public.cup_turn(bigint), public.cup_place(bigint, bigint, bigint, bigint),
  public.cup_undo(bigint, bigint), public.cup_set_member(bigint, bigint, boolean) from public, anon;
grant execute on function public.cup_match_count(bigint), public.cup_turn(bigint), public.cup_place(bigint, bigint, bigint, bigint),
  public.cup_undo(bigint, bigint), public.cup_set_member(bigint, bigint, boolean) to authenticated;
