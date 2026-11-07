-- A sign-in made before the player's email was on the list never got linked. Link it whenever an
-- admin sets or changes a player's email, and let the app link the signed-in user on demand.
create or replace function public.link_player_on_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.user_id is null then
    select u.id into new.user_id from auth.users u
      where lower(u.email) = lower(new.email)
        and not exists (select 1 from public.players p where p.user_id = u.id and p.id <> new.id)
      limit 1;
  end if;
  return new;
end $$;
create trigger link_player_on_email before insert or update of email on public.players
  for each row execute function public.link_player_on_email();

create or replace function public.link_me() returns bigint
language plpgsql security definer set search_path = '' as $$
declare pid bigint;
begin
  select id into pid from public.players where user_id = auth.uid();
  if pid is not null then return pid; end if;
  update public.players p set user_id = auth.uid()
    where p.user_id is null and lower(p.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
    returning p.id into pid;
  return pid;
end $$;
revoke execute on function public.link_player_on_email() from public, anon, authenticated;
revoke execute on function public.link_me() from public, anon;
grant execute on function public.link_me() to authenticated;
