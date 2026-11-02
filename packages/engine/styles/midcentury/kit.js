/* Mid-century cartoon kit (1950s classroom film / UPA limited animation): every fill is a separate colour "cel" printed
 * a few px off its thin, broken ink line, and the offset re-rolls on twos, so the picture shimmers like hand-registered
 * paint; geometric presenters whose bodies hold still while arms, eyes and mouth move; sunbursts, starbursts, atomic
 * sparkles, boomerangs; numbered step cards that slam in, round call-outs, curved manual arrows, detail tags.
 * Every component is a pure function of page time lt. Any option marked "fn" may be a value, a function of lt, or a
 * keyframe list [[t0, v0], [t1, v1], …] (the last entry whose time has passed wins).
 * Techniques adapted from Lemo-Opuscar's midcentury-toon style (MIT, © 2026 LemoLab): the off-register colour cel with
 * its jitter on twos, the pressure ink ribbon with breaks, the dry-brush tooth, the two-plate lettering, the manual arrow
 * and the ornaments (sparkle, starburst, rays, boomerang, kidney). Re-implemented for this engine; see NOTICE.md. */
(function () {
  const { col, clamp, lerp, h, Builder } = PV;
  const ease = Object.assign({}, PV.ease, { in: (x) => x * x * x });
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, TAU = Math.PI * 2;
  /** limited animation: 12 drawings a second */
  const step = (lt) => Math.floor(lt * 12 + 1e-6) / 12;
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'number' && v[0].length === 2 && !Array.isArray(v[0][1]);
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  /** the key active at lt and the one before it, with the time it started */
  const keyAt = (v, lt, d) => {
    if (!isKeys(v)) { const x = val(v, lt, d); return { cur: x, prev: x, since: 1e9 }; }
    let cur = v[0][1], prev = v[0][1], t0 = -1e9;
    for (const [t, x] of v) if (lt >= t) { if (x !== cur) { prev = cur; t0 = t; } cur = x; }
    return { cur, prev, since: lt - t0 };
  };
  const hash = (a, b = 0, c = 0) => { const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return n - Math.floor(n); };
  const n1 = (x, seed) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i, seed, 3), hash(i + 1, seed, 3), u); };
  const INK = () => col('ink');
  const SKIN = '#F2C7A0', SKIN_D = '#DDA37C', HAIR = '#3A2621', NAVY = '#3B4766';

  // ── colour helpers ──
  const hex = (c) => { const s = col(c) || c; if (typeof s === 'string' && s.startsWith('rgb')) return s.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number); if (typeof s !== 'string' || s[0] !== '#') return [200, 190, 170]; const v = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  const rgb = (a) => `rgb(${a.map((x) => Math.round(clamp(x, 0, 255))).join(',')})`;
  /** mix two colours (names or hex), k = 0 → a, 1 → b */
  const mix = (a, b, k) => { const A = hex(a), Bc = hex(b); return rgb(A.map((x, i) => lerp(x, Bc[i], k))); };
  const shade = (c, k = 0.18) => mix(c, '#2B2420', k);
  const tint = (c, k = 0.4) => mix(c, '#F6EDDA', k);
  const C = (c) => (c == null ? null : (col(c) || c));

  // ── the register: the colour cel sits (5, 4) px off its ink line, re-rolled ±1.5 px on twos ──
  const reg = (lt, seed = 0, k = 1) => { const f = Math.floor(lt * 12 + 1e-6); return [(5 + (hash(f, seed, 1) - 0.5) * 3) * k, (4 + (hash(f, seed, 2) - 0.5) * 3) * k]; };

  // ── geometry ──
  const ellP = (cx, cy, rx, ry, n = 40, a0 = 0, a1 = TAU, rot = 0) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; o.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); } return o; };
  const rrP = (x, y, w, hh, r, n = 5) => { r = Math.min(r, w / 2, hh / 2); const o = []; for (const [cx, cy, a0] of [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + hh - r, 0], [x + r, y + hh - r, Math.PI / 2], [x + r, y + r, Math.PI]]) for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  const spline = (pts, closed = true, n = 8) => {
    const o = [], N = pts.length, g = (i) => (closed ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
    for (let i = 0; i < (closed ? N : N - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; o.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
    }
    if (!closed) o.push(pts[N - 1]);
    return o;
  };
  const starP = (cx, cy, r, n = 8, inner = 0.45, rot = 0) => { const o = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n - Math.PI / 2, rr = i % 2 ? r * inner : r; o.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return o; };
  const xf = (pts, ox, oy, a = 0, s = 1, sy = s) => { const c = Math.cos(a), si = Math.sin(a); return pts.map(([x, y]) => [ox + c * x * s - si * y * sy, oy + si * x * s + c * y * sy]); };
  const mv = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
  const plen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
  const sub = (pts, u) => {
    if (u >= 1) return pts; if (u <= 0) return [pts[0], pts[0]];
    const L = plen(pts) * u, o = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + d >= L) { const k = (L - acc) / (d || 1); o.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]); break; } acc += d; o.push(pts[i]); }
    return o;
  };
  const path = (c, pts, closed = true) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (closed) c.closePath(); };
  const bbox = (pts) => { let a = 1e9, b = 1e9, cc = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); cc = Math.max(cc, x); d = Math.max(d, y); } return [a, b, cc, d]; };
  const kidneyP = (cx, cy, s, rot = 0) => xf(spline([[-1, -0.1], [-0.6, -0.55], [0.1, -0.45], [0.35, -0.15], [0.8, -0.45], [1.05, 0.05], [0.6, 0.5], [-0.4, 0.5]], true, 8), cx, cy, rot, s);
  const boomP = (cx, cy, s, rot = 0) => xf(spline([[-1, -0.25], [-0.2, -0.05], [0.15, -0.55], [0.95, -0.2], [0.35, 0.1], [0.1, 0.45], [-0.85, 0.35]], true, 8), cx, cy, rot, s);

  // ── the dry-brush tooth (built once, seeded) ──
  let TOOTH = null;
  const tooth = () => {
    if (TOOTH) return TOOTH;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'), r = PV.rng(4848);
    for (let i = 0; i < 1400; i++) { const x = r() * 256, y = r() * 256, l = 2 + r() * 8, a = (r() - 0.5) * 0.35; g.strokeStyle = `rgba(40,25,15,${0.05 + r() * 0.14})`; g.lineWidth = 0.6 + r() * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 1000; i++) { const x = r() * 256, y = r() * 256, rr = 0.4 + r() * 1.3; g.fillStyle = `rgba(255,250,236,${0.08 + r() * 0.25})`; g.beginPath(); g.ellipse(x, y, rr * 1.6, rr, 0.1, 0, TAU); g.fill(); }
    return (TOOTH = cv);
  };
  const toothIn = (c, pts, k) => {
    if (!(k > 0)) return;
    const [x0, y0, x1, y1] = bbox(pts);
    c.save(); path(c, pts); c.clip(); c.globalAlpha *= k; c.fillStyle = c.createPattern(tooth(), 'repeat'); c.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4); c.restore();
  };

  // ── the ink line: a pressure ribbon that breathes in width and breaks here and there ──
  function inkLine(c, pts, w, o = {}) {
    const { color = INK(), closed = false, wob = 0.4, seed = 1, breaks = 0.15, taper = true, upto = 1 } = o;
    let P = closed ? [...pts, pts[0], pts[1] || pts[0]] : pts;
    if (upto < 1) P = sub(P, upto);
    if (P.length < 2 || w <= 0) return;
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = L[L.length - 1]; if (total <= 0.5) return;
    const stp = Math.max(1.6, Math.min(w * 0.8, total / 500)), n = Math.max(2, Math.ceil(total / stp));
    const S = []; let j = 0;
    for (let i = 0; i <= n; i++) { const d = total * i / n; while (j < L.length - 2 && L[j + 1] < d) j++; const u = (d - L[j]) / Math.max(1e-6, L[j + 1] - L[j]); S.push([P[j][0] + (P[j + 1][0] - P[j][0]) * u, P[j][1] + (P[j + 1][1] - P[j][1]) * u, d]); }
    const wid = (d) => { let k = 1 + wob * (n1(d / (w * 14), seed) - 0.5) * 2; if (taper && !closed) k *= Math.min(1, 0.35 + (Math.min(d, total - d) / (w * 4)) * 0.65); return Math.max(0.1, k) * w * 0.5; };
    const runs = []; let cur = [];
    for (const s of S) { if (breaks > 0 && n1(s[2] / (w * 9) + 40, seed + 7) < breaks * 0.5) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(s); }
    if (cur.length > 1) runs.push(cur);
    c.save(); c.fillStyle = color;
    for (const run of runs) {
      const lf = [], rt = [];
      for (let i = 0; i < run.length; i++) {
        const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const r = wid(run[i][2]); lf.push([run[i][0] + nx * r, run[i][1] + ny * r]); rt.push([run[i][0] - nx * r, run[i][1] - ny * r]);
      }
      c.beginPath(); lf.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); for (let i = rt.length - 1; i >= 0; i--) c.lineTo(rt[i][0], rt[i][1]); c.closePath(); c.fill();
      const r0 = wid(run[0][2]), r1 = wid(run[run.length - 1][2]);
      c.beginPath(); c.arc(run[0][0], run[0][1], r0, 0, TAU); c.moveTo(run[run.length - 1][0] + r1, run[run.length - 1][1]); c.arc(run[run.length - 1][0], run[run.length - 1][1], r1, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** a shape in this style: the colour cel printed off-register, a little tooth, the broken ink line on top.
   *  o: { fill, line (ink px, 0 none), lt, seed, breaks, grain, off ([dx,dy] or false), shade: [{ pts, color }] } */
  function shape(c, pts, o = {}) {
    const { fill = null, line = 4, seed = 1, breaks = 0.16, grain = 0.5, lt = 0, wob = 0.4 } = o;
    const off = o.off === false ? [0, 0] : (o.off || reg(lt, seed, o.regK ?? 1));
    if (fill) {
      const P = mv(pts, off[0], off[1]);
      c.save(); path(c, P); c.fillStyle = C(fill); c.fill();
      if (o.shade) { c.clip(); for (const s of [].concat(o.shade)) { path(c, mv(s.pts, off[0], off[1])); c.fillStyle = C(s.color); c.globalAlpha = s.alpha ?? 1; c.fill(); c.globalAlpha = 1; } }
      c.restore();
      toothIn(c, P, grain);
    }
    if (line > 0) inkLine(c, pts, line, { closed: true, breaks, seed, wob });
  }
  /** an open ink stroke (a mouth, a brow, a hair line, a leader) */
  const stroke = (c, pts, w, o = {}) => inkLine(c, pts, w, { closed: false, breaks: o.breaks ?? 0, seed: o.seed ?? 3, wob: o.wob ?? 0.3, taper: o.taper ?? true, color: o.color ? C(o.color) : INK(), upto: o.upto ?? 1 });
  const dot = (c, x, y, rx, ry = rx, color) => { c.fillStyle = color ? C(color) : INK(); c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); c.fill(); };
  /** the four-point atomic sparkle */
  const sparkle = (c, x, y, r, color = 'paper', rot = 0) => { const p = []; for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 2 - Math.PI / 2, b = a + Math.PI / 4; p.push([x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(b) * r * 0.15, y + Math.sin(b) * r * 0.15]); } path(c, p); c.fillStyle = C(color); c.fill(); };
  /** sunburst wedges from a centre */
  const rays = (c, cx, cy, n, r, fill, rot = 0, r0 = 0, alpha = 1) => {
    c.save(); c.globalAlpha *= alpha; c.fillStyle = C(fill); c.beginPath();
    for (let i = 0; i < n; i++) { const a0 = rot + i * TAU / n, a1 = a0 + TAU / n * 0.5; c.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0); c.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r); c.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r); c.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0); c.closePath(); }
    c.fill(); c.restore();
  };

  /** stepped pop-in with a strong overshoot, and a quick shrink-out */
  const pop = (lt, at = 0, out, dur = 0.28) => {
    const tq = step(lt);
    let k = tq < at ? 0 : ease.back(clamp((tq - at) / dur));
    if (out != null && tq >= out) k *= 1 - ease.inOut(clamp((tq - out) / 0.22));
    return k;
  };
  /** a text pop: the same timing, but lettering starts at 72 % so it never reads tiny */
  const tpop = (k) => (k <= 0.03 ? 0 : 0.72 + 0.28 * k);
  /** a canvas on this layer, sized in stage px, drawn at R× so a camera push stays sharp */
  function mountCanvas(self, w, hh, place, draw, R = 1.5) {
    const c = h('canvas', null, null, self.html);
    c.width = Math.ceil(w * R); c.height = Math.ceil(hh * R);
    Object.assign(c.style, { position: 'absolute', width: w + 'px', height: hh + 'px', left: '0px', top: '0px' });
    const ctx = c.getContext('2d');
    self.tick((lt) => {
      const p = place(lt);
      if (!p) { c.style.display = 'none'; return; }
      c.style.display = '';
      c.style.left = p.x.toFixed(1) + 'px'; c.style.top = p.y.toFixed(1) + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(R, 0, 0, R, 0, 0);
      draw(ctx, lt);
    });
    return c;
  }
  /** two-plate lettering as HTML: ink letters over a colour plate printed off them (re-rolled on twos) */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const markup = (s, hi) => esc(s).replace(/\{([^}]*)\}/g, (_, w) => `<span style="color:${C(hi || 'red')}">${w}</span>`);
  function plateText(T, cls, html, o) {
    const el = h('div', 'mc-t ' + cls, html, T.html);
    const plate = o.plate === false ? null : C(o.plate || 'yellow');
    T.tick((lt) => {
      if (!plate) { el.style.textShadow = 'none'; return; }
      const [dx, dy] = reg(lt, o.seed ?? 5, (o.size ?? 60) / 70);
      el.style.textShadow = `${dx.toFixed(1)}px ${dy.toFixed(1)}px 0 ${plate}`;
    });
    return el;
  }

  // ─────────────────────────── the presenter ───────────────────────────
  // units: feet on (0, 0), facing +x in a three-quarter view, about 470 units tall. Arms: [elbow, hand, hand kind, angle]
  const POSES = {
    idle:    { F: [[46, -268], [50, -214], 'flat', 1.5], B: [[-46, -268], [-46, -214], 'flat', 1.62] },
    point:   { F: [[92, -366], [126, -420], 'point', -0.95], B: [[-46, -268], [-46, -214], 'flat', 1.62], lean: -0.02 },
    present: { F: [[96, -292], [150, -300], 'open', -0.25], B: [[-46, -268], [-46, -214], 'flat', 1.62] },
    tada:    { F: [[84, -384], [108, -452], 'open', -1.25], B: [[-80, -384], [-104, -452], 'open', -1.9], lift: 6 },
    think:   { F: [[78, -296], [56, -360], 'fist', -1.9], B: [[-46, -268], [-40, -214], 'flat', 1.62], tilt: -0.05 },
    wave:    { F: [[98, -376], [112, -452], 'open', -1.45], B: [[-46, -268], [-46, -214], 'flat', 1.62], wave: true },
    shrug:   { F: [[78, -296], [118, -334], 'open', -0.6], B: [[-74, -296], [-112, -334], 'open', -2.5], tilt: 0.06 },
    hold:    { F: [[74, -272], [116, -302], 'grip', -0.1], B: [[30, -272], [84, -308], 'grip', -0.2] },
    stop:    { F: [[88, -320], [138, -350], 'open', -1.55], B: [[-46, -268], [-46, -214], 'flat', 1.62] },
    worried: { F: [[62, -310], [46, -376], 'open', -1.7], B: [[-56, -310], [-34, -378], 'open', -1.5], tilt: -0.04 },
    thumbsup:{ F: [[86, -300], [112, -344], 'thumb', -0.2], B: [[-46, -268], [-46, -214], 'flat', 1.62] },
    press:   { F: [[94, -300], [156, -292], 'point', 0.05], B: [[-46, -268], [-46, -214], 'flat', 1.62], lean: 0.04 },
    crouch:  { F: [[86, -250], [142, -232], 'open', 0.2], B: [[20, -250], [70, -220], 'open', 0.3], crouch: true },
    walk:    { F: [[46, -268], [62, -218], 'flat', 1.3], B: [[-46, -268], [-62, -218], 'flat', 1.9], walk: true },
  };
  const MOOD_OF = { tada: 'grin', worried: 'worried', think: 'focus', wave: 'happy', stop: 'focus', press: 'focus', crouch: 'focus', thumbsup: 'wink' };

  /** a glove-less 1950s hand: one ink outline around palm and fingers (stroke all parts first, fill second) */
  function hand(c, x, y, ang, kind, s = 1, skin = SKIN) {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
    // parts in local units: fingers point along +x
    const parts = []; const palm = [0, 0, 13];
    if (kind === 'open') parts.push([[4, -9], [24, -20]], [[8, -3], [30, -6]], [[8, 3], [29, 7]], [[4, 8], [22, 18]], [[-4, -10], [6, -26]]);
    else if (kind === 'point') parts.push([[6, -4], [34, -6]], [[-2, -11], [8, -20]]);
    else if (kind === 'thumb') parts.push([[-2, -10], [-6, -32]]);
    else if (kind === 'flat') parts.push([[4, -6], [26, -6]], [[4, 0], [28, 1]], [[4, 6], [25, 8]], [[-2, -10], [10, -18]]);
    else if (kind === 'grip' || kind === 'fist') parts.push([[-2, -10], [8, -18]]);
    const draw = (w, color) => {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = color; c.fillStyle = color;
      c.beginPath(); c.arc(palm[0], palm[1], palm[2] + w / 2, 0, TAU); c.fill();
      c.lineWidth = 10 + w; for (const [a, b] of parts) { c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    };
    draw(7, INK()); draw(0, skin);
    if (kind === 'fist' || kind === 'grip' || kind === 'thumb' || kind === 'point') { c.strokeStyle = INK(); c.lineWidth = 2.4; c.lineCap = 'round'; for (const yy of [-3, 3, 9]) { c.beginPath(); c.moveTo(4, yy); c.lineTo(11, yy); c.stroke(); } }
    else if (kind === 'flat') { c.strokeStyle = INK(); c.lineWidth = 2.2; for (const yy of [-3, 3]) { c.beginPath(); c.moveTo(14, yy); c.lineTo(25, yy + 1); c.stroke(); } }
    c.restore();
  }

  function face(c, mood, blink, talk, hx, hy, o, lt) {
    const eyeY = hy - 6, e1 = hx + 18, e2 = hx + 44;
    // brows
    const bw = (x, d) => stroke(c, [[x - 8, eyeY - 18 + d], [x + 7, eyeY - 21 - d]], 4, { taper: true });
    if (mood === 'wow') { bw(e1, -6); bw(e2, -6); }
    else if (mood === 'worried') { stroke(c, [[e1 - 8, eyeY - 22], [e1 + 7, eyeY - 16]], 4); stroke(c, [[e2 - 8, eyeY - 16], [e2 + 6, eyeY - 22]], 4); }
    else if (mood === 'focus') { stroke(c, [[e1 - 8, eyeY - 16], [e1 + 7, eyeY - 13]], 4.5); stroke(c, [[e2 - 7, eyeY - 13], [e2 + 6, eyeY - 16]], 4.5); }
    else { bw(e1, 0); bw(e2, 0); }
    // eyes: dots (the 1950s shorthand), lids when blinking, carets when grinning
    const look = val(o.look, lt, 0) * 3;
    if (blink) { stroke(c, [[e1 - 6, eyeY + 1], [e1 + 6, eyeY + 1]], 3.5); stroke(c, [[e2 - 6, eyeY + 1], [e2 + 6, eyeY + 1]], 3.5); }
    else if (mood === 'grin') { for (const x of [e1, e2]) stroke(c, [[x - 7, eyeY + 3], [x, eyeY - 5], [x + 7, eyeY + 3]], 3.8, { taper: false }); }
    else if (mood === 'wink') { dot(c, e1 + look, eyeY, 4.5, 6.5); stroke(c, [[e2 - 7, eyeY + 3], [e2, eyeY - 4], [e2 + 7, eyeY + 3]], 3.8, { taper: false }); }
    else if (mood === 'wow') { for (const x of [e1, e2]) { dot(c, x, eyeY, 8, 10, 'paper'); stroke(c, ellP(x, eyeY, 8, 10, 20), 2.6, { taper: false }); dot(c, x + 1 + look, eyeY + 1, 3.6, 4.6); } }
    else { dot(c, e1 + look, eyeY, 4.5, 6.5); dot(c, e2 + look, eyeY, 4.5, 6.5); }
    if (o.glasses) { for (const x of [e1, e2]) stroke(c, ellP(x, eyeY, 13, 12, 24), 3, { taper: false }); stroke(c, [[e1 + 13, eyeY - 2], [e2 - 13, eyeY - 2]], 3, { taper: false }); }
    // cheek
    c.fillStyle = 'rgba(232,120,110,0.45)'; c.beginPath(); c.arc(hx + 10, hy + 14, 9, 0, TAU); c.fill();
    // mouth under the nose
    const mx = hx + 38, my = hy + 30;
    if (talk) {
      const open = Math.floor(lt * 12) % 3 !== 2, wide = Math.floor(lt * 12 / 3) % 2;
      if (open) { const p = ellP(mx - 2, my + 4, wide ? 8 : 6, wide ? 11 : 7, 18); path(c, p); c.fillStyle = INK(); c.fill(); dot(c, mx - 2, my + 9, 4.5, wide ? 3.5 : 2, 'red'); }
      else stroke(c, [[mx - 10, my], [mx, my + 4], [mx + 8, my - 1]], 3.6);
    } else if (mood === 'wow') { dot(c, mx, my + 4, 7, 9); }
    else if (mood === 'grin') { const p = [[mx - 16, my - 4], [mx + 12, my - 6], [mx + 6, my + 10], [mx - 8, my + 10]]; path(c, spline(p, true, 5)); c.fillStyle = INK(); c.fill(); dot(c, mx - 2, my + 6, 7, 3.5, 'red'); }
    else if (mood === 'worried') stroke(c, [[mx - 12, my + 4], [mx - 6, my], [mx, my + 4], [mx + 6, my], [mx + 10, my + 3]], 3.4, { taper: false });
    else if (mood === 'focus') stroke(c, [[mx - 9, my + 2], [mx + 8, my + 1]], 3.6);
    else stroke(c, spline([[mx - 14, my - 2], [mx - 2, my + 7], [mx + 10, my - 4]], false, 5), 3.8);
  }

  function hair(c, kind, hx, hy, o, lt) {
    const acc = C(o.accent || 'yellow'), hc = C(o.hairColor || HAIR);
    if (kind === 'bob') {
      shape(c, spline([[hx + 46, hy - 40], [hx + 10, hy - 62], [hx - 34, hy - 52], [hx - 56, hy - 14], [hx - 58, hy + 30], [hx - 46, hy + 46], [hx - 30, hy + 30], [hx - 34, hy - 4], [hx - 8, hy - 30], [hx + 30, hy - 26]], true, 6), { fill: hc, line: 3.5, lt, seed: 41 });
      stroke(c, spline([[hx - 30, hy - 52], [hx + 6, hy - 60], [hx + 40, hy - 48]], false, 6), 9, { color: acc, taper: false });
    } else if (kind === 'flat') {
      shape(c, [[hx - 38, hy - 40], [hx - 36, hy - 66], [hx + 34, hy - 66], [hx + 40, hy - 44], [hx + 14, hy - 40], [hx - 12, hy - 30], [hx - 40, hy + 4], [hx - 50, hy - 18]], { fill: hc, line: 3.5, lt, seed: 42 });
    } else if (kind === 'hat') {
      shape(c, [[hx - 36, hy - 44], [hx - 32, hy - 84], [hx + 34, hy - 84], [hx + 38, hy - 44]], { fill: C(o.hatColor || 'soft'), line: 3.5, lt, seed: 43, shade: [{ pts: [[hx - 36, hy - 60], [hx + 40, hy - 60], [hx + 40, hy - 46], [hx - 36, hy - 46]], color: acc }] });
      shape(c, ellP(hx + 2, hy - 44, 66, 10, 30), { fill: C(o.hatColor || 'soft'), line: 3.5, lt, seed: 44 });
      shape(c, spline([[hx - 46, hy - 36], [hx - 52, hy - 4], [hx - 40, hy + 8], [hx - 30, hy - 20]], true, 5), { fill: hc, line: 0, lt, seed: 45 });
    } else if (kind === 'curl') {
      shape(c, spline([[hx + 36, hy - 46], [hx, hy - 60], [hx - 40, hy - 46], [hx - 52, hy - 10], [hx - 40, hy - 4], [hx - 20, hy - 34], [hx + 20, hy - 34]], true, 6), { fill: hc, line: 3.5, lt, seed: 46 });
      stroke(c, spline([[hx + 4, hy - 58], [hx + 12, hy - 80], [hx + 26, hy - 76], [hx + 22, hy - 66]], false, 6), 4.5);
    } else if (kind === 'bald') {
      for (let k = 0; k < 3; k++) stroke(c, spline([[hx - 6 + k * 8, hy - 50], [hx - 2 + k * 9, hy - 66], [hx + 8 + k * 8, hy - 70]], false, 5), 3);
    }
  }

  function drawPresenter(c, o, lt) {
    const tq = step(lt);
    const pk = keyAt(o.pose, lt, 'idle');
    let P0 = POSES[pk.cur] || POSES.idle; const Pp = POSES[pk.prev] || P0;
    const inb = pk.since < 1 / 12 + 1e-6 ? 0.5 : 1;   // one in-between drawing, then the new held pose
    const mood = val(o.mood, lt, null) || MOOD_OF[pk.cur] || 'happy';
    const talk = !!val(o.talk, lt, false);
    const blink = (Math.floor(tq * 12 + (o.seed || 0) * 7) % 41) < 2;
    const top = C(o.top || 'orange'), pants = C(o.pants || NAVY), acc = C(o.accent || 'yellow'), skin = C(o.skin || SKIN);
    const crouch = P0.crouch, walk = P0.walk;
    const lift = (P0.lift || 0) * (Math.floor(tq * 12) % 2 ? 1 : 0.6);
    // ground shadow
    c.fillStyle = 'rgba(43,36,32,0.18)'; c.beginPath(); c.ellipse(4, 2, 70, 10, 0, 0, TAU); c.fill();
    c.save(); c.translate(0, -lift);
    // legs and shoes
    const hipY = crouch ? -132 : -205;
    const legs = crouch ? [[[-18, hipY], [36, -70], [-6, -12]], [[16, hipY], [72, -76], [40, -12]]]
      : walk ? (() => { const ph = Math.floor(tq * 6) % 2 ? 1 : -1; return [[[-18, hipY], [-18 - ph * 10, -110], [-20 - ph * 26, -12]], [[16, hipY], [16 + ph * 10, -110], [18 + ph * 26, -12]]]; })()
        : [[[-18, hipY], [-19, -110], [-20, -12]], [[16, hipY], [17, -110], [18, -12]]];
    for (const [hp, kn, ft] of legs) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = INK(); c.lineWidth = 34; c.beginPath(); c.moveTo(...hp); c.lineTo(...kn); c.lineTo(...ft); c.stroke();
      const [dx, dy] = reg(lt, 61); c.strokeStyle = pants; c.lineWidth = 26; c.beginPath(); c.moveTo(hp[0] + dx, hp[1] + dy); c.lineTo(kn[0] + dx, kn[1] + dy); c.lineTo(ft[0] + dx * 0.5, ft[1] + dy * 0.5); c.stroke();
      shape(c, ellP(ft[0] + 12, ft[1] + 4, 26, 10, 20), { fill: 'ink', line: 0, lt, seed: 62, grain: 0.2 });
    }
    // upper body (tilts forward when crouching)
    c.save();
    c.translate(0, hipY); c.rotate((crouch ? 0.32 : 0) + (P0.lean || 0)); c.translate(0, 205);
    const arm = (A, Ap, sh, front) => {
      const el = [lerp(Ap[0][0], A[0][0], inb), lerp(Ap[0][1], A[0][1], inb)], hd = [lerp(Ap[1][0], A[1][0], inb), lerp(Ap[1][1], A[1][1], inb)];
      let ang = lerp(Ap[3], A[3], inb), kind = inb < 1 ? Ap[2] : A[2];
      if (front && P0.wave && inb === 1) { const w = Math.floor(tq * 6) % 2 ? 1 : -1; hd[0] += w * 14; ang += w * 0.3; }
      // press: anticipation (pull back), fast push, recoil — on o.press (a time or a list of times)
      if (front && o.press != null) for (const pt of [].concat(o.press)) { const d = tq - pt; if (d > -0.35 && d < 0.4) { const k = d < -0.12 ? -1 : d < 0 ? -1 + (d + 0.12) / 0.12 * 2 : d < 0.15 ? 1 : 1 - (d - 0.15) / 0.25; hd[0] += k * (k < 0 ? 26 : 22); el[0] += k * 10; } }
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = INK(); c.lineWidth = 24; c.beginPath(); c.moveTo(...sh); c.lineTo(...el); c.lineTo(...hd); c.stroke();
      const [dx, dy] = reg(lt, front ? 71 : 72); c.strokeStyle = top; c.lineWidth = 16; c.beginPath(); c.moveTo(sh[0] + dx, sh[1] + dy); c.lineTo(el[0] + dx, el[1] + dy); c.lineTo(hd[0] + dx * 0.6, hd[1] + dy * 0.6); c.stroke();
      if (front && o.holds) { const kind2 = val(o.holds, lt); if (kind2) { c.save(); c.translate(hd[0] + Math.cos(ang) * 30, hd[1] + Math.sin(ang) * 30 - 34); drawThing(c, kind2, { size: 0.9, color: o.holdsColor }, lt); c.restore(); } }
      hand(c, hd[0], hd[1], ang, kind, 1.05, skin);
    };
    // back arm behind the body
    arm(P0.B, Pp.B, [-36, -322], false);
    // torso: a tapered block, a darker plane on the back side, a belt in the accent colour
    const torso = [[-44, -334], [44, -334], [40, -205], [-40, -205]];
    shape(c, torso, { fill: top, line: 4, lt, seed: 63, shade: [{ pts: [[-44, -334], [-26, -334], [-24, -205], [-40, -205]], color: shade(top, 0.2) }] });
    shape(c, [[-41, -222], [41, -222], [40, -204], [-40, -204]], { fill: acc, line: 3, lt, seed: 64 });
    if (o.tie !== false && o.tie) shape(c, [[4, -330], [12, -330], [16, -268], [8, -256], [0, -268]], { fill: C(o.tie === true ? 'red' : o.tie), line: 3, lt, seed: 65 });
    // neck (turtleneck in the sweater colour)
    shape(c, rrP(-12, -352, 30, 22, 6), { fill: top, line: 3.5, lt, seed: 66 });
    // head: an egg whose outline runs out into the long pointed nose
    c.save(); c.translate(6, -404); c.rotate((P0.tilt || 0)); c.translate(-6, 404);
    const hx = 6, hy = -404;
    if (o.hair === 'bob') shape(c, spline([[hx - 30, hy - 30], [hx - 58, hy], [hx - 58, hy + 34], [hx - 40, hy + 48], [hx - 20, hy + 10]], true, 6), { fill: C(o.hairColor || HAIR), line: 3.5, lt, seed: 47 });
    const headPts = ellP(hx, hy, 44, 52, 30, 0.32, TAU - 0.42);
    headPts.push([hx + 86, hy + 12], [hx + 46, hy + 22]);
    shape(c, headPts, { fill: skin, line: 4, lt, seed: 67, shade: [{ pts: ellP(hx - 30, hy + 6, 22, 52, 16), color: SKIN_D, alpha: 0.55 }] });
    shape(c, ellP(hx - 30, hy + 2, 9, 12, 14), { fill: skin, line: 3.2, lt, seed: 68 });   // ear
    hair(c, o.hair || 'flat', hx, hy, o, lt);
    face(c, mood, blink, talk, hx, hy, o, lt);
    c.restore();
    // front arm over the body
    arm(P0.F, Pp.F, [38, -322], true);
    c.restore();
    c.restore();
  }

  /** presenter(x, y, o): the cheerful 1950s classroom-film presenter, standing with feet on (x, y), about o.size px tall
   *  (default 500): an egg head whose outline runs into a long pointed nose, dot eyes, a sweater in one flat colour, a
   *  belt in the accent, slim trousers. Limited animation: the body is a held drawing; only arms, eyes and mouth change,
   *  on twos, with one in-between when the pose changes. o: { size, face: 'r'|'l' (fn), pose (fn): 'idle' 'point'
   *  (finger up toward the side it faces: at a step card, a call-out) 'present' (open palm: "here it is") 'tada' 'think'
   *  'wave' 'shrug' 'hold' (carries o.holds) 'stop' (palm out: "don't") 'worried' 'thumbsup' 'press' (finger forward;
   *  o.press: the time(s) of the push, with anticipation and recoil) 'crouch' (bent low: "stay low") 'walk' (move x as a
   *  function of lt), mood (fn; default follows the pose): 'happy' 'grin' 'wow' 'focus' 'wink' 'worried', talk (fn
   *  bool: the mouth moves on twos; true while the presenter speaks), hair: 'flat' (crew cut) 'bob' 'hat' (pork-pie)
   *  'curl' 'bald', top (sweater colour, default 'orange'), pants (default navy), accent (belt / headband / hat band,
   *  default 'yellow'), hairColor, tie (true or a colour), glasses, look (-1..1 pupils), holds (a thing kind, fn),
   *  holdsColor, at, out, seed }. x may be a function of lt. Returns the canvas. */
  B.presenter = function (x, y, o = {}) {
    const size = o.size ?? 500, s = size / 470, cw = 460 * s, ch = 620 * s;
    return mountCanvas(this, cw, ch, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - cw / 2, y: val(y, lt) - 560 * s }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out);
      c.translate(cw / 2, 560 * s); c.scale(s * Math.min(k, 1.06), s * Math.min(k, 1.06) * (k > 1 ? 2 - k : 1));
      if (val(o.face, lt, 'r') === 'l') c.scale(-1, 1);
      drawPresenter(c, o, lt);
    });
  };

  // ─────────────────────────── things ───────────────────────────
  // drawn in a ~100-unit box centred on (0, 0), off-register, broken ink line
  function drawThing(c, kind, o, lt) {
    const s = o.size ?? 1; c.save(); c.scale(s, s);
    const a = o.color ? C(o.color) : null, tq = step(lt), on = o.on == null ? true : !!val(o.on, lt);
    const S = (pts, fill, line = 3.6, seed = 1, extra = {}) => shape(c, pts, { fill, line, lt, seed, ...extra });
    const R = (x, y, w, hh, r, fill, line, seed, extra) => S(rrP(x, y, w, hh, r), fill, line, seed, extra);
    const E = (x, y, rx, ry, fill, line, seed, extra) => S(ellP(x, y, rx, ry, 28), fill, line, seed, extra);
    const fc = o.face;
    const eyes = (x, y, k = 1, mood = 'happy') => { dot(c, x - 9 * k, y, 3.6 * k, 5 * k); dot(c, x + 9 * k, y, 3.6 * k, 5 * k); if (mood === 'wow') dot(c, x, y + 13 * k, 4 * k, 5 * k); else stroke(c, [[x - 7 * k, y + 10 * k], [x, y + 14 * k], [x + 7 * k, y + 10 * k]], 3 * k, { taper: false }); };
    switch (kind) {
      case 'phone': {
        R(-30, -54, 60, 108, 12, a || 'blue', 3.8, 2);
        const scr = val(o.screen, lt, 'blank');
        R(-23, -44, 46, 80, 5, 'paper', 2.6, 3);
        if (scr === 'check') { E(0, -6, 16, 16, 'green', 0, 4); stroke(c, [[-8, -6], [-2, 1], [9, -12]], 4, { color: 'paper', taper: false }); }
        else if (scr === 'code') { c.fillStyle = INK(); c.font = '400 15px "Archivo Black"'; c.textAlign = 'center'; c.fillText(String(val(o.text, lt, '482 913')), 0, 0); }
        else if (scr === 'wifi') { for (let i = 0; i < 3; i++) stroke(c, ellP(0, 10, 8 + i * 9, 8 + i * 9, 10, -2.3, -0.84), 3.4, { taper: false }); dot(c, 0, 10, 3.5); }
        else if (scr === 'call') { c.fillStyle = C('red'); c.font = '400 20px "Archivo Black"'; c.textAlign = 'center'; c.fillText(String(val(o.text, lt, '119')), 0, -4); E(0, 20, 9, 9, 'green', 0, 5); }
        else { for (let i = 0; i < 4; i++) { c.fillStyle = 'rgba(43,36,32,0.22)'; c.fillRect(-16, -34 + i * 14, 32 - (i % 2) * 10, 6); } }
        dot(c, 0, 44, 3.5, 3.5, 'paper');
        break;
      }
      case 'laptop': {
        R(-48, -50, 96, 64, 6, a || 'muted', 3.6, 6); R(-40, -43, 80, 50, 3, 'paper', 2.4, 7);
        const scr = val(o.screen, lt, 'blank');
        if (scr === 'password') { R(-32, -26, 64, 18, 4, 'paper', 2.2, 8); c.fillStyle = INK(); for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(-24 + i * 9.6, -17, 2.6, 0, TAU); c.fill(); } }
        else if (scr === 'check') { E(0, -18, 14, 14, 'green', 0, 9); stroke(c, [[-7, -18], [-2, -12], [8, -24]], 3.6, { color: 'paper', taper: false }); }
        else for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(43,36,32,0.22)'; c.fillRect(-30, -34 + i * 12, 52 - (i % 2) * 18, 5); }
        S([[-58, 14], [58, 14], [52, 26], [-52, 26]], a ? shade(a, 0.15) : 'faint', 3.6, 10);
        break;
      }
      case 'router': {
        R(-46, -8, 92, 30, 8, a || 'blue', 3.6, 11);
        stroke(c, [[-30, -8], [-36, -44]], 4.5); stroke(c, [[30, -8], [36, -44]], 4.5);
        for (let i = 0; i < 3; i++) dot(c, -24 + i * 14, 7, 3.5, 3.5, Math.floor(tq * 4 + i) % 3 ? 'yellow' : 'paper');
        if (on) for (let i = 0; i < 3; i++) { const q = ((tq * 1.2) + i / 3) % 1; c.globalAlpha = 1 - q; stroke(c, ellP(0, -22, 16 + q * 34, 16 + q * 34, 12, -2.4, -0.74), 3.2, { taper: false }); c.globalAlpha = 1; }
        break;
      }
      case 'lock': {
        const open = !!val(o.open, lt, false);
        stroke(c, spline([[-24, -6], [-24, -34], [0, -50], [24, -34], [24, open ? -44 : -6]], false, 6).map(([x, y]) => [x, y - (open ? 12 : 0)]), 9, { taper: false });
        R(-36, -10, 72, 58, 9, a || 'yellow', 3.8, 12);
        E(0, 12, 7, 7, 'ink', 0, 13); S([[-4, 14], [4, 14], [6, 32], [-6, 32]], 'ink', 0, 14);
        break;
      }
      case 'key': {
        E(-30, 0, 22, 22, a || 'yellow', 3.6, 15); E(-30, 0, 8, 8, 'paper', 3, 16);
        S([[-10, -7], [48, -7], [48, 7], [-10, 7]], a || 'yellow', 3.6, 17); S([[30, 7], [38, 7], [38, 22], [30, 22]], a || 'yellow', 3, 18); S([[16, 7], [24, 7], [24, 17], [16, 17]], a || 'yellow', 3, 19);
        break;
      }
      case 'shield': {
        S(spline([[0, -50], [40, -36], [36, 14], [0, 50], [-36, 14], [-40, -36]], true, 5), a || 'blue', 3.8, 20, { shade: [{ pts: [[0, -60], [50, -60], [50, 60], [0, 60]], color: shade(a || 'blue', 0.15) }] });
        stroke(c, [[-14, 0], [-3, 12], [16, -12]], 6, { color: 'paper', taper: false });
        break;
      }
      case 'door': {
        const open = clamp(+val(o.open, lt, 0));
        R(-40, -60, 80, 120, 3, 'soft', 4, 21);
        if (open > 0) { c.fillStyle = INK(); c.globalAlpha = 0.8; c.fillRect(-36, -56, 72, 112); c.globalAlpha = 1; }
        const wv = 72 * (1 - open * 0.75);
        S([[-36, -56], [-36 + wv, -56 + open * 6], [-36 + wv, 56 - open * 6], [-36, 56]], a || 'red', 3.6, 22);
        if (wv > 30) { R(-30, -48, wv - 12, 40, 3, null, 2.4, 23); R(-30, 2, wv - 12, 44, 3, null, 2.4, 24); }
        E(-36 + wv - 10, 2, 5, 5, 'yellow', 2.4, 25);
        if (val(o.hot, lt, false)) for (let i = 0; i < 3; i++) { const q = (tq * 1.5 + i / 3) % 1; stroke(c, spline([[-20 + i * 20, 60 - q * 20], [-14 + i * 20, 30 - q * 40], [-22 + i * 20, -q * 60]], false, 5), 3.4, { color: 'red' }); }
        break;
      }
      case 'flame': {
        const f = Math.floor(tq * 12) % 3, w = [0, 4, -3][f];
        S(spline([[0, -56 - w], [22, -20], [34, 14], [22, 44], [0, 52], [-22, 44], [-34, 14], [-18, -14], [-10, 0]], true, 6), a || 'red', 3.8, 26);
        S(spline([[2, -14 + w], [16, 12], [12, 36], [0, 42], [-12, 36], [-14, 16]], true, 6), 'yellow', 0, 27);
        if (fc) eyes(0, 18, 0.8, 'wow');
        break;
      }
      case 'smoke': {
        const d = (tq * 8) % 20;
        // one clean contour: a flat-bottomed cloud with five round bumps on top, drifting a little on twos
        const bumps = [[-42, 6, 18], [-20, -4, 24], [6, -10, 28], [32, -2, 22], [50, 8, 14]], pts = [];
        for (let x = -60; x <= 64; x += 3) { let y = 18; for (const [bx, by, br] of bumps) { const dx = x - bx; if (Math.abs(dx) < br) y = Math.min(y, by - Math.sqrt(br * br - dx * dx)); } pts.push([x, y - d * 0.25]); }
        pts.push([64, 18], [-60, 18]);
        S(pts, a || 'faint', 3.4, 28, { breaks: 0.2, shade: [{ pts: [[-70, 8], [70, 8], [70, 30], [-70, 30]], color: shade(a || 'faint', 0.12) }] });
        stroke(c, spline([[-28, 0], [-14, -10], [2, -4]], false, 4), 2.6, { color: shade(a || 'faint', 0.35) });
        break;
      }
      case 'germ': {
        const wob = Math.floor(tq * 12) % 2 ? 0.08 : -0.08;
        c.rotate(wob);
        for (let i = 0; i < 9; i++) { const an = i / 9 * TAU; stroke(c, [[Math.cos(an) * 34, Math.sin(an) * 34], [Math.cos(an) * 52, Math.sin(an) * 52]], 4, { taper: false }); dot(c, Math.cos(an) * 54, Math.sin(an) * 54, 6, 6, a || 'green'); }
        S(spline([[0, -40], [30, -28], [40, 4], [26, 34], [-4, 40], [-34, 26], [-40, -6], [-26, -32]], true, 5), a || 'green', 3.8, 29, { shade: [{ pts: ellP(14, 10, 26, 26, 14), color: shade(a || 'green', 0.15) }] });
        dot(c, -10, -6, 9, 10, 'paper'); dot(c, 12, -6, 9, 10, 'paper'); dot(c, -8, -4, 4, 5); dot(c, 14, -4, 4, 5);
        stroke(c, [[-14, -20], [-4, -16]], 3.5); stroke(c, [[8, -16], [18, -20]], 3.5);
        stroke(c, spline([[-10, 16], [2, 12], [12, 18]], false, 4), 3.4);
        break;
      }
      case 'soap': {
        R(-46, -22, 92, 46, 20, a || 'blueF', 3.8, 30);
        for (let i = 0; i < 5; i++) { const q = (tq * 0.8 + i / 5) % 1, x = -30 + i * 15 + Math.sin(q * 6 + i) * 6, y = -26 - q * 50, r = 5 + (i % 3) * 3; c.globalAlpha = 1 - q * 0.8; stroke(c, ellP(x, y, r, r, 12), 2.4, { taper: false }); c.globalAlpha = 1; }
        stroke(c, spline([[-30, -10], [-10, -14], [10, -10]], false, 4), 2.6, { color: 'paper' });
        break;
      }
      case 'faucet': {
        S([[-56, -40], [-20, -40], [-20, -26], [-56, -26]], 'faint', 3.6, 31);
        S(spline([[-20, -40], [20, -46], [36, -30], [36, -6], [24, -6], [22, -26], [-20, -26]], true, 4), a || 'faint', 3.6, 32);
        S([[-8, -58], [4, -58], [4, -46], [-8, -46]], 'red', 3, 33); S([[-20, -64], [16, -64], [16, -56], [-20, -56]], 'red', 3, 34);
        if (on) { const q = (tq * 3) % 1; c.fillStyle = C('blue'); c.globalAlpha = 0.85; c.fillRect(24, -6, 12, 70); c.globalAlpha = 1; stroke(c, [[27, 4 + q * 20], [27, 22 + q * 20]], 2.4, { color: 'paper', taper: false }); stroke(c, [[32, 30 + q * 20], [32, 44 + q * 20]], 2.4, { color: 'paper', taper: false }); }
        break;
      }
      case 'towel': {
        stroke(c, [[-50, -46], [50, -46]], 6, { taper: false });
        S([[-34, -46], [34, -46], [36, 44], [-36, 44]], a || 'red', 3.6, 35, { shade: [{ pts: [[-36, 20], [36, 20], [36, 30], [-36, 30]], color: 'paper' }] });
        break;
      }
      case 'clock': {
        E(0, 0, 48, 48, a || 'blue', 3.8, 36); E(0, 0, 38, 38, 'paper', 3, 37);
        for (let i = 0; i < 12; i++) { const an = i / 12 * TAU; stroke(c, [[Math.cos(an) * 30, Math.sin(an) * 30], [Math.cos(an) * 35, Math.sin(an) * 35]], 2.6, { taper: false }); }
        const tm = val(o.time, lt, tq * 0.25);
        stroke(c, [[0, 0], [Math.sin(tm * TAU / 12) * 18, -Math.cos(tm * TAU / 12) * 18]], 5, { taper: false });
        stroke(c, [[0, 0], [Math.sin(tm * TAU) * 28, -Math.cos(tm * TAU) * 28]], 3.6, { taper: false });
        dot(c, 0, 0, 4, 4, 'red');
        break;
      }
      case 'timer': {
        const k = clamp(+val(o.level, lt, 0));
        E(0, 4, 46, 46, 'paper', 3.8, 38);
        if (k > 0) { c.save(); c.translate(reg(lt, 39)[0], reg(lt, 39)[1]); c.fillStyle = C(a || 'red'); c.beginPath(); c.moveTo(0, 4); c.arc(0, 4, 40, -Math.PI / 2, -Math.PI / 2 + k * TAU); c.closePath(); c.fill(); c.restore(); }
        S([[-8, -54], [8, -54], [8, -42], [-8, -42]], 'ink', 0, 40); S([[-16, -62], [16, -62], [16, -54], [-16, -54]], 'ink', 0, 41);
        break;
      }
      case 'bulb': {
        if (on) { c.save(); c.rotate(tq * 0.6); rays(c, 0, -8, 16, 78, 'yellow', 0, 54, 0.9); c.restore(); }
        S(spline([[-18, 26], [-34, -6], [-26, -40], [0, -50], [26, -40], [34, -6], [18, 26]], true, 5), on ? 'yellow' : 'paper', 3.8, 42);
        R(-18, 24, 36, 24, 4, 'muted', 3.2, 43);
        break;
      }
      case 'plug': {
        R(-26, -20, 52, 44, 10, a || 'paper', 3.6, 44); stroke(c, [[-10, -20], [-10, -42]], 6, { taper: false }); stroke(c, [[10, -20], [10, -42]], 6, { taper: false });
        stroke(c, spline([[0, 24], [6, 40], [-20, 50], [-48, 44]], false, 6), 6, { taper: false });
        break;
      }
      case 'battery': {
        const k = clamp(+val(o.level, lt, 1));
        R(-44, -24, 82, 48, 8, 'paper', 3.8, 45); R(38, -10, 10, 20, 3, 'ink', 0, 46);
        if (k > 0) R(-38, -18, 70 * k, 36, 4, k < 0.3 ? 'red' : (a || 'green'), 0, 47);
        break;
      }
      case 'box': {
        S([[-46, -18], [46, -18], [46, 44], [-46, 44]], a || '#C9955D', 3.8, 48, { shade: [{ pts: [[16, -18], [46, -18], [46, 44], [16, 44]], color: '#A2713F' }] });
        S([[-46, -18], [-30, -40], [62, -40], [46, -18]], '#DDB47F', 3.6, 49); S([[46, -18], [62, -40], [62, 22], [46, 44]], '#A2713F', 3.6, 50);
        R(-14, -18, 20, 62, 0, 'yellowF', 0, 51);
        break;
      }
      case 'envelope': {
        R(-50, -32, 100, 64, 4, a || 'paper', 3.8, 52); stroke(c, [[-48, -30], [0, 6], [48, -30]], 3.6, { taper: false });
        E(0, 6, 9, 9, 'red', 2.4, 53);
        break;
      }
      case 'calendar': {
        R(-44, -42, 88, 92, 6, 'paper', 3.8, 54); R(-44, -42, 88, 26, 6, a || 'red', 3.8, 55);
        stroke(c, [[-20, -52], [-20, -34]], 5, { taper: false }); stroke(c, [[20, -52], [20, -34]], 5, { taper: false });
        c.fillStyle = INK(); c.font = '400 40px "Archivo Black", "Noto Sans SC Variable"'; c.textAlign = 'center'; c.fillText(String(val(o.text, lt, '1')), 0, 34);
        break;
      }
      case 'cup': {
        S([[-30, -28], [30, -28], [24, 36], [-24, 36]], a || 'paper', 3.8, 56); stroke(c, ellP(36, 2, 12, 15, 14, -1.5, 1.5), 5, { taper: false });
        for (let i = 0; i < 2; i++) { const q = (tq * 0.7 + i / 2) % 1; c.globalAlpha = 1 - q; stroke(c, spline([[-8 + i * 16, -34 - q * 20], [-2 + i * 16, -44 - q * 24], [-10 + i * 16, -56 - q * 28]], false, 4), 3); c.globalAlpha = 1; }
        break;
      }
      case 'pill': {
        c.rotate(-0.6); R(-40, -16, 80, 32, 16, 'paper', 3.6, 57); S([[0, -16], [24, -16], [40, -6], [40, 6], [24, 16], [0, 16]], a || 'red', 0, 58); stroke(c, [[0, -16], [0, 16]], 3.4, { taper: false });
        break;
      }
      case 'plant': {
        S([[-28, 10], [28, 10], [22, 50], [-22, 50]], a || 'red', 3.6, 59);
        for (const [x, y, r] of [[-22, -26, -0.6], [20, -32, 0.6], [0, -50, 0]]) S(xf(spline([[0, 0], [10, -18], [0, -40], [-10, -18]], true, 5), 0, 10, r, 1.1), 'green', 3.2, 60 + Math.round(x));
        break;
      }
      case 'house': {
        S([[-44, -6], [44, -6], [44, 50], [-44, 50]], a || 'paper', 3.8, 63); S([[-56, -4], [0, -50], [56, -4]], 'red', 3.8, 64);
        R(-12, 14, 24, 36, 2, 'blue', 3, 65); R(18, 6, 18, 18, 2, 'yellow', 2.6, 66);
        break;
      }
      case 'alarm': {   // a smoke alarm on the ceiling
        E(0, 0, 46, 16, a || 'paper', 3.8, 67); R(-30, -26, 60, 14, 4, 'faint', 3.2, 68);
        const blinkOn = Math.floor(tq * 4) % 2; dot(c, 26, 0, 5, 5, on && blinkOn ? 'red' : 'muted');
        if (on && blinkOn) for (let i = 0; i < 2; i++) stroke(c, ellP(0, 4, 60 + i * 16, 30 + i * 12, 16, 0.4, Math.PI - 0.4), 3.4, { taper: false });
        break;
      }
      case 'extinguisher': {
        R(-20, -40, 40, 90, 14, a || 'red', 3.8, 69, { shade: [{ pts: rrP(6, -40, 14, 90, 0), color: shade(a || 'red', 0.2) }] });
        R(-10, -56, 20, 18, 3, 'ink', 0, 70); stroke(c, spline([[8, -50], [30, -54], [36, -36], [30, -10]], false, 5), 5, { taper: false });
        R(-14, -10, 28, 24, 3, 'paper', 2.6, 71);
        break;
      }
      case 'toothbrush': {
        c.rotate(-0.4); R(-56, -6, 96, 12, 6, a || 'blue', 3.4, 72);
        for (let i = 0; i < 5; i++) R(14 + i * 6, -22, 4, 16, 1, 'paper', 1.6, 73 + i);
        break;
      }
      case 'apple': {
        S(spline([[0, -30], [26, -40], [42, -12], [32, 30], [0, 44], [-32, 30], [-42, -12], [-26, -40]], true, 5), a || 'red', 3.8, 78);
        stroke(c, [[0, -30], [4, -50]], 4.5); S(xf(spline([[0, 0], [10, -8], [24, -4], [10, 4]], true, 4), 4, -44, -0.3, 1), 'green', 2.6, 79);
        break;
      }
      case 'book': {
        S([[-48, -34], [-2, -40], [0, 34], [-46, 38]], a || 'blue', 3.6, 80); S([[48, -34], [2, -40], [0, 34], [46, 38]], a || 'blue', 3.6, 81);
        S([[-42, -36], [-2, -42], [-2, 28], [-40, 32]], 'paper', 2.6, 82); S([[42, -36], [2, -42], [2, 28], [40, 32]], 'paper', 2.6, 83);
        for (let i = 0; i < 4; i++) { stroke(c, [[-34, -22 + i * 12], [-10, -25 + i * 12]], 2.2, { taper: false }); stroke(c, [[10, -25 + i * 12], [34, -22 + i * 12]], 2.2, { taper: false }); }
        break;
      }
      case 'card': {
        R(-50, -32, 100, 64, 8, a || 'blue', 3.8, 84); R(-50, -18, 100, 12, 0, 'ink', 0, 85); R(-38, 8, 22, 16, 3, 'yellow', 2.4, 86);
        break;
      }
      case 'coin': {
        E(0, 0, 40, 40, a || 'yellow', 3.8, 87); E(0, 0, 30, 30, null, 2.6, 88);
        c.fillStyle = INK(); c.font = '400 38px "Archivo Black"'; c.textAlign = 'center'; c.fillText(String(o.text || '$'), 0, 14);
        break;
      }
      case 'bell': {
        const sw = Math.floor(tq * 8) % 2 ? 0.14 : -0.14; if (on) c.rotate(sw);
        S(spline([[-36, 26], [-28, -14], [0, -40], [28, -14], [36, 26]], false, 5).concat([[40, 30], [-40, 30]]), a || 'yellow', 3.8, 89);
        E(0, 36, 8, 8, 'ink', 0, 90);
        break;
      }
      case 'trash': {
        S([[-34, -30], [34, -30], [28, 46], [-28, 46]], a || 'muted', 3.8, 91); R(-40, -42, 80, 12, 4, a || 'muted', 3.6, 92);
        for (const x of [-14, 0, 14]) stroke(c, [[x, -18], [x * 0.9, 36]], 3, { taper: false });
        break;
      }
      case 'check': { E(0, 0, 44, 44, a || 'blue', 3.8, 93); stroke(c, [[-20, 0], [-6, 16], [22, -16]], 9, { color: 'paper', taper: false }); break; }
      case 'cross': { E(0, 0, 44, 44, a || 'red', 3.8, 94); stroke(c, [[-16, -16], [16, 16]], 9, { color: 'paper', taper: false }); stroke(c, [[16, -16], [-16, 16]], 9, { color: 'paper', taper: false }); break; }
      case 'star': { S(starP(0, 0, 48, 5, 0.45), a || 'yellow', 3.8, 95); break; }
      case 'heart': { S(spline([[0, 40], [-40, 6], [-44, -22], [-24, -38], [0, -22], [24, -38], [44, -22], [40, 6]], true, 5), a || 'red', 3.8, 96); break; }
      case 'warning': { S([[0, -48], [50, 40], [-50, 40]], a || 'yellow', 4, 97); stroke(c, [[0, -16], [0, 14]], 8, { taper: false }); dot(c, 0, 28, 5, 5); break; }
      default: { E(0, 0, 40, 40, a || 'yellow', 3.8, 98); }
    }
    c.restore();
  }

  /** thing(kind, x, y, o): an everyday object drawn the 1950s way (off-register flat colour, broken ink line), centred on
   *  (x, y), o.size px across (default 180). kind: 'phone' (o.screen: 'blank' 'check' 'code' 'wifi' 'call'; o.text),
   *  'laptop' (o.screen: 'blank' 'password' 'check'), 'router' (rings while o.on), 'lock' (o.open fn), 'key', 'shield',
   *  'door' (o.open 0..1 fn; o.hot: heat lines), 'flame', 'smoke', 'germ' (a little dot-eyed microbe), 'soap' (bubbles),
   *  'faucet' (o.on: running water), 'towel', 'clock' (o.time hours, fn), 'timer' (o.level 0..1 of a round countdown,
   *  fn), 'bulb' (o.on), 'plug', 'battery' (o.level), 'box', 'envelope', 'calendar' (o.text), 'cup', 'pill', 'plant',
   *  'house', 'alarm' (smoke alarm, blinks while o.on), 'extinguisher', 'toothbrush', 'apple', 'book', 'card', 'coin'
   *  (o.text), 'bell' (rings while o.on), 'trash', 'check', 'cross', 'star', 'heart', 'warning'. o: { size, color (main
   *  colour name), on, open, level, time, text, screen, face (eyes on a flame), rot (degrees, fn), bob (a gentle hop on
   *  twos), at, out }. x and y may be functions of lt. Returns the canvas. */
  B.thing = function (kind, x, y, o = {}) {
    const size = o.size ?? 180, s = size / 100, box = size * 1.9;
    return mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - box / 2, y: val(y, lt) - box / 2 }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), tq = step(lt);
      c.translate(box / 2, box / 2 - (o.bob ? (Math.floor(tq * 3) % 2) * 8 : 0));
      c.scale(s * k, s * k);
      if (o.rot) c.rotate(val(o.rot, lt) * Math.PI / 180);
      drawThing(c, val(kind, lt), { ...o, size: 1 }, lt);
    });
  };

  // ─────────────────────────── sets ───────────────────────────
  /** set(tint, o): the page's backdrop, called first: one flat colour plane for the wall, a darker floor band, a broken
   *  ink horizon line, and tone-on-tone mid-century shapes. It reaches past the frame edges. tint: 'yellow' (mustard,
   *  default) 'blue' (teal) 'red' (tomato) 'orange' 'green' (avocado) 'purple' (plum, for night) 'paper' (cream). o: {
   *  motif: 'room' (a window and a hanging lamp) 'kitchen' (a tiled backsplash and a counter) 'outdoor' (lollipop trees,
   *  kidney clouds) 'blocks' (two big abstract colour planes) 'night' (stars) 'plain'; floor (y of the horizon, default
   *  830), at (cut in), out } */
  B.set = function (tintName = 'yellow', o = {}) {
    const PADX = 200, PADY = 140, w = W + PADX * 2, hh = H + PADY * 2, floor = (o.floor ?? STAGE.area.y1 - 50) + PADY, motif = o.motif || 'plain';
    const base = tintName === 'paper' ? '#F3E6CC' : tint(tintName, 0.12), wallD = shade(base, 0.07), floorC = shade(base, 0.16);
    let cache = null;
    const cv = mountCanvas(this, w, hh, (lt) => {
      const tq = step(lt);
      if (o.at != null && tq < o.at) return null;
      if (o.out != null && tq >= o.out) return null;
      return { x: -PADX, y: -PADY };
    }, (c, lt) => {
      if (!cache) {
        cache = document.createElement('canvas'); cache.width = w; cache.height = hh; const g = cache.getContext('2d');
        g.fillStyle = base; g.fillRect(0, 0, w, hh);
        const X = (x) => PADX + x, Y = (y) => PADY + y;
        if (motif === 'room') {
          shape(g, rrP(X(W - 540), Y(150), 360, 300, 8), { fill: wallD, line: 0, off: false, grain: 0.3 });
          shape(g, rrP(X(W - 520), Y(170), 320, 260, 4), { fill: tint(base, 0.4), line: 4, off: [6, 4], lt: 0, seed: 101, grain: 0.3 });
          inkLine(g, [[X(W - 360), Y(170)], [X(W - 360), Y(430)]], 5, { breaks: 0.2, seed: 102 }); inkLine(g, [[X(W - 520), Y(300)], [X(W - 200), Y(300)]], 5, { breaks: 0.2, seed: 103 });
          inkLine(g, [[X(330), Y(-140)], [X(330), Y(120)]], 3, { taper: false, seed: 104 });
          shape(g, [[X(270), Y(190)], [X(390), Y(190)], [X(360), Y(120)], [X(300), Y(120)]], { fill: tint('red', 0.15), line: 4, off: [6, 4], seed: 105, grain: 0.4 });
          shape(g, boomP(X(860), Y(250), 120, 0.2), { fill: wallD, line: 0, off: false, grain: 0.2 });
        } else if (motif === 'kitchen') {
          for (let x = 0; x < w; x += 70) for (let y = floor - 300; y < floor - 120; y += 70) { g.fillStyle = ((x + y) / 70) % 2 ? wallD : base; g.fillRect(x, y, 70, 70); }
          shape(g, [[0, floor - 120], [w, floor - 120], [w, floor - 96], [0, floor - 96]], { fill: tint('blue', 0.1), line: 4, off: [6, 4], seed: 106, grain: 0.3 });
          shape(g, [[0, floor - 96], [w, floor - 96], [w, floor], [0, floor]], { fill: tint('paper', 0.2), line: 0, off: false, grain: 0.3 });
        } else if (motif === 'outdoor') {
          shape(g, kidneyP(X(W - 740), Y(250), 70, 0.1), { fill: tint(base, 0.55), line: 3, off: [6, 4], seed: 107, grain: 0.2 });
          shape(g, kidneyP(X(W - 360), Y(170), 54, -0.1), { fill: tint(base, 0.55), line: 3, off: [6, 4], seed: 108, grain: 0.2 });
          for (const [x, r, k] of [[110, 90, 0.16], [W - 180, 120, 0.12], [W - 50, 70, 0.22]]) { inkLine(g, [[X(x), floor], [X(x), floor - r * 2.2]], 7, { taper: false, seed: 109 + x }); shape(g, ellP(X(x), floor - r * 2.4, r * 0.8, r, 28), { fill: shade(base, k), line: 4, off: [6, 4], seed: 110 + x, grain: 0.4 }); }
        } else if (motif === 'blocks') {
          shape(g, [[X(-40), Y(120)], [X(760), Y(80)], [X(800), floor - PADY - 40 + PADY], [X(-40), floor]], { fill: wallD, line: 0, off: false, grain: 0.3 });
          shape(g, kidneyP(X(W - 500), Y(360), 330, 0.1), { fill: shade(base, 0.04), line: 0, off: false, grain: 0.3 });
        } else if (motif === 'night') {
          const r = PV.rng(77); for (let i = 0; i < 40; i++) sparkle(g, r() * w, r() * (floor - 200), 4 + r() * 10, 'paper', 0);
        }
        // floor band and the broken horizon line
        g.fillStyle = floorC; g.fillRect(0, floor, w, hh - floor);
        g.save(); g.globalAlpha = 0.5; g.fillStyle = g.createPattern(tooth(), 'repeat'); g.fillRect(0, 0, w, hh); g.restore();
        inkLine(g, [[0, floor], [w, floor]], 5, { breaks: 0.35, seed: 111, taper: false, wob: 0.25 });
        if (motif !== 'plain' && motif !== 'night') { g.fillStyle = shade(floorC, 0.1); for (let x = 60; x < w; x += 220) { g.beginPath(); g.ellipse(x, floor + 60 + (x % 3) * 30, 40, 6, 0, 0, TAU); g.fill(); } }
      }
      c.drawImage(cache, 0, 0);
      // a few tone-on-tone atomic sparkles that twinkle on twos
      if (o.sparkles !== false) { const r = PV.rng(31); for (let i = 0; i < 7; i++) { const x = r() * w, y = PADY + 80 + r() * (floor - PADY - 260), on = (Math.floor(lt * 6) + i) % 4 === 0; sparkle(c, x, y, on ? 18 : 10, motif === 'night' ? 'paper' : tint(tintName === 'paper' ? 'yellow' : 'paper', 0.1), 0); } }
    }, 1);
    cv.classList.add('mc-set');
    return cv;
  };

  // ─────────────────────────── the sunburst ───────────────────────────
  /** sunburst(x, y, o): the 1950s advertising "glory": radiating wedges from (x, y) that spin up when they arrive (a
   *  burst of speed that settles into a slow turn), drawn behind a step card, a reveal, a number or the presenter. Call it
   *  right after P.set so it sits behind everything. o: { tint (wedge colour name, default 'yellow'), n (wedges, 28), r
   *  (radius, default covers the frame), disc (radius of a cream disc at the centre, 0), at, out, spin (degrees a second
   *  once settled, default 9), alpha (0.6) } */
  B.sunburst = function (x, y, o = {}) {
    const r = o.r ?? 1500, at = o.at ?? 0, n = o.n ?? 28, PAD = 40;
    const bx = Math.max(-PAD, x - r), by = Math.max(-PAD, y - r), bw = Math.min(W + PAD, x + r) - bx, bh = Math.min(H + PAD, y + r) - by;
    const cv = mountCanvas(this, bw, bh, (lt) => { if (lt < at) return null; if (o.out != null && lt >= o.out + 0.3) return null; return { x: bx, y: by }; }, (c, lt) => {
      const t = Math.max(0, lt - at), grow = ease.out(clamp(t / 0.4)), fade = o.out != null ? 1 - clamp((lt - o.out) / 0.3) : 1;
      const rot = (o.rot0 ?? 0) + ((o.spin ?? 9) * t + 260 * 0.45 * (1 - Math.exp(-t / 0.45))) * Math.PI / 180;
      rays(c, x - bx, y - by, n, r * grow, o.tint || 'yellow', rot, 0, (o.alpha ?? 0.6) * fade);
      if (o.disc) shape(c, ellP(x - bx, y - by, o.disc * grow, o.disc * grow, 40), { fill: 'paper', line: 4, lt, seed: 121 });
    }, 1);
    cv.classList.add('mc-set');
    return cv;
  };

  // ─────────────────────────── step cards and titles ───────────────────────────
  /** stepcard(n, text, o): the signature move. "STEP 2" slams into the middle of the frame (a numbered ink disc, a
   *  letter-spaced STEP n OF N line, the step title in chunky lettering over a colour plate, on a cream card) while a
   *  sunburst spins up behind it; after a beat the rays fold into the disc and the card flies to the top left, where it
   *  stays as the page's header. Use it instead of P.title on every page that teaches one step. o: { of (number of steps,
   *  shows "STEP n OF N"), at (default 0.2), dock (when it flies to the corner; default at + 1.6; false keeps it centred),
   *  tint (plate and disc rim colour, default 'yellow'), burst (rays colour, default 'blue'; false for none), label
   *  (replaces "STEP": e.g. '第' or 'RULE'), out } */
  B.stepcard = function (n, text, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.2, dock = o.dock === false ? 1e9 : (o.dock ?? at + 1.6);
    const zh = /[㐀-鿿]/.test(text), ts = 84, title = String(text);
    const tw = PV.tw(title, ts) * (zh ? 1.04 : 1.12), capsTxt = zh ? `${o.label || '第'} ${n} 步${o.of ? ` · 共 ${o.of} 步` : ''}` : `${o.label || 'STEP'} ${n}${o.of ? ` OF ${o.of}` : ''}`;
    const MID = (STAGE.area.y0 + STAGE.area.y1) / 2 - 90, D = 170, gap = 34, cw = D + gap + Math.max(tw, PV.tw(capsTxt, 40) * 1.6) + 70, chh = 230;
    const sC = Math.min(1.35, (W - 360) / cw), sD = Math.min(0.62, 1000 / cw), dockX = STAGE.title.x - 48, dockY = STAGE.title.y - 44;
    const g = h('div', 'mc-step', null, T.html);
    Object.assign(g.style, { position: 'absolute', left: '0px', top: '0px', width: cw + 'px', height: chh + 'px', transformOrigin: '0 0', zIndex: 6 });
    const burst = o.burst === false ? null : (o.burst || 'blue');
    // the rays live on their own full-frame canvas under the card
    let raysCv = null;
    if (burst) {
      raysCv = mountCanvas(this, W + 80, H + 80, (lt) => (lt < at || lt > dock + 0.45 ? null : { x: -40, y: -40 }), (c, lt) => {
        const t = lt - at, k = ease.out(clamp(t / 0.35)), d = clamp((lt - dock) / 0.4), st = state(lt);
        const cx = st.x + (40 + D / 2) * st.s, cy = st.y + (chh / 2) * st.s;
        const rot = (8 * t + 220 * 0.4 * (1 - Math.exp(-t / 0.4))) * Math.PI / 180;
        c.translate(40, 40);
        c.fillStyle = C(o.field || 'paper'); c.globalAlpha = 0.92 * k * (1 - d); c.fillRect(-40, -40, W + 80, H + 80); c.globalAlpha = 1;
        rays(c, cx, cy, 28, 1500 * k * (1 - ease.in(d)), burst, rot, 0, 0.75);
      }, 0.75);
      // under everything drawn on the page except the set and its sunbursts, so the presenter stands in front of the rays
      const host = this.html, under = [...host.querySelectorAll(':scope > .mc-set')].pop();
      host.insertBefore(raysCv, under ? under.nextSibling : host.firstChild);
    }
    const card = mountCanvas({ html: g, tick: (f) => T.tick(f) }, cw, chh, () => ({ x: 0, y: 0 }), (c, lt) => {
      const k = clamp((lt - dock) / 0.4);
      // cream card behind everything (fades to a slimmer plate in the header)
      c.globalAlpha = 1 - k * 0.15;
      shape(c, rrP(8, 14, cw - 22, chh - 28, 26), { fill: 'paper', line: 4.5, lt, seed: 131 });
      c.globalAlpha = 1;
      // the numbered disc with a starburst rim
      const cx = 40 + D / 2, cy = chh / 2;
      shape(c, starP(cx, cy, D / 2 + 22, 16, 0.84, step(lt) * 0.6), { fill: o.tint || 'yellow', line: 3.5, lt, seed: 132 });
      shape(c, ellP(cx, cy, D / 2 - 6, D / 2 - 6, 40), { fill: 'ink', line: 0, lt, seed: 133, off: [0, 0], grain: 0.3 });
      sparkle(c, cx + D / 2 - 6, cy - D / 2 + 10, 16, 'paper', 0);
    }, 1.5);
    const num = h('div', 'mc-t display', esc(n), g);
    Object.assign(num.style, { left: '40px', top: (chh / 2 - 66) + 'px', width: D + 'px', textAlign: 'center', fontSize: '112px', color: C('paper') });
    const caps = h('div', 'mc-t caps', esc(capsTxt), g);
    Object.assign(caps.style, { left: (40 + D + gap) + 'px', top: '34px', fontSize: '40px', color: C('red') });
    const tt = plateText({ html: g, tick: (f) => T.tick(f) }, 'display', markup(title, o.hi), { plate: o.tint || 'yellow', size: ts, seed: 135 });
    Object.assign(tt.style, { left: (40 + D + gap) + 'px', top: '88px', fontSize: ts + 'px', fontWeight: zh ? '900' : '400' });
    function state(lt) {
      const tq = step(lt), t = tq - at;
      const cx = W / 2 - cw * sC / 2, cy = MID - chh * sC / 2;
      if (t < 0) return { x: cx, y: cy, s: 0, op: 0 };
      // slam: from 2.4× to 1× in three drawings, a squash, a one-drawing jolt
      let s = sC * (t < 0.17 ? lerp(2.4, 1, ease.in(t / 0.17)) : t < 0.25 ? 0.93 : t < 0.33 ? 1.04 : 1);
      let x = cx + (t >= 0.17 && t < 0.33 ? (Math.floor(t * 12) % 2 ? -8 : 8) : 0), y = cy;
      const d = ease.inOut(clamp((lt - dock) / 0.4));
      if (d > 0) { s = lerp(sC, sD, d); x = lerp(cx, dockX, d); y = lerp(cy, dockY, d); }
      if (o.out != null && lt >= o.out) return { x, y, s, op: 1 - clamp((lt - o.out) / 0.25) };
      return { x, y, s, op: t < 0.02 ? 0.4 : 1 };
    }
    T.tick((lt) => {
      const st = state(lt);
      g.style.display = st.s <= 0 || st.op <= 0 ? 'none' : '';
      g.style.opacity = st.op.toFixed(2);
      // the slam is at the centre of the card, not its corner
      const sx = st.x + cw * (sC - st.s) / 2 * (lt < dock ? 1 : 0), sy = st.y + chh * (sC - st.s) / 2 * (lt < dock ? 1 : 0);
      g.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${st.s.toFixed(4)})`;
    });
    // flying stars on the slam
    mountCanvas(T, 900, 900, (lt) => (lt < at + 0.15 || lt > at + 0.9 || lt > dock ? null : { x: W / 2 - 450, y: MID - 450 }), (c, lt) => {
      const q = clamp((lt - at - 0.15) / 0.75);
      for (let i = 0; i < 10; i++) { const an = i / 10 * TAU + 0.3, r = 200 + ease.out(q) * 260; sparkle(c, 450 + Math.cos(an) * r * 1.0, 450 + Math.sin(an) * r * 0.62, 22 * (1 - q), i % 2 ? 'red' : 'ink', 0); }
    }, 1).style.zIndex = 7;
    const hnd = { el: g, spans: [g], a: { dur: 0.4 }, hide: (t) => { o.out = t; return hnd; } };
    return hnd;
  };

  /** title(str, o): the page title, top left: an atomic sparkle and the title in chunky lettering over an off-register
   *  colour plate, with an optional letter-spaced kicker line above. On a step page use P.stepcard instead. o: { kick
   *  (small caps line above, e.g. 'RULE 1' or '小知识'), accent (plate colour name, default 'yellow'), at, size (54) } */
  Builder.prototype.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15;
    const el = h('div', 'mc-title', null, T.html);
    if (o.size) el.style.fontSize = o.size + 'px';
    const star = h('canvas', 'star', null, el); star.width = star.height = 88;
    const sc = star.getContext('2d');
    const box = h('div', null, `${o.kick ? `<span class="kick">${esc(o.kick)}</span>` : ''}<span class="tt">${esc(str)}</span>`, el);
    const tt = box.querySelector('.tt'), plate = C(o.accent || 'yellow');
    T.tick((lt) => {
      const k = pop(lt, at, o.out);
      el.style.opacity = k > 0.02 ? '1' : '0';
      el.style.transform = `translateX(${((1 - Math.min(1, k)) * -40).toFixed(1)}px) scale(${Math.max(0.01, tpop(k)).toFixed(3)})`;
      const [dx, dy] = reg(lt, 141, 0.8); tt.style.textShadow = `${dx.toFixed(1)}px ${dy.toFixed(1)}px 0 ${plate}`;
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, 88, 88); const on = Math.floor(lt * 4) % 2;
      sparkle(sc, 44, 44, on ? 42 : 34, 'red', 0);
    });
    const hnd = { el, spans: [el], a: { dur: 0.3 }, hide: (t) => { o.out = t; return hnd; } };
    return hnd;
  };

  /** medallion(n, x, y, o): a numbered stamp: an ink disc with a cream numeral inside a scalloped starburst rim; it thumps
   *  down at o.at (scale 1.6 → 1 in two drawings). For numbering items of a list, a rule, a count. o: { r (radius,
   *  default 64), tint (rim colour, default 'yellow'), label (a word under it), size (label px, 34), at, out } */
  B.medallion = function (n, x, y, o = {}) {
    const r = o.r ?? 64, box = r * 3.2, at = o.at ?? 0;
    const thump = (lt) => { const t = step(lt) - at; if (t < 0) return 0; if (o.out != null && lt >= o.out) return Math.max(0, 1 - (lt - o.out) / 0.2); return t < 0.09 ? 1.6 : t < 0.17 ? 0.94 : 1; };
    mountCanvas(this, box, box, (lt) => (thump(lt) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      const k = thump(lt); c.translate(box / 2, box / 2); c.scale(k, k);
      shape(c, starP(0, 0, r + 16, 18, 0.86, 0), { fill: o.tint || 'yellow', line: 3, lt, seed: 151 });
      shape(c, ellP(0, 0, r - 4, r - 4, 36), { fill: 'ink', line: 0, lt, seed: 152, off: [0, 0] });
      c.fillStyle = C('paper'); c.font = `400 ${Math.round(r * 1.1)}px "Archivo Black", "Noto Sans SC Variable"`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), 0, r * 0.06);
    });
    if (o.label) {
      const el = plateText(this, 'display', esc(o.label), { plate: o.tint || 'yellow', size: o.size ?? 34, seed: 153 });
      Object.assign(el.style, { left: x - 300 + 'px', width: '600px', textAlign: 'center', top: y + r + 26 + 'px', fontSize: (o.size ?? 34) + 'px' });
      this.tick((lt) => { const k = pop(lt, at + 0.1, o.out); el.style.opacity = k > 0.05 ? '1' : '0'; el.style.transform = `scale(${Math.max(0.01, tpop(k)).toFixed(3)})`; });
    }
  };

  // ─────────────────────────── call-outs, arrows, tags ───────────────────────────
  /** callout(x, y, r, o): the manual's round magnifier: a cream circle of radius r centred on (x, y) with an ink ring
   *  and a dashed leader line to the thing it details (o.to). Returns a child layer clipped to the circle: draw the
   *  close-up into it with the usual calls in stage coordinates (C.thing('soap', x, y, { size: 2 * r * 0.7 })). It pops
   *  open at o.at. o: { to: [x, y], fill (inside colour, default 'paper'), ring (ring colour, default 'ink'), label (a
   *  detail tag under the circle), at, out } */
  B.callout = function (x, y, r, o = {}) {
    const at = o.at ?? 0, to = o.to;
    const k = (lt) => pop(lt, at, o.out, 0.3);
    if (to) {
      const x0 = Math.min(x, to[0]) - 30, y0 = Math.min(y, to[1]) - 30, bw = Math.abs(to[0] - x) + 60, bh = Math.abs(to[1] - y) + 60;
      mountCanvas(this, bw, bh, (lt) => (lt < at ? null : { x: x0, y: y0 }), (c, lt) => {
        const u = clamp((lt - at) / 0.35), dx = to[0] - x, dy = to[1] - y, L = Math.hypot(dx, dy) || 1;
        const sx = x + dx / L * r, sy = y + dy / L * r, pts = []; for (let i = 0; i <= 20; i++) pts.push([lerp(sx, to[0], i / 20) - x0, lerp(sy, to[1], i / 20) - y0]);
        const P = sub(pts, u * (o.out != null && lt >= o.out ? 0 : 1)); const Ltot = plen(P);
        for (let d = 0; d < Ltot; d += 26) { const a = sub(P, d / Ltot), b = sub(P, Math.min(1, (d + 14) / Ltot)); stroke(c, [a[a.length - 1], b[b.length - 1]], 4.5, { taper: false }); }
        if (u >= 1) dot(c, to[0] - x0, to[1] - y0, 8, 8);
      }, 1);
    }
    const box = r * 2 + 40;
    mountCanvas(this, box, box, (lt) => (k(lt) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      c.translate(box / 2, box / 2); c.scale(Math.min(k(lt), 1.08), Math.min(k(lt), 1.08));
      shape(c, ellP(0, 0, r, r, 48), { fill: o.fill || 'paper', line: 0, lt, seed: 161 });
    });
    const L = this.layer();
    L.wrap.style.clipPath = `circle(${r - 4}px at ${x}px ${y}px)`;
    L.wrap.style.transformOrigin = `${x}px ${y}px`;
    this.tick((lt) => { const kk = k(lt); L.wrap.style.visibility = kk <= 0.01 ? 'hidden' : 'visible'; L.wrap.style.transform = `scale(${Math.min(kk, 1.08).toFixed(3)})`; });
    mountCanvas(this, box, box, (lt) => (k(lt) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      c.translate(box / 2, box / 2); c.scale(Math.min(k(lt), 1.08), Math.min(k(lt), 1.08));
      inkLine(c, ellP(0, 0, r, r, 60), 7, { closed: true, breaks: 0.2, seed: 162, color: C(o.ring || 'ink') });
      inkLine(c, ellP(-3, -3, r - 14, r - 14, 60, 3.6, 4.9), 5, { closed: false, seed: 163, color: 'rgba(255,250,235,0.7)' });
    });
    if (o.label) this.tag(x, y + r + 54, o.label, { at: at + 0.25, out: o.out, align: 'c' });
    return L;
  };

  /** swoosh(x1, y1, x2, y2, o): the moving manual arrow: a curved ink shaft that draws itself on, a fat tomato head, and
   *  a little pull-back on the beat. For "this goes there", "turn this way", "from here to here". o: { bend (sideways bow,
   *  fraction of the length, default 0.25; negative bows the other way), w (shaft px, 7), head (px, 36), color (head
   *  colour name, 'red'), dashed (dashed shaft), at, dur (draw-on, 0.5), out } */
  B.swoosh = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.5, bend = o.bend ?? 0.25, head = o.head ?? 36, w = o.w ?? 7;
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, mx = (x1 + x2) / 2 + nx * L * bend, my = (y1 + y2) / 2 + ny * L * bend;
    const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), cc = t * t; pts.push([a * x1 + b * mx + cc * x2, a * y1 + b * my + cc * y2]); }
    const [bx0, by0, bx1, by1] = bbox(pts), pad = head + 30;
    return mountCanvas(this, bx1 - bx0 + pad * 2, by1 - by0 + pad * 2, (lt) => (lt < at || (o.out != null && lt > o.out + 0.2) ? null : { x: bx0 - pad, y: by0 - pad }), (c, lt) => {
      c.translate(pad - bx0, pad - by0);
      if (o.out != null && lt > o.out) c.globalAlpha = 1 - clamp((lt - o.out) / 0.2);
      const u = ease.out(clamp((step(lt) - at) / dur)), bob = u >= 1 ? (Math.floor(lt * 4) % 2) * 0.04 : 0;
      const sh = sub(pts, u * (1 - bob));
      if (o.dashed) { const Lt = plen(sh); for (let d = 0; d < Lt * 0.92; d += w * 4) { const a = sub(sh, d / Lt), b = sub(sh, Math.min(0.92, (d + w * 2.4) / Lt)); stroke(c, [a[a.length - 1], b[b.length - 1]], w, { taper: false }); } }
      else stroke(c, sub(sh, 0.93), w, { seed: 171 });
      if (u > 0.15) {
        const tip = sh[sh.length - 1], pre = sub(pts, Math.max(0, u * (1 - bob) - 0.06)), p2 = pre[pre.length - 1], ang = Math.atan2(tip[1] - p2[1], tip[0] - p2[0]);
        const hs = head * ease.out(clamp((u - 0.15) / 0.35));
        shape(c, xf([[0, 0], [-hs * 1.1, -hs * 0.62], [-hs * 0.78, 0], [-hs * 1.1, hs * 0.62]], tip[0] + Math.cos(ang) * hs * 0.25, tip[1] + Math.sin(ang) * hs * 0.25, ang), { fill: o.color || 'red', line: 3.5, lt, seed: 172, breaks: 0 });
      }
    }, 1.25);
  };

  /** tag(x, y, text, o): a detail tag: a cream card with an ink border, a mustard plate printed off it and a teal star
   *  bullet, popping in on the action beat beside the thing it details ("20 秒", "50 cm clear", "Hold for one second").
   *  One short line (≤ 14 汉字 / ~6 words). o: { size (text px, 38), align: 'l' (x is the left edge, default) | 'c' |
   *  'r', tint (plate colour, 'yellow'), star (bullet colour, 'blue'), at, out } */
  B.tag = function (x, y, text, o = {}) {
    const size = o.size ?? 38, tw = PV.tw(String(text), size) * 1.06, bw = tw + size * 2.4, bh = size * 1.9;
    const left = o.align === 'c' ? x - bw / 2 : o.align === 'r' ? x - bw : x, top = y - bh / 2;
    const L = this.layer();
    mountCanvas(L, bw + 30, bh + 30, () => ({ x: left - 10, y: top - 10 }), (c, lt) => {
      c.translate(10, 10);
      shape(c, rrP(0, 0, bw, bh, 12), { fill: 'paper', line: 3.5, lt, seed: 181, off: [0, 0], grain: 0.3 });
      c.save(); c.globalCompositeOperation = 'destination-over'; const [dx, dy] = reg(lt, 182); path(c, mv(rrP(0, 0, bw, bh, 12), dx + 3, dy + 3)); c.fillStyle = C(o.tint || 'yellow'); c.fill(); c.restore();
      const r = size * 0.42, sx = size * 0.85, sy = bh / 2;
      shape(c, starP(sx, sy, r, 8, 0.38, step(lt) * 0.5), { fill: o.star || 'blue', line: 0, lt, seed: 183, off: [0, 0] });
    }, 1.5);
    const el = h('div', 'mc-t sans', esc(text), L.html);
    Object.assign(el.style, { left: left + size * 1.55 + 'px', top: top + bh / 2 - size * 0.62 + 'px', fontSize: size + 'px' });
    L.wrap.style.transformOrigin = `${left + bw / 2}px ${y}px`;
    this.tick((lt) => { const k = pop(lt, o.at ?? 0, o.out); L.wrap.style.opacity = k > 0.03 ? '1' : '0'; L.wrap.style.transform = `scale(${Math.max(0.01, tpop(k)).toFixed(3)})`; });
    return L;
  };

  // ─────────────────────────── lettering and numbers ───────────────────────────
  /** headline(text, x, y, o): big retro lettering in ink over an off-register colour plate: a kicker, a key word, a
   *  rule ("Meet the 20-second rule.", "低姿！"). {word} takes the hi colour. o: { size (px, 110), font: 'display'
   *  (chunky grotesque, default) | 'script' (a 1950s soft italic, written on left → right) | 'caps' (letter-spaced
   *  small caps), color (ink), plate (colour name, 'yellow'; false for none), hi ('red'), align: 'c' (default) | 'l' |
   *  'r', rot (degrees), at, out } */
  B.headline = function (text, x, y, o = {}) {
    const size = o.size ?? 110, font = o.font || 'display', at = o.at ?? 0;
    const el = plateText(this, font, markup(text, o.hi), { plate: o.plate, size, seed: 191 });
    const zh = /[㐀-鿿]/.test(text);
    Object.assign(el.style, { fontSize: size + 'px', color: C(o.color || 'ink'), top: (y - size * 0.6) + 'px', fontWeight: zh && font === 'display' ? '900' : '' });
    const tw = PV.tw(String(text).replace(/[{}]/g, ''), size) * (font === 'caps' ? 1.5 : 1.1);
    const left = o.align === 'l' ? x : o.align === 'r' ? x - tw : x - tw / 2;
    Object.assign(el.style, { left: left + 'px', width: tw + 'px', textAlign: o.align === 'l' ? 'left' : o.align === 'r' ? 'right' : 'center', transformOrigin: '50% 60%' });
    this.tick((lt) => {
      if (font === 'script') {
        const u = clamp((step(lt) - at) / Math.max(0.5, String(text).length * 0.05));
        el.style.clipPath = `inset(-20% ${((1 - u) * 100).toFixed(1)}% -30% -5%)`;
        el.style.opacity = lt >= at && !(o.out != null && lt >= o.out + 0.2) ? '1' : '0';
        el.style.transform = `rotate(${o.rot ?? -4}deg)`;
      } else {
        const k = pop(lt, at, o.out); el.style.opacity = k > 0.03 ? '1' : '0';
        el.style.transform = `scale(${Math.max(0.01, tpop(k)).toFixed(3)}) rotate(${o.rot ?? 0}deg)`;
      }
    });
    return el;
  };

  /** bignum(x, y, o): a big chunky number that counts up on twos and lands with a bump, over a colour plate, with its
   *  unit in letter-spaced caps beside it ("20 SECONDS", "8 位"). Set at to the moment the count starts, so it lands
   *  when the number is spoken. o: { to (the number), from (0), dur (0.8), decimals, unit, size (px, 200), plate
   *  ('yellow'), color ('ink'), align 'c' | 'l', at, out } */
  B.bignum = function (x, y, o = {}) {
    const size = o.size ?? 200, at = o.at ?? 0, dur = o.dur ?? 0.8;
    const row = h('div', 'mc-num', null, this.html);
    Object.assign(row.style, { position: 'absolute', left: x + 'px', top: y + 'px', display: 'flex', alignItems: 'baseline', gap: Math.round(size * 0.12) + 'px', whiteSpace: 'nowrap',
      transform: o.align === 'l' ? 'translate(0, -62%)' : 'translate(-50%, -62%)' });
    const el = plateText({ html: row, tick: (f) => this.tick(f) }, 'display', '', { plate: o.plate, size, seed: 201 });
    Object.assign(el.style, { position: 'relative', fontSize: size + 'px', color: C(o.color || 'ink'), transformOrigin: '50% 70%' });
    const zhU = o.unit && /[\u3400-\u9fff]/.test(o.unit);
    const unit = o.unit ? h('div', 'mc-t ' + (zhU ? 'display' : 'caps'), esc(o.unit), row) : null;
    if (unit) Object.assign(unit.style, { position: 'relative', fontSize: Math.round(size * (zhU ? 0.36 : 0.26)) + 'px', color: C(o.unitColor || 'red'), fontWeight: zhU ? '900' : '' });
    this.tick((lt) => {
      const tq = step(lt), u = clamp((tq - at) / dur), v = lerp(o.from ?? 0, o.to ?? 0, ease.out(u));
      el.textContent = v.toFixed(o.decimals ?? 0);
      const vis = tq >= at && !(o.out != null && lt >= o.out);
      row.style.opacity = vis ? '1' : '0'; if (unit) unit.style.opacity = u >= 1 ? '1' : '0';
      const land = tq - at - dur; el.style.transform = land >= 0 && land < 0.17 ? 'scale(1.12)' : 'scale(1)';
    });
    return row;
  };

  // ─────────────────────────── ornaments and shapes ───────────────────────────
  /** ornament(kind, x, y, o): a mid-century ornament: 'sparkle' (the four-point atomic star, twinkling on twos),
   *  'starburst' (a 12-point burst, e.g. behind a word or a price), 'atom' (three orbits and a nucleus), 'boomerang',
   *  'kidney', 'dots' (a cluster of polka dots). For filling a corner, celebrating a result, framing a word. o: { size
   *  (px, 120), color (colour name), spin (degrees a second), rot (degrees), at, out } */
  B.ornament = function (kind, x, y, o = {}) {
    const size = o.size ?? 120, box = size * 1.6;
    return mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), tq = step(lt), rot = ((o.rot ?? 0) + (o.spin ?? 0) * tq) * Math.PI / 180, r = size / 2;
      c.translate(box / 2, box / 2); c.scale(k, k); c.rotate(rot);
      const cl = o.color;
      if (kind === 'sparkle') { const on = Math.floor(tq * 6) % 3; sparkle(c, 0, 0, r * (on ? 1 : 0.75), cl || 'paper', 0); }
      else if (kind === 'starburst') shape(c, starP(0, 0, r, 12, 0.62, 0), { fill: cl || 'yellow', line: 3.5, lt, seed: 211 });
      else if (kind === 'atom') { for (let i = 0; i < 3; i++) inkLine(c, ellP(0, 0, r, r * 0.34, 40, 0, TAU, i * Math.PI / 3 + tq * 0.4), 3.5, { closed: true, breaks: 0.25, seed: 212 + i }); shape(c, ellP(0, 0, r * 0.18, r * 0.18, 16), { fill: cl || 'red', line: 0, lt, seed: 215 }); }
      else if (kind === 'boomerang') shape(c, boomP(0, 0, r, 0), { fill: cl || 'blue', line: 3.5, lt, seed: 216 });
      else if (kind === 'kidney') shape(c, kidneyP(0, 0, r, 0), { fill: cl || 'red', line: 3.5, lt, seed: 217 });
      else if (kind === 'dots') { const R = PV.rng(218); for (let i = 0; i < 9; i++) { const an = R() * TAU, rr = R() * r * 0.9; dot(c, Math.cos(an) * rr, Math.sin(an) * rr, 6 + R() * 8, 6 + R() * 8, cl || 'red'); } }
    }, 1.25);
  };

  /** shape(kind, x, y, o): any flat shape drawn the 1950s way (the colour cel off its broken ink line), for building
   *  objects the kit lacks out of 2–5 simple pieces (a road sign, a stove, a sofa). kind: 'circle' 'rect' (rounded by
   *  o.r) 'triangle' 'kidney' 'boomerang' 'star' 'drop' 'pts' (o.pts: a list of [x, y] relative to (x, y), smoothed when
   *  o.smooth). o: { w, h (size px, default 160), fill (colour name, 'yellow'), line (ink px, 4; 0 for none), shade (a
   *  colour for the darker right half), rot (degrees, fn), at, out } */
  B.shape = function (kind, x, y, o = {}) {
    const w = o.w ?? 160, hh = o.h ?? w, pad = 30;
    let pts;
    if (kind === 'circle') pts = ellP(0, 0, w / 2, hh / 2, 48);
    else if (kind === 'rect') pts = rrP(-w / 2, -hh / 2, w, hh, o.r ?? 8);
    else if (kind === 'triangle') pts = [[0, -hh / 2], [w / 2, hh / 2], [-w / 2, hh / 2]];
    else if (kind === 'kidney') pts = kidneyP(0, 0, w / 2, 0).map(([a, b]) => [a, b * hh / w]);
    else if (kind === 'boomerang') pts = boomP(0, 0, w / 2, 0).map(([a, b]) => [a, b * hh / w]);
    else if (kind === 'star') pts = starP(0, 0, w / 2, o.points ?? 5, 0.45);
    else if (kind === 'drop') pts = spline([[0, -hh / 2], [w * 0.3, 0], [w * 0.36, hh * 0.26], [0, hh / 2], [-w * 0.36, hh * 0.26], [-w * 0.3, 0]], true, 6);
    else pts = o.smooth ? spline(o.pts || [], true, 6) : (o.pts || []);
    const [a0, b0, a1, b1] = bbox(pts.length ? pts : [[0, 0]]), R = Math.max(Math.abs(a0), Math.abs(a1), Math.abs(b0), Math.abs(b1)) + pad, box = R * 2;
    return mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - R, y: val(y, lt) - R }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out); c.translate(R, R); c.scale(k, k); if (o.rot) c.rotate(val(o.rot, lt) * Math.PI / 180);
      shape(c, pts, { fill: o.fill || 'yellow', line: o.line ?? 4, lt, seed: o.seed ?? 221, shade: o.shade ? [{ pts: [[0, -R], [R, -R], [R, R], [0, R]], color: o.shade }] : null });
    }, 1.25);
  };

  // ─────────────────────────── hands, verdicts, splits, recaps ───────────────────────────
  /** glove(x, y, o): a big hand for an insert close-up (often inside a P.callout): 'point' presses a button, 'open'
   *  shows, 'flat' pats, 'grip' holds, 'thumb' approves. The wrist trails off toward o.from. o: { kind ('point'), size
   *  (px, 260), rot (degrees the fingers point, default -60 = up-right), press (time(s) of a press: pull back, push,
   *  recoil), skin, sleeve (colour name, 'orange'), at, out } */
  B.glove = function (x, y, o = {}) {
    const size = o.size ?? 260, s = size / 100, box = size * 2.2, ang = (o.rot ?? -60) * Math.PI / 180;
    return mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      const tq = step(lt); let push = 0;
      for (const pt of [].concat(o.press ?? [])) { const d = tq - pt; if (d > -0.35 && d < 0.4) push = d < -0.12 ? -1 : d < 0 ? 1 : d < 0.15 ? 1 : 1 - (d - 0.15) / 0.25; }
      c.translate(box / 2 + Math.cos(ang) * push * 14 * s, box / 2 + Math.sin(ang) * push * 14 * s); c.scale(s * Math.min(1, pop(lt, o.at ?? 0, o.out)), s * Math.min(1, pop(lt, o.at ?? 0, o.out)));
      // the sleeve trails back from the wrist
      const bx = -Math.cos(ang) * 120, by = -Math.sin(ang) * 120;
      c.lineCap = 'round'; c.strokeStyle = INK(); c.lineWidth = 34; c.beginPath(); c.moveTo(bx, by); c.lineTo(-Math.cos(ang) * 14, -Math.sin(ang) * 14); c.stroke();
      const [dx, dy] = reg(lt, 231, 0.3); c.strokeStyle = C(o.sleeve || 'orange'); c.lineWidth = 25; c.beginPath(); c.moveTo(bx + dx, by + dy); c.lineTo(-Math.cos(ang) * 22 + dx, -Math.sin(ang) * 22 + dy); c.stroke();
      hand(c, 0, 0, ang, o.kind || 'point', 1.6, C(o.skin || SKIN));
      if (push > 0.6 && o.press != null) for (let i = 0; i < 5; i++) { const a = ang + (i - 2) * 0.4; stroke(c, [[Math.cos(a) * 66, Math.sin(a) * 66], [Math.cos(a) * 84, Math.sin(a) * 84]], 3, { taper: false }); }
    }, 1.25);
  };

  /** verdict(kind, x, y, o): a big round stamp that thumps on: 'check' (teal disc, cream tick: do this, done), 'cross'
   *  (tomato disc, cream X: don't), 'ok' / 'no' (the words in a starburst). For do/don't, right/wrong, before/after.
   *  o: { size (px, 150), text (for ok / no, default 'OK' / 'NO'), at, out } */
  B.verdict = function (kind, x, y, o = {}) {
    const size = o.size ?? 150, box = size * 2, at = o.at ?? 0;
    const k = (lt) => { const t = step(lt) - at; if (t < 0) return 0; if (o.out != null && lt >= o.out) return Math.max(0, 1 - (lt - o.out) / 0.2); return t < 0.09 ? 1.7 : t < 0.17 ? 0.92 : 1; };
    return mountCanvas(this, box, box, (lt) => (k(lt) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      c.translate(box / 2, box / 2); c.scale(k(lt) * size / 100, k(lt) * size / 100); c.rotate(kind === 'cross' || kind === 'no' ? 0.12 : -0.12);
      if (kind === 'check' || kind === 'cross') drawThing(c, kind, { size: 1 }, lt);
      else { shape(c, starP(0, 0, 54, 14, 0.74, 0), { fill: kind === 'no' ? 'red' : 'blue', line: 3.5, lt, seed: 241 }); c.fillStyle = C('paper'); c.font = '400 30px "Archivo Black", "Noto Sans SC Variable"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.text || (kind === 'no' ? 'NO' : 'OK'), 0, 2); }
    }, 1.25);
  };

  /** split(o): the do / don't frame: two colour blocks slide in from the sides and meet in the middle, each with a header
   *  plate ("DO" ✓ / "DON'T" ✗, or your words). Draw the right way on the left half (centre x ≈ 520) and the wrong way on
   *  the right half (x ≈ 1400) with the usual calls after it; stamp them with P.verdict. o: { left (header text, 'DO'),
   *  right ("DON'T"), tints: [left colour, right colour] (default ['blue', 'red']), top (y, 190), bottom (y, 860), at,
   *  out } Returns { L: [x, y], R: [x, y] } (the centres of the two halves). */
  B.split = function (o = {}) {
    const at = o.at ?? 0, top = o.top ?? STAGE.area.y0 + 10, bot = o.bottom ?? STAGE.area.y1 - 20, tints = o.tints || ['blue', 'red'];
    mountCanvas(this, W, H, (lt) => (lt < at || (o.out != null && lt > o.out + 0.3) ? null : { x: 0, y: 0 }), (c, lt) => {
      const u = ease.out(clamp((step(lt) - at) / 0.4)), v = o.out != null ? 1 - clamp((lt - o.out) / 0.3) : 1;
      c.globalAlpha = v;
      shape(c, [[100 - (1 - u) * 900, top], [W / 2 - 12 - (1 - u) * 900, top], [W / 2 - 12 - (1 - u) * 900, bot], [100 - (1 - u) * 900, bot]], { fill: tint(tints[0], 0.35), line: 4, lt, seed: 251 });
      shape(c, [[W / 2 + 12 + (1 - u) * 900, top], [W - 100 + (1 - u) * 900, top], [W - 100 + (1 - u) * 900, bot], [W / 2 + 12 + (1 - u) * 900, bot]], { fill: tint(tints[1], 0.35), line: 4, lt, seed: 252 });
    }, 1);
    const hd = (txt, x, cl, d) => { const el = plateText(this, 'display', esc(txt), { plate: cl, size: 56, seed: 253 + d }); Object.assign(el.style, { left: x - 300 + 'px', width: '600px', textAlign: 'center', top: top + 26 + 'px', fontSize: '56px', color: C('ink') }); this.tick((lt) => { const k = pop(lt, at + 0.35 + d * 0.1, o.out); el.style.opacity = k > 0.03 ? '1' : '0'; el.style.transform = `scale(${Math.max(0.01, tpop(k)).toFixed(3)})`; }); };
    const xl = W / 4 + 44, xr = W * 3 / 4 - 44;
    hd(o.left || 'DO', xl, tints[0], 0); hd(o.right || "DON'T", xr, tints[1], 1);
    return { L: [xl, (top + bot) / 2 + 30], R: [xr, (top + bot) / 2 + 30] };
  };

  /** recap(items, o): the closing lockup: a row of 2–5 numbered medallions, each a coloured disc with its thing inside
   *  and a one-line label under it, stamped in one by one, then a tick on each. The frame to screenshot: hold it still
   *  3 s or more. items: [{ thing (a P.thing kind), label, color }]. It leaves x < 400 free for the presenter (facing right) by
   *  default. o: { x (centre of the row, 1080), w (row width, 1320), y (centre of the discs, 450), r (disc radius,
   *  up to 150), at, gap (seconds between stamps, 0.45), ticks (when the ticks land, default after the last stamp), tints
   *  (disc colours in turn), size (label px, 46), out } */
  B.recap = function (items, o = {}) {
    const n = items.length, y = o.y ?? STAGE.area.y0 + 270, r = o.r ?? Math.min(150, 1320 / n / 2.9), at = o.at ?? 0, gap = o.gap ?? 0.45;
    const tints = o.tints || ['blue', 'yellow', 'green', 'red', 'purple'], span = Math.min(o.w ?? 1320, n * r * 3.3), x0 = (o.x ?? W / 2 + 120) - span / 2 + span / n / 2;
    const ticksAt = o.ticks ?? at + n * gap + 0.4;
    items.forEach((it, i) => {
      const x = x0 + i * span / n, t = at + i * gap;
      if (i < n - 1) this.swoosh(x + r + 24, y - r * 0.2, x + span / n - r - 24, y - r * 0.2, { at: t + 0.2, bend: -0.25, dashed: true, w: 5, head: 24, out: o.out });
      const box = r * 2.6;
      mountCanvas(this, box, box, (lt) => (step(lt) < t || (o.out != null && lt > o.out + 0.2) ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
        const tt = step(lt) - t, k = tt < 0.09 ? 1.4 : tt < 0.17 ? 0.94 : 1;
        c.translate(box / 2, box / 2); c.scale(k, k);
        rays(c, 0, 0, 20, r * 1.22, 'paper', step(lt) * 0.3, r * 0.9, 0.9);
        shape(c, ellP(0, 0, r, r, 48), { fill: it.color || tints[i % tints.length], line: 4.5, lt, seed: 261 + i });
        c.save(); c.scale(r / 100 * 1.15, r / 100 * 1.15); drawThing(c, it.thing, { size: 1 }, lt); c.restore();
        shape(c, ellP(-r * 0.72, -r * 0.72, r * 0.3, r * 0.3, 24), { fill: 'ink', line: 0, lt, seed: 271 + i, off: [0, 0] });
        c.fillStyle = C('paper'); c.font = `400 ${Math.round(r * 0.36)}px "Archivo Black"`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), -r * 0.72, -r * 0.7);
        if (step(lt) >= ticksAt + i * 0.15) { c.save(); c.translate(r * 0.7, r * 0.66); const kk = step(lt) - ticksAt - i * 0.15 < 0.09 ? 1.5 : 1; c.scale(kk * 0.42, kk * 0.42); drawThing(c, 'check', { size: 1, color: 'green' }, lt); c.restore(); }
      }, 1.25);
      if (it.label) {
        const el = plateText(this, 'display', esc(it.label), { plate: 'paper', size: o.size ?? 46, seed: 281 + i });
        const zh = /[㐀-鿿]/.test(it.label);
        Object.assign(el.style, { left: x - span / n / 2 + 'px', width: span / n + 'px', whiteSpace: 'normal', textAlign: 'center', top: y + r + 34 + 'px', fontSize: (o.size ?? 46) + 'px', fontWeight: zh ? '900' : '' });
        this.tick((lt) => { const k = pop(lt, t + 0.12, o.out); el.style.opacity = k > 0.03 ? '1' : '0'; el.style.transform = `scale(${Math.max(0.01, tpop(k)).toFixed(3)})`; });
      }
    });
  };

  // ─────────────────────────── transitions ───────────────────────────
  /** wipe(o): the colour-block wipe that turns the manual's page: a flat colour plane slides across the whole frame on
   *  top of everything. mode 'in' (default) starts covered and slides away at o.at (a page opening); 'out' slides over
   *  the frame at o.at (a page ending). o: { mode, tint ('yellow'), dir: 'l' (moves left, default) | 'r' | 'u' (bottom
   *  up), at (0 for 'in'), dur (0.45) } */
  B.wipe = function (o = {}) {
    const T = this.hud || this, mode = o.mode || 'in', at = o.at ?? 0, dur = o.dur ?? 0.45, dir = o.dir || 'l';
    return mountCanvas(T, W + 80, H + 80, (lt) => {
      const u = ease.inOut(clamp((step(lt) - at) / dur)), cover = mode === 'in' ? 1 - u : u;
      if (cover <= 0.001) return null;
      const off = (1 - cover);
      return dir === 'u' ? { x: -40, y: -40 + off * (H + 80) * (mode === 'in' ? -1 : 1) } : { x: -40 + off * (W + 80) * ((dir === 'l') === (mode === 'in') ? -1 : 1), y: -40 };
    }, (c, lt) => {
      shape(c, [[30, 30], [W + 50, 30], [W + 50, H + 50], [30, H + 50]], { fill: o.tint || 'yellow', line: 6, lt, seed: 291 });
      sparkle(c, W / 2 + 40, H / 2 + 40, 60, 'paper', 0);
    }, 0.5);
  };

  /** iris(o): the circle that ends the film (or opens it): 'out' closes a cream-ringed circle onto a point (the
   *  presenter's face, the finished thing), 'in' opens one. o: { mode: 'in' | 'out' (default), at (for 'out' use
   *  P.endT - 0.8), dur (0.7), x, y (centre) } */
  B.iris = function (o = {}) {
    const T = this.hud || this, mode = o.mode || 'out', at = o.at ?? 0, dur = o.dur ?? 0.7, cx = o.x ?? W / 2, cy = o.y ?? H / 2;
    const Rmax = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 20;
    const cv = mountCanvas(T, W, H, (lt) => { const k = clamp((step(lt) - at) / dur); return (mode === 'in' ? k < 1 : step(lt) >= at) ? { x: 0, y: 0 } : null; }, (c, lt) => {
      const k = clamp((step(lt) - at) / dur), r = mode === 'in' ? ease.out(k) * Rmax : (1 - ease.inOut(k)) * Rmax;
      c.fillStyle = INK(); c.beginPath(); c.rect(0, 0, W, H); if (r > 1) c.arc(cx, cy, r, 0, TAU, true); c.fill('evenodd');
      if (r > 1) inkLine(c, ellP(cx, cy, r + 8, r + 8, 60), 12, { closed: true, color: C('yellow'), breaks: 0.15, seed: 301 });
    }, 0.5);
    cv.style.zIndex = 30;
    return cv;
  };

  // ─────────────────────────── the print layer (every frame) ───────────────────────────
  // print, not film: a static paper grain and a warm edge, no flicker, no scratches
  (function printLayer() {
    const frame = document.getElementById('frame');
    if (!frame) return;
    const cv = document.createElement('canvas'); cv.width = W / 2; cv.height = H / 2; cv.className = 'mc-print';
    Object.assign(cv.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 34, pointerEvents: 'none', mixBlendMode: 'multiply' });
    frame.appendChild(cv);
    const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height), r = PV.rng(5150);
    for (let i = 0; i < img.data.length; i += 4) { const v = 200 + r() * 55; img.data[i] = v; img.data[i + 1] = v * 0.96; img.data[i + 2] = v * 0.88; img.data[i + 3] = r() < 0.5 ? 18 : 0; }
    g.putImageData(img, 0, 0);
    const vg = g.createRadialGradient(cv.width / 2, cv.height * 0.47, cv.height * 0.42, cv.width / 2, cv.height / 2, cv.height * 1.02);
    vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(150,110,70,0.35)'); g.fillStyle = vg; g.fillRect(0, 0, cv.width, cv.height);
  })();
})();
