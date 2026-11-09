-- Hall of Champions: one row per season with the league (individual) and team champions and photos.
create table public.champions (
  id bigint generated always as identity primary key,
  year int not null unique,
  league_champion text,
  league_photo text,
  team_name text,
  team_players text,
  team_photo text,
  notes text
);
alter table public.champions enable row level security;
create policy "members read" on public.champions for select to authenticated using (public.is_player());
create policy "admins write" on public.champions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Photos added from the admin site go in a public storage bucket; only admins can upload or remove.
insert into storage.buckets (id, name, public) values ('champions', 'champions', true) on conflict (id) do nothing;
create policy "admins upload champion photos" on storage.objects for insert to authenticated with check (bucket_id = 'champions' and public.is_admin());
create policy "admins change champion photos" on storage.objects for update to authenticated using (bucket_id = 'champions' and public.is_admin());
create policy "admins remove champion photos" on storage.objects for delete to authenticated using (bucket_id = 'champions' and public.is_admin());

insert into public.champions (year, league_champion, league_photo, team_name, team_players, team_photo) values
(2024, 'Al Miller', null, 'Weapons of Grass Destruction', 'Matt Wolery and Don Mouch', null),
(2023, 'Derek Woolum', 'champions/image1.jpg', 'Happy Gilmore', 'Tom Leemhuis and Al Miller', 'champions/image2.jpg'),
(2022, 'Derek Woolum', 'champions/image1.jpg', 'FIRGIRBIRGIR', 'Blake McCormick and Max Richardson', 'champions/image3.jpg'),
(2021, 'Matt Wolery', 'champions/image4.jpg', 'Beer Bombers', 'Derek Woolum and Nitin Kumar', 'champions/image5.jpg'),
(2020, 'Derek Woolum', 'champions/image1.jpg', 'Beer Bombers', 'Derek Woolum and Nitin Kumar', 'champions/image6.jpg'),
(2019, 'Max Richardson', 'champions/image7.jpg', 'Missing in Action', 'Jake Wegrzyn and Nate Detmer', null),
(2018, 'Jacob Wegrzyn', 'champions/image8.jpg', 'Happy Gilmore', 'Tom Leemhuis and Al Miller', 'champions/image9.jpg'),
(2017, 'Nik Plavska', 'champions/image10.jpg', 'Missing in Action', 'Jacob Wegrzyn and Nik Plavska', 'champions/image11.jpg'),
(2016, 'Jacob Wegrzyn', 'champions/image8.jpg', 'Roger and Me', 'Roger Thoney and Doug Kinnett', 'champions/image12.jpg'),
(2015, 'Derek Woolum', 'champions/image1.jpg', 'Beer Bombers', 'Derek Woolum and Nitin Kumar', 'champions/image6.jpg'),
(2014, 'Derek Woolum', 'champions/image13.jpg', 'Beer Bombers', 'Derek Woolum and Nitin Kumar', 'champions/image14.jpg'),
(2013, 'Tom Leemhuis', 'champions/image15.jpg', 'Roger and Me', 'Roger Thoney and Doug Kinnett', 'champions/image16.jpg'),
(2012, 'Derek Woolum', 'champions/image17.jpg', 'Dirty Birdies', 'Alex Masino and Rad Szwedowski', null),
(2011, 'Doug Kinnett', 'champions/image18.jpg', 'Roger and Me', 'Roger Thoney and Doug Kinnett', 'champions/image19.jpg'),
(2010, 'Chris Burns', 'champions/image20.jpg', 'In It To Win It', 'Bill Tustin and Mike Kelley', 'champions/image21.jpg'),
(2009, 'Roger Thoney', 'champions/image22.jpg', null, null, null),
(2008, 'Scott Woodruff', 'champions/image23.jpg', null, null, null);
