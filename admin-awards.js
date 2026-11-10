// Admin: end-of-season awards, worked out from the season's finalized weeks (same rules as Nitin's Awards sheet).
// Everything fills itself in except the Kinnett Award; an admin can type over any winner (that row is then kept as typed).
(() => {
  const A = window.BCCAdmin, { sb, $, esc, toast, check } = A;
  // [award, how it's decided] in the sheet's order
  const AWARDS = [
    ["Individual Champion", "Most points (best weeks count)"],
    ["Team Champion", "Most team points"],
    ["Kinnett Award", "Picked by the committee"],
    ["Green Machine Award", "Most greens in regulation per round · min. rounds"],
    ["Fairway Finder Award", "Most fairways hit per round · min. rounds"],
    ["Scotty Cameron", "Fewest putts per round · min. rounds"],
    ["Vardon Award", "Lowest average gross · min. rounds"],
    ["Byron Nelson", "Lowest average net · min. rounds"],
    ["Most Improved", "Biggest handicap drop, week 1 to season end · min. rounds · returning leaguers only"],
    ["Net Ringer Award", "Lowest 18-hole net ringer · min. rounds"],
    ["Ringer Award", "Lowest 18-hole gross ringer · min. rounds"],
    ["Toilet Bowl", "Fewest total points · everyone counts, missed weeks score 0"],
    ["Full Flock Award", "Beat par on all 18 holes this season (lifetime)"],
    ["Buffalo Bill Award", "Most weekly skins won · anyone, no minimum"]
  ];
  const MANUAL_ONLY = new Set(["Kinnett Award"]);
  const nm = p => p ? `${p.first_name} ${p.last_name}` : "?";
  const f = (v, d = 1) => String(Number((+v).toFixed(d)));

  // Work out every award from the season's data. Returns {award: {winner, value}}
  async function compute(season) {
    const out = {}; let skinRows = [];
    const [{ data: evs }, { data: tms }] = await Promise.all([
      sb.from("events").select("id,number,play_date,status,course_id").eq("season_id", season.id).order("number"),
      sb.from("teams").select("id,name,team_players(player_id)").eq("season_id", season.id)
    ]);
    const finals = (evs || []).filter(e => e.status === "final"), ids = finals.map(e => e.id);
    const P = new Map(A.players.map(p => [p.id, p]));
    const regulars = new Set((tms || []).flatMap(t => (t.team_players || []).map(x => x.player_id)));
    const [{ data: res }, { data: tres }, { data: sc }, { data: tees }, { data: ff }, { data: sy }] = await Promise.all([
      ids.length ? sb.from("results").select("event_id,player_id,kind,tee,gross,net,points,handicap_index,course_handicap").in("event_id", ids).not("player_id", "is", null) : { data: [] },
      ids.length ? sb.from("team_results").select("event_id,team_id,match_points").in("event_id", ids) : { data: [] },
      ids.length ? sb.from("scores").select("event_id,player_id,hole,strokes,putts,fairway,green").in("event_id", ids) : { data: [] },
      sb.from("tees").select("name,tee_holes(hole,par,stroke_index)"),
      sb.from("full_flock_awards").select("player_id,achieved_year").eq("achieved_year", season.year),
      sb.rpc("player_seasons"),
      (evs || []).length ? sb.from("skins").select("event_id,winner").in("event_id", evs.map(e => e.id)) : { data: [] }
    ]).then(a => { skinRows = a[6].data || []; return a; });
    // Awards need half the season's weeks played (9 of 18); the Toilet Bowl doesn't
    const weeks = (evs || []).filter(e => e.status !== "rained_out").length, minR = Math.ceil(weeks / 2);
    const returning = new Set((sy || []).filter(x => x.year < season.year).map(x => x.player_id));
    // Regulars only, like the sheet (subs aren't eligible)
    const R = (res || []).filter(r => r.kind === "regular" && regulars.has(r.player_id));
    const evDate = new Map(finals.map(e => [e.id, e.play_date]));
    const by = new Map();
    R.forEach(r => { const o = by.get(r.player_id) || { id: r.player_id, rounds: [], pts: [] }; o.rounds.push(r); o.pts.push(+r.points || 0); by.set(r.player_id, o); });
    // Stats per round from the hole scores
    const st = new Map();
    (sc || []).forEach(x => { const k = x.event_id + ":" + x.player_id, o = st.get(k) || { putts: 0, hasP: false, fw: 0, hasF: false, gir: 0, hasG: false }; if (x.putts != null) { o.putts += x.putts; o.hasP = true; } if (x.fairway != null) { o.hasF = true; o.fw += x.fairway ? 1 : 0; } if (x.green != null) { o.hasG = true; o.gir += x.green ? 1 : 0; } st.set(k, o); });
    const pl = [...by.values()].map(o => {
      const s = o.rounds.map(r => st.get(r.event_id + ":" + r.player_id)).filter(Boolean), avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const gross = o.rounds.filter(r => r.gross != null);
      const first = [...o.rounds].sort((a, b) => String(evDate.get(a.event_id)).localeCompare(String(evDate.get(b.event_id))))[0];
      return { id: o.id, n: o.rounds.length, total: o.pts.reduce((a, b) => a + b, 0), best: [...o.pts].sort((a, b) => b - a).slice(0, season.best_of || 15).reduce((a, b) => a + b, 0),
        gross: avg(gross.map(r => r.gross)), net: avg(o.rounds.map(r => r.net)),
        putts: avg(s.filter(x => x.hasP).map(x => x.putts)), fw: avg(s.filter(x => x.hasF).map(x => x.fw)), gir: avg(s.filter(x => x.hasG).map(x => x.gir)),
        hi1: first?.handicap_index != null ? +first.handicap_index : null };
    });
    // Winner(s) of a stat: ties share it
    const pick = (key, low, fmt, any) => {
      const xs = pl.filter(p => p[key] != null && (any || p.n >= minR)); if (!xs.length) return null;
      const bestV = xs.reduce((m, p) => low ? Math.min(m, p[key]) : Math.max(m, p[key]), low ? Infinity : -Infinity);
      const w = xs.filter(p => Math.abs(p[key] - bestV) < 1e-9);
      return { winner: w.map(p => nm(P.get(p.id))).join(" & "), value: fmt(bestV) };
    };
    out["Individual Champion"] = pick("best", false, v => `${f(v)} pts`);
    out["Toilet Bowl"] = pick("total", true, v => `${f(v)} pts`, true);
    out["Vardon Award"] = pick("gross", true, v => `${f(v, 2)} avg gross`);
    out["Byron Nelson"] = pick("net", true, v => `${f(v, 2)} avg net`);
    out["Fairway Finder Award"] = pick("fw", false, v => `${f(v, 2)} fairways a round`);
    out["Green Machine Award"] = pick("gir", false, v => `${f(v, 2)} greens a round`);
    out["Scotty Cameron"] = pick("putts", true, v => `${f(v, 2)} putts a round`);
    // Buffalo Bill Award (Nitin 2026-11-10): most weekly skins won. Winners are names picked from the player list;
    // a shared skin ("A & B") counts for each of them.
    const byName = new Map(A.players.map(p => [nm(p).toLowerCase(), p.id])), wins = new Map();
    skinRows.forEach(r => String(r.winner || "").split(/\s*(?:&|,|\band\b)\s*/i).forEach(n => { const id = byName.get(n.trim().toLowerCase()); if (id) wins.set(id, (wins.get(id) || 0) + 1); }));
    // Anyone can win it, subs included, with no minimum rounds (Nitin 2026-11-10)
    if (wins.size) { const mx = Math.max(...wins.values()); out["Buffalo Bill Award"] = { winner: [...wins].filter(([, v]) => v === mx).map(([id]) => nm(P.get(id))).join(" & "), value: `${mx} skin${mx === 1 ? "" : "s"}` }; }
    // Most improved: week-1 index vs index now (only meaningful for the current season)
    if (season.is_current) {
      pl.forEach(p => { const h = A.hcps.get(p.id); p.drop = returning.has(p.id) && p.hi1 != null && h?.handicap_index != null ? +h.handicap_index - p.hi1 : null; p.h2 = h?.handicap_index; });
      const m = pick("drop", true, v => (+v).toFixed(2));
      if (m) { const w = pl.find(p => p.drop != null && p.drop.toFixed(2) === m.value); m.value = `${w.hi1.toFixed(2)} → ${(+w.h2).toFixed(2)} (${(+w.drop).toFixed(2)})`; }
      out["Most Improved"] = m;
    }
    // Team champion: most team (match) points
    const tot = new Map(); (tres || []).forEach(t => tot.set(t.team_id, (tot.get(t.team_id) || 0) + (+t.match_points || 0)));
    if (tot.size) {
      const mx = Math.max(...tot.values()), w = (tms || []).filter(t => tot.get(t.id) === mx);
      out["Team Champion"] = { winner: w.map(t => `${t.name} (${(t.team_players || []).map(x => nm(P.get(x.player_id))).join(" & ")})`).join("; "), value: `${f(mx)} pts` };
    }
    // Ringers: each regular's best score per hole this season, gross and net (needs all 18 holes)
    const rinfo = new Map(R.map(r => [r.event_id + ":" + r.player_id, r]));
    const teeFor = (name, hole) => (tees || []).find(t => t.name === name && (t.tee_holes || []).some(h => h.hole === hole)) || (tees || []).find(t => t.name === "Blue" && (t.tee_holes || []).some(h => h.hole === hole));
    const strokesOn = (r, hole) => {
      const base = hole <= 9 ? 1 : 10, t = teeFor(r.tee, hole), si = (t?.tee_holes || []).filter(h => h.hole >= base && h.hole < base + 9).sort((a, b) => a.hole - b.hole).map(h => h.stroke_index);
      const rk = si.map(q => si.filter(z => z < q).length + 1), i = hole - base, h = r.course_handicap || 0;
      return h < 0 ? (rk[i] > 9 + Math.max(h, -9) ? -1 : 0) : Math.floor(h / 9) + (rk[i] <= h % 9 ? 1 : 0);
    };
    const ring = new Map();
    (sc || []).forEach(x => { const r = rinfo.get(x.event_id + ":" + x.player_id); if (!r || x.strokes == null) return;
      const o = ring.get(x.player_id) || { id: x.player_id, g: {}, n: {} }; o.g[x.hole] = Math.min(o.g[x.hole] ?? 99, x.strokes); o.n[x.hole] = Math.min(o.n[x.hole] ?? 99, x.strokes - strokesOn(r, x.hole)); ring.set(x.player_id, o); });
    const full = [...ring.values()].filter(o => Object.keys(o.g).length === 18 && (by.get(o.id)?.rounds.length || 0) >= minR).map(o => ({ id: o.id, rg: Object.values(o.g).reduce((a, b) => a + b, 0), rn: Object.values(o.n).reduce((a, b) => a + b, 0) }));
    const rp = (key) => { if (!full.length) return null; const mn = Math.min(...full.map(o => o[key])); return { winner: full.filter(o => o[key] === mn).map(o => nm(P.get(o.id))).join(" & "), value: String(mn) }; };
    out["Ringer Award"] = rp("rg"); out["Net Ringer Award"] = rp("rn");
    if ((ff || []).length) out["Full Flock Award"] = { winner: ff.map(x => nm(P.get(x.player_id))).join(" & "), value: String(season.year) };
    return { out, minR, finals: finals.length, total: (evs || []).filter(e => e.status !== "rained_out").length, done: (evs || []).length > 0 && (evs || []).every(e => e.status === "final" || e.status === "rained_out") };
  }

  // Write the worked-out winners into the table, leaving rows an admin typed alone
  async function saveAuto(season, out, saved) {
    const rows = AWARDS.map(([a], i) => ({ a, i })).filter(({ a }) => !MANUAL_ONLY.has(a) && !saved.get(a)?.manual)
      .map(({ a, i }) => ({ season_id: season.id, award: a, winner: out[a]?.winner ?? null, value: out[a]?.value ?? null, manual: false, sort: i, updated_at: new Date().toISOString() }));
    if (!rows.length) return null;
    const { error } = await sb.from("season_awards").upsert(rows, { onConflict: "season_id,award" });
    if (error) return error;
    // The two champions also go into the Hall of Champions, if that year is still empty
    const ic = out["Individual Champion"], tc = out["Team Champion"];
    if (ic || tc) {
      const { data: ch } = await sb.from("champions").select("id,league_champion,team_name,team_players").eq("year", season.year).maybeSingle();
      const team = tc ? tc.winner.match(/^(.*) \((.*)\)$/) : null, patch = {};
      if (ic && !ch?.league_champion) patch.league_champion = ic.winner;
      if (team && !ch?.team_name && !tc.winner.includes("; ")) { patch.team_name = team[1]; patch.team_players = ch?.team_players || team[2].replace(" & ", " and "); }
      if (Object.keys(patch).length) ch ? await sb.from("champions").update(patch).eq("id", ch.id) : await sb.from("champions").insert({ year: season.year, ...patch });
    }
    return null;
  }

  async function loadAwards(force) {
    const season = A.season; if (!season) return;
    $("awSeason").textContent = season.name;
    const [{ out, minR, finals, total, done }, { data: sv }] = await Promise.all([compute(season), sb.from("season_awards").select("*").eq("season_id", season.id)]);
    let saved = new Map((sv || []).map(r => [r.award, r]));
    // Season over and nothing saved yet: fill it in automatically
    const anyAuto = [...saved.values()].some(r => !r.manual);
    if ((done && !anyAuto) || force) {
      const err = await saveAuto(season, out, saved);
      if (err) check(err); else if (force) toast("Awards recalculated");
      if (!err) { const { data } = await sb.from("season_awards").select("*").eq("season_id", season.id); saved = new Map((data || []).map(r => [r.award, r])); }
    }
    $("awStatus").textContent = done ? `Season over: ${finals} week${finals === 1 ? "" : "s"} final. Awards are filled in and saved.` : `${finals} of ${total} weeks final. These are the standings so far; they save automatically once the last week is final.`;
    $("awTable").innerHTML = `<thead><tr><th>Award</th><th>Winner</th><th>Stat</th><th>Worked out from the data</th><th></th></tr></thead><tbody>` +
      AWARDS.map(([a, how]) => {
        const s = saved.get(a), c = out[a], manual = MANUAL_ONLY.has(a) || s?.manual;
        const w = s ? s.winner ?? "" : (MANUAL_ONLY.has(a) ? "" : c?.winner ?? ""), v = s ? s.value ?? "" : (MANUAL_ONLY.has(a) ? "" : c?.value ?? "");
        return `<tr data-a="${esc(a)}"><td><b>${esc(a)}</b><div class="note" style="margin:2px 0 0">${esc(how.replace("min. rounds", `at least ${minR} rounds`))}</div></td>
          <td><input data-w value="${esc(w)}" placeholder="${MANUAL_ONLY.has(a) ? "Type the winner" : ""}" style="width:300px"></td>
          <td><input data-v value="${esc(v)}" style="width:150px"></td>
          <td class="note">${MANUAL_ONLY.has(a) ? "Entered by hand" : c ? esc(`${c.winner} · ${c.value}`) : a === "Full Flock Award" ? "No one finished it this season" : "Not enough data yet"}${!MANUAL_ONLY.has(a) && s?.manual ? "<br><b>Typed over</b>" : ""}</td>
          <td>${!MANUAL_ONLY.has(a) && s?.manual ? '<button class="btn secondary" type="button" data-reset style="padding:5px 9px;font-size:13px">Use worked-out</button>' : ""}</td></tr>`;
      }).join("") + "</tbody>";
    const T = $("awTable");
    T.querySelectorAll("tr[data-a]").forEach(tr => {
      const a = tr.dataset.a, i = AWARDS.findIndex(x => x[0] === a);
      const save = async () => {
        const { error } = await sb.from("season_awards").upsert({ season_id: season.id, award: a, winner: tr.querySelector("[data-w]").value.trim() || null, value: tr.querySelector("[data-v]").value.trim() || null, manual: true, sort: i, updated_at: new Date().toISOString() }, { onConflict: "season_id,award" });
        if (check(error, "Saved")) loadAwards();
      };
      tr.querySelectorAll("input").forEach(el => el.onchange = save);
      const rb = tr.querySelector("[data-reset]");
      if (rb) rb.onclick = async () => {
        const c = out[a];
        const { error } = await sb.from("season_awards").upsert({ season_id: season.id, award: a, winner: c?.winner ?? null, value: c?.value ?? null, manual: false, sort: i, updated_at: new Date().toISOString() }, { onConflict: "season_id,award" });
        if (check(error, "Back to the worked-out winner")) loadAwards();
      };
    });
  }
  $("awRecalc").onclick = () => loadAwards(true);
  A.refreshAwards = () => loadAwards();

  const prev = A.onLoad;
  A.onLoad = () => { if (prev) prev(); loadAwards(); };
})();
