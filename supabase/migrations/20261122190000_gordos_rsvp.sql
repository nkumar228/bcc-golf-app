-- Gordo's after league: each player says going or not for a league night; everyone signed in sees the count and names.
create table if not exists public.gordos (
  event_id bigint not null references public.events(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  going boolean not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id)
);
alter table public.gordos enable row level security;
create policy "members read" on public.gordos for select to authenticated using (public.is_player());
create policy "admins write" on public.gordos for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "players answer for themselves" on public.gordos for insert to authenticated with check (player_id = public.my_player_id());
create policy "players change own answer" on public.gordos for update to authenticated using (player_id = public.my_player_id()) with check (player_id = public.my_player_id());
create policy "players clear own answer" on public.gordos for delete to authenticated using (player_id = public.my_player_id());
grant select, insert, update, delete on public.gordos to authenticated;
