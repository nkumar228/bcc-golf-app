// Admin: plan every week's skins game ahead of time (Nitin 2026-11-11, for Derek).
// Each row saves to the skins table as you leave the box; the app's Home shows that week's game when the week comes up.
(() => {
  const A = window.BCCAdmin, { sb, $, esc, toast, check } = A;
  const GAMES = {
    front: ["Team – lowest net", "Most 4s and 6s", "Closest to the end of the fairway on 5", "Fairways in regulation", "Closest third shot on 4", "Fewest putts", "Greens in regulation", "Closest to pin on 8", "Longest drive on 3"],
    back: ["Greens in regulation", "Closest to the green on your first shot on 11", "Mystery game", "Closest to pin on 17", "Most 3s and 5s", "Longest putt on 18", "Fairways in regulation", "Longest drive on 13", "Low net score"]
  };
  let evs = [], sk = new Map();
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = d => d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}` : "";
  const nineOf = e => /back/i.test(A.courses.find(c => c.id === e.course_id)?.name || "") ? "back" : "front";

  async function load() {
    const season = A.season; if (!season) return;
    $("skSeason").textContent = season.name;
    const { data } = await sb.from("events").select("id,number,play_date,course_id,status").eq("season_id", season.id).order("number");
    evs = data || [];
    const { data: rows } = evs.length ? await sb.from("skins").select("*").in("event_id", evs.map(e => e.id)) : { data: [] };
    sk = new Map((rows || []).map(r => [r.event_id, r]));
    render();
  }
  function render() {
    const planned = evs.filter(e => sk.get(e.id)?.game).length;
    $("skCount").textContent = `${planned} of ${evs.length} weeks have a game.`;
    $("skTable").innerHTML = `<thead><tr><th>Wk</th><th>Date</th><th>Nine</th><th>Game</th><th>Details</th><th>Winner</th></tr></thead><tbody>` +
      evs.map(e => {
        const r = sk.get(e.id) || {}, nine = nineOf(e), off = e.status === "rained_out";
        return `<tr data-ev="${e.id}"${off ? ' style="opacity:.55"' : ""}><td>${e.number}</td><td style="white-space:nowrap">${day(e.play_date)}${off ? " · rained out" : ""}</td><td>${nine === "back" ? "Back" : "Front"}</td>
          <td><input data-k="game" list="skIdeas-${nine}" value="${esc(r.game || "")}" placeholder="Pick or type a game" style="width:250px"></td>
          <td><input data-k="details" value="${esc(r.details || "")}" placeholder="e.g. $2 buy-in" style="width:200px"></td>
          <td>${r.winner ? `<b>${esc(r.winner)}</b>` : '<span class="note" style="margin:0">–</span>'}</td></tr>`;
      }).join("") + "</tbody>";
    $("skTable").querySelectorAll("input[data-k]").forEach(el => el.onchange = () => save(+el.closest("tr").dataset.ev));
  }
  async function save(id) {
    const tr = $("skTable").querySelector(`tr[data-ev="${id}"]`), v = k => tr.querySelector(`[data-k="${k}"]`).value.trim();
    const game = v("game"), details = v("details") || null, cur = sk.get(id);
    let res;
    if (!game) {
      if (!cur) return;
      if (cur.winner) { alert("This week already has a winner. Clear it from Skins winners in the app first, or keep a game here."); render(); return; }
      res = await sb.from("skins").delete().eq("event_id", id);
      if (check(res.error, "Game removed")) sk.delete(id);
    } else {
      res = await sb.from("skins").upsert({ event_id: id, game, details, winner: cur?.winner ?? null }, { onConflict: "event_id" }).select().single();
      if (check(res.error, "Saved")) sk.set(id, res.data);
    }
    render();
  }
  // Fill empty weeks from the idea lists, in order, front and back nine separately
  $("skFill").onclick = async () => {
    const empty = evs.filter(e => !sk.get(e.id)?.game && e.status !== "rained_out");
    if (!empty.length) { toast("Every week already has a game"); return; }
    if (!confirm(`Fill ${empty.length} empty week${empty.length === 1 ? "" : "s"} from the game ideas? Weeks that already have a game are left alone, and you can change any of them after.`)) return;
    const used = { front: new Set(), back: new Set() };
    evs.forEach(e => { const g = sk.get(e.id)?.game; if (g) used[nineOf(e)].add(g); });
    const rows = empty.map(e => {
      const n = nineOf(e), list = GAMES[n], fresh = list.filter(g => !used[n].has(g));
      const game = (fresh.length ? fresh : list)[0]; used[n].add(game); if (!fresh.length) used[n] = new Set([game]);
      return { event_id: e.id, game, details: null, winner: null };
    });
    const { data, error } = await sb.from("skins").upsert(rows, { onConflict: "event_id" }).select();
    if (check(error, `${rows.length} weeks filled`)) { (data || []).forEach(r => sk.set(r.event_id, r)); render(); }
  };
  $("skIdeasBox").innerHTML = Object.entries(GAMES).map(([k, l]) => `<datalist id="skIdeas-${k}">${l.map(g => `<option value="${esc(g)}"></option>`).join("")}</datalist>`).join("");
  const prev = A.onLoad;
  A.onLoad = () => { if (prev) prev(); load(); };
})();
