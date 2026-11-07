// Push notifications for the BCC app.
//   {action:"key"}                  -> the public key phones subscribe with (keys are made here on first use)
//   {action:"test"}                 -> a test alert to the caller's own phones
//   {action:"cup_turn", round_id}   -> tells the captain(s) whose pick it is now
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

    if (body.action === "test") return json({ sent: await send([u.user.id], { title: "BCC Golf", body: "Alerts are on. You'll get one when it's your turn to pick.", url: APP + "#captain", tag: "test" }) });

    if (body.action === "cup_turn") {
      const rid = Number(body.round_id);
      const { data: r } = await admin.from("cup_rounds").select("id,cup_id,name,status,blind,format").eq("id", rid).maybeSingle();
      if (!r || r.status !== "lineups" || !r.format) return json({ sent: 0 });
      const { data: cup } = await admin.from("cups").select("name").eq("id", r.cup_id).maybeSingle();
      let sides: number[] = [], what = "";
      if (r.blind) {
        const { data: all } = await admin.from("cup_sides").select("id").eq("cup_id", r.cup_id);
        const { data: done } = await admin.from("cup_submissions").select("side_id").eq("round_id", rid);
        sides = (all ?? []).map((s) => s.id).filter((id) => !(done ?? []).some((d) => d.side_id === id));
        what = "put in your blind picks";
      } else {
        const { data: t } = await admin.rpc("cup_turn", { p_round: rid });
        const turn = Array.isArray(t) ? t[0] : t;
        if (!turn?.side_id) return json({ sent: 0 });
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
