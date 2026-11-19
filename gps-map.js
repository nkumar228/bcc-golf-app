// GPS version 2: a satellite map of the whole hole, turned so the tee is at the bottom and the green at the top.
// Tap the map to drop a target and see yardages (you → target → middle of the green). "Green" zooms in and shows
// a slope map built from USGS lidar (gps/greens-dem.json, made by tools/green_slopes.py).
// Photo (Nitin 2026-11-16): Ohio's statewide aerial photos (OSIP III, OGRIP), leaf-off and about 15 cm a pixel, so greens
// show clearly even under trees. Free public service; it allows this site to load it. One photo, no switch.
(() => {
  const $ = id => document.getElementById(id);
  const G = window.GPS; if (!G) return;
  const YD = 1.0936133, Z = 20, TS = 256;
  const SRC = {
    ohio: { max: 20, url: (z, x, y) => `https://maps.ohio.gov/image/rest/services/osip_3_cache/MapServer/tile/${z}/${y}/${x}`, credit: "Photo: Ohio OGRIP (OSIP III)" }
  };
  const photo = "ohio";

  // World pixels at zoom 20 (web mercator)
  const W = 256 * 2 ** Z;
  const toW = ([lat, lon]) => { const s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * W, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W]; };
  const toLL = ([x, y]) => { const n = Math.PI - 2 * Math.PI * y / W; return [180 / Math.PI * Math.atan(Math.sinh(n)), x / W * 360 - 180]; };
  const mPerPx = lat => 40075016.686 * Math.cos(lat * Math.PI / 180) / W; // ground metres per world pixel
  const dist = G.dist; // yards between [lat,lon] points

  const cv = $("gpsMap"), ctx = cv.getContext("2d");
  let O = [0, 0]; // drawing origin in world pixels
  let mode = "hole", view = null, target = null, fitKey = "", teeMode = false, aimMode = false, aimPending = true, reading = null, edge = null; // edge: points being traced

  // Tee: the admin-set spot, else estimated from the yardage straight back through the green (back → front line).
  function teeOf(h, s) {
    if (s.t) return { pt: s.t, est: false };
    const m = s.m || s.f || s.b; if (!m) return null;
    let dx = 0, dy = -1;
    if (s.f && s.b) { const k = Math.cos(m[0] * Math.PI / 180); dx = (s.f[1] - s.b[1]) * k; dy = s.f[0] - s.b[0]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; }
    const deg = G.yds(h) / YD / 111320;
    return { pt: [m[0] + dy * deg, m[1] + dx * deg / Math.cos(m[0] * Math.PI / 180)], est: true };
  }
  // 200-yard spot on par 4s (Nitin 2026-11-19): where the hole map's target starts. Admins place it in the middle of
  // the fairway; until then it's 200 yards straight from the tee toward the flag.
  const AIM_YDS = 200;
  function at200(from, toward) {
    const k = Math.cos(from[0] * Math.PI / 180), dx = (toward[1] - from[1]) * k, dy = toward[0] - from[0], n = Math.hypot(dx, dy) || 1;
    const deg = AIM_YDS / YD / 111320;
    return [from[0] + dy / n * deg, from[1] + dx / n * deg / k];
  }
  function aimOf(h, s) {
    if (G.par(h) !== 4) return null;
    const t = teeOf(h, s), m = s.m || s.f || s.b; if (!t || !m) return null;
    return s.a || at200(t.pt, m);
  }
  const bearingW = (a, b) => Math.atan2(a[0] - b[0], a[1] - b[1]); // angle that turns a→b to point up the screen

  function size() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    return { w: r.width, h: r.height, d };
  }
  // screen <-> world
  const toS = (p, v = view, sz = size()) => { const dx = p[0] - v.f[0], dy = p[1] - v.f[1], c = Math.cos(v.r), s = Math.sin(v.r); return [sz.w / 2 + v.k * (dx * c - dy * s), sz.h / 2 + v.k * (dx * s + dy * c)]; };
  const fromS = (q, v = view, sz = size()) => { const x = (q[0] - sz.w / 2) / v.k, y = (q[1] - sz.h / 2) / v.k, c = Math.cos(-v.r), s = Math.sin(-v.r); return [v.f[0] + x * c - y * s, v.f[1] + x * s + y * c]; };

  // Fit a set of world points into the screen, turned by angle r
  function fit(pts, r, pad) {
    const sz = size(), c = Math.cos(r), s = Math.sin(r);
    const rot = pts.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
    const xs = rot.map(p => p[0]), ys = rot.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const top = 60, bottom = 64; // room for the buttons and the hint
    const k = Math.min(8, (sz.w - 2 * pad) / Math.max(1, Math.max(...xs) - Math.min(...xs)), (sz.h - top - bottom - 2 * pad) / Math.max(1, Math.max(...ys) - Math.min(...ys)));
    const cy2 = cy + (bottom - top) / 2 / k, ci = Math.cos(-r), si = Math.sin(-r);
    return { f: [cx * ci - cy2 * si, cx * si + cy2 * ci], k, r };
  }

  // Where yardages are measured from: you, when you're on this hole; otherwise the tee.
  function base(h, s) {
    const t = teeOf(h, s), fx = G.fix(), m = s.m || s.f || s.b;
    if (fx && m && dist(fx, m) <= G.yds(h) + 40) return { pt: fx, me: true };
    return t ? { pt: t.pt, me: false } : null;
  }

  function refit(force) {
    const h = G.hole(), s = G.spots(h), m = s.m || s.f || s.b;
    if (!m) { view = null; return; }
    const key = h + mode;
    if (!force && view && key === fitKey) return;
    fitKey = key;
    const t = teeOf(h, s), mw = toW(m), r = bearingW(toW(t.pt), mw);
    if (mode === "green") {
      const k = size().w / (44 / mPerPx(m[0])); // about 44 m across
      view = { f: mw, k, r };
    } else {
      const b = base(h, s), pts = [mw, toW(t.pt)];
      if (b && b.me) pts.push(toW(b.pt));
      ["f", "b"].forEach(x => s[x] && pts.push(toW(s[x])));
      view = fit(pts, r, 28);
    }
  }

  // Tiles
  const tiles = new Map();
  function tile(z, x, y) {
    const key = photo + z + "/" + x + "/" + y;
    let t = tiles.get(key);
    if (!t) {
      t = new Image(); t.ok = false; // only drawn, never read back, so no cross-origin request needed
      t.onload = () => { t.ok = true; draw(); }; t.onerror = () => { t.bad = true; };
      t.src = SRC[photo].url(z, x, y); tiles.set(key, t);
      if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
    }
    return t;
  }
  function drawTiles(sz) {
    const src = SRC[photo];
    const z = Math.max(12, Math.min(src.max, Math.round(Z + Math.log2(view.k * sz.d))));
    if (z - 2 >= 12) layer(sz, z - 2, false); // a softer layer underneath fills any gaps while sharp tiles load
    layer(sz, z, true);
  }
  function layer(sz, z, fallback) {
    const span = TS * 2 ** (Z - z);
    const corners = [[0, 0], [sz.w, 0], [0, sz.h], [sz.w, sz.h]].map(q => fromS(q, view, sz));
    const x0 = Math.floor(Math.min(...corners.map(c => c[0])) / span), x1 = Math.floor(Math.max(...corners.map(c => c[0])) / span);
    const y0 = Math.floor(Math.min(...corners.map(c => c[1])) / span), y1 = Math.floor(Math.max(...corners.map(c => c[1])) / span);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return;
    const ov = 1 / view.k; // a hair of overlap hides seams
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      const t = tile(z, tx, ty);
      if (t.ok) { ctx.drawImage(t, tx * span - O[0], ty * span - O[1], span + ov, span + ov); continue; }
      if (!fallback) continue;
      // Use a lower-zoom tile, cut down, until this one arrives
      for (let up = 1; up <= 4; up++) {
        const pz = z - up, f = 2 ** up, p = tiles.get(photo + pz + "/" + Math.floor(tx / f) + "/" + Math.floor(ty / f));
        if (p && p.ok) { const sub = TS / f; ctx.drawImage(p, (tx % f) * sub, (ty % f) * sub, sub, sub, tx * span - O[0], ty * span - O[1], span + ov, span + ov); break; }
      }
    }
  }

  // Slope data
  let DEM = null, demLoading = false;
  const slopeCache = {};
  function loadDem() {
    if (DEM || demLoading) return; demLoading = true;
    fetch("gps/greens-dem.json").then(r => r.json()).then(j => { DEM = j; draw(); }).catch(() => { demLoading = false; });
  }
  // Smooth the lidar grid (it's noisy at the 1-2 cm level), then work out the fall at each metre.
  function slopes(h) {
    if (slopeCache[h]) return slopeCache[h];
    const d = DEM && DEM.holes[h]; if (!d) return null;
    const n = Math.round(Math.sqrt(d.z.length)), z = d.z.map(v => v / 100);
    const k = [1, 4, 6, 4, 1], blur = (a, horiz) => {
      const o = new Array(a.length).fill(0);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        let s = 0, w = 0;
        for (let i = -2; i <= 2; i++) { const rr = horiz ? r : r + i, cc = horiz ? c + i : c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; s += a[rr * n + cc] * k[i + 2]; w += k[i + 2]; }
        o[r * n + c] = s / w;
      }
      return o;
    };
    let sm = blur(blur(z, true), false); sm = blur(blur(sm, true), false);
    const gx = new Array(n * n).fill(0), gy = new Array(n * n).fill(0); // rise per metre east / north
    for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) {
      gx[r * n + c] = (sm[r * n + c + 1] - sm[r * n + c - 1]) / 2;
      gy[r * n + c] = (sm[(r - 1) * n + c] - sm[(r + 1) * n + c]) / 2; // row 0 is north
    }
    return (slopeCache[h] = { n, sm, gx, gy, c: d.c });
  }
  // Green outline: an oval through the front and back spots (we only have three spots, so it's approximate).
  function oval(s) {
    if (!(s.f && s.b)) { const m = s.m || s.f || s.b; return { c: m, a: 13, b: 11, ang: 0 }; }
    const c = [(s.f[0] + s.b[0]) / 2, (s.f[1] + s.b[1]) / 2], len = dist(s.f, s.b) / YD;
    const k = Math.cos(c[0] * Math.PI / 180), dx = (s.b[1] - s.f[1]) * k, dy = s.b[0] - s.f[0];
    const a = len / 2 + 2;
    return { c, a, b: a * 0.8, ang: Math.atan2(dy, dx) }; // ang: east-north angle of the long axis
  }
  // local metres (east, north) from a lat/lon
  const enu = (o, p) => [(p[1] - o[1]) * 111320 * Math.cos(o[0] * Math.PI / 180), (p[0] - o[0]) * 111320];
  // The green's shape: the traced edge when an admin has drawn one, otherwise the oval.
  function shape(s) {
    if (s.o && s.o.length >= 3) {
      const c = s.m || s.o[0], poly = s.o.map(p => enu(c, p));
      return {
        inside: p => { const [x, y] = enu(c, p); let inn = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inn = !inn; } return inn; },
        path: () => { ctx.beginPath(); s.o.forEach((p, i) => { const w = toW(p); ctx[i ? "lineTo" : "moveTo"](w[0] - O[0], w[1] - O[1]); }); ctx.closePath(); }
      };
    }
    const ov = oval(s), px = 1 / mPerPx(ov.c[0]);
    return { inside: p => inOval(ov, p), path: () => { const w = toW(ov.c); ctx.beginPath(); ctx.ellipse(w[0] - O[0], w[1] - O[1], ov.a * px, ov.b * px, -ov.ang, 0, Math.PI * 2); } };
  }
  const inOval = (ov, p) => { const [e, n] = enu(ov.c, p), c = Math.cos(-ov.ang), s = Math.sin(-ov.ang), x = e * c - n * s, y = e * s + n * c; return (x / ov.a) ** 2 + (y / ov.b) ** 2 <= 1; };
  const slopeColor = pct => pct < 1 ? [76, 175, 80] : pct < 2 ? [205, 220, 57] : pct < 3 ? [255, 179, 0] : pct < 4 ? [245, 110, 30] : [220, 30, 40];

  function drawSlopes(h, s) {
    const S = slopes(h); if (!S) { loadDem(); return; }
    const sh = shape(s), n = S.n, half = (n - 1) / 2, cw = toW(S.c), px = 1 / mPerPx(S.c[0]);
    // Colour wash, one square per metre, inside the green
    const img = document.createElement("canvas"); img.width = n; img.height = n;
    const ic = img.getContext("2d"), id = ic.createImageData(n, n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const i = r * n + c, ll = [S.c[0] + (half - r) / 111320, S.c[1] + (c - half) / (111320 * Math.cos(S.c[0] * Math.PI / 180))];
      if (!sh.inside(ll)) continue;
      const col = slopeColor(Math.hypot(S.gx[i], S.gy[i]) * 100);
      id.data.set([...col, 120], i * 4);
    }
    ic.putImageData(id, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cw[0] - O[0] - (half + 0.5) * px, cw[1] - O[1] - (half + 0.5) * px, n * px, n * px);
    ctx.restore();
    // Arrows every 3 m, pointing downhill, longer = steeper
    const arrows = [];
    for (let r = 1; r < n - 1; r += 3) for (let c = 1; c < n - 1; c += 3) {
      const i = r * n + c, ll = [S.c[0] + (half - r) / 111320, S.c[1] + (c - half) / (111320 * Math.cos(S.c[0] * Math.PI / 180))];
      if (!sh.inside(ll)) continue;
      const pct = Math.hypot(S.gx[i], S.gy[i]) * 100; if (pct < 0.4) continue;
      // downhill in world-pixel axes (x east, y south)
      const dx = -S.gx[i], dy = S.gy[i], m = Math.hypot(dx, dy);
      arrows.push({ p: toS([cw[0] + (c - half) * px, cw[1] + (r - half) * px]), dx: dx / m, dy: dy / m, pct });
    }
    return arrows;
  }
  function drawArrows(arrows) {
    const cr = Math.cos(view.r), sr = Math.sin(view.r);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const a of arrows) {
      // Subtle (Nitin 2026-11-16): thin, see-through, small heads; still longer where it's steeper
      const ux = a.dx * cr - a.dy * sr, uy = a.dx * sr + a.dy * cr, L = Math.min(14, 5 + a.pct * 2);
      const x0 = a.p[0] - ux * L / 2, y0 = a.p[1] - uy * L / 2, x1 = a.p[0] + ux * L / 2, y1 = a.p[1] + uy * L / 2;
      ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 1.1; ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1 - ux * 3 - uy * 2.2, y1 - uy * 3 + ux * 2.2); ctx.lineTo(x1, y1); ctx.lineTo(x1 - ux * 3 + uy * 2.2, y1 - uy * 3 - ux * 2.2);
      ctx.stroke();
    }
  }
  // Fall at a spot on the green, said from where you're looking (bottom of the screen = front of the green).
  function fallAt(h, ll) {
    const S = slopes(h); if (!S) return null;
    const [e, nn] = enu(S.c, ll), half = (S.n - 1) / 2, c = Math.round(half + e), r = Math.round(half - nn);
    if (r < 1 || c < 1 || r >= S.n - 1 || c >= S.n - 1) return null;
    const i = r * S.n + c, pct = Math.hypot(S.gx[i], S.gy[i]) * 100;
    if (pct < 0.5) return { pct, text: "Nearly flat here" };
    const dx = -S.gx[i], dy = S.gy[i], ux = dx * Math.cos(view.r) - dy * Math.sin(view.r), uy = dx * Math.sin(view.r) + dy * Math.cos(view.r);
    const ang = (Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360; // 0 = toward the back (up the screen)
    const dirs = ["the back", "the back right", "the right", "the front right", "the front", "the front left", "the left", "the back left"];
    return { pct, text: `Falls ${pct.toFixed(1)}% toward ${dirs[Math.round(ang / 45) % 8]}` };
  }

  // Wind arrow (Nitin 2026-11-16): points the way the wind is blowing, turned with the map, speed underneath.
  function windBadge(sz) {
    const w = G.wind && G.wind(); if (!w) return;
    const c = [34, 88], to = (w.from + 180) * Math.PI / 180;
    const vx = Math.sin(to), vy = -Math.cos(to); // world: x east, y south
    const ux = vx * Math.cos(view.r) - vy * Math.sin(view.r), uy = vx * Math.sin(view.r) + vy * Math.cos(view.r);
    dot(c, 24, "rgba(0,0,0,.6)", "rgba(255,255,255,.35)");
    if (w.mph >= 1) {
      const L = 13, x0 = c[0] - ux * L, y0 = c[1] - uy * L, x1 = c[0] + ux * L, y1 = c[1] + uy * L;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1 - ux * 7 - uy * 5, y1 - uy * 7 + ux * 5); ctx.lineTo(x1, y1); ctx.lineTo(x1 - ux * 7 + uy * 5, y1 - uy * 7 - ux * 5);
      ctx.stroke();
    }
    pill([c[0], c[1] + 36], w.mph < 1 ? "Calm" : `${Math.round(w.mph)} mph`);
  }
  // Drawing helpers
  function dot(p, r, fill, stroke) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); } }
  function pill(p, text, opts = {}) {
    ctx.font = `600 ${opts.big ? 17 : 14}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const w = ctx.measureText(text).width + 14, h = opts.big ? 24 : 20;
    const x = Math.round(p[0] - w / 2), y = Math.round(p[1] - h / 2);
    ctx.fillStyle = opts.bg || "rgba(0,0,0,.72)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, h / 2) : ctx.rect(x, y, w, h); ctx.fill();
    ctx.fillStyle = opts.fg || "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, p[0], p[1] + 1);
  }
  function seg(a, b, label) {
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
    if (label) pill([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], label);
  }

  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(paint); }
  function paint() {
    raf = 0;
    if (location.hash !== "#gps" || cv.offsetParent === null) return;
    const sz = size(); ctx.setTransform(sz.d, 0, 0, sz.d, 0, 0);
    ctx.fillStyle = "#28362c"; ctx.fillRect(0, 0, sz.w, sz.h);
    const h = G.hole(), s = G.spots(h), m = s.m || s.f || s.b;
    $("gpsMapNote").textContent = "";
    if (!m) { pill([sz.w / 2, sz.h / 2], `Hole ${h}'s green isn't mapped yet`); return; }
    refit(false);
    // photo + slope wash in world coordinates
    // World pixels are huge numbers (about 70 million), more than the canvas keeps exactly, so draw relative to the view centre.
    O = view.f.slice();
    ctx.save(); ctx.translate(sz.w / 2, sz.h / 2); ctx.rotate(view.r); ctx.scale(view.k, view.k);
    drawTiles(sz);
    let arrows = null;
    if (mode === "green" && !edge) arrows = drawSlopes(h, s);
    ctx.restore();
    if (arrows) drawArrows(arrows);

    const t = teeOf(h, s), fx = G.fix(), b = base(h, s);
    if (mode === "hole" && !edge && !teeMode && !aimMode && (aimPending || (target && target.auto))) {
      const a = aimOf(h, s);
      aimPending = false;
      // start at the 200-yard spot, unless you're already past it
      if (a && !(fx && dist(fx, m) < dist(a, m) + 20)) { target = a.slice(); target.auto = true; }
      else if (target && target.auto) target = null;
    }
    const S = p => toS(toW(p), view, sz);
    if (mode === "hole") {
      dot(S(t.pt), 7, t.est ? "rgba(30,90,200,.6)" : "#1e5ac8", "#fff");
      // Lines and yardages
      if (b) {
        const bp = S(b.pt), mp = S(m);
        if (target) {
          const tp = S(target);
          seg(bp, tp, Math.round(dist(b.pt, target)) + ""); seg(tp, mp, Math.round(dist(target, m)) + "");
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(tp[0], tp[1], 11, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(tp[0] - 5, tp[1]); ctx.lineTo(tp[0] + 5, tp[1]); ctx.moveTo(tp[0], tp[1] - 5); ctx.lineTo(tp[0], tp[1] + 5); ctx.stroke();
        } else seg(bp, mp, Math.round(dist(b.pt, m)) + "");
      }
    }
    // Green spots: front, back small; middle gets a flag
    const fb = b && G.fb(h, b.pt), shown = fb || s;
    ["f", "b"].forEach(k => shown[k] && dot(S(shown[k]), mode === "green" ? 4 : 3, "rgba(255,255,255,.85)"));
    const mp = S(m);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mp[0], mp[1]); ctx.lineTo(mp[0], mp[1] - 20); ctx.stroke();
    ctx.fillStyle = "#e00122"; ctx.beginPath(); ctx.moveTo(mp[0], mp[1] - 20); ctx.lineTo(mp[0] + 12, mp[1] - 15); ctx.lineTo(mp[0], mp[1] - 10); ctx.fill();
    dot(mp, 3, "#fff");
    // You
    if (fx) {
      const p = S(fx), acc = (fx.acc || 0) / YD / mPerPx(fx[0]) * view.k;
      if (acc > 8) { ctx.beginPath(); ctx.arc(p[0], p[1], acc, 0, Math.PI * 2); ctx.fillStyle = "rgba(66,133,244,.18)"; ctx.fill(); }
      dot(p, 7, "#4285f4", "#fff");
    }
    if (edge) {}
    else if (mode === "green") {
      if (reading) { const p = S(reading.ll); dot(p, 5, "#fff", "#000"); pill([sz.w / 2, sz.h - 22], reading.text, { big: true }); }
      else if (DEM && !DEM.holes[h]) pill([sz.w / 2, sz.h - 22], "No slope data for this green yet");
      else if (DEM) pill([sz.w / 2, sz.h - 22], "Tap the green to read the slope");
    } else if (!target) pill([sz.w / 2, sz.h - 22], "Tap the map for yardages");
    else pill([sz.w / 2, sz.h - 22], "Tap again to move · ✕ to clear");
    windBadge(sz);
    if (teeMode) pill([sz.w / 2, 22], "Tap where the blue tee is", { bg: "#1e5ac8" });
    if (aimMode) pill([sz.w / 2, 22], "Tap the middle of the fairway", { bg: "#1e5ac8" });
    if (edge) {
      const pts = edge.map(S);
      if (pts.length) {
        ctx.strokeStyle = "#ffd400"; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](...p));
        if (pts.length >= 3) ctx.closePath(); ctx.stroke();
        pts.forEach(p => dot(p, 4, "#ffd400", "#000"));
      }
      pill([sz.w / 2, 64], edge.length < 3 ? "Tap your way around the edge of the green" : `${edge.length} points · keep going or Save edge`, { bg: "#8a6400" });
    }
    ["edgeUndo", "edgeCancel", "edgeSave"].forEach(id => $(id).hidden = !edge);
    $("edgeSave").disabled = !(edge && edge.length >= 3);
    $("gpsMapClear").hidden = !(mode === "hole" && target);
    $("gpsMapNote").textContent = SRC[photo].credit + (mode === "green" && DEM ? " · Slopes: USGS lidar" : "") + (t.est && window.adminTools && adminTools() ? " · Tee spot is estimated" : "");
  }

  // Gestures: drag to pan, pinch or wheel to zoom, tap to place
  const ptrs = new Map(); let start = null, moved = false;
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 1) { start = { at: [e.offsetX, e.offsetY], f: view && view.f.slice(), t: Date.now() }; moved = false; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; start = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f: view.f.slice() }; moved = true; }
  });
  cv.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId) || !view || !start) return;
    ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 2 && start.pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const v0 = { f: start.f, k: start.k, r: view.r }, anchor = fromS(start.mid, v0);
      view.k = Math.max(0.05, Math.min(12, start.k * d / start.pinch)); view.f = start.f.slice();
      const now = fromS(mid); view.f = [view.f[0] + anchor[0] - now[0], view.f[1] + anchor[1] - now[1]];
      draw(); return;
    }
    if (ptrs.size === 1 && !start.pinch) {
      const dx = e.offsetX - start.at[0], dy = e.offsetY - start.at[1];
      if (!moved && Math.hypot(dx, dy) < 8) return;
      moved = true;
      const c = Math.cos(-view.r), s = Math.sin(-view.r);
      view.f = [start.f[0] - (dx * c - dy * s) / view.k, start.f[1] - (dx * s + dy * c) / view.k]; draw();
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) { if (!moved && start && view) tap([e.offsetX, e.offsetY]); start = null; }
    else if (ptrs.size === 1) { const [p] = [...ptrs.values()]; start = { at: p, f: view.f.slice() }; moved = true; }
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); start = null; });
  cv.addEventListener("wheel", e => {
    if (!view) return; e.preventDefault();
    const anchor = fromS([e.offsetX, e.offsetY]); view.k = Math.max(0.05, Math.min(12, view.k * Math.exp(-e.deltaY / 300)));
    const now = fromS([e.offsetX, e.offsetY]); view.f = [view.f[0] + anchor[0] - now[0], view.f[1] + anchor[1] - now[1]]; draw();
  }, { passive: false });

  function tap(q) {
    const ll = toLL(fromS(q)), h = G.hole();
    if (edge) { edge.push([+ll[0].toFixed(7), +ll[1].toFixed(7)]); draw(); return; }
    if (aimMode) {
      aimMode = false;
      const s = G.spots(h), t = teeOf(h, s);
      if (t) { const a = at200(t.pt, ll); G.saveAim(h, [+a[0].toFixed(7), +a[1].toFixed(7)]); target = a; target.auto = true; }
      draw(); return;
    }
    if (teeMode) {
      teeMode = false; G.saveTee(h, [+ll[0].toFixed(7), +ll[1].toFixed(7)]); fitKey = ""; draw(); return;
    }
    if (mode === "green") { reading = fallAt(h, ll); if (reading) reading.ll = ll; draw(); return; }
    target = ll; draw();
  }

  function setMode(m) {
    mode = m; target = null; aimPending = m === "hole"; reading = null; fitKey = ""; if (m === "hole") edge = null;
    document.querySelectorAll("[data-mapmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mapmode === m)));
    if (m === "green") loadDem();
    draw();
  }
  document.querySelectorAll("[data-mapmode]").forEach(b => b.onclick = () => setMode(b.dataset.mapmode));
  $("gpsMapFit").onclick = () => { fitKey = ""; draw(); };
  $("gpsMapClear").onclick = () => { target = null; aimPending = false; draw(); };
  const aimBtn = $("mapSetAim");
  if (aimBtn) aimBtn.onclick = () => {
    if (G.par(G.hole()) !== 4) { G.note("The 200-yard spot is only used on par 4s."); return; }
    if (mode !== "hole") setMode("hole"); teeMode = false; aimMode = true; cv.scrollIntoView({ block: "center", behavior: "smooth" }); draw();
  };
  const teeBtn = $("mapSetTee");
  if (teeBtn) teeBtn.onclick = () => { if (mode !== "hole") setMode("hole"); teeMode = true; location.hash = "#gps"; cv.scrollIntoView({ block: "center", behavior: "smooth" }); draw(); };

  const edgeBtn = $("mapTraceEdge");
  if (edgeBtn) edgeBtn.onclick = () => { teeMode = false; setMode("green"); edge = []; cv.scrollIntoView({ block: "center", behavior: "smooth" }); draw(); };
  $("edgeUndo").onclick = () => { if (edge) { edge.pop(); draw(); } };
  $("edgeCancel").onclick = () => { edge = null; draw(); };
  $("edgeSave").onclick = () => { if (edge && edge.length >= 3) { G.saveOutline(G.hole(), edge); } edge = null; draw(); };

  let lastHole = null;
  window.GPSMap = {
    // Called whenever the GPS tab redraws (new fix, hole change, data loaded)
    update() {
      const h = G.hole();
      if (h !== lastHole) { lastHole = h; target = null; aimPending = true; reading = null; teeMode = false; aimMode = false; edge = null; fitKey = ""; }
      draw();
    }
  };
  new ResizeObserver(() => { fitKey = ""; draw(); }).observe(cv);
  window.addEventListener("hashchange", () => { if (location.hash === "#gps") { fitKey = ""; draw(); } });
})();
