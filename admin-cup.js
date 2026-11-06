// Admin: Queen City Cup tab. Uses window.BCCAdmin (sb, helpers, loaded players/courses) and window.Cup (math).
(() => {
  const A = window.BCCAdmin, { sb, $, esc, toast, check } = A;
  const F = window.Cup.FORMATS;
  const STATUS = { setup: "Setting up", lineups: "Lineups open", revealed: "Revealed · scoring", final: "Final" };
  let cups = [], cup = null, D = null;
  const pname = p => p ? `${p.last_name}, ${p.first_name}` : "?";
  const P = id => A.players.find(p => p.id === id);
  const sideName = id => D.sides.find(s => s.id === id)?.name || "?";
  const sideDot = s => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(s.color)};margin-right:6px"></span>`;
  const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "no date";

  async function loadCups(pick) {
    const { data } = await sb.from("cups").select("*").order("year", { ascending: false }).order("id", { ascending: false });
    cups = data || [];
    cup = cups.find(c => c.id === (pick ?? cup?.id)) || cups[0] || null;
    $("cupPick").innerHTML = cups.map(c => `<option value="${c.id}"${c === cup ? " selected" : ""}>${esc(c.name)}${c.active ? " (in the app)" : ""}</option>`).join("") || "<option>No Cups yet</option>";
    $("cupPick").disabled = !cups.length;
    if (!cup) { D = null; $("cupBody").innerHTML = '<p class="note">No Cup yet. Start one with the button above; it copies the sides from the last Cup.</p>'; return; }
    await loadCup();
  }
  async function loadCup() {
    const [{ data: sides }, { data: cp }, { data: rounds }, { data: tees }] = await Promise.all([
      sb.from("cup_sides").select("*").eq("cup_id", cup.id).order("sort").order("id"),
      sb.from("cup_players").select("*").eq("cup_id", cup.id),
      sb.from("cup_rounds").select("*").eq("cup_id", cup.id).order("number"),
      sb.from("tees").select("course_id,name,rating,slope,par,tee_holes(hole,par,stroke_index)")
    ]);
    const rids = (rounds || []).map(r => r.id);
    const q = t => rids.length ? sb.from(t).select("*").in("round_id", rids) : Promise.resolve({ data: [] });
    const [{ data: entries }, { data: subs }, { data: ovr }, { data: scores }] = await Promise.all([q("cup_entries"), q("cup_submissions"), q("cup_match_overrides"), q("cup_scores")]);
    const tbc = new Map(); (tees || []).forEach(t => { if (!tbc.has(t.course_id)) tbc.set(t.course_id, []); tbc.get(t.course_id).push(t); });
    D = { sides: sides || [], cp: cp || [], rounds: rounds || [], entries: entries || [], subs: subs || [], ovr: ovr || [], scores: scores || [], tbc };
    render();
  }
  $("cupPick").onchange = () => loadCups(+$("cupPick").value);

  $("cupNew").onclick = async () => {
    const y = (cups[0]?.year || new Date().getFullYear() - 1) + 1;
    const name = prompt("Name for the new Cup", `Queen City Cup ${y}`); if (!name) return;
    const prev = cups[0];
    const { data: c, error } = await sb.from("cups").insert({ name, year: y, active: false }).select().single(); if (!check(error, "")) return;
    // Sides stay the same from Cup to Cup: copy the last Cup's sides, captains and players.
    let ps = [], pp = [];
    if (prev) { ({ data: ps } = await sb.from("cup_sides").select("*").eq("cup_id", prev.id).order("sort")); ({ data: pp } = await sb.from("cup_players").select("*").eq("cup_id", prev.id)); }
    const base = ps?.length ? ps.map(s => ({ cup_id: c.id, name: s.name, color: s.color, captain_id: s.captain_id, sort: s.sort })) : [{ cup_id: c.id, name: "Orange", color: "#e8711c", sort: 0 }, { cup_id: c.id, name: "Blue", color: "#2f6fd6", sort: 1 }];
    const { data: ns, error: e2 } = await sb.from("cup_sides").insert(base).select(); if (!check(e2, "")) return loadCups(c.id);
    const map = new Map((ps || []).map(s => [s.id, ns.find(n => n.sort === s.sort && n.name === s.name)?.id]));
    if (pp?.length) await sb.from("cup_players").insert(pp.filter(x => map.get(x.side_id) && P(x.player_id)?.active !== false).map(x => ({ cup_id: c.id, player_id: x.player_id, side_id: map.get(x.side_id), handicap_index: A.hcps.get(x.player_id)?.handicap_index ?? x.handicap_index })));
    // Defending side: last year's winner if known, else the first side. Round 1 the Challenger picks the format, Round 2 the Defender, Final is singles.
    const def = ns.find(n => n.sort === 0) || ns[0], chal = ns.find(n => n !== def);
    await sb.from("cups").update({ defending_side_id: def.id }).eq("id", c.id);
    await sb.from("cup_rounds").insert([
      { cup_id: c.id, number: 1, name: "Round 1", holes: 9, status: "setup", format_side_id: chal.id, order_side_id: def.id },
      { cup_id: c.id, number: 2, name: "Round 2", holes: 9, status: "setup", format_side_id: def.id, order_side_id: chal.id },
      { cup_id: c.id, number: 3, name: "Final", holes: 18, status: "setup", format: "singles", order_side_id: def.id, allow_blind: true, course_id: A.courses[0]?.id ?? null, course2_id: A.courses[1]?.id ?? null }
    ]);
    toast(`${name} created`); loadCups(c.id);
  };

  // ---------- totals ----------
  function matchesOf(r) {
    const [sa, sb_] = D.sides; if (!sa || !sb_) return [];
    const es = D.entries.filter(e => e.round_id === r.id), n = Math.max(0, ...es.map(e => e.slot));
    const sc = new Map(D.scores.filter(s => s.round_id === r.id).map(s => [`${s.side_id}:${s.player_id}:${s.hole}`, s.strokes]));
    const info = pid => { const p = P(pid), c = D.cp.find(x => x.player_id === pid); return { name: p ? p.last_name : "?", index: c?.handicap_index ?? A.hcps.get(pid)?.handicap_index ?? 0, tee: p?.default_tee || "Blue" }; };
    const out = [];
    for (let slot = 1; slot <= n; slot++) {
      const ea = es.find(e => e.side_id === sa.id && e.slot === slot && e.player_id), eb = es.find(e => e.side_id === sb_.id && e.slot === slot && e.player_id);
      if (!ea && !eb) continue;
      const m = window.Cup.setupMatch(r, [{ id: sa.id, entry: ea }, { id: sb_.id, entry: eb }], info, D.tbc);
      const st = window.Cup.matchStatus(m, [sa.id, sb_.id], sc, sideName);
      const ov = D.ovr.find(o => o.round_id === r.id && o.slot === slot);
      out.push({ slot, ea, eb, m, st, ov, pts: window.Cup.points(st, ov, [sa.id, sb_.id]) });
    }
    return out;
  }
  function totals() {
    const t = Object.fromEntries(D.sides.map(s => [s.id, 0]));
    D.rounds.filter(r => r.status === "revealed" || r.status === "final").forEach(r => matchesOf(r).forEach(x => Object.entries(x.pts.pts).forEach(([k, v]) => t[k] += v)));
    return t;
  }

  // ---------- render ----------
  function render() {
    const t = totals();
    const sideOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : "") + D.sides.map(s => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const inCup = new Map(D.cp.map(c => [c.player_id, c]));
    const roster = A.players.filter(p => p.active || inCup.has(p.id)).sort((a, b) => (inCup.has(b.id) - inCup.has(a.id)) || pname(a).localeCompare(pname(b)));
    $("cupBody").innerHTML = `
      <div class="row" style="gap:18px;margin:6px 0 14px">${D.sides.map(s => `<div style="font:700 30px/1 var(--display)">${sideDot(s)}${esc(s.name)} ${fmtPts(t[s.id])}</div>`).join("")}<span class="note" style="margin:0">Points from finished matches. Win 1, halve ½.</span></div>

      <h3 style="margin:8px 0;font-size:15px">Cup settings</h3>
      <div class="row" style="margin-bottom:8px">
        <label class="row" style="gap:6px;font-weight:600"><input type="checkbox" id="cupActive"${cup.active ? " checked" : ""}> Cup mode in the app</label>
        <span class="note" style="margin:0">When on, the app's Home shows the Cup scoreboard and a Cup tab replaces Rounds.</span>
      </div>
      <div class="row" style="margin-bottom:8px">
        <label style="font-weight:600">Name</label><input id="cupName" value="${esc(cup.name)}" style="width:220px">
        <label style="font-weight:600">Defending side</label><select id="cupDef">${sideOpts(cup.defending_side_id, "Not set")}</select>
      </div>
      <div class="scroll"><table><thead><tr><th>Side</th><th>Color</th><th>Captain</th><th>Players</th></tr></thead><tbody>
        ${D.sides.map(s => `<tr data-side="${s.id}"><td><input data-sf="name" value="${esc(s.name)}" style="width:120px"></td><td><input data-sf="color" type="color" value="${esc(s.color)}" style="width:52px;padding:2px"></td>
          <td><select data-sf="captain_id"><option value="">None</option>${D.cp.filter(c => c.side_id === s.id).map(c => P(c.player_id)).filter(Boolean).sort((a, b) => pname(a).localeCompare(pname(b))).map(p => `<option value="${p.id}"${p.id === s.captain_id ? " selected" : ""}>${esc(pname(p))}</option>`).join("")}</select></td>
          <td>${D.cp.filter(c => c.side_id === s.id).length}</td></tr>`).join("")}
      </tbody></table></div>

      <h3 style="margin:18px 0 8px;font-size:15px">Players</h3>
      <p class="note">Sides stay the same for the whole Cup. Put new players on a side as they join. The Cup index is frozen when a player is added; "Refresh handicaps" copies everyone's current league index.</p>
      <div class="row" style="margin-bottom:8px">${D.rounds.some(r => r.status === "revealed" || r.status === "final") ? '<span class="pill">Handicaps locked: the first round has started</span>' : '<button class="btn secondary" type="button" id="cupRefresh">Refresh handicaps</button><span class="note" style="margin:0">Use this once the league season is final. It locks when the first round is revealed.</span>'}</div>
      <div class="scroll" style="max-height:420px;overflow:auto"><table id="cupPlayers"><thead><tr><th>Player</th><th>Side</th><th class="num">Cup index</th><th class="num">League index now</th></tr></thead><tbody>
        ${roster.map(p => { const c = inCup.get(p.id); return `<tr data-p="${p.id}"><td><b>${esc(pname(p))}</b></td><td><select data-side>${sideOpts(c?.side_id, "Not playing")}</select></td><td class="num">${c?.handicap_index != null ? (+c.handicap_index).toFixed(2) : "–"}</td><td class="num">${A.hcps.get(p.id) ? (+A.hcps.get(p.id).handicap_index).toFixed(2) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>

      <h3 style="margin:18px 0 8px;font-size:15px">Rounds</h3>
      <div style="display:grid;gap:12px">${D.rounds.map(roundBox).join("")}</div>
      <div class="row" style="margin-top:10px"><button class="btn secondary" type="button" id="cupAddRound">Add a round</button></div>`;
    wire();
  }
  const fmtPts = v => v % 1 ? `${Math.floor(v) || ""}½` : String(v);

  function roundBox(r) {
    const subs = D.subs.filter(s => s.round_id === r.id), done = id => subs.some(s => s.side_id === id);
    const courseOpts = sel => `<option value="">–</option>` + A.courses.map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    const sideOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : "") + D.sides.map(s => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const locked = r.status === "revealed" || r.status === "final";
    const f = F[r.format];
    const firstVal = r.blind ? "blind" : r.first_side_id ?? "";
    const act = { setup: `<button class="btn" type="button" data-st="lineups">Open lineups</button>`,
      lineups: `<button class="btn" type="button" data-reveal${D.sides.every(s => done(s.id)) ? "" : ' data-early="1"'}>Reveal matchups</button><button class="btn secondary" type="button" data-st="setup">Close lineups</button>`,
      revealed: `<button class="btn" type="button" data-st="final">Mark final</button><button class="btn secondary" type="button" data-st="lineups">Hide again</button>`,
      final: `<button class="btn secondary" type="button" data-st="revealed">Reopen</button>` }[r.status];
    return `<div class="box" data-round="${r.id}" style="border:1px solid var(--line);border-radius:12px;padding:12px">
      <div class="row" style="justify-content:space-between"><div class="row"><input data-rf="name" value="${esc(r.name)}" style="width:120px;font-weight:600"><span class="pill${r.status === "lineups" ? " warn" : ""}">${STATUS[r.status]}</span></div><div class="row">${act}</div></div>
      <div class="row" style="margin-top:8px">
        <input type="date" data-rf="play_date" value="${r.play_date || ""}"><input type="time" data-rf="tee_time" value="${(r.tee_time || "").slice(0, 5)}">
        <select data-rf="holes"><option value="9"${r.holes === 9 ? " selected" : ""}>9 holes</option><option value="18"${r.holes === 18 ? " selected" : ""}>18 holes</option></select>
        <select data-rf="course_id" title="Course">${courseOpts(r.course_id)}</select>${r.holes === 18 ? `<select data-rf="course2_id" title="Back nine (leave blank for a full 18-hole course)">${courseOpts(r.course2_id)}</select>` : ""}
      </div>
      <div class="row" style="margin-top:8px">
        <label>Format</label><select data-rf="format"${locked ? " disabled" : ""}><option value="">Not picked</option>${Object.entries(F).map(([k, v]) => `<option value="${k}"${k === r.format ? " selected" : ""}>${v.label}</option>`).join("")}</select>
        <label>picked by</label><select data-rf="format_side_id">${sideOpts(r.format_side_id, "Admin")}</select>
        <label>Who goes first picked by</label><select data-rf="order_side_id">${sideOpts(r.order_side_id, "Admin")}</select>
        <label>Goes first</label><select data-first${locked ? " disabled" : ""}><option value="">Not picked</option>${D.sides.map(s => `<option value="${s.id}"${String(firstVal) === String(s.id) ? " selected" : ""}>${esc(s.name)} submits first</option>`).join("")}${r.allow_blind ? `<option value="blind"${r.blind ? " selected" : ""}>Blind draw</option>` : ""}</select>
      </div>
      ${f ? `<p class="note" style="margin:6px 0 0">${esc(f.how)}${f.w ? ` Team handicap ${f.w[0]} × lower + ${f.w[1]} × higher.` : ""}</p>` : ""}
      <div class="lu" style="margin-top:10px">${D.sides.map(s => lineupBox(r, s, done(s.id))).join("")}</div>
      ${locked ? matchTable(r) : ""}
    </div>`;
  }
  function lineupBox(r, s, submitted) {
    const f = F[r.format] || F.singles, mine = D.cp.filter(c => c.side_id === s.id).map(c => P(c.player_id)).filter(Boolean).sort((a, b) => pname(a).localeCompare(pname(b)));
    const es = D.entries.filter(e => e.round_id === r.id && e.side_id === s.id);
    const n = Math.max(f.pairs ? Math.ceil(mine.length / 2) : mine.length, ...es.map(e => e.slot), 1);
    const opt = sel => `<option value="">–</option>` + mine.map(p => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(pname(p))}</option>`).join("");
    const locked = r.status === "revealed" || r.status === "final";
    return `<div class="box" data-side="${s.id}"><h4>${sideDot(s)}${esc(s.name)} ${r.blind ? "ranking" : "lineup"} ${submitted ? '<span class="pill">Submitted</span>' : '<span class="pill warn">Not submitted</span>'}</h4>
      ${Array.from({ length: n }, (_, i) => { const e = es.find(x => x.slot === i + 1); return `<div class="slot" data-slot="${i + 1}"><b style="width:22px">${i + 1}</b><select data-e="player_id"${locked ? " disabled" : ""}>${opt(e?.player_id)}</select>${f.pairs ? `<select data-e="partner_id"${locked ? " disabled" : ""}>${opt(e?.partner_id)}</select>` : ""}</div>`; }).join("")}
      ${submitted && !locked ? `<button class="btn secondary" type="button" data-unlock style="margin-top:8px">Unlock for the captain</button>` : ""}</div>`;
  }
  function matchTable(r) {
    const ms = matchesOf(r);
    const nm = e => e ? [e.player_id, (F[r.format] || F.singles).pairs ? e.partner_id : null].filter(Boolean).map(id => esc(P(id)?.last_name || "?")).join(" & ") : "<i>absent</i>";
    const [sa, sb_] = D.sides;
    return `<h4 style="margin:12px 0 6px;font-size:14px">Matches</h4><div class="scroll"><table><thead><tr><th>#</th><th>${esc(sa.name)}</th><th>${esc(sb_.name)}</th><th>Strokes</th><th>Status</th><th>Result</th></tr></thead><tbody>
      ${ms.map(x => `<tr data-slot="${x.slot}"><td>${x.slot}</td><td>${nm(x.ea)}</td><td>${nm(x.eb)}</td><td>${x.m.balls.filter(b => b.strokes).map(b => `${esc(b.label)} ${b.strokes}`).join(", ") || "none"}</td><td>${esc(x.st.text)}</td>
        <td><select data-ovr><option value="auto">From scores</option>${D.sides.map(s => `<option value="${s.id}"${x.ov?.winner_side_id === s.id ? " selected" : ""}>${esc(s.name)} wins${x.st.done ? "" : " (forfeit/by hand)"}</option>`).join("")}<option value="half"${x.ov && !x.ov.winner_side_id ? " selected" : ""}>Halved</option></select></td></tr>`).join("") || '<tr><td colspan="6">No matches.</td></tr>'}
      </tbody></table></div>`;
  }

  // ---------- events ----------
  function wire() {
    const body = $("cupBody");
    $("cupActive").onchange = async e => {
      if (e.target.checked && cups.some(c => c.active && c.id !== cup.id)) await sb.from("cups").update({ active: false }).neq("id", cup.id);
      const { error } = await sb.from("cups").update({ active: e.target.checked }).eq("id", cup.id);
      if (check(error, e.target.checked ? "Cup mode is on in the app" : "Cup mode is off")) loadCups(cup.id);
    };
    $("cupName").onchange = async e => { const { error } = await sb.from("cups").update({ name: e.target.value.trim() }).eq("id", cup.id); if (check(error)) loadCups(cup.id); };
    $("cupDef").onchange = async e => { const { error } = await sb.from("cups").update({ defending_side_id: +e.target.value || null }).eq("id", cup.id); if (check(error)) cup.defending_side_id = +e.target.value || null; };
    body.querySelectorAll("[data-sf]").forEach(el => el.onchange = async () => {
      const id = +el.closest("tr").dataset.side, k = el.dataset.sf, v = k === "captain_id" ? (+el.value || null) : el.value;
      const { error } = await sb.from("cup_sides").update({ [k]: v }).eq("id", id); if (check(error)) loadCup();
    });
    body.querySelectorAll("#cupPlayers [data-side]").forEach(el => el.onchange = async () => {
      const pid = +el.closest("tr").dataset.p, sid = +el.value || null;
      const r = sid ? await sb.from("cup_players").upsert({ cup_id: cup.id, player_id: pid, side_id: sid, handicap_index: D.cp.find(c => c.player_id === pid)?.handicap_index ?? A.hcps.get(pid)?.handicap_index ?? null }, { onConflict: "cup_id,player_id" })
        : await sb.from("cup_players").delete().eq("cup_id", cup.id).eq("player_id", pid);
      if (check(r.error)) loadCup();
    });
    if ($("cupRefresh")) $("cupRefresh").onclick = async () => {
      if (!confirm("Copy everyone's current league index into the Cup? Strokes in matches not yet finished will follow.")) return;
      const rows = D.cp.map(c => ({ cup_id: cup.id, player_id: c.player_id, side_id: c.side_id, handicap_index: A.hcps.get(c.player_id)?.handicap_index ?? c.handicap_index }));
      const { error } = await sb.from("cup_players").upsert(rows, { onConflict: "cup_id,player_id" }); if (check(error, "Handicaps refreshed")) loadCup();
    };
    $("cupAddRound").onclick = async () => {
      const n = Math.max(0, ...D.rounds.map(r => r.number)) + 1;
      const { error } = await sb.from("cup_rounds").insert({ cup_id: cup.id, number: n, name: `Round ${n}`, holes: 9, status: "setup" }); if (check(error, "Round added")) loadCup();
    };
    body.querySelectorAll("[data-round]").forEach(box => {
      const r = D.rounds.find(x => x.id === +box.dataset.round);
      box.querySelectorAll("[data-rf]").forEach(el => el.onchange = async () => {
        const k = el.dataset.rf; let v = el.value || null;
        if (["holes", "course_id", "course2_id", "format_side_id", "order_side_id"].includes(k)) v = v == null ? null : +v;
        const { error } = await sb.from("cup_rounds").update({ [k]: v }).eq("id", r.id); if (check(error)) loadCup();
      });
      const first = box.querySelector("[data-first]");
      if (first) first.onchange = async () => {
        const v = first.value, patch = v === "blind" ? { blind: true, first_side_id: null } : { blind: false, first_side_id: +v || null };
        const { error } = await sb.from("cup_rounds").update(patch).eq("id", r.id); if (check(error)) loadCup();
      };
      box.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
        const st = b.dataset.st;
        if (st === "lineups" && r.status === "setup" && (!r.format || (!r.first_side_id && !r.blind)) && !confirm("The format or who goes first isn't picked yet. Captains can still pick them in the app. Open lineups anyway?")) return;
        if (st === "lineups" && r.status === "revealed" && !confirm("Hide the matchups again? Scores already entered stay.")) return;
        const { error } = await sb.from("cup_rounds").update({ status: st }).eq("id", r.id); if (check(error, STATUS[st])) loadCup();
      });
      const rv = box.querySelector("[data-reveal]");
      if (rv) rv.onclick = async () => {
        if (rv.dataset.early && !confirm("Not every lineup is submitted. Reveal anyway?")) return;
        const { error } = await sb.from("cup_rounds").update({ status: "revealed", revealed_at: new Date().toISOString() }).eq("id", r.id);
        if (check(error, "Matchups revealed in the app")) loadCup();
      };
      box.querySelectorAll(".lu [data-side]").forEach(sbox => {
        const sid = +sbox.dataset.side;
        sbox.querySelectorAll("[data-slot]").forEach(row => row.querySelectorAll("[data-e]").forEach(el => el.onchange = async () => {
          const slot = +row.dataset.slot, cur = D.entries.find(e => e.round_id === r.id && e.side_id === sid && e.slot === slot) || {};
          const rec = { round_id: r.id, side_id: sid, slot, player_id: cur.player_id ?? null, partner_id: cur.partner_id ?? null, [el.dataset.e]: +el.value || null };
          const res = !rec.player_id && !rec.partner_id ? await sb.from("cup_entries").delete().eq("round_id", r.id).eq("side_id", sid).eq("slot", slot)
            : await sb.from("cup_entries").upsert(rec, { onConflict: "round_id,side_id,slot" });
          if (check(res.error)) loadCup();
        }));
        const un = sbox.querySelector("[data-unlock]");
        if (un) un.onclick = async () => { const { error } = await sb.from("cup_submissions").delete().eq("round_id", r.id).eq("side_id", sid); if (check(error, "Unlocked")) loadCup(); };
      });
      box.querySelectorAll("[data-ovr]").forEach(el => el.onchange = async () => {
        const slot = +el.closest("tr").dataset.slot, v = el.value;
        const res = v === "auto" ? await sb.from("cup_match_overrides").delete().eq("round_id", r.id).eq("slot", slot)
          : await sb.from("cup_match_overrides").upsert({ round_id: r.id, slot, winner_side_id: v === "half" ? null : +v }, { onConflict: "round_id,slot" });
        if (check(res.error)) loadCup();
      });
    });
  }

  A.onLoad = () => loadCups();
})();
