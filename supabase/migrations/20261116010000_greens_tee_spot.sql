-- GPS v2: the blue tee spot for each hole, so the hole map can be turned tee-to-green.
-- Admins set it by tapping the map. Empty means the app estimates it from the yardage.
alter table public.greens add column if not exists tee_lat double precision, add column if not exists tee_lon double precision;
