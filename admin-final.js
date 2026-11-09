// Admin: Queen City Cup Final day sheet for the course: cart pairings and contest holes
// (Nitin's "Carts" and "Final Day challenges" sheets). Two singles matches per tee time; each side's two players share a cart.
(() => {
  const A = window.BCCAdmin, { sb, $, esc, toast, check } = A;
  // The 2026 list, offered when a Cup has no contest holes yet and no earlier Cup to copy from
  const LIST_2026 = [[3, "Closest GIR", 20], [4, "Longest Drive (Blue Tees)", 20], [6, "Closest to Pin", 20], [10, "Shortest Drive", 20], [12, "Closest to Pin", 20], [13, "Longest Drive (White/Gold)", 20], [16, "Longest Putt", 20], [null, "Fastest Closeout", 40]];
  let cup = null, D = null, contests = [];
  const P = id => A.players.find(p => p.id === id);
  const nm = id => { const p = P(id); return p ? `${p.first_name} ${p.last_name}` : ""; };
  const money = v => v == null || v === "" ? "" : "$" + (+v % 1 ? (+v).toFixed(2) : +v);
  const t2m = t => { const [h, m] = String(t || "08:00").split(":").map(Number); return h * 60 + m; };
  const m2t = m => { const h = Math.floor(m / 60), mm = m % 60; return `${(h + 11) % 12 + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

  // The Final: the last singles round of the Cup
  const finalRound = () => [...(D?.rounds || [])].filter(r => r.format === "singles" || r.holes === 18).sort((a, b) => b.number - a.number)[0] || null;

  // Tee times and carts from the Final's matchups (slot order)
  function carts() {
    const r = finalRound(); if (!r) return null;
    const [s1, s2] = D.sides, gap = A.season?.tee_gap || 8, start = t2m(r.tee_time || "08:00");
    const n = r.matches || Math.max(0, ...D.entries.filter(e => e.round_id === r.id).map(e => e.slot));
    const who = (side, slot) => D.entries.find(e => e.round_id === r.id && e.side_id === side?.id && e.slot === slot)?.player_id ?? null;
    const groups = []; let cartNo = 1;
    for (let slot = 1, g = 0; slot <= n; slot += 2, g++) {
      const ms = [slot, slot + 1].filter(x => x <= n);
      groups.push({ time: m2t(start + g * gap), matches: ms, carts: [s1, s2].filter(Boolean).map(s => ({ no: cartNo++, side: s, players: ms.map(x => who(s, x)) })) });
    }
    return { round: r, groups };
  }

  async function load() {
    const box = $("finalBody"); if (!box) return;
    if (!cup) { box.innerHTML = '<p class="note">Start a Cup first.</p>'; return; }
    const { data } = await sb.from("cup_contests").select("*").eq("cup_id", cup.id).order("sort").order("id");
    contests = data || [];
    render();
  }

  function render() {
    const box = $("finalBody"), c = carts();
    const used = contests.reduce((t, x) => t + (+x.credit || 0), 0), budget = cup.contest_budget;
    const cartHtml = !c ? '<p class="note">This Cup has no Final yet. Add an 18-hole singles round above and the carts fill in from its matchups.</p>' :
      `<p class="note">${esc(c.round.name)} · ${c.round.play_date ? new Date(c.round.play_date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "no date yet"} · first tee ${m2t(t2m(c.round.tee_time || "08:00"))}, every ${A.season?.tee_gap || 8} minutes. Two matches per group; each side's two players share a cart. Change the order by moving matches in the lineups.</p>
      <div class="scroll"><table><thead><tr><th>Tee time</th><th>Matches</th><th>Cart</th><th>Players</th></tr></thead><tbody>${c.groups.map(g => g.carts.map((k, i) => `<tr>${i === 0 ? `<td rowspan="${g.carts.length}"><b>${g.time}</b></td><td rowspan="${g.carts.length}">${g.matches.map(m => "Match " + m).join(", ")}</td>` : ""}<td>Cart ${k.no} <span class="note">${esc(k.side.name)}</span></td><td>${k.players.map(p => p ? esc(nm(p)) : '<span class="note">not picked yet</span>').join(" &amp; ")}</td></tr>`).join("")).join("")}</tbody></table></div>`;
    box.innerHTML = `<h3 style="margin:0 0 6px">Cart pairings</h3>${cartHtml}
      <h3 style="margin:16px 0 6px">Contest holes</h3>
      <div class="scroll"><table id="ctTable"><thead><tr><th>Hole</th><th>Challenge</th><th>Merch credit</th><th></th></tr></thead><tbody>${contests.map(x => `<tr data-id="${x.id}"><td><input class="w-num" type="number" min="1" max="18" data-k="hole" value="${x.hole ?? ""}" placeholder="any"></td><td><input data-k="challenge" value="${esc(x.challenge)}" style="width:260px"></td><td><input class="w-num" type="number" min="0" step="1" data-k="credit" value="${x.credit ?? ""}"></td><td><button class="btn danger" type="button" data-del style="padding:5px 9px;font-size:13px">Remove</button></td></tr>`).join("") || '<tr><td colspan="4" class="note">No contest holes yet.</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn secondary" type="button" id="ctAdd">Add a contest</button>${!contests.length ? '<button class="btn secondary" type="button" id="ctCopy">Copy last Cup\'s list</button>' : ""}
        <label class="note" style="margin-left:auto">Money available <input class="w-num" type="number" min="0" id="ctBudget" value="${budget ?? ""}"></label>
        <span class="note">Used <b>${money(used) || "$0"}</b>${budget != null ? (used > budget ? ` · <b style="color:#c00">over by ${money(used - budget)}</b>` : ` · left <b>${money(budget - used)}</b>`) : ""}</span></div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="btn" type="button" id="finPrint">Print sheet for the course</button><button class="btn secondary" type="button" id="finCopy">Copy as text for email</button></div>`;
    box.querySelectorAll("#ctTable [data-k]").forEach(el => el.onchange = async () => {
      const k = el.dataset.k, v = k === "challenge" ? el.value.trim() : el.value === "" ? null : +el.value;
      const { error } = await sb.from("cup_contests").update({ [k]: v }).eq("id", +el.closest("tr").dataset.id);
      if (check(error)) { const x = contests.find(c => c.id === +el.closest("tr").dataset.id); x[k] = v; if (k === "credit") render(); }
    });
    box.querySelectorAll("#ctTable [data-del]").forEach(b => b.onclick = async () => {
      const { error } = await sb.from("cup_contests").delete().eq("id", +b.closest("tr").dataset.id); if (check(error, "Removed")) load();
    });
    $("ctAdd").onclick = async () => { const { error } = await sb.from("cup_contests").insert({ cup_id: cup.id, hole: null, challenge: "", credit: 20, sort: contests.length }); if (check(error, "Added")) load(); };
    if ($("ctCopy")) $("ctCopy").onclick = async () => {
      const { data: prev } = await sb.from("cups").select("id,contest_budget,year").neq("id", cup.id).order("year", { ascending: false });
      let rows = [], bud = null;
      for (const p of prev || []) { const { data } = await sb.from("cup_contests").select("hole,challenge,credit,sort").eq("cup_id", p.id).order("sort"); if (data?.length) { rows = data; bud = p.contest_budget; break; } }
      if (!rows.length) { rows = LIST_2026.map(([hole, challenge, credit], i) => ({ hole, challenge, credit, sort: i })); bud = 180; }
      const { error } = await sb.from("cup_contests").insert(rows.map(r => ({ ...r, cup_id: cup.id })));
      if (cup.contest_budget == null && bud != null) { await sb.from("cups").update({ contest_budget: bud }).eq("id", cup.id); cup.contest_budget = bud; }
      if (check(error, "Copied")) load();
    };
    $("ctBudget").onchange = async e => { const v = e.target.value === "" ? null : +e.target.value; const { error } = await sb.from("cups").update({ contest_budget: v }).eq("id", cup.id); if (check(error)) { cup.contest_budget = v; render(); } };
    $("finPrint").onclick = printSheet;
    $("finCopy").onclick = async () => { try { await navigator.clipboard.writeText(asText()); toast("Copied. Paste it into your email."); } catch { toast("Couldn't copy here; use Print instead.", true); } };
  }

  const title = () => { const r = finalRound(); return `${cup.name}${r ? " · " + r.name : ""}${r?.play_date ? " · " + new Date(r.play_date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : ""}`; };
  function asText() {
    const c = carts(), L = [title(), ""];
    if (c) { L.push("CART PAIRINGS"); c.groups.forEach(g => { L.push(`${g.time}`); g.carts.forEach(k => L.push(`  Cart ${k.no}: ${k.players.map(p => p ? nm(p) : "TBD").join(" & ")}`)); }); L.push(""); }
    if (contests.length) { L.push("CONTEST HOLES"); contests.forEach(x => L.push(`  ${x.hole ? "Hole " + x.hole : "Any hole"}: ${x.challenge}${x.credit != null ? ` (${money(x.credit)} merch credit)` : ""}`)); }
    return L.join("\n");
  }
  function printSheet() {
    const c = carts(), w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to print.", true); return; }
    const css = "body{font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#f2f2f2}";
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(cup.name)} Final</title><style>${css}</style></head><body><h1>${esc(title())}</h1>
      ${c ? `<h2>Cart pairings</h2><table><thead><tr><th>Tee time</th><th>Cart</th><th>Players</th></tr></thead><tbody>${c.groups.map(g => g.carts.map((k, i) => `<tr>${i === 0 ? `<td rowspan="${g.carts.length}"><b>${g.time}</b></td>` : ""}<td>Cart ${k.no}</td><td>${k.players.map(p => p ? esc(nm(p)) : "TBD").join(" &amp; ")}</td></tr>`).join("")).join("")}</tbody></table>` : ""}
      ${contests.length ? `<h2>Contest holes</h2><table><thead><tr><th>Hole</th><th>Challenge</th><th>Merch credit</th></tr></thead><tbody>${contests.map(x => `<tr><td>${x.hole ?? ""}</td><td>${esc(x.challenge)}</td><td>${money(x.credit)}</td></tr>`).join("")}</tbody></table>` : ""}
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  A.onCupLoaded = (c, d) => { cup = c; D = d; load(); };
})();
