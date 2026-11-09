-- Queen City Cup Final day: contest holes (from Nitin's "Final Day challenges" sheet) and the merch budget for them.
create table if not exists public.cup_contests (
  id bigint generated always as identity primary key,
  cup_id bigint not null references public.cups(id) on delete cascade,
  hole int check (hole between 1 and 18),
  challenge text not null default '',
  credit numeric,
  sort int not null default 0
);
alter table public.cup_contests enable row level security;
create policy "members read" on public.cup_contests for select to authenticated using (public.is_player());
create policy "admins write" on public.cup_contests for all to authenticated using (public.is_admin()) with check (public.is_admin());
alter table public.cups add column if not exists contest_budget numeric;
