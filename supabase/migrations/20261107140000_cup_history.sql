-- Results of past Queen City Cups (years before the app, or any year an admin wants to record by hand)
create table public.cup_history (
  id bigint generated always as identity primary key,
  year int not null unique,
  side1_name text not null default 'Orange',
  side1_points numeric(4,1),
  side2_name text not null default 'Blue',
  side2_points numeric(4,1),
  winner text,               -- side name; blank = higher points wins (a tie keeps the Cup with the holder, noted in notes)
  notes text
);
alter table public.cup_history enable row level security;
create policy "members read" on public.cup_history for select to authenticated using (public.is_player());
create policy "admins write" on public.cup_history for all to authenticated using (public.is_admin()) with check (public.is_admin());
