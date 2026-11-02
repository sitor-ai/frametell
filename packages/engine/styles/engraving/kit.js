/* Copperplate Engraving · burin kit: a natural-history plate cut line by line. Every tone is made of engraved lines:
 * a contour cut in runs that swell on the side turned from the light, then families of parallel hatching that switch on
 * where the form darkens (a first family, a crossing family in the half-tones, a third in the deep darks), each line
 * entering fine, biting deeper and lifting out to a point; stipple for soft tissue; leader lines, figure numbers and
 * italic captions; magnifying roundels; and, after printing, transparent watercolour laid on by hand, blooming from
 * where the brush touched, spilling a little past the line and drying to a tide-line.
 *
 * Techniques adapted, and re-implemented for this engine, from the "engraving" style of LemoLab's lemo-opuscar
 * (MIT licence, (c) 2026 LemoLab): tone families switched on by threshold, the swell law of a burin line, a
 * distance-field "pillow" that lights any closed shape, contours cut in pinched runs, a stroke store cut in order at an
 * even burin speed, and the hand-colouring wash (spill, misregister, tide-line, granulation). See NOTICE.md.
 * Every component is a pure function of page-local time lt. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const RES = 1.5;   // canvas pixels per stage pixel: hairlines stay crisp under a loupe push
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const rgbOf = (c) => { const h = String(col(c || 'ink')).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const rgba = (v, a) => `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${clamp(a).toFixed(3)})`;
  const isZh = (s) => /[㐀-鿿]/.test(String(s));
  const DEG = Math.PI / 180;
  let seedN = 1;

  // ── noise: hashed value noise in [0, 1] ──
  const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise2 = (x, y, s = 0) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash(i, j, s), hash(i + 1, j, s), u), lerp(hash(i, j + 1, s), hash(i + 1, j + 1, s), u), v);
  };
  const noise1 = (x, s = 0) => noise2(x, 0.5, s);

  // ── SVG path data → polylines ([{ pts, closed }]) ──
  function parseD(d, step = 3) {
    const tok = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', lc = null, lq = null, i = 0;
    const num = () => +tok[i++];
    const push = (px, py) => { if (!cur) { cur = { pts: [[x, y]], closed: false }; subs.push(cur); } cur.pts.push([px, py]); };
    const cubic = (x1, y1, x2, y2, x3, y3) => {
      const L = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2), n = Math.max(2, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3); }
      lc = [x2, y2]; x = x3; y = y3;
    };
    const quad = (x1, y1, x2, y2) => {
      const L = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; push(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2); }
      lq = [x1, y1]; x = x2; y = y2;
    };
    const line = (x2, y2) => { const L = Math.hypot(x2 - x, y2 - y), n = Math.max(1, Math.ceil(L / (step * 2))); for (let k = 1; k <= n; k++) push(x + ((x2 - x) * k) / n, y + ((y2 - y) * k) / n); x = x2; y = y2; };
    const arc = (rx, ry, phi, fa, fs, x2, y2) => {
      rx = Math.abs(rx); ry = Math.abs(ry);
      if (!rx || !ry) return line(x2, y2);
      const c = Math.cos(phi * DEG), s = Math.sin(phi * DEG), dx = (x - x2) / 2, dy = (y - y2) / 2;
      const xp = c * dx + s * dy, yp = -s * dx + c * dy, lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const num_ = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
      const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num_ / (den || 1)));
      const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx, cx = c * cxp - s * cyp + (x + x2) / 2, cy = s * cxp + c * cyp + (y + y2) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
      let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
      if (!fs && dt > 0) dt -= Math.PI * 2; else if (fs && dt < 0) dt += Math.PI * 2;
      const n = Math.max(2, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / step));
      for (let k = 1; k <= n; k++) { const t = t1 + (dt * k) / n; push(cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c); }
      x = x2; y = y2;
    };
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), Cc = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
      if (Cc !== 'C' && Cc !== 'S') lc = null;
      if (Cc !== 'Q' && Cc !== 'T') lq = null;
      switch (Cc) {
        case 'M': x = num() + ox; y = num() + oy; sx = x; sy = y; cur = { pts: [[x, y]], closed: false }; subs.push(cur); cmd = rel ? 'l' : 'L'; break;
        case 'L': line(num() + ox, num() + oy); break;
        case 'H': line(num() + ox, y); break;
        case 'V': line(x, num() + oy); break;
        case 'C': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); break; }
        case 'S': { const a = lc ? 2 * x - lc[0] : x, b = lc ? 2 * y - lc[1] : y, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); break; }
        case 'Q': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy; quad(a, b, c, e); break; }
        case 'T': { const a = lq ? 2 * x - lq[0] : x, b = lq ? 2 * y - lq[1] : y; quad(a, b, num() + ox, num() + oy); break; }
        case 'A': { const rx = num(), ry = num(), ph = num(), fa = num(), fs = num(), ex = num() + ox, ey = num() + oy; arc(rx, ry, ph, fa, fs, ex, ey); break; }
        case 'Z': if (cur) { if (Math.hypot(x - sx, y - sy) > 0.01) line(sx, sy); cur.closed = true; if (cur.pts.length > 2) cur.pts.pop(); } x = sx; y = sy; cur = null; break;
        default: i++;
      }
    }
    return subs.filter((s) => s.pts.length > 1);
  }
  const shapeOf = (d) => { const subs = Array.isArray(d) ? d : parseD(d); return { polys: subs.filter((s) => s.closed && s.pts.length > 2).map((s) => s.pts), lines: subs.filter((s) => !s.closed).map((s) => s.pts) }; };
  const toPath2D = (polys) => { const p = new Path2D(); for (const q of polys) { q.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); } return p; };
  function bboxOf(lists, pad = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of lists) for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  function resample(pts, step) {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay); if (d < 1e-9) continue;
      let t0 = 0;
      while (acc + d * (1 - t0) >= step) { const t = t0 + (step - acc) / d; out.push([ax + (bx - ax) * t, ay + (by - ay) * t]); t0 = t; acc = 0; }
      acc += d * (1 - t0);
    }
    const l = pts[pts.length - 1], o = out[out.length - 1];
    if (Math.hypot(o[0] - l[0], o[1] - l[1]) > 0.5) out.push(l);
    return out;
  }
  function normals(P, closed) {
    const n = P.length, N = [];
    for (let i = 0; i < n; i++) {
      const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; N.push([dy / L, -dx / L]);
    }
    return N;
  }
  const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; s += x1 * y2 - x2 * y1; } return s / 2; };
  function inside(polys, x, y) {   // even-odd over all rings: a ring inside a ring is a hole
    let ins = false;
    for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  const insideAny = (groups, x, y) => groups.some((g) => inside(g, x, y));

  // ── shapes: SVG path strings for the specimen's parts (PV.EG) ──
  const fmt = (v) => (Math.round(v * 10) / 10).toString();
  const polyD = (pts, closed = true) => 'M' + pts.map((p) => fmt(p[0]) + ' ' + fmt(p[1])).join(' L') + (closed ? ' Z' : '');
  function smoothD(pts, closed = true) {
    const n = pts.length; if (n < 3) return polyD(pts, closed);
    const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      d += ` C${fmt(p1[0] + (p2[0] - p0[0]) / 6)} ${fmt(p1[1] + (p2[1] - p0[1]) / 6)} ${fmt(p2[0] - (p3[0] - p1[0]) / 6)} ${fmt(p2[1] - (p3[1] - p1[1]) / 6)} ${fmt(p2[0])} ${fmt(p2[1])}`;
    }
    return d + (closed ? ' Z' : '');
  }
  const ellPts = (cx, cy, rx, ry, rot = 0, n = 72) => { const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG); return Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + c * x - s * y, cy + s * x + c * y]; }); };
  function densify(pts, per = 6) {
    const n = pts.length; if (n < 3) return pts.slice();
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))], out = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    out.push(pts[n - 1]); return out;
  }
  const EG = {
    /** a closed polygon (or open polyline with closed=false) through [[x, y], …] */
    poly: (pts, closed = true) => polyD(pts, closed),
    /** a smooth closed curve (or open, closed=false) through [[x, y], …]: bodies, organs, shells, coastlines, beaks */
    smooth: (pts, closed = true) => smoothD(pts, closed),
    ellipse: (cx, cy, rx, ry, rot = 0) => polyD(ellPts(cx, cy, rx, ry, rot)),
    circle: (cx, cy, r) => polyD(ellPts(cx, cy, r, r, 0, Math.max(36, Math.round(r / 3)))),
    /** an annulus (two rings: the inner one is a hole): an iris, a cross-cut vessel, a tree ring */
    ring: (cx, cy, r0, r1) => polyD(ellPts(cx, cy, r1, r1)) + ' ' + polyD(ellPts(cx, cy, r0, r0).reverse()),
    /** an open arc, degrees, 0 = east, clockwise: for P.cut */
    arc: (cx, cy, r, a0, a1) => { const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 4)); return polyD(Array.from({ length: n + 1 }, (_, k) => { const a = (a0 + ((a1 - a0) * k) / n) * DEG; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }), false); },
    /** a limb, a vessel, a nerve, an antenna, a stem: a closed outline round the centre line pts, width w0 → w1, round ends */
    tube: (pts, w0 = 30, w1) => {
      const C = densify(pts, 8), n = C.length, N = normals(C, false), L = [], R = [], wEnd = w1 ?? w0 * 0.6;
      C.forEach((p, i) => { const w = lerp(w0, wEnd, i / (n - 1)) / 2; L.push([p[0] + N[i][0] * w, p[1] + N[i][1] * w]); R.push([p[0] - N[i][0] * w, p[1] - N[i][1] * w]); });
      const cap = (p, nrm, w, flip) => Array.from({ length: 7 }, (_, k) => { const a = Math.atan2(nrm[1], nrm[0]) + (flip ? 1 : -1) * (Math.PI * (k + 1)) / 8; return [p[0] + Math.cos(a) * w, p[1] + Math.sin(a) * w]; });
      const endCap = cap(C[n - 1], N[n - 1], wEnd / 2, true), startCap = cap(C[0], [-N[0][0], -N[0][1]], w0 / 2, true);
      return polyD(L.concat(endCap, R.reverse(), startCap));
    },
    /** a pointed leaf / petal / wing / lens: base at (x, y), tip len away at angle ang (degrees, 0 = east), widest w at 40% */
    leaf: (x, y, len, w, ang = 0, bulge = 0.4) => {
      const c = Math.cos(ang * DEG), s = Math.sin(ang * DEG), n = 18, side = (sg) => Array.from({ length: n + 1 }, (_, k) => {
        const u = k / n, half = (w / 2) * Math.pow(Math.sin(Math.PI * Math.pow(u, Math.log(0.5) / Math.log(bulge))), 0.85);
        return [u * len, sg * half];
      });
      const pts = side(1).concat(side(-1).reverse().slice(1, -1)).map(([a, b]) => [x + a * c - b * s, y + a * s + b * c]);
      return smoothD(pts);
    },
    /** a block cut open to show its layers (skin, the wall of the eye, a leaf, soil, rock strata, an artery wall):
     *  returns one closed outline per layer, top to bottom, from (x, y), width w, heights hs [h1, h2, …]; boundaries wave
     *  by wave px (seeded). Engrave them as parts, each with its own angle / style / tint, and a flat tone (0.2–0.7): a cut face is flat, not rounded. */
    layers: (x, y, w, hs, wave = 10, seed = 1) => {
      const n = 24, edge = (yy, k) => Array.from({ length: n + 1 }, (_, i) => [x + (w * i) / n, yy + (k === 0 ? 1.4 : 0.8) * wave * (noise1(i * 0.45 + k * 5.3 + seed * 3.1, seed + k) * 2 - 1)]);
      const out = []; let yy = y;
      hs.forEach((h, k) => { const top = edge(yy, k), bot = edge(yy + h, k + 1); out.push(smoothD(top.concat(bot.reverse())).replace(/ Z$/, '') + ' Z'); yy += h; });
      return out;
    },
    /** an irregular rounded body (a cell, an organ, a seed, an island): radius r wobbling by wob, seeded */
    blob: (cx, cy, r, seed = 1, wob = 0.18, ry) => {
      const n = 14, pts = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, f = 1 + wob * (noise1(k * 0.9 + seed * 7.1, seed) * 2 - 1); return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * (ry ?? r) * f]; });
      return smoothD(pts);
    },
  };

  // ── the ink: strokes kept in cutting order; each has a window [s0, s1] in which the burin cuts it ──
  const WQ = 0.1, MINW = 0.14;
  const bucketOf = (w) => Math.max(1, Math.min(90, Math.round(w / WQ)));
  class Ink {
    constructor() { this.S = []; this.built = false; }
    add(pts, ws, g) {
      const n = pts.length; if (n < 2) return;
      const xy = new Float32Array(n * 2), wv = new Float32Array(n); let len = 0, any = false;
      for (let i = 0; i < n; i++) { xy[2 * i] = pts[i][0]; xy[2 * i + 1] = pts[i][1]; wv[i] = typeof ws === 'number' ? ws : ws[i]; if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (wv[i] > MINW) any = true; }
      if (!any) return;
      this.S.push({ xy, ws: wv, n, len, g, s0: 0, s1: 0 }); this.built = false;
    }
    dot(x, y, r, g) { this.add([[x - 0.05, y], [x + 0.05, y]], r * 2, g); }
    /** give the group's strokes cutting windows in [t0, t1], in the order they were added, at an even burin speed */
    schedule(g, t0, t1, conc = 4) {
      const L = this.S.filter((s) => s.g === g); if (!L.length) return;
      const tot = L.reduce((a, s) => a + s.len, 0) || 1, T = Math.max(0.05, t1 - t0), v = tot / (T * Math.max(1, conc));
      let acc = 0;
      for (const s of L) { const d = Math.min(T, Math.max(0.05, s.len / v)); let st = t0 + (acc / tot) * T; const en = Math.min(t1, st + d); if (en - st < 0.05) st = en - 0.05; s.s0 = st; s.s1 = en; acc += s.len; }
      this.built = false;
    }
    get end() { return this.S.reduce((m, s) => Math.max(m, s.s1), 0); }
    runs(s, f, per) {
      const { xy, ws } = s, last = Math.min(s.n - 1, f); let rb = -1, p = null;
      for (let i = 0; i < last; i++) {
        const seg = Math.min(1, last - i), w = (ws[i] + ws[i + 1]) * 0.5;
        if (!(w > MINW)) { rb = -1; continue; }
        const b = bucketOf(w);
        if (b !== rb) { p = per.get(b); if (!p) per.set(b, (p = new Path2D())); p.moveTo(xy[2 * i], xy[2 * i + 1]); rb = b; }
        p.lineTo(xy[2 * i] + (xy[2 * i + 2] - xy[2 * i]) * seg, xy[2 * i + 1] + (xy[2 * i + 3] - xy[2 * i + 1]) * seg);
      }
    }
    build() {
      const S = this.S.slice().sort((a, b) => a.s1 - b.s1); this.sorted = S; this.maxDur = S.reduce((m, s) => Math.max(m, s.s1 - s.s0), 0);
      this.chunks = [];
      for (let a = 0; a < S.length; a += 120) {
        const b = Math.min(S.length, a + 120), per = new Map();
        for (let k = a; k < b; k++) this.runs(S[k], S[k].n - 1, per);
        this.chunks.push({ a, t: S[b - 1].s1, paths: [...per.entries()] });
      }
      this.built = true;
    }
    draw(c, t, color) {
      if (!this.S.length) return;
      if (!this.built) this.build();
      c.save(); c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
      let k = 0;
      for (; k < this.chunks.length; k++) { const ch = this.chunks[k]; if (ch.t > t) break; for (const [b, p] of ch.paths) { c.lineWidth = b * WQ; c.stroke(p); } }
      if (k < this.chunks.length) {
        const per = new Map(), S = this.sorted;
        for (let i = this.chunks[k].a; i < S.length; i++) {
          const s = S[i]; if (s.s0 >= t) { if (s.s1 > t + this.maxDur + 0.001) break; continue; }
          this.runs(s, s.s1 <= t ? s.n - 1 : (s.n - 1) * clamp((t - s.s0) / (s.s1 - s.s0)), per);
        }
        for (const [b, p] of per) { c.lineWidth = b * WQ; c.stroke(p); }
      }
      c.restore();
    }
  }

  // ── tone fields: 0 = lit (bare paper) … 1 = turned from the light (the deepest cross-hatching) ──
  const LIGHT = [-0.6, -0.75];
  function edgesOf(polys) { const E = []; for (const p of polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; E.push(a[0], a[1], b[0], b[1]); } return E; }
  /** a closed shape inflated into a pillow and lit: works for any outline (a body, a leaf, an organ) */
  function pillow(polys, o = {}) {
    const [x0, y0, x1, y1] = bboxOf(polys, 3), bw = x1 - x0, bh = y1 - y0, g = Math.max(bw, bh) / (o.res ?? 140);
    const nx = Math.ceil(bw / g) + 1, ny = Math.ceil(bh / g) + 1, D = new Float32Array(nx * ny), E = edgesOf(polys), INF = 1e9;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * g, xs = [];
      for (let k = 0; k < E.length; k += 4) { const ay = E[k + 1], by = E[k + 3]; if ((ay <= y) !== (by <= y)) xs.push(E[k] + ((y - ay) / (by - ay)) * (E[k + 2] - E[k])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - x0) / g)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / g)); i++) D[j * nx + i] = INF;
    }
    const a1 = 1, a2 = 1.4142;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const id = j * nx + i; if (!D[id]) continue; let m = D[id];
      if (i > 0) m = Math.min(m, D[id - 1] + a1); else m = Math.min(m, a1); if (j > 0) m = Math.min(m, D[id - nx] + a1); else m = Math.min(m, a1);
      if (i > 0 && j > 0) m = Math.min(m, D[id - nx - 1] + a2); if (i < nx - 1 && j > 0) m = Math.min(m, D[id - nx + 1] + a2); D[id] = m; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const id = j * nx + i; if (!D[id]) continue; let m = D[id];
      if (i < nx - 1) m = Math.min(m, D[id + 1] + a1); else m = Math.min(m, a1); if (j < ny - 1) m = Math.min(m, D[id + nx] + a1); else m = Math.min(m, a1);
      if (i < nx - 1 && j < ny - 1) m = Math.min(m, D[id + nx + 1] + a2); if (i > 0 && j < ny - 1) m = Math.min(m, D[id + nx - 1] + a2); D[id] = m; }
    let dmax = 0; for (const v of D) if (v > dmax && v < INF) dmax = v;
    const R = (o.radius ? o.radius / g : dmax) || 1, Hh = new Float32Array(nx * ny);
    for (let i = 0; i < D.length; i++) { const u = Math.min(1, D[i] / R); Hh[i] = D[i] ? Math.sqrt(1 - (1 - u) * (1 - u)) * R : 0; }
    const lt = o.light || LIGHT, Ln = Math.hypot(lt[0], lt[1], 0.55), lx = lt[0] / Ln, ly = lt[1] / Ln, lz = 0.55 / Ln;
    const base = o.base ?? 0.04, rim = o.rim ?? 0.22, T = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = j * nx + i; if (!D[id]) continue;
      const hx = (Hh[j * nx + Math.min(nx - 1, i + 1)] - Hh[j * nx + Math.max(0, i - 1)]) / 2, hy = (Hh[Math.min(ny - 1, j + 1) * nx + i] - Hh[Math.max(0, j - 1) * nx + i]) / 2;
      const L = Math.hypot(hx, hy, 1), lam = clamp((-hx / L) * lx + (-hy / L) * ly + (1 / L) * lz);
      T[id] = clamp(base + (1 - lam) * 1.25 - 0.2 + rim * Math.max(0, 1 - D[id] / (R * 0.2)) * 0.5);   // the lit side is bare paper
    }
    return (x, y) => {
      const fx = (x - x0) / g, fy = (y - y0) / g, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return 0;
      const u = fx - i, v = fy - j, id = j * nx + i;
      return (T[id] * (1 - u) + T[id + 1] * u) * (1 - v) + (T[id + nx] * (1 - u) + T[id + nx + 1] * u) * v;
    };
  }
  /** an analytic sphere / ellipsoid lit from the light: eyes, eggs, cells, fruit, planets */
  function sphereTone(cx, cy, rx, ry, light = LIGHT) {
    const Ln = Math.hypot(light[0], light[1], 0.55), lx = light[0] / Ln, ly = light[1] / Ln, lz = 0.55 / Ln;
    return (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, r2 = dx * dx + dy * dy, nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
      return clamp((1 - clamp(dx * lx + dy * ly + nz * lz)) * 1.22 - 0.18 + (r2 > 0.82 ? (r2 - 0.82) * 1.4 : 0));
    };
  }

  // ── the engraver's lines ──
  function spans(E, b) { const xs = []; for (let k = 0; k < E.length; k += 4) { const b1 = E[k + 1], b2 = E[k + 3]; if ((b1 <= b) !== (b2 <= b)) xs.push(E[k] + ((b - b1) / (b2 - b1)) * (E[k + 2] - E[k])); } return xs.sort((p, q) => p - q); }
  function subtract(a, e, m = 0) {
    if (!e.length) return a;
    const out = [];
    for (let i = 0; i < a.length; i += 2) {
      let s = a[i]; const f = a[i + 1];
      for (let j = 0; j < e.length; j += 2) { const e0 = e[j] - m, e1 = e[j + 1] + m; if (e1 <= s || e0 >= f) continue; if (e0 > s) out.push(s, e0); s = Math.max(s, e1); if (s >= f) break; }
      if (s < f) out.push(s, f);
    }
    return out;
  }
  /** one family of parallel lines at `angle`, bowed by `bend` so they wrap the form, clipped to the shape minus excl;
   *  each line's width follows the tone (absent where it is lit) and swells mid-run like a burin line */
  function hatch(ink, polys, o, g) {
    const { angle = 0, spacing = 6, bend = 0, tone, thr = 0.12, wMin = 0.25, wMax = 2.2, step = 3, taper = 12, jitter = 0.14, wobble = 0.35, seed = 1, excl = null, swell = 0.75, margin = 0, flat = false } = o;
    const c = Math.cos(angle), s = Math.sin(angle), bb = bboxOf(polys), O = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    const tr = (x, y) => { const dx = x - O[0], dy = y - O[1], A = dx * c + dy * s; return [A, -dx * s + dy * c - bend * A * A]; };
    const edges = (pl) => { const E = []; for (const p of pl) for (let i = 0; i < p.length; i++) { const [a1, b1] = tr(p[i][0], p[i][1]), [a2, b2] = tr(p[(i + 1) % p.length][0], p[(i + 1) % p.length][1]); E.push(a1, b1, a2, b2); } return E; };
    const E = edges(polys), X = excl && excl.length ? excl.map((q) => edges(q)) : null;
    let bmin = Infinity, bmax = -Infinity; for (let k = 1; k < E.length; k += 2) { bmin = Math.min(bmin, E[k]); bmax = Math.max(bmax, E[k]); }
    const R = PV.rng(seed * 31 + 7); let li = 0;
    for (let b = bmin + spacing * (0.3 + 0.5 * R()); b < bmax; b += spacing * (1 + (R() - 0.5) * jitter), li++) {
      let iv = spans(E, b); if (X) for (const xe of X) iv = subtract(iv, spans(xe, b), margin);
      for (let k = 0; k + 1 < iv.length; k += 2) {
        const A0 = iv[k], A1 = iv[k + 1], L = A1 - A0; if (L < 2) continue;
        const n = Math.max(2, Math.ceil(L / step)), pts = [], ws = [];
        for (let j = 0; j <= n; j++) {
          const A = A0 + (L * j) / n, wob = (noise1(A * 0.015 + li * 3.7, seed) - 0.5) * wobble * 2, Bv = b + bend * A * A + wob;
          const x = O[0] + A * c - Bv * s, y = O[1] + A * s + Bv * c;
          const v = (tone(x, y) - thr) / (1 - thr); let w = v > 0 ? wMin + (wMax - wMin) * Math.min(1, v * 1.25) : 0;
          if (flat) w = wMax;
          const uu = (A - A0) / L, tp = Math.max(taper, L * 0.2), e = Math.min(A - A0, A1 - A);
          w *= 1 - swell + swell * Math.pow(Math.sin(Math.PI * uu), 0.7);
          if (e < tp) w *= Math.pow(e / tp, 0.8);
          pts.push([x, y]); ws.push(w);
        }
        ink.add(pts, ws, g);
      }
    }
  }
  /** a contour cut in runs: heavier on the side turned from the light, thinning where one run hands over to the next */
  function contour(ink, pts, o, g) {
    const { w = 2.6, light = LIGHT, vary = 0.8, seed = 3, step = 2.5, excl = null, run = 120, pinch = 0.5 } = o;
    const P = resample(pts.concat([pts[0]]), step); P.pop();
    const n = P.length; if (n < 3) return;
    const N = normals(P, true), sg = area(P) > 0 ? 1 : -1, Ll = Math.hypot(light[0], light[1]), lx = light[0] / Ll, ly = light[1] / Ll, ws = [];
    for (let i = 0; i < n; i++) {
      const sh = -(N[i][0] * sg * lx + N[i][1] * sg * ly);
      let wi = w * (1 - vary * 0.45 + vary * 0.9 * clamp(sh * 0.5 + 0.5));
      wi *= 1 + (noise1(i * step * 0.03, seed) - 0.5) * 0.35;
      const ph = (i * step) / run + noise1(((i * step) / run) * 0.7, seed + 5) * 0.6;
      wi *= 1 - pinch + pinch * Math.pow(Math.abs(Math.sin(Math.PI * ph)), 0.55);
      if (excl && insideAny(excl, P[i][0], P[i][1])) wi = 0;
      ws.push(wi);
    }
    P.push(P[0]); ws.push(ws[0]);
    ink.add(P, ws, g);
  }
  /** an open burin stroke: enters fine, swells, lifts out to a point; dotted: a flick-dotted line */
  function stroke(ink, pts, o, g) {
    const { w = 2.2, step = 2.5, excl = null, dotted = false, taper = 16, seed = 2 } = o;
    const P = resample(pts, step), n = P.length; if (n < 2) return;
    const Lt = (n - 1) * step, tp = Math.min(Lt * 0.35, Math.max(taper, Lt * 0.18)), ws = [];
    for (let i = 0; i < n; i++) {
      const e0 = i * step, e1 = (n - 1 - i) * step;
      let wi = w * Math.pow(Math.min(1, e0 / tp), 0.7) * Math.pow(Math.min(1, e1 / tp), 0.7) * (0.8 + 0.2 * Math.sin((Math.PI * i) / (n - 1)));
      wi *= 1 + (noise1(i * 0.08, seed) - 0.5) * 0.25;
      if (dotted) wi = (e0 % 14) < 5 ? w : 0;
      if (excl && insideAny(excl, P[i][0], P[i][1])) wi = 0;
      ws.push(wi);
    }
    ink.add(P, ws, g);
  }
  function stipple(ink, polys, tone, o, g) {
    const { density = 0.03, r = 1.1, seed = 5, thr = 0.1, excl = null } = o;
    const bb = bboxOf(polys), R = PV.rng(seed * 17 + 3), n = Math.floor((bb[2] - bb[0]) * (bb[3] - bb[1]) * density), pts = [];
    for (let i = 0; i < n; i++) {
      const x = bb[0] + R() * (bb[2] - bb[0]), y = bb[1] + R() * (bb[3] - bb[1]), q = R();
      if (!inside(polys, x, y) || (excl && insideAny(excl, x, y))) continue;
      const t = tone(x, y); if (q < (t - thr) * 1.3) pts.push([x, y, r * (0.55 + t * 0.7)]);
    }
    pts.sort((a, b) => a[0] + a[1] * 0.4 - (b[0] + b[1] * 0.4));
    for (const [x, y, rr] of pts) ink.dot(x, y, rr, g);
  }

  // ── hand colouring: a transparent wash laid over the print ──
  let grainC = null;
  function grainTex() {
    if (grainC) return grainC;
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), im = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const n = noise2(x / 1.7, y / 1.7, 3) * 0.6 + noise2(x / 5, y / 5, 4) * 0.4; im.data[(y * 256 + x) * 4 + 3] = Math.max(0, n - 0.5) * 255 * 1.7; }
    g.putImageData(im, 0, 0); grainC = c; return c;
  }
  function makeWash(polys, color, o = {}) {
    const bb = bboxOf(polys), seed = o.seed ?? seedN++, from = o.from || [lerp(bb[0], bb[2], 0.4), lerp(bb[1], bb[3], 0.4)];
    const far = Math.max(...[[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(([x, y]) => Math.hypot(x - from[0], y - from[1]))) + 20;
    const it = { polys, path: toPath2D(polys), col: rgbOf(color), at: o.at ?? 0, dur: o.dur ?? 1.6, alpha: o.alpha ?? 0.66, spill: o.spill ?? 4, off: [2.5, 1.5], from, far, seed, bb, cache: null };
    it.paint = () => {
      if (it.cache) return it.cache;
      const k = RES, pad = it.spill * 2 + 14, x0 = bb[0] - pad, y0 = bb[1] - pad, cw = Math.ceil((bb[2] - bb[0] + pad * 2) * k), chh = Math.ceil((bb[3] - bb[1] + pad * 2) * k);
      const c = document.createElement('canvas'); c.width = cw; c.height = chh; const g = c.getContext('2d'), dark = it.col.map((v) => v * 0.6);
      const local = (cx) => cx.setTransform(k, 0, 0, k, (-x0 + it.off[0]) * k, (-y0 + it.off[1]) * k);
      local(g); g.fillStyle = rgba(it.col, 1); g.strokeStyle = rgba(it.col, 1); g.lineJoin = 'round'; g.fill(it.path, 'evenodd'); g.lineWidth = it.spill * 2; g.stroke(it.path);
      // uneven pigment: lift some of it in soft patches
      const dc = document.createElement('canvas'); dc.width = Math.ceil(cw / 6); dc.height = Math.ceil(chh / 6); const dg = dc.getContext('2d'), im = dg.createImageData(dc.width, dc.height);
      for (let y = 0; y < dc.height; y++) for (let x = 0; x < dc.width; x++) { const n = noise2(x / 16, y / 16, seed) * 0.6 + noise2(x / 5, y / 5, seed + 1) * 0.4; im.data[(y * dc.width + x) * 4 + 3] = Math.max(0, n - 0.35) * 255 * 0.8; }
      dg.putImageData(im, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.55; g.drawImage(dc, 0, 0, cw, chh);
      // the tide-line: pigment pooled at the edge of the wet area, and a softer pooling just inside the line
      const e = document.createElement('canvas'); e.width = cw; e.height = chh; const eg = e.getContext('2d');
      local(eg); eg.lineJoin = 'round'; eg.strokeStyle = rgba(dark, 1); eg.lineWidth = it.spill * 2 + 3; eg.stroke(it.path);
      eg.globalCompositeOperation = 'destination-out'; eg.lineWidth = Math.max(0.5, it.spill * 2 - 1.5); eg.stroke(it.path); eg.fill(it.path, 'evenodd');
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.5; g.filter = 'blur(1px)'; g.drawImage(e, 0, 0); g.filter = 'none';
      local(g); g.save(); g.clip(it.path, 'evenodd'); g.globalAlpha = 0.18; g.strokeStyle = rgba(dark, 1); g.lineWidth = 8; g.filter = 'blur(3px)'; g.stroke(it.path); g.restore(); g.filter = 'none';
      // granulation: the paper's tooth shows through
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.45; g.fillStyle = g.createPattern(grainTex(), 'repeat'); g.fillRect(0, 0, cw, chh);
      it.cache = { c, x0, y0, w: cw / k, h: chh / k };
      return it.cache;
    };
    it.k = (lt) => clamp((lt - it.at) / it.dur);
    it.draw = (c, lt) => {
      const p = it.k(lt); if (p <= 0) return;
      const cache = it.paint(), e = 1 - Math.pow(1 - p, 2.2), Rr = it.far * e * 1.1;
      const front = (cx) => { cx.beginPath(); for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2, rr = Rr * (0.84 + 0.3 * noise1(a * 2.2 + it.seed * 7, it.seed) + 0.06 * noise1(a * 9, it.seed + 3)), x = it.from[0] + Math.cos(a) * rr, y = it.from[1] + Math.sin(a) * rr; i ? cx.lineTo(x, y) : cx.moveTo(x, y); } cx.closePath(); };
      c.save(); if (p < 1) { front(c); c.clip(); }
      c.globalAlpha = it.alpha; c.drawImage(cache.c, cache.x0, cache.y0, cache.w, cache.h); c.restore();
      if (p < 1 && p > 0.02) { c.save(); c.clip(it.path, 'evenodd'); c.globalAlpha = 0.35 * (1 - p); c.strokeStyle = rgba(it.col, 1); c.lineWidth = 6; front(c); c.stroke(); c.restore(); }
    };
    return it;
  }

  // ── mounting: one canvas per component, multiplied into the paper; fades out at hide(t) / o.out ──
  function mount(self, box, o, draw, key) {
    const [x, y, x1, y1] = box.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v))), w = x1 - x, h = y1 - y;
    const cv = PV.h('canvas', 'eg-cv', null, self.html);
    cv.width = Math.max(1, Math.ceil(w * RES)); cv.height = Math.max(1, Math.ceil(h * RES));
    Object.assign(cv.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const ctx = cv.getContext('2d'), st = { out: o.out, outDur: o.outDur ?? 0.6 };
    let last = null;
    self.tick((lt) => {
      const op = st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1;
      cv.style.opacity = op.toFixed(3);
      if (o.move) { const m = o.move(lt) || {}, cx = (m.cx ?? (x + w / 2)) - x, cy = (m.cy ?? (y + h / 2)) - y; cv.style.transformOrigin = `${cx}px ${cy}px`; cv.style.transform = `translate(${(m.dx || 0).toFixed(2)}px, ${(m.dy || 0).toFixed(2)}px) rotate(${(m.rot || 0).toFixed(3)}deg) scale(${(m.s ?? 1).toFixed(4)})`; }
      if (op <= 0.001) return;
      const k = key(lt); if (k === last) return; last = k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(RES, 0, 0, RES, -x * RES, -y * RES); draw(ctx, lt);
    });
    return { el: cv, hide(t, d = 0.6) { st.out = t; st.outDur = d; return this; } };
  }

  // ── a specimen: parts engraved in the engraver's order ──
  const asParts = (parts) => (Array.isArray(parts) ? parts : [parts]).map((p) => (typeof p === 'string' ? { d: p } : p));
  function buildFigure(parts, o, at, dur) {
    const ink = new Ink(), light = o.light || LIGHT, P = asParts(parts).map((p) => ({ ...p, sh: shapeOf(p.d) }));
    const all = P.flatMap((p) => p.sh.polys.concat(p.sh.lines)), fb = bboxOf(all.length ? all : [[[0, 0]]]), S = Math.max(fb[2] - fb[0], fb[3] - fb[1]);
    const seed0 = o.seed ?? seedN++;
    P.forEach((p, i) => {
      const { polys, lines } = p.sh, front = P.slice(i + 1).map((q) => q.sh.polys).filter((q) => q.length), seed = seed0 * 7 + i * 13;
      const style = p.style ?? o.style ?? 'hatch';
      for (const q of polys) contour(ink, q, { w: p.w ?? o.w ?? (S > 500 ? 2.8 : 2.3), light, seed, excl: front }, 'o');
      for (const l of lines) stroke(ink, l, { w: (p.w ?? o.w ?? 2.3) * 0.75, excl: front, seed }, 'l');
      if (!polys.length || style === 'line') return;
      const pb = bboxOf(polys), ps = Math.max(pb[2] - pb[0], pb[3] - pb[1]), pm = Math.min(pb[2] - pb[0], pb[3] - pb[1]);
      let tone = p.tone === 'sphere' ? sphereTone((pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2, (pb[2] - pb[0]) / 2, (pb[3] - pb[1]) / 2, light)
        : p.tone === 'flat' || typeof p.tone === 'number' ? (() => typeof p.tone === 'number' ? p.tone : 0.45)() : pillow(polys, { light });
      if (typeof tone === 'number') { const v = tone; tone = () => v; }
      const dark = p.dark ?? o.dark ?? 0, t0 = tone, toneF = style === 'dark' ? () => 0.97 : dark ? (x, y) => clamp(t0(x, y) + dark * (0.25 + 0.75 * (t0(x, y) > 0 ? 1 : 0))) : t0;
      const sp = p.spacing ?? o.spacing ?? clamp(pm / 55, 4.6, 7.5), ang = (p.angle ?? o.angle ?? (-38 + ((i * 47) % 90))) * DEG;
      const bend = ((p.wrap ?? o.wrap ?? 0.35) * 1) / Math.max(40, ps), wMax = p.wMax ?? o.wMax ?? (sp * 0.36 + 0.3);
      if (style === 'stipple') { stipple(ink, polys, toneF, { density: (p.density ?? 0.045) * (6 / sp), excl: front, seed }, 'h1'); return; }
      hatch(ink, polys, { angle: ang, spacing: sp, bend, tone: toneF, thr: 0.12, wMax, excl: front, seed }, 'h1');
      hatch(ink, polys, { angle: ang + 1.05, spacing: sp * 1.1, bend: -bend * 0.6, tone: toneF, thr: 0.48, wMax: wMax * 0.8, excl: front, seed: seed + 11 }, 'h2');
      hatch(ink, polys, { angle: ang - 0.5, spacing: sp * 1.25, bend: bend * 0.3, tone: toneF, thr: 0.74, wMax: wMax * 0.62, excl: front, seed: seed + 23 }, 'h3');
      if (p.stipple) stipple(ink, polys, toneF, { density: 0.02 * (6 / sp), excl: front, seed: seed + 5 }, 'h3');
    });
    ink.schedule('o', at, at + dur * 0.32, 3);
    ink.schedule('l', at + dur * 0.2, at + dur * 0.42, 4);
    ink.schedule('h1', at + dur * 0.3, at + dur * 0.74, 14);
    ink.schedule('h2', at + dur * 0.62, at + dur * 0.9, 14);
    ink.schedule('h3', at + dur * 0.8, at + dur, 14);
    // washes: per part (p.tint) or the whole figure (o.tint), laid after printing
    const washes = [], tintAt = o.tintAt ?? at + dur + 0.5;
    P.forEach((p, i) => {
      const c = p.tint ?? (p.tint === false ? null : o.tint); if (!c || !p.sh.polys.length) return;
      washes.push(makeWash(p.sh.polys, c, { at: (p.tintAt ?? tintAt) + (p.tintAt == null ? i * 0.12 : 0), dur: o.tintDur ?? 1.6, from: p.from ?? o.from, alpha: p.alpha ?? o.alpha, seed: seed0 * 5 + i }));
    });
    return { ink, washes, box: fb, end: at + dur, polys: P.flatMap((p) => p.sh.polys) };
  }
  const figKey = (fig, lt) => { const t = Math.min(lt, fig.end + 0.01); return t.toFixed(3) + fig.washes.map((w) => '|' + w.k(lt).toFixed(3)).join(''); };

  /** engrave(parts, o): the signature — a specimen cut into the plate line by line: each part's contour first (heavier on
   *  the side away from the light, upper left), then the hatching sweeps across each form in three passes (a first
   *  family where it turns from the light, a crossing family in the half-tones, a third in the deepest darks), so the
   *  figure gains volume pass by pass. parts: an SVG path d (use PV.EG shapes), or an array of parts, back to front —
   *  later parts sit in front and stop the lines of those behind them. A part: d, or { d, angle (hatch direction in
   *  degrees; give each part its own, across its long axis), tone ('form' (default) | 'sphere' | 'flat' | 0..1),
   *  dark (0..0.6: a darker part, e.g. a shadowed side or a stained tissue), style ('hatch' | 'stipple' (dots: soft
   *  tissue, skin, pollen) | 'line' (contour only) | 'dark' (fully cross-hatched: a pupil, a hole, a cavity)), tint (a
   *  wash colour for this part), tintAt, spacing, w (contour weight) }. Open subpaths in d are cut as fine lines
   *  (veins, nerves, hairs, ribs of a wing). o: { at, dur (3.2), tint (a wash colour for the whole figure), tintAt (when
   *  the colour floods in: the payoff word, P.cw(i, 'word')), tintDur (1.6), from ([x, y] where the brush touches), light
   *  ([-0.6, -0.75]), spacing, angle, wrap (0.35: how much hatch lines bow round the form), move (lt => { dx, dy, rot, s,
   *  cx, cy }), seed } */
  B.engrave = function (parts, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 3.2, fig = buildFigure(parts, o, at, dur), color = col(o.color || 'ink');
    const draw = (c, lt) => { for (const w of fig.washes) w.draw(c, lt); fig.ink.draw(c, lt, color); };
    const m = mount(this, [fig.box[0] - 30, fig.box[1] - 30, fig.box[2] + 30, fig.box[3] + 30], o, draw, (lt) => figKey(fig, lt));
    return { el: m.el, hide: m.hide, end: fig.end, box: fig.box };
  };

  /** cut(d, o): fine engraved lines cut one after another along an SVG path's subpaths (open or closed): veins, nerves,
   *  hairs, the ribs of a wing, a light ray, a growth line, a coastline, a tree of descent. Each line enters fine, swells
   *  and lifts out to a point. o: { at, dur (1.2), w (2.2), dotted (false: a flick-dotted line, for a path or a ray),
   *  conc (2: lines being cut at once), color ('ink'; a colour name gives a coloured line, used sparingly) } */
  B.cut = function (d, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.2, ink = new Ink(), subs = parseD(d), color = col(o.color || 'ink');
    for (const s of subs) stroke(ink, s.closed ? s.pts.concat([s.pts[0]]) : s.pts, { w: o.w ?? 2.2, dotted: o.dotted, seed: seedN++ }, 'l');
    ink.schedule('l', at, at + dur, o.conc ?? 2);
    const bb = bboxOf(subs.map((s) => s.pts), 12), end = at + dur;
    return mount(this, bb, o, (c, lt) => ink.draw(c, lt, color), (lt) => Math.min(lt, end + 0.01).toFixed(3));
  };

  /** pointer(x1, y1, x2, y2, o): an engraved arrow — a slender swelling shaft and a barbed head — for a step in a
   *  process, the way light travels, food going in, cause to effect. o: { at, dur (0.8), bend (0: + bows it to the
   *  left of travel), w (2.4), dotted (false), color } */
  B.pointer = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.8, ink = new Ink(), color = col(o.color || 'ink'), bend = o.bend ?? 0, w = o.w ?? 2.4;
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const shaft = Array.from({ length: 33 }, (_, k) => { const t = k / 32, u = 1 - t; return [u * u * x1 + 2 * u * t * mx + t * t * x2, u * u * y1 + 2 * u * t * my + t * t * y2]; });
    const [px, py] = shaft[30], a = Math.atan2(y2 - py, x2 - px), hl = o.head ?? 26;
    stroke(ink, shaft, { w, dotted: o.dotted, taper: 10 }, 's');
    // the head: a slender barbed lozenge, cut as a fan of strokes from its back edge into the point
    for (let k = -4; k <= 4; k++) { const q = k / 4, bx = x2 - Math.cos(a + q * 0.36) * hl * (0.72 + 0.28 * Math.abs(q)), by = y2 - Math.sin(a + q * 0.36) * hl * (0.72 + 0.28 * Math.abs(q)); ink.add([[bx, by], [lerp(bx, x2, 0.5), lerp(by, y2, 0.5)], [x2, y2]], [w * 0.7, w * 0.9, 0.5], 'b'); }
    ink.schedule('s', at, at + dur * 0.8, 1); ink.schedule('b', at + dur * 0.75, at + dur, 9);
    const bb = bboxOf([shaft, [[x2 - hl, y2 - hl], [x2 + hl, y2 + hl]]], 10), end = at + dur;
    return mount(this, bb, o, (c, lt) => ink.draw(c, lt, color), (lt) => Math.min(lt, end + 0.01).toFixed(3));
  };

  /** label(x, y, str, o): a part's name engraved beside the figure, with a ruled leader from a dot on the part (to) to
   *  the label: italic for Latin names, Song type for Chinese; sub adds a smaller italic line under it (a Latin name, a
   *  gloss); n prefixes a figure letter (a., b., 1.). (x, y) is where the leader meets the label (its middle-left, or
   *  middle-right when the part lies to the right). o: { to: [px, py], at, size (34), sub, n, align ('l' | 'r'; auto
   *  from to), color } */
  B.label = function (x, y, str, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 34, to = o.to, align = o.align ?? (to && to[0] > x ? 'r' : 'l'), zh = isZh(str);
    let t0 = at;
    if (to) {
      const ink = new Ink(), ex = x + (align === 'r' ? 8 : -8);
      ink.dot(to[0], to[1], 3.6, 'd');
      stroke(ink, [[to[0], to[1]], [ex, y]], { w: 1.25, taper: 4 }, 'l');
      ink.schedule('d', at, at + 0.1, 1); ink.schedule('l', at + 0.05, at + 0.5, 1);
      mount(this, bboxOf([[to, [ex, y]]], 10), o, (c, lt) => ink.draw(c, lt, col('ink')), (lt) => Math.min(lt, at + 0.6).toFixed(3));
      t0 = at + 0.4;
    }
    const txt = (o.n != null ? `${o.n} ` : '') + str;
    const tx = 16;
    const t = this.text(txt, { x: align === 'r' ? x - tx : x + tx, y: y - size * 0.74, size, at: t0, cps: o.cps ?? 16, align, w: align === 'r' ? 900 : undefined, color: o.color || 'ink', cls: zh ? 'eg-zh' : 'eg-it', lh: 1.25, pen: false });
    if (o.sub) this.text(o.sub, { x: align === 'r' ? x - tx : x + tx, y: y + size * 0.52, size: Math.round(size * 0.74), at: t0 + 0.3, cps: 20, align, w: align === 'r' ? 900 : undefined, color: 'soft', cls: 'eg-it', lh: 1.2, pen: false });
    return t;
  };

  /** fig(x, y, n, str, o): the figure's caption under it, centred on x — "FIG. 1." in spaced roman capitals, and under it
   *  the caption in italic (a Latin name, Apis mellifera ♀) or Song type (Chinese). The plate's way of numbering its
   *  figures; give every figure on the page one. o: { at, size (34), color } */
  B.fig = function (x, y, n, str, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 34;
    if (n != null && n !== '') this.text(`Fig. ${n}.`, { x, y, size: Math.round(size * 0.78), at, cps: 14, align: 'c', w: 600, cls: 'eg-cap', color: 'soft', pen: false });
    return str ? this.text(str, { x, y: y + size * 1.1, size, at: at + 0.35, cps: 16, align: 'c', w: 900, cls: isZh(str) ? 'eg-zh' : 'eg-it', pen: false }) : null;
  };

  /** inscribe(str, x, y, o): large engraved lettering for the page's one key number, date or word (1796, ×1,000,
   *  十三种) — cut glyph by glyph, with a fine double rule cut under it from the centre out and an optional italic line
   *  beneath (the unit, the gloss). (x, y) = top centre (align 'c') or top-left ('l'). o: { size (150), at, italic,
   *  rule (true), sub, align ('c'), color } */
  B.inscribe = function (str, x, y, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 150, zh = isZh(str), align = o.align ?? 'c', n = [...String(str)].length;
    const t = this.text(str, { x, y, size, at, cps: o.cps ?? Math.max(4, n / 1.4), align, w: align === 'c' ? 1400 : undefined, color: o.color || 'ink', cls: 'eg-big' + (zh ? ' eg-zh' : '') + (o.italic ? ' eg-it' : ''), lh: 1.1, pen: false });
    const tw = Math.min(1300, PV.tw(String(str), size) * (zh ? 1.05 : 1.08)), cx = align === 'c' ? x : x + tw / 2, ry = y + size * 1.16;
    if (o.rule !== false) {
      const ink = new Ink(), half = tw * 0.42 + 30, ta = at + t.a.dur;
      stroke(ink, [[cx, ry], [cx - half, ry]], { w: 2.2, taper: 30 }, 'a'); stroke(ink, [[cx, ry], [cx + half, ry]], { w: 2.2, taper: 30 }, 'a');
      stroke(ink, [[cx, ry + 7], [cx - half * 0.8, ry + 7]], { w: 1, taper: 20 }, 'a'); stroke(ink, [[cx, ry + 7], [cx + half * 0.8, ry + 7]], { w: 1, taper: 20 }, 'a');
      ink.schedule('a', ta, ta + 0.6, 4);
      mount(this, [cx - half - 10, ry - 10, cx + half + 10, ry + 20], o, (c, lt) => ink.draw(c, lt, col('ink')), (lt) => Math.min(lt, ta + 0.7).toFixed(3));
    }
    if (o.sub) this.text(o.sub, { x: cx, y: ry + 22, size: Math.round(Math.max(32, size * 0.24)), at: at + t.a.dur + 0.4, cps: 18, align: 'c', w: 1200, cls: isZh(o.sub) ? 'eg-zh' : 'eg-it', color: 'soft', pen: false });
    return t;
  };

  /** roundel(cx, cy, r, parts, o): a magnification in a double-ruled circle — the ring is scribed round, a small ring is
   *  scribed on the source (from) with a ruled leader to the roundel, the ground inside is machine-ruled with a white
   *  halo round the subject, then the magnified detail (parts, drawn in stage coordinates inside the circle, as in
   *  P.engrave) is engraved there. For what the eye cannot see: a cell, a scale, a pollen grain, a cone of the retina.
   *  o: { at (the detail starts being cut 0.35 s after it), dur (2.2: the engraving inside), from: [x, y, r0 (24)], mag ('×400': lettered under the ring), tint,
   *  tintAt, spacing, angle, light, ground (true) } */
  B.roundel = function (cx, cy, r, parts, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 2.2, fr = new Ink(), color = col('ink');
    const circ = (rr) => Array.from({ length: 121 }, (_, k) => { const a = -Math.PI / 2 - 0.5 + (k / 120) * Math.PI * 2; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
    stroke(fr, circ(r), { w: 3, taper: 6 }, 'r1'); stroke(fr, circ(r - 7), { w: 1.1, taper: 6 }, 'r2');
    fr.schedule('r1', at, at + 0.5, 1); fr.schedule('r2', at + 0.1, at + 0.6, 1);
    let bb = [cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6];
    if (o.from) {
      const [fx, fy, r0 = 24] = o.from, d = Math.hypot(cx - fx, cy - fy) || 1, ux = (cx - fx) / d, uy = (cy - fy) / d;
      stroke(fr, Array.from({ length: 49 }, (_, k) => { const a = (k / 48) * Math.PI * 2; return [fx + Math.cos(a) * r0, fy + Math.sin(a) * r0]; }), { w: 1.6, taper: 4 }, 's');
      stroke(fr, [[fx + ux * r0, fy + uy * r0], [cx - ux * r, cy - uy * r]], { w: 1.2, taper: 4 }, 'k');
      fr.schedule('s', at, at + 0.3, 1); fr.schedule('k', at + 0.2, at + 0.55, 1);
      bb = [Math.min(bb[0], fx - r0 - 6), Math.min(bb[1], fy - r0 - 6), Math.max(bb[2], fx + r0 + 6), Math.max(bb[3], fy + r0 + 6)];
    }
    // the detail is cut while the ring is still being scribed: never an empty ring
    const fig = buildFigure(parts, o, at + 0.35, dur), ground = new Ink(), inner = [circ(r - 9).slice(0, -1)];
    if (o.ground !== false) {
      hatch(ground, inner, { angle: 0, spacing: 4.6, tone: () => 0.5, thr: 0.1, wMax: 0.75, wMin: 0.75, flat: true, swell: 0.15, wobble: 0.05, jitter: 0.02, excl: fig.polys.map((p) => [p]), margin: 9, taper: 4 }, 'g');
      ground.schedule('g', at + 0.2, at + 0.9, 30);
    }
    const end = Math.max(fig.end, at + 0.9);
    const draw = (c, lt) => {
      fr.draw(c, lt, color);
      c.save(); c.beginPath(); c.arc(cx, cy, r - 8, 0, Math.PI * 2); c.clip();
      ground.draw(c, lt, color); for (const w of fig.washes) w.draw(c, lt); fig.ink.draw(c, lt, color); c.restore();
    };
    const m = mount(this, bb, o, draw, (lt) => Math.min(lt, end + 0.01).toFixed(3) + fig.washes.map((w) => '|' + w.k(lt).toFixed(3)).join(''));
    if (o.mag) this.text(o.mag, { x: cx, y: cy + r + 14, size: 30, at: at + 0.8, cps: 14, align: 'c', w: 400, cls: 'eg-it', color: 'soft', pen: false });
    return { el: m.el, hide: m.hide, end };
  };

  /** tint(d, o): hand colouring — a transparent watercolour wash laid into a region after the print is finished:
   *  it blooms out from where the brush touched (from) with a ragged wet front, spills a few pixels past the engraved
   *  line, sits a hair off register, and dries with a darker tide-line and the paper's grain showing; the ink stays on
   *  top. The style's payoff: time it to the word that names the answer. Colours: muted earth and mineral pigments
   *  ('red' madder, 'orange' sienna, 'yellow' gamboge, 'green', 'blue', 'purple'; the *F names are pale washes).
   *  o: { color ('red'), at, dur (1.6), from ([x, y]), alpha (0.66), spill (4) } */
  B.tint = function (d, o = {}) {
    const { polys } = shapeOf(d), w = makeWash(polys, o.color || 'red', o);
    return mount(this, [w.bb[0] - 30, w.bb[1] - 30, w.bb[2] + 30, w.bb[3] + 30], o, (c, lt) => w.draw(c, lt), (lt) => w.k(lt).toFixed(3));
  };

  /** stipple(d, o): a region engraved in dots instead of lines, denser where it turns from the light — soft tissue,
   *  skin, a cloud of cells or pollen, dust, a crowd seen from far off. The dots arrive in a sweep. o: { at, dur (2),
   *  density (0.035), r (1.25), tone ('form' | 'sphere' | 0..1), light } */
  B.stipple = function (d, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 2, { polys } = shapeOf(d), ink = new Ink(), pb = bboxOf(polys);
    let tone = o.tone === 'sphere' ? sphereTone((pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2, (pb[2] - pb[0]) / 2, (pb[3] - pb[1]) / 2, o.light) : typeof o.tone === 'number' ? null : pillow(polys, { light: o.light });
    if (!tone) { const v = o.tone; tone = () => v; }
    stipple(ink, polys, tone, { density: o.density ?? 0.035, r: o.r ?? 1.25, seed: seedN++ }, 'd');
    ink.schedule('d', at, at + dur, 60);
    const end = at + dur;
    return mount(this, bboxOf(polys, 6), o, (c, lt) => ink.draw(c, lt, col(o.color || 'ink')), (lt) => Math.min(lt, end + 0.01).toFixed(3));
  };

  /** ground(cx, cy, rx, o): the cast shadow a specimen throws on the table, away from the light: an ellipse of fine
   *  horizontal ruled lines, heavier at its heart, fading out at its edge. Put it under a figure that stands or lies on
   *  something (a shell, a skull, a bird on a branch). o: { at, dur (0.8), ry (rx × 0.2) } */
  B.ground = function (cx, cy, rx, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.8, ry = o.ry ?? rx * 0.2, ink = new Ink(), ell = [ellPts(cx, cy, rx, ry, 0, 64)];
    const tone = (x, y) => clamp(1 - Math.hypot((x - cx) / rx, (y - cy) / ry)) * 0.95;
    hatch(ink, ell, { angle: 0, spacing: 4.4, tone, thr: 0.04, wMax: 1.8, wobble: 0.15, jitter: 0.05, seed: seedN++ }, 'g');
    ink.schedule('g', at, at + dur, 8);
    const end = at + dur;
    return mount(this, [cx - rx - 6, cy - ry - 6, cx + rx + 6, cy + ry + 6], o, (c, lt) => ink.draw(c, lt, col('ink')), (lt) => Math.min(lt, end + 0.01).toFixed(3));
  };

  /** scalebar(x, y, len, label, o): a scale of length as engraved on a plate — a ruled bar in alternate black and white
   *  divisions with end ticks, the measure lettered in italic under its middle (1 mm, 10 μm, 原大 natural size). For
   *  how big the real thing is. o: { at, dur (0.8), divs (4) } */
  B.scalebar = function (x, y, len, label, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.8, n = o.divs ?? 4, ink = new Ink(), h = 10;
    stroke(ink, [[x, y], [x + len, y]], { w: 1.4, taper: 2 }, 'a'); stroke(ink, [[x, y + h], [x + len, y + h]], { w: 1.4, taper: 2 }, 'a');
    for (let i = 0; i <= n; i++) stroke(ink, [[x + (len * i) / n, y - 6], [x + (len * i) / n, y + h + 6]], { w: 1.3, taper: 2 }, 'a');
    for (let i = 0; i < n; i += 2) for (let k = 1; k < h; k += 1.6) ink.add([[x + (len * i) / n, y + k], [x + (len * (i + 1)) / n, y + k]], 1.4, 'b');
    ink.schedule('a', at, at + dur * 0.6, 3); ink.schedule('b', at + dur * 0.5, at + dur, 6);
    mount(this, [x - 8, y - 10, x + len + 8, y + h + 10], o, (c, lt) => ink.draw(c, lt, col('ink')), (lt) => Math.min(lt, at + dur + 0.01).toFixed(3));
    return label ? this.text(label, { x: x + len / 2, y: y + h + 10, size: o.size ?? 30, at: at + dur * 0.6, cps: 16, align: 'c', w: 500, cls: isZh(label) ? 'eg-zh' : 'eg-it', pen: false }) : null;
  };

  // ── the plate's heading: the title in spaced capitals (Song type in Chinese) centred above the figure, a double rule cut
  //    from the middle out under it, and the plate number in italic at the top right ──
  const roman = (n) => { let s = ''; for (const [v, r] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { s += r; n -= v; } return s; };
  B.title = function (str, o = {}) {
    const at = o.at ?? 0.1, T = this.hud || this, zh = isZh(str), s = String(str).replace(/[\s\u3000]*(Pl|PL|Plate|PLATE)\.?\s*[IVXLC\d]+\.?\s*$/, '').trim();   // the plate number is added below
    const size = o.size ?? (zh ? ([...s].length > 14 ? 40 : 46) : s.length > 34 ? 32 : 38);
    const t = T.text(s, { x: W / 2, y: STAGE.title.y - 4, size, at, cps: o.cps ?? (zh ? 12 : 22), align: 'c', w: W - 420, cls: zh ? 'eg-zh' : 'eg-cap', color: 'ink', lh: 1.15, pen: false });
    const tw = Math.min(W - 520, PV.tw(s, size) * (zh ? 1.3 : 1.25)), half = Math.max(120, tw * 0.32), ry = STAGE.title.y - 4 + size * 1.3 + 6, ink = new Ink(), ta = at + 0.3;
    stroke(ink, [[W / 2, ry], [W / 2 - half, ry]], { w: 1.9, taper: 40 }, 'a'); stroke(ink, [[W / 2, ry], [W / 2 + half, ry]], { w: 1.9, taper: 40 }, 'a');
    stroke(ink, [[W / 2, ry + 6], [W / 2 - half * 0.6, ry + 6]], { w: 0.9, taper: 30 }, 'a'); stroke(ink, [[W / 2, ry + 6], [W / 2 + half * 0.6, ry + 6]], { w: 0.9, taper: 30 }, 'a');
    ink.schedule('a', ta, ta + 0.7, 4);
    mount(T, [W / 2 - half - 10, ry - 10, W / 2 + half + 10, ry + 16], {}, (c, lt) => ink.draw(c, lt, col('ink')), (lt) => Math.min(lt, ta + 0.8).toFixed(3));
    if (o.plate !== false) T.text(o.plate || `Pl. ${roman((this.page.index ?? 0) + 1)}.`, { x: W - 120, y: STAGE.title.y, size: 28, at: at + 0.2, cps: 14, align: 'r', w: 300, cls: 'eg-it', color: 'soft', pen: false });
    return t;
  };

  PV.EG = EG;
  PV.ENGRAVE = { parseD, shapeOf, Ink, pillow, sphereTone, hatch, contour, stroke, stipple, makeWash };
})();
