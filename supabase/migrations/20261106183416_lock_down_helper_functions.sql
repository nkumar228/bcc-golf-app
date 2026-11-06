revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_player() from public, anon;
revoke execute on function public.link_player_on_signup() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_player() to authenticated;
