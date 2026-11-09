-- Seasons each player has played (ringer history plus finalized app seasons), for "how long it took" on the Full Flock page
create or replace function public.player_seasons()
returns table (player_id bigint, year int) language sql stable security definer set search_path = '' as $$
  select distinct h.player_id, h.year from public.ringer_history h
  union
  select distinct r.player_id, extract(year from e.play_date)::int from public.results r join public.events e on e.id = r.event_id
  where e.status = 'final' and r.player_id is not null;
$$;
revoke execute on function public.player_seasons() from public, anon;
grant execute on function public.player_seasons() to authenticated;
