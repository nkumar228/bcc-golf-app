-- Subs belong to no side (side_id null) but carry a frozen Cup index so captains can use them.
alter table public.cup_players alter column side_id drop not null;
comment on column public.cup_players.side_id is 'null = sub pool (eligible after at least two league rounds)';

-- cup_submit: also refuse a sub who is already playing for the other side in the same round
create or replace function public.cup_submit(p_round bigint, p_side bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cup_rounds; n int; dup int; clash text;
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
  select p.last_name into clash from public.cup_entries mine
    join public.cup_entries theirs on theirs.round_id = mine.round_id and theirs.side_id <> mine.side_id
    join public.players p on p.id in (mine.player_id, mine.partner_id) and p.id in (theirs.player_id, theirs.partner_id)
    where mine.round_id = p_round and mine.side_id = p_side limit 1;
  if clash is not null then raise exception '% is already subbing for the other side this round', clash; end if;
  insert into public.cup_submissions (round_id, side_id) values (p_round, p_side);
end $$;
