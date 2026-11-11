// Admin: add a Cup's finished matches to Nitin's "Queen City Cup Stats" workbook (Data Entry tab, Table1, columns A to L).
// One row per golfer per match: Player, Year, Team, Game, Partner, Opponent 1, Opponent 2, Combined Opponent, Win, Loss, Half, Points.
// The workbook is opened from the admin's computer, edited in the browser (only the cells it adds are touched, so the
// pivot tables, formulas and formatting stay) and saved back over the same file where the browser allows it, else downloaded.
(() => {
  const A = window.BCCAdmin, { $, esc, toast } = A;
  const F = window.Cup.FORMATS;
  let cup = null, D = null, pick = "all", busy = false;

  // Game names as the workbook's Lists tab spells them
  const GAME = { singles: "Individual", four_ball: "Four Ball", four_ball_agg: "Four Ball Aggregate", alternate_shot: "Alternate Shot", greensome: "Greensome", chapman: "Chapman", scramble: "Scramble" };
  // Where the workbook spells a name differently from the app (Lists tab and the 2020-2025 rows)
  const SHEET_NAME = { "Thomas Leemhuis": "Tom Leemhuis", "Josh Hessler": "Josh  Hessler", "Jeffrey Webber": "Jeff Webber", "Jacob Wegrzyn": "Jake Wegrzyn" };

  const P = id => A.players.find(p => p.id === id);
  const full = id => { const p = P(id); if (!p) return "?"; const n = `${p.first_name} ${p.last_name}`.trim(); return SHEET_NAME[n] || n; };
  const isSub = id => D.cp.find(c => c.player_id === id)?.side_id == null;
  // In the workbook a sub only shows up as a partner or opponent, as "Name (Sub)"; they get no row of their own
  const label = id => id ? full(id) + (isSub(id) ? " (Sub)" : "") : "";
  // The workbook's Combined Opponent formula: both names, ordered by first letter
  const combined = (game, o1, o2) => game === "Individual" ? "" : o1.charAt(0).toLowerCase() < o2.charAt(0).toLowerCase() ? `${o1} & ${o2}` : `${o2} & ${o1}`;

  const finals = () => [...D.rounds].filter(r => r.status === "final").sort((a, b) => a.number - b.number);

  function build() {
    const rows = [], skipped = [], [sa, sb_] = D.sides;
    finals().filter(r => pick === "all" || r.id === +pick).forEach(r => {
      A.cupMatchesOf(r).forEach(x => {
        if (!x.ea && !x.eb) return; // nobody in this slot: halved in the Cup score, but no golfer to record
        if (!x.ea || !x.eb || !x.pts.final) { skipped.push(`${r.name} match ${x.slot} (${!x.ea || !x.eb ? "no opponent, halved" : "not finished"})`); return; }
        // One golfer on each side of a team round plays singles, so it goes in as Individual
        const pairs = x.m.format.pairs, game = x.m.format.solo ? "Individual" : GAME[r.format] || "Individual";
        [[sa, x.ea, x.eb], [sb_, x.eb, x.ea]].forEach(([side, me, them]) => {
          const p = x.pts.pts[side.id], ids = [me.player_id, pairs ? me.partner_id : null], opp = [them.player_id, pairs ? them.partner_id : null];
          ids.forEach((pid, i) => {
            if (!pid || isSub(pid)) return;
            const o1 = label(opp[0]), o2 = label(opp[1]);
            rows.push({ round: r.name, player: full(pid), year: cup.year, team: side.name, game, partner: label(ids[1 - i]), opp1: o1, opp2: o2,
              combined: combined(game, o1, o2), win: p === 1 ? 1 : "", loss: p === 0 ? 1 : "", half: p === 0.5 ? 1 : "", points: p });
          });
        });
      });
    });
    return { rows, skipped };
  }

  // ---------- the workbook ----------
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const colNum = c => [...c].reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0);
  const colOf = ref => ref.match(/^[A-Z]+/)[0];
  const parse = s => new DOMParser().parseFromString(s, "application/xml");
  const ser = d => { const s = new XMLSerializer().serializeToString(d); return s.startsWith("<?xml") ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s; };
  const kids = (el, name) => [...el.getElementsByTagNameNS(NS, name)];
  const pathOf = (base, target) => target.startsWith("/") ? target.slice(1) : (base + target).replace(/[^/]+\/\.\.\//g, "");

  async function addToWorkbook(buf, rows) {
    const zip = await JSZip.loadAsync(buf);
    const put = (p, text) => zip.file(p, text, { createFolders: false });
    const read = p => zip.file(p) ? zip.file(p).async("string") : Promise.resolve(null);
    const wb = parse(await read("xl/workbook.xml")), rels = parse(await read("xl/_rels/workbook.xml.rels"));
    const target = id => [...rels.getElementsByTagName("Relationship")].find(r => r.getAttribute("Id") === id)?.getAttribute("Target");
    const sheetPath = name => { const s = kids(wb, "sheet").find(x => x.getAttribute("name") === name); return s ? pathOf("xl/", target(s.getAttributeNS(RNS, "id"))) : null; };
    const dataPath = sheetPath("Data Entry"), listsPath = sheetPath("Lists");
    if (!dataPath) throw new Error("This workbook has no Data Entry tab. Pick the Queen City Cup Stats workbook.");

    // Shared strings, to read what's already there
    const ssDoc = await read("xl/sharedStrings.xml");
    const ss = ssDoc ? kids(parse(ssDoc), "si").map(si => kids(si, "t").map(t => t.textContent).join("")) : [];
    const val = c => { if (!c) return ""; const t = c.getAttribute("t"), v = kids(c, "v")[0]?.textContent ?? "";
      return t === "s" ? ss[+v] ?? "" : t === "inlineStr" ? kids(c, "t").map(x => x.textContent).join("") : v; };

    // Cells: find or make, keeping column order in the row
    const sheetData = doc => kids(doc, "sheetData")[0];
    const rowEl = (doc, n, template) => {
      const sd = sheetData(doc), rs = kids(sd, "row"), hit = rs.find(r => +r.getAttribute("r") === n);
      if (hit) return hit;
      const el = template ? template.cloneNode(true) : doc.createElementNS(NS, "row");
      el.setAttribute("r", n);
      kids(el, "c").forEach(c => { c.setAttribute("r", colOf(c.getAttribute("r")) + n); if (!kids(c, "f").length) { c.removeAttribute("t"); while (c.firstChild) c.removeChild(c.firstChild); } else { kids(c, "v").forEach(v => v.textContent = ""); } });
      sd.insertBefore(el, rs.find(r => +r.getAttribute("r") > n) || null);
      return el;
    };
    const cellEl = (doc, row, col) => {
      const ref = col + row.getAttribute("r"), cs = kids(row, "c"), hit = cs.find(c => c.getAttribute("r") === ref);
      if (hit) return hit;
      const c = doc.createElementNS(NS, "c"); c.setAttribute("r", ref);
      row.insertBefore(c, cs.find(x => colNum(colOf(x.getAttribute("r"))) > colNum(col)) || null);
      return c;
    };
    const setCell = (doc, row, col, v) => {
      const c = cellEl(doc, row, col), f = kids(c, "f")[0];
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute("t");
      if (f) c.appendChild(f); // a table formula stays; only its last value is filled in until Excel recalculates
      if (v === "" || v == null) { if (f) c.appendChild(doc.createElementNS(NS, "v")); return; }
      if (typeof v === "number") { const e = doc.createElementNS(NS, "v"); e.textContent = String(v); c.appendChild(e); return; }
      if (f) { c.setAttribute("t", "str"); const e = doc.createElementNS(NS, "v"); e.textContent = v; c.appendChild(e); return; }
      c.setAttribute("t", "inlineStr");
      const is = doc.createElementNS(NS, "is"), t = doc.createElementNS(NS, "t");
      t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); t.textContent = v; is.appendChild(t); c.appendChild(is);
    };

    // Data Entry: skip rows already in the workbook, then fill from the first empty row
    const data = parse(await read(dataPath));
    const sheetRels = parse(await read(dataPath.replace(/([^/]+)$/, "_rels/$1.rels")) || "<Relationships/>");
    const tablePath = [...sheetRels.getElementsByTagName("Relationship")].map(r => r.getAttribute("Target")).filter(t => /tables\//.test(t)).map(t => pathOf(dataPath.replace(/[^/]+$/, ""), t))[0];
    const table = tablePath ? parse(await read(tablePath)) : null;
    let tableLast = table ? +table.documentElement.getAttribute("ref").split(":")[1].replace(/[A-Z]+/, "") : 0;
    const cellsOf = r => Object.fromEntries(kids(r, "c").map(c => [colOf(c.getAttribute("r")), c]));
    const key = x => [x.player, x.year, x.game, x.partner, x.opp1, x.opp2].map(s => String(s).trim().toLowerCase()).join("|");
    const have = new Set(); let lastUsed = 1, template = null;
    kids(sheetData(data), "row").forEach(r => {
      const n = +r.getAttribute("r"); if (n < 2) return;
      const c = cellsOf(r), v = k => val(c[k]);
      if (v("A")) { lastUsed = Math.max(lastUsed, n); have.add(key({ player: v("A"), year: v("B"), game: v("D"), partner: v("E"), opp1: v("F"), opp2: v("G") })); }
      if (n <= tableLast || !tableLast) template = r;
    });
    const fresh = rows.filter(x => !have.has(key(x))), dupes = rows.length - fresh.length;
    const start = lastUsed + 1;
    fresh.forEach((x, i) => {
      const row = rowEl(data, start + i, template);
      [["A", x.player], ["B", x.year], ["C", x.team], ["D", x.game], ["E", x.partner], ["F", x.opp1], ["G", x.opp2], ["H", x.combined], ["I", x.win], ["J", x.loss], ["K", x.half], ["L", x.points]].forEach(([col, v]) => setCell(data, row, col, v));
    });
    const end = start + fresh.length - 1;
    if (fresh.length && table && end > tableLast) {
      // Out of empty table rows: stretch the table (and its filter) over the new rows
      const stretch = el => el && el.setAttribute("ref", el.getAttribute("ref").replace(/\d+$/, end));
      stretch(table.documentElement); stretch(kids(table, "autoFilter")[0]); tableLast = end;
      put(tablePath, ser(table));
      const dim = kids(data, "dimension")[0]; if (dim) dim.setAttribute("ref", dim.getAttribute("ref").replace(/\d+$/, Math.max(end, +dim.getAttribute("ref").match(/\d+$/)[0])));
    }
    if (fresh.length) put(dataPath, ser(data));

    // Lists: a player who isn't there yet is added with their side, so Team fills in and the lists offer them
    const added = [];
    if (listsPath && fresh.length) {
      const lists = parse(await read(listsPath)), known = new Set(), byRow = new Map();
      kids(sheetData(lists), "row").forEach(r => { const c = cellsOf(r), n = +r.getAttribute("r"); byRow.set(n, r); if (n > 1 && val(c.A)) known.add(val(c.A).trim().toLowerCase()); });
      let n = 2;
      [...new Map(fresh.map(x => [x.player.trim().toLowerCase(), x])).values()].filter(x => !known.has(x.player.trim().toLowerCase())).forEach(x => {
        while (byRow.get(n) && val(cellsOf(byRow.get(n)).A)) n++;
        const row = rowEl(lists, n); byRow.set(n, row);
        setCell(lists, row, "A", x.player); setCell(lists, row, "C", x.team); added.push(`${x.player} (${x.team})`); n++;
      });
      if (added.length) { const dim = kids(lists, "dimension")[0]; if (dim && n - 1 > +dim.getAttribute("ref").match(/\d+$/)[0]) dim.setAttribute("ref", dim.getAttribute("ref").replace(/\d+$/, n - 1)); put(listsPath, ser(lists)); }
    }

    if (fresh.length) {
      // Excel recalculates the formulas and refreshes the stats pivot tables when the file opens
      const calc = kids(wb, "calcPr")[0]; if (calc) { calc.setAttribute("fullCalcOnLoad", "1"); put("xl/workbook.xml", ser(wb)); }
      for (const p of Object.keys(zip.files).filter(p => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p))) {
        const d = parse(await read(p)); d.documentElement.setAttribute("refreshOnLoad", "1"); put(p, ser(d));
      }
      // The calculation chain is rebuilt by Excel; an out-of-date one can trigger a repair prompt
      if (zip.file("xl/calcChain.xml")) {
        zip.remove("xl/calcChain.xml");
        [...rels.getElementsByTagName("Relationship")].filter(r => /calcChain/.test(r.getAttribute("Target"))).forEach(r => r.parentNode.removeChild(r));
        put("xl/_rels/workbook.xml.rels", ser(rels));
        const ct = parse(await read("[Content_Types].xml"));
        [...ct.getElementsByTagName("Override")].filter(o => /calcChain/.test(o.getAttribute("PartName"))).forEach(o => o.parentNode.removeChild(o));
        put("[Content_Types].xml", ser(ct));
      }
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return { blob, added: fresh.length, dupes, start, end, newPlayers: added };
  }
  window.CupStatsXlsx = { addToWorkbook };

  // ---------- picking and saving the file ----------
  const XLSX = { description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } };
  async function run(rows) {
    if (busy) return; busy = true;
    try {
      let handle = null, file;
      if (window.showOpenFilePicker) {
        try { [handle] = await window.showOpenFilePicker({ types: [XLSX], multiple: false, id: "qcc-stats" }); } catch (e) { if (e.name === "AbortError") return; throw e; }
        file = await handle.getFile();
      } else {
        file = await new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = ".xlsx"; i.onchange = () => res(i.files[0] || null); i.click(); });
        if (!file) return;
      }
      toast("Reading the workbook…");
      const out = await addToWorkbook(await file.arrayBuffer(), rows);
      const what = out.added ? `${out.added} rows (rows ${out.start} to ${out.end})` : "nothing new";
      if (!out.added) { showResult(`Nothing to add: all ${rows.length} rows are already in ${esc(file.name)}.`); return; }
      if (handle && handle.createWritable) {
        if (!confirm(`Add ${what} to the Data Entry tab and save ${file.name}?${out.newPlayers.length ? `\n\nAlso added to the Lists tab: ${out.newPlayers.join(", ")}.` : ""}${out.dupes ? `\n\n${out.dupes} rows are already in the workbook and are left alone.` : ""}\n\nClose the file in Excel first.`)) return;
        try { const w = await handle.createWritable(); await w.write(out.blob); await w.close(); }
        catch (e) { toast("Couldn't save over the file (is it open in Excel?). Downloading a copy instead.", true); download(out.blob, file.name); }
      } else download(out.blob, file.name);
      showResult(`Added ${what} to ${esc(file.name)}${handle && handle.createWritable ? "" : " (downloaded as a new copy; replace your old file with it)"}.${out.newPlayers.length ? ` Added to the Lists tab: ${out.newPlayers.map(esc).join(", ")}.` : ""}${out.dupes ? ` ${out.dupes} rows were already there.` : ""} Excel refreshes the stats tabs when you open it.`);
      toast("Workbook updated");
    } catch (e) { toast("Couldn't update the workbook: " + (e.message || e), true); }
    finally { busy = false; }
  }
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const showResult = html => { const el = $("statsResult"); if (el) el.innerHTML = html; };

  // ---------- panel ----------
  function render() {
    const box = $("statsBody"); if (!box) return;
    if (!cup || !D) { box.innerHTML = '<p class="note">Start a Cup first.</p>'; return; }
    const fs = finals();
    if (!fs.length) { box.innerHTML = '<p class="note">No round of this Cup is final yet. Its matches show up here once you mark a round final.</p>'; return; }
    if (pick !== "all" && !fs.some(r => r.id === +pick)) pick = "all";
    const { rows, skipped } = build();
    const c = v => v === "" ? "" : esc(String(v));
    box.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">
        <label style="font-weight:600" for="statsRound">Rounds</label>
        <select id="statsRound"><option value="all">All final rounds</option>${fs.map(r => `<option value="${r.id}"${String(r.id) === String(pick) ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        <button class="btn" type="button" id="statsRun"${rows.length ? "" : " disabled"}>Add ${rows.length} rows to my stats workbook…</button>
      </div>
      <p class="note">Pick your Queen City Cup Stats file. The rows go into the Data Entry tab after the last filled row, and rows already there are skipped, so you can press it after every round. New players are added to the Lists tab with their side. Subs get no row of their own and show as "Name (Sub)", like earlier years. In Chrome or Edge on a computer the file is saved in place (close it in Excel first); other browsers download an updated copy.</p>
      <p class="note" id="statsResult"></p>
      ${skipped.length ? `<p class="note">Left out: ${skipped.map(esc).join(", ")}.</p>` : ""}
      <div class="scroll" style="max-height:420px;overflow:auto"><table><thead><tr><th>Round</th><th>Player</th><th>Year</th><th>Team</th><th>Game</th><th>Partner</th><th>Opponent 1</th><th>Opponent 2</th><th class="num">Win</th><th class="num">Loss</th><th class="num">Half</th><th class="num">Points</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td class="note">${esc(x.round)}</td><td>${c(x.player)}</td><td>${x.year}</td><td>${c(x.team)}</td><td>${c(x.game)}</td><td>${c(x.partner)}</td><td>${c(x.opp1)}</td><td>${c(x.opp2)}</td><td class="num">${x.win}</td><td class="num">${x.loss}</td><td class="num">${x.half}</td><td class="num">${x.points}</td></tr>`).join("") || '<tr><td colspan="12" class="note">No finished matches.</td></tr>'}
      </tbody></table></div>`;
    $("statsRound").onchange = e => { pick = e.target.value; render(); };
    $("statsRun").onclick = () => run(rows);
  }

  (A.cupHooks = A.cupHooks || []).push((c, d) => { cup = c; D = d; render(); });
})();
