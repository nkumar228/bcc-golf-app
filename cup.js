// Queen City Cup math shared by the app and the admin site (Article XII of the league rulebook).
(function () {
  const FORMATS = {
    four_ball:      { label: "Four Ball",           pairs: true,  ball: "own", how: "Each golfer plays their own ball; the lower net score on each side counts." },
    four_ball_agg:  { label: "Four Ball Aggregate", pairs: true,  ball: "own", agg: true, how: "Each golfer plays their own ball; both net scores are added." },
    alternate_shot: { label: "Alternate Shot",      pairs: true,  ball: "one", w: [0.6, 0.4], how: "Partners alternate strokes and alternate tee shots hole to hole." },
    greensome:      { label: "Greensome",           pairs: true,  ball: "one", w: [0.6, 0.4], how: "Both drive, pick one, then alternate shots from there." },
    chapman:        { label: "Chapman",             pairs: true,  ball: "one", w: [0.6, 0.4], how: "Both drive, each hits the other's ball, then pick one and alternate." },
    scramble:       { label: "Scramble",            pairs: true,  ball: "one", w: [0.35, 0.15], how: "Both hit every shot and play the better ball each time." },
    singles:        { label: "Singles",             pairs: false, ball: "own", how: "One golfer against one golfer." }
  };
  const r0 = x => Math.round(x + 1e-9);

  // The tee a golfer plays for a round: one nine, a full 18 on one course, or two nines put together.
  // teesByCourse: Map(course_id -> [{name, rating, slope, par, tee_holes:[{hole,par,stroke_index}]}])
  function teeFor(round, teesByCourse, teeName) {
    const pick = cid => { const list = teesByCourse.get(cid) || []; return list.find(t => t.name === teeName) || list.find(t => t.name === "Blue") || list[0]; };
    const a = pick(round.course_id);
    if (!a) return null;
    const hs = t => [...(t.tee_holes || [])].sort((x, y) => x.hole - y.hole).map(h => ({ hole: h.hole, par: h.par, si: h.stroke_index }));
    if (round.holes === 18 && round.course2_id) {
      const b = pick(round.course2_id);
      if (!b) return null;
      return { name: a.name, rating: +a.rating + +b.rating, slope: r0((a.slope + b.slope) / 2), par: a.par + b.par, holes: [...hs(a), ...hs(b)] };
    }
    return { name: a.name, rating: +a.rating, slope: a.slope, par: a.par, holes: hs(a) };
  }

  // League formula; for 18 holes the 9-hole index is doubled (Nitin, 2026-11-06).
  // Unrounded, so a team blend rounds only once at the end (as the league spreadsheet does).
  const courseHcpRaw = (index, tee, holes) => (+index || 0) * (holes === 18 ? 2 : 1) * tee.slope / 113 + (tee.rating - tee.par);
  const courseHcp = (index, tee, holes) => r0(courseHcpRaw(index, tee, holes));
  const teamHcpRaw = (chs, w) => { const s = [...chs].sort((a, b) => a - b); const lo = s[0], hi = s.length > 1 ? s[1] : s[0]; return w[0] * lo + w[1] * hi; };
  const teamHcp = (chs, w) => r0(teamHcpRaw(chs, w));

  // Strokes on a hole: hardest holes first, by stroke index ranked within the holes played.
  function strokeRanks(holes) { const si = holes.map(h => h.si); return si.map(q => si.filter(z => z < q).length + 1); }
  const strokesOn = (s, rank, n) => s <= 0 ? 0 : Math.floor(s / n) + (rank <= s % n ? 1 : 0);

  // Build one match. side: {id, entry:{player_id, partner_id}} ; info(pid) -> {name, index, tee}
  // Returns balls: [{side, key, players:[pid], label, hcp, strokes}] and per-side handicap.
  function setupMatch(round, sides, info, teesByCourse) {
    const f = FORMATS[round.format] || FORMATS.singles;
    const balls = [], hcpOf = {};
    let holes = null;
    sides.forEach(sd => {
      const e = sd.entry; if (!e) return;
      const ids = [e.player_id, f.pairs ? e.partner_id : null].filter(Boolean);
      const golfers = ids.map(pid => { const i = info(pid) || {}; const tee = teeFor(round, teesByCourse, i.tee); if (!holes && tee) holes = tee.holes; const raw = tee ? courseHcpRaw(i.index, tee, round.holes) : 0; return { pid, name: i.name || "?", index: +i.index || 0, tee, raw, ch: r0(raw) }; });
      if (!golfers.length) return;
      if (f.ball === "one") {
        // A golfer playing alone (side one short) fills both spots in the formula: their handicap counts twice
        const raw = f.w ? teamHcpRaw(golfers.map(g => g.raw), f.w) : golfers[0].raw;
        balls.push({ side: sd.id, key: golfers[0].pid, players: golfers.map(g => g.pid), label: golfers.map(g => g.name).join(" & "), golfers, raw, hcp: r0(raw) });
      } else golfers.forEach(g => balls.push({ side: sd.id, key: g.pid, players: [g.pid], label: g.name, golfers: [g], raw: g.raw, hcp: g.ch }));
    });
    // Off the lowest: the lowest handicap in the match plays off 0 and everyone else gets the difference.
    const low = balls.length ? Math.min(...balls.map(b => b.hcp)) : 0;
    holes = holes || [];
    const ranks = strokeRanks(holes);
    balls.forEach(b => { b.strokes = b.hcp - low; b.perHole = holes.map((h, i) => strokesOn(b.strokes, ranks[i], holes.length)); });
    sides.forEach(sd => { hcpOf[sd.id] = balls.filter(b => b.side === sd.id).map(b => b.hcp); });
    return { format: f, holes, balls, hcpOf };
  }

  // Match status from scores. scores: Map("side:pid:hole" -> strokes). sideIds: [a, b]
  function matchStatus(m, sideIds, scores, sideName) {
    const { holes, balls, format } = m;
    const n = holes.length; let lead = 0, played = 0; const perHole = [];
    const [A, B] = sideIds;
    const hasA = balls.some(b => b.side === A), hasB = balls.some(b => b.side === B);
    for (let i = 0; i < n; i++) {
      const h = holes[i].hole;
      const val = sid => {
        const nets = balls.filter(b => b.side === sid).map(b => { const g = scores.get(`${sid}:${b.key}:${h}`); return g == null ? null : g - b.perHole[i]; });
        if (!nets.length || nets.some(x => x == null)) return null;
        // Aggregate with a golfer playing alone: their net counts twice
        return format.agg ? (nets.length === 1 && format.pairs ? 2 * nets[0] : nets.reduce((t, x) => t + x, 0)) : Math.min(...nets);
      };
      const a = val(A), b = val(B);
      if (a == null || b == null) { perHole.push(null); continue; }
      // Holes count in order: stop at the first gap so "thru" stays honest.
      if (perHole.some(x => x == null)) { perHole.push(null); continue; }
      const w = a < b ? A : b < a ? B : 0; perHole.push(w); played++;
      lead += w === A ? 1 : w === B ? -1 : 0;
      if (Math.abs(lead) > n - played) break;
    }
    const left = n - played, leader = lead > 0 ? A : lead < 0 ? B : null, up = Math.abs(lead);
    let done = false, winner = null, text;
    // An empty matchup (one side has nobody in it) is halved automatically (Nitin 2026-11-11)
    if (!hasA || !hasB) { done = true; text = hasA || hasB ? "Halved · empty match" : "No match"; }
    else if (!n) text = "Set the course to score this match";
    else if (up > left) { done = true; winner = leader; text = left ? `${sideName(winner)} wins ${up}&${left}` : `${sideName(winner)} wins ${up} up`; }
    else if (!left) { done = true; text = "Halved"; }
    else if (!played) text = "Not started";
    else if (!up) text = `All square thru ${played}`;
    else text = `${sideName(leader)} ${up} up thru ${played}${up === left ? " (dormie)" : ""}`;
    return { played, lead, leader, up, left, done, winner, halved: done && !winner && (hasA || hasB), empty: !hasA || !hasB, text, perHole };
  }

  // Points for a match: override first, then a finished match. Live matches give a projection.
  function points(st, override, sideIds) {
    const pts = { [sideIds[0]]: 0, [sideIds[1]]: 0 }, live = { [sideIds[0]]: 0, [sideIds[1]]: 0 };
    if (override) {
      if (override.winner_side_id) pts[override.winner_side_id] = 1; else { pts[sideIds[0]] = pts[sideIds[1]] = 0.5; }
      return { pts, live: pts, final: true };
    }
    if (st.done) { if (st.winner) pts[st.winner] = 1; else if (st.halved) { pts[sideIds[0]] = pts[sideIds[1]] = 0.5; } return { pts, live: pts, final: true }; }
    if (st.played) { if (st.leader) live[st.leader] = 1; else { live[sideIds[0]] = live[sideIds[1]] = 0.5; } }
    return { pts, live, final: false };
  }

  window.Cup = { FORMATS, teeFor, courseHcp, courseHcpRaw, teamHcp, teamHcpRaw, strokeRanks, strokesOn, setupMatch, matchStatus, points };
})();
