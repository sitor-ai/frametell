/* Inked · kit: one everyday object, hand-inked and isometric, that does its job on screen. P.figure(...) fits a model
 * (x = depth toward the viewer's right, y = width toward the viewer's left, z = up; about 1 unit per cm) into a box on the
 * stage and calls your draw(D, lt) every frame. D draws back to front in call order, like a painter: a board, cast
 * shadows, what is seen through openings, glass, the front, things mounted on it, the body, the silhouette ink, labels.
 * Faces are shaded in three flat tones by the way they face one fixed light, the outline is inked heavier than the inner
 * lines, the object casts one flat blue shadow, and every line and edge wobbles a little, the same way every frame.
 * The step pills (P.steps), the big readings (P.stat) and the toast (P.note) are the figure's controls, pressed by the
 * narration.
 * Adapted from Colorfigures by April Zhu (MIT), itself built on iso-glow (April Zhu, MIT) and iso-figure (Tolga Cohce,
 * MIT): the projection, the three-band shading, the thickness-weighted silhouette ink, the cast shadow, the board and the
 * part labels, rewritten for a canvas and for page-local time. See NOTICE.md.
 * Everything is a pure function of page-local time lt. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const SW = STAGE.w, SH0 = STAGE.h;
  const TAU = Math.PI * 2, C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const INK = '#231e16', SHADOW = '#41538f', CREAM = '#fff4d6', ACCENT = '#f4b829', PAPER = '#f2efe7';
  const MONO = '"IBM Plex Mono", "Noto Sans SC Variable", ui-monospace, monospace';

  // ── colour and materials ──────────────────────────────
  const rgb = (c) => { c = String(c); if (c[0] !== '#') c = col(c) || '#888888'; if (c[0] !== '#') return [136, 136, 136]; const x = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const hex = (a) => '#' + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const matOf = (c) => { const l = hex(rgb(c)); return { l, m: mix(l, '#000000', 0.16), d: mix(l, '#000000', 0.42) }; };
  /** the materials: a body colour has three flat tones (l light, m mid, d dark) */
  const MATS = {
    mustard: { l: '#f4b829', m: '#d49c1f', d: '#4e4a18' },
    tomato: { l: '#ef6a4c', m: '#cf5038', d: '#4a2219' },
    mint: { l: '#93d3b0', m: '#71b693', d: '#1f4034' },
    cobalt: { l: '#76a0e2', m: '#5a82c6', d: '#1c2948' },
    blush: { l: '#f3a6bb', m: '#d8869c', d: '#4b2430' },
    metal: { l: '#eef0f0', m: '#c6ccce', d: '#8f989b' },
    clear: { l: '#e4f2f4', m: '#c4dfe4', d: '#97b9c0' },
    ceramic: { l: '#fbfaf3', m: '#e3e0d2', d: '#bdb8a6' },
    dark: { l: '#55504a', m: '#3d3935', d: '#272421' },
    rubber: { l: '#4a4f52', m: '#3a3e40', d: '#262a2c' },
    board: { l: '#e6e1d4', m: '#cfc8b8', d: '#aaa293' },
    wood: { l: '#d9a86c', m: '#bf8a4f', d: '#8e6236' },
  };
  const mat = (m) => (m && typeof m === 'object' ? m : MATS[m] || matOf(m || 'ceramic'));
  // a colour for a fill or a line: a material's light tone, a palette name, or a hex
  const paint = (c) => (c && typeof c === 'object' ? c.l : MATS[c] ? MATS[c].l : String(c)[0] === '#' || String(c).startsWith('rgb') ? c : col(c) || c);

  // ── light and shading (one fixed light: the front is lit, the left side in shade, shadows fall to the lower left) ──
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const avg = (ps) => ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0]);
  const vis = (n) => n[0] + n[1] + n[2] > 1e-6;
  const AZ = 105 * Math.PI / 180, SHK = 0.85, SH = [SHK * Math.cos(AZ), SHK * Math.sin(AZ)], SHADOW_LEN = 0.45;
  const L = norm([-SH[0], -SH[1], 1]), LIN = norm([0.6, 0.2, 1]);
  const tone = (n, m) => { m = mat(m); const d = dot(n, L); return d > -0.15 ? m.l : d > -0.45 ? m.m : m.d; };
  const toneI = (n, m) => { m = mat(m); const d = dot(n, LIN); return d > 0.6 ? m.l : d > 0.05 ? m.m : m.d; };

  // ── 2D shapes in a plane's (u, v) coordinates, mapped to 3D by a plane ──
  const arcUV = (cu, cv, r, a0, a1, n = 7) => { const o = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); } return o; };
  const rectUV = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const rrUV = (u0, v0, u1, v1, r, n = 7) => (r <= 0 ? rectUV(u0, v0, u1, v1) : [...arcUV(u1 - r, v0 + r, r, -90, 0, n), ...arcUV(u1 - r, v1 - r, r, 0, 90, n), ...arcUV(u0 + r, v1 - r, r, 90, 180, n), ...arcUV(u0 + r, v0 + r, r, 180, 270, n)]);
  const ellUV = (cu, cv, ru, rv, n = 24) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU; return [cu + ru * Math.cos(a), cv + rv * Math.sin(a)]; });
  const PX = (x) => ([u, v]) => [x, u, v];   // front plane x = const (u = y, v = z)
  const PY = (y) => ([u, v]) => [u, y, v];   // side plane y = const (u = x, v = z)
  const PZ = (z) => ([u, v]) => [u, v, z];   // level plane z = const (u = x, v = y)
  const on = (plane, uv) => uv.map(plane);
  const smooth3 = (pts, it = 3) => { for (let k = 0; k < it; k++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; o.push(a.map((v, j) => v * 0.75 + b[j] * 0.25), a.map((v, j) => v * 0.25 + b[j] * 0.75)); } o.push(pts[pts.length - 1]); pts = o; } return pts; };
  const hull = (pts) => {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  };

  // ── the hand: a smooth noise field fixed to the page, so every line wobbles the same way every frame ──
  const hash = (i, j, s) => { let x = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y, s) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return lerp(lerp(hash(i, j, s), hash(i + 1, j, s), u), lerp(hash(i, j + 1, s), hash(i + 1, j + 1, s), u), v) * 2 - 1; };
  // fine paper grain and soft blots printed into the colour (only where the figure is), made once
  let GRAIN = null;
  const grain = () => {
    if (GRAIN) return GRAIN;
    const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), im = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fine = hash(x, y, 11), blot = (vnoise(x / 40, y / 40, 7) + 1) / 2, a = clamp(fine * 0.55 + blot * 0.5 - 0.35, 0, 1);
      const k = (y * n + x) * 4; im.data[k] = 70; im.data[k + 1] = 58; im.data[k + 2] = 40; im.data[k + 3] = Math.round(a * 58);
    }
    g.putImageData(im, 0, 0); GRAIN = c; return c;
  };

  /** figure({ size: [W, D, H], box: [x, y, w, h], at, dur=1.1, wobble=1, ink=1, fill=0.9 }, (D, lt) => { … }) → F: the figure. size is the
   *  object's true bounding box in model units (x depth, y width, z height; ~1 unit per cm), including what sticks out or moves (a lifted
   *  lid, an open door, the board); the model is fitted into box (default [380, 150, 1260, 740], page px) and the frame stays put. Every
   *  frame it calls draw(D, lt): D's methods draw at once, back to front in call order. The whole figure inks itself in at `at` over
   *  `dur` s (lines first, then colour); wrap later parts in D.part(at, …) so each arrives on the word that names it.
   *  F.pt(x, y, z) → [px, py] page point of a model point (for P.push, P.stat, P.note). Two figures side by side: two boxes. */
  B.figure = function (o = {}, draw) {
    if (typeof o === 'function') { draw = o; o = {}; }
    const self = this, box = o.box ?? [STAGE.area.x0 + 240, STAGE.area.y0 - 30, STAGE.area.x1 - STAGE.area.x0 - 380, STAGE.area.y1 - STAGE.area.y0 + 40], [W, Dd, Hh] = o.size ?? [60, 60, 60], at0 = o.at ?? 0;
    const cs = []; for (const x of [0, W]) for (const y of [0, Dd]) for (const z of [0, Hh]) cs.push([(x - y) * C30, (x + y) * S30 - z]);
    const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs) || 1, bh = Math.max(...ys) - Math.min(...ys) || 1;
    const sc = o.scale ?? Math.min(box[2] / bw, box[3] / bh) * (o.fill ?? 0.96);
    const ox = box[0] + box[2] / 2 - (Math.min(...xs) + Math.max(...xs)) / 2 * sc;
    const oy = box[1] + box[3] / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 * sc - box[3] * 0.03;
    const pt = (x, y, z = 0) => [ox + (x - y) * C30 * sc, oy + ((x + y) * S30 - z) * sc];
    const dv = (x, y, z) => [(x - y) * C30 * sc, ((x + y) * S30 - z) * sc];
    const frameW = bw * sc / 0.74, INKPX = 1.9 * (o.ink ?? 1);
    const AMP = 2.6 * (o.wobble ?? 1), WL = 46;
    const wob = (p) => (AMP ? [p[0] + AMP * (vnoise(p[0] / WL, p[1] / WL, 1) + 0.5 * vnoise(p[0] / WL * 2.1, p[1] / WL * 2.1, 3)) / 1.5, p[1] + AMP * (vnoise(p[0] / WL, p[1] / WL, 2) + 0.5 * vnoise(p[0] / WL * 2.1, p[1] / WL * 2.1, 4)) / 1.5] : p);

    // drawn on a stage-sized sheet, shown on a canvas cut to what was drawn (so the page knows how much the figure covers)
    const canvas = h('canvas', null, null, self.html);
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none' });
    const work = document.createElement('canvas'); work.width = SW; work.height = SH0;
    const ctx = work.getContext('2d'), out = canvas.getContext('2d');
    let bb = null;
    const grow = (sp, pad) => { if (!bb) bb = [1e9, 1e9, -1e9, -1e9]; for (const [x, y] of sp) { if (x - pad < bb[0]) bb[0] = x - pad; if (y - pad < bb[1]) bb[1] = y - pad; if (x + pad > bb[2]) bb[2] = x + pad; if (y + pad > bb[3]) bb[3] = y + pad; } };

    // the reveal state of the part being drawn: k (0→1 arrival), a (alpha), dy (a drop), mode
    let R = { k: 1, a: 1, dy: 0, mode: 'ink' }, LT = 0, late = [], lastBoard = null;
    const fillA = () => R.a * (R.mode === 'ink' ? clamp((R.k - 0.3) / 0.6) : R.mode === 'drop' ? clamp(R.k * 2) : R.k);
    const inkA = () => R.a * (R.mode === 'ink' ? 1 : R.mode === 'drop' ? clamp(R.k * 2) : R.k);
    // a 3D polyline → screen points, cut into short pieces and moved by the hand
    const scr2 = (pts2, close) => {
      const out = [], n = pts2.length, m = close ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = pts2[i], b = pts2[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), s = Math.max(1, Math.ceil(len / 9));
        for (let j = 0; j < s; j++) { const q = wob([lerp(a[0], b[0], j / s), lerp(a[1], b[1], j / s)]); out.push([q[0], q[1] + R.dy]); }
      }
      if (!close && n) { const q = wob(pts2[n - 1]); out.push([q[0], q[1] + R.dy]); }
      return out;
    };
    const scr = (pts3, close = true) => scr2(pts3.map((p) => pt(p[0], p[1], p[2])), close);
    const trace = (sp, close) => { grow(sp, 12); ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]); if (close) ctx.closePath(); };
    const plen = (sp, close) => { let s = 0; for (let i = 1; i < sp.length; i++) s += Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]); if (close && sp.length > 1) s += Math.hypot(sp[0][0] - sp[sp.length - 1][0], sp[0][1] - sp[sp.length - 1][1]); return s; };
    const fillSp = (sp, c, op = 1, seam = true) => {
      const a = fillA() * op; if (a <= 0.001 || sp.length < 3) return;
      ctx.globalAlpha = a; trace(sp, true); ctx.fillStyle = c; ctx.fill();
      if (seam) { ctx.strokeStyle = c; ctx.lineWidth = 1.1; ctx.lineJoin = 'round'; ctx.stroke(); }
    };
    const inkSp = (sp, w, close, c = INK) => {
      const a = inkA(); if (a <= 0.001 || sp.length < 2 || w <= 0) return;
      ctx.globalAlpha = a; trace(sp, close);
      ctx.strokeStyle = c; ctx.lineWidth = w * INKPX; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (R.mode === 'ink' && R.k < 1) { const l = plen(sp, close); ctx.setLineDash([l * ease.inOut(R.k / 0.75 > 1 ? 1 : R.k / 0.75), l + 2]); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    const hullW = (h2, w) => { let a = 0, per = 0; for (let i = 0; i < h2.length; i++) { const p = h2[i], q = h2[(i + 1) % h2.length]; a += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); } const thick = per ? Math.abs(a) / per / frameW : 0; return Math.min(w, 0.9 + 20 * thick); };
    const loftDraw = (A, Bq, colour, flip) => {
      const n = A.length, cen = avg(A.concat(Bq));
      for (let i = 0; i < n; i++) {
        const a0 = A[i], a1 = A[(i + 1) % n], b1 = Bq[(i + 1) % n], b0 = Bq[i];
        let nr = norm(cross(sub(a1, a0), sub(b0, a0)));
        if (!isFinite(nr[0]) || (nr[0] === 0 && nr[1] === 0 && nr[2] === 0)) continue;
        if (dot(nr, sub(avg([a0, a1, b1, b0]), cen)) < 0) nr = nr.map((v) => -v);
        if (flip) nr = nr.map((v) => -v);
        if (vis(nr)) fillSp(scr([a0, a1, b1, b0]), colour(nr));
      }
    };
    const shadeOf = (o2) => (o2 && o2.shade === 'sun' ? tone : toneI);

    /** D.rr(u0, v0, u1, v1, r): a rounded rectangle profile in a plane's (u, v); D.rect(u0, v0, u1, v1), D.ell(cu, cv, ru, rv, n=24) an
     *  ellipse, D.arc(cu, cv, r, deg0, deg1, n=7). Map one to 3D with D.on(plane, uv) */
    /** D.on(plane, uv): points of a profile placed on a plane: D.PX(x) the front-facing plane x = const (u = y, v = z), D.PY(y) a side
     *  plane (u = x, v = z), D.PZ(z) a level plane (u = x, v = y). A ring at height z: D.on(D.PZ(z), D.ell(x, y, r, r)) */
    /** D.mat(name | hex): a material { l, m, d } (mustard tomato mint cobalt blush metal clear ceramic dark rubber board wood, or any hex);
     *  D.tone(normal, material) the face colour of your own polygon in the sun, D.toneI(normal, material) for small parts and insides;
     *  D.pt(x, y, z) the page point; D.lt the page time */
    const D = {
      pt, PX, PY, PZ, on, rr: rrUV, rect: rectUV, ell: ellUV, arc: arcUV, smooth: smooth3, mat, mix, tone, toneI, INK, SHADOW, ACCENT,
      get lt() { return LT; },
      /** D.k(at, dur=0.6, e='inOut') → 0…1: eased progress from at (a door's angle, a level, a lever's travel). Use it for every move */
      k: (at, dur = 0.6, e = 'inOut') => (ease[e] || ease.inOut)(clamp((LT - at) / dur)),
      /** D.part(at, fn, { dur=0.7, from='ink' | 'drop' | 'fade', out }): what fn (a function that draws) draws arrives at `at`: 'ink' draws its
       *  lines on and then floods in the colour (a part being named), 'drop' lowers it into place from above (something put in: a cup, a coin,
       *  a slice of bread), 'fade' fades it. out: it fades away at that time (taken out, used up). Nest freely. */
      part(at, fn, o2 = {}) {
        const dur = o2.dur ?? 0.7, k = clamp((LT - at) / dur), ko = o2.out == null ? 1 : 1 - clamp((LT - o2.out) / 0.4);
        if (k <= 0 || ko <= 0) return;
        const prev = R, mode = o2.from || 'ink';
        R = { k: Math.min(prev.k, k), a: prev.a * ko, dy: prev.dy + (mode === 'drop' ? -(1 - ease.out(k)) * 80 : 0), mode };
        try { fn(); } finally { R = prev; }
      },
      /** D.shape(pts3, colour, w=0.9): a flat polygon with an ink edge (a panel, a label plate, a slot, a screen). colour: a hex, a palette
       *  name, or D.tone(normal, material) for a face that turns away from the light. w 0 = no edge */
      shape(pts3, c, w = 0.9) { const sp = scr(pts3, true); fillSp(sp, paint(c)); if (w) inkSp(sp, w, true); },
      /** D.fill(pts3, colour, opacity=1): a polygon with no edge (water, a tint, a highlight, a glow of light on the board) */
      fill(pts3, c, op = 1) { fillSp(scr(pts3, true), paint(c), op, op >= 1); },
      /** D.line(pts3, w=0.9, colour=ink): an open ink line through 3D points (a rim arc, a seam, a crease, a vent slit) */
      line(pts3, w = 0.9, c = INK) { inkSp(scr(pts3, false), w, false, paint(c)); },
      /** D.ink(pts3, w=1): a closed ink outline (an opening, the edge of a cap) */
      ink(pts3, w = 1) { inkSp(scr(pts3, true), w, true); },
      /** D.hullInk(pts3, w=2.8): the silhouette: one heavy ink line round the outline of these points. Draw it after the part it outlines,
       *  once per part (a pot and its saucer get one each). Thin parts are inked lighter automatically */
      hullInk(pts3, w = 2.8) { const h2 = hull(pts3.map((p) => pt(p[0], p[1], p[2]))); if (h2.length < 3) return; inkSp(scr2(h2, true), hullW(h2, w), true); },
      /** D.box(x0, y0, z0, x1, y1, z1, material, { w=0.9, shade }): an axis-aligned block, its three visible faces shaded and edged (a
       *  button, a vent cover, a tray, a slice of bread, a coin slot's bezel). shade: 'sun' for the outside of a big body */
      box(x0, y0, z0, x1, y1, z1, m, o2 = {}) {
        const sh = shadeOf(o2), w = o2.w ?? 0.9;
        const F = [[[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]], [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]], [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]]];
        for (const [n, q] of F) D.shape(q, o2.top && n[2] === 1 ? o2.top : sh(n, m), w);
      },
      /** D.loft(ringA, ringB, material, { flip, shade }): the surface between two rings of the same length (a cup's wall, a cone, a bottle's
       *  shoulder, a dome). Rings come from D.on(D.PZ(z), D.ell(x, y, r, r)). flip: seen from inside (the inner wall of a drum or a bowl) */
      loft(A, Bq, m, o2 = {}) { const sh = shadeOf(o2); loftDraw(A, Bq, (n) => sh(n, m), o2.flip); },
      /** D.extrude(profile, x0, x1, material, { cap=true, ink=2.8, shade='sun' }): the body of most machines: a (y, z) profile (usually
       *  D.rr(y0, z0, y1, z1, radius)) swept along x from the back x0 to the front x1, banded on its rounded edges, with its front cap and
       *  silhouette ink. Convex profiles only: split an L or a C into pieces */
      extrude(prof, x0, x1, m, o2 = {}) {
        const A = on(PX(x0), prof), Bq = on(PX(x1), prof), sh = o2.shade === 'inside' ? toneI : tone;
        loftDraw(A, Bq, (n) => sh(n, m), false);
        if (o2.cap !== false) D.shape(Bq, mat(m).l, 2.2);
        if (o2.ink !== 0) D.hullInk([...A, ...Bq], o2.ink ?? 2.8);
      },
      /** D.cyl(x, y, z0, z1, r, material, { w=1.2, top, n=28 }): an upright cylinder with its top (a kettle's body, a cup, a knob seen from
       *  above, a jar, a lamp base). top: the top's colour (a liquid, an open hole: false = no top) */
      cyl(x, y, z0, z1, r, m, o2 = {}) {
        const n = o2.n ?? 28, A = on(PZ(z0), ellUV(x, y, r, r, n)), Bq = on(PZ(z1), ellUV(x, y, r, r, n)), sh = shadeOf(o2), w = o2.w ?? 1.2;
        loftDraw(A, Bq, (nn) => sh(nn, m), false);
        if (o2.top !== false) { fillSp(scr(Bq), o2.top ? paint(o2.top) : sh([0, 0, 1], m)); }
        D.hullInk([...A, ...Bq], w); inkSp(scr(Bq), w * 0.8, true);
      },
      /** D.cylX(x0, x1, y, z, r, material, { w=1.1 }): a cylinder lying along x, out of the front face (a dial, a knob, a porthole ring,
       *  a lens, a spout seen end on), its front cap toward the viewer */
      cylX(x0, x1, y, z, r, m, o2 = {}) {
        const n = o2.n ?? 22, A = on(PX(x0), ellUV(y, z, r, r, n)), Bq = on(PX(x1), ellUV(y, z, r, r, n)), sh = shadeOf(o2), w = o2.w ?? 1.1;
        loftDraw(A, Bq, (nn) => sh(nn, m), false);
        fillSp(scr(Bq), o2.cap ? paint(o2.cap) : sh([1, 0, 0], m)); D.hullInk([...A, ...Bq], w); inkSp(scr(Bq), w * 0.8, true);
      },
      /** D.rod(a, b, r, material, { r1, w=1 }): a cylinder between any two 3D points at any angle (a lamp arm, a handle bar, a spout, a
       *  lever, a crank, a pipe). r1: the radius at b, for a cone or a tapered spout */
      rod(a, b, r, m, o2 = {}) {
        const n = 16, r1 = o2.r1 ?? r, d = norm(sub(b, a)), u = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(d, u);
        const ring = (p, rr) => Array.from({ length: n }, (_, i) => { const t = i / n * TAU, c = Math.cos(t) * rr, s = Math.sin(t) * rr; return [p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s]; });
        const A = ring(a, r), Bq = ring(b, r1), sh = shadeOf(o2), capB = vis(d), cap = capB ? Bq : A, cn = capB ? d : d.map((x) => -x), w = o2.w ?? 1;
        loftDraw(A, Bq, (nn) => sh(nn, m), false);
        if (Math.max(r, r1) > 0) { const sp = scr(cap); fillSp(sp, mat(m).m); inkSp(sp, w * 0.8, true); }
        D.hullInk([...A, ...Bq], w);
      },
      /** D.ball(c, r, material, { w=1.2 }): a sphere at the 3D point c (a gumball, a knob, a dome light, a float, a bubble); sort a heap
       *  of them with D.sort */
      ball(c, r, m, o2 = {}) {
        const M = mat(m), [X, Y] = pt(c[0], c[1], c[2]), R0 = r * 1.2247 * sc, ring = (cx, cy, rr) => Array.from({ length: 30 }, (_, i) => [cx + rr * Math.cos(i / 30 * TAU), cy + rr * Math.sin(i / 30 * TAU)]);
        const outer = scr2(ring(X, Y, R0), true);
        fillSp(outer, M.m);
        ctx.save(); trace(outer, true); ctx.clip(); fillSp(scr2(ring(X - R0 * 0.2, Y - R0 * 0.24, R0 * 0.86), true), M.l, 1, false); fillSp(scr2(ring(X - R0 * 0.38, Y - R0 * 0.42, R0 * 0.18), true), '#ffffff', 0.7, false); ctx.restore();
        inkSp(outer, o2.w ?? 1.2, true);
      },
      /** D.board(x0, y0, x1, y1, h=3, r=5, material='board'): the slab the object stands on (a tray, a counter top, a desk): draw it first,
       *  only a little bigger than what stands on it; everything else stands on z = h. 'wood' for a desk or a chopping board */
      board(x0, y0, x1, y1, hh = 3, r = 5, m = 'board') {
        const M = mat(m), A = on(PZ(0), rrUV(x0, y0, x1, y1, r)), Bq = on(PZ(hh), rrUV(x0, y0, x1, y1, r));
        loftDraw(A, Bq, (n) => toneI(n, M), false); const sp = scr(Bq); fillSp(sp, M.l); inkSp(sp, 1, true); D.hullInk([...A, ...Bq], 1.8);
        lastBoard = { top: Bq, h: hh };
      },
      /** D.boardTop(x0, y0, x1, y1, h=3, r=5): the board's top outline, for D.shadow's clip */
      boardTop: (x0, y0, x1, y1, hh = 3, r = 5) => on(PZ(hh), rrUV(x0, y0, x1, y1, r)),
      /** D.shadow(pts3, z0=0, clip, op=1): the one flat blue cast shadow of a part: pass its outline points at the bottom and the top; z0 = the
       *  surface it falls on; on the board (z0 = its h) it stops at the board's edge by itself. Draw shadows right after the board, before any body.
       *  It must touch the part's foot: include the foot points. A part lifted in the air: wrap in D.part(…, { from: 'fade' }) at half opacity */
      shadow(pts3, z0 = 0, clip = null, op = 1) {
        if (!clip && lastBoard && Math.abs(z0 - lastBoard.h) < 0.01) clip = lastBoard.top;   // a shadow on the board stops at its edge
        const k = SHADOW_LEN / SHK, h2 = hull(pts3.map(([x, y, z]) => pt(x + (z - z0) * SH[0] * k, y + (z - z0) * SH[1] * k, z0)));
        if (h2.length < 3) return;
        if (clip) { ctx.save(); trace(scr(clip), true); ctx.clip(); }
        fillSp(scr2(h2, true), SHADOW, op, false);
        if (clip) ctx.restore();
      },
      /** D.clip(pts3, fn): fn draws only inside a 3D outline: what is seen through an opening (the drum behind a porthole, the bread in
       *  a toaster slot, the coils behind a grille, water in a glass). Inside, draw back wall → floor and sides → contents */
      clip(pts3, fn) { ctx.save(); trace(scr(pts3), true); ctx.clip(); try { fn(); } finally { ctx.restore(); } },
      /** D.glass(pts3, { tint='#cfe9f0', op=0.35, streaks=2 }): a pane of glass over what was drawn behind it: a light tint and white
       *  streaks (a window, a kettle's gauge, a jar). Keep it light: heavy glass greys out a liquid */
      glass(pts3, o2 = {}) {
        const sp = scr(pts3, true); fillSp(sp, paint(o2.tint ?? '#cfe9f0'), o2.op ?? 0.35, false);
        const xs2 = sp.map((p) => p[0]), ys2 = sp.map((p) => p[1]), x0 = Math.min(...xs2), x1 = Math.max(...xs2), y0 = Math.min(...ys2), y1 = Math.max(...ys2), wv = x1 - x0, hv = y1 - y0;
        ctx.save(); trace(sp, true); ctx.clip();
        for (let i = 0; i < (o2.streaks ?? 2); i++) { const s0 = x0 + wv * (0.12 + i * 0.2), sw = wv * (i ? 0.05 : 0.11); fillSp([[s0, y1], [s0 + sw, y1], [s0 + sw + hv * 0.55, y0], [s0 + hv * 0.55, y0]], '#ffffff', 0.38, false); }
        ctx.restore(); inkSp(sp, o2.w ?? 1.4, true);
      },
      /** D.text(x, y, z, str, size, { face='x' | 'y' | 'z', color=ink, weight=700 }): words printed on a face (a brand on the front, a scale
       *  on a dial, a sign on the side), size in model units (≥ 2), centred on the point. face 'x' = the front, 'y' = the left side */
      text(x, y, z, str, size, o2 = {}) {
        const a = fillA(); if (a <= 0.01) return;
        const [X, Y] = pt(x, y, z), f = o2.face ?? 'x', U = f === 'y' ? dv(1, 0, 0) : dv(0, -1, 0), V = f === 'z' ? dv(1, 0, 0) : dv(0, 0, -1);
        ctx.save(); ctx.globalAlpha = a; ctx.transform(U[0] / sc, U[1] / sc, V[0] / sc, V[1] / sc, X, Y + R.dy);
        ctx.font = `${o2.weight ?? 700} ${size * sc}px ${MONO}`; ctx.fillStyle = paint(o2.color || INK); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(str), 0, 0); ctx.restore(); grow([[X, Y]], size * sc * String(str).length * 0.4);
      },
      /** D.tag(p3, dx, dy, text, on): the part label: a cream pill on a leader line from the 3D point p3 to (dx, dy) page px away. on: when
       *  the part is working its pill turns mustard (true, a time it turns on from, or [from, until]). Short, capitals in English; 2–4
       *  characters in Chinese. Aim pills outward into empty paper; at most 5 on screen; never over moving parts */
      tag(p3, dx, dy, text, onAt = false) {
        const [X, Y] = pt(p3[0], p3[1], p3[2]), r0 = { ...R }, k = R.mode === 'ink' ? R.k : 1;
        const lit = onAt === true ? 1 : typeof onAt === 'number' ? D.k(onAt, 0.25) : Array.isArray(onAt) ? D.k(onAt[0], 0.25) * (1 - D.k(onAt[1], 0.25)) : 0;
        late.push(() => {
          const prev = R; R = { ...r0, mode: 'fade', k: 1 };
          const lk = ease.out(clamp(k / 0.45)), ex = X + dx * lk, ey = Y + dy * lk;
          inkSp(scr2([[X, Y], [ex, ey]], false), 1.05, false);
          fillSp(scr2(Array.from({ length: 12 }, (_, i) => [X + 4.5 * Math.cos(i / 12 * TAU), Y + 4.5 * Math.sin(i / 12 * TAU)]), true), INK);
          const pk = ease.back(clamp((k - 0.35) / 0.5)); if (pk > 0.01) {
            const fs = 28, cjk = /[\u3400-\u9fff]/.test(text);
            ctx.font = `800 ${fs}px ${MONO}`; const tw = ctx.measureText(text).width, ww = (tw + fs * 1.5) * pk, hh = fs * 1.8 * pk, cx = X + dx, cy = Y + dy;
            const pill = rrUV(cx - ww / 2, cy - hh / 2, cx + ww / 2, cy + hh / 2, hh / 2, 6);
            const sp = scr2(pill, true); fillSp(sp, mix(CREAM, ACCENT, lit)); inkSp(sp, 1.25, true);
            ctx.globalAlpha = R.a * clamp(pk * 2); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `800 ${fs * pk}px ${MONO}`; if (!cjk && ctx.letterSpacing !== undefined) ctx.letterSpacing = '1px';
            grow([[cx - ww / 2, cy - hh / 2], [cx + ww / 2, cy + hh / 2]], 6); ctx.fillText(text, cx, cy + 1); if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
          }
          R = prev;
        });
      },
      /** D.tube(pts3, r, material, { rib }): a soft cable or hose through 3D points, smoothed (a power cord, a washer's drain hose, a
       *  vacuum's tube). rib: a ribbed hose */
      tube(pts3, r, m, o2 = {}) {
        const M = mat(m), q = smooth3(pts3), sp = scr(q, false), a = fillA(); if (a <= 0.01) return;
        ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        trace(sp, false); ctx.strokeStyle = INK; ctx.lineWidth = 2 * r * sc + 2.4 * INKPX; ctx.stroke();
        ctx.strokeStyle = M.m; ctx.lineWidth = 2 * r * sc; ctx.stroke();
        if (o2.rib) { ctx.strokeStyle = M.d; ctx.globalAlpha = a * 0.55; ctx.setLineDash([0.45 * sc, 1.1 * sc]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = a; }
        trace(sp.map(([x, y]) => [x - r * sc * 0.35, y - r * sc * 0.35]), false); ctx.strokeStyle = M.l; ctx.lineWidth = r * sc * 0.55; ctx.globalAlpha = a * 0.85; ctx.stroke();
      },
      /** D.stream(a, b, { color='#4f9fdc', w=1.2, dash, speed=40, op=0.9 }): something pouring from the 3D point a to b: water from a
       *  spout, beans from a hopper, powder from a box (dash: true), steam rising (b above a). w in model units. Split it at a rim: the part
       *  inside a container goes in that container's D.clip */
      stream(a, b, o2 = {}) {
        const al = fillA() * (o2.op ?? 0.9); if (al <= 0.01) return;
        const sp = scr([a, b], false); ctx.globalAlpha = al; trace(sp, false); ctx.strokeStyle = paint(o2.color || '#4f9fdc'); ctx.lineWidth = (o2.w ?? 1.2) * sc; ctx.lineCap = 'round';
        if (o2.dash) { ctx.setLineDash([0.9 * (o2.w ?? 1.2) * sc, 0.8 * (o2.w ?? 1.2) * sc]); ctx.lineDashOffset = -LT * (o2.speed ?? 40); }
        ctx.stroke(); ctx.setLineDash([]);
        if (!o2.dash) { trace(sp.map(([x, y]) => [x - (o2.w ?? 1.2) * sc * 0.2, y]), false); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = al * 0.45; ctx.lineWidth = (o2.w ?? 1.2) * sc * 0.25; ctx.stroke(); }
      },
      /** D.lamp(p3, on, { color='green' | 'red' | hex, r=1.4 }): a status light on a face: a small dark dot that lights green (ready, done)
       *  or red (heating, stop). on: true, a time, or [from, until] like D.tag */
      lamp(p3, onAt, o2 = {}) {
        const lit = onAt === true ? 1 : typeof onAt === 'number' ? D.k(onAt, 0.2) : Array.isArray(onAt) ? D.k(onAt[0], 0.2) * (1 - D.k(onAt[1], 0.2)) : 0;
        const c = o2.color === 'red' ? '#e2483d' : o2.color === 'green' || !o2.color ? '#43c25c' : o2.color;
        const [X, Y] = pt(p3[0], p3[1], p3[2]), rr = (o2.r ?? 1.4) * sc, sp = scr2(Array.from({ length: 16 }, (_, i) => [X + rr * Math.cos(i / 16 * TAU), Y + rr * 0.8 * Math.sin(i / 16 * TAU)]), true);
        fillSp(sp, mix('#3a3632', c, lit)); inkSp(sp, 0.8, true);
        if (lit > 0.05) fillSp(scr2(Array.from({ length: 10 }, (_, i) => [X - rr * 0.3 + rr * 0.28 * Math.cos(i / 10 * TAU), Y - rr * 0.3 + rr * 0.22 * Math.sin(i / 10 * TAU)]), true), '#ffffff', 0.7 * lit, false);
      },
      /** D.sort(list): list = [{ at: [x, y, z], draw: fn }, …]; draws several things back to front by x + y + z (a row of buttons, gumballs, cups
       *  in a set, clothes in a drum): nearer things cover farther ones */
      sort(list) { list.filter(Boolean).sort((p, q) => (p.at[0] + p.at[1] + p.at[2]) - (q.at[0] + q.at[1] + q.at[2])).forEach((p) => p.draw()); },
    };

    self.tick((lt) => {
      LT = lt; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, SW, SH0); bb = null;
      if (lt < at0) { canvas.width = canvas.height = 0; return; }
      const k = clamp((lt - at0) / (o.dur ?? 1.1));
      R = { k, a: 1, dy: 0, mode: 'ink' }; late = []; lastBoard = null;
      try { draw(D, lt); } finally { R = { k: 1, a: 1, dy: 0, mode: 'ink' }; }
      // grain and blots printed into the colour, then the labels on top
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-atop';
      if (bb) { ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); }
      ctx.globalCompositeOperation = 'source-over';
      for (const f of late) f();
      ctx.globalAlpha = 1;
      // show what was drawn
      if (!bb) { canvas.width = canvas.height = 0; return; }
      const x0 = Math.max(0, Math.floor(bb[0] / 8) * 8), y0 = Math.max(0, Math.floor(bb[1] / 8) * 8), x1 = Math.min(SW, Math.ceil(bb[2] / 8) * 8), y1 = Math.min(SH0, Math.ceil(bb[3] / 8) * 8);
      if (x1 <= x0 || y1 <= y0) { canvas.width = canvas.height = 0; return; }
      if (canvas.width !== x1 - x0 || canvas.height !== y1 - y0) { canvas.width = x1 - x0; canvas.height = y1 - y0; } else out.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.left = x0 + 'px'; canvas.style.top = y0 + 'px';
      out.drawImage(work, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    });
    return { pt, sc, D, canvas };
  };

  // ── the figure's controls ─────────────────────────────
  const strip = (s) => String(s).replace(/[{}*`]|\b[rbgopmsk]:/g, '');
  /** steps(labels, { at, press: [t…], x=140, y=200, dir='col' | 'row', size=26, current=true }): the figure's buttons, one pill per real step
   *  of the process in the order a person does them ('Fill', 'Switch on', 'Boil', 'Click off'). Each pill is pressed at its time in `press`
   *  (put it on the word: P.cw(i, 'press')): it sinks into its shadow, lights mustard while that step runs, and dims when the next one is
   *  pressed. A left column under the title by default; dir 'row' runs them along the top */
  B.steps = function (labels, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.3, press = o.press || [], size = o.size ?? 26;
    const wrap = h('div', 'tx cf-steps' + (o.dir === 'row' ? ' row' : ''), null, T.html);
    Object.assign(wrap.style, { left: (o.x ?? STAGE.area.x0) + 'px', top: (o.y ?? STAGE.area.y0 + 20) + 'px', fontSize: size + 'px' });
    const els = labels.map((t) => { const e = h('div', 'cf-step', null, wrap); e.textContent = strip(t); return e; });
    T.tick((lt) => {
      els.forEach((e, i) => {
        const k = ease.out(clamp((lt - at - i * 0.12) / 0.4)), p = press[i];
        let sink = 0, lit = 0, dim = 0;
        if (p != null && lt >= p) {
          sink = 1 - clamp((lt - p - 0.12) / 0.2);
          const next = press.slice(i + 1).find((v) => v != null);
          lit = clamp((lt - p) / 0.15) * (o.current === false ? 0 : 1); if (next != null && lt >= next) { lit *= 1 - clamp((lt - next) / 0.25); dim = clamp((lt - next) / 0.25); }
        }
        const sx = 3 * (1 - sink);
        e.style.opacity = (k * (1 - dim * 0.5)).toFixed(3);
        e.style.transform = `translate(${(3 - sx).toFixed(2)}px, ${((3 - sx) + (1 - k) * 10).toFixed(2)}px)`;
        e.style.boxShadow = `${sx.toFixed(2)}px ${sx.toFixed(2)}px 0 #231e16`;
        e.style.background = mix('#fbf8f0', ACCENT, lit);
      });
    });
    return { el: wrap, steps: els };
  };
  /** stat(x, y, label, lt => value, { fmt, unit, at, out, size=86, align='r' }): a big reading in the corner (litres, °C, credit, seconds
   *  left): a small capital label over a heavy mono number that bumps each time it changes. Usually top right (x 1780, y 200). The number
   *  must be the same variable that moves the drawing */
  B.stat = function (x, y, label, fn, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.3, size = o.size ?? 86, fmt = o.fmt || ((v) => String(Math.round(v)));
    const el = h('div', 'tx cf-stat', null, T.html);
    el.innerHTML = `<div class="k">${strip(label)}</div><div class="v"></div>`;
    const v = el.lastChild; v.style.fontSize = size + 'px';
    T.tick((lt) => {
      const txt = fmt(fn(lt)) + (o.unit ? `<small>${o.unit}</small>` : '');
      if (v._t !== txt) { v._t = txt; v.innerHTML = txt; }
      let since = 1; const cur = fmt(fn(lt)); for (let d = 0.03; d <= 0.36; d += 0.03) if (fmt(fn(lt - d)) !== cur) { since = (d - 0.03) / 0.35; break; }
      const bump = since < 1 ? 1 + 0.16 * (1 - ease.out(since)) : 1;
      const k = ease.out(clamp((lt - at) / 0.4)) * (o.out == null ? 1 : 1 - clamp((lt - o.out) / 0.3));
      el.style.opacity = k.toFixed(3);
      const w = el.offsetWidth; el.style.left = (o.align === 'l' ? x : x - w) + 'px'; el.style.top = y + 'px';
      v.style.transform = `scale(${bump.toFixed(3)})`;
    });
    return el;
  };
  /** note(x, y, text, { at, out, size=24 }): the toast: a short note in a paper card with a hard ink shadow, for what the machine
   *  says back ('the tank is empty — fill it first', 'click: it switched itself off'). One at a time, a few words */
  B.note = function (x, y, text, o = {}) {
    const T = this.hud || this, at = o.at ?? 0;
    const el = h('div', 'cf-note', null, T.html); el.textContent = strip(text);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', fontSize: (o.size ?? 26) + 'px' });
    T.tick((lt) => { const k = ease.out(clamp((lt - at) / 0.25)) * (o.out == null ? 1 : 1 - clamp((lt - o.out) / 0.25)); el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 8).toFixed(1)}px)`; });
    return el;
  };
  // this style's page title: a small tomato dot and the title in heavy mono, typed in rather than handwritten
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1, s = strip(str);
    const el = h('div', 'cf-title', null, T.html);
    el.innerHTML = `<i></i><span></span>`; const sp = el.lastChild;
    el.style.fontSize = (o.size ?? 46) + 'px';
    T.tick((lt) => { const n = Math.round(clamp((lt - at) / Math.max(0.35, s.length * 0.035)) * s.length); if (sp._n !== n) { sp._n = n; sp.textContent = s.slice(0, n); } el.style.opacity = lt >= at ? '1' : '0'; });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // text is typed in mono rather than handwritten, unless a page asks for another mode
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.4, font: 'mono' }, o, { pen: false })); };

  PV.INKED = { MATS, mat, matOf, mix, tone, toneI, PX, PY, PZ, on, rrUV, rectUV, ellUV, arcUV, smooth3, hull };
})();
