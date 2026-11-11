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
    if (!cup) { D = null; if (A.onCupLoaded) A.onCupLoaded(null, null); $("cupBody").innerHTML = '<p class="note">No Cup yet. Start one with the button above; it copies the sides from the last Cup.</p>'; return; }
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
    const [{ data: entries }, { data: subs }, { data: ovr }, { data: scores }, { data: avail }] = await Promise.all([q("cup_entries"), q("cup_submissions"), q("cup_match_overrides"), q("cup_scores"), q("cup_availability")]);
    const tbc = new Map(); (tees || []).forEach(t => { if (!tbc.has(t.course_id)) tbc.set(t.course_id, []); tbc.get(t.course_id).push(t); });
    D = { sides: sides || [], cp: cp || [], rounds: rounds || [], entries: entries || [], subs: subs || [], ovr: ovr || [], scores: scores || [], avail: avail || [], tbc };
    render();
    if (A.onCupLoaded) A.onCupLoaded(cup, D);
  }
  $("cupPick").onchange = () => loadCups(+$("cupPick").value);

  $("cupNew").onclick = async () => {
    const y = (cups[0]?.year || new Date().getFullYear() - 1) + 1;
    const name = prompt("Name for the new Cup", `Queen City Cup ${y}`); if (!name) return;
    const prev = cups[0];
    const { data: c, error } = await sb.from("cups").insert({ name, year: +(name.match(/\b(20\d\d)\b/) || [])[1] || y, active: false }).select().single(); if (!check(error, "")) return;
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
      { cup_id: c.id, number: 1, name: "Round 1", holes: 9, status: "setup", format: null, format_side_id: chal.id, order_side_id: def.id, allow_blind: false, course_id: null, course2_id: null },
      { cup_id: c.id, number: 2, name: "Round 2", holes: 9, status: "setup", format: null, format_side_id: def.id, order_side_id: chal.id, allow_blind: false, course_id: null, course2_id: null },
      { cup_id: c.id, number: 3, name: "Final", holes: 18, status: "setup", format: "singles", format_side_id: null, order_side_id: def.id, allow_blind: true, course_id: A.courses[0]?.id ?? null, course2_id: A.courses[1]?.id ?? null }
    ]);
    await addSubs(c.id, new Set((pp || []).filter(x => map.get(x.side_id)).map(x => x.player_id)));
    toast(`${name} created`); loadCups(c.id);
  };

  // Subs: no side, eligible once they have at least two league rounds. Their Cup index is frozen like everyone's.
  const eligible = pid => (A.hcps.get(pid)?.rounds_available ?? 0) >= 2;
  async function addSubs(cupId, taken) {
    const rows = A.players.filter(p => p.active && !taken.has(p.id) && eligible(p.id)).map(p => ({ cup_id: cupId, player_id: p.id, side_id: null, handicap_index: A.hcps.get(p.id)?.handicap_index ?? null }));
    if (rows.length) await sb.from("cup_players").upsert(rows, { onConflict: "cup_id,player_id", ignoreDuplicates: true });
  }

  // ---------- totals ----------
  function matchesOf(r) {
    const [sa, sb_] = D.sides; if (!sa || !sb_) return [];
    const es = D.entries.filter(e => e.round_id === r.id), n = window.Cup.slotsFor(r, D.sides, D.cp, canPlay, Math.max(0, ...es.map(e => e.slot)));
    const sc = new Map(D.scores.filter(s => s.round_id === r.id).map(s => [`${s.side_id}:${s.player_id}:${s.hole}`, s.strokes]));
    const info = pid => { const p = P(pid), c = D.cp.find(x => x.player_id === pid); return { name: p ? p.last_name : "?", index: c?.handicap_index ?? A.hcps.get(pid)?.handicap_index ?? 0, tee: p?.default_tee || "Blue" }; };
    const out = [];
    for (let slot = 1; slot <= n; slot++) {
      const ea = es.find(e => e.side_id === sa.id && e.slot === slot && e.player_id), eb = es.find(e => e.side_id === sb_.id && e.slot === slot && e.player_id);
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

  // Availability: side players play unless marked out; a sub plays only for the side named for that round.
  const availOf = (r, pid) => D.avail.find(x => x.round_id === r.id && x.player_id === pid);
  const canPlay = (r, sid, pid) => { const c = D.cp.find(x => x.player_id === pid), a = availOf(r, pid); if (!c) return false; return c.side_id === sid ? (a ? a.available : true) : c.side_id == null && a?.sub_side_id === sid; };
  function availTable() {
    if (!D.rounds.length) return "";
    const byName = (a, b) => pname(P(a.player_id) || {}).localeCompare(pname(P(b.player_id) || {}));
    const leaguers = D.sides.flatMap(s => D.cp.filter(c => c.side_id === s.id).sort(byName));
    const subs = D.cp.filter(c => c.side_id == null).sort(byName);
    const lockedR = r => r.status === "revealed" || r.status === "final";
    const head = D.rounds.map(r => `<th style="text-align:center">${esc(r.name)}</th>`).join("");
    const counts = D.rounds.map(r => `<td style="text-align:center" class="note">${D.sides.map(s => `${esc(s.name)} ${D.cp.filter(c => canPlay(r, s.id, c.player_id)).length}`).join(" · ")}</td>`).join("");
    const lrow = c => `<tr data-p="${c.player_id}"><td>${sideDot(D.sides.find(s => s.id === c.side_id))}${esc(pname(P(c.player_id) || {}))}</td>${D.rounds.map(r => { const a = availOf(r, c.player_id), on = a ? a.available : true; return `<td style="text-align:center"><label class="row" style="gap:4px;justify-content:center"><input type="checkbox" data-av="${r.id}"${on ? " checked" : ""}${lockedR(r) ? " disabled" : ""}><span class="note" style="margin:0">${on ? "Playing" : "Out"}</span></label></td>`; }).join("")}</tr>`;
    const srow = c => `<tr data-p="${c.player_id}"><td>${esc(pname(P(c.player_id) || {}))} <span class="note" style="margin:0">sub</span></td>${D.rounds.map(r => { const v = availOf(r, c.player_id)?.sub_side_id ?? ""; return `<td style="text-align:center"><select data-sub="${r.id}"${lockedR(r) ? " disabled" : ""}><option value="">Not subbing</option>${D.sides.map(s => `<option value="${s.id}"${s.id === v ? " selected" : ""}>Subs for ${esc(s.name)}</option>`).join("")}</select></td>`; }).join("")}</tr>`;
    return `<h3 style="margin:18px 0 8px;font-size:15px">Availability</h3>
      <p class="note">Side players are playing unless you untick them. A sub plays only in the rounds where you pick the side they sub for. Captains only see the players who can play for them that round, and the number of matches follows these counts unless you set it on the round.</p>
      <div class="scroll" style="max-height:520px;overflow:auto"><table id="cupAvail"><thead><tr><th>Player</th>${head}</tr></thead><tbody>
        <tr><td class="note">Available</td>${counts}</tr>
        ${leaguers.map(lrow).join("")}
        ${subs.length ? `<tr><td colspan="${D.rounds.length + 1}" style="font-weight:700;padding-top:12px">Subs</td></tr>` + subs.map(srow).join("") : ""}
      </tbody></table></div>`;
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
        <label style="font-weight:600">Year</label><input id="cupYear" type="number" class="w-num" value="${cup.year}" title="The year this Cup counts as in the Cup history">
        <label style="font-weight:600">Defending side</label><select id="cupDef">${sideOpts(cup.defending_side_id, "Not set")}</select>
      </div>
      <div class="row" style="margin-bottom:8px">
        <button class="btn secondary" type="button" id="cupReset">Reset this Cup</button>
        <button class="btn secondary" type="button" id="cupDelete">Delete this Cup</button>
        <span class="note" style="margin:0">Reset keeps sides, players, captains, handicaps and round dates and courses, and clears all lineups, picks, scores, results and availability. Use it after testing.</span>
      </div>
      <div class="scroll"><table><thead><tr><th>Side</th><th>Color</th><th>Captains</th><th>Players</th></tr></thead><tbody>
        ${D.sides.map(s => `<tr data-side="${s.id}"><td><input data-sf="name" value="${esc(s.name)}" style="width:120px"></td><td><input data-sf="color" type="color" value="${esc(s.color)}" style="width:52px;padding:2px"></td>
          <td>${D.cp.filter(c => c.side_id === s.id && c.is_captain).map(c => esc(P(c.player_id)?.last_name || "?")).join(", ") || '<span class="note" style="margin:0">Tick Captain below</span>'}</td>
          <td>${D.cp.filter(c => c.side_id === s.id).length}</td></tr>`).join("")}
      </tbody></table></div>

      <h3 style="margin:18px 0 8px;font-size:15px">Players</h3>
      <p class="note">Tick Captain to give a player the captain page in the app, where they add players to their side and set lineups. Sides stay the same for the whole Cup. Put new players on a side as they join. Subs don't take a side; anyone with at least two league rounds can be a sub. Name the side a sub plays for, round by round, under Availability. The Cup index is frozen when a player is added; "Refresh handicaps" copies everyone's current league index.</p>
      <div class="row" style="margin-bottom:8px">${D.rounds.some(r => r.status === "revealed" || r.status === "final") ? '<span class="pill">Handicaps locked: the first round has started</span>' : '<button class="btn secondary" type="button" id="cupRefresh">Refresh handicaps</button><span class="note" style="margin:0">Use this once the league season is final. It locks when the first round is revealed.</span>'}</div>
      <div class="scroll" style="max-height:420px;overflow:auto"><table id="cupPlayers"><thead><tr><th>Player</th><th>Side</th><th>Captain</th><th class="num">League rounds</th><th class="num">Cup index</th><th class="num">League index now</th></tr></thead><tbody>
        ${roster.map(p => { const c = inCup.get(p.id); return `<tr data-p="${p.id}"><td><b>${esc(pname(p))}</b></td><td><select data-side><option value="">Not playing</option><option value="sub"${c && c.side_id == null ? " selected" : ""}${eligible(p.id) || (c && c.side_id == null) ? "" : " disabled"}>Sub</option>${D.sides.map(s => `<option value="${s.id}"${s.id === c?.side_id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></td><td>${c?.side_id ? `<input type="checkbox" data-cap${c.is_captain ? " checked" : ""} aria-label="Captain">` : ""}</td><td class="num">${A.hcps.get(p.id)?.rounds_available ?? 0}</td><td class="num">${c?.handicap_index != null ? (+c.handicap_index).toFixed(2) : "–"}</td><td class="num">${A.hcps.get(p.id) ? (+A.hcps.get(p.id).handicap_index).toFixed(2) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>

      ${availTable()}

      <h3 style="margin:18px 0 8px;font-size:15px">Rounds</h3>
      ${roundTabs()}
      <div class="row" style="margin-top:10px"><button class="btn secondary" type="button" id="cupAddRound">Add a round</button></div>`;
    wire();
  }
  const fmtPts = v => v % 1 ? `${Math.floor(v) || ""}½` : String(v);

  // One round at a time: a round's tab opens once every round before it is final.
  let selRound = null;
  function roundTabs() {
    const rs = [...D.rounds].sort((a, b) => a.number - b.number);
    if (!rs.length) return "";
    const open = r => rs.filter(x => x.number < r.number).every(x => x.status === "final");
    if (!rs.some(r => r.id === selRound && open(r))) selRound = (rs.find(r => r.status !== "final") || rs[rs.length - 1]).id;
    const tabs = rs.map(r => { const ok = open(r), on = r.id === selRound; return `<button type="button" class="btn${on ? "" : " secondary"}" data-rtab="${r.id}"${ok ? "" : ` disabled title="Opens once ${esc(rs.filter(x => x.number < r.number && x.status !== "final").map(x => x.name).join(", "))} is final"`}>${esc(r.name)}${r.status === "final" ? " ✓" : ok ? "" : " 🔒"}</button>`; }).join("");
    return `<div class="row" style="margin-bottom:10px;gap:6px">${tabs}</div>${roundBox(rs.find(r => r.id === selRound))}`;
  }
  function roundBox(r) {
    const subs = D.subs.filter(s => s.round_id === r.id), done = id => r.blind ? subs.some(s => s.side_id === id) : turnNote(r).includes("Every match is set");
    const courseOpts = sel => `<option value="">–</option>` + A.courses.map(c => `<option value="${c.id}"${c.id === sel ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    const sideOpts = (sel, blank) => (blank ? `<option value="">${blank}</option>` : "") + D.sides.map(s => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const locked = r.status === "revealed" || r.status === "final";
    const f = F[r.format];
    const firstVal = r.blind ? "blind" : r.first_side_id ?? "";
    const act = { setup: `<button class="btn" type="button" data-st="lineups"${r.course_id ? "" : ' title="Pick a course first"'}>Open lineups</button>${r.course_id ? "" : '<span class="note" style="margin:0">Pick a course first</span>'}`,
      lineups: `<button class="btn" type="button" data-reveal${D.sides.every(s => done(s.id)) ? "" : ` data-early="${r.blind ? "Not every lineup is submitted." : "Not every match is set yet."}"`}>Reveal matchups</button><button class="btn secondary" type="button" data-st="setup">Close lineups</button>`,
      revealed: `<button class="btn" type="button" data-st="final">Mark final</button><button class="btn secondary" type="button" data-st="lineups">Hide again</button>${D.scores.some(x => x.round_id === r.id) ? '<button class="btn secondary" type="button" data-clear>Clear all scores</button>' : ""}`,
      final: `<button class="btn secondary" type="button" data-st="revealed">Reopen</button>` }[r.status];
    return `<div class="box" data-round="${r.id}" style="border:1px solid var(--line);border-radius:12px;padding:12px">
      <div class="row" style="justify-content:space-between"><div class="row"><input data-rf="name" value="${esc(r.name)}" style="width:120px;font-weight:600"><span class="pill${r.status === "lineups" ? " warn" : ""}">${STATUS[r.status]}</span></div><div class="row">${act}</div></div>
      <div class="row" style="margin-top:8px">
        <input type="date" data-rf="play_date" value="${r.play_date || ""}"><input type="time" data-rf="tee_time" value="${(r.tee_time || "").slice(0, 5)}">
        <select data-rf="holes"><option value="9"${r.holes === 9 ? " selected" : ""}>9 holes</option><option value="18"${r.holes === 18 ? " selected" : ""}>18 holes</option></select>
        <select data-rf="course_id" title="Course">${courseOpts(r.course_id)}</select>${r.holes === 18 ? `<select data-rf="course2_id" title="Back nine (leave blank for a full 18-hole course)">${courseOpts(r.course2_id)}</select>` : ""}
      </div>
      <div class="row" style="margin-top:8px">
        <label>Format</label><select data-rf="format"${locked || r.allow_blind ? " disabled" : ""}${r.allow_blind ? ' title="The Final is always singles"' : ""}><option value="">Not picked</option>${Object.entries(F).map(([k, v]) => `<option value="${k}"${k === r.format ? " selected" : ""}>${v.label}</option>`).join("")}</select>
        <label>picked by</label><select data-rf="format_side_id">${sideOpts(r.format_side_id, "Admin")}</select>
        <label>Order picked by</label><select data-rf="order_side_id">${sideOpts(r.order_side_id, "Admin")}</select>
        <label>Goes first</label><select data-first${locked ? " disabled" : ""}><option value="">Not picked</option>${D.sides.map(s => `<option value="${s.id}"${String(firstVal) === String(s.id) ? " selected" : ""}>${esc(s.name)} goes first</option>`).join("")}<option value="blind"${r.blind ? " selected" : ""}>Blind</option></select>
        <label>Matches</label><input class="w-num" type="number" min="1" max="30" data-rf="matches" value="${r.matches ?? ""}" placeholder="auto" title="Leave blank to use the size of the bigger side">
      </div>
      ${f ? `<p class="note" style="margin:6px 0 0">${esc(f.how)}${f.w ? ` Team handicap ${f.w[0]} × lower + ${f.w[1]} × higher.` : ""}</p>` : ""}
      ${turnNote(r)}
      <div class="lu" style="margin-top:10px">${D.sides.map(s => lineupBox(r, s, done(s.id))).join("")}</div>
      ${locked ? matchTable(r) : ""}
    </div>`;
  }
  // Whose pick it is in a back-and-forth round, so an admin can fill in for a captain.
  function turnNote(r) {
    if (r.status !== "lineups" || r.blind || !r.first_side_id || !r.format) return r.status === "lineups" && r.blind ? `<p class="note" style="margin:6px 0 0">Blind: you can put in a captain's picks below for them; they still show as not submitted until you reveal.</p>` : "";
    const f = F[r.format], a = r.first_side_id, b = D.sides.find(s => s.id !== a)?.id;
    const size = Math.max(0, ...D.sides.map(s => D.cp.filter(c => canPlay(r, s.id, c.player_id)).length));
    const n = r.matches || Math.max(1, Math.ceil(size / (f.pairs ? 2 : 1)));
    for (let i = 1; i <= n; i++) {
      const th = i % 2 ? a : b, an = i % 2 ? b : a;
      const full = (sid, i) => D.entries.some(e => e.round_id === r.id && e.side_id === sid && e.slot === i && e.player_id && (!f.pairs || e.partner_id));
      const who = !full(th, i) ? [th, "throw out"] : !full(an, i) ? [an, "answer"] : null;
      if (who) return `<p class="note" style="margin:6px 0 0"><b>Next pick: ${esc(sideName(who[0]))} to ${who[1]} match ${i}.</b> To pick for a captain, fill in ${esc(sideName(who[0]))}'s line ${i} below.</p>`;
    }
    return `<p class="note" style="margin:6px 0 0"><b>Every match is set.</b> Ready to reveal.</p>`;
  }
  function lineupBox(r, s, submitted) {
    const f = F[r.format] || F.singles, all = D.cp.filter(c => c.side_id === s.id).map(c => P(c.player_id)).filter(Boolean).sort((a, b) => pname(a).localeCompare(pname(b)));
    const inLineup = new Set(D.entries.filter(e => e.round_id === r.id && e.side_id === s.id).flatMap(e => [e.player_id, e.partner_id]));
    const mine = all.filter(p => canPlay(r, s.id, p.id) || inLineup.has(p.id));
    const es = D.entries.filter(e => e.round_id === r.id && e.side_id === s.id);
    const n = Math.max(f.pairs ? Math.ceil(mine.length / 2) : mine.length, ...es.map(e => e.slot), 1);
    const subs = D.cp.filter(c => c.side_id == null && (canPlay(r, s.id, c.player_id) || inLineup.has(c.player_id))).map(c => P(c.player_id)).filter(Boolean).sort((a, b) => pname(a).localeCompare(pname(b)));
    // A player already in this round's lineups shows greyed out, so nobody can be picked twice (Nitin 2026-11-11)
    const used = new Set(D.entries.filter(e => e.round_id === r.id).flatMap(e => [e.player_id, e.partner_id]).filter(Boolean));
    const o = (p, sel) => `<option value="${p.id}"${p.id === sel ? " selected" : used.has(p.id) ? " disabled" : ""}>${esc(pname(p))}${p.id !== sel && used.has(p.id) ? " (picked)" : ""}</option>`;
    const opt = sel => `<option value="">–</option>` + mine.map(p => o(p, sel)).join("") + (subs.length ? `<optgroup label="Subs">${subs.map(p => o(p, sel)).join("")}</optgroup>` : "");
    const locked = r.status === "revealed" || r.status === "final";
    return `<div class="box" data-side="${s.id}"><h4>${sideDot(s)}${esc(s.name)} ${r.blind ? "picks" : "lineup"} ${!r.blind ? `<span class="pill">${es.filter(e => e.player_id).length} picked</span>` : submitted ? '<span class="pill">Submitted</span>' : '<span class="pill warn">Not submitted</span>'}</h4>
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
  // Tell the captain whose pick it is now (push alert; fire and forget)
  const pingTurn = rid => { try { sb.functions.invoke("push", { body: { action: "cup_turn", round_id: rid } }); } catch (e) {} };
  function wire() {
    const body = $("cupBody");
    $("cupActive").onchange = async e => {
      if (e.target.checked && cups.some(c => c.active && c.id !== cup.id)) await sb.from("cups").update({ active: false }).neq("id", cup.id);
      const { error } = await sb.from("cups").update({ active: e.target.checked }).eq("id", cup.id);
      if (check(error, e.target.checked ? "Cup mode is on in the app" : "Cup mode is off")) loadCups(cup.id);
    };
    $("cupReset").onclick = async () => {
      if (prompt(`Reset ${cup.name}? Every lineup, pick, score, result and availability mark is deleted and all rounds go back to setup. Sides, players, captains and handicaps stay. Type RESET to confirm.`) !== "RESET") return;
      const rids = D.rounds.map(r => r.id);
      if (rids.length) for (const t of ["cup_scores", "cup_match_overrides", "cup_submissions", "cup_entries", "cup_availability"]) {
        const { error } = await sb.from(t).delete().in("round_id", rids); if (!check(error, "")) return;
      }
      for (const r of D.rounds) {
        const { error } = await sb.from("cup_rounds").update({ status: "setup", revealed_at: null, blind: false, first_side_id: null, format: r.allow_blind ? "singles" : null }).eq("id", r.id);
        if (!check(error, "")) return;
      }
      toast(`${cup.name} reset`); loadCup();
    };
    $("cupDelete").onclick = async () => {
      if (prompt(`Delete ${cup.name} completely, with its sides, players, rounds and scores? Cup history entries stay. Type DELETE to confirm.`) !== "DELETE") return;
      await sb.from("cups").update({ defending_side_id: null }).eq("id", cup.id);
      const { error } = await sb.from("cups").delete().eq("id", cup.id);
      if (check(error, `${cup.name} deleted`)) { cup = null; loadCups(); }
    };
    $("cupName").onchange = async e => { const { error } = await sb.from("cups").update({ name: e.target.value.trim() }).eq("id", cup.id); if (check(error)) loadCups(cup.id); };
    $("cupYear").onchange = async e => { const y = +e.target.value; if (!y) return; const { error } = await sb.from("cups").update({ year: y }).eq("id", cup.id); if (check(error, `Counts as ${y} in the Cup history`)) { cup.year = y; loadHistory(); } };
    $("cupDef").onchange = async e => { const { error } = await sb.from("cups").update({ defending_side_id: +e.target.value || null }).eq("id", cup.id); if (check(error)) cup.defending_side_id = +e.target.value || null; };
    body.querySelectorAll("[data-sf]").forEach(el => el.onchange = async () => {
      const id = +el.closest("tr").dataset.side, k = el.dataset.sf, v = k === "captain_id" ? (+el.value || null) : el.value;
      const { error } = await sb.from("cup_sides").update({ [k]: v }).eq("id", id); if (check(error)) loadCup();
    });
    body.querySelectorAll("#cupPlayers [data-side]").forEach(el => el.onchange = async () => {
      const pid = +el.closest("tr").dataset.p, sub = el.value === "sub", sid = sub ? null : (+el.value || null);
      const r = sid || sub ? await sb.from("cup_players").upsert({ cup_id: cup.id, player_id: pid, side_id: sid, handicap_index: D.cp.find(c => c.player_id === pid)?.handicap_index ?? A.hcps.get(pid)?.handicap_index ?? null }, { onConflict: "cup_id,player_id" })
        : await sb.from("cup_players").delete().eq("cup_id", cup.id).eq("player_id", pid);
      if (check(r.error)) loadCup();
    });
    body.querySelectorAll("#cupPlayers [data-cap]").forEach(el => el.onchange = async () => {
      const pid = +el.closest("tr").dataset.p;
      const { error } = await sb.from("cup_players").update({ is_captain: el.checked }).eq("cup_id", cup.id).eq("player_id", pid);
      if (check(error, el.checked ? "Captain tag added" : "Captain tag removed")) loadCup();
    });
    if ($("cupRefresh")) $("cupRefresh").onclick = async () => {
      if (!confirm("Copy everyone's current league index into the Cup? Strokes in matches not yet finished will follow.")) return;
      const rows = D.cp.map(c => ({ cup_id: cup.id, player_id: c.player_id, side_id: c.side_id, handicap_index: A.hcps.get(c.player_id)?.handicap_index ?? c.handicap_index }));
      const { error } = await sb.from("cup_players").upsert(rows, { onConflict: "cup_id,player_id" }); if (!check(error, "Handicaps refreshed")) return;
      await addSubs(cup.id, new Set(D.cp.map(c => c.player_id))); loadCup();
    };
    const saveAvail = async (rid, pid, patch) => {
      const cur = D.avail.find(x => x.round_id === rid && x.player_id === pid);
      const { error } = await sb.from("cup_availability").upsert({ round_id: rid, player_id: pid, available: cur ? cur.available : true, sub_side_id: cur ? cur.sub_side_id : null, ...patch }, { onConflict: "round_id,player_id" });
      if (check(error)) loadCup();
    };
    body.querySelectorAll("#cupAvail [data-av]").forEach(el => el.onchange = () => saveAvail(+el.dataset.av, +el.closest("tr").dataset.p, { available: el.checked }));
    body.querySelectorAll("#cupAvail [data-sub]").forEach(el => el.onchange = () => saveAvail(+el.dataset.sub, +el.closest("tr").dataset.p, { sub_side_id: +el.value || null, available: true }));
    body.querySelectorAll("[data-rtab]").forEach(b => b.onclick = () => { selRound = +b.dataset.rtab; render(); });
    $("cupAddRound").onclick = async () => {
      const n = Math.max(0, ...D.rounds.map(r => r.number)) + 1;
      const { error } = await sb.from("cup_rounds").insert({ cup_id: cup.id, number: n, name: `Round ${n}`, holes: 9, status: "setup" }); if (check(error, "Round added")) loadCup();
    };
    body.querySelectorAll("[data-round]").forEach(box => {
      const r = D.rounds.find(x => x.id === +box.dataset.round);
      box.querySelectorAll("[data-rf]").forEach(el => el.onchange = async () => {
        const k = el.dataset.rf; let v = el.value || null;
        if (["holes", "course_id", "course2_id", "format_side_id", "order_side_id", "matches"].includes(k)) v = v == null ? null : +v;
        const { error } = await sb.from("cup_rounds").update({ [k]: v }).eq("id", r.id); if (check(error)) { if (k === "format") pingTurn(r.id); loadCup(); }
      });
      const first = box.querySelector("[data-first]");
      if (first) first.onchange = async () => {
        const v = first.value, patch = v === "blind" ? { blind: true, first_side_id: null } : { blind: false, first_side_id: +v || null };
        const { error } = await sb.from("cup_rounds").update(patch).eq("id", r.id); if (check(error)) { pingTurn(r.id); loadCup(); }
      };
      box.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
        const st = b.dataset.st;
        if (st === "lineups" && r.status === "setup" && !r.course_id) { alert("Pick a course for this round before opening lineups. Handicaps and scoring need it."); return; }
        if (st === "lineups" && r.status === "setup" && (!r.format || (!r.first_side_id && !r.blind)) && !confirm("The format or who goes first isn't picked yet. Captains can still pick them in the app. Open lineups anyway?")) return;
        if (st === "lineups" && r.status === "revealed" && !confirm("Hide the matchups again? Scores already entered stay.")) return;
        const { error } = await sb.from("cup_rounds").update({ status: st }).eq("id", r.id);
        if (check(error, STATUS[st])) {
          if (st === "lineups") pingTurn(r.id);
          // Round finished: the captains of the next round get their format / order call
          if (st === "final") { const nx = D.rounds.filter(x => x.number > r.number && x.status !== "final").sort((a, b) => a.number - b.number)[0]; if (nx) pingTurn(nx.id); }
          loadCup();
        }
      });
      const cl = box.querySelector("[data-clear]");
      if (cl) cl.onclick = async () => {
        const n = D.scores.filter(x => x.round_id === r.id).length;
        if (prompt(`Delete all ${n} scores for ${r.name}? Matches go back to not started. This can't be undone. Type CLEAR to confirm.`) !== "CLEAR") return;
        const { error } = await sb.from("cup_scores").delete().eq("round_id", r.id);
        if (check(error, "All scores cleared")) loadCup();
      };
      const rv = box.querySelector("[data-reveal]");
      if (rv) rv.onclick = async () => {
        if (rv.dataset.early && !confirm(rv.dataset.early + " Reveal anyway?")) return;
        const { error } = await sb.from("cup_rounds").update({ status: "revealed", revealed_at: new Date().toISOString() }).eq("id", r.id);
        if (check(error, "Matchups revealed in the app")) { try { sb.functions.invoke("push", { body: { action: "cup_revealed", round_id: r.id } }); } catch (e) {} loadCup(); }
      };
      box.querySelectorAll(".lu [data-side]").forEach(sbox => {
        const sid = +sbox.dataset.side;
        sbox.querySelectorAll("[data-slot]").forEach(row => row.querySelectorAll("[data-e]").forEach(el => el.onchange = async () => {
          const slot = +row.dataset.slot, cur = D.entries.find(e => e.round_id === r.id && e.side_id === sid && e.slot === slot) || {};
          const pick = +el.value || null, clash = pick && D.entries.find(e => e.round_id === r.id && (e.player_id === pick || e.partner_id === pick) && !(e.side_id === sid && e.slot === slot && cur[el.dataset.e] === pick))
            || (pick && el.dataset.e === "partner_id" && cur.player_id === pick) || (pick && el.dataset.e === "player_id" && cur.partner_id === pick);
          if (clash) { alert(`${pname(P(pick) || {})} is already in this round's lineups.`); loadCup(); return; }
          const rec = { round_id: r.id, side_id: sid, slot, player_id: cur.player_id ?? null, partner_id: cur.partner_id ?? null, [el.dataset.e]: +el.value || null };
          const res = !rec.player_id && !rec.partner_id ? await sb.from("cup_entries").delete().eq("round_id", r.id).eq("side_id", sid).eq("slot", slot)
            : await sb.from("cup_entries").upsert(rec, { onConflict: "round_id,side_id,slot" });
          if (check(res.error)) { if (!r.blind && rec.player_id && (!F[r.format]?.pairs || rec.partner_id)) pingTurn(r.id); loadCup(); }
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

  // ---------- history ----------
  async function loadHistory() {
    const [{ data }, { data: ph }, { data: appCups }] = await Promise.all([sb.from("cup_history").select("*").order("year", { ascending: false }), sb.from("cup_photos").select("year,photo"), sb.from("cups").select("year,name").order("year", { ascending: false })]);
    const rows = data || [], photo = new Map((ph || []).map(x => [x.year, x.photo]));
    const pcell = y => { const u = photo.get(y); return `<td data-py="${y}"><div class="row" style="gap:6px;flex-wrap:nowrap">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:6px;display:block"></a>` : '<span class="note">none</span>'}
      <label class="btn secondary" style="padding:5px 9px;font-size:13px;white-space:nowrap">${u ? "Replace" : "Add"}<input type="file" accept="image/*" data-pup hidden></label>${u ? '<button class="btn secondary" type="button" data-prm style="padding:5px 9px;font-size:13px">Remove</button>' : ""}</div></td>`; };
    const appOnly = (appCups || []).filter(c => !rows.some(r => r.year === c.year));
    $("histTable").innerHTML = `<thead><tr><th>Year</th><th>Side</th><th class="num">Pts</th><th>Side</th><th class="num">Pts</th><th>Winner</th><th>Notes</th><th>League photo</th><th></th></tr></thead><tbody>` +
      appOnly.map(c => `<tr><td>${c.year}</td><td colspan="6" class="note">${esc(c.name || "")}, played in the app (results fill in by themselves)</td>${pcell(c.year)}<td></td></tr>`).join("") +
      (rows.map(h => `<tr data-id="${h.id}"><td><input class="w-num" type="number" data-h="year" value="${h.year}"></td>
        <td><input data-h="side1_name" value="${esc(h.side1_name)}" style="width:90px"></td><td><input class="w-num" type="number" step="0.5" data-h="side1_points" value="${h.side1_points ?? ""}"></td>
        <td><input data-h="side2_name" value="${esc(h.side2_name)}" style="width:90px"></td><td><input class="w-num" type="number" step="0.5" data-h="side2_points" value="${h.side2_points ?? ""}"></td>
        <td><input data-h="winner" value="${esc(h.winner || "")}" placeholder="by points" style="width:100px"></td><td><input data-h="notes" value="${esc(h.notes || "")}" style="width:220px"></td>
        ${pcell(h.year)}<td><button class="btn danger" type="button" data-hdel>Delete</button></td></tr>`).join("") || (appOnly.length ? "" : '<tr><td colspan="9" class="note">No past years yet.</td></tr>')) + "</tbody>";
    $("histTable").querySelectorAll("[data-pup]").forEach(el => el.onchange = async () => {
      const f = el.files[0], y = +el.closest("[data-py]").dataset.py; if (!f) return;
      try { toast("Uploading…"); const url = await A.uploadPhoto(f, `cup-${y}`);
        const { error } = await sb.from("cup_photos").upsert({ year: y, photo: url }); if (check(error, "Photo saved")) loadHistory();
      } catch (e) { toast("Couldn't upload: " + (e.message || e), true); }
    });
    $("histTable").querySelectorAll("[data-prm]").forEach(b => b.onclick = async () => {
      if (!confirm("Take this photo off the Cup history?")) return;
      const { error } = await sb.from("cup_photos").delete().eq("year", +b.closest("[data-py]").dataset.py); if (check(error, "Photo removed")) loadHistory();
    });
    $("histTable").querySelectorAll("[data-h]").forEach(el => el.onchange = async () => {
      const k = el.dataset.h, v = ["year", "side1_points", "side2_points"].includes(k) ? (el.value === "" ? null : +el.value) : (el.value.trim() || null);
      const { error } = await sb.from("cup_history").update({ [k]: v }).eq("id", +el.closest("tr").dataset.id); check(error);
    });
    $("histTable").querySelectorAll("[data-hdel]").forEach(b => b.onclick = async () => {
      if (!confirm("Delete this year from the Cup history?")) return;
      const { error } = await sb.from("cup_history").delete().eq("id", +b.closest("tr").dataset.id); if (check(error, "Deleted")) loadHistory();
    });
  }
  $("histAdd").onclick = async () => {
    const { data } = await sb.from("cup_history").select("year").order("year").limit(1);
    const y = (data && data[0] ? data[0].year : new Date().getFullYear()) - 1;
    const { error } = await sb.from("cup_history").insert({ year: y, side1_name: "Orange", side2_name: "Blue", side1_points: null, side2_points: null, winner: null, notes: null });
    if (check(error, "Year added")) loadHistory();
  };

  A.onLoad = () => { loadCups(); loadHistory(); };
})();
