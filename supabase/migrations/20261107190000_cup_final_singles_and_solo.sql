-- The Final (the round that allows a blind draw) is always singles.
create or replace function public.cup_set_format(p_round bigint, p_format text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds;
begin
  select * into r from public.cup_rounds where id = p_round;
  if r.id is null or r.status not in ('setup','lineups') then raise exception 'This round is not open'; end if;
  if not (public.is_admin() or (r.format_side_id is not null and public.cup_is_captain(r.format_side_id))) then raise exception 'Only the captain picking the format can do that'; end if;
  if exists (select 1 from public.cup_entries where round_id = p_round) or exists (select 1 from public.cup_submissions where round_id = p_round) then raise exception 'Lineups have already started'; end if;
  if p_format not in ('four_ball','four_ball_agg','alternate_shot','greensome','chapman','scramble','singles') then raise exception 'Unknown format'; end if;
  if r.allow_blind and p_format <> 'singles' then raise exception 'The Final is always singles'; end if;
  update public.cup_rounds set format = p_format where id = p_round;
end $$;

-- In a team round, a side that's one player short may send one golfer out alone (partner left empty).
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
  if p_player = p_partner then raise exception 'Pick two different players'; end if;
  if r.format <> 'singles' and p_partner is null and exists (
      select 1 from public.cup_entries e where e.round_id = p_round and e.side_id = p_side and e.player_id is not null and e.partner_id is null) then
    raise exception 'Only one player per side can play alone in a round'; end if;
  if not public.cup_can_play(p_round, p_side, p_player) or (r.format <> 'singles' and p_partner is not null and not public.cup_can_play(p_round, p_side, p_partner)) then
    raise exception 'That player isn''t available for your side this round'; end if;
  if exists (select 1 from public.cup_entries e where e.round_id = p_round and (e.player_id in (p_player, p_partner) or e.partner_id in (p_player, p_partner))) then
    raise exception 'That player is already in a match this round'; end if;
  insert into public.cup_entries (round_id, side_id, slot, player_id, partner_id)
    values (p_round, p_side, t.slot, p_player, case when r.format = 'singles' then null else p_partner end);
end $$;
