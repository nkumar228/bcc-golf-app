// Weekly-ish backup + keep-alive (Nitin 2026-11-13: stay on the free plan).
// A GitHub Actions schedule calls this twice a week. Each call counts as activity (so the free project
// doesn't pause) and saves every league table as one JSON file in the private "backups" bucket,
// once per day at most. Admins download them from the admin site. The newest 26 files are kept.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TABLES = ["players", "courses", "tees", "tee_holes", "greens", "seasons", "teams", "team_players", "events", "matchups",
  "lineups", "scores", "skins", "rounds", "results", "team_results", "net_history", "ringer_history", "full_flock_awards",
  "season_awards", "champions", "cups", "cup_sides", "cup_players", "cup_rounds", "cup_entries", "cup_submissions",
  "cup_match_overrides", "cup_scores", "cup_history", "cup_photos", "cup_availability", "cup_contests"];
const KEEP = 26;

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const day = new Date().toISOString().slice(0, 10), name = `bcc-golf-${day}.json`;
  const { data: files } = await sb.storage.from("backups").list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  if ((files || []).some(f => f.name === name)) return Response.json({ ok: true, skipped: "already backed up today", file: name });
  const out: Record<string, unknown[]> = {}, counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(t).select("*").range(from, from + 999);
      if (error) return Response.json({ ok: false, table: t, error: error.message }, { status: 500 });
      rows.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    out[t] = rows; counts[t] = rows.length;
  }
  const body = JSON.stringify({ made_at: new Date().toISOString(), tables: out });
  const { error } = await sb.storage.from("backups").upload(name, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const old = (files || []).filter(f => f.name.startsWith("bcc-golf-")).map(f => f.name).sort().reverse().slice(KEEP - 1);
  if (old.length) await sb.storage.from("backups").remove(old);
  return Response.json({ ok: true, file: name, bytes: body.length, counts });
});
