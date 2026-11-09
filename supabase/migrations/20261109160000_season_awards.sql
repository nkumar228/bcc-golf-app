-- End-of-season awards (from Nitin's Awards sheet). The admin Awards tab fills these from the season's data;
-- manual = true means an admin typed it (the Kinnett Award, or an override) and a recalculation leaves it alone.
create table if not exists public.season_awards (
  season_id bigint not null references public.seasons(id) on delete cascade,
  award text not null,
  winner text,
  value text,
  manual boolean not null default false,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, award)
);
alter table public.season_awards enable row level security;
create policy "members read" on public.season_awards for select to authenticated using (public.is_player());
create policy "admins write" on public.season_awards for all to authenticated using (public.is_admin()) with check (public.is_admin());
