-- One league photo per Queen City Cup year (hand-entered history or Cups played in the app).
-- Files go in the public "champions" storage bucket.
create table public.cup_photos (
  year int primary key,
  photo text not null
);
alter table public.cup_photos enable row level security;
create policy "members read" on public.cup_photos for select to authenticated using (public.is_player());
create policy "admins write" on public.cup_photos for all to authenticated using (public.is_admin()) with check (public.is_admin());
