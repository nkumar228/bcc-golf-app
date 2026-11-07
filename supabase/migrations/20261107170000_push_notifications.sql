-- Web push: the sender's keys (made by the push function itself, read only by it) and each phone's subscription.
create table public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
revoke all on public.push_keys from anon, authenticated;

create table public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
create policy "own subs read" on public.push_subs for select to authenticated using (user_id = auth.uid());
create policy "own subs add" on public.push_subs for insert to authenticated with check (user_id = auth.uid());
create policy "own subs change" on public.push_subs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own subs remove" on public.push_subs for delete to authenticated using (user_id = auth.uid());
grant execute on function public.cup_turn(bigint) to service_role;
