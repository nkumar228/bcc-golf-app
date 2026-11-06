// App: Queen City Cup mode. Shown when an admin turns a Cup on. Scoreboard, captain lineups, and match scoring.
(() => {
  const $ = id => document.getElementById(id);
  const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const C = window.Cup, F = C.FORMATS;
  const sb = () => window.BCC && window.BCC.sb, ses = () => window.BCC && window.BCC.getSession();
  let D = null, busy = false, timer = null;
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
    const [{ data: sides }, { data: cp }, { data: rounds }, { data: pl }, { data: tees }] = await Promise.all([
      sb().from("cup_sides").select("*").eq("cup_id", cup.id).order("sort").order("id"),
      sb().from("cup_players").select("*").eq("cup_id", cup.id),
      sb().from("cup_rounds").select("*").eq("cup_id", cup.id).order("number"),
      sb().from("players").select("id,first_name,last_name,default_tee"),
      sb().from("tees").select("course_id,name,rating,slope,par,tee_holes(hole,par,yards,stroke_index)")
    ]);
    const rids = (rounds || []).map(r => r.id);
    const q = t => rids.length ? sb().from(t).select("*").in("round_id", rids) : Promise.resolve({ data: [] });
    const [{ data: entries }, { data: subs }, { data: ovr }, { data: scores }] = await Promise.all([q("cup_entries"), q("cup_submissions"), q("cup_match_overrides"), q("cup_scores")]);
    const tbc = new Map(); (tees || []).forEach(t => { if (!tbc.has(t.course_id)) tbc.set(t.course_id, []); tbc.get(t.course_id).push(t); });
    D = { cup, sides: sides || [], cp: cp || [], rounds: rounds || [], players: new Map((pl || []).map(p => [p.id, p])), entries: entries || [], subs: subs || [], ovr: ovr || [], scores: scores || [], tbc, me: s.playerId };
    D.mySide = D.cp.find(c => c.player_id === D.me)?.side_id ?? null;
    D.captainOf = D.sides.find(x => x.captain_id === D.me)?.id ?? null;
    on(); render();
  }
  function off() {
    D = null; document.body.classList.remove("cup-on");
    const t = document.querySelector('.tabs a[data-tab="rounds"], .tabs a[data-tab="cup"]');
    if (t) { t.href = "#rounds"; t.dataset.tab = "rounds"; t.lastChild.textContent = "Rounds"; }
    if ($("cupHome")) $("cupHome").hidden = true;
    if (location.hash === "#cup") location.hash = "#home";
  }
  function on() {
    document.body.classList.add("cup-on");
    const t = document.querySelector('.tabs a[data-tab="rounds"], .tabs a[data-tab="cup"]');
    if (t) { t.href = "#cup"; t.dataset.tab = "cup"; t.lastChild.textContent = "Cup"; if (location.hash === "#cup") t.setAttribute("aria-current", "page"); }
    $("cupHome").hidden = false;
    if (!timer) timer = setInterval(() => { if (document.visibilityState === "visible" && (location.hash === "#cup" || location.hash === "" || location.hash === "#home") && !busy && !document.activeElement?.matches?.("#v-cup input, #v-cup select")) load(); }, 20000);
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
    const board = `<div class="cup-board">${D.sides.map(s => `<div class="cside" style="--c:${esc(s.color)}"><span>${esc(s.name)}${D.cup.defending_side_id === s.id ? " · holds the Cup" : ""}</span><b class="num">${fmtPts(tot[s.id])}</b>${anyLive ? `<small>${fmtPts(live[s.id])} if it ended now</small>` : ""}</div>`).join("")}</div>`;
    const myRound = D.rounds.find(r => r.status === "revealed" && myMatch(r));
    $("cupHome").innerHTML = `<div class="card pad"><div class="head"><p class="label">${esc(D.cup.name)}</p><a class="linkbtn" href="#cup">Open</a></div>${board}
      <p class="updated" style="margin:8px 0 0">${myRound ? `You're playing in ${esc(myRound.name)}. ` : ""}${totalPts ? `${totalPts} match${totalPts === 1 ? "" : "es"} out so far.` : "Matchups appear here when they're revealed."}</p>
      ${myRound ? `<a class="btn small" href="#cup" style="margin-top:10px;display:inline-block">Score my match</a>` : ""}</div>`;
    $("cupTitle").textContent = D.cup.name;
    $("cupBoard").innerHTML = board;
    $("cupMine").innerHTML = myRound ? scorer(myRound) : "";
    $("cupCaptain").innerHTML = D.captainOf ? captainPanel() : "";
    $("cupRounds").innerHTML = all.map(({ r, ms }) => roundCard(r, ms)).join("");
    wire();
  }
  function roundLine(r) {
    const f = F[r.format];
    return [fmtDate(r.play_date), fmtTime(r.tee_time), r.holes + " holes", f ? f.label : "format not picked yet", r.blind ? "blind draw" : ""].filter(Boolean).join(" · ");
  }
  function roundCard(r, ms) {
    const subs = D.subs.filter(s => s.round_id === r.id);
    let body;
    if (!shown(r)) {
      const who = D.sides.map(s => `${dot(s)}${esc(s.name)}: ${subs.some(x => x.side_id === s.id) ? "lineup in" : "waiting"}`).join(" &nbsp; ");
      body = `<p class="updated" style="margin:6px 0 0">${r.status === "lineups" ? `Captains are setting lineups. ${who}.` : "Not open yet."} Matchups are hidden until they're revealed.</p>`;
    } else {
      body = `<div class="cmatches">${ms.map(m => {
        const nm = e => e ? [e.player_id, F[r.format]?.pairs ? e.partner_id : null].filter(Boolean).map(last).join(" & ") : "absent";
        const w = m.ov ? m.ov.winner_side_id : m.st.done ? m.st.winner : m.st.leader;
        const [sa, sb_] = D.sides;
        const mine = [m.ea, m.eb].some(e => e && (e.player_id === D.me || e.partner_id === D.me));
        return `<div class="cm${mine ? " mine" : ""}"><span class="${w === sa.id ? "lead" : ""}" style="--c:${esc(sa.color)}">${esc(nm(m.ea))}</span><em>${esc(m.st.text)}</em><span class="r ${w === sb_.id ? "lead" : ""}" style="--c:${esc(sb_.color)}">${esc(nm(m.eb))}</span></div>`;
      }).join("") || '<p class="updated">No matches.</p>'}</div>`;
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
  function captainPanel() {
    const mine = D.captainOf, other = D.sides.find(s => s.id !== mine);
    const open = D.rounds.filter(r => r.status === "setup" || r.status === "lineups");
    if (!open.length) return "";
    return `<div class="card pad"><div class="head"><p class="label">Captain · ${esc(sideName(mine))}</p></div>${open.map(r => {
      const subs = D.subs.filter(s => s.round_id === r.id), subd = id => subs.some(s => s.side_id === id);
      const anySub = subs.length > 0, f = F[r.format] || null;
      const parts = [];
      // format
      if (r.format_side_id === mine && !anySub) parts.push(`<label class="crow"><span>Format</span><select data-fmt="${r.id}"><option value="">Pick one</option>${Object.entries(F).filter(([k]) => r.allow_blind ? k === "singles" : true).map(([k, v]) => `<option value="${k}"${k === r.format ? " selected" : ""}>${v.label}</option>`).join("")}</select></label>${f ? `<p class="updated">${esc(f.how)}</p>` : ""}`);
      else parts.push(`<p class="updated">Format: <b>${f ? f.label : "not picked yet"}</b>${!f && r.format_side_id ? ` (${esc(sideName(r.format_side_id))} picks)` : ""}</p>`);
      // order
      if (r.order_side_id === mine && !anySub) parts.push(`<label class="crow"><span>Lineups</span><select data-ord="${r.id}"><option value="">Pick one</option><option value="${mine}"${r.first_side_id === mine ? " selected" : ""}>We submit first</option><option value="${other.id}"${r.first_side_id === other.id ? " selected" : ""}>We respond</option>${r.allow_blind ? `<option value="blind"${r.blind ? " selected" : ""}>Blind draw (both rank players)</option>` : ""}</select></label>`);
      else parts.push(`<p class="updated">${r.blind ? "Blind draw: rank your players 1 to " + countMine() + "; matches go by position." : r.first_side_id ? `${esc(sideName(r.first_side_id))} submits first, then ${esc(sideName(D.sides.find(s => s.id !== r.first_side_id).id))} responds.` : `Who goes first: not picked yet${r.order_side_id ? ` (${esc(sideName(r.order_side_id))} picks)` : ""}.`}</p>`);
      // lineup
      if (r.status === "setup") parts.push(`<p class="updated">Lineups open when the commissioner opens this round.</p>`);
      else if (subd(mine)) parts.push(`<p class="updated"><b>Your lineup is in.</b> ${subd(other.id) ? "Both are in; waiting for the reveal." : `Waiting on ${esc(other.name)}.`}</p>${lineupList(r, mine)}`);
      else if (!r.format) parts.push(`<p class="updated">Waiting for the format.</p>`);
      else if (!r.blind && !r.first_side_id) parts.push(`<p class="updated">Waiting for who goes first.</p>`);
      else if (!r.blind && r.first_side_id !== mine && !subd(r.first_side_id)) parts.push(`<p class="updated">Waiting for ${esc(sideName(r.first_side_id))}'s lineup. You'll see it here when it's in.</p>`);
      else parts.push(editor(r, mine));
      return `<div class="cround"><b>${esc(r.name)}</b> <span class="updated">${esc(roundLine(r))}</span>${parts.join("")}</div>`;
    }).join("")}</div>`;
  }
  const countMine = () => D.cp.filter(c => c.side_id === D.captainOf).length;
  function lineupList(r, sid) {
    const f = F[r.format] || F.singles, es = D.entries.filter(e => e.round_id === r.id && e.side_id === sid).sort((a, b) => a.slot - b.slot);
    return `<ol class="clist">${es.map(e => `<li>${[e.player_id, f.pairs ? e.partner_id : null].filter(Boolean).map(last).map(esc).join(" & ")}</li>`).join("")}</ol>`;
  }
  function editor(r, mine) {
    const f = F[r.format] || F.singles, other = D.sides.find(s => s.id !== mine);
    const roster = D.cp.filter(c => c.side_id === mine).map(c => P(c.player_id)).filter(Boolean).sort((a, b) => a.last_name.localeCompare(b.last_name));
    const es = D.entries.filter(e => e.round_id === r.id && e.side_id === mine);
    const theirs = D.entries.filter(e => e.round_id === r.id && e.side_id === other.id).sort((a, b) => a.slot - b.slot);
    const n = Math.max(f.pairs ? Math.ceil(roster.length / 2) : roster.length, theirs.length ? Math.max(...theirs.map(e => e.slot)) : 0, ...es.map(e => e.slot), 1);
    const idx = id => { const c = D.cp.find(x => x.player_id === id); return c?.handicap_index != null ? ` (${(+c.handicap_index).toFixed(1)})` : ""; };
    const opt = sel => `<option value="">–</option>` + roster.map(p => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(p.last_name)}${idx(p.id)}</option>`).join("");
    const vs = slot => { const t = theirs.find(e => e.slot === slot); return t ? `<span class="cvs">vs ${[t.player_id, f.pairs ? t.partner_id : null].filter(Boolean).map(last).map(esc).join(" & ")}</span>` : ""; };
    return `<p class="updated">${r.blind ? "Rank your players. Nobody sees this until the reveal." : theirs.length ? `${esc(other.name)}'s lineup is in. Set yours against each match.` : "Set your lineup in match order. The other captain sees it only after you submit."}</p>
      <div class="cedit" data-round="${r.id}">${Array.from({ length: n }, (_, i) => { const e = es.find(x => x.slot === i + 1); return `<div class="crow2" data-slot="${i + 1}"><b>${i + 1}</b><select data-e="player_id">${opt(e?.player_id)}</select>${f.pairs ? `<select data-e="partner_id">${opt(e?.partner_id)}</select>` : ""}${vs(i + 1)}</div>`; }).join("")}
      <button class="btn small" type="button" data-submit="${r.id}" style="margin-top:10px">Submit lineup</button><p class="si-err" id="cupErr${r.id}"></p></div>`;
  }

  // ---------- events ----------
  function wire() {
    document.querySelectorAll("[data-fmt]").forEach(el => el.onchange = async () => {
      if (!el.value) return; busy = true;
      const { error } = await sb().rpc("cup_set_format", { p_round: +el.dataset.fmt, p_format: el.value }); busy = false;
      if (error) alert(error.message); load();
    });
    document.querySelectorAll("[data-ord]").forEach(el => el.onchange = async () => {
      if (!el.value) return; busy = true;
      const blind = el.value === "blind";
      const { error } = await sb().rpc("cup_set_order", { p_round: +el.dataset.ord, p_first_side: blind ? null : +el.value, p_blind: blind }); busy = false;
      if (error) alert(error.message); load();
    });
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
      });
    });
    document.querySelectorAll("[data-submit]").forEach(b => b.onclick = async () => {
      const rid = +b.dataset.submit, r = D.rounds.find(x => x.id === rid), f = F[r.format] || F.singles;
      const es = D.entries.filter(e => e.round_id === rid && e.side_id === D.captainOf && e.player_id);
      const ids = es.flatMap(e => [e.player_id, f.pairs ? e.partner_id : null]).filter(Boolean);
      if (new Set(ids).size !== ids.length) { $("cupErr" + rid).textContent = "Someone is in the lineup twice."; return; }
      if (!es.length) { $("cupErr" + rid).textContent = "The lineup is empty."; return; }
      if (!confirm(`Submit ${es.length} ${f.pairs ? "pairs" : "players"}? You can't change it after this unless the commissioner unlocks it.`)) return;
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

  window.addEventListener("bcc-session", load);
  window.addEventListener("hashchange", () => { if (location.hash === "#cup" && D) load(); });
  load();
})();
