// Push notifications for the BCC app.
//   {action:"key"}                  -> the public key phones subscribe with (keys are made here on first use)
//   {action:"test"}                 -> a test alert to the caller's own phones
//   {action:"cup_turn", round_id}   -> tells the captain(s) whose pick it is now
//   {action:"full_flock"}           -> tells the admins who just earned the Full Flock Award (admins only)
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const APP = "https://nkumar228.github.io/bcc-golf-app/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const { data: ok } = await caller.rpc("is_player");
    if (!ok) return json({ error: "Not on the league list" }, 403);

    // Sender keys, made once and kept in a table only this function can read
    let { data: k } = await admin.from("push_keys").select("public_key,private_key").eq("id", 1).maybeSingle();
    if (!k) {
      const g = webpush.generateVAPIDKeys();
      await admin.from("push_keys").insert({ id: 1, public_key: g.publicKey, private_key: g.privateKey });
      ({ data: k } = await admin.from("push_keys").select("public_key,private_key").eq("id", 1).maybeSingle());
    }
    webpush.setVapidDetails("mailto:nkumar228@gmail.com", k!.public_key, k!.private_key);

    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json({ key: k!.public_key });

    const send = async (userIds: string[], msg: Record<string, string>) => {
      if (!userIds.length) return 0;
      const { data: subs } = await admin.from("push_subs").select("endpoint,p256dh,auth").in("user_id", userIds);
      let n = 0;
      await Promise.all((subs ?? []).map(async (s) => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 86400 }); n++; }
        catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint); }
      }));
      return n;
    };

    // Every lineup is in: tell the admins it's time to reveal
    const ready = async (r: { id: number; name: string }, cupName?: string) => {
      const { data: admins } = await admin.from("players").select("user_id").eq("is_admin", true).not("user_id", "is", null);
      const ids = (admins ?? []).map((a) => a.user_id as string); // the admin who made the last pick gets it too, as a confirmation
      return await send(ids, { title: "Ready to reveal", body: `${cupName ?? "Queen City Cup"}, ${r.name}: every lineup is in. Reveal the matchups in the admin Cup tab.`, url: APP + "admin.html", tag: `cup-ready-${r.id}` });
    };

    if (body.action === "test") return json({ sent: await send([u.user.id], { title: "BCC Golf", body: "Cup alerts are on for this phone.", url: APP + "#captain", tag: "test" }) });

    // Captains have picked the format and the order: tell the admins
    if (body.action === "cup_setup") {
      const rid = Number(body.round_id);
      const { data: r } = await admin.from("cup_rounds").select("id,cup_id,name,status,blind,format,first_side_id").eq("id", rid).maybeSingle();
      if (!r || !r.format || (!r.blind && !r.first_side_id) || !["setup", "lineups"].includes(r.status)) return json({ sent: 0 });
      const { data: cup } = await admin.from("cups").select("name").eq("id", r.cup_id).maybeSingle();
      const { data: first } = r.first_side_id ? await admin.from("cup_sides").select("name").eq("id", r.first_side_id).maybeSingle() : { data: null };
      const label: Record<string, string> = { four_ball: "Four Ball", four_ball_agg: "Four Ball Aggregate", alternate_shot: "Alternate Shot", greensome: "Greensome", chapman: "Chapman", scramble: "Scramble", singles: "Singles" };
      const order = r.blind ? "blind picks" : `${first?.name ?? "?"} goes first`;
      const { data: admins } = await admin.from("players").select("user_id").eq("is_admin", true).not("user_id", "is", null);
      const ids = (admins ?? []).map((a) => a.user_id as string); // the admin who made the last pick gets it too, as a confirmation
      return json({ sent: await send(ids, { title: "Format and order are in", body: `${cup?.name ?? "Queen City Cup"}, ${r.name}: ${label[r.format] ?? r.format}, ${order}.${r.status === "setup" ? " Open lineups when you're ready." : ""}`, url: APP + "admin.html", tag: `cup-setup-${r.id}` }) });
    }

    // An admin revealed a round: tell everyone with alerts on, with their own match if they have one
    if (body.action === "cup_revealed") {
      const { data: isAdm } = await caller.rpc("is_admin");
      if (!isAdm) return json({ error: "Admins only" }, 403);
      const rid = Number(body.round_id);
      const { data: r } = await admin.from("cup_rounds").select("id,cup_id,name,status,format").eq("id", rid).maybeSingle();
      if (!r || r.status !== "revealed") return json({ sent: 0 });
      const { data: cup } = await admin.from("cups").select("name").eq("id", r.cup_id).maybeSingle();
      const { data: es } = await admin.from("cup_entries").select("side_id,slot,player_id,partner_id").eq("round_id", rid).not("player_id", "is", null);
      const { data: subs } = await admin.from("push_subs").select("user_id");
      const users = [...new Set((subs ?? []).map((x) => x.user_id as string))];
      const { data: ps } = await admin.from("players").select("id,last_name,user_id").in("user_id", users.length ? users : ["00000000-0000-0000-0000-000000000000"]);
      const { data: all } = await admin.from("players").select("id,last_name");
      const nm = (id: number | null) => (all ?? []).find((p) => p.id === id)?.last_name ?? "?";
      const team = (e: { player_id: number; partner_id: number | null }) => [e.player_id, e.partner_id].filter(Boolean).map((x) => nm(x as number)).join(" & ");
      let n = 0;
      for (const uid of users) {
        const me = (ps ?? []).find((p) => p.user_id === uid);
        const mine = me && (es ?? []).find((e) => e.player_id === me.id || e.partner_id === me.id);
        const opp = mine && (es ?? []).find((e) => e.slot === mine.slot && e.side_id !== mine.side_id);
        const msg = mine ? `Match ${mine.slot}: ${team(mine)} vs ${opp ? team(opp) : "TBD"}. Good luck!` : "See all the matches in the app.";
        n += await send([uid], { title: `${r.name} matchups are out`, body: `${cup?.name ?? "Queen City Cup"}. ${msg}`, url: APP + "#home", tag: `cup-rev-${rid}` });
      }
      return json({ sent: n });
    }

    // A finalized week completed someone's Full Flock (better than par on all 18 holes): tell the admins
    if (body.action === "full_flock") {
      const { data: isAdm } = await caller.rpc("is_admin");
      if (!isAdm) return json({ error: "Admins only" }, 403);
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: aw } = await admin.from("full_flock_awards").select("achieved_year,players(first_name,last_name)").gte("created_at", since);
      if (!aw?.length) return json({ sent: 0 });
      const names = aw.map((a) => { const p = a.players as unknown as { first_name: string; last_name: string }; return `${p.first_name} ${p.last_name}`; });
      const { data: admins } = await admin.from("players").select("user_id").eq("is_admin", true).not("user_id", "is", null);
      const ids = (admins ?? []).map((a) => a.user_id as string);
      return json({ sent: await send(ids, { title: "Full Flock Award!", body: `${names.join(" and ")} just beat par on all 18 holes. See the Full Flock page in the app.`, url: APP + "#full-flock", tag: `flock-${Date.now()}` }) });
    }

    if (body.action === "cup_turn") {
      const rid = Number(body.round_id);
      const { data: r } = await admin.from("cup_rounds").select("id,cup_id,name,status,blind,format,first_side_id,format_side_id,order_side_id").eq("id", rid).maybeSingle();
      if (!r || !["setup", "lineups"].includes(r.status)) return json({ sent: 0 });
      const { data: cup } = await admin.from("cups").select("name").eq("id", r.cup_id).maybeSingle();
      const capsOf = async (sideIds: number[]) => {
        const { data: caps } = await admin.from("cup_players").select("players(user_id)").eq("cup_id", r.cup_id).eq("is_captain", true).in("side_id", sideIds);
        return (caps ?? []).map((c) => (c.players as unknown as { user_id: string | null })?.user_id).filter((x): x is string => !!x && x !== u.user!.id);
      };
      // Format or order still to pick: tell the captain who picks it
      if (!r.format || (!r.blind && !r.first_side_id)) {
        const side = !r.format ? r.format_side_id : r.order_side_id, what = !r.format ? "pick the format" : "pick the order (who goes first, or blind)";
        if (!side) return json({ sent: 0 });
        return json({ sent: await send(await capsOf([side]), { title: "Your call, captain", body: `${cup?.name ?? "Queen City Cup"}, ${r.name}: ${what}.`, url: APP + "#captain", tag: `cup-pick-${rid}` }) });
      }
      if (r.status !== "lineups") return json({ sent: 0 });
      let sides: number[] = [], what = "";
      if (r.blind) {
        const { data: all } = await admin.from("cup_sides").select("id").eq("cup_id", r.cup_id);
        const { data: done } = await admin.from("cup_submissions").select("side_id").eq("round_id", rid);
        sides = (all ?? []).map((s) => s.id).filter((id) => !(done ?? []).some((d) => d.side_id === id));
        what = "put in your blind picks";
        if (!sides.length) return json({ sent: await ready(r, cup?.name) });
      } else {
        const { data: t } = await admin.rpc("cup_turn", { p_round: rid });
        const turn = Array.isArray(t) ? t[0] : t;
        if (!turn?.side_id) return json({ sent: await ready(r, cup?.name) });
        const { data: thrown } = await admin.from("cup_entries").select("id").eq("round_id", rid).eq("slot", turn.slot).not("player_id", "is", null);
        sides = [turn.side_id];
        what = (thrown ?? []).length ? `answer match ${turn.slot}` : `throw out match ${turn.slot}`;
      }
      const { data: caps } = await admin.from("cup_players").select("players(user_id)").eq("cup_id", r.cup_id).eq("is_captain", true).in("side_id", sides);
      const ids = (caps ?? []).map((c) => (c.players as unknown as { user_id: string | null })?.user_id).filter((x): x is string => !!x && x !== u.user!.id);
      return json({ sent: await send(ids, { title: "Your turn to pick", body: `${cup?.name ?? "Queen City Cup"}, ${r.name}: ${what}.`, url: APP + "#captain", tag: `cup-${rid}` }) });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
