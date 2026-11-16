-- GPS: the green's edge, traced by an admin on the map, as a JSON array of [lat, lon] points.
-- Front and back yardages then follow each player's line through the middle of the green.
alter table public.greens add column if not exists outline jsonb;
