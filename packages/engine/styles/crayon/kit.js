/* Crayon picture book kit · wax crayon and oil pastel on cream drawing paper, the way a children's picture book is drawn.
 * Every mark is a crayon stroke: a wobbly ribbon with tapered ends and streaks, its wax catching only the peaks of the
 * paper's tooth (the paper shows through as speckles); colour goes in as back-and-forth zigzag scribbles that spill a
 * little past the outline; outlines are thick indigo. Everything is drawn on twos (12 drawings a second) and the lines
 * boil a little from drawing to drawing. Things that stand in front of the sky keep the paper behind them (a knock-out),
 * the way a child colours around a figure. Between pages the page turns like a book page (a corner lifts and peels).
 * Techniques adapted from crayon-book by LemoLab (MIT licence): wax-on-tooth adhesion as a pressure threshold on the
 * paper's tooth, ribbon strokes with taper, core and streaks, zigzag hatching with overshoot, boil on twos, the
 * knock-out. Re-implemented here on canvas for the PV.Builder engine; no code was copied. See NOTICE.md.
 * Every component is a pure function of page-local time lt. An option marked "fn" may be a value, a function of lt, or a
 * keyframe list [[t0, v0], [t1, v1], …] (the last entry whose time has passed wins). */
(function () {
  const { col, clamp, lerp, ease, h, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, TAU = Math.PI * 2;
  /** drawing number: 12 drawings a second, on twos */
  const DRAW = (lt) => Math.floor(lt * 12 + 1e-6);
  const Q = (lt) => DRAW(lt) / 12;
  const isKeys = (v) => Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && v[0].length === 2 && typeof v[0][0] === 'number';
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };
  const vn = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
  const n1 = (seed, x) => vn(x + seed * 17.31);
  let SEED = 1;

  // ─────────────────────────── colour ───────────────────────────
  const css = (c) => String(col(c) || c);
  const rgb = (c) => { const s = css(c).replace('#', ''); const f = s.length === 3 ? s.split('').map((x) => x + x).join('') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const darker = (c, k = 0.7) => { const [r, g, b] = rgb(c); return `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`; };
  /** the outline colour that goes with a fill: indigo, or a deeper crayon of the same hue for light things */
  const LINE = { yellow: 'orange', yellowF: 'orange', paper: 'ink', peach: 'brown' };

  // ─────────────────────────── the paper's tooth ───────────────────────────
  const CR = window.CRAYON;
  const N = CR.N, TOOTH = CR.tooth, SORTED = Float32Array.from(TOOTH).sort();
  const PITS = {};
  /** the pits a crayon at this pressure skips over (alpha 1 where the paper shows through) */
  function pitTile(press) {
    const lv = Math.round(clamp(press, 0.3, 1) * 10);
    if (PITS[lv]) return PITS[lv];
    const cov = 0.34 + 0.6 * (lv - 3) / 7, thr = SORTED[Math.floor(clamp(1 - cov, 0, 0.999) * SORTED.length)];
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N);
    for (let i = 0; i < TOOTH.length; i++) img.data[i * 4 + 3] = Math.round(255 * (1 - ss(thr - 0.05, thr + 0.05, TOOTH[i])));
    g.putImageData(img, 0, 0);
    return (PITS[lv] = cv);
  }
  function wax(g, press) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = g.createPattern(pitTile(press), 'repeat'); g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.restore();
  }
  /** paper behind a figure: fill the knock-out shapes underneath what is already drawn */
  function knock(g, polys) {
    if (!polys.length) return;
    g.save(); g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 1; g.fillStyle = g.createPattern(CR.paper, 'repeat');
    for (const p of polys) { g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.lineWidth = 10; g.lineJoin = 'round'; g.strokeStyle = g.fillStyle; g.stroke(); }
    g.restore();
  }

  // ─────────────────────────── geometry ───────────────────────────
  /** an ellipse as points, with a gentle hand wobble */
  const ell = (cx, cy, rx, ry, n = 40, seed = 0, wob = 0.03) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU, k = 1 + wob * (Math.sin(a * 2 + seed) * 0.6 + Math.sin(a * 3 + seed * 1.7) * 0.4); return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  /** Catmull-Rom through the points, sampled (closed by default) */
  function sm(pts, n = 6, closed = true) {
    const out = [], m = pts.length, g = (i) => pts[closed ? ((i % m) + m) % m : Math.max(0, Math.min(m - 1, i))];
    for (let i = 0; i < (closed ? m : m - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    if (!closed) out.push(pts[m - 1]);
    return out;
  }
  const tr = (pts, k, dx = 0, dy = 0, rot = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return pts.map(([x, y]) => [dx + (x * c - y * s) * k, dy + (x * s + y * c) * k]); };
  const starPts = (cx, cy, R, r, n = 5, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => { const a = rot + (i * Math.PI) / n, q = i % 2 ? r : R; return [cx + Math.cos(a) * q, cy + Math.sin(a) * q]; });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  /** a rounded rectangle as points */
  const rrect = (x0, y0, x1, y1, r) => { const out = []; const cs = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]]; for (const [cx, cy, a0] of cs) for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; };
  /** a tube of width w along a polyline (an arm, a stem, a handle), as a closed outline */
  function tube(path, w) {
    const L = [], R = [];
    path.forEach((p, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
      L.push([p[0] - ty * w / 2, p[1] + tx * w / 2]); R.push([p[0] + ty * w / 2, p[1] - tx * w / 2]);
    });
    const e = path[path.length - 1], s = path[0];
    const cap = (c, from, to) => { const out = []; const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]); for (let k = 1; k < 6; k++) { const a = a0 - (k / 6) * Math.PI; out.push([c[0] + Math.cos(a) * w / 2, c[1] + Math.sin(a) * w / 2]); } return out; };
    return [...L, ...cap(e, L[L.length - 1], R[R.length - 1]), ...R.reverse(), ...cap(s, R[R.length - 1], L[0])];
  }
  const bboxOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };

  // ─────────────────────────── a crayon line ───────────────────────────
  function resample(q, step) {
    const out = [q[0]], L = [0]; let tot = 0;
    for (let i = 1; i < q.length; i++) {
      const [ax, ay] = q[i - 1], [bx, by] = q[i], d = Math.hypot(bx - ax, by - ay); if (d < 1e-6) continue;
      const n = Math.max(1, Math.ceil(d / step));
      for (let j = 1; j <= n; j++) { out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]); tot += d / n; L.push(tot); }
    }
    return { p: out, L, tot };
  }
  function ribbon(g, P, Wd, k) {
    g.beginPath();
    for (let i = 0; i < P.length; i++) { const q = P[i], d = Wd[i] * 0.5 * k; i ? g.lineTo(q[0] + q[2] * d, q[1] + q[3] * d) : g.moveTo(q[0] + q[2] * d, q[1] + q[3] * d); }
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i], d = Wd[i] * 0.5 * k; g.lineTo(q[0] - q[2] * d, q[1] - q[3] * d); }
    g.closePath();
  }
  /** one wax stroke along pts: o { k (0..1 drawn), w, color, press, seed, v (boil drawing), closed, arrow, wob } */
  function cline(g, pts, o) {
    const k = o.k ?? 1; if (k <= 0 || pts.length < 2) return;
    const w = o.w ?? 7, pr = o.press ?? 0.95, seed = o.seed ?? 1, v = o.v ?? 0, bo = o.boil ?? 1, wob = o.wob ?? 1;
    const q = o.closed ? pts.concat(pts.slice(0, Math.max(2, Math.ceil(pts.length * 0.1)))) : pts;
    const R = resample(q, 3), n = R.p.length; if (n < 2) return;
    const lim = R.tot * k;
    const jx = (hash(seed * 3.1 + v * 7.7) - 0.5) * 1.6 * bo, jy = (hash(seed * 5.3 + v * 3.9) - 0.5) * 1.6 * bo;
    const P = [], Wd = [], tl = Math.min(R.tot * 0.22, 24);
    for (let i = 0; i < n; i++) {
      const s = R.L[i]; if (s > lim) break;
      const a = R.p[Math.max(0, i - 1)], b = R.p[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tn = Math.hypot(tx, ty) || 1; tx /= tn; ty /= tn;
      const off = n1(seed, s / 85) * 1.8 * wob + n1(seed + v * 1.37 + 11, s / 38) * 0.9 * bo;
      P.push([R.p[i][0] - ty * off + jx, R.p[i][1] + tx * off + jy, -ty, tx]);
      const e0 = clamp(s / (tl + 1e-3)), e1 = clamp((Math.min(lim, R.tot) - s) / (tl + 1e-3));
      Wd.push(w * (0.84 + 0.28 * n1(seed + 3, s / 55)) * (0.42 + 0.58 * Math.min(e0, e1)));
    }
    if (P.length < 2) return;
    const c = css(o.color || 'ink');
    g.fillStyle = c; g.strokeStyle = c; g.lineCap = 'round'; g.lineJoin = 'round';
    ribbon(g, P, Wd, 1); g.globalAlpha = pr * 0.62; g.fill();
    ribbon(g, P, Wd, 0.55); g.globalAlpha = pr * 0.4; g.fill();
    for (let s = 0; s < 2; s++) {
      const side = (hash(seed + s * 9.1) - 0.5) * 0.9;
      g.beginPath(); P.forEach((p, i) => { const d = side * Wd[i], x = p[0] + p[2] * d, y = p[1] + p[3] * d; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.lineWidth = Math.max(1, w * 0.2); g.globalAlpha = pr * 0.32; g.stroke();
    }
    if (o.arrow && k > 0.82) {
      const e = P[P.length - 1], b = P[Math.max(0, P.length - 6)], a = Math.atan2(e[1] - b[1], e[0] - b[0]), L = w * 2.6 + 16, kk = clamp((k - 0.82) / 0.18);
      for (const s of [-1, 1]) cline(g, [[e[0], e[1]], [e[0] - Math.cos(a + s * 0.55) * L * kk, e[1] - Math.sin(a + s * 0.55) * L * kk]], { w, color: o.color, press: pr, seed: seed + 40 + s, v, wob: 0.3 });
    }
    g.globalAlpha = 1;
  }

  // ─────────────────────────── scribbled colour ───────────────────────────
  /** keep the part of a polygon where x - sh * y lies on one side of u (Sutherland–Hodgman on a slanted line) */
  function clipU(poly, u, sh, keepGreater) {
    const out = [], f = (p) => p[0] - sh * p[1], inside = (p) => (keepGreater ? f(p) >= u : f(p) <= u);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) { const t = (u - f(a)) / (f(b) - f(a)); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  /** zigzag back-and-forth strokes filling a polygon, overshooting its edge: { paths, lens, total } */
  function hatchOne(poly, o) {
    const seed = o.seed ?? 1, ang = o.ang ?? 0.6, gap = o.gap ?? 10, over = o.over ?? 7, ca = Math.cos(ang), sa = Math.sin(ang);
    const rp = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
    let y0 = Infinity, y1 = -Infinity; for (const q of rp) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const rows = []; let y = y0 + gap * (0.3 + 0.3 * hash(seed)), r = 0;
    while (y < y1) {
      const xs = [];
      for (let i = 0; i < rp.length; i++) { const a = rp[i], b = rp[(i + 1) % rp.length]; if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
      xs.sort((a, b) => a - b);
      const spans = []; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1) spans.push([xs[i], xs[i + 1]]);
      if (spans.length) rows.push({ y, spans, r });
      r++; y += gap * (0.8 + 0.4 * hash(seed * 1.3 + r * 3.7));
    }
    const strokes = []; let cur = null, prev = null;
    for (const row of rows) {
      if (row.spans.length !== 1) { cur = null; prev = null; for (const s of row.spans) strokes.push([[s, row.y, row.r]]); continue; }
      const s = row.spans[0];
      if (cur && prev && s[0] < prev[1] && s[1] > prev[0]) cur.push([s, row.y, row.r]); else { cur = [[s, row.y, row.r]]; strokes.push(cur); }
      prev = s;
    }
    const paths = strokes.map((S, si) => {
      const pts = [];
      S.forEach(([s, yy, rr], k) => {
        const len = s[1] - s[0], ov = Math.min(over, len * 0.4);
        const oA = ov * (hash(seed + rr * 5.1 + 0.3) * 1.25 - 0.2), oB = ov * (hash(seed + rr * 2.3 + 0.7) * 1.25 - 0.2), yj = (hash(seed + rr * 1.7) - 0.5) * gap * 0.35;
        const a = [s[0] - oA, yy + yj], b = [s[1] + oB, yy + yj + (hash(seed + rr) - 0.5) * gap * 0.6];
        if ((k + si) % 2 === 0) pts.push(a, b); else pts.push(b, a);
      });
      return pts.map(([x, yy]) => [x * ca - yy * sa, x * sa + yy * ca]);
    });
    const lens = paths.map((pp) => { let l = 0; for (let i = 1; i < pp.length; i++) l += Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1]); return l; });
    return { paths, lens, total: lens.reduce((a, b) => a + b, 0) };
  }
  /** big areas are coloured patch by patch (a child doesn't scribble one stroke across a whole sky) */
  function hatch(poly, o) {
    const sh = 0.45, us = poly.map((p) => p[0] - sh * p[1]), u0 = Math.min(...us), u1 = Math.max(...us), bw = u1 - u0, pw = o.patch ?? 320;
    if (bw <= pw * 1.35) return hatchOne(poly, o);
    const n = Math.ceil(bw / pw), all = { paths: [], lens: [], total: 0 };
    for (let i = 0; i < n; i++) {
      const i2 = o.reverse ? n - 1 - i : i;
      const ua = u0 + (i2 * bw) / n + (i2 ? (hash((o.seed ?? 1) + i2) - 0.5) * 40 : -10), ub = u0 + ((i2 + 1) * bw) / n + (i2 < n - 1 ? (hash((o.seed ?? 1) + i2 + 1) - 0.5) * 40 : 10);
      const q = clipU(clipU(poly, ua, sh, true), ub, sh, false);
      if (q.length < 3) continue;
      const hg = hatchOne(q, { ...o, over: Math.min(o.over ?? 7, 6), seed: (o.seed ?? 1) + i2 * 7, ang: (o.ang ?? 0.6) + (hash((o.seed ?? 1) + i2 * 3.3) - 0.5) * 0.35 });
      all.paths.push(...hg.paths); all.lens.push(...hg.lens); all.total += hg.total;
    }
    return all;
  }
  function cutPath(pp, len) {
    const out = [pp[0]]; let acc = 0;
    for (let i = 1; i < pp.length; i++) {
      const d = Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1]);
      if (acc + d >= len) { const u = (len - acc) / d; out.push([lerp(pp[i - 1][0], pp[i][0], u), lerp(pp[i - 1][1], pp[i][1], u)]); return out; }
      acc += d; out.push(pp[i]);
    }
    return out;
  }
  function hatchDraw(g, hg, k, o) {
    if (k <= 0 || !hg.total) return;
    const w = o.w ?? 11, pr = o.press ?? 0.75, seed = o.seed ?? 1;
    let budget = hg.total * k;
    g.strokeStyle = css(o.color || 'red'); g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < hg.paths.length && budget > 0; i++) {
      const pp = budget >= hg.lens[i] ? hg.paths[i] : cutPath(hg.paths[i], budget); budget -= hg.lens[i];
      for (let j = 1; j < pp.length; j++) {
        const pj = pr * (0.72 + 0.42 * hash(seed * 0.37 + i * 13.1 + j * 0.71));
        g.beginPath(); g.moveTo(pp[j - 1][0], pp[j - 1][1]); g.lineTo(pp[j][0], pp[j][1]);
        g.globalAlpha = clamp(pj * 0.66); g.lineWidth = w; g.stroke();
        g.globalAlpha = clamp(pj * 0.32); g.lineWidth = w * 0.42; g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  /** a small round patch rubbed in with the side of the crayon: cheeks, eyes, dots, spots */
  function dab(g, x, y, rx, ry, color, press = 0.85, seed = 1) {
    g.fillStyle = css(color); g.strokeStyle = g.fillStyle; g.lineCap = 'round';
    g.globalAlpha = press * 0.72; g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU); g.fill();
    g.globalAlpha = press * 0.4; g.lineWidth = Math.max(1.2, rx * 0.35);
    for (let i = 0; i < 3; i++) { const a = hash(seed + i) * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(a) * rx * 0.8, y - Math.sin(a) * ry * 0.8); g.lineTo(x + Math.cos(a) * rx * 0.8, y + Math.sin(a) * ry * 0.8); g.stroke(); }
    g.globalAlpha = 1;
  }

  // ─────────────────────────── faces (child logic: anything can have one) ───────────────────────────
  const MOODS = ['happy', 'laugh', 'calm', 'sad', 'angry', 'surprised', 'sleepy', 'worried', 'shy'];
  /** a face centred on (x, y) of radius r: dot eyes with a white glint, rosy cheeks, a mouth for the mood */
  function face(g, x, y, r, mood, v, seed, look = 0, blink = false) {
    const er = Math.max(3.4, r * 0.1), ex = r * 0.36, ey = y - r * 0.06, lx = look * r * 0.14, lw = Math.max(2.6, r * 0.05);
    const L = (pts, extra) => cline(g, pts, { w: lw, color: 'ink', seed: seed++, v, wob: 0.25, ...extra });
    const closed = blink || mood === 'sleepy' || mood === 'calm';
    for (const s of [-1, 1]) {
      const cx = x + s * ex + lx;
      if (closed) L([[cx - er * 1.3, ey], [cx, ey + er * (mood === 'calm' ? -0.9 : 0.9)], [cx + er * 1.3, ey]].map((p) => p), { w: lw * 1.1 });
      else if (mood === 'laugh') L([[cx - er * 1.3, ey + er * 0.6], [cx, ey - er * 0.9], [cx + er * 1.3, ey + er * 0.6]]);
      else {
        const big = mood === 'surprised' ? 1.35 : 1;
        dab(g, cx, ey, er * 0.86 * big, er * 1.12 * big, 'ink', 1, seed++);
        g.fillStyle = css('paper'); g.globalAlpha = 0.95; g.beginPath(); g.arc(cx + er * 0.32, ey - er * 0.42, Math.max(1.2, er * 0.32), 0, TAU); g.fill(); g.globalAlpha = 1;
      }
      // brows
      const by = ey - er * 2.4;
      if (mood === 'angry') L([[cx - s * er * 1.6, by - er * 0.9], [cx + s * er * 0.9, by + er * 0.5]]);
      else if (mood === 'sad' || mood === 'worried') L([[cx - s * er * 1.4, by + er * 0.4], [cx + s * er * 1.0, by - er * 0.6]]);
      else if (mood === 'surprised') L([[cx - er * 1.2, by - er * 0.6], [cx, by - er * 1.1], [cx + er * 1.2, by - er * 0.6]]);
    }
    // cheeks
    const ck = mood === 'angry' ? 'red' : 'pink', cr = r * (mood === 'angry' || mood === 'shy' ? 0.2 : 0.15);
    for (const s of [-1, 1]) dab(g, x + s * r * 0.6 + lx, y + r * 0.2, cr, cr * 0.72, ck, mood === 'shy' ? 0.95 : 0.75, seed + s);
    // mouth
    const mx = x + lx, my = y + r * 0.32, mw = r * 0.22;
    if (mood === 'laugh') {
      const p = [[mx - mw * 1.2, my - mw * 0.25], [mx + mw * 1.2, my - mw * 0.25], [mx + mw * 0.7, my + mw * 0.75], [mx, my + mw * 0.95], [mx - mw * 0.7, my + mw * 0.75]];
      g.fillStyle = css('red'); g.globalAlpha = 0.85; g.beginPath(); p.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill(); g.globalAlpha = 1;
      L(p, { closed: true });
    } else if (mood === 'surprised') { dab(g, mx, my + mw * 0.2, mw * 0.45, mw * 0.55, 'red', 0.9, seed); L(ell(mx, my + mw * 0.2, mw * 0.5, mw * 0.62, 14), { closed: true }); }
    else if (mood === 'sad') L([[mx - mw, my + mw * 0.45], [mx, my - mw * 0.1], [mx + mw, my + mw * 0.45]]);
    else if (mood === 'angry') L([[mx - mw, my + mw * 0.35], [mx - mw * 0.3, my], [mx + mw * 0.3, my + mw * 0.1], [mx + mw, my + mw * 0.4]]);
    else if (mood === 'worried') L([[mx - mw, my + mw * 0.2], [mx - mw * 0.4, my - mw * 0.1], [mx + mw * 0.2, my + mw * 0.25], [mx + mw, my]]);
    else if (mood === 'sleepy') L(ell(mx, my + mw * 0.1, mw * 0.3, mw * 0.36, 12), { closed: true });
    else if (mood === 'shy' || mood === 'calm') L([[mx - mw * 0.6, my], [mx, my + mw * 0.3], [mx + mw * 0.6, my]]);
    else L([[mx - mw, my - mw * 0.1], [mx - mw * 0.4, my + mw * 0.45], [mx + mw * 0.4, my + mw * 0.45], [mx + mw, my - mw * 0.1]]);
  }

  // ─────────────────────────── a drawing: timed outline / colour / dab ops ───────────────────────────
  // op: { kind: 'fill', poly, hg, color, press, w, t0, dur, knock } | { kind: 'line', pts, closed, color, w, press, t0, dur,
  // arrow } | { kind: 'fn', t0, dur, draw(g, lt, v, k) }
  function renderOps(g, ops, lt, v, press) {
    const kn = [];
    for (const op of ops) {
      const k = clamp((lt - op.t0) / op.dur); if (k <= 0) continue;
      if (op.knock) kn.push(op.knock);
      if (op.kind === 'fill') hatchDraw(g, op.hg, k, op);
      else if (op.kind === 'line') cline(g, op.pts, { ...op, k: ease.out(k), v });
      else if (op.kind === 'fn') op.draw(g, lt, v, k);
    }
    wax(g, press);
    knock(g, kn);
  }
  /**
   * parts → ops. A part: { p (closed outline, or an open line with open: true), color (fill), line (outline colour,
   * false for none), fill (false: outline only), w (outline width), press, cross (a second colour scribbled across),
   * ang, gap, knock }. Timing: outlines are drawn first, one after another over `sketch`, then each part is coloured in.
   */
  function partOps(parts, o, scale = 1) {
    const at = o.at ?? 0, n = Math.max(1, parts.length), sketch = o.sketch ?? Math.min(1.2, 0.35 + 0.08 * n), fillAt = o.fill ?? at + sketch * 0.7;
    const stg = o.stagger ?? Math.min(0.2, 1.1 / n), fdur = o.dur ?? 0.7, seed0 = o.seed ?? (SEED += 37);
    const gap = o.gap ?? clamp(9 * scale, 5.5, 13), lw0 = o.lw ?? clamp(6.5 * scale, 3.4, 8.5), ops = [];
    parts.forEach((q, i) => {
      const seed = seed0 + i * 11, t0 = at + (sketch * 0.65 * i) / n, tl = Math.max(0.25, sketch * 0.6);
      if (q.open) { ops.push({ kind: 'line', pts: q.p, color: q.line || q.color || 'ink', w: q.w ?? lw0, press: q.press ?? 0.95, t0, dur: tl, seed, arrow: q.arrow }); return; }
      const knk = (q.knock ?? o.knock ?? true) ? q.p : null;
      if (q.fill !== false && q.color) {
        const sp = (q.spill ?? o.spill ?? 5) * Math.min(1.4, scale), dx = (hash(seed + 0.5) - 0.5) * 2 * sp, dy = (hash(seed + 0.9) - 0.5) * 2 * sp;
        const g2 = q.gap ?? gap, poly = q.p.map(([x, y]) => [x + dx, y + dy]);
        const tf = (q.fillAt ?? fillAt) + i * stg, fd = q.dur ?? fdur;
        ops.push({ kind: 'fill', hg: hatch(poly, { seed, ang: q.ang ?? (0.45 + hash(seed) * 0.6), gap: g2, over: g2 * 0.75 }), color: q.color, press: q.press ?? o.press ?? 0.8, w: g2 * 1.12, t0: tf, dur: fd, seed, knock: knk });
        if (q.cross) ops.push({ kind: 'fill', hg: hatch(poly, { seed: seed + 5, ang: (q.ang ?? 0.6) + 1.2, gap: g2 * 1.4, over: g2 * 0.5 }), color: q.cross, press: (q.press ?? 0.8) * 0.6, w: g2, t0: tf + fd * 0.6, dur: fd * 0.8, seed: seed + 5 });
        knk && (ops[ops.length - 1 - (q.cross ? 1 : 0)].knock = knk);
      }
      if (q.line !== false) ops.push({ kind: 'line', pts: q.p, closed: true, color: q.line || LINE[q.color] || 'ink', w: q.w ?? lw0, press: 1, t0, dur: tl, seed: seed + 3, knock: q.fill === false ? null : null });
      else if (knk && q.fill === false) ops.push({ kind: 'fn', t0, dur: 0.01, draw() {}, knock: knk });
    });
    return ops;
  }
  const opsEnd = (ops) => ops.reduce((m, op) => Math.max(m, op.t0 + op.dur), 0);
  const opsStart = (ops) => ops.reduce((m, op) => Math.min(m, op.t0), Infinity);

  // ─────────────────────────── mounting: one canvas per drawing ───────────────────────────
  /**
   * box [x0, y0, x1, y1] in the drawing's local coordinates; spec: { ops | ops(lt), render(g, lt, v), state(lt) → string,
   * end, start, pos(lt) → [x, y, rot, scale], press, live (redraw every drawing forever) }
   */
  function mount(self, o, box, spec) {
    const pad = 36, [x0, y0, x1, y1] = box, cw = Math.max(2, Math.ceil(x1 - x0 + pad * 2)), ch = Math.max(2, Math.ceil(y1 - y0 + pad * 2)), ox = pad - x0, oy = pad - y0;
    const cv = h('canvas', 'cr-cv', null, self.html); cv.width = cw; cv.height = ch;
    cv.style.transformOrigin = `${ox}px ${oy}px`; cv.style.opacity = '0';
    const g = cv.getContext('2d');
    const cache = new Map(); let last = null, lastTf = '', lastOp = '';
    const start = spec.start ?? (spec.ops && !(typeof spec.ops === 'function') ? opsStart(spec.ops) : o.at ?? 0);
    const end = spec.end ?? (spec.ops && typeof spec.ops !== 'function' ? opsEnd(spec.ops) : (o.at ?? 0) + 2);
    const press = spec.press ?? o.press ?? 0.85, boil = o.boil !== false;
    const paint = (ctx, lt, v) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.setTransform(1, 0, 0, 1, ox, oy);
      if (spec.render) spec.render(ctx, lt, v); else renderOps(ctx, typeof spec.ops === 'function' ? spec.ops(lt) : spec.ops, lt, v, press);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    self.tick((lt) => {
      let op = o.out != null ? 1 - ss(o.out, o.out + (o.outDur ?? 0.5), lt) : 1;
      op *= val(o.op, lt, 1);
      if (lt < start - 1e-4) op = 0;
      const os = op.toFixed(3); if (os !== lastOp) { cv.style.opacity = os; lastOp = os; }
      if (op <= 0.001) return;
      const [X, Y, R = 0, S = 1] = spec.pos ? spec.pos(lt) : [0, 0];
      const tf = `translate(${(X - ox).toFixed(1)}px, ${(Y - oy).toFixed(1)}px)${R ? ` rotate(${R.toFixed(4)}rad)` : ''}${S !== 1 ? ` scale(${S.toFixed(4)})` : ''}`;
      if (tf !== lastTf) { cv.style.transform = tf; lastTf = tf; }
      const q = Q(lt), v = boil ? DRAW(lt) % 3 : 0, sk = spec.state ? spec.state(q) : '';
      const live = spec.live || q < end;
      const key = live ? `L${DRAW(lt)}|${sk}` : `D${v}|${sk}`;
      if (key === last) return; last = key;
      if (live) { paint(g, q, v); return; }
      let c = cache.get(key);
      if (!c) { c = document.createElement('canvas'); c.width = cw; c.height = ch; paint(c.getContext('2d'), Math.max(q, end), v); cache.set(key, c); if (cache.size > 4) cache.delete(cache.keys().next().value); }
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); g.drawImage(c, 0, 0);
    });
    return { el: cv, hide(t, d = 0.5) { o.out = t; o.outDur = d; return this; } };
  }
  const group = (hs) => ({ parts: hs, hide(t, d = 0.5) { hs.forEach((x) => x && x.hide && x.hide(t, d)); return this; } });
  const bob = (o, lt, amp, seed) => (o.float ? Math.sin(Q(lt) * 2.2 + seed) * amp : 0);

  // ═══════════════════════════ components ═══════════════════════════

  /** crayon(parts, o): THE SIGNATURE MOVE — anything drawn in crayon in stage coordinates: thick wobbly outlines go down
   *  first, then colour is scribbled in stroke by stroke, zigzagging back and forth and spilling a little past the line.
   *  parts: one polygon [[x,y],…] or a list of { p: polygon, color, line (outline colour; false = none), fill (false =
   *  outline only), cross (a second crayon scribbled across, e.g. 'purple' over 'blue'), open (true: p is an open line),
   *  w, press (0.5 light … 1 heavy) }. Draw a road, a pond, a hill, a box, a cake, anything the kit lacks. o: { at,
   *  sketch (outline time), fill (when the colour goes in: put it on the word), dur (0.7 per part), color, knock (true:
   *  keeps paper behind it over a sky), press, out } */
  B.crayon = function (parts, o = {}) {
    const list = Array.isArray(parts[0]) && typeof parts[0][0] === 'number' ? [{ p: parts }] : parts.map((q) => (Array.isArray(q) ? { p: q } : q));
    const L = list.map((q) => ({ ...q, color: q.color ?? (q.open ? undefined : o.color || 'red') }));
    const ops = partOps(L, o, 1);
    const all = L.flatMap((q) => q.p), bb = bboxOf(all);
    return mount(this, o, [bb[0] - 20, bb[1] - 20, bb[2] + 20, bb[3] + 20], { ops });
  };

  /** lines(lines, o): crayon lines that draw themselves — one polyline [[x,y],…] or a list of them: sun rays, rain,
   *  grass, the path something travels, motion marks, a curvy arrow (arrow: true) for "goes to", "turns into", a cycle.
   *  o: { at, dur (0.6 per line), stagger (0.15), color ('ink'), w (7), press (0.95), arrow, smooth (true: a curve
   *  through the points), dashed (true: a dotted trail), out } */
  B.lines = function (lines, o = {}) {
    let L = Array.isArray(lines[0][0]) ? lines : [lines];
    if (o.smooth !== false) L = L.map((p) => (p.length > 2 ? sm(p, 8, false) : p));
    const at = o.at ?? 0, dur = o.dur ?? 0.6, st = o.stagger ?? 0.15, seed = SEED += 23, ops = [];
    L.forEach((p, i) => {
      if (o.dashed) {
        const R = resample(p, 4), seg = (o.w ?? 7) * 2.6, gapL = seg * 0.9; let s = 0, j = 0;
        const pts = R.p, Ls = R.L;
        while (s < R.tot) {
          const a = pts.filter((_, m) => Ls[m] >= s && Ls[m] <= s + seg);
          if (a.length > 1) ops.push({ kind: 'line', pts: a, color: o.color || 'ink', w: o.w ?? 7, press: o.press ?? 0.95, t0: at + i * st + (dur * s) / R.tot, dur: 0.12, seed: seed + i * 31 + j });
          s += seg + gapL; j++;
        }
      } else ops.push({ kind: 'line', pts: p, color: o.color || 'ink', w: o.w ?? 7, press: o.press ?? 0.95, t0: at + i * st, dur, seed: seed + i * 31, arrow: o.arrow });
    });
    const bb = bboxOf(L.flat());
    return mount(this, o, [bb[0] - 40, bb[1] - 40, bb[2] + 40, bb[3] + 40], { ops, press: o.press ?? 0.9 });
  };

  /** scribble(cx, cy, rx, o): a tangled, looping scribble that winds itself on — the way a child draws a mess, a cross
   *  mood, dust, a storm, germs' sticky plaque, or scribbles something out. o: { at, dur (1.0), ry (rx * 0.7), color
   *  ('ink'), w (5), loops (12), out } */
  B.scribble = function (cx, cy, rx, o = {}) {
    const ry = o.ry ?? rx * 0.7, loops = o.loops ?? 12, seed = SEED += 17, r = PV.rng(seed), pts = [];
    let px = 0, py = 0;
    for (let i = 0; i <= loops * 22; i++) {
      const t = (i / 22) * TAU, k = 0.55 + 0.45 * Math.abs(n1(seed, i / 30));
      px = lerp(px, (r() - 0.5) * rx * 0.9, 0.05); py = lerp(py, (r() - 0.5) * ry * 0.9, 0.05);
      pts.push([cx + px + Math.cos(t) * rx * 0.45 * k, cy + py + Math.sin(t) * ry * 0.45 * k]);
    }
    const ops = [{ kind: 'line', pts, color: o.color || 'ink', w: o.w ?? 5, press: 0.95, t0: o.at ?? 0, dur: o.dur ?? 1.0, seed }];
    return mount(this, o, [cx - rx - 30, cy - ry - 30, cx + rx + 30, cy + ry + 30], { ops, press: 0.85 });
  };

  // ─────────────────────────── things ───────────────────────────
  // each kind is drawn in a 200-unit box centred on (0, 0) (y down); main: the part that takes o.color
  const K = {
    star: () => ({ parts: [{ p: sm(starPts(0, 4, 100, 48), 4), color: 'yellow', main: 1 }], face: [0, 12, 44] }),
    heart: () => ({ parts: [{ p: Array.from({ length: 48 }, (_, i) => { const t = (i / 48) * TAU; return [16 * Math.sin(t) ** 3 * 6, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 6 - 6]; }), color: 'red', main: 1 }], face: [0, -6, 52] }),
    cloud: (o) => {
      const p = []; for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU, top = Math.sin(a) < 0.15; const k = top ? 1 + 0.16 * Math.abs(Math.sin(a * 3.5)) : 0.9; p.push([Math.cos(a) * 104 * k, Math.sin(a) * 60 * k + 6]); }
      return { parts: [{ p, color: o.storm ? 'muted' : 'paper', line: o.storm ? 'soft' : 'blue', main: 1, press: 0.95 }], face: [0, 12, 46] };
    },
    drop: () => ({ parts: [{ p: sm([[0, -100], [30, -40], [64, 22], [52, 74], [0, 98], [-52, 74], [-64, 22], [-30, -40]], 5), color: 'blue', line: 'ink', main: 1 }], extra: [{ dab: [-28, 20, 10, 18, 'paper'] }], face: [0, 40, 46] }),
    tree: (o) => ({ parts: [{ p: sm([[-20, 100], [-14, 30], [-12, 0], [12, 0], [14, 30], [22, 100]], 3), color: 'brown' },
      { p: Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * TAU, k = 1 + 0.1 * Math.abs(Math.sin(a * 4)); return [Math.cos(a) * 90 * k, -40 + Math.sin(a) * 74 * k]; }), color: 'green', main: 1 }],
    extra: o.apples === false ? [] : [[-40, -60], [30, -20], [10, -80], [-20, 0], [55, -55]].map(([x, y]) => ({ dab: [x, y, 11, 11, 'red'] })), face: [0, -40, 50] }),
    flower: () => {
      const parts = [{ p: [[0, 100], [4, 50], [0, -10]], open: true, line: 'green', w: 8 }, { p: sm([[4, 60], [40, 38], [62, 46], [38, 66]], 4), color: 'green' }];
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU - Math.PI / 2; parts.push({ p: ell(Math.cos(a) * 40, -40 + Math.sin(a) * 40, 28, 28, 18, i), color: 'pink', main: 1 }); }
      parts.push({ p: ell(0, -40, 24, 24, 20, 3), color: 'yellow' });
      return { parts, face: [0, -40, 22] };
    },
    sprout: () => ({ parts: [{ p: sm([[-90, 100], [-60, 66], [0, 56], [60, 66], [90, 100]], 4), color: 'brown' }, { p: [[0, 64], [-2, 10], [0, -30]], open: true, line: 'green', w: 9 },
      { p: sm([[0, -26], [-30, -60], [-82, -62], [-56, -26]], 4), color: 'green', main: 1 }, { p: sm([[0, -30], [24, -76], [76, -88], [56, -40]], 4), color: 'green', main: 1 }], face: null }),
    seed: () => ({ parts: [{ p: ell(0, 0, 50, 70, 30, 2), color: 'brown', main: 1 }, { p: [[0, -50], [6, 0], [0, 48]], open: true, line: 'ink', w: 4 }], face: [0, 4, 36] }),
    house: () => ({ parts: [{ p: rect(-92, -6, 46, 100), color: 'yellow', main: 1 }, { p: [[46, -6], [104, -34], [104, 72], [46, 100]], color: 'orange' },
      { p: [[-108, -2], [-24, -98], [62, -2]], color: 'red' }, { p: [[-24, -98], [40, -122], [122, -34], [62, -2]], color: 'red', press: 0.65 },
      { p: rect(-64, 36, -28, 100), color: 'brown' }, { p: rect(-10, 16, 30, 52), color: 'blue' }, { p: [[10, 16], [10, 52]], open: true, w: 4 }, { p: [[-10, 34], [30, 34]], open: true, w: 4 }], face: null }),
    tooth: () => ({ parts: [{ p: sm([[-80, -50], [-64, -88], [-30, -90], [0, -74], [30, -90], [64, -88], [80, -50], [76, 0], [62, 40], [56, 92], [36, 100], [22, 58], [0, 30], [-22, 58], [-36, 100], [-56, 92], [-62, 40], [-76, 0]], 4), color: 'paper', line: 'ink', main: 1, press: 1 }], face: [0, -22, 52] }),
    toothbrush: () => ({ parts: [{ p: sm(rrect(-100, -10, 46, 14, 10), 2), color: 'blue', main: 1 }, { p: sm(rrect(30, -16, 100, 12, 8), 2), color: 'blue', main: 1 },
      { p: rect(38, -50, 96, -16), color: 'paper', press: 1 }, ...[46, 58, 70, 82].map((x) => ({ p: [[x, -48], [x + 2, -18]], open: true, w: 3, line: 'muted' })),
      { p: sm([[38, -50], [46, -72], [64, -66], [80, -76], [98, -62], [96, -50]], 4), color: 'blueF' }], face: null }),
    germ: () => {
      const p = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, k = 1 + 0.12 * Math.sin(a * 7); p.push([Math.cos(a) * 72 * k, Math.sin(a) * 66 * k]); }
      const spikes = Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * TAU + 0.3; return { p: [[Math.cos(a) * 70, Math.sin(a) * 64], [Math.cos(a) * 98, Math.sin(a) * 92]], open: true, w: 6, line: 'ink' }; });
      return { parts: [...spikes, { p, color: 'green', main: 1 }], extra: [[-40, -34], [44, -30], [30, 40], [-46, 34]].map(([x, y]) => ({ dab: [x, y, 9, 8, 'purple'] })), face: [0, 2, 50], mood: 'angry' };
    },
    apple: () => ({ parts: [{ p: sm([[0, -50], [40, -76], [84, -48], [90, 14], [58, 84], [0, 90], [-58, 84], [-90, 14], [-84, -48], [-40, -76]], 5), color: 'red', main: 1 }, { p: [[0, -50], [6, -92]], open: true, line: 'brown', w: 8 }, { p: sm([[8, -76], [40, -104], [70, -96], [44, -70]], 4), color: 'green' }], face: [0, 14, 54] }),
    candy: () => ({ parts: [{ p: [[-50, 0], [-100, -40], [-94, 0], [-100, 40]], color: 'yellow' }, { p: [[50, 0], [100, -40], [94, 0], [100, 40]], color: 'yellow' }, { p: ell(0, 0, 56, 56, 30, 1), color: 'pink', main: 1 }, { p: sm([[-30, -30], [10, -40], [36, -6], [10, 30], [-24, 20], [-10, -6], [10, 0]], 5, false), open: true, line: 'red', w: 6 }], face: null }),
    earth: () => ({ parts: [{ p: ell(0, 0, 96, 96, 44, 1, 0.015), color: 'blue', main: 1 }, { p: sm([[-60, -50], [-20, -66], [0, -40], [-16, -6], [-50, 0], [-72, -20]], 4), color: 'green', line: false }, { p: sm([[20, 10], [60, 0], [70, 40], [40, 70], [14, 50]], 4), color: 'green', line: false }, { p: sm([[-60, 40], [-30, 34], [-34, 64], [-60, 64]], 4), color: 'green', line: false }], face: [0, 0, 56] }),
    bed: () => ({ parts: [{ p: rect(-104, -70, -84, 96), color: 'brown' }, { p: rect(84, -10, 100, 96), color: 'brown' }, { p: rect(-90, 10, 96, 58), color: 'paper', press: 1 }, { p: sm(rrect(-84, -12, -30, 18, 14), 2), color: 'paper', press: 1 }, { p: sm([[-24, -8], [96, -8], [100, 50], [-20, 50]], 3), color: 'blue', cross: 'purple', main: 1 }], face: null }),
    book: () => ({ parts: [{ p: [[-104, -56], [104, -56], [104, 74], [-104, 74]], color: 'red', main: 1 }, { p: [[-96, -64], [0, -44], [0, 70], [-96, 58]], color: 'paper', press: 1 }, { p: [[96, -64], [0, -44], [0, 70], [96, 58]], color: 'paper', press: 1 },
      ...[-30, -6, 18].flatMap((y) => [{ p: [[-80, y - 14], [-16, y]], open: true, w: 3, line: 'muted' }, { p: [[16, y], [80, y - 14]], open: true, w: 3, line: 'muted' }])], face: null }),
    umbrella: () => { const p = []; for (let i = 0; i <= 24; i++) { const a = Math.PI + (i / 24) * Math.PI; p.push([Math.cos(a) * 100, -6 + Math.sin(a) * 84]); } for (let i = 4; i >= 0; i--) { const x = -100 + i * 50; p.push([x + 25, 4], [x, -6]); }
      return { parts: [{ p: [[0, -6], [0, 84], [-4, 96], [-22, 98], [-28, 86]], open: true, line: 'brown', w: 8 }, { p, color: 'red', main: 1 }, { p: [[0, -90], [0, -6]], open: true, w: 4 }], face: null }; },
    balloon: () => ({ parts: [{ p: sm([[0, -10], [-8, 30], [6, 60], [-4, 100]], 6, false), open: true, line: 'ink', w: 3.5 }, { p: [[-10, 0], [10, 0], [0, -14]], color: 'red' }, { p: ell(0, -74, 58, 70, 36, 2), color: 'red', main: 1 }], extra: [{ dab: [-24, -100, 9, 16, 'paper'] }], face: [0, -74, 44] }),
    cup: () => ({ parts: [{ p: sm([[50, -20], [92, -18], [92, 40], [50, 50]], 4, false), open: true, line: 'ink', w: 9 }, { p: sm([[-62, -50], [56, -50], [48, 90], [-54, 90]], 2), color: 'blue', main: 1 }, { p: ell(-3, -50, 58, 12, 24, 1), color: 'paper', press: 1 }], face: [-3, 22, 40] }),
    torch: (o) => { const L = o.beam ?? 1; return { parts: [{ p: [[36, -40], [36 + 220 * L, -40 - 90 * L], [36 + 220 * L, 40 + 90 * L], [36, 40]], color: 'yellowF', line: false, press: 0.55, knock: false }, { p: sm(rrect(-100, -22, 6, 22, 10), 2), color: 'blue', main: 1 }, { p: [[0, -24], [36, -42], [36, 42], [0, 24]], color: 'faint' }], face: null }; },
    ball: () => ({ parts: [{ p: ell(0, 0, 90, 90, 40, 2), color: 'red', main: 1 }, { p: sm([[-60, -66], [-10, -20], [20, 40], [40, 82], [72, 50], [40, -10], [10, -60], [-20, -86]], 4), color: 'yellow', line: false }], face: null }),
    bird: () => ({ parts: [{ p: [[-60, 0], [-100, -20], [-96, 20]], color: 'blue' }, { p: [[10, 50], [6, 92]], open: true, line: 'orange', w: 5 }, { p: [[30, 50], [30, 92]], open: true, line: 'orange', w: 5 }, { p: ell(10, 4, 72, 60, 36, 3), color: 'blue', main: 1 }, { p: ell(24, 22, 40, 30, 24, 4), color: 'paper', line: false, press: 1 }, { p: sm([[-30, -6], [10, 10], [-10, 36], [-44, 22]], 4), color: 'blueF' }, { p: [[76, -14], [104, -4], [76, 8]], color: 'orange' }], face: [44, -14, 30] }),
    volcano: () => ({ parts: [{ p: [[-104, 100], [-36, -48], [36, -48], [104, 100]], color: 'brown', cross: 'orange', main: 1 }, { p: sm([[-40, -48], [-20, -74], [6, -62], [24, -80], [42, -50], [26, -30], [16, 6], [4, -28], [-14, 18], [-24, -30]], 4), color: 'red', cross: 'orange' }], face: [0, 30, 50] }),
    clock: () => ({ parts: [{ p: ell(0, 0, 96, 96, 44, 2, 0.015), color: 'paper', line: 'ink', main: 1, press: 1 }], extra: Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU; return { dab: [Math.cos(a) * 76, Math.sin(a) * 76, 5, 5, 'ink'] }; }), face: null }),
    rainbow: () => ({ parts: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map((c, i) => { const r0 = 100 - i * 13, r1 = r0 - 13, p = []; for (let k = 0; k <= 24; k++) { const a = Math.PI + (k / 24) * Math.PI; p.push([Math.cos(a) * r0, 50 + Math.sin(a) * r0]); } for (let k = 24; k >= 0; k--) { const a = Math.PI + (k / 24) * Math.PI; p.push([Math.cos(a) * r1, 50 + Math.sin(a) * r1]); } return { p, color: c, line: false, knock: false, ang: 1.2 }; }), face: null }),
    carrot: () => ({ parts: [{ p: [[0, -40], [-30, -96], [-6, -60]], color: 'green' }, { p: [[0, -40], [30, -100], [8, -58]], color: 'green' }, { p: sm([[-40, -46], [40, -46], [10, 90], [-4, 96]], 3), color: 'orange', main: 1 }], face: [0, -4, 30] }),
    bulb: () => ({ parts: [{ p: sm([[-30, 40], [-60, -10], [-56, -64], [0, -96], [56, -64], [60, -10], [30, 40]], 4), color: 'yellow', main: 1 }, { p: rect(-30, 40, 30, 84), color: 'muted' }], face: [0, -30, 44] }),
    gift: () => ({ parts: [{ p: rect(-80, -30, 80, 96), color: 'red', main: 1 }, { p: rect(-92, -56, 92, -24), color: 'red', main: 1 }, { p: rect(-14, -56, 14, 96), color: 'yellow', line: false }, { p: sm([[0, -56], [-50, -96], [-60, -70], [0, -56], [50, -96], [60, -70]], 3, false), open: true, line: 'yellow', w: 10 }], face: null }),
    moonlet: () => ({ parts: [{ p: ell(0, 0, 90, 90, 40, 2), color: 'yellow', main: 1 }], face: [0, 0, 56] }),
    disc: (o) => ({ parts: [{ p: ell(0, 0, 100, 100 * (o.squash ?? 1), 44, o.seed ?? 3, 0.02), color: 'red', main: 1 }], face: [0, 0, 60] }),
  };
  const KINDS = Object.keys(K).filter((k) => k !== 'disc' && k !== 'moonlet');

  /** thing(kind, x, y, o): a picture-book object centred on (x, y), about o.size px across (default 220), drawn and
   *  coloured in crayon. Kinds: star heart cloud drop tree flower sprout seed house tooth toothbrush germ apple candy earth
   *  bed book umbrella balloon cup torch (with a cone of light, beam: 0..1.5) ball bird volcano clock rainbow carrot bulb
   *  gift. Child logic: give any thing a face (face: true, mood: happy laugh calm sad angry surprised sleepy worried
   *  shy; fn) when it is a character in the idea. o: { at, size, color (its main colour), face, mood, x/y (fn: it travels),
   *  rot (fn, radians), scale (fn: it grows), float (bobs gently), time (clock: hours, fn), dirty (tooth: 0..1 plaque, fn),
   *  erupt (volcano: 0..1 lava burst, fn), rain (cloud: when rain starts falling), storm (grey cloud), apples (tree),
   *  look (-1 | 1: eyes to one side), out } */
  B.thing = function (kind, x, y, o = {}) {
    const gen = K[kind] || K.disc, spec = gen(o), size = o.size ?? 220, k = size / 200, seed = SEED += 41;
    const parts = spec.parts.map((q) => ({ ...q, p: tr(q.p, k), color: q.main && o.color ? o.color : q.color }));
    const ops = partOps(parts, o, k);
    const tEnd = opsEnd(ops), at = o.at ?? 0;
    // dabs (apples, spots, glints) and the face go on top once the colour is in
    for (const e of spec.extra || []) if (e.dab) { const [dx, dy, rx, ry, c] = e.dab; ops.push({ kind: 'fn', t0: tEnd - 0.2, dur: 0.2, draw: (g) => dab(g, dx * k, dy * k, rx * k, ry * k, c, 0.95, seed + dx) }); }
    if (kind === 'tooth') {
      const spots = [[-40, -50], [30, -46], [0, -30], [-50, -10], [48, -8], [-20, 10], [22, 16]];
      ops.push({ kind: 'fn', t0: at, dur: 0.01, draw: (g, lt) => { const d = val(o.dirty, lt, 0), n = Math.round(d * spots.length); spots.slice(0, n).forEach(([dx, dy], i) => dab(g, dx * k, dy * k, 15 * k, 12 * k, i % 2 ? 'yellow' : 'brownF', 0.95, seed + i)); } });
    }
    if (kind === 'clock') ops.push({ kind: 'fn', t0: tEnd - 0.3, dur: 0.3, draw: (g, lt, v) => { const hrs = val(o.time, lt, 3), am = (hrs % 1) * TAU - Math.PI / 2, ah = ((hrs % 12) / 12) * TAU - Math.PI / 2; cline(g, [[0, 0], [Math.cos(ah) * 46 * k, Math.sin(ah) * 46 * k]], { w: 9 * k, v, seed }); cline(g, [[0, 0], [Math.cos(am) * 70 * k, Math.sin(am) * 70 * k]], { w: 6 * k, v, seed: seed + 1, color: 'red' }); dab(g, 0, 0, 8 * k, 8 * k, 'ink'); } });
    if (kind === 'volcano') ops.push({ kind: 'fn', t0: at, dur: 0.01, draw: (g, lt, v) => { const e = val(o.erupt, lt, 0); if (e <= 0) return; const r = PV.rng(seed); cline(g, [[0, -60 * k], [0, (-60 - 70 * e) * k]], { w: 26 * k, color: 'orange', v, seed }); for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 1.3, d = (30 + r() * 60) * e; dab(g, Math.cos(a) * d * k, (-62 + Math.sin(a) * d * 1.3) * k, (14 + r() * 10) * k, (12 + r() * 8) * k, i % 2 ? 'red' : 'orange', 0.95, seed + i); } } });
    const fc = spec.face;
    if (fc && (o.face || kind === 'germ' && o.face !== false)) ops.push({ kind: 'fn', t0: tEnd - 0.25, dur: 0.25, draw: (g, lt, v) => face(g, fc[0] * k, fc[1] * k, fc[2] * k, val(o.mood, lt, spec.mood || 'happy'), v, seed + 7, o.look ?? 0, blinkAt(lt, seed)) });
    const bb = bboxOf(parts.flatMap((q) => q.p)), pad = kind === 'volcano' ? 160 * k : 20;
    const hs = [mount(this, o, [bb[0] - 20, Math.min(bb[1] - pad, -20), bb[2] + 20, bb[3] + 20], {
      ops, end: tEnd + 0.01,
      state: (q) => `${val(o.mood, q, '')}|${blinkAt(q, seed) ? 1 : 0}|${o.time != null ? val(o.time, q).toFixed(2) : ''}|${o.dirty != null ? val(o.dirty, q).toFixed(2) : ''}|${o.erupt != null ? val(o.erupt, q).toFixed(2) : ''}`,
      pos: (lt) => [val(o.x ?? x, lt), val(o.y ?? y, lt) + bob(o, lt, 9 * Math.min(1.5, k), seed), val(o.rot, lt, 0), val(o.scale, lt, 1)],
    })];
    if (kind === 'cloud' && o.rain != null) hs.push(rainOn(this, o, x, y, size, seed));
    return group(hs);
  };
  const blinkAt = (lt, seed) => { const p = 3.1 + hash(seed) * 1.6, ph = ((lt + hash(seed + 1) * p) % p); return ph < 1 / 6; };
  function rainOn(self, o, x, y, size, seed) {
    const at = val(o.rain, 0, 0), r = PV.rng(seed + 3), drops = Array.from({ length: 14 }, () => ({ x: (r() - 0.5) * size * 0.85, ph: r(), sp: 0.8 + r() * 0.4 }));
    const fall = 420, x0 = -size * 0.5, y0 = size * 0.2;
    return mount(self, { ...o, at }, [x0, y0, size * 0.5, y0 + fall + 40], {
      start: at, live: true, press: 0.9,
      render: (g, lt, v) => { for (const d of drops) { const ph = ((lt - at) * d.sp * 1.1 + d.ph) % 1; if (lt - at < d.ph * 0.6) continue; const yy = y0 + ph * fall; cline(g, [[d.x, yy], [d.x - 6, yy + 34]], { w: 6, color: 'blue', v, seed: seed + d.ph * 99, wob: 0.2 }); } wax(g, 0.9); },
      pos: (lt) => [val(o.x ?? x, lt), val(o.y ?? y, lt)],
    });
  }

  /** disc(cx, cy, r, o): a round crayon shape — a ball, a planet, a coin, a plate, a pupil of the eye, a big coloured dot
   *  to count with; outline first, then the colour scribbled in. o: { at, color ('red'), ry, face, mood, cross, x/y (fn),
   *  out } */
  B.disc = function (cx, cy, r, o = {}) {
    return this.thing('disc', cx, cy, { ...o, size: r * 2, squash: (o.ry ?? r) / r, color: o.color || 'red' });
  };

  /** sun(cx, cy, r, o): a child's sun — a yellow disc with an orange rim and a ring of short rays that slowly turn.
   *  o: { at, face (true), mood, rays (12), color ('yellow'), out } */
  B.sun = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, n = o.rays ?? 12, seed = SEED += 13;
    const rays = Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU, l = i % 2 ? 1.5 : 1.7; return [[Math.cos(a) * r * 1.22, Math.sin(a) * r * 1.22], [Math.cos(a) * r * l, Math.sin(a) * r * l]]; });
    const rOps = rays.map((p, i) => ({ kind: 'line', pts: p, color: 'orange', w: Math.max(8, r * 0.12), press: 1, t0: at + 0.5 + i * 0.04, dur: 0.25, seed: seed + i }));
    const h1 = mount(this, o, [-r * 1.8, -r * 1.8, r * 1.8, r * 1.8], { ops: rOps, press: 0.9, pos: (lt) => [cx, cy, Q(lt) * 0.12, 1] });
    const h2 = this.thing('moonlet', cx, cy, { ...o, size: r * 2, color: o.color || 'yellow', face: o.face ?? true });
    return group([h1, h2]);
  };

  /** moon(cx, cy, r, o): the moon with its phase — the lit part scribbled in yellow, the dark part left as a faint
   *  ghost outline so a child sees the whole ball is still there. phase (fn): 0 new, 0.25 first quarter (right half
   *  lit), 0.5 full, 0.75 last quarter (left half lit); animate it to show the moon changing shape. o: { at, phase (0.5),
   *  face, mood, ghost (true), color ('yellow'), out } */
  B.moon = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, seed = SEED += 19, cache = new Map(), circle = ell(0, 0, r, r, 48, seed, 0.01);
    const lw = clamp(r * 0.05, 3.5, 8);
    const ghost = { kind: 'line', pts: circle, closed: true, color: 'muted', w: lw * 0.7, press: 0.6, t0: at, dur: 0.6, seed };
    const ghostFill = { kind: 'fill', hg: hatch(circle, { seed, ang: 0.7, gap: clamp(r * 0.1, 7, 14), over: 4 }), color: 'faint', press: 0.55, w: clamp(r * 0.1, 7, 14), t0: at + 0.2, dur: 0.6, seed, knock: circle };
    const litPoly = (ph) => {
      ph = ((ph % 1) + 1) % 1; const a = r * Math.cos(ph * TAU), side = ph <= 0.5 ? 1 : -1, p = [];
      for (let i = 0; i <= 24; i++) { const t = -Math.PI / 2 + (i / 24) * Math.PI; p.push([side * r * Math.cos(t), r * Math.sin(t)]); }
      for (let i = 24; i >= 0; i--) { const t = -Math.PI / 2 + (i / 24) * Math.PI; p.push([side * a * Math.cos(t), r * Math.sin(t)]); }
      return p;
    };
    const opsFor = (ph) => {
      const key = (Math.round(((ph % 1) + 1) % 1 * 50) / 50).toFixed(2);
      if (cache.has(key)) return cache.get(key);
      const ops = o.ghost === false ? [] : [ghostFill, ghost];
      const lp = litPoly(+key), area = Math.abs(lp.reduce((s, p, i) => { const q = lp[(i + 1) % lp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      if (area > r * r * 0.05) {
        ops.push({ kind: 'fill', hg: hatch(lp, { seed: seed + 3, ang: 0.55, gap: clamp(r * 0.075, 6, 11), over: 6 }), color: o.color || 'yellow', press: 1, w: clamp(r * 0.085, 7, 12), t0: at + 0.5, dur: 0.8, seed: seed + 3, knock: lp });
        ops.push({ kind: 'line', pts: lp, closed: true, color: 'orange', w: lw, press: 1, t0: at + 0.3, dur: 0.6, seed: seed + 4 });
      }
      if (o.face) ops.push({ kind: 'fn', t0: at + 1.1, dur: 0.2, draw: (g, lt, v) => face(g, 0, 0, r * 0.62, val(o.mood, lt, 'calm'), v, seed + 9, 0, blinkAt(lt, seed)) });
      cache.set(key, ops); if (cache.size > 60) cache.delete(cache.keys().next().value);
      return ops;
    };
    return mount(this, o, [-r - 20, -r - 20, r + 20, r + 20], {
      ops: (lt) => opsFor(val(o.phase, lt, 0.5)), start: at, end: at + 1.4,
      state: (q) => `${(Math.round(((val(o.phase, q, 0.5) % 1) + 1) % 1 * 50) / 50).toFixed(2)}|${val(o.mood, q, '')}|${blinkAt(q, seed) ? 1 : 0}`,
      pos: (lt) => [val(o.x ?? cx, lt), val(o.y ?? cy, lt) + bob(o, lt, 8, seed)],
    });
  };

  /** sky(o): the sky coloured in across the top of the page with the side of a crayon, patch after patch sweeping
   *  across (colouring is the action: "night falls" = the night sky being scribbled in). Its lower edge is ragged; it
   *  never needs to reach the ground. mode: 'day' (light blue), 'dusk' (orange under purple), 'night' (deep indigo
   *  with yellow stars). o: { at, dur (1.8: the sweep), mode ('day'), y (420: lowest point), stars (night: 16), from
   *  ('left' | 'right'), out } */
  B.sky = function (o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.8, yb = o.y ?? 420, mode = o.mode || 'day', seed = SEED += 29, rev = o.from === 'right';
    const band = (ya, yb2, sd) => { const p = []; for (let x = -420; x <= W + 420; x += 40) p.push([x, ya + (ya < 0 ? 0 : n1(sd, x / 160) * 16)]); for (let x = W + 420; x >= -420; x -= 30) p.push([x, yb2 + n1(sd + 5, x / 130) * 22 + n1(sd + 9, x / 37) * 7]); return p; };
    const ops = [];
    const add = (poly, color, press, gap, t0, d, sd, cross) => {
      ops.push({ kind: 'fill', hg: hatch(poly, { seed: sd, ang: 0.35, gap, over: gap * 0.8, patch: 300, reverse: rev }), color, press, w: gap * 1.15, t0, dur: d, seed: sd });
      if (cross) ops.push({ kind: 'fill', hg: hatch(poly, { seed: sd + 2, ang: 1.5, gap: gap * 1.5, over: gap * 0.6, patch: 300, reverse: rev }), color: cross, press: press * (cross === 'blue' && color === 'night' ? 0.42 : 0.55), w: gap, t0: t0 + d * 0.35, dur: d, seed: sd + 2 });
    };
    if (mode === 'night') add(band(-60, yb, seed), 'night', 1, 11, at, dur, seed, 'blue');
    else if (mode === 'dusk') { add(band(-60, yb * 0.55, seed), 'purple', 0.85, 12, at, dur * 0.6, seed); add(band(yb * 0.5, yb, seed + 1), 'orange', 0.8, 12, at + dur * 0.4, dur * 0.6, seed + 1, 'pink'); }
    else add(band(-60, yb, seed), 'blueF', 0.85, 12, at, dur, seed, 'blue');
    if (mode === 'night') {
      const r = PV.rng(seed + 4), n = o.stars ?? 16;
      for (let i = 0; i < n; i++) {
        const sx = 120 + r() * (W - 240), sy = 40 + r() * (yb - 100), sr = 9 + r() * 10, sd = seed + 50 + i;
        ops.push({ kind: 'fn', t0: at + dur * (rev ? 1 - sx / W : sx / W) + 0.2, dur: 0.2, draw: (g, lt, v) => { const tw = (DRAW(lt) + i) % 5 === 0 ? 1.3 : 1; const p = starPts(sx, sy, sr * tw, sr * 0.45 * tw); g.fillStyle = css('yellow'); g.globalAlpha = 0.95; g.beginPath(); p.forEach(([a, b], j) => (j ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill(); g.globalAlpha = 1; cline(g, p, { closed: true, w: 3, color: 'yellow', v, seed: sd, wob: 0.2 }); } });
      }
    }
    return mount(this, o, [-420, -80, W + 420, yb + 60], { ops, press: mode === 'day' ? 0.8 : mode === 'night' ? 1 : 0.9, live: mode === 'night' });
  };

  /** ground(o): the ground scribbled in green along the bottom of the page — a hilly top edge with grass tufts, and the
   *  bare paper below y 900 left for the words. o: { at, dur (1.4), y (760: the top of the grass), hill (40: how
   *  rolling), color ('green'), flowers (0: little flowers along the edge), out } */
  B.ground = function (o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.4, y = o.y ?? STAGE.area.y1 - 120, hill = o.hill ?? 40, seed = SEED += 31, c = o.color || 'green';
    const topY = (x) => y - hill * (0.5 + 0.5 * Math.sin(x / 420 + seed)) - n1(seed, x / 90) * 6;
    const top = []; for (let x = -420; x <= W + 420; x += 24) top.push([x, topY(x)]);
    const poly = [...top]; for (let x = W + 420; x >= -420; x -= 30) poly.push([x, STAGE.subs - 12 + n1(seed + 4, x / 60) * 6]);
    const ops = [{ kind: 'fill', hg: hatch(poly, { seed, ang: 0.4, gap: 12, over: 10, patch: 300 }), color: c, press: 0.85, w: 13, t0: at, dur, seed },
      { kind: 'fill', hg: hatch(poly, { seed: seed + 1, ang: 1.6, gap: 22, over: 6, patch: 300 }), color: c === 'green' ? 'greenF' : c, press: 0.55, w: 10, t0: at + dur * 0.4, dur, seed: seed + 1 },
      { kind: 'line', pts: top, color: darker(c, 0.75), w: 7, press: 1, t0: at, dur: dur * 0.7, seed: seed + 2 }];
    const r = PV.rng(seed);
    for (let x = 60; x < W; x += 70 + r() * 80) { const ty = topY(x) + 4, s = 0.7 + r() * 0.6; ops.push({ kind: 'line', pts: [[x - 12 * s, ty - 18 * s], [x, ty + 4], [x + 4 * s, ty - 26 * s], [x + 8, ty + 4], [x + 18 * s, ty - 16 * s]], color: darker(c, 0.7), w: 4, press: 0.95, t0: at + dur * (x / W) * 0.8 + 0.3, dur: 0.25, seed: seed + x }); }
    const nf = o.flowers ?? 0;
    for (let i = 0; i < nf; i++) { const fx = 100 + ((i + 0.5) / nf) * (W - 200) + (r() - 0.5) * 80, fy = topY(fx) + 30 + r() * 40, fc = ['red', 'yellow', 'pink', 'purple'][i % 4]; ops.push({ kind: 'fn', t0: at + dur + 0.1 + i * 0.05, dur: 0.2, draw: (g) => { for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU; dab(g, fx + Math.cos(a) * 9, fy + Math.sin(a) * 9, 7, 7, fc, 0.95, seed + i * 7 + j); } dab(g, fx, fy, 5, 5, 'yellow', 1, seed + i); } }); }
    return mount(this, o, [-420, y - hill - 60, W + 420, STAGE.subs], { ops, press: 0.85 });
  };

  /** room(o): an indoor picture-book page — a wooden floor scribbled along the bottom (plank lines, top at y), a skirting
   *  line, sparse polka-dot wallpaper drawn on the bare paper, and a window with the sky in it (day: light blue with a
   *  cloud; night: deep indigo with a moon and stars). The indoor answer to sky + ground. o: { at, dur (1.4), y (780),
   *  floor ('brownF'), dots ('pinkF' | false), window ([x, y] top-left of a 300×240 window, or false), night (false),
   *  rug ([x, w]: a striped rug on the floor), out } */
  B.room = function (o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.4, y = o.y ?? STAGE.area.y1 - 100, seed = SEED += 43, ops = [], r = PV.rng(seed);
    const floor = [[-420, y + n1(seed, 1) * 4], [W + 420, y + n1(seed, 2) * 4], [W + 420, STAGE.subs - 12], [-420, STAGE.subs - 10]];
    ops.push({ kind: 'fill', hg: hatch(floor, { seed, ang: 0.1, gap: 12, over: 8, patch: 300 }), color: o.floor || 'brownF', press: 0.85, w: 13, t0: at, dur, seed });
    ops.push({ kind: 'line', pts: [[-420, y], [W + 420, y]], color: 'brown', w: 7, press: 1, t0: at, dur: dur * 0.6, seed: seed + 1 });
    for (let i = 1; i < 3; i++) { const yy = y + i * 36; ops.push({ kind: 'line', pts: [[-420, yy], [W + 420, yy + 3]], color: 'brown', w: 3.5, press: 0.7, t0: at + dur * 0.5, dur: dur * 0.5, seed: seed + 3 + i }); }
    if (o.rug) { const [rx, rw] = o.rug; ['red', 'yellow', 'blue', 'yellow', 'red'].forEach((c, i) => { const q = [[rx + i * rw / 5, y + 30], [rx + (i + 1) * rw / 5, y + 30], [rx + (i + 1) * rw / 5 + 30, y + 92], [rx + i * rw / 5 + 30, y + 92]]; ops.push({ kind: 'fill', hg: hatch(q, { seed: seed + 20 + i, ang: 1.2, gap: 8, over: 4 }), color: c, press: 0.85, w: 9, t0: at + dur * 0.6 + i * 0.08, dur: 0.4, seed: seed + 20 + i }); }); }
    if (o.dots !== false) for (let yy = 230; yy < y - 60; yy += 120) for (let xx = 90 + ((yy / 120) % 2) * 60; xx < W - 60; xx += 120) { const wq = o.window === false ? null : (o.window || [W - 540, 220]); if (wq && xx > wq[0] - 40 && xx < wq[0] + 340 && yy > wq[1] - 40 && yy < wq[1] + 290) continue; const sx = xx + (r() - 0.5) * 20, sy = yy + (r() - 0.5) * 20; ops.push({ kind: 'fn', t0: at + 0.3 + (xx / W) * dur * 0.6, dur: 0.1, draw: (g) => dab(g, sx, sy, 8, 8, o.dots || 'pinkF', 0.9, sx) }); }
    if (o.window !== false) {
      const [wx, wy] = o.window || [W - 540, 220], ww = 300, wh = 240, glass = rect(wx, wy, wx + ww, wy + wh);
      ops.push({ kind: 'fill', hg: hatch(glass, { seed: seed + 9, ang: 0.4, gap: 9, over: 3 }), color: o.night ? 'night' : 'blueF', press: 0.95, w: 10, t0: at + 0.4, dur: 0.8, seed: seed + 9, knock: glass });
      if (o.night) { ops.push({ kind: 'fn', t0: at + 1.2, dur: 0.2, draw: (g, lt, v) => { dab(g, wx + ww * 0.7, wy + wh * 0.32, 30, 30, 'yellow', 1, seed); for (let i = 0; i < 4; i++) { const p = starPts(wx + 40 + i * 52, wy + 60 + (i % 2) * 100, 10, 4.5); g.fillStyle = css('yellow'); g.beginPath(); p.forEach(([a, b], j) => (j ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill(); } } }); }
      else ops.push({ kind: 'fn', t0: at + 1.2, dur: 0.2, draw: (g) => { for (const [dx, rr] of [[-30, 26], [0, 34], [32, 24]]) dab(g, wx + ww * 0.42 + dx, wy + wh * 0.38, rr, rr * 0.8, 'paper', 1, seed + dx); } });
      ops.push({ kind: 'line', pts: rect(wx, wy, wx + ww, wy + wh), closed: true, color: 'brown', w: 12, press: 1, t0: at + 0.2, dur: 0.6, seed: seed + 11 });
      ops.push({ kind: 'line', pts: [[wx + ww / 2, wy], [wx + ww / 2, wy + wh]], color: 'brown', w: 8, press: 1, t0: at + 0.7, dur: 0.3, seed: seed + 12 });
      ops.push({ kind: 'line', pts: [[wx, wy + wh / 2], [wx + ww, wy + wh / 2]], color: 'brown', w: 8, press: 1, t0: at + 0.8, dur: 0.3, seed: seed + 13 });
      ops.push({ kind: 'line', pts: [[wx - 24, wy + wh + 10], [wx + ww + 24, wy + wh + 10]], color: 'brown', w: 14, press: 1, t0: at + 0.9, dur: 0.3, seed: seed + 14 });
    }
    return mount(this, o, [-420, 150, W + 420, STAGE.subs], { ops, press: 0.85 });
  };

  // ─────────────────────────── the cast ───────────────────────────
  // arms: [left hand, left elbow, right hand, right elbow], 400-unit figure, feet at (0, 0)
  const POSES = {
    stand: [[-62, -112], [-56, -160], [62, -112], [56, -160]],
    wave: [[-62, -112], [-56, -160], [104, -300], [96, -222]],
    point: [[-62, -112], [-56, -160], [158, -196], [100, -192]],
    cheer: [[-104, -318], [-84, -238], [104, -318], [84, -238]],
    think: [[-62, -112], [-56, -160], [26, -236], [70, -172]],
    hug: [[30, -170], [-60, -166], [-30, -164], [60, -160]],
    shrug: [[-108, -200], [-76, -150], [108, -200], [76, -150]],
    sad: [[-44, -100], [-46, -150], [44, -100], [46, -150]],
    hold: [[-62, -112], [-56, -160], [84, -176], [66, -142]],
    brush: [[-62, -112], [-56, -160], [40, -256], [96, -204]],
    reach: [[-62, -112], [-56, -160], [124, -286], [90, -216]],
    sleep: [[-50, -112], [-52, -160], [50, -112], [52, -160]],
    walk: [[-62, -112], [-56, -160], [62, -112], [56, -160]],
    jump: [[-104, -318], [-84, -238], [104, -318], [84, -238]],
    shy: [[-34, -128], [-56, -162], [34, -128], [56, -162]],
  };
  const POSE_NAMES = Object.keys(POSES);
  /** the parts of a figure for a pose (unit coords, 400 tall) */
  function kidParts(o, pose, step) {
    const kind = o.kind || 'kid', fur = o.fur || { bear: 'brown', bunny: 'paper', cat: 'orange', kid: null }[kind], skin = fur || o.skin || 'peach';
    const shirt = o.shirt || 'red', pants = o.pants || 'blue', hair = o.hair || 'brown', dress = o.dress ?? false;
    const P = [], A = POSES[pose] || POSES.stand;
    let [lh, le, rh, re] = A;
    const walk = pose === 'walk', sw = walk ? (Math.floor(step / 3) % 2 ? 1 : -1) : 0;
    if (walk) { lh = [lh[0] + sw * 16, lh[1] - 6]; rh = [rh[0] + sw * 16, rh[1] - 6]; }
    // legs and shoes
    for (const s of [-1, 1]) {
      const fx = s * 24 + (walk ? s * sw * 14 : 0);
      P.push({ p: tube([[s * 22, -104], [fx, -18]], 24), color: dress ? skin : pants });
      P.push({ p: ell(fx + s * 4, -10, 26, 13, 20, s), color: o.shoes || 'brown' });
    }
    // body
    if (dress) P.push({ p: sm([[-34, -216], [34, -216], [48, -160], [66, -92], [0, -86], [-66, -92], [-48, -160]], 3), color: shirt, cross: o.pattern });
    else { P.push({ p: sm([[-46, -146], [46, -146], [48, -96], [-48, -96]], 2), color: pants }); P.push({ p: sm([[-36, -216], [36, -216], [46, -140], [-46, -140]], 3), color: shirt, cross: o.pattern }); }
    // arms, hands (behind the back when shy)
    const arm = (sh, el, hd) => { P.push({ p: tube([sh, el, hd], 22), color: shirt }); P.push({ p: ell(hd[0], hd[1], 15, 15, 14, hd[0]), color: skin }); };
    arm([-34, -200], le, lh); arm([34, -200], re, rh);
    if (pose === 'shy') { P.splice(P.length - 4, 4); P.unshift({ p: tube([[-34, -200], le, lh], 22), color: shirt }, { p: tube([[34, -200], re, rh], 22), color: shirt }); }
    // ears behind the head
    if (kind === 'bear') for (const s of [-1, 1]) { P.push({ p: ell(s * 58, -352, 28, 28, 20, s), color: fur }); P.push({ p: ell(s * 58, -350, 14, 14, 14, s), color: 'pinkF', line: false }); }
    if (kind === 'bunny') for (const s of [-1, 1]) { P.push({ p: sm([[s * 22, -350], [s * 14, -420], [s * 34, -470], [s * 52, -420], [s * 46, -350]], 4), color: fur }); P.push({ p: sm([[s * 28, -360], [s * 26, -420], [s * 34, -446], [s * 42, -420], [s * 40, -360]], 4), color: 'pinkF', line: false }); }
    if (kind === 'cat') for (const s of [-1, 1]) P.push({ p: [[s * 30, -350], [s * 62, -392], [s * 76, -320]], color: fur });
    // head
    P.push({ p: ell(0, -292, 82, 76, 40, 2, 0.02), color: skin, press: fur ? 0.85 : 0.7 });
    if (kind === 'bear') P.push({ p: ell(0, -258, 30, 22, 20, 1), color: 'brownF', line: false });
    // hair
    const hs = kind === 'kid' ? (o.hairStyle || 'bob') : 'none';
    if (hs !== 'none') {
      const cap = [];
      if (hs === 'spiky') { for (let i = 0; i <= 10; i++) { const a = Math.PI * 1.1 + (i / 10) * Math.PI * 0.8; const rr = i % 2 ? 108 : 86; cap.push([Math.cos(a) * rr * 0.95, -292 + Math.sin(a) * rr * 0.9]); } cap.push([70, -318], [30, -306], [-10, -316], [-50, -306], [-74, -318]); P.push({ p: cap, color: hair }); }
      else if (hs === 'curly') { for (let i = 0; i <= 30; i++) { const a = Math.PI * 1.05 + (i / 30) * Math.PI * 0.9; const rr = 90 + 8 * Math.abs(Math.sin(i * 0.9)); cap.push([Math.cos(a) * rr, -292 + Math.sin(a) * rr * 0.95]); } for (let x = 72; x >= -72; x -= 24) cap.push([x, -314 + (Math.abs(x / 24) % 2 ? 8 : -6)]); P.push({ p: cap, color: hair }); }
      else {
        for (let i = 0; i <= 26; i++) { const a = Math.PI * 0.86 + (i / 26) * Math.PI * 1.28; cap.push([Math.cos(a) * 90, -294 + Math.sin(a) * 86]); }
        for (let x = 74; x >= -74; x -= 21) cap.push([x, -296], [x - 10, -314]);
        P.push({ p: cap, color: hair });
        if (hs === 'pigtails') for (const s of [-1, 1]) P.push({ p: ell(s * 100, -262, 26, 30, 18, s), color: hair });
        if (hs === 'bun') P.push({ p: ell(0, -384, 30, 26, 18, 2), color: hair });
      }
    }
    if (o.bow) P.push({ p: [[40, -360], [80, -384], [76, -340], [40, -360], [20, -330], [14, -372]], color: o.bow === true ? 'pink' : o.bow });
    return P;
  }

  /** kid(x, y, o): THE CAST — a round picture-book child (or animal friend) standing with its feet on (x, y), o.size px
   *  tall (default 400): big round head, dot eyes with a white glint, rosy cheeks, tube arms with mitten hands. It is
   *  drawn on in crayon at `at`, then acts by swapping drawings on the beat (substitution, no in-betweens), blinks and
   *  breathes on twos. o: { at, size, kind ('kid' | 'bear' | 'bunny' | 'cat'), shirt ('red'), pants ('blue'), dress
   *  (true: a dress in the shirt colour), hair ('brown'), hairStyle ('bob' | 'pigtails' | 'bun' | 'spiky' | 'curly' |
   *  'none'), skin ('peach'), fur, bow, pose (fn: stand wave point cheer think hug shrug sad hold brush reach sleep walk
   *  jump shy), mood (fn: happy laugh calm sad angry surprised sleepy worried shy), look (-1 | 0 | 1: eyes to one side),
   *  holds (a thing kind in the right hand, e.g. 'toothbrush', 'star', 'balloon'), x (fn: walk across), rot (fn, radians
   *  about the feet: -1.57 lays a sleeping child down on a bed, feet at (x, y) pointing right), out } */
  B.kid = function (x, y, o = {}) {
    const size = o.size ?? 400, k = size / 400, at = o.at ?? 0, seed = SEED += 53, cache = new Map();
    const poseAt = (lt) => { const p = val(o.pose, lt, 'stand'); return POSES[p] ? p : 'stand'; };
    const moodAt = (lt) => { const m = val(o.mood, lt, 'happy'); return poseAt(lt) === 'sleep' ? 'sleepy' : m; };
    const opsFor = (pose, step) => {
      const key = pose + (pose === 'walk' ? Math.floor(step / 3) % 2 : '');
      if (cache.has(key)) return cache.get(key);
      const parts = kidParts(o, pose, step).map((q) => ({ ...q, p: tr(q.p, k) }));
      const ops = partOps(parts, { at, sketch: 0.9, dur: 0.4, stagger: 0.05, seed, lw: clamp(6.5 * k, 3.5, 8), gap: clamp(8 * k, 5, 10) }, k);
      const fT = at + 1.0;
      ops.push({ kind: 'fn', t0: fT, dur: 0.2, draw: (g, lt, v) => {
        face(g, 0, -286 * k, 80 * k, moodAt(lt), v, seed + 3, val(o.look, lt, 0), blinkAt(lt, seed));
        if (o.kind === 'cat') for (const s of [-1, 1]) for (const d of [-8, 8]) cline(g, [[s * 50 * k, (-262 + d) * k], [s * 92 * k, (-268 + d * 1.6) * k]], { w: 2.5, seed: seed + s * 3 + d, v });
        if (o.kind === 'bear') dab(g, 0, -270 * k, 10 * k, 7 * k, 'ink', 1, seed);
      } });
      cache.set(key, ops); if (cache.size > 24) cache.delete(cache.keys().next().value);
      return ops;
    };
    const tEnd = opsEnd(opsFor('stand', 0)) + 0.01;
    const hs = [mount(this, o, [-190 * k, -480 * k, 190 * k, 20], {
      ops: (lt) => opsFor(poseAt(lt), DRAW(lt)), start: at, end: tEnd, press: 0.85,
      state: (q) => `${poseAt(q)}|${poseAt(q) === 'walk' ? Math.floor(DRAW(q) / 3) % 2 : ''}|${moodAt(q)}|${blinkAt(q, seed) ? 1 : 0}|${val(o.look, q, 0)}`,
      pos: (lt) => { const p = poseAt(lt), b = Math.abs(Math.sin(Q(lt) * 2.6 + seed)) * 3 * k; return [val(o.x ?? x, lt), val(o.y ?? y, lt) - b - (p === 'jump' ? 60 * k * Math.abs(Math.sin(Q(lt) * 5)) : 0), val(o.rot, lt, 0), 1]; },
    })];
    if (o.holds) {
      const hand = (lt) => { const p = poseAt(lt), A = POSES[p]; return [A[2][0] * k, A[2][1] * k]; };
      hs.push(this.thing(o.holds, 0, 0, { at: at + 0.9, size: o.holdSize ?? size * 0.3, color: o.holdColor, rot: o.holdRot ?? (o.holds === 'toothbrush' ? -0.9 : 0),
        x: (lt) => val(o.x ?? x, lt) + hand(lt)[0], y: (lt) => val(o.y ?? y, lt) + hand(lt)[1] - (o.holds === 'balloon' ? size * 0.12 : 0), out: o.out }));
    }
    return group(hs);
  };

  // ─────────────────────────── words ───────────────────────────
  const isCJK = (s) => /[⺀-鿿　-〿＀-￯]/.test(s);
  const fontFor = (ch, size) => (isCJK(ch) ? `700 ${size}px "LXGW WenKai", "Kaiti SC", serif` : `600 ${size}px Fredoka, "LXGW WenKai", sans-serif`);
  const MC = document.createElement('canvas').getContext('2d');
  function layoutGlyphs(str, size, track) {
    const out = []; let x = 0;
    for (const ch of [...str]) { MC.font = fontFor(ch, size); const w = MC.measureText(ch).width || size * 0.6; out.push({ ch, x, w }); x += w + track; }
    return { glyphs: out, width: Math.max(0, x - track) };
  }
  function drawGlyphs(g, lay, size, x0, base, lt, o, seed, v) {
    const colors = o.colors || [o.color || 'blue'], at = o.at ?? 0, st = o.stagger ?? 0.09, kn = [];
    lay.glyphs.forEach((gl, i) => {
      if (gl.ch === ' ') return;
      const k = clamp((lt - at - i * st) / 0.16); if (k <= 0) return;
      const c = colors[i % colors.length], rot = (hash(seed + i * 1.9) - 0.5) * 0.11 + (hash(seed + i + v * 0.7) - 0.5) * 0.02;
      const jx = (hash(seed + i * 3.3 + v * 1.1) - 0.5) * 1.6, jy = (hash(seed + i * 7.1 + v * 2.3) - 0.5) * 1.6 + (hash(seed + i * 5.5) - 0.5) * size * 0.06;
      g.save(); g.translate(x0 + gl.x + gl.w / 2 + jx, base + jy); g.rotate(rot);
      g.beginPath(); g.rect(-gl.w / 2 - size * 0.2, -size * 1.1, (gl.w + size * 0.4) * k, size * 1.5); g.clip();
      g.font = fontFor(gl.ch, size); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = css(c); g.globalAlpha = 0.92; g.fillText(gl.ch, 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.strokeStyle = darker(c, 0.78); g.lineWidth = Math.max(2, size * 0.05); g.globalAlpha = 0.35;
      for (let j = -6; j <= 6; j++) { g.beginPath(); g.moveTo(-gl.w, j * size * 0.11 - size * 0.4); g.lineTo(gl.w, j * size * 0.11 - size * 0.4 - gl.w * 0.5); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
      if (o.outline !== false) { g.globalAlpha = 0.85; g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * 0.03); g.strokeStyle = darker(c, 0.6); g.strokeText(gl.ch, 0, 0); }
      g.restore(); g.globalAlpha = 1;
      kn.push([gl, rot, jx, jy]);
    });
    return kn;
  }
  function knockGlyphs(g, kn, size, x0, base) {
    g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = g.createPattern(CR.paper, 'repeat'); g.strokeStyle = g.fillStyle; g.lineJoin = 'round'; g.lineWidth = size * 0.22;
    for (const [gl, rot, jx, jy] of kn) { g.save(); g.translate(x0 + gl.x + gl.w / 2 + jx, base + jy); g.rotate(rot); g.font = fontFor(gl.ch, size); g.textAlign = 'center'; g.strokeText(gl.ch, 0, 0); g.fillText(gl.ch, 0, 0); g.restore(); }
    g.restore();
  }

  /** words(str, x, y, o): big hand-lettered crayon words, written letter by letter, each letter coloured in with
   *  streaks of wax and a darker edge, a little tilted like a child's lettering — the one key word or number of a
   *  page (2–8 characters), landing on its spoken word. (x, y) is the top left (align 'c': x is the centre). o: { at,
   *  size (150), color ('blue'), colors (a list: one crayon per letter, e.g. ['red','orange','green','blue']), stagger
   *  (0.09 s per letter), track, align, knock (true), out } */
  B.words = function (str, x, y, o = {}) {
    const size = o.size ?? 150, seed = SEED += 7, lay = layoutGlyphs(String(str), size, o.track ?? size * 0.04);
    const x0 = o.align === 'c' ? -lay.width / 2 : 0, base = size * 0.92, at = o.at ?? 0;
    const end = at + lay.glyphs.length * (o.stagger ?? 0.09) + 0.2;
    const hnd = mount(this, o, [x0 - size * 0.3, -size * 0.25, x0 + lay.width + size * 0.3, size * 1.35], {
      start: at, end,
      render: (g, lt, v) => { const kn = drawGlyphs(g, lay, size, x0, base, lt, o, seed, v); wax(g, 0.85); if (o.knock !== false) knockGlyphs(g, kn, size, x0, base); },
      pos: (lt) => [val(o.x ?? x, lt), val(o.y ?? y, lt) + bob(o, lt, 6, seed)],
    });
    return Object.assign(hnd, { w: lay.width });
  };

  /** note(x, y, str, o): a short hand-written caption in indigo crayon (a name, a step, a small fact, ≤ 12 汉字 / 6
   *  words), optionally with a wobbly crayon arrow from the caption to the thing it names (to: [x, y]). o: { at, size
   *  (44), color ('ink'), to, w (wrap width), align, cps (12) } — returns the text handle */
  B.note = function (x, y, str, o = {}) {
    const size = Math.max(40, o.size ?? 44), at = o.at ?? 0;
    if (o.to) {
      const tw = Math.min(PV.tw(str, size), o.w ?? 9999), [tx, ty] = o.to;
      const left = o.align === 'c' ? x - tw / 2 : x, cxm = left + tw / 2;
      const sx = tx < left ? left - 14 : tx > left + tw ? left + tw + 14 : cxm, sy = ty < y ? y - 8 : y + size * 1.3;
      const mx = lerp(sx, tx, 0.5) + (ty < y ? -1 : 1) * 30, my = lerp(sy, ty, 0.5) - 20;
      const d = Math.hypot(tx - sx, ty - sy), ex = tx - ((tx - mx) / Math.max(1, Math.hypot(tx - mx, ty - my))) * 18, ey = ty - ((ty - my) / Math.max(1, Math.hypot(tx - mx, ty - my))) * 18;
      if (d > 30) this.lines([[sx, sy], [mx, my], [ex, ey]], { at: at + 0.2, dur: 0.45, w: 5, arrow: true, color: o.arrowColor || o.color || 'ink', out: o.out });
    }
    return this.text(str, { x, y, size, color: o.color || 'ink', at, cps: o.cps ?? 12, w: o.w, align: o.align, weight: 700, mode: o.mode });
  };

  /** say(x, y, str, o): a speech balloon drawn in crayon beside a character, white crayon inside and an indigo
   *  outline, its tail pointing at the speaker (to: [x, y]); think: true makes it a thought cloud with little bubbles.
   *  One short line (≤ 10 汉字 / 5 words). (x, y) is the balloon's centre. o: { at, size (46), to, think, color ('ink'),
   *  out } — returns { text, hide } */
  B.say = function (x, y, str, o = {}) {
    const size = Math.max(40, o.size ?? 46), at = o.at ?? 0, tw = PV.tw(str, size) * (isCJK(str) ? 1.05 : 0.95), w = tw + size * 1.4, hh = size * 2.1, seed = SEED += 11;
    const parts = [];
    if (o.think) {
      const p = []; for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU; const kk = 1 + 0.1 * Math.abs(Math.sin(a * 5)); p.push([x + Math.cos(a) * w * 0.58 * kk, y + Math.sin(a) * hh * 0.62 * kk]); }
      parts.push({ p, color: 'paper', press: 1 });
      if (o.to) [0.55, 0.78].forEach((f, i) => { const bx = lerp(x, o.to[0], f), by = lerp(y + hh * 0.5, o.to[1], f), br = size * (0.32 - i * 0.12); parts.push({ p: ell(bx, by, br, br, 14, i), color: 'paper', press: 1 }); });
    } else {
      const body = sm(rrect(x - w / 2, y - hh / 2, x + w / 2, y + hh / 2, hh * 0.45), 3);
      if (o.to) {
        const ang = Math.atan2(o.to[1] - y, o.to[0] - x), bx = x + Math.cos(ang) * w * 0.3, by = y + Math.sin(ang) * hh * 0.36, nx = -Math.sin(ang) * size * 0.4, ny = Math.cos(ang) * size * 0.4;
        const ex = x + Math.cos(ang) * w * 0.5, ey = y + Math.sin(ang) * hh * 0.5, dl = Math.min(Math.hypot(o.to[0] - ex, o.to[1] - ey), size * 2.2), tx = ex + Math.cos(ang) * dl, ty = ey + Math.sin(ang) * dl;
        parts.push({ p: [[bx - nx, by - ny], [tx, ty], [bx + nx, by + ny]], color: 'paper', press: 1 });
      }
      parts.push({ p: body, color: 'paper', press: 1 });
    }
    const ops = partOps(parts, { at, sketch: 0.5, dur: 0.4, seed, lw: 6, gap: 9, spill: 0 });
    const bb = bboxOf(parts.flatMap((q) => q.p));
    const b = mount(this, o, [bb[0] - 20, bb[1] - 20, bb[2] + 20, bb[3] + 20], { ops });
    const t = this.text(str, { x, y: y - size * 0.62, size, align: 'c', color: o.color || 'ink', at: at + 0.45, cps: o.cps ?? 14, weight: 700 });
    if (o.out != null) t.hide?.(o.out);
    return { text: t, bubble: b, hide(tt, d) { b.hide(tt, d); t.hide?.(tt, d); return this; } };
  };

  /** twinkle(x, y, o): little crayon stars and sparkle dashes pop around a point and twinkle on twos — the "ta-da!" of a
   *  page: an idea landing, something clean and shiny, a kind deed. At most one per page. o: { at, n (6), r (120),
   *  color ('yellow'), dur (1.6), stay (false: keep twinkling), out } */
  B.twinkle = function (x, y, o = {}) {
    const at = o.at ?? 0, n = o.n ?? 6, R = o.r ?? 120, dur = o.stay ? 1e9 : o.dur ?? 1.6, seed = SEED += 5, r = PV.rng(seed);
    const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU + r() * 0.5, d = R * (0.65 + r() * 0.4); return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: 14 + r() * 14, ph: r() * 3 }; });
    return mount(this, { ...o, out: o.out ?? (o.stay ? undefined : at + dur) , outDur: 0.15 }, [-R - 50, -R - 50, R + 50, R + 50], {
      start: at, live: true,
      render: (g, lt, v) => {
        const q = clamp((lt - at) / 0.35);
        pts.forEach((p, i) => {
          const on = (DRAW(lt) + i) % 4 !== 0, s = p.s * (on ? 1 : 0.6) * q;
          if (s < 1) return;
          const sp = starPts(p.x * q, p.y * q, s, s * 0.4, 4, (i % 2) * 0.4);
          g.fillStyle = css(o.color || 'yellow'); g.globalAlpha = 0.95; g.beginPath(); sp.forEach(([a, b], j) => (j ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fill(); g.globalAlpha = 1;
          cline(g, sp, { closed: true, w: 3.5, color: 'orange', v, seed: seed + i, wob: 0.2 });
          const a = Math.atan2(p.y, p.x); cline(g, [[Math.cos(a) * (R * 0.25) * q, Math.sin(a) * (R * 0.25) * q], [Math.cos(a) * (R * 0.45) * q, Math.sin(a) * (R * 0.45) * q]], { w: 4, color: o.color === 'pink' ? 'red' : 'orange', v, seed: seed + 20 + i });
        });
        wax(g, 0.9);
      },
      pos: () => [x, y],
    });
  };

  // ─────────────────────────── the page title: hand-lettered with a crayon swash under it ───────────────────────────
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15, size = o.size ?? (isCJK(str) ? 58 : 60), seed = SEED += 3;
    const lay = layoutGlyphs(String(str), size, size * 0.02), x0 = STAGE.title.x - 8, y0 = STAGE.title.y - 26;
    const sw = [[x0 - 18, y0 + size * 0.78], [x0 + lay.width + 26, y0 + size * 0.7], [x0 + lay.width + 34, y0 + size * 1.12], [x0 - 14, y0 + size * 1.2]];
    const swOps = [{ kind: 'fill', hg: hatch(sw, { seed, ang: 0.15, gap: 9, over: 10 }), color: o.accent === 'blue' ? 'blueF' : o.accent === 'green' ? 'greenF' : o.accent === 'red' ? 'redF' : 'yellow', press: 0.75, w: 11, t0: at, dur: 0.6, seed }];
    const go = { at: at + 0.25, color: 'ink', stagger: 0.045, outline: false };
    return mount(T, o, [x0 - 40, y0 - 30, x0 + lay.width + 60, y0 + size * 1.4], {
      start: at, end: at + 0.3 + lay.glyphs.length * 0.045 + 0.2,
      render: (g, lt, v) => { renderOps(g, swOps, lt, v, 0.8); g.save(); g.globalCompositeOperation = 'source-over'; const kn = drawGlyphs(g, lay, size, x0, y0 + size * 0.92, lt, go, seed, v); g.restore(); wax(g, 0.92); knockGlyphs(g, kn, size, x0, y0 + size * 0.92); },
    });
  };

  // ─────────────────────────── the page turn (every page boundary) ───────────────────────────
  // The outgoing page lifts at its bottom-right corner and peels over to the left like a book page, showing its paper
  // back and a soft shadow, and the next page is underneath. Off with META.pageTurn: false.
  (function pageTurn() {
    const LEAD = 0.3, TURN = 0.95;
    let cv = null, g = null, BG = null, drawn = false;
    const CX = W / 2, CY = H / 2;
    // the camera at page time lt (as the engine places it), for a page the engine is not drawing at this moment
    const SLAM = (x) => (x < 0.55 ? lerp(0, 1.08, ease.out(x / 0.55)) : lerp(1.08, 1, ease.inOut((x - 0.55) / 0.45)));
    function camAt(keys, lt) {
      let st = { x: CX, y: CY, s: 1 };
      for (const k of keys) { if (lt <= k.at) break; if (k.shake) continue; const x = clamp((lt - k.at) / (k.dur ?? 1.2)), e = k.ease === 'slam' ? SLAM(x) : (ease[k.ease] || ease.inOut)(x); st = { x: lerp(st.x, k.x ?? CX, e), y: lerp(st.y, k.y ?? CY, e), s: k.keepScale ? st.s : lerp(st.s, k.s ?? 1, e) }; }
      return st;
    }
    function drawPage(p, t) {
      const lt = t - p.pg.start;
      for (const a of p.sh.acts) PV.applyAct(a, lt);
      for (const fn of p.sh.ticks) fn(lt, t);
      const c = camAt(p.sh.cams, lt);
      p.cam.style.transform = c.s === 1 && c.x === CX && c.y === CY ? '' : `translate(${(CX - c.x * c.s).toFixed(2)}px, ${(CY - c.y * c.s).toFixed(2)}px) scale(${c.s.toFixed(4)})`;
    }
    const reset = (p) => { if (!p._turn) return; p._turn = false; Object.assign(p.root.style, { clipPath: '', background: '', zIndex: '' }); };
    (window.FRAME_HOOKS = window.FRAME_HOOKS || []).push((t) => {
      try {
        if (window.SCRIPT?.META?.pageTurn === false || !window.ENGINE) return;
        const pages = ENGINE.pages; if (!pages || pages.length < 2) return;
        let i0 = -1, b = 0;
        for (let i = 1; i < pages.length; i++) { const s = pages[i].pg.start; if (t >= s - LEAD && t < s - LEAD + TURN) { i0 = i; b = s; break; } }
        for (let i = 0; i < pages.length; i++) if (i0 < 0 || (i !== i0 && i !== i0 - 1)) reset(pages[i]);
        if (!cv) { const st = document.getElementById('stage'); cv = document.createElement('canvas'); cv.width = W / 2; cv.height = H / 2; Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px', zIndex: 5, pointerEvents: 'none' }); st.appendChild(cv); g = cv.getContext('2d'); BG = (window.STYLE?.background ? STYLE.background(STAGE) : '#F8F0DD'); }
        if (i0 < 0) { if (drawn) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); drawn = false; } return; }
        const out = pages[i0 - 1], inn = pages[i0];
        for (const p of [out, inn]) {
          if (p.root.style.display === 'none') { p.root.style.display = 'block'; drawPage(p, t); }
          Object.assign(p.root.style, { opacity: '1', transform: 'none', filter: 'none' }); p._turn = true;
        }
        out.root.style.zIndex = '2'; inn.root.style.zIndex = '1'; out.root.style.background = BG;
        const k = ease.inOut(clamp((t - (b - LEAD)) / TURN));
        // the bottom-right corner C is lifted toward Qp; the fold is the perpendicular bisector of C and Qp
        const C = [W, H], Qp = [W - k * W * 2.15, H - k * H * 0.32 - Math.sin(Math.PI * k) * H * 0.22];
        const M = [(C[0] + Qp[0]) / 2, (C[1] + Qp[1]) / 2], nx = C[0] - Qp[0], ny = C[1] - Qp[1], nl = Math.hypot(nx, ny) || 1, ux = nx / nl, uy = ny / nl;
        const side = (p) => (p[0] - M[0]) * ux + (p[1] - M[1]) * uy;   // > 0: the lifted side
        const corners = [[0, 0], [W, 0], [W, H], [0, H]], keep = [], lift = [];
        for (let i = 0; i < 4; i++) {
          const a = corners[i], c2 = corners[(i + 1) % 4], sa = side(a), sb = side(c2);
          (sa <= 0 ? keep : lift).push(a);
          if ((sa <= 0) !== (sb <= 0)) { const u = sa / (sa - sb), x = [a[0] + (c2[0] - a[0]) * u, a[1] + (c2[1] - a[1]) * u]; keep.push(x); lift.push(x); }
        }
        out.root.style.clipPath = keep.length >= 3 ? `polygon(${keep.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})` : 'polygon(0 0, 0 0, 0 0)';
        // the flap: the lifted part mirrored over the fold (the back of the page)
        const flap = lift.map((p) => { const d = side(p); return [p[0] - 2 * d * ux, p[1] - 2 * d * uy]; });
        g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.clearRect(0, 0, W, H); drawn = true;
        if (flap.length >= 3 && k < 0.999) {
          // shadow the flap casts on the next page, beyond the fold
          const sg = g.createLinearGradient(M[0], M[1], M[0] + ux * 90, M[1] + uy * 90);
          sg.addColorStop(0, 'rgba(70, 50, 25, 0.28)'); sg.addColorStop(1, 'rgba(70, 50, 25, 0)');
          g.fillStyle = sg; g.beginPath(); lift.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
          g.save(); g.shadowColor = 'rgba(60, 40, 20, 0.3)'; g.shadowBlur = 24; g.shadowOffsetX = -8; g.shadowOffsetY = 6;
          g.fillStyle = g.createPattern(CR.paper, 'repeat'); g.beginPath(); flap.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.restore();
          // the curl: darker near the fold, lighter at the far edge
          const fg = g.createLinearGradient(M[0], M[1], M[0] - ux * 360, M[1] - uy * 360);
          fg.addColorStop(0, 'rgba(120, 90, 50, 0.32)'); fg.addColorStop(0.18, 'rgba(255, 250, 235, 0.25)'); fg.addColorStop(1, 'rgba(120, 90, 50, 0.08)');
          g.fillStyle = fg; g.beginPath(); flap.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
        }
      } catch (e) { /* a page turn never breaks the film */ }
    });
  })();

  PV.CRAYON = { cline, hatch, hatchDraw, dab, face, wax, ell, sm, KINDS, POSE_NAMES, MOODS };
})();
