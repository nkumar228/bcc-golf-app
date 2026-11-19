-- GPS: the 200-yard spot on par 4s (middle of the fairway), set by an admin on the map.
-- The hole map's target starts here. Empty means 200 yards straight from the tee toward the flag.
alter table public.greens add column if not exists aim_lat double precision, add column if not exists aim_lon double precision;
