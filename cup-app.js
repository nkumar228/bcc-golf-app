// App: Queen City Cup mode. Shown when an admin turns a Cup on. Scoreboard, captain lineups, and match scoring.
(() => {
  const $ = id => document.getElementById(id);
  const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const C = window.Cup, F = C.FORMATS;
  const sb = () => window.BCC && window.BCC.sb, ses = () => window.BCC && window.BCC.getSession();
  let D = null, busy = false, timer = null, savedTitle = null;
  const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  const fmtTime = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${(h + 11) % 12 + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const fmtPts = v => v % 1 ? `${Math.floor(v) || ""}½` : String(v);
  const side = id => D.sides.find(s => s.id === id);
  const sideName = id => side(id)?.name || "?";
  const P = id => D.players.get(id);
  const last = id => P(id)?.last_name || "?";
  const dot = s => `<i class="cdot" style="background:${esc(s?.color || "#888")}"></i>`;

  async function load() {
    const s = ses(); if (!s || !s.real || !sb()) return off();
    const { data: cups } = await sb().from("cups").select("*").eq("active", true).limit(1);
    const cup = cups && cups[0]; if (!cup) return off();
    D = await fetchCup(cup, s.playerId);
    D.mySide = D.cp.find(c => c.player_id === D.me)?.side_id ?? null;
    D.captainOf = D.cp.find(c => c.player_id === D.me && c.is_captain && c.side_id)?.side_id ?? null;
    on(); render();
  }
  async function fetchCup(cup, me) {
    const [{ data: sides }, { data: cp }, { data: rounds }, { data: pl }, { data: tees }] = await Promise.all([
      sb().from("cup_sides").select("*").eq("cup_id", cup.id).order("sort").order("id"),
      sb().from("cup_players").select("*").eq("cup_id", cup.id),
      sb().from("cup_rounds").select("*").eq("cup_id", cup.id).order("number"),
      sb().from("players").select("id,first_name,last_name,default_tee,active,email,phone"),
      sb().from("tees").select("course_id,name,rating,slope,par,tee_holes(hole,par,yards,stroke_index)")
    ]);
    const rids = (rounds || []).map(r => r.id);
    const q = t => rids.length ? sb().from(t).select("*").in("round_id", rids) : Promise.resolve({ data: [] });
    const [{ data: entries }, { data: subs }, { data: ovr }, { data: scores }] = await Promise.all([q("cup_entries"), q("cup_submissions"), q("cup_match_overrides"), q("cup_scores")]);
    const tbc = new Map(); (tees || []).forEach(t => { if (!tbc.has(t.course_id)) tbc.set(t.course_id, []); tbc.get(t.course_id).push(t); });
    return { cup, sides: sides || [], cp: cp || [], rounds: rounds || [], players: new Map((pl || []).map(p => [p.id, p])), entries: entries || [], subs: subs || [], ovr: ovr || [], scores: scores || [], tbc, me };
  }

  // ---------- Cup history (menu page) ----------
  async function loadHistory() {
    const body = $("histBody"), s = ses();
    if (!s || !s.real || !sb()) { body.innerHTML = '<div class="card pad"><p class="updated" style="margin:0">Sign in to see the Cup history.</p></div>'; return; }
    body.innerHTML = '<p class="updated">Loading…</p>';
    const [{ data: hist }, { data: cups }] = await Promise.all([sb().from("cup_history").select("*").order("year", { ascending: false }), sb().from("cups").select("*").order("year", { ascending: false })]);
    const rows = (hist || []).map(h => ({ year: h.year, a: h.side1_name, ap: h.side1_points, b: h.side2_name, bp: h.side2_points, winner: h.winner, notes: h.notes }));
    // Cups played in the app count once every round is final (unless that year was entered by hand)
    for (const c of cups || []) {
      if (rows.some(r => r.year === c.year)) continue;
      const data = await fetchCup(c, s.playerId);
      if (!data.rounds.length || data.rounds.some(r => r.status !== "final") || data.sides.length < 2) continue;
      const saved = D; D = data;
      const t = Object.fromEntries(D.sides.map(x => [x.id, 0]));
      D.rounds.forEach(r => matchesOf(r).forEach(m => D.sides.forEach(x => t[x.id] += m.pts.pts[x.id])));
      const [A, B] = D.sides, holder = D.sides.find(x => x.id === c.defending_side_id);
      rows.push({ year: c.year, a: A.name, ap: t[A.id], b: B.name, bp: t[B.id], winner: t[A.id] === t[B.id] && holder ? holder.name : null, notes: t[A.id] === t[B.id] && holder ? `Tied; ${holder.name} kept the Cup` : null });
      D = saved;
    }
    rows.sort((x, y) => y.year - x.year);
    const win = r => r.winner || (r.ap == null || r.bp == null ? null : +r.ap > +r.bp ? r.a : +r.bp > +r.ap ? r.b : null);
    const tally = {}; let ties = 0;
    rows.forEach(r => { const w = win(r); if (w) tally[w] = (tally[w] || 0) + 1; else if (r.ap != null && r.bp != null) ties++; [r.a, r.b].forEach(n => tally[n] = tally[n] || 0); });
    const color = n => /orange/i.test(n) ? "#e8711c" : /blue/i.test(n) ? "#2f6fd6" : "var(--muted)";
    const pts = v => v == null ? "–" : fmtPts(+v);
    if (!rows.length) { body.innerHTML = '<div class="card pad"><p class="updated" style="margin:0">No Cup results yet. The commissioner can add past years on the admin site.</p></div>'; return; }
    body.innerHTML = `<div class="card pad"><p class="label">All-time record</p><div class="cup-board">${Object.entries(tally).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([n, w]) => `<div class="cside" style="--c:${color(n)}"><span>${esc(n)}</span><b class="num">${w}</b><small>Cup${w === 1 ? "" : "s"} won</small></div>`).join("")}</div>
      <p class="updated" style="margin:8px 0 0">${rows.length} Cup${rows.length === 1 ? "" : "s"} played${ties ? ` · ${ties} tied` : ""}.</p></div>
      <div class="card pad"><p class="label">Year by year</p><div class="cmatches">${rows.map(r => { const w = win(r); return `<div class="cm"><span class="${w === r.a ? "lead" : ""}" style="--c:${color(r.a)}">${esc(r.a)} ${pts(r.ap)}</span><em><b>${r.year}</b>${r.notes ? "<br>" + esc(r.notes) : ""}</em><span class="r ${w === r.b ? "lead" : ""}" style="--c:${color(r.b)}">${pts(r.bp)} ${esc(r.b)}</span></div>`; }).join("")}</div></div>`;
  }
  function off() {
    D = null; document.body.classList.remove("cup-on");
    const t = document.querySelector('.tabs a[data-tab="rounds"], .tabs a[data-tab="cup"]');
    if (t) { t.href = "#rounds"; t.dataset.tab = "rounds"; t.lastChild.textContent = "Rounds"; }
    if ($("cupHome")) $("cupHome").hidden = true;
    if ($("cupScore")) $("cupScore").hidden = true;
    if (savedTitle) { $("evTitle").textContent = savedTitle[0]; $("evSub").textContent = savedTitle[1]; savedTitle = null; }
    if (location.hash === "#cup") location.hash = "#home";
  }
  function on() {
    document.body.classList.add("cup-on");
    const t = document.querySelector('.tabs a[data-tab="rounds"], .tabs a[data-tab="cup"]');
    if (t) { t.href = "#cup"; t.dataset.tab = "cup"; t.lastChild.textContent = "Cup"; if (location.hash === "#cup") t.setAttribute("aria-current", "page"); }
    $("cupHome").hidden = false; $("cupScore").hidden = false;
    if (!savedTitle) savedTitle = [$("evTitle").textContent, $("evSub").textContent];
    if (!timer) timer = setInterval(() => { if (document.visibilityState === "visible" && ["#cup", "#captain", "#score", "", "#home"].includes(location.hash) && !busy && !document.activeElement?.matches?.("#v-cup input, #v-cup select, #v-captain select, #cupScore input")) load(); }, 20000);
  }

  // ---------- matches ----------
  function matchesOf(r) {
    const [sa, sb_] = D.sides; if (!sa || !sb_) return [];
    const es = D.entries.filter(e => e.round_id === r.id), n = Math.max(0, ...es.map(e => e.slot));
    const sc = new Map(D.scores.filter(s => s.round_id === r.id).map(s => [`${s.side_id}:${s.player_id}:${s.hole}`, s.strokes]));
    const info = pid => { const p = P(pid), c = D.cp.find(x => x.player_id === pid); return { name: p?.last_name || "?", index: c?.handicap_index ?? 0, tee: p?.default_tee || "Blue" }; };
    const out = [];
    for (let slot = 1; slot <= n; slot++) {
      const ea = es.find(e => e.side_id === sa.id && e.slot === slot && e.player_id), eb = es.find(e => e.side_id === sb_.id && e.slot === slot && e.player_id);
      if (!ea && !eb) continue;
      const m = C.setupMatch(r, [{ id: sa.id, entry: ea }, { id: sb_.id, entry: eb }], info, D.tbc);
      const st = C.matchStatus(m, [sa.id, sb_.id], sc, sideName);
      const ov = D.ovr.find(o => o.round_id === r.id && o.slot === slot);
      if (ov) st.text = ov.winner_side_id ? `${sideName(ov.winner_side_id)} wins${ov.note ? " (" + ov.note + ")" : ""}` : "Halved";
      out.push({ slot, ea, eb, m, st, ov, sc, pts: C.points(st, ov, [sa.id, sb_.id]) });
    }
    return out;
  }
  const shown = r => r.status === "revealed" || r.status === "final";

  // ---------- render ----------
  function render() {
    if (!D) return;
    const tot = Object.fromEntries(D.sides.map(s => [s.id, 0])), live = Object.fromEntries(D.sides.map(s => [s.id, 0]));
    const all = D.rounds.map(r => ({ r, ms: shown(r) ? matchesOf(r) : [] }));
    all.forEach(x => x.ms.forEach(m => D.sides.forEach(s => { tot[s.id] += m.pts.pts[s.id]; live[s.id] += m.pts.live[s.id]; })));
    const anyLive = D.sides.some(s => live[s.id] !== tot[s.id]);
    const totalPts = all.reduce((t, x) => t + (shown(x.r) ? x.ms.length : 0), 0);
    const totalAvail = all.reduce((t, x) => t + (shown(x.r) ? x.ms.length : x.r.format ? matchCount(x.r) : (x.r.allow_blind ? matchCount({ ...x.r, format: "singles" }) : matchCount({ ...x.r, format: "four_ball" }))), 0);
    const board = `<div class="cup-board">${D.sides.map(s => `<div class="cside" style="--c:${esc(s.color)}"><span>${esc(s.name)}${D.cup.defending_side_id === s.id ? " · holds the Cup" : ""}</span><b class="num">${fmtPts(tot[s.id])}</b>${anyLive ? `<small>${fmtPts(live[s.id])} if it ended now</small>` : ""}</div>`).join("")}</div>`;
    const myRound = D.rounds.find(r => r.status === "revealed" && myMatch(r));
    const ryderBoardHome = () => ryderBoard(tot, live, totalAvail);
    const cur = D.rounds.find(r => r.status === "revealed") || D.rounds.find(r => r.status === "lineups" || r.status === "setup") || [...D.rounds].reverse().find(r => r.status === "final");
    $("evTitle").textContent = D.cup.name;
    $("evSub").textContent = cur ? `${cur.name} · ${roundLine(cur)}` : "Queen City Cup";
    const curCard = cur ? roundCard(cur, shown(cur) ? matchesOf(cur) : []) : "";
    const myLine = myRound ? (() => { const m = myMatch(myRound); return `<div class="card pad"><div class="head"><p class="label">Your match · ${esc(myRound.name)}</p></div><div class="cstat">${esc(m.st.text)}</div><a class="btn small" href="#score" style="justify-self:start;display:inline-block;margin-top:6px">Score my match</a></div>`; })() : "";
    $("cupHome").innerHTML = `${myTurnCard(true)}${ryderBoardHome()}${myLine}${curCard}${D.captainOf ? `<a class="card pad caplink" href="#captain"><b>Captain page</b><span class="updated">Your side, formats, order and picks</span></a>` : ""}`;
    const next = D.rounds.find(r => r.status !== "final");
    const scoreRound = myRound || D.rounds.find(r => r.status === "revealed") || [...D.rounds].reverse().find(r => r.status === "final");
    $("cupScore").innerHTML = ryderBoard(tot, live, totalAvail) + (myRound ? scorer(myRound) : "") + (scoreRound ? roundCard(scoreRound, matchesOf(scoreRound)) : "") + (myRound ? "" : `<div class="card pad"><p class="label">Cup scoring</p><p style="margin:8px 0 0">${next ? `You don't have a match to score yet. Your match shows up here once ${esc(next.name)} is revealed.` : "The Cup is finished."}</p><p class="updated" style="margin:8px 0 0">League scoring comes back when the commissioner turns Cup mode off.</p></div>`);
    $("cupTitle").textContent = D.cup.name;
    $("cupBoard").innerHTML = board;
    $("cupMine").innerHTML = "";
    document.body.classList.toggle("is-captain", !!D.captainOf);
    $("cupCaptain").innerHTML = D.captainOf ? `<a class="card pad caplink" href="#captain"><b>Captain page</b><span class="updated">Your side, formats, order and lineups</span></a>` : "";
    $("capBody").innerHTML = D.captainOf ? captainPage() : '<div class="card pad"><p class="updated" style="margin:0">Only captains can use this page.</p></div>';
    $("cupRounds").innerHTML = all.map(({ r, ms }) => roundCard(r, ms)).join("");
    badge();
    wire(); wireAlerts(); if (D.captainOf) checkAlerts();
  }
  function roundLine(r) {
    const f = F[r.format];
    return [fmtDate(r.play_date), fmtTime(r.tee_time), r.holes + " holes", f ? f.label : "format not picked yet", r.blind ? "blind draw" : ""].filter(Boolean).join(" · ");
  }
  // One match, Ryder Cup style: names on each side, the status box in the leader's colour
  function matchRow(r, m) {
    const [sa, sb_] = D.sides, st = m.st;
    const nm = e => e ? [e.player_id, F[r.format]?.pairs ? e.partner_id : null].filter(Boolean).map(last).map(esc).join("<br>") : "<i>absent</i>";
    const w = m.ov ? m.ov.winner_side_id : st.done ? st.winner : st.leader;
    const halved = m.ov ? !m.ov.winner_side_id : st.done && !st.winner;
    let big, small;
    if (m.ov) { big = halved ? "½" : "WON"; small = m.ov.note || "final"; }
    else if (!st.done && !st.played) { big = "–"; small = r.tee_time ? fmtTime(r.tee_time) : "not started"; }
    else if (st.done) { big = halved ? "½" : st.left ? `${st.up}&${st.left}` : st.played ? `${st.up} UP` : "WON"; small = halved ? "halved" : st.played ? "final" : "forfeit"; }
    else { big = st.up ? `${st.up} UP` : "AS"; small = `thru ${st.played}${st.up && st.up === st.left ? " · dormie" : ""}`; }
    const col = w ? side(w).color : "";
    const mine = [m.ea, m.eb].some(e => e && (e.player_id === D.me || e.partner_id === D.me));
    return `<div class="rm${mine ? " mine" : ""}${st.done || m.ov ? " done" : ""}">
      <div class="rn${w === sa.id ? " lead" : ""}" style="--c:${esc(sa.color)}">${nm(m.ea)}</div>
      <div class="rs${w ? " on" : ""}" style="${w ? `--c:${esc(col)}` : ""}"><b>${big}</b><small>${esc(small)}</small></div>
      <div class="rn r${w === sb_.id ? " lead" : ""}" style="--c:${esc(sb_.color)}">${nm(m.eb)}</div></div>`;
  }
  // Big scoreboard: points won, projected if every match ended now, and what it takes to win
  function ryderBoard(tot, live, totalAvail) {
    const [sa, sb_] = D.sides; if (!sa || !sb_) return "";
    const holder = side(D.cup.defending_side_id), need = totalAvail / 2 + 0.5, keep = totalAvail / 2;
    const half = (s, k) => `<div class="rb-side" style="--c:${esc(s.color)}"><span>${esc(s.name)}${holder && holder.id === s.id ? " · holder" : ""}</span><b class="num">${fmtPts(tot[s.id])}</b></div>`;
    return `<div class="card rb"><div class="rb-top">${half(sa)}<div class="rb-mid">${totalAvail ? `${fmtPts(totalAvail)}<small>points</small>` : ""}</div>${half(sb_)}</div>
      <div class="rb-bar">${D.sides.map(s => `<i style="background:${esc(s.color)};width:${totalAvail ? tot[s.id] / totalAvail * 100 : 0}%"></i>`).join('<i class="gap"></i>')}</div>
      <div class="rb-proj"><span>Projected</span><b style="color:${esc(sa.color)}">${fmtPts(live[sa.id])}</b><em>–</em><b style="color:${esc(sb_.color)}">${fmtPts(live[sb_.id])}</b></div>
      <p class="updated" style="margin:6px 0 0;text-align:center">${totalAvail ? `${fmtPts(need)} to win${holder ? ` · ${esc(holder.name)} keeps the Cup with ${fmtPts(keep)}` : ""}. Projected counts every live match as if it ended now.` : "Projected counts every live match as if it ended now."}</p></div>`;
  }
  function roundCard(r, ms) {
    const subs = D.subs.filter(s => s.round_id === r.id);
    let body;
    if (!shown(r)) {
      const who = D.sides.map(s => `${dot(s)}${esc(s.name)}: ${subs.some(x => x.side_id === s.id) ? "lineup in" : "waiting"}`).join(" &nbsp; ");
      body = `<p class="updated" style="margin:6px 0 0">${r.status === "lineups" ? `Captains are setting lineups. ${who}.` : "Not open yet."} Matchups are hidden until they're revealed.</p>`;
    } else {
      body = `<div class="rmatches">${ms.map(m => matchRow(r, m)).join("") || '<p class="updated">No matches.</p>'}</div>`;
    }
    return `<div class="card pad"><div class="head"><p class="label">${esc(r.name)}</p><span class="updated">${r.status === "final" ? "Final" : r.status === "revealed" ? "Live" : ""}</span></div><div class="updated">${esc(roundLine(r))}</div>${body}</div>`;
  }

  // ---------- my match ----------
  const myMatch = r => matchesOf(r).find(m => [m.ea, m.eb].some(e => e && (e.player_id === D.me || e.partner_id === D.me)));
  function scorer(r) {
    const m = myMatch(r); if (!m) return "";
    const { holes, balls } = m.m;
    const [sa, sb_] = D.sides;
    const order = [...balls.filter(b => b.side === sa.id), ...balls.filter(b => b.side === sb_.id)];
    const head = order.map(b => `<th style="--c:${esc(side(b.side).color)}" class="bh">${esc(b.label)}<small>${esc(b.golfers.map(g => g.tee?.name || "").filter(Boolean)[0] || "")} · ${b.strokes ? `gets ${b.strokes}` : "plays off 0"}</small></th>`).join("");
    const rows = holes.map((h, i) => `<tr><td><b>${h.hole}</b><small>par ${h.par} · ${h.si}</small></td>${order.map(b => { const v = m.sc.get(`${b.side}:${b.key}:${h.hole}`); return `<td><input class="cin" inputmode="numeric" pattern="[0-9]*" maxlength="2" data-side="${b.side}" data-key="${b.key}" data-hole="${h.hole}" value="${v ?? ""}" aria-label="${esc(b.label)} hole ${h.hole}"${r.status !== "revealed" ? " disabled" : ""}>${"<i class='sdot'></i>".repeat(b.perHole[i])}</td>`; }).join("")}<td class="hw">${m.st.perHole[i] == null ? "" : m.st.perHole[i] === 0 ? "½" : dot(side(m.st.perHole[i]))}</td></tr>`).join("");
    const f = F[r.format];
    return `<div class="card pad"><div class="head"><p class="label">Your match · ${esc(r.name)}</p><span class="updated">${esc(f?.label || "")}</span></div>
      <div class="cstat" id="cupStat">${esc(m.st.text)}</div>
      <p class="updated" style="margin:0 0 8px">${f?.ball === "one" ? "One score per side per hole." : "Each golfer's own score."} Dots show handicap strokes, off the lowest in the match. Saves as you type.</p>
      <div class="gridwrap"><table class="csc" data-slot="${m.slot}" data-round="${r.id}"><thead><tr><th>Hole</th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // ---------- captain ----------
  const pairsOf = r => (F[r.format] || F.singles).pairs;
  const matchCount = r => r.matches || Math.max(1, Math.ceil(Math.max(0, ...D.sides.map(s => D.cp.filter(c => c.side_id === s.id).length)) / (pairsOf(r) ? 2 : 1)));
  const entryOf = (r, sid, slot) => D.entries.find(e => e.round_id === r.id && e.side_id === sid && e.slot === slot && e.player_id);
  // Back and forth: match 1 the first side throws out and the other answers; match 2 the other side throws out; and so on.
  function turnOf(r) {
    if (r.blind || !r.first_side_id || !r.format) return null;
    const a = r.first_side_id, b = D.sides.find(s => s.id !== a)?.id, n = matchCount(r);
    for (let i = 1; i <= n; i++) {
      const thrower = i % 2 ? a : b, answerer = i % 2 ? b : a;
      if (!entryOf(r, thrower, i)) return { side: thrower, slot: i, throwing: true };
      if (!entryOf(r, answerer, i)) return { side: answerer, slot: i, throwing: false };
    }
    return { done: true };
  }
  // Course handicap for this round's tees, and the team handicap the format gives a pair
  const chRaw = (r, pid) => { const p = P(pid), c = D.cp.find(x => x.player_id === pid), tee = C.teeFor(r, D.tbc, p?.default_tee || "Blue"); return tee ? C.courseHcpRaw(c?.handicap_index ?? 0, tee, r.holes) : null; };
  const chOf = (r, pid) => { const v = chRaw(r, pid); return v == null ? null : Math.round(v + 1e-9); };
  function teamHcpText(r, a, b) {
    const f = F[r.format]; if (!f || !a) return "";
    const ids = [a, f.pairs ? b : null].filter(Boolean), chs = ids.map(id => chOf(r, id));
    if (chs.some(x => x == null)) return "set the course to see handicaps";
    if (!f.pairs) return `hcp ${chs[0]}`;
    if (ids.length < 2) return `${last(ids[0])} ${chs[0]}`;
    if (f.w) return `team hcp ${C.teamHcp(ids.map(id => chRaw(r, id)), f.w)} (${chs.join(" & ")})`;
    return `hcps ${chs.join(" & ")}`;
  }
  const names = (r, e) => e ? [e.player_id, pairsOf(r) ? e.partner_id : null].filter(Boolean).map(last).map(esc).join(" & ") : "";
  const idxOf = id => { const c = D.cp.find(x => x.player_id === id); return c?.handicap_index != null ? ` (${(+c.handicap_index).toFixed(1)})` : ""; };
  function pickOptions(r, sel, mine) {
    const used = new Set(D.entries.filter(e => e.round_id === r.id).flatMap(e => [e.player_id, e.partner_id]).filter(Boolean));
    const ok = p => !used.has(p.id) || p.id === sel;
    const roster = D.cp.filter(c => c.side_id === mine).map(c => P(c.player_id)).filter(Boolean).filter(ok).sort((a, b) => a.last_name.localeCompare(b.last_name));
    const subs = D.cp.filter(c => c.side_id == null).map(c => P(c.player_id)).filter(Boolean).filter(ok).sort((a, b) => a.last_name.localeCompare(b.last_name));
    const o = p => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(p.last_name)}, ${esc(p.first_name)}${idxOf(p.id)}</option>`;
    return `<option value="">–</option>` + roster.map(o).join("") + (subs.length ? `<optgroup label="Subs (only to even up the sides)">${subs.map(o).join("")}</optgroup>` : "");
  }

  function captainPage() {
    const mine = D.captainOf, ms = side(mine), other = D.sides.find(s => s.id !== mine);
    const myPlayers = D.cp.filter(c => c.side_id === mine).map(c => ({ c, p: P(c.player_id) })).filter(x => x.p).sort((a, b) => a.p.last_name.localeCompare(b.p.last_name));
    const otherIds = new Set(D.cp.filter(c => c.side_id && c.side_id !== mine).map(c => c.player_id));
    const addable = [...D.players.values()].filter(p => p.active !== false && !otherIds.has(p.id) && !myPlayers.some(x => x.p.id === p.id)).sort((a, b) => a.last_name.localeCompare(b.last_name));
    const roster = `<div class="card pad"><div class="head"><p class="label">${dot(ms)}${esc(ms.name)} · your side</p><span class="updated">${myPlayers.length} players</span></div>
      <ul class="croster">${myPlayers.map(({ c, p }) => `<li><span>${esc(p.last_name)}, ${esc(p.first_name)}${c.is_captain ? ' <small class="pill">Captain</small>' : ""}</span><span class="updated">${c.handicap_index != null ? (+c.handicap_index).toFixed(2) : "–"}</span>${c.is_captain ? "<span></span>" : `<button class="linkbtn" type="button" data-drop="${p.id}" aria-label="Take ${esc(p.last_name)} off your side">Remove</button>`}</li>`).join("")}</ul>
      <div class="crow2"><select id="capAdd" style="flex:1 1 200px"><option value="">Add a player…</option>${addable.map(p => `<option value="${p.id}">${esc(p.last_name)}, ${esc(p.first_name)}${D.cp.some(c => c.player_id === p.id) ? " · sub" : ""}</option>`).join("")}</select><button class="btn small" type="button" id="capAddBtn">Add</button></div>
      <p class="updated" style="margin:6px 0 0">You only see your own side here. ${esc(other?.name || "")}'s captain builds theirs.</p></div>`;
    // Only the round in play: later rounds show up once this one is final.
    const cur = D.rounds.find(r => r.status !== "final");
    const body = !cur ? `<div class="card pad"><p class="updated" style="margin:0">Every round is final.</p></div>`
      : cur.status === "revealed" ? `<div class="card pad"><p class="label">${esc(cur.name)}</p><p class="updated" style="margin:6px 0 0">Matches are set and being played. The next round shows up here once this one is final.</p></div>`
      : roundForCaptain(cur, mine, other);
    return myTurnCard() + alertsCard() + roster + body;
  }
  function roundForCaptain(r, mine, other) {
    const f = F[r.format] || null, started = D.entries.some(e => e.round_id === r.id) || D.subs.some(s => s.round_id === r.id);
    const parts = [];
    if (r.format_side_id === mine && !started) parts.push(`<label class="crow"><span>Format</span><select data-fmt="${r.id}"><option value="">Pick one</option>${Object.entries(F).filter(([k]) => r.allow_blind ? k === "singles" : k !== "singles").map(([k, v]) => `<option value="${k}"${k === r.format ? " selected" : ""}>${v.label}</option>`).join("")}</select></label>${f ? `<p class="updated">${esc(f.how)}</p>` : ""}`);
    else parts.push(`<p class="updated">Format: <b>${f ? f.label : "not picked yet"}</b>${!f && r.format_side_id ? ` (${esc(sideName(r.format_side_id))} picks)` : ""}</p>`);
    const ordVal = r.blind ? "blind" : r.first_side_id ?? "";
    if (r.order_side_id === mine && !started) parts.push(`<label class="crow"><span>Order</span><select data-ord="${r.id}"><option value="">Pick one</option>${D.sides.map(s => `<option value="${s.id}"${String(ordVal) === String(s.id) ? " selected" : ""}>${esc(s.name)} goes first</option>`).join("")}<option value="blind"${r.blind ? " selected" : ""}>Blind</option></select></label>`);
    else parts.push(`<p class="updated">Order: <b>${r.blind ? "Blind" : r.first_side_id ? esc(sideName(r.first_side_id)) + " goes first" : "not picked yet"}</b>${!r.blind && !r.first_side_id && r.order_side_id ? ` (${esc(sideName(r.order_side_id))} picks)` : ""}</p>`);
    if (r.status === "setup") parts.push(`<p class="updated">Lineups open when the commissioner opens this round.</p>`);
    else if (!r.format) parts.push(`<p class="updated">Waiting for the format.</p>`);
    else if (!r.blind && !r.first_side_id) parts.push(`<p class="updated">Waiting for the order.</p>`);
    else if (r.blind) parts.push(blindEditor(r, mine, other));
    else parts.push(backAndForth(r, mine, other));
    return `<div class="card pad"><div class="head"><p class="label">${esc(r.name)}</p><span class="updated">${r.status === "lineups" ? "Lineups open" : "Not open yet"}</span></div><div class="updated">${esc(roundLine(r))}</div><div style="display:grid;gap:6px;margin-top:8px">${parts.join("")}</div></div>`;
  }
  function backAndForth(r, mine, other) {
    const t = turnOf(r), n = matchCount(r), a = r.first_side_id, pairs = pairsOf(r), unit = pairs ? "team" : "player";
    const rows = Array.from({ length: n }, (_, k) => { const i = k + 1, thrower = i % 2 ? a : D.sides.find(s => s.id !== a).id, answerer = D.sides.find(s => s.id !== thrower).id;
      const te = entryOf(r, thrower, i), ae = entryOf(r, answerer, i);
      return `<li class="${t && t.slot === i ? "now" : ""}"><span style="--c:${esc(side(thrower).color)}">${te ? names(r, te) + `<small>${esc(teamHcpText(r, te.player_id, te.partner_id))}</small>` : "…"}</span><em>vs</em><span class="r" style="--c:${esc(side(answerer).color)}">${ae ? names(r, ae) + `<small>${esc(teamHcpText(r, ae.player_id, ae.partner_id))}</small>` : "…"}</span><small>${esc(sideName(thrower))} throws out</small></li>`; }).join("");
    const last = D.entries.filter(e => e.round_id === r.id).sort((x, y) => y.id - x.id)[0];
    let action;
    if (t.done) action = `<p class="updated"><b>Every match is set.</b> Waiting for the commissioner to reveal them.</p>`;
    else if (t.side !== mine) action = `<p class="updated">Waiting for ${esc(sideName(t.side))} to ${t.throwing ? `throw out a ${unit} for match ${t.slot}` : `answer match ${t.slot}`}.</p>`;
    else {
      const vs = t.throwing ? "" : ` against ${names(r, entryOf(r, D.sides.find(s => s.id !== mine).id, t.slot))}`;
      action = `<div class="cpick" data-round="${r.id}"><p style="margin:0"><b>Your turn:</b> ${t.throwing ? `throw out a ${unit} for match ${t.slot}` : `answer match ${t.slot}${vs}`}.</p>
        <div class="crow2"><select data-pp="player">${pickOptions(r, null, mine)}</select>${pairs ? `<select data-pp="partner">${pickOptions(r, null, mine)}</select>` : ""}<span class="chcp" data-hcp="${r.id}"></span></div>
        <button class="btn small" type="button" data-place="${r.id}" style="margin-top:8px">${t.throwing ? "Throw out" : "Send"}</button></div>`;
    }
    const undo = last && last.side_id === mine && r.status === "lineups" ? `<button class="linkbtn" type="button" data-undo="${r.id}">Take back my last pick</button>` : "";
    return `<p class="updated">Back and forth: one ${unit} at a time. Each pick shows up for both captains right away; everyone else sees the matches when they're revealed.</p><ol class="cbf">${rows}</ol>${action}${undo}<p class="si-err" id="cupErr${r.id}"></p>`;
  }
  // Push alerts: a captain turns them on once per phone; picks then tell the next captain it's their turn.
  let alertState = null; // "on" | "off" | "denied" | "nosupport" | "ios-install"
  const pushOK = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  async function checkAlerts() {
    let st;
    if (!pushOK()) st = isIOS() && !standalone() ? "ios-install" : "nosupport";
    else if (Notification.permission === "denied") st = "denied";
    else { try { const reg = await navigator.serviceWorker.ready; st = (await reg.pushManager.getSubscription()) && Notification.permission === "granted" ? "on" : "off"; } catch (e) { st = "off"; } }
    if (st !== alertState) { alertState = st; if ($("capAlerts")) $("capAlerts").outerHTML = alertsCard(); wireAlerts(); }
  }
  function alertsCard() {
    const st = alertState, msg = {
      on: `<b>Turn alerts are on</b> for this phone.<br><button class="linkbtn" type="button" id="alertTest">Send me a test</button> · <button class="linkbtn" type="button" id="alertOff">Turn off</button>`,
      off: `<b>Get an alert when it's your turn to pick.</b><br><button class="btn small" type="button" id="alertOn" style="margin-top:8px">Turn on alerts</button>`,
      denied: `<b>Alerts are blocked</b> for this app. Turn notifications back on for it in your phone's settings, then come back here.`,
      "ios-install": `<b>Want an alert when it's your turn?</b> On iPhone, add the app to your Home Screen first (Share, then Add to Home Screen) and open it from there. The button to turn alerts on shows up there.`,
      nosupport: `This browser can't show alerts. Open the app in Chrome (Android) or from your Home Screen (iPhone).`
    }[st];
    return `<div class="card pad" id="capAlerts">${msg ? `<p style="margin:0" class="updated">${msg}</p><p class="si-err" id="alertErr"></p>` : ""}</div>`;
  }
  const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function alertsOn() {
    const err = t => { if ($("alertErr")) $("alertErr").textContent = t; };
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { alertState = null; return checkAlerts(); }
      const { data, error } = await sb().functions.invoke("push", { body: { action: "key" } });
      if (error || !data?.key) return err("Couldn't reach the alert server. Try again in a minute.");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(data.key) });
      const j = sub.toJSON();
      const { error: e2 } = await sb().from("push_subs").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      if (e2) return err("Couldn't save: " + e2.message);
      await sb().functions.invoke("push", { body: { action: "test" } });
      alertState = null; checkAlerts();
    } catch (e) { err("Couldn't turn on alerts: " + (e.message || e)); }
  }
  async function alertsOff() {
    try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) { await sb().from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } } catch (e) {}
    alertState = null; checkAlerts();
  }
  function wireAlerts() {
    if ($("alertOn")) $("alertOn").onclick = alertsOn;
    if ($("alertOff")) $("alertOff").onclick = alertsOff;
    if ($("alertTest")) $("alertTest").onclick = async () => { const { data, error } = await sb().functions.invoke("push", { body: { action: "test" } }); if ($("alertErr")) $("alertErr").textContent = error ? "Couldn't send the test." : data?.sent ? "" : "No phone found. Turn alerts off and on again."; };
  }
  // Tell whoever picks next (fire and forget)
  const pingTurn = rid => { try { sb().functions.invoke("push", { body: { action: "cup_turn", round_id: rid } }); } catch (e) {} };

  // Rounds where it's this captain's turn (back and forth) or picks are still to go in (blind)
  function myTurns() {
    const mine = D.captainOf; if (!mine) return [];
    const cur = D.rounds.find(r => r.status !== "final");
    if (!cur || cur.status !== "lineups" || !cur.format) return [];
    if (cur.blind) return D.subs.some(s => s.round_id === cur.id && s.side_id === mine) ? [] : [{ r: cur, text: "put in your blind picks" }];
    const t = turnOf(cur);
    return t && !t.done && t.side === mine ? [{ r: cur, text: t.throwing ? `throw out match ${t.slot}` : `answer match ${t.slot}` }] : [];
  }
  function myTurnCard(link) {
    const ts = myTurns();
    return ts.map(x => `<${link ? 'a href="#captain"' : "div"} class="card pad yourturn"><b>Your turn to pick</b><span class="updated">${esc(x.r.name)}: ${esc(x.text)}</span></${link ? "a" : "div"}>`).join("");
  }
  function badge() {
    try { const n = myTurns().length; if (n && navigator.setAppBadge) navigator.setAppBadge(n); else if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) {}
  }

  function blindEditor(r, mine) {
    const pairs = pairsOf(r), submitted = D.subs.some(s => s.round_id === r.id && s.side_id === mine), n = matchCount(r);
    const es = D.entries.filter(e => e.round_id === r.id && e.side_id === mine);
    if (submitted) return `<p class="updated"><b>Your picks are in.</b> They stay hidden until the commissioner reveals the round.</p><ol class="clist">${es.sort((a, b) => a.slot - b.slot).map(e => `<li>${names(r, e)}</li>`).join("")}</ol>`;
    return `<p class="updated">Blind: put in all your picks, in order${pairs ? ", one team per line" : ""}. Matches go by position (1 v 1, 2 v 2). Nobody sees them until the reveal.</p>
      <div class="cedit" data-round="${r.id}">${Array.from({ length: n }, (_, i) => { const e = es.find(x => x.slot === i + 1); return `<div class="crow2" data-slot="${i + 1}"><b>${pairs ? "Team " : ""}${i + 1}</b><select data-e="player_id">${pickOptions(r, e?.player_id, mine)}</select>${pairs ? `<select data-e="partner_id">${pickOptions(r, e?.partner_id, mine)}</select>` : ""}<span class="chcp">${esc(teamHcpText(r, e?.player_id, e?.partner_id))}</span></div>`; }).join("")}
      <button class="btn small" type="button" data-submit="${r.id}" style="margin-top:10px">Submit picks</button><p class="si-err" id="cupErr${r.id}"></p></div>`;
  }

  // ---------- events ----------
  function wire() {
    document.querySelectorAll("[data-fmt]").forEach(el => el.onchange = async () => {
      if (!el.value) return; busy = true;
      const { error } = await sb().rpc("cup_set_format", { p_round: +el.dataset.fmt, p_format: el.value }); busy = false;
      if (error) alert(error.message); else pingTurn(+el.dataset.fmt); load();
    });
    document.querySelectorAll("[data-ord]").forEach(el => el.onchange = async () => {
      if (!el.value) return; busy = true;
      const blind = el.value === "blind";
      const { error } = await sb().rpc("cup_set_order", { p_round: +el.dataset.ord, p_first_side: blind ? null : +el.value, p_blind: blind }); busy = false;
      if (error) alert(error.message); else pingTurn(+el.dataset.ord); load();
    });
    const rpc = async (fn, args, errId) => { busy = true; const { error } = await sb().rpc(fn, args); busy = false; if (error) { if (errId && $(errId)) $(errId).textContent = error.message; else alert(error.message); return false; } await load(); return true; };
    if ($("capAddBtn")) $("capAddBtn").onclick = () => { const v = +$("capAdd").value; if (v) rpc("cup_set_member", { p_cup: D.cup.id, p_player: v, p_join: true }); };
    document.querySelectorAll("[data-drop]").forEach(b => b.onclick = () => { if (confirm("Take this player off your side? They go back to the sub pool.")) rpc("cup_set_member", { p_cup: D.cup.id, p_player: +b.dataset.drop, p_join: false }); });
    document.querySelectorAll("[data-place]").forEach(b => b.onclick = () => {
      const rid = +b.dataset.place, box = b.closest(".cpick"), pl = +box.querySelector('[data-pp="player"]').value || null, pt = box.querySelector('[data-pp="partner"]') ? (+box.querySelector('[data-pp="partner"]').value || null) : null;
      const r = D.rounds.find(x => x.id === rid);
      if (!pl || (pairsOf(r) && !pt)) { $("cupErr" + rid).textContent = pairsOf(r) ? "Pick both players." : "Pick a player."; return; }
      if (pl === pt) { $("cupErr" + rid).textContent = "Pick two different players."; return; }
      rpc("cup_place", { p_round: rid, p_side: D.captainOf, p_player: pl, p_partner: pt }, "cupErr" + rid).then(ok => ok && pingTurn(rid));
    });
    document.querySelectorAll(".cpick").forEach(box => {
      const r = D.rounds.find(x => x.id === +box.dataset.round), out = box.querySelector(".chcp");
      const upd = () => { const a = +box.querySelector('[data-pp="player"]').value || null, b = box.querySelector('[data-pp="partner"]') ? (+box.querySelector('[data-pp="partner"]').value || null) : null; out.textContent = teamHcpText(r, a || b, a ? b : null); };
      box.querySelectorAll("[data-pp]").forEach(el => el.addEventListener("change", upd));
    });
    document.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => rpc("cup_undo", { p_round: +b.dataset.undo, p_side: D.captainOf }, "cupErr" + b.dataset.undo));
    document.querySelectorAll(".cedit").forEach(box => {
      const rid = +box.dataset.round, sid = D.captainOf;
      box.querySelectorAll("[data-e]").forEach(el => el.onchange = async () => {
        const slot = +el.closest("[data-slot]").dataset.slot, cur = D.entries.find(e => e.round_id === rid && e.side_id === sid && e.slot === slot) || {};
        const rec = { round_id: rid, side_id: sid, slot, player_id: cur.player_id ?? null, partner_id: cur.partner_id ?? null, [el.dataset.e]: +el.value || null };
        busy = true;
        const res = !rec.player_id && !rec.partner_id ? await sb().from("cup_entries").delete().eq("round_id", rid).eq("side_id", sid).eq("slot", slot)
          : await sb().from("cup_entries").upsert(rec, { onConflict: "round_id,side_id,slot" });
        busy = false;
        if (res.error) { $("cupErr" + rid).textContent = "Couldn't save: " + res.error.message; return; }
        if (cur.round_id) Object.assign(cur, rec); else D.entries.push(rec);
        const r = D.rounds.find(x => x.id === rid), row = el.closest("[data-slot]"); row.querySelector(".chcp").textContent = teamHcpText(r, rec.player_id || rec.partner_id, rec.player_id ? rec.partner_id : null);
      });
    });
    document.querySelectorAll("[data-submit]").forEach(b => b.onclick = async () => {
      const rid = +b.dataset.submit, r = D.rounds.find(x => x.id === rid), f = F[r.format] || F.singles;
      const es = D.entries.filter(e => e.round_id === rid && e.side_id === D.captainOf && e.player_id);
      const ids = es.flatMap(e => [e.player_id, f.pairs ? e.partner_id : null]).filter(Boolean);
      if (new Set(ids).size !== ids.length) { $("cupErr" + rid).textContent = "Someone is in the lineup twice."; return; }
      if (!es.length) { $("cupErr" + rid).textContent = "The lineup is empty."; return; }
      if (!confirm(`Submit ${es.length} ${f.pairs ? "teams" : "players"}? You can't change them after this unless the commissioner unlocks it.`)) return;
      busy = true; const { error } = await sb().rpc("cup_submit", { p_round: rid, p_side: D.captainOf }); busy = false;
      if (error) { $("cupErr" + rid).textContent = error.message; return; }
      load();
    });
    document.querySelectorAll(".csc").forEach(tb => tb.querySelectorAll("input.cin").forEach(el => el.onchange = async () => {
      const v = parseInt(el.value, 10), rid = +tb.dataset.round, slot = +tb.dataset.slot;
      const key = { round_id: rid, side_id: +el.dataset.side, slot, player_id: +el.dataset.key, hole: +el.dataset.hole };
      busy = true;
      const res = Number.isFinite(v) && v > 0 ? await sb().from("cup_scores").upsert({ ...key, strokes: Math.min(v, 20) }, { onConflict: "round_id,side_id,slot,player_id,hole" })
        : await sb().from("cup_scores").delete().eq("round_id", rid).eq("side_id", key.side_id).eq("slot", slot).eq("player_id", key.player_id).eq("hole", key.hole);
      busy = false;
      if (res.error) { alert("Couldn't save: " + res.error.message); return; }
      D.scores = D.scores.filter(s => !(s.round_id === rid && s.side_id === key.side_id && s.slot === slot && s.player_id === key.player_id && s.hole === key.hole));
      if (Number.isFinite(v) && v > 0) D.scores.push({ ...key, strokes: Math.min(v, 20) });
      const next = [...tb.querySelectorAll("input.cin")].indexOf(el) + 1;
      render();
      const again = document.querySelectorAll(".csc input.cin")[next]; if (again && Number.isFinite(v)) again.focus();
    }));
  }

  window.addEventListener("bcc-session", () => { load(); if (location.hash === "#cup-history") loadHistory(); });
  window.addEventListener("hashchange", () => { if (location.hash === "#cup-history") loadHistory(); });
  if (location.hash === "#cup-history") loadHistory();
  window.addEventListener("hashchange", () => { if (["#cup", "#captain", "#score", "#home", ""].includes(location.hash) && D) load(); });
  load();
})();
