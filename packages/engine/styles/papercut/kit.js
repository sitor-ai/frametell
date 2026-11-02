/* Papercut kit · Chinese red paper-cuts (剪纸 / 窗花): every object is a sheet of China-red paper whose picture is what
 * the scissors cut away (sawtooth 锯齿纹, crescents 月牙纹, swirls 旋涡纹, plum and coin holes), laid flat on dyed ground
 * paper with a tight paper shadow. The signature: a folded wedge is cut and snaps open into a full window flower, then
 * light pours through its holes. Pieces are pre-cut once to offscreen canvases (paper grain, cut-edge rims, shadow) and
 * placed every frame; paper moves on twos (12 fps steps), light and falling scraps on ones.
 * Every component is a pure function of page-local time lt (seeded randomness only). Stage coordinates (1920×1080).
 * Paper grain, cut-edge rim, motif vocabulary (sawtooth, crescent, swirl, plum), the wedge-and-mirror rosette, backlit
 * transmission and the fold flap are adapted from Lemo-Opuscar's papercut-red demo (MIT, © 2026 LemoLab), see NOTICE.md. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, TAU = Math.PI * 2, FPS = 12, RES = 1.25;
  const step = (lt, f = FPS) => Math.floor(lt * f + 1e-6) / f;
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const PAPER = { red: '#D7261E', deep: '#A3121E', pale: '#EC7B6A', gold: '#E2B24C', cream: '#F3E2BC', indigo: '#3A4A92', jade: '#2E8C6E', pink: '#EE8E92', ink: '#22264A' };
  const paperCol = (c) => PAPER[c] || col(c || 'red');
  const SERIF = (w, s) => `${w} ${s}px "Fraunces Variable", "Noto Serif SC Variable", "Songti SC", serif`;
  const HAN = (w, s) => `${w} ${s}px "Noto Serif SC Variable", "Songti SC", serif`;
  const BRUSH = (s) => `400 ${s}px "Ma Shan Zheng", "Noto Serif SC Variable", serif`;

  // ── deterministic noise ──
  const hh = (x, y, s = 0) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const vnoise = (P) => (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const w = (a, b) => hh(((a % P) + P) % P, ((b % P) + P) % P, P);
    return (w(i, j) * (1 - u) + w(i + 1, j) * u) * (1 - v) + (w(i, j + 1) * (1 - u) + w(i + 1, j + 1) * u) * v;
  };
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

  // ── paper textures ──
  const TEX = {};
  function fibres(g, N, n, colr, a, len, w, seed) {
    g.save(); g.strokeStyle = colr; g.lineWidth = w; g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const x = hh(k, 1, seed) * N, y = hh(k, 2, seed) * N, an = hh(k, 3, seed) * TAU, L = len * (0.35 + hh(k, 4, seed));
      g.globalAlpha = a * (0.4 + 0.6 * hh(k, 5, seed));
      for (const [ox, oy] of [[0, 0], [-N, 0], [N, 0], [0, -N], [0, N]]) {
        g.beginPath(); g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(an + 0.4) * L * 0.5, y + oy + Math.sin(an + 0.4) * L * 0.5, x + ox + Math.cos(an) * L, y + oy + Math.sin(an) * L); g.stroke();
      }
    }
    g.restore();
  }
  /** neutral-grey grain (128 = no change), laid in soft-light over every cut piece: dye mottling, fibres, specks */
  function grain() {
    if (TEX.grain) return TEX.grain;
    const N = 384, c = cv(N, N), g = c.getContext('2d'), id = g.createImageData(N, N), d = id.data;
    const n1 = vnoise(4), n2 = vnoise(16), n3 = vnoise(64);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const f = (n1(x / 96, y / 96) - 0.5) * 1.0 + (n2(x / 24, y / 24) - 0.5) * 0.45 + (n3(x / 6, y / 6) - 0.5) * 0.25;
      const v = 128 + f * 50 + (hh(x, y, 3) > 0.994 ? -36 : 0), i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 255); d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    fibres(g, N, 360, '#ffffff', 0.22, 30, 1, 11); fibres(g, N, 140, '#000000', 0.12, 22, 0.8, 17);
    return (TEX.grain = c);
  }
  const GROUNDS = {
    night: { rgb: [27, 34, 74], amp: 0.13, fib: '#6274b8', dark: '#080b22', layers: ['#25306A', '#2F3C80', '#3A4A92'], snow: '#E8E2D0' },
    gold: { rgb: [218, 166, 78], amp: 0.07, fib: '#fff1c8', dark: '#7a4a12', layers: ['#C98F3C', '#BC7E2F', '#AD6E25'], snow: '#FFF3D6' },
    rice: { rgb: [241, 228, 201], amp: 0.05, fib: '#9a8a64', dark: '#8a7650', layers: ['#E9C9B4', '#E4AE9C', '#DE9584'], snow: '#ffffff' },
    jade: { rgb: [22, 66, 60], amp: 0.12, fib: '#4fa08a', dark: '#04201c', layers: ['#1D5A50', '#246A5E', '#2E7B6C'], snow: '#E6F0E2' },
  };
  function groundTile(kind) {
    const key = 'g' + kind; if (TEX[key]) return TEX[key];
    const G = GROUNDS[kind] || GROUNDS.night, N = 512, c = cv(N, N), g = c.getContext('2d'), id = g.createImageData(N, N), d = id.data;
    const n1 = vnoise(4), n2 = vnoise(16), n3 = vnoise(64);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const f = (n1(x / 128, y / 128) - 0.5) * 1.2 + (n2(x / 32, y / 32) - 0.5) * 0.5 + (n3(x / 8, y / 8) - 0.5) * 0.25;
      const k = 1 + f * G.amp, i = (y * N + x) * 4;
      d[i] = G.rgb[0] * k; d[i + 1] = G.rgb[1] * k; d[i + 2] = G.rgb[2] * (1 + f * G.amp * 1.1); d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    fibres(g, N, 520, G.fib, kind === 'rice' ? 0.16 : 0.2, 50, 1.1, 21); fibres(g, N, 220, G.dark, 0.2, 36, 0.9, 23);
    return (TEX[key] = c);
  }

  // ── geometry ──
  const trace = (g, p, closed = true) => { g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); if (closed) g.closePath(); };
  /** smooth through midpoints (quadratic), sampled as a polyline */
  function smooth(pts, closed = true, stp = 3) {
    const n = pts.length; if (n < 3) return pts.slice();
    const out = [], m = (i) => { const a = pts[(i + n) % n], b = pts[(i + 1 + n) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    if (!closed) out.push(pts[0]);
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const s = closed ? m(i - 1) : (i === 1 ? pts[0] : m(i - 1)), c = pts[i], e = closed ? m(i) : (i === n - 2 ? pts[n - 1] : m(i));
      const L = Math.hypot(c[0] - s[0], c[1] - s[1]) + Math.hypot(e[0] - c[0], e[1] - c[1]), k = Math.max(2, Math.ceil(L / stp));
      for (let j = 0; j < k; j++) { const u = j / k, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), cc = u * u; out.push([a * s[0] + b * c[0] + cc * e[0], a * s[1] + b * c[1] + cc * e[1]]); }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }
  /** the hand of the scissors: a slow wobble along the arc length */
  function wob(poly, amp = 0.6, seed = 1, freq = 0.06) {
    let s = 0; const out = [];
    for (let i = 0; i < poly.length; i++) {
      if (i) s += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
      const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const x = s * freq, j = Math.floor(x), f = x - j, u = f * f * (3 - 2 * f);
      const nz = (hh(j, 7, seed) * (1 - u) + hh(j + 1, 7, seed) * u - 0.5) * 2;
      out.push([poly[i][0] - dy / l * nz * amp, poly[i][1] + dx / l * nz * amp]);
    }
    return out;
  }
  const ellPts = (cx, cy, rx, ry, rot = 0, n = 48, a0 = 0, a1 = TAU) => {
    const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; o.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); } return o;
  };
  /** resample a polyline at equal steps: [{x, y, nx, ny}] with the normal to the left of travel */
  function along(pts, stp) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = L[L.length - 1], n = Math.max(1, Math.round(tot / stp)), out = []; let j = 0;
    for (let k = 0; k <= n; k++) {
      const s = tot * k / n; while (j < pts.length - 2 && L[j + 1] < s) j++;
      const u = (s - L[j]) / ((L[j + 1] - L[j]) || 1), a = pts[j], b = pts[j + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      out.push({ x: a[0] + dx * u, y: a[1] + dy * u, nx: dy / l, ny: -dx / l });
    }
    return out;
  }
  /** a ribbon polygon along a polyline, width w0 → w1 (a limb, a tail, a stalk) */
  function ribbonPts(pts, w0, w1, tip = false) {
    const D = smooth(pts, false, 3), n = D.length, Lf = [], Rt = [];
    for (let i = 0; i < n; i++) {
      const a = D[Math.max(0, i - 1)], b = D[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, q = i / (n - 1);
      const w = (tip ? Math.sin(Math.PI * Math.min(1, q * 0.5 + 0.5)) * 0 + lerp(w0, w1, q) : lerp(w0, w1, q)) / 2;
      Lf.push([D[i][0] - dy / l * w, D[i][1] + dx / l * w]); Rt.push([D[i][0] + dy / l * w, D[i][1] - dx / l * w]);
    }
    return Lf.concat(Rt.reverse());
  }

  // ── cutting (in a piece's local coordinates) ──
  const fillP = (g, fn, c, rule = 'nonzero') => { g.beginPath(); fn(g); g.fillStyle = c || g.__col; g.fill(rule); };
  const fillPoly = (g, p, c) => fillP(g, (q) => trace(q, p), c);
  const fillEll = (g, cx, cy, rx, ry, rot = 0, c) => fillP(g, (q) => q.ellipse(cx, cy, rx, ry, rot, 0, TAU), c);
  function cut(g, fn, rule = 'nonzero') { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath(); fn(g); g.fill(rule); g.restore(); }
  const cutPoly = (g, p) => cut(g, (q) => trace(q, p));
  const cutCircle = (g, x, y, r) => cut(g, (q) => { q.moveTo(x + r, y); q.arc(x, y, r, 0, TAU); });
  /** a slit pointed at both ends, the commonest scissor mark */
  function cutTaper(g, pts, w) {
    const n = pts.length; if (n < 2) return; const Lf = [], Rt = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const ww = w * (Math.sin(Math.PI * (i / (n - 1))) * 0.92 + 0.08) / 2;
      Lf.push([pts[i][0] - dy / l * ww, pts[i][1] + dx / l * ww]); Rt.push([pts[i][0] + dy / l * ww, pts[i][1] - dx / l * ww]);
    }
    cutPoly(g, Lf.concat(Rt.reverse()));
  }
  const taper = (g, pts, w) => cutTaper(g, smooth(pts, false, 2), w);
  /** 锯齿纹: a row of thin triangular holes along a line, leaving red teeth (fur, grass, tiles, fringe) */
  function sawRow(g, pts, h = 10, sp = 6, side = 1, gap = 0.78) {
    const S = along(pts, sp);
    cut(g, (q) => {
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, hw = gap / 2;
        q.moveTo(a.x + (b.x - a.x) * (0.5 - hw), a.y + (b.y - a.y) * (0.5 - hw)); q.lineTo(a.x + (b.x - a.x) * (0.5 + hw), a.y + (b.y - a.y) * (0.5 + hw));
        q.lineTo(mx + a.nx * h * side, my + a.ny * h * side); q.closePath();
      }
    });
  }
  /** a sawtooth outline: every other point pushed out by h */
  function sawEdge(pts, h = 12, sp = 14, side = 1) { return along(pts, sp / 2).map((p, i) => (i % 2 ? [p.x + p.nx * h * side, p.y + p.ny * h * side] : [p.x, p.y])); }
  /** 月牙: a crescent hole, thick in the middle, pointed at both ends */
  function crescentPts(cx, cy, r, a0, a1, t, n = 16) {
    const o = [], ins = [];
    for (let i = 0; i <= n; i++) { const u = i / n, a = a0 + (a1 - a0) * u, k = Math.sin(Math.PI * u); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); ins.push([cx + Math.cos(a) * (r - t * k), cy + Math.sin(a) * (r - t * k)]); }
    return o.concat(ins.reverse());
  }
  const crescent = (g, cx, cy, r, a0, a1, t) => cutPoly(g, crescentPts(cx, cy, r, a0, a1, t));
  /** rows of crescents (scales, fur, quilting), offset every row, opening upward; clipped by the caller */
  function crescentRows(g, x0, y0, x1, y1, r = 12, t = 4, span = 0.7) {
    cut(g, (q) => {
      let row = 0;
      for (let y = y0; y < y1 + r; y += r * 1.05, row++) for (let x = x0 - r * 2 + (row % 2) * r; x < x1 + r * 2; x += r * 2) {
        trace(q, crescentPts(x, y, r, Math.PI * (0.5 - span / 2), Math.PI * (0.5 + span / 2), t, 10));
      }
    });
  }
  /** 旋涡纹: a tapering spiral slit */
  function swirl(g, cx, cy, r, turns = 2, w = 4, rot = 0, dir = 1) {
    const pts = [], n = Math.ceil(turns * 30);
    for (let i = 0; i <= n; i++) { const u = i / n, a = rot + dir * u * turns * TAU, rr = r * (1 - u * 0.9); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    cutTaper(g, pts, w); cutCircle(g, pts[n][0], pts[n][1], w * 0.6);
  }
  /** 梅花孔: five round petals */
  function plum(g, cx, cy, r, rot = -Math.PI / 2) { cut(g, (q) => { for (let k = 0; k < 5; k++) { const a = rot + k * TAU / 5, x = cx + Math.cos(a) * r * 0.6, y = cy + Math.sin(a) * r * 0.6; q.moveTo(x + r * 0.42, y); q.arc(x, y, r * 0.42, 0, TAU); } }); }
  /** a ring of n teardrop petals with a hole at the centre (cheek blossoms, flower hearts) */
  function petals(g, cx, cy, r, n = 6, rot = 0, core = 0.2) {
    cut(g, (q) => {
      for (let k = 0; k < n; k++) {
        const a = rot + k * TAU / n, ca = Math.cos(a), sa = Math.sin(a), r0 = r * (core + 0.08), wd = r * Math.sin(Math.PI / n) * 0.75;
        const P = (u, v) => [cx + ca * u - sa * v, cy + sa * u + ca * v];
        q.moveTo(...P(r0, 0)); q.quadraticCurveTo(...P((r0 + r) * 0.5, wd * 1.25), ...P(r, 0)); q.quadraticCurveTo(...P((r0 + r) * 0.5, -wd * 1.25), ...P(r0, 0)); q.closePath();
      }
    });
    cutCircle(g, cx, cy, r * core * 0.55);
  }
  function coinHole(g, cx, cy, r) { cut(g, (q) => { q.arc(cx, cy, r, 0, TAU); q.rect(cx - r * 0.42, cy - r * 0.42, r * 0.84, r * 0.84); }, 'evenodd'); }
  /** 阴刻 contour: a thin slit just inside an outline (the classic double line) */
  function inset(g, fn, ins = 5, gap = 2) {
    g.save(); g.beginPath(); fn(g); g.clip();
    g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineWidth = 2 * (ins + gap); g.beginPath(); fn(g); g.stroke();
    g.globalCompositeOperation = 'source-over'; g.strokeStyle = g.__col; g.lineWidth = 2 * ins; g.beginPath(); fn(g); g.stroke();
    g.restore();
  }
  /** an eye that leaves no island: a round pupil hole under a crescent lid */
  function eye(g, x, y, r, dir = 1) { cutCircle(g, x, y, r * 0.55); crescent(g, x, y + r * 0.2, r * 1.1, Math.PI * 1.15, Math.PI * 1.85, r * 0.45); }
  /** a red line laid back over a cut-away band (阳刻) */
  function redLine(g, fn, w) { g.save(); g.globalCompositeOperation = 'source-over'; g.strokeStyle = g.__col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); fn(g); g.stroke(); g.restore(); }

  // ── pieces: cut once, placed every frame ──
  /** grain in soft-light, a light rim upper-left and a dark rim lower-right (the cut face), holes restored */
  function finish(c, o = {}) {
    const g = c.getContext('2d'), Wd = c.width, Ht = c.height, m = cv(Wd, Ht), mg = m.getContext('2d');
    mg.drawImage(c, 0, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    if (o.tex !== false) {
      const pat = g.createPattern(grain(), 'repeat'), s = o.seed || 0;
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, (s * 137) % 384, (s * 71) % 384]));
      g.globalCompositeOperation = 'soft-light'; g.fillStyle = pat; g.fillRect(0, 0, Wd, Ht);
    }
    const e = o.edge ?? 1.6;
    if (e > 0) {
      const r = cv(Wd, Ht), rg = r.getContext('2d');
      rg.drawImage(m, 0, 0); rg.globalCompositeOperation = 'destination-out'; rg.drawImage(m, e, e);
      rg.globalCompositeOperation = 'source-in'; rg.fillStyle = o.light || 'rgba(255,205,180,.55)'; rg.fillRect(0, 0, Wd, Ht);
      g.globalCompositeOperation = 'source-atop'; g.drawImage(r, 0, 0);
      rg.globalCompositeOperation = 'source-over'; rg.clearRect(0, 0, Wd, Ht);
      rg.drawImage(m, 0, 0); rg.globalCompositeOperation = 'destination-out'; rg.drawImage(m, -e, -e);
      rg.globalCompositeOperation = 'source-in'; rg.fillStyle = 'rgba(50,0,10,.5)'; rg.fillRect(0, 0, Wd, Ht);
      g.drawImage(r, 0, 0);
    }
    g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
    g.restore();
  }
  /** build a cut piece in local coords (box [x0, y0, x1, y1]); draw(g) fills and cuts; returns { c, flat, x0, y0, w, h } */
  function piece(box, draw, o = {}) {
    const K = o.K ?? 1.5, pad = o.pad ?? 18;
    const x0 = box[0] - pad, y0 = box[1] - pad, w = box[2] - box[0] + pad * 2, h = box[3] - box[1] + pad * 2;
    const c = cv(w * K, h * K), g = c.getContext('2d');
    g.setTransform(K, 0, 0, K, -x0 * K, -y0 * K); g.lineJoin = 'round'; g.lineCap = 'round'; g.__col = o.color || PAPER.red;
    draw(g);
    finish(c, o);
    const out = cv(c.width, c.height), og = out.getContext('2d');
    if (o.shadow !== false) { og.shadowColor = o.shadowCol || 'rgba(6,3,16,0.6)'; og.shadowBlur = 5 * K; og.shadowOffsetX = 3 * K; og.shadowOffsetY = 4.5 * K; }
    og.drawImage(c, 0, 0);
    return { c: out, flat: c, x0, y0, w, h, K };
  }
  const put = (g, p, img) => g.drawImage(img || p.c, p.x0, p.y0, p.w, p.h);
  /** the paper's back (the lighter side that shows while a flap is folded over) */
  function backOf(p, colr = '#F0A08F') {
    if (p.back) return p.back;
    const c = cv(p.flat.width, p.flat.height), g = c.getContext('2d');
    g.drawImage(p.flat, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = colr; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'soft-light'; g.fillStyle = g.createPattern(grain(), 'repeat'); g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(p.flat, 0, 0);
    return (p.back = c);
  }
  /** radius of the piece's outline at 96 angles around its origin (where the scissors run when a piece is cut out) */
  function rim(p) {
    if (p.rim) return p.rim;
    const K = p.flat.width / p.w, d = p.flat.getContext('2d').getImageData(0, 0, p.flat.width, p.flat.height).data, out = [];
    const R = Math.hypot(Math.max(-p.x0, p.x0 + p.w), Math.max(-p.y0, p.y0 + p.h));
    for (let i = 0; i < 96; i++) {
      const a = i / 96 * TAU; let r = R;
      for (; r > 4; r -= 3) { const px = Math.round((Math.cos(a) * r - p.x0) * K), py = Math.round((Math.sin(a) * r - p.y0) * K); if (px >= 0 && py >= 0 && px < p.flat.width && py < p.flat.height && d[(py * p.flat.width + px) * 4 + 3] > 120) break; }
      out.push(r);
    }
    return (p.rim = out);
  }
  const rimAt = (p, a) => { const R = rim(p), f = ((a / TAU) % 1 + 1) % 1 * 96, i = Math.floor(f), u = f - i; return lerp(R[i % 96], R[(i + 1) % 96], u); };

  /** a canvas over a stage box, redrawn only when key(lt) changes */
  function mount(self, bx, by, bw, bh, o, key, draw, res = RES, cls = '') {
    bx = Math.floor(bx); by = Math.floor(by);
    const c = PV.h('canvas', 'pc-cv' + (cls ? ' ' + cls : ''), null, self.html);
    c.width = Math.ceil(bw * res); c.height = Math.ceil(bh * res);
    Object.assign(c.style, { position: 'absolute', left: bx + 'px', top: by + 'px', width: Math.ceil(bw) + 'px', height: Math.ceil(bh) + 'px', pointerEvents: 'none' });
    const g = c.getContext('2d'), st = { out: o.out, outDur: o.outDur ?? 0.35 };
    let last = null;
    self.tick((lt) => {
      const op = st.out != null ? 1 - clamp((step(lt, 24) - st.out) / st.outDur) : 1;
      c.style.opacity = op.toFixed(3);
      if (op <= 0.001) return;
      const k = String(key(lt)); if (k === last) return; last = k;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      g.setTransform(res, 0, 0, res, -bx * res, -by * res); draw(g, lt);
    });
    return { el: c, hide(t, d = 0.35) { st.out = t; st.outDur = d; return this; } };
  }

  // ── scissors, scraps ──
  /** a pair of Chinese iron scissors with their tip at (x, y), pointing along ang, blades open by `open` (0..1) */
  function scissors(g, x, y, ang, open, L = 120) {
    g.save(); g.translate(x, y); g.rotate(ang); g.translate(-L * 0.92, 0);
    const half = 0.04 + open * 0.2;
    for (const s of [1, -1]) {
      g.save(); g.rotate(s * half);
      g.beginPath(); g.moveTo(-L * 0.05, -s * L * 0.05); g.quadraticCurveTo(L * 0.4, -s * L * 0.075, L * 0.92, s * L * 0.004); g.lineTo(L * 0.92, s * L * 0.012); g.quadraticCurveTo(L * 0.4, s * L * 0.012, -L * 0.05, s * L * 0.03); g.closePath();
      g.fillStyle = s > 0 ? '#C9CCD6' : '#AEB2C0'; g.fill(); g.strokeStyle = 'rgba(20,20,40,.55)'; g.lineWidth = 1.2; g.stroke();
      g.beginPath(); g.moveTo(-L * 0.02, -s * L * 0.02); g.quadraticCurveTo(-L * 0.2, -s * L * 0.06, -L * 0.3, -s * L * 0.1); g.lineWidth = L * 0.05; g.strokeStyle = '#2A2C3A'; g.stroke();
      g.beginPath(); g.ellipse(-L * 0.42, -s * L * 0.15, L * 0.13, L * 0.1, s * 0.3, 0, TAU); g.lineWidth = L * 0.045; g.strokeStyle = '#2A2C3A'; g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, L * 0.035, 0, TAU); g.fillStyle = PAPER.gold; g.fill();
    g.restore();
  }
  const snipOpen = (lt) => 0.5 + 0.5 * Math.sin(step(lt, 24) * TAU * 3.2);
  /** small red scraps dropping from points the scissors passed */
  function scrapsFrom(g, list, lt, colr = PAPER.red) {
    for (const s of list) {
      const t = lt - s.t; if (t < 0 || t > 1.6) continue;
      const x = s.x + s.vx * t + Math.sin(t * 5 + s.ph) * 10, y = s.y + 140 * t * t + 40 * t, a = s.ph + t * s.spin;
      g.save(); g.globalAlpha = clamp((1.6 - t) / 0.4); g.translate(x, y); g.rotate(a); g.fillStyle = colr;
      g.beginPath(); g.moveTo(-s.r, -s.r * 0.4); g.lineTo(s.r, -s.r * 0.6); g.lineTo(s.r * 0.2, s.r * 0.8); g.closePath(); g.fill(); g.restore();
    }
  }

  // ── entrances shared by the single pieces ──
  /** what a piece looks like at lt: { vis, sc, dy, rot } for paste / cut / unfold / drop; idle sway and bob after */
  function pose(o, lt, p) {
    const at = o.at ?? 0, enter = o.enter || 'paste', ls = step(lt);
    let sc = 1, dy = 0, rot = 0, vis = lt >= at;
    if (enter === 'paste' || enter === 'drop') {
      const k = Math.floor((ls - at) * FPS + 1e-6);
      if (enter === 'paste') sc = k <= 0 ? 1.1 : k === 1 ? 0.97 : 1;
      else { dy = k < 0 ? 0 : k < 3 ? -[90, 30, 0][k] : 0; sc = k === 3 ? 0.97 : 1; }
    }
    const idle = Math.max(0, ls - at);
    if (o.sway) rot += Math.sin(idle * 2.2 + (o.phase || 0)) * o.sway * Math.PI / 180;
    if (o.bob) dy += -Math.abs(Math.sin(idle * Math.PI * (o.bobRate || 1.6) + (o.phase || 0))) * o.bob;
    return { vis, sc, dy, rot };
  }
  /** place a piece centred on its local origin at (x, y), with the chosen entrance; returns a handle */
  function place(self, p, x, y, o = {}) {
    const at = o.at ?? 0, enter = o.enter || 'paste', dur = o.dur ?? (enter === 'cut' ? 1.4 : 0.5);
    const S = o.scale ?? 1, R0 = ((o.rot ?? 0) * Math.PI) / 180;
    const ext = Math.hypot(Math.max(-p.x0, p.x0 + p.w), Math.max(-p.y0, p.y0 + p.h)) * S * 1.15 + 40 + (o.bob || 0) + (enter === 'drop' ? 100 : 0);
    const bx = x - ext, by = y - ext, bw = ext * 2, bh = ext * 2;
    const pivot = o.pivot || [0, 0];
    let scraps = null;
    const handle = mount(self, bx, by, bw, bh, o, (lt) => {
      if (lt < at) return 'pre';
      const settled = lt > at + dur + 0.2 && !o.sway && !o.bob && !o.move;
      return settled ? 'still' : step(lt, enter === 'cut' || enter === 'unfold' ? 24 : 12);
    }, (g, lt) => {
      const st = pose(o, lt, p); if (!st.vis) return;
      const mv = o.move ? o.move(step(lt)) : null;
      g.save(); g.translate(x + (mv ? mv[0] : 0), y + st.dy + (mv ? mv[1] : 0));
      g.translate(pivot[0] * S, pivot[1] * S); g.rotate(R0 + st.rot); g.translate(-pivot[0] * S, -pivot[1] * S);
      g.scale(S * st.sc * (o.flip ? -1 : 1), S * st.sc);
      if (enter === 'cut' && lt < at + dur) {
        const u = clamp((step(lt, 24) - at) / dur), a0 = -Math.PI / 2, a = a0 + u * TAU;
        g.save(); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 4000, a0, a); g.closePath(); g.clip(); put(g, p); g.restore();
        const r = rimAt(p, a) + 6;
        if (!scraps) { const rr = PV.rng(Math.round(x * 7 + y)); scraps = []; for (let i = 0; i < 7; i++) { const q = (i + 0.5) / 7, aa = a0 + q * TAU, ri = rimAt(p, aa) + 10; scraps.push({ t: at + q * dur, x: Math.cos(aa) * ri, y: Math.sin(aa) * ri, vx: (rr() - 0.5) * 60, r: 6 + rr() * 8, ph: rr() * 6, spin: (rr() - 0.5) * 8 }); } }
        scrapsFrom(g, scraps, lt);
        scissors(g, Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, snipOpen(lt), 110 / S);
      } else if (enter === 'cut') {
        put(g, p); if (scraps) scrapsFrom(g, scraps, lt);
      } else if (enter === 'unfold' && lt < at + dur) {
        const u = clamp((step(lt, 24) - at - 0.15) / Math.max(0.1, dur - 0.15)), s = -Math.cos(Math.PI * ease.out(u));
        g.save(); g.beginPath(); g.rect(-4000, -4000, 4000, 8000); g.clip(); put(g, p); g.restore();
        g.save(); g.scale(s, 1); g.beginPath(); g.rect(0, -4000, 4000, 8000); g.clip();
        put(g, p, s < 0 ? backOf(p) : p.c);
        g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(40,0,8,${(0.4 * (1 - Math.abs(s))).toFixed(3)})`; g.fillRect(0, -4000, 4000, 8000);
        g.restore();
      } else put(g, p);
      g.restore();
    });
    return Object.assign(handle, { end: at + dur, x, y });
  }

  // ══════════════════════════════ ground ══════════════════════════════
  /** ground(kind, o): the ground sheet every page starts on (call it FIRST): dyed paper filling the frame, kind 'night'
   *  (indigo, the default: red pieces glow on it), 'gold' (warm gold paper, festive daylight), 'rice' (pale rice paper, a
   *  calm day), 'jade' (dark green, for a page that is not festive). o: { hills: true (two or three layers of sawtooth-edged
   *  hills along the bottom in the ground's own family, y ≈ 760–1080), snow: true (punched paper snow drifting down),
   *  moon: [x, y, r] (a gold-foil moon with cut cloud scrolls), border: true (a red sawtooth paper frame round the stage edge),
   *  seed }. Static apart from the snow. */
  B.ground = function (kind = 'night', o = {}) {
    const G = GROUNDS[kind] || GROUNDS.night, seed = o.seed ?? 3, X0 = -260, Y0 = -160, GW = W + 520, GH = H + 320;
    let hills = null;
    if (o.hills) {
      const layers = [];
      const n = o.hills === true ? 3 : o.hills;
      for (let L = 0; L < n; L++) {
        const base = H - 260 + L * 70 - (n - 1) * 20, amp = 90 - L * 20, rr = PV.rng(seed * 31 + L * 7);
        const ph = rr() * 6, f1 = 0.0028 + rr() * 0.0015, f2 = 0.007 + rr() * 0.004;
        const top = []; for (let x = X0; x <= X0 + GW; x += 30) top.push([x, base - amp * (0.6 * Math.sin(x * f1 + ph) + 0.4 * Math.sin(x * f2 + ph * 2)) - amp * 0.4]);
        layers.push({ top, base, colr: G.layers[Math.min(L, G.layers.length - 1)], L });
      }
      hills = layers.map((ly) => piece([X0, H - 520, X0 + GW, Y0 + GH], (g) => {
        const edge = sawEdge(smooth(ly.top, false, 8), 14, 22, -1);
        fillPoly(g, edge.concat([[X0 + GW, Y0 + GH], [X0, Y0 + GH]]), ly.colr);
        const rr = PV.rng(seed + ly.L * 13);
        for (let i = 0; i < 9; i++) { const x = X0 + 200 + i * (GW - 400) / 8 + (rr() - 0.5) * 120, yb = ly.base + 40 + rr() * 60; crescent(g, x, yb, 26 + rr() * 16, Math.PI * 0.15, Math.PI * 0.85, 8); }
        for (let i = 0; i < 5; i++) { const x = X0 + 300 + rr() * (GW - 600), y = ly.base + 110 + rr() * 60; swirl(g, x, y, 18, 1.6, 4, rr() * 6); }
      }, { color: ly.colr, K: 0.75, seed: seed + ly.L, shadowCol: 'rgba(4,2,14,.45)', light: 'rgba(255,240,220,.18)' }));
    }
    let moon = null;
    if (o.moon) {
      const [, , r] = o.moon;
      moon = piece([-r, -r, r, r], (g) => {
        fillEll(g, 0, 0, r, r, 0, PAPER.gold);
        for (const [cx, cy, rr, d] of [[-r * 0.35, r * 0.25, r * 0.22, 1], [r * 0.2, r * 0.42, r * 0.16, -1], [r * 0.38, -r * 0.2, r * 0.12, 1]]) swirl(g, cx, cy, rr, 1.7, Math.max(3, r * 0.03), 0, d);
        crescent(g, 0, 0, r * 0.86, Math.PI * 0.9, Math.PI * 1.45, r * 0.06);
      }, { color: PAPER.gold, light: 'rgba(255,250,220,.6)' });
    }
    let border = null;
    if (o.border) {
      border = piece([0, 0, W, H], (g) => {
        fillP(g, (q) => { q.rect(-10, -10, W + 20, H + 20); q.rect(40, 40, W - 80, H - 80); }, PAPER.red, 'evenodd');
        const inner = [[40, 40], [W - 40, 40], [W - 40, H - 40], [40, H - 40], [40, 40]];
        fillPoly(g, sawEdge(inner, 12, 18, -1).concat([[40, 40]]), PAPER.red);
        cut(g, (q) => { q.rect(46, 46, W - 92, H - 92); });
        for (let x = 80; x < W - 60; x += 60) { cutCircle(g, x, 20, 5); cutCircle(g, x, H - 20, 5); }
        for (let y = 80; y < H - 60; y += 60) { cutCircle(g, 20, y, 5); cutCircle(g, W - 20, y, 5); }
      }, { K: 0.8 });
    }
    mount(this, X0, Y0, GW, GH, {}, () => 'g', (g) => {
      const pat = g.createPattern(groundTile(kind), 'repeat');
      g.fillStyle = pat; g.fillRect(X0, Y0, GW, GH);
      const gr = g.createRadialGradient(W / 2, H * 0.42, 200, W / 2, H * 0.45, W * 0.75);
      gr.addColorStop(0, 'rgba(255,240,210,0.06)'); gr.addColorStop(1, kind === 'rice' || kind === 'gold' ? 'rgba(90,40,0,0.22)' : 'rgba(0,0,10,0.4)');
      g.fillStyle = gr; g.fillRect(X0, Y0, GW, GH);
      if (moon) { g.save(); g.translate(o.moon[0], o.moon[1]); put(g, moon); g.restore(); }
      if (hills) for (const p of hills) put(g, p);
    }, 1);
    if (o.snow) {
      const N = 70, rr = PV.rng(seed * 5 + 1), fl = [];
      for (let i = 0; i < N; i++) fl.push({ x: rr() * (W + 200) - 100, y: rr() * H, r: 2 + rr() * 4.5, v: 30 + rr() * 50, ph: rr() * 6 });
      mount(this, 0, 0, W, H, {}, (lt) => step(lt, 24), (g, lt) => {
        const t = step(lt, 24); g.fillStyle = G.snow;
        for (const f of fl) { const y = ((f.y + f.v * t) % (H + 40)) - 20, x = f.x + Math.sin(t * 0.8 + f.ph) * 18; g.globalAlpha = 0.75; g.beginPath(); g.arc(x, y, f.r, 0, TAU); g.fill(); }
        g.globalAlpha = 1;
      }, 1);
    }
    if (border) mount(this, 0, 0, W, H, {}, () => 'b', (g) => put(g, border), 1);
    return { kind };
  };

  // ══════════════════════════════ window flower ══════════════════════════════
  /** draw a full window flower (团花) of radius R with n-fold mirror symmetry into g, centred on the origin */
  function drawFlower(g, R, n, seed, centre) {
    const rnd = PV.rng(seed * 977 + 13), pick = (a) => a[Math.floor(rnd() * a.length)], A = TAU / n, b = A / 2;
    const lobes = pick([n, n * 2]), outer = (t) => R * (0.9 + 0.1 * Math.pow(Math.abs(Math.cos((t * lobes) / 2)), 0.6));
    const outline = []; for (let i = 0; i <= 360; i++) { const t = (i / 360) * TAU; outline.push([Math.cos(t) * outer(t), Math.sin(t) * outer(t)]); }
    fillPoly(g, outline);
    const pol = (r, a) => [Math.cos(a) * r, Math.sin(a) * r], arc = (r, a0, a1, k = 24) => { const o = []; for (let i = 0; i <= k; i++) o.push(pol(r, a0 + ((a1 - a0) * i) / k)); return o; };
    const ringA = pick(['leaf', 'plum', 'drop']), ringB = pick(['lantern', 'plum', 'scroll', 'fish']), ringC = pick(['crescent', 'drop']);
    const edge = []; for (let i = 0; i <= 360; i++) { const t = (i / 360) * TAU; edge.push(pol(outer(t) - R * 0.035, t)); }
    sawRow(g, edge, R * 0.028, R * 0.017, 1, 0.7);
    for (let k = 0; k < n; k++) {
      g.save(); g.rotate(k * A);
      // outer band
      if (ringA === 'leaf') { for (let j = -2; j <= 2; j++) { const an = b + j * A * 0.13, p0 = pol(R * 0.715, b + j * A * 0.05), p1 = pol(R * (0.86 - Math.abs(j) * 0.025), an); taper(g, [p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], p1], R * 0.024); } crescent(g, ...pol(R * 0.74, b), R * 0.06, b + Math.PI - 1.1, b + Math.PI + 1.1, R * 0.022); }
      else if (ringA === 'plum') { plum(g, ...pol(R * 0.79, b), R * 0.06, b); cutCircle(g, ...pol(R * 0.8, 0), R * 0.018); crescent(g, 0, 0, R * 0.73, b - A * 0.3, b + A * 0.3, R * 0.025); }
      else { const P = (u, v) => [Math.cos(b) * u - Math.sin(b) * v, Math.sin(b) * u + Math.cos(b) * v], w = R * Math.sin(A / 2) * 0.55; cut(g, (q) => { q.moveTo(...P(R * 0.7, 0)); q.quadraticCurveTo(...P(R * 0.78, w), ...P(R * 0.86, 0)); q.quadraticCurveTo(...P(R * 0.78, -w), ...P(R * 0.7, 0)); }); cutCircle(g, ...pol(R * 0.82, 0), R * 0.02); }
      // middle band, cut away then laid back in red lines (阳刻)
      const r0 = R * 0.42, r1 = R * 0.66, lw = R * 0.017;
      cut(g, (q) => trace(q, arc(r0, -0.02, A + 0.02).concat(arc(r1, A + 0.02, -0.02))));
      redLine(g, (q) => trace(q, arc(r0 + lw / 2, -0.03, A + 0.03), false), lw);
      redLine(g, (q) => trace(q, arc(r1 - lw / 2, -0.03, A + 0.03), false), lw);
      redLine(g, (q) => { q.moveTo(...pol(r0, 0)); q.lineTo(...pol(r1, 0)); }, lw);
      for (const [r, s] of [[r0 + lw, 1], [r1 - lw, -1]]) {
        const S = along(arc(r, 0.01, A - 0.01, 16), R * 0.028);
        fillP(g, (q) => { for (let i = 0; i < S.length - 1; i++) { const P0 = S[i], P1 = S[i + 1], m = [(P0.x + P1.x) / 2, (P0.y + P1.y) / 2], d = Math.hypot(m[0], m[1]); q.moveTo(P0.x, P0.y); q.lineTo(P1.x, P1.y); q.lineTo(m[0] + (m[0] / d) * s * R * 0.03, m[1] + (m[1] / d) * s * R * 0.03); q.closePath(); } });
      }
      const mc = pol((r0 + r1) / 2, b), ux = Math.cos(b), uy = Math.sin(b), M = (u, v) => [mc[0] + ux * u - uy * v, mc[1] + uy * u + ux * v];
      const hw = Math.min(R * 0.1, ((r0 + r1) / 2) * Math.sin(A / 2) * 0.62);
      if (ringB === 'lantern') {
        fillP(g, (q) => trace(q, ellPts(mc[0], mc[1], R * 0.075, hw * 0.8, b, 32)));
        for (const v of [-0.4, 0, 0.4]) taper(g, [M(-R * 0.055, v * hw * 0.6), M(0, v * hw * 0.85), M(R * 0.055, v * hw * 0.6)], hw * 0.16);
        redLine(g, (q) => { q.moveTo(...M(-R * 0.075, 0)); q.lineTo(...pol(r0, b)); q.moveTo(...M(R * 0.075, 0)); q.lineTo(...pol(r1, b)); }, lw * 0.8);
        fillP(g, (q) => { trace(q, [M(-R * 0.09, -hw * 0.3), M(-R * 0.09, hw * 0.3), M(-R * 0.07, hw * 0.4), M(-R * 0.07, -hw * 0.4)]); trace(q, [M(R * 0.09, -hw * 0.25), M(R * 0.09, hw * 0.25), M(R * 0.07, hw * 0.35), M(R * 0.07, -hw * 0.35)]); });
      } else if (ringB === 'plum') {
        fillP(g, (q) => { for (let j = 0; j < 5; j++) { const a = j * TAU / 5, p = [mc[0] + Math.cos(a) * hw * 0.42, mc[1] + Math.sin(a) * hw * 0.42]; q.moveTo(p[0] + hw * 0.36, p[1]); q.arc(p[0], p[1], hw * 0.36, 0, TAU); } });
        cutCircle(g, mc[0], mc[1], hw * 0.14); for (let j = 0; j < 5; j++) { const a = j * TAU / 5 + 0.6; cutCircle(g, mc[0] + Math.cos(a) * hw * 0.5, mc[1] + Math.sin(a) * hw * 0.5, hw * 0.07); }
        redLine(g, (q) => { q.moveTo(...M(-hw * 0.7, 0)); q.lineTo(...pol(r0, b)); q.moveTo(...M(hw * 0.7, 0)); q.lineTo(...pol(r1, b)); }, lw * 0.8);
      } else if (ringB === 'scroll') {
        for (const s of [1, -1]) {
          const c0 = M(0, s * hw * 0.45), pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40, an = b + s * (Math.PI * 0.5 + u * Math.PI * 1.9), rr = hw * 0.55 * (1 - u * 0.8); pts.push([c0[0] + Math.cos(an) * rr, c0[1] + Math.sin(an) * rr]); }
          redLine(g, (q) => trace(q, pts, false), lw * 0.9);
          redLine(g, (q) => { q.moveTo(...pts[0]); q.lineTo(...pol(r1, b + s * A * 0.12)); }, lw * 0.8);
        }
        redLine(g, (q) => { q.moveTo(...pol(r0, b)); q.lineTo(...M(0, 0)); }, lw * 0.9);
      } else {
        const body = []; for (let i = 0; i <= 24; i++) { const t = (i / 24) * TAU; body.push(M(Math.cos(t) * R * 0.07, Math.sin(t) * hw * 0.42 * (Math.cos(t) > 0 ? 1 : 0.7))); }
        fillP(g, (q) => trace(q, body)); fillP(g, (q) => trace(q, [M(-R * 0.06, 0), M(-R * 0.1, hw * 0.45), M(-R * 0.1, -hw * 0.45)]));
        cutCircle(g, ...M(R * 0.035, -hw * 0.08), hw * 0.07); crescent(g, ...M(-R * 0.01, 0), hw * 0.3, b - 0.7, b + 0.7, hw * 0.08);
        redLine(g, (q) => { q.moveTo(...M(-R * 0.1, 0)); q.lineTo(...pol(r0, b)); q.moveTo(...M(R * 0.07, 0)); q.lineTo(...pol(r1, b)); }, lw * 0.8);
      }
      // inner band
      if (ringC === 'crescent') crescent(g, 0, 0, R * 0.34, b - A * 0.32, b + A * 0.32, R * 0.045);
      else { const P = (u, v) => [Math.cos(b) * u - Math.sin(b) * v, Math.sin(b) * u + Math.cos(b) * v], w = R * 0.3 * Math.sin(A / 2) * 0.6; cut(g, (q) => { q.moveTo(...P(R * 0.25, 0)); q.quadraticCurveTo(...P(R * 0.31, w), ...P(R * 0.37, 0)); q.quadraticCurveTo(...P(R * 0.31, -w), ...P(R * 0.25, 0)); }); }
      cutCircle(g, ...pol(R * 0.3, 0), R * 0.014);
      g.restore();
    }
    sawRow(g, arc(R * 0.395, 0, TAU, 120), R * 0.035, R * 0.02, 1, 0.72);
    if (centre && centre.length && /\p{Script=Han}|\w/u.test(centre)) {
      g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.font = HAN(900, R * 0.34); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(centre, 0, R * 0.02); g.restore();
      crescent(g, 0, 0, R * 0.22, Math.PI * 0.15, Math.PI * 0.85, R * 0.02); crescent(g, 0, 0, R * 0.22, Math.PI * 1.15, Math.PI * 1.85, R * 0.02);
    } else petals(g, 0, 0, R * 0.21, n >= 12 ? n / 2 : n, -Math.PI / 2 + b, 0.22);
  }
  /** a piece's light version: warm light behind, the paper glowing deep red where light passes through it, holes bright */
  function litOf(p, R) {
    if (p.lit) return p.lit;
    const c = cv(p.flat.width, p.flat.height), g = c.getContext('2d'), K = p.flat.width / p.w;
    g.setTransform(K, 0, 0, K, -p.x0 * K, -p.y0 * K);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
    gr.addColorStop(0, '#FFF0C4'); gr.addColorStop(0.5, '#FFC460'); gr.addColorStop(1, '#E36A24');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.93, 0, TAU); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const t = cv(c.width, c.height), tg = t.getContext('2d');
    tg.drawImage(p.flat, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#B5121A'; tg.fillRect(0, 0, c.width, c.height);
    tg.globalCompositeOperation = 'overlay'; tg.fillStyle = tg.createPattern(grain(), 'repeat'); tg.fillRect(0, 0, c.width, c.height);
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(p.flat, 0, 0);
    g.drawImage(t, 0, 0);
    return (p.lit = c);
  }
  /** light that escaped through the holes: the hole mask smeared outward from the centre (rays), cached */
  function raysOf(p, R) {
    if (p.rays) return p.rays;
    const K = 0.5, S = R * 4.4, c = cv(S * K, S * K), g = c.getContext('2d');
    const holes = cv(R * 2 * K, R * 2 * K), hg = holes.getContext('2d');
    hg.setTransform(K, 0, 0, K, R * K, R * K); hg.fillStyle = '#FFD890'; hg.beginPath(); hg.arc(0, 0, R * 0.93, 0, TAU); hg.fill();
    hg.globalCompositeOperation = 'destination-out'; hg.drawImage(p.flat, p.x0, p.y0, p.w, p.h);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) { const s = 1 + 1.15 * i / 15; g.globalAlpha = (1 - i / 16) * 0.085; g.drawImage(holes, (S * K) / 2 - R * s * K, (S * K) / 2 - R * s * K, R * 2 * s * K, R * 2 * s * K); }
    g.globalAlpha = 0.4; g.filter = 'blur(6px)'; g.drawImage(holes, (S * K) / 2 - R * K, (S * K) / 2 - R * K); g.filter = 'none';
    return (p.rays = { c, S, holes });
  }
  /** flower(cx, cy, r, o): THE signature — a window flower (团花). By default it is made in front of the viewer: a folded red
   *  wedge appears, the scissors cut into it (scraps fall), then it snaps open fold by fold into the full symmetric
   *  flower (enter 'unfold', ~2.6 s in all; o.cutDur, o.dur). enter 'paste' just pastes it on, 'cut' cuts round it.
   *  o: { fold: 8 (mirror folds: 8, 12 or 16), seed (another seed → another pattern), centre: one character cut
   *  through the heart ('福', '春', '喜', 'A'…), color: 'red'|'gold'|'pale'|'cream', at, cutDur (1.2), dur (unfold, 1.1),
   *  glow: t (from t the flower is backlit: paper glows deep red, every hole pours warm light, rays spread out), glowR
   *  (how far the rays reach, × r, default 1), project: [x, y, w, h] (from glow on, the pattern is cast as light on the
   *  ground in that ellipse), spin (deg per second after it opens), out }. r 120–420. Returns { end, glowAt, x, y }. */
  B.flower = function (cx, cy, r, o = {}) {
    const n = [8, 12, 16].includes(o.fold) ? o.fold : 8, seed = o.seed ?? 1, colr = paperCol(o.color || 'red');
    const at = o.at ?? 0, enter = o.enter || 'unfold', cutDur = o.cutDur ?? 1.2, dur = o.dur ?? 1.1;
    const tCut = at + 0.3, tOpen = enter === 'unfold' ? tCut + cutDur + 0.15 : at, tDone = enter === 'unfold' ? tOpen + dur : at + (enter === 'cut' ? 1.4 : 0.2);
    let p = null;
    const get = () => p || (p = piece([-r, -r, r, r], (g) => drawFlower(g, r, n, seed, o.centre), { color: colr, K: r > 260 ? 1.25 : 1.5, seed }));
    const A = TAU / n, folds = Math.ceil(Math.log2(n));
    const glowAt = o.glow;
    if (o.project && glowAt != null) {
      const [px, py, pw, ph] = o.project;
      mount(this, px - pw / 2 - 20, py - ph / 2 - 20, pw + 40, ph + 40, { out: o.out }, (lt) => (lt < glowAt ? 'off' : step(lt, 12)), (g, lt) => {
        const k = clamp((lt - glowAt) / 0.6) * (0.9 + 0.1 * Math.sin(step(lt) * 5)), R = raysOf(get(), r);
        g.save(); g.globalAlpha = 0.55 * k; g.translate(px, py); g.scale(pw / (2 * r), ph / (2 * r)); g.rotate(o.spin ? (step(lt) - tDone) * o.spin * Math.PI / 180 : 0);
        g.filter = 'blur(2px)'; g.drawImage(R.holes, -r, -r, 2 * r, 2 * r); g.filter = 'none'; g.restore();
        const gr = g.createRadialGradient(px, py, 0, px, py, pw / 2); gr.addColorStop(0, `rgba(255,200,120,${(0.25 * k).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,160,80,0)');
        g.save(); g.translate(px, py); g.scale(1, ph / pw); g.translate(-px, -py); g.fillStyle = gr; g.fillRect(px - pw / 2, py - pw / 2, pw, pw); g.restore();
      }, 0.6, 'pc-light');
    }
    if (glowAt != null) {
      const gR = r * 1.25 * (o.glowR ?? 1);
      mount(this, cx - gR * 1.4, cy - gR * 1.4, gR * 2.8, gR * 2.8, { out: o.out }, (lt) => (lt < glowAt ? 'off' : step(lt, 12)), (g, lt) => {
        const k = clamp((lt - glowAt) / 0.5), gr = g.createRadialGradient(cx, cy, r * 0.5, cx, cy, gR * 1.4);
        gr.addColorStop(0, `rgba(255,190,90,${(0.55 * k).toFixed(3)})`); gr.addColorStop(0.5, `rgba(240,110,40,${(0.18 * k).toFixed(3)})`); gr.addColorStop(1, 'rgba(200,60,20,0)');
        g.fillStyle = gr; g.fillRect(cx - gR * 1.4, cy - gR * 1.4, gR * 2.8, gR * 2.8);
      }, 0.5, 'pc-light');
    }
    const ext = r * 1.25 + 130;
    const self = this;
    let scraps = null;
    const h = mount(this, cx - ext, cy - ext, ext * 2, ext * 2, o, (lt) => {
      if (lt < at) return 'pre';
      if (lt < tDone + 0.1 || o.spin || (glowAt != null && lt < glowAt + 0.6)) return step(lt, 24);
      return glowAt != null && lt >= glowAt ? 'lit' : 'still';
    }, (g, lt) => {
      const P = get(), ls = step(lt, 24);
      g.save(); g.translate(cx, cy);
      if (o.spin && lt > tDone) g.rotate((ls - tDone) * o.spin * Math.PI / 180);
      const glowK = glowAt != null ? clamp((ls - glowAt) / 0.5) : 0;
      const img = glowK > 0 ? litOf(P, r) : P.c;
      if (enter !== 'unfold' || lt >= tDone) {
        if (enter === 'paste') { const k = Math.floor((step(lt) - at) * FPS); g.scale(k <= 0 ? 1.08 : 1, k <= 0 ? 1.08 : 1); }
        if (enter === 'cut' && lt < at + 1.4) { const u = clamp((ls - at) / 1.4), a = -Math.PI / 2 + u * TAU; g.save(); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r * 2, -Math.PI / 2, a); g.clip(); put(g, P); g.restore(); scissors(g, Math.cos(a) * r, Math.sin(a) * r, a + Math.PI / 2, snipOpen(lt), 110); g.restore(); return; }
        if (glowK > 0 && glowK < 1) { put(g, P); g.globalAlpha = glowK; }
        put(g, P, img); g.globalAlpha = 1;
        if (glowK > 0) { const R = raysOf(P, r); g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK * (0.6 + 0.08 * Math.sin(step(lt) * 4)); g.drawImage(R.c, -R.S / 2, -R.S / 2, R.S, R.S); g.restore(); }
        if (scraps) scrapsFrom(g, scraps, lt);
        g.restore(); return;
      }
      // folded: a wedge [−A/2 … A/2] pointing up, a stack of layers; cut from the rim inward; then snap open
      const rot0 = -Math.PI / 2 - A / 2;
      g.rotate(rot0);
      const sector = (q, a0, a1) => { q.beginPath(); q.moveTo(0, 0); q.arc(0, 0, r * 1.2, a0, a1); q.closePath(); };
      if (lt < tOpen) {
        const u = clamp((ls - tCut) / cutDur), rs = r * (1.02 - 0.92 * u);
        const layers = Math.min(4, folds + 1);
        for (let i = layers; i >= 1; i--) { g.save(); g.translate(i * 1.6, i * 2); sector(g, 0, A); g.clip(); g.fillStyle = i % 2 ? '#8E1218' : '#A8161C'; g.beginPath(); g.arc(0, 0, r * 0.98, 0, A); g.lineTo(0, 0); g.fill(); g.restore(); }
        g.save(); sector(g, 0, A); g.clip();
        g.save(); g.beginPath(); g.arc(0, 0, rs, 0, TAU); g.clip(); g.fillStyle = colr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r * 0.98, 0, A); g.fill(); g.restore();
        g.save(); g.beginPath(); g.arc(0, 0, r * 2, 0, TAU); g.arc(0, 0, rs, 0, TAU, true); g.clip('evenodd'); put(g, P); g.restore();
        g.restore();
        if (u > 0 && u < 1) {
          const zig = A * (0.5 + 0.42 * Math.sin(u * Math.PI * 9)), sx = Math.cos(zig) * rs, sy = Math.sin(zig) * rs;
          if (!scraps) { const rr = PV.rng(seed * 17 + 5); scraps = []; for (let i = 0; i < 9; i++) { const q = (i + 0.5) / 9, rr0 = r * (1.02 - 0.92 * q), z = A * (0.5 + 0.42 * Math.sin(q * Math.PI * 9)); const X = Math.cos(z) * rr0, Y = Math.sin(z) * rr0; const c = Math.cos(rot0), s = Math.sin(rot0); scraps.push({ t: tCut + q * cutDur, x: X * c - Y * s, y: X * s + Y * c, vx: (rr() - 0.5) * 80, r: 7 + rr() * 9, ph: rr() * 6, spin: (rr() - 0.5) * 8 }); } }
          scissors(g, sx, sy, zig + Math.PI + 0.5 * Math.sin(u * Math.PI * 9 + 1.5), snipOpen(lt), Math.max(110, r * 0.45));
        }
        g.restore();
        if (scraps) { g.save(); g.translate(cx, cy); scrapsFrom(g, scraps, lt); g.restore(); }
        return;
      }
      // unfolding: k folds already open; the next flap swings across the mirror line at angle cover
      const u = clamp((ls - tOpen) / dur) * folds, k = Math.min(folds - 1, Math.floor(u)), f = u - k;
      const cover = Math.min(TAU, A * Math.pow(2, k)), D = Math.min(cover, TAU - cover);
      g.save(); sector(g, 0, cover); g.clip(); put(g, P); g.restore();
      const s = -Math.cos(Math.PI * ease.out(clamp(f * 1.25))), nx = -Math.sin(cover), ny = Math.cos(cover);
      g.save(); g.transform(1 + (s - 1) * nx * nx, (s - 1) * nx * ny, (s - 1) * nx * ny, 1 + (s - 1) * ny * ny, 0, 0);
      sector(g, cover, cover + D); g.clip(); put(g, P, s < 0 ? backOf(P) : P.c);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(40,0,8,${(0.45 * (1 - Math.abs(s))).toFixed(3)})`; g.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
      g.restore();
      g.restore();
      if (scraps) { g.save(); g.translate(cx, cy); scrapsFrom(g, scraps, lt); g.restore(); }
    });
    return Object.assign(h, { end: tDone, glowAt, x: cx, y: cy, r });
  };

  // ══════════════════════════════ animals ══════════════════════════════
  // Each kind draws a profile facing right in units (body ≈ x −1…1, feet ≈ y 0.62) and returns its box in units.
  const U = {};
  const leg = (g, x, y0, len, w, back = 0) => fillPoly(g, ribbonPts([[x, y0 - len * 0.15], [x + back * 0.1, y0 + len * 0.5], [x + back * 0.04, y0 + len]], w * 1.45, w * 0.8));
  const hoof = (g, x, y, w) => fillEll(g, x, y, w * 0.55, w * 0.28);
  const tailCurl = (g, pts, w0, w1) => fillPoly(g, ribbonPts(pts, w0, w1));
  /** the body's ornament: a sawtooth band along the back, a blossom at the heart, crescents either side (not fish scales) */
  function furRows(g, clipFn, x0, y0, x1, y1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    g.save(); g.beginPath(); clipFn(g); g.clip();
    const arcP = []; for (let i = 0; i <= 20; i++) { const x = x0 + w * (0.12 + 0.76 * i / 20), q = (x - cx) / (w / 2); arcP.push([x, y0 + h * 0.2 + q * q * h * 0.18]); }
    sawRow(g, arcP, h * 0.13, h * 0.075, -1, 0.72);
    petals(g, cx, cy + h * 0.14, h * 0.27, 6, -Math.PI / 2, 0.24);
    for (const s of [1, -1]) { crescent(g, cx + s * w * 0.3, cy + h * 0.12, h * 0.2, Math.PI * 0.15, Math.PI * 0.85, h * 0.07); cutCircle(g, cx + s * w * 0.3, cy - h * 0.02, h * 0.035); }
    g.restore();
  }
  const bodyInset = (g, cx, cy, rx, ry, rot = 0, s = 1) => {   // the double contour, left open where the neck joins
    const fn = (q) => q.ellipse(cx, cy, rx, ry, rot, Math.PI * 0.12, Math.PI * 1.55);
    g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, rot, 0, TAU); g.clip();
    g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineWidth = 0.1 * s; g.beginPath(); fn(g); g.stroke();
    g.globalCompositeOperation = 'source-over'; g.strokeStyle = g.__col; g.lineWidth = 0.06 * s; g.beginPath(); fn(g); g.stroke(); g.restore();
  };
  U.rat = (g) => {
    fillEll(g, -0.05, 0.12, 0.78, 0.42); fillEll(g, 0.68, -0.06, 0.34, 0.27, -0.25); fillPoly(g, smooth([[0.85, -0.2], [1.25, 0.02], [0.9, 0.16]]));
    fillEll(g, 0.5, -0.38, 0.2, 0.22); tailCurl(g, [[-0.75, 0.2], [-1.2, 0.3], [-1.45, 0.05], [-1.35, -0.2]], 0.1, 0.03);
    for (const x of [-0.5, -0.3, 0.3, 0.48]) leg(g, x, 0.35, 0.28, 0.12);
    crescent(g, 0.5, -0.36, 0.13, Math.PI * 0.6, Math.PI * 1.6, 0.06); eye(g, 0.78, -0.1, 0.07);
    furRows(g, (q) => q.ellipse(-0.1, 0.14, 0.6, 0.3, 0, 0, TAU), -0.7, -0.1, 0.5, 0.4, 0.08, 0.025);
    swirl(g, -0.45, 0.12, 0.12, 1.6, 0.03, 0, 1); bodyInset(g, -0.05, 0.12, 0.78, 0.42);
    for (const y of [0.0, 0.05]) taper(g, [[1.02, y], [1.18, y - 0.06 + y], [1.32, y - 0.1 + y * 2]], 0.015);
    return [-1.55, -0.65, 1.4, 0.7];
  };
  U.ox = (g) => {
    fillEll(g, -0.1, 0, 0.95, 0.5); fillEll(g, 0.85, -0.15, 0.32, 0.36, 0.2); fillEll(g, 1.08, 0.08, 0.2, 0.16);
    for (const s of [1, -0.6]) fillPoly(g, ribbonPts([[0.8, -0.45], [0.95 + s * 0.05, -0.75], [0.7 + s * 0.25, -0.95]], 0.13, 0.02));
    fillEll(g, 0.62, -0.38, 0.12, 0.06, -0.5);
    for (const [x, b] of [[-0.75, -1], [-0.5, -1], [0.35, 1], [0.6, 1]]) { leg(g, x, 0.3, 0.42, 0.2, b); hoof(g, x + b * 0.05, 0.74, 0.2); }
    tailCurl(g, [[-1.0, -0.1], [-1.18, 0.15], [-1.15, 0.45]], 0.06, 0.04); fillEll(g, -1.15, 0.5, 0.06, 0.1);
    eye(g, 0.92, -0.22, 0.07); cutCircle(g, 1.12, 0.12, 0.035);
    furRows(g, (q) => q.ellipse(-0.15, 0.02, 0.75, 0.36, 0, 0, TAU), -0.9, -0.3, 0.6, 0.4, 0.1, 0.03);
    swirl(g, 0.38, -0.05, 0.16, 1.7, 0.035, 0, 1); swirl(g, -0.6, -0.05, 0.16, 1.7, 0.035, Math.PI, -1);
    bodyInset(g, -0.1, 0, 0.95, 0.5); sawRow(g, [[-0.8, 0.42], [0.4, 0.45]], 0.07, 0.04, 1);
    return [-1.35, -1.05, 1.35, 0.85];
  };
  U.tiger = (g) => {
    fillEll(g, -0.15, 0.02, 0.92, 0.42); fillEll(g, 0.85, -0.22, 0.4, 0.38); fillEll(g, 1.12, -0.05, 0.18, 0.14);
    for (const x of [0.62, 1.0]) fillEll(g, x, -0.55, 0.11, 0.11);
    for (const [x, b] of [[-0.8, -1], [-0.55, -1], [0.3, 1], [0.55, 1]]) { leg(g, x, 0.25, 0.4, 0.2, b); fillEll(g, x + b * 0.05, 0.66, 0.13, 0.07); }
    tailCurl(g, [[-1.0, -0.05], [-1.35, -0.1], [-1.45, -0.45], [-1.25, -0.7]], 0.1, 0.05);
    eye(g, 0.92, -0.3, 0.08); crescent(g, 0.62, -0.55, 0.06, Math.PI * 0.7, Math.PI * 1.7, 0.03);
    taper(g, [[0.78, -0.48], [0.86, -0.5], [0.94, -0.48]], 0.03); taper(g, [[0.76, -0.42], [0.86, -0.43], [0.96, -0.41]], 0.03); taper(g, [[0.86, -0.53], [0.86, -0.43], [0.86, -0.35]], 0.03);
    for (let i = 0; i < 7; i++) { const x = -0.85 + i * 0.22; taper(g, [[x - 0.04, -0.33], [x + 0.03, -0.12], [x - 0.02, 0.08]], 0.07); }
    for (let i = 0; i < 4; i++) { const t = 0.25 + i * 0.2; taper(g, [[-1.0 - t * 0.5, -0.1 - t * 0.6 + 0.08], [-1.05 - t * 0.5, -0.1 - t * 0.6], [-1.1 - t * 0.5, -0.1 - t * 0.6 - 0.08]], 0.05); }
    for (const y of [-0.08, -0.02]) taper(g, [[1.2, y], [1.38, y - 0.04 + y]], 0.018);
    swirl(g, 0.3, 0.05, 0.14, 1.6, 0.03, 0, 1); bodyInset(g, -0.15, 0.02, 0.92, 0.42); sawRow(g, [[-0.9, 0.36], [0.35, 0.38]], 0.07, 0.04, 1);
    return [-1.6, -0.85, 1.45, 0.78];
  };
  U.rabbit = (g) => {
    fillEll(g, -0.1, 0.12, 0.72, 0.48, -0.1); fillEll(g, 0.6, -0.3, 0.3, 0.26, -0.2); fillEll(g, 0.82, -0.2, 0.14, 0.12);
    fillPoly(g, ribbonPts([[0.45, -0.5], [0.3, -0.95], [0.12, -1.25]], 0.18, 0.08)); fillPoly(g, ribbonPts([[0.55, -0.5], [0.55, -0.98], [0.5, -1.3]], 0.18, 0.08));
    fillEll(g, -0.82, -0.02, 0.17, 0.17); fillEll(g, -0.35, 0.42, 0.42, 0.18); fillEll(g, 0.3, 0.52, 0.12, 0.1); leg(g, 0.32, 0.3, 0.25, 0.12);
    taper(g, [[0.4, -0.62], [0.3, -0.92], [0.2, -1.12]], 0.035); taper(g, [[0.55, -0.64], [0.54, -0.95], [0.51, -1.15]], 0.035);
    eye(g, 0.68, -0.33, 0.07); cutCircle(g, 0.9, -0.18, 0.025);
    furRows(g, (q) => q.ellipse(-0.15, 0.1, 0.5, 0.32, -0.1, 0, TAU), -0.7, -0.2, 0.4, 0.45, 0.08, 0.025);
    swirl(g, -0.4, 0.38, 0.12, 1.6, 0.03, 0, -1); bodyInset(g, -0.1, 0.12, 0.72, 0.48, -0.1); plum(g, -0.82, -0.02, 0.09);
    return [-1.05, -1.4, 1.05, 0.7];
  };
  U.horse = (g) => {
    fillEll(g, -0.15, -0.05, 0.85, 0.36); fillPoly(g, ribbonPts([[0.45, -0.15], [0.75, -0.55], [0.85, -0.85]], 0.42, 0.26));
    fillPoly(g, smooth([[0.7, -1.0], [1.0, -0.98], [1.32, -0.72], [1.28, -0.62], [0.95, -0.7], [0.78, -0.75]]));
    fillPoly(g, [[0.8, -0.98], [0.86, -1.18], [0.92, -0.97]]);
    for (const [x, b] of [[-0.75, -1], [-0.5, -1], [0.3, 1], [0.55, 1]]) { leg(g, x, 0.15, 0.55, 0.13, b); hoof(g, x + b * 0.05, 0.72, 0.16); }
    fillPoly(g, ribbonPts([[-0.95, -0.2], [-1.25, -0.1], [-1.35, 0.3], [-1.2, 0.55]], 0.16, 0.05));
    const mane = sawEdge(smooth([[0.5, -0.35], [0.62, -0.7], [0.78, -0.98]], false, 4), 0.1, 0.09, 1); fillPoly(g, mane.concat([[0.7, -0.75], [0.48, -0.3]]));
    eye(g, 0.95, -0.85, 0.06); cutCircle(g, 1.24, -0.68, 0.025);
    for (let i = 0; i < 3; i++) taper(g, [[-1.0 - i * 0.04, -0.12 + i * 0.1], [-1.2 - i * 0.03, 0.05 + i * 0.12], [-1.2 + i * 0.02, 0.35 + i * 0.07]], 0.04);
    furRows(g, (q) => q.ellipse(-0.2, -0.02, 0.65, 0.24, 0, 0, TAU), -0.85, -0.25, 0.45, 0.25, 0.08, 0.025);
    swirl(g, 0.35, -0.05, 0.13, 1.6, 0.03, 0, 1); swirl(g, -0.65, -0.05, 0.13, 1.6, 0.03, Math.PI, -1); bodyInset(g, -0.15, -0.05, 0.85, 0.36);
    return [-1.5, -1.25, 1.45, 0.85];
  };
  U.goat = (g) => {
    fillEll(g, -0.1, 0, 0.8, 0.42); fillEll(g, 0.82, -0.42, 0.24, 0.22, -0.3); fillPoly(g, smooth([[0.9, -0.5], [1.18, -0.38], [1.08, -0.22], [0.85, -0.28]]));
    fillPoly(g, ribbonPts([[0.55, -0.15], [0.72, -0.4]], 0.3, 0.28)); fillPoly(g, [[1.0, -0.26], [1.06, -0.05], [0.96, -0.24]]);
    fillPoly(g, ribbonPts([[0.75, -0.6], [0.55, -0.85], [0.35, -0.75], [0.38, -0.55], [0.5, -0.55]], 0.11, 0.04));
    for (const [x, b] of [[-0.65, -1], [-0.45, -1], [0.3, 1], [0.5, 1]]) { leg(g, x, 0.25, 0.42, 0.12, b); hoof(g, x + b * 0.05, 0.7, 0.14); }
    fillPoly(g, ribbonPts([[-0.85, -0.2], [-1.0, -0.38]], 0.12, 0.04));
    eye(g, 0.86, -0.46, 0.06); crescent(g, 0.5, -0.7, 0.12, Math.PI * 0.8, Math.PI * 1.6, 0.03);
    furRows(g, (q) => q.ellipse(-0.1, 0.02, 0.7, 0.36, 0, 0, TAU), -0.85, -0.35, 0.65, 0.4, 0.09, 0.035);
    bodyInset(g, -0.1, 0, 0.8, 0.42);
    return [-1.15, -1.0, 1.3, 0.82];
  };
  U.monkey = (g) => {
    fillEll(g, -0.05, 0.02, 0.6, 0.4, -0.3); fillEll(g, 0.55, -0.45, 0.3, 0.3); fillEll(g, 0.32, -0.52, 0.1, 0.12);
    for (const [x0, y0, x1, y1, x2, y2] of [[0.3, 0.1, 0.55, 0.35, 0.6, 0.62], [0.15, 0.2, 0.3, 0.45, 0.28, 0.62], [-0.45, 0.2, -0.6, 0.45, -0.5, 0.62], [-0.3, 0.25, -0.35, 0.5, -0.28, 0.62]]) fillPoly(g, ribbonPts([[x0, y0], [x1, y1], [x2, y2]], 0.13, 0.09));
    fillPoly(g, ribbonPts([[0.4, -0.15], [0.75, -0.3], [0.95, -0.65]], 0.12, 0.08));
    fillPoly(g, ribbonPts([[-0.6, 0.0], [-1.0, -0.1], [-1.15, -0.5], [-0.9, -0.75], [-0.75, -0.55]], 0.08, 0.04));
    crescent(g, 0.62, -0.42, 0.2, Math.PI * 0.55, Math.PI * 1.45, 0.04);
    eye(g, 0.66, -0.48, 0.05); crescent(g, 0.64, -0.34, 0.08, Math.PI * 0.2, Math.PI * 0.8, 0.025); crescent(g, 0.32, -0.52, 0.07, Math.PI * 0.6, Math.PI * 1.4, 0.025);
    furRows(g, (q) => q.ellipse(-0.05, 0.05, 0.45, 0.3, -0.3, 0, TAU), -0.5, -0.25, 0.4, 0.35, 0.07, 0.022); bodyInset(g, -0.05, 0.02, 0.6, 0.4, -0.3);
    return [-1.25, -0.9, 1.1, 0.72];
  };
  U.rooster = (g) => {
    fillEll(g, 0, 0.0, 0.6, 0.42, -0.2); fillPoly(g, ribbonPts([[0.35, -0.15], [0.5, -0.5], [0.55, -0.72]], 0.32, 0.22)); fillEll(g, 0.58, -0.78, 0.18, 0.16);
    fillPoly(g, [[0.72, -0.8], [0.9, -0.74], [0.72, -0.7]]); fillEll(g, 0.66, -0.58, 0.06, 0.1);
    const comb = sawEdge(smooth([[0.42, -0.85], [0.55, -1.02], [0.72, -0.9]], false, 3), 0.08, 0.07, 1); fillPoly(g, comb.concat([[0.6, -0.8]]));
    for (let i = 0; i < 5; i++) { const a = -0.3 - i * 0.28, L = 0.95 - Math.abs(i - 1.5) * 0.08; fillPoly(g, ribbonPts([[-0.4, -0.1], [-0.4 - Math.cos(a) * L * 0.5, -0.1 + Math.sin(a) * L * 0.7], [-0.45 - Math.cos(a + 0.6) * L, 0.1 + Math.sin(a + 0.6) * L]], 0.16, 0.03)); }
    for (const x of [-0.05, 0.15]) { fillPoly(g, ribbonPts([[x, 0.35], [x + 0.02, 0.62]], 0.05, 0.04)); fillPoly(g, [[x - 0.1, 0.66], [x + 0.14, 0.66], [x + 0.02, 0.6]]); }
    eye(g, 0.6, -0.8, 0.05);
    for (let i = 0; i < 5; i++) { const a = -0.3 - i * 0.28, L = 0.95 - Math.abs(i - 1.5) * 0.08; taper(g, [[-0.42, -0.1], [-0.42 - Math.cos(a) * L * 0.45, -0.1 + Math.sin(a) * L * 0.62], [-0.45 - Math.cos(a + 0.6) * L * 0.85, 0.08 + Math.sin(a + 0.6) * L * 0.85]], 0.035); }
    g.save(); g.beginPath(); g.ellipse(0.0, 0.02, 0.42, 0.28, -0.2, 0, TAU); g.clip(); crescentRows(g, -0.45, -0.25, 0.4, 0.35, 0.08, 0.028); g.restore();
    sawRow(g, smooth([[0.38, -0.5], [0.46, -0.3], [0.5, -0.12]], false, 3), 0.06, 0.035, 1); bodyInset(g, 0, 0, 0.6, 0.42, -0.2);
    return [-1.45, -1.1, 1.0, 0.72];
  };
  U.dog = (g) => {
    fillEll(g, -0.1, 0, 0.8, 0.38); fillEll(g, 0.78, -0.35, 0.28, 0.26); fillPoly(g, smooth([[0.9, -0.42], [1.25, -0.3], [1.2, -0.18], [0.9, -0.2]]));
    fillPoly(g, ribbonPts([[0.5, -0.1], [0.68, -0.3]], 0.34, 0.3)); fillPoly(g, [[0.62, -0.52], [0.64, -0.85], [0.82, -0.56]]);
    for (const [x, b] of [[-0.7, -1], [-0.5, -1], [0.3, 1], [0.5, 1]]) { leg(g, x, 0.2, 0.45, 0.13, b); fillEll(g, x + b * 0.06, 0.66, 0.1, 0.05); }
    fillPoly(g, ribbonPts([[-0.85, -0.15], [-1.05, -0.4], [-0.95, -0.65], [-0.8, -0.6]], 0.1, 0.05));
    eye(g, 0.85, -0.4, 0.06); cutCircle(g, 1.2, -0.29, 0.028); taper(g, [[0.66, -0.58], [0.68, -0.72], [0.7, -0.8]], 0.04);
    furRows(g, (q) => q.ellipse(-0.12, 0.02, 0.65, 0.28, 0, 0, TAU), -0.8, -0.3, 0.55, 0.3, 0.08, 0.025);
    swirl(g, 0.3, 0.0, 0.12, 1.6, 0.03, 0, 1); bodyInset(g, -0.1, 0, 0.8, 0.38);
    return [-1.15, -0.95, 1.35, 0.78];
  };
  U.pig = (g) => {
    fillEll(g, -0.05, 0.05, 0.92, 0.55); fillEll(g, 0.82, -0.08, 0.32, 0.32); fillEll(g, 1.12, 0.0, 0.12, 0.16);
    fillPoly(g, [[0.68, -0.32], [0.62, -0.6], [0.88, -0.38]]);
    for (const x of [-0.6, -0.35, 0.35, 0.58]) { leg(g, x, 0.42, 0.22, 0.16); }
    fillPoly(g, ribbonPts([[-0.95, -0.05], [-1.12, -0.15], [-1.18, 0.05], [-1.05, 0.08], [-1.08, -0.08]], 0.05, 0.03));
    cutCircle(g, 1.1, -0.05, 0.028); cutCircle(g, 1.14, 0.06, 0.028); eye(g, 0.88, -0.16, 0.06); crescent(g, 0.95, 0.12, 0.1, Math.PI * 0.2, Math.PI * 0.8, 0.025);
    furRows(g, (q) => q.ellipse(-0.1, 0.06, 0.7, 0.4, 0, 0, TAU), -0.8, -0.35, 0.6, 0.45, 0.1, 0.03);
    petals(g, -0.1, 0.05, 0.2, 6, 0, 0.25); bodyInset(g, -0.05, 0.05, 0.92, 0.55);
    return [-1.3, -0.72, 1.3, 0.75];
  };
  U.dragon = (g) => {
    const sp = []; for (let i = 0; i <= 40; i++) { const t = i / 40, x = -1.5 + t * 2.3; sp.push([x, 0.05 + Math.sin(t * Math.PI * 2.2 + 0.4) * 0.28 * (0.4 + t * 0.6)]); }
    const body = ribbonPts(sp, 0.08, 0.34); fillPoly(g, body);
    const back = []; for (let i = 0; i <= 40; i++) { const t = i / 40, x = -1.5 + t * 2.3; back.push([x, 0.05 + Math.sin(t * Math.PI * 2.2 + 0.4) * 0.28 * (0.4 + t * 0.6) - lerp(0.04, 0.17, t)]); }
    fillPoly(g, sawEdge(back, 0.09, 0.09, 1).concat(back.slice().reverse().map(([x, y]) => [x, y + 0.04])));
    const hx = 0.95, hy = sp[40][1] - 0.12; fillEll(g, hx, hy, 0.26, 0.17, -0.15);
    fillPoly(g, smooth([[hx + 0.1, hy - 0.12], [hx + 0.48, hy - 0.05], [hx + 0.42, hy + 0.04], [hx + 0.12, hy + 0.02]]));
    fillPoly(g, smooth([[hx + 0.05, hy + 0.06], [hx + 0.42, hy + 0.12], [hx + 0.38, hy + 0.2], [hx, hy + 0.16]]));
    for (const s of [0, 1]) fillPoly(g, ribbonPts([[hx - 0.1, hy - 0.12], [hx - 0.25 - s * 0.1, hy - 0.4], [hx - 0.45 - s * 0.05, hy - 0.5]], 0.07, 0.02));
    fillPoly(g, ribbonPts([[hx + 0.42, hy - 0.03], [hx + 0.6, hy - 0.2], [hx + 0.75, hy - 0.12]], 0.025, 0.012)); fillPoly(g, ribbonPts([[hx + 0.38, hy + 0.12], [hx + 0.55, hy + 0.3], [hx + 0.72, hy + 0.28]], 0.025, 0.012));
    for (const [i, s] of [[12, 1], [28, 1]]) { const [x, y] = sp[i]; fillPoly(g, ribbonPts([[x, y], [x + 0.1, y + 0.3 * s], [x + 0.2, y + 0.38 * s]], 0.09, 0.05)); for (let c = 0; c < 3; c++) fillPoly(g, [[x + 0.2, y + 0.38 * s], [x + 0.26 + c * 0.05, y + 0.48 * s], [x + 0.18 + c * 0.04, y + 0.4 * s]]); }
    fillPoly(g, sawEdge(smooth([[-1.5, 0.02], [-1.75, -0.15], [-1.62, 0.12]], true, 3), 0.05, 0.06, 1));
    eye(g, hx + 0.05, hy - 0.04, 0.06); swirl(g, hx - 0.12, hy + 0.04, 0.07, 1.4, 0.02, 0, 1);
    g.save(); g.beginPath(); trace(g, ribbonPts(sp, 0.04, 0.22)); g.clip(); crescentRows(g, -1.5, -0.4, 0.9, 0.5, 0.055, 0.02); g.restore();
    return [-1.8, -0.75, 1.75, 0.68];
  };
  U.snake = (g) => {
    const sp = []; for (let i = 0; i <= 40; i++) { const t = i / 40; sp.push([-1.3 + t * 2.2, 0.15 + Math.sin(t * Math.PI * 2.4) * 0.25 * (1 - t * 0.3)]); }
    fillPoly(g, ribbonPts(sp, 0.04, 0.24)); const [hx, hy] = sp[40]; fillEll(g, hx + 0.12, hy - 0.04, 0.2, 0.13, -0.2);
    fillPoly(g, ribbonPts([[hx + 0.3, hy - 0.06], [hx + 0.42, hy - 0.04], [hx + 0.48, hy - 0.1]], 0.02, 0.01)); eye(g, hx + 0.14, hy - 0.08, 0.05);
    g.save(); g.beginPath(); trace(g, ribbonPts(sp, 0.02, 0.17)); g.clip(); crescentRows(g, -1.3, -0.2, 0.9, 0.5, 0.05, 0.018); g.restore();
    return [-1.4, -0.4, 1.4, 0.55];
  };
  U.fish = (g) => {
    fillPoly(g, smooth([[1.0, 0.0], [0.7, -0.38], [0.0, -0.48], [-0.6, -0.22], [-0.85, 0.0], [-0.6, 0.2], [0.0, 0.42], [0.7, 0.32]]));
    fillPoly(g, smooth([[-0.75, 0.0], [-1.25, -0.5], [-1.4, -0.42], [-1.15, 0.0], [-1.4, 0.42], [-1.25, 0.5]]));
    fillPoly(g, sawEdge(smooth([[-0.35, -0.3], [0.0, -0.68], [0.4, -0.42]], false, 3), 0.06, 0.06, 1).concat([[0.3, -0.35], [-0.3, -0.25]]));
    fillPoly(g, smooth([[0.1, 0.38], [-0.05, 0.62], [-0.25, 0.36]]));
    eye(g, 0.66, -0.08, 0.07); crescent(g, 0.62, 0.0, 0.3, -Math.PI * 0.35, Math.PI * 0.4, 0.04);
    g.save(); g.beginPath(); g.ellipse(-0.05, 0, 0.62, 0.34, 0, 0, TAU); g.clip(); crescentRows(g, -0.7, -0.4, 0.5, 0.4, 0.1, 0.035); g.restore();
    for (let i = -2; i <= 2; i++) taper(g, [[-0.88, i * 0.04], [-1.08, i * 0.12], [-1.24, i * 0.2]], 0.04);
    taper(g, [[0.9, 0.06], [1.12, 0.12], [1.3, 0.26]], 0.02);
    return [-1.45, -0.75, 1.35, 0.68];
  };
  U.crane = (g) => {
    fillEll(g, -0.1, -0.05, 0.55, 0.32, -0.15); fillPoly(g, ribbonPts([[0.3, -0.2], [0.5, -0.6], [0.4, -0.95], [0.55, -1.15]], 0.12, 0.08)); fillEll(g, 0.6, -1.17, 0.11, 0.08);
    fillPoly(g, [[0.68, -1.2], [1.0, -1.12], [0.68, -1.13]]);
    fillPoly(g, sawEdge(smooth([[-0.6, -0.1], [-0.95, 0.1], [-0.6, 0.15]], false, 3), 0.06, 0.06, 1).concat([[-0.4, 0.1]]));
    for (const x of [-0.05, 0.1]) { fillPoly(g, ribbonPts([[x, 0.2], [x + 0.03, 0.62]], 0.04, 0.03)); fillPoly(g, [[x - 0.1, 0.65], [x + 0.15, 0.65], [x + 0.03, 0.6]]); }
    eye(g, 0.6, -1.19, 0.04); plum(g, 0.55, -1.25, 0.05);
    g.save(); g.beginPath(); g.ellipse(-0.1, -0.05, 0.42, 0.24, -0.15, 0, TAU); g.clip(); for (let i = 0; i < 6; i++) taper(g, [[-0.4 + i * 0.12, -0.25], [-0.45 + i * 0.12, 0.0], [-0.5 + i * 0.12, 0.2]], 0.045); g.restore();
    return [-1.0, -1.35, 1.05, 0.72];
  };
  U.magpie = (g) => {
    fillEll(g, 0, -0.05, 0.42, 0.28, -0.25); fillEll(g, 0.42, -0.32, 0.17, 0.15); fillPoly(g, [[0.56, -0.36], [0.78, -0.3], [0.56, -0.27]]);
    fillPoly(g, ribbonPts([[-0.3, 0.05], [-0.8, 0.25], [-1.25, 0.32]], 0.16, 0.1));
    fillPoly(g, smooth([[-0.15, -0.2], [-0.45, -0.75], [-0.25, -0.8], [0.2, -0.25]]));
    fillPoly(g, ribbonPts([[0.05, 0.2], [0.08, 0.45]], 0.04, 0.03)); fillPoly(g, [[-0.05, 0.48], [0.2, 0.48], [0.08, 0.43]]);
    eye(g, 0.46, -0.35, 0.045); for (let i = 0; i < 4; i++) taper(g, [[-0.15 - i * 0.04, -0.28 - i * 0.04], [-0.3 - i * 0.03, -0.55 - i * 0.04], [-0.32 - i * 0.02, -0.7]], 0.035);
    taper(g, [[-0.4, 0.13], [-0.8, 0.28], [-1.15, 0.33]], 0.04); g.save(); g.beginPath(); g.ellipse(0, -0.02, 0.32, 0.18, -0.25, 0, TAU); g.clip(); crescentRows(g, -0.35, -0.2, 0.3, 0.2, 0.07, 0.025); g.restore();
    return [-1.35, -0.95, 0.9, 0.6];
  };
  U.bat = (g) => {
    fillEll(g, 0, 0.05, 0.2, 0.3); fillEll(g, 0, -0.3, 0.16, 0.14); for (const s of [1, -1]) fillPoly(g, [[s * 0.06, -0.4], [s * 0.14, -0.58], [s * 0.15, -0.36]]);
    for (const s of [1, -1]) {
      const wing = [[s * 0.1, -0.15], [s * 0.6, -0.5], [s * 1.2, -0.35], [s * 1.0, -0.1], [s * 1.05, 0.15], [s * 0.78, 0.05], [s * 0.66, 0.3], [s * 0.42, 0.15], [s * 0.15, 0.25]];
      fillPoly(g, smooth(wing));
      for (const [a, b] of [[[s * 0.2, -0.1], [s * 1.0, -0.32]], [[s * 0.2, 0.0], [s * 0.85, 0.02]], [[s * 0.2, 0.08], [s * 0.6, 0.2]]]) taper(g, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.04], b], 0.035);
      swirl(g, s * 0.5, -0.22, 0.09, 1.5, 0.025, 0, s);
    }
    eye(g, -0.06, -0.32, 0.035); eye(g, 0.06, -0.32, 0.035); coinHole(g, 0, 0.08, 0.1);
    return [-1.25, -0.65, 1.25, 0.45];
  };
  U.butterfly = (g) => {
    fillEll(g, 0, 0, 0.06, 0.32); for (const s of [1, -1]) {
      fillPoly(g, smooth([[s * 0.04, -0.1], [s * 0.4, -0.65], [s * 0.85, -0.6], [s * 0.75, -0.15], [s * 0.1, 0.0]]));
      fillPoly(g, smooth([[s * 0.04, 0.02], [s * 0.6, 0.1], [s * 0.6, 0.5], [s * 0.25, 0.48], [s * 0.05, 0.15]]));
      fillPoly(g, ribbonPts([[s * 0.02, -0.3], [s * 0.15, -0.6], [s * 0.25, -0.7]], 0.02, 0.012));
      petals(g, s * 0.5, -0.4, 0.17, 6, 0, 0.25); plum(g, s * 0.35, 0.28, 0.1); crescent(g, s * 0.45, -0.35, 0.32, -Math.PI * 0.2 + (s < 0 ? Math.PI : 0), Math.PI * 0.3 + (s < 0 ? Math.PI : 0), 0.04);
    }
    return [-0.95, -0.8, 0.95, 0.6];
  };
  const ANIMAL_BOX = {};
  const animalPiece = (kind, size, colr, seed) => {
    const fn = U[kind] || U.fish, key = kind + '|' + size + '|' + colr;
    if (ANIMAL_BOX[key]) return ANIMAL_BOX[key];
    const probe = cv(1, 1).getContext('2d'); probe.__col = colr; const bx = fn(new Proxy(probe, { get: (t, k) => (typeof t[k] === 'function' ? () => {} : t[k]), set: () => true }));
    const s = size / (bx[2] - bx[0]);
    return (ANIMAL_BOX[key] = piece([bx[0] * s, bx[1] * s, bx[2] * s, bx[3] * s], (g) => { g.scale(s, s); fn(g); }, { color: colr, seed }));
  };
  /** animal(kind, cx, cy, size, o): a folk paper-cut animal in profile, facing right (o.face 'l' turns it): eyes, swirl
   *  joints, crescent fur or scales and a sawtooth belly are cut into it. Kinds — the twelve zodiac animals rat ox tiger
   *  rabbit dragon snake horse goat monkey rooster dog pig, and the auspicious ones fish (年年有余), crane, magpie (喜鹊),
   *  bat (福), butterfly. (cx, cy) = the middle of its box; feet land about size × 0.25 below cy. size = overall width in px (260–900). o: { color: 'red'|'gold'|'pale'|'cream'|'deep', at,
   *  enter: 'paste'|'cut'|'drop', dur, hop: px (bob on twos while it stays), sway: deg, move: lt => [dx, dy] (walk it
   *  across: pure function of lt), rot, out }. Returns { end, hide }. */
  B.animal = function (kind, cx, cy, size = 420, o = {}) {
    const p = animalPiece(kind, size, paperCol(o.color || 'red'), (cx * 3 + cy) | 0);
    return place(this, p, cx, cy, Object.assign({ bob: o.hop, flip: o.face === 'l' }, o));
  };

  // ══════════════════════════════ figures ══════════════════════════════
  /** draw a front-facing folk figure, feet at y = 0, height 1 */
  function drawFigure(g, kind, poseName, holds) {
    const child = kind === 'child' || kind === 'girl' || kind === 'boy', hr = child ? 0.15 : 0.11, hy = child ? -0.8 : -0.86;
    const sh = child ? -0.62 : -0.71, hip = child ? -0.3 : -0.36, wS = child ? 0.17 : 0.15, wH = child ? 0.22 : 0.2;
    fillEll(g, 0, hy, hr * 0.95, hr);
    if (child) { for (const s of [1, -1]) { fillEll(g, s * hr * 0.85, hy - hr * 0.85, hr * 0.42, hr * 0.42); } }
    else if (kind === 'woman') fillEll(g, 0, hy - hr * 1.05, hr * 0.6, hr * 0.4);
    else { fillP(g, (q) => { q.ellipse(0, hy - hr * 0.35, hr * 1.02, hr * 0.8, 0, Math.PI, TAU); q.closePath(); }); fillEll(g, 0, hy - hr * 1.12, hr * 0.16, hr * 0.12); fillPoly(g, [[-hr * 1.1, hy - hr * 0.42], [hr * 1.1, hy - hr * 0.42], [hr * 1.1, hy - hr * 0.3], [-hr * 1.1, hy - hr * 0.3]]); }
    fillPoly(g, [[-0.03, hy + hr * 0.8], [0.03, hy + hr * 0.8], [0.04, sh + 0.02], [-0.04, sh + 0.02]]);
    const skirt = kind === 'woman' || kind === 'girl', hem = skirt ? -0.12 : hip;
    fillPoly(g, smooth([[-wS, sh], [wS, sh], [wH * (skirt ? 1.25 : 1), hem], [-wH * (skirt ? 1.25 : 1), hem]], true, 2));
    if (!skirt) { for (const s of [1, -1]) fillPoly(g, [[s * 0.015, hip - 0.03], [s * wH * 0.92, hip - 0.03], [s * wH * 0.62, -0.04], [s * 0.035, -0.04]]); }
    else for (const s of [1, -1]) fillPoly(g, [[s * 0.03, -0.14], [s * 0.1, -0.14], [s * 0.1, -0.04], [s * 0.03, -0.04]]);
    for (const s of [1, -1]) fillEll(g, s * (skirt ? 0.07 : wH * 0.45), -0.03, 0.08, 0.035);
    const arm = (s, pts) => { pts[0] = [pts[0][0] * 0.55, pts[0][1] + 0.01]; fillPoly(g, ribbonPts(pts, 0.095, 0.065)); const e = pts[pts.length - 1]; fillEll(g, e[0], e[1], 0.04, 0.04); };
    const P = poseName || 'stand';
    for (const s of [1, -1]) {
      const sx = s * wS * 0.95, sy = sh + 0.03;
      if (P === 'raise' || (P === 'dance' && s > 0)) arm(s, [[sx, sy], [s * 0.3, sh - 0.12], [s * 0.36, sh - 0.3]]);
      else if (P === 'hold' || P === 'bow') arm(s, [[sx, sy], [s * 0.22, sh + 0.16], [s * 0.04, sh + 0.12]]);
      else if (P === 'dance') arm(s, [[sx, sy], [s * 0.32, sh + 0.08], [s * 0.42, sh + 0.02]]);
      else arm(s, [[sx, sy], [s * 0.21, sh + 0.13], [s * 0.21, sh + 0.3]]);
    }
    // the cuts: smiling eyes, mouth, cheek blossoms, collar, apron and hem patterns
    for (const s of [1, -1]) { crescent(g, s * hr * 0.38, hy + hr * 0.05, hr * 0.22, Math.PI * 1.1, Math.PI * 1.9, hr * 0.1); petals(g, s * hr * 0.55, hy + hr * 0.45, hr * 0.17, 5, 0, 0.25); }
    if (kind === 'elder') { const bd = sawEdge(smooth([[-hr * 0.7, hy + hr * 0.5], [-hr * 0.4, hy + hr * 2.0], [0, hy + hr * 2.6], [hr * 0.4, hy + hr * 2.0], [hr * 0.7, hy + hr * 0.5]], false, 2), hr * 0.12, hr * 0.18, 1); g.save(); g.globalCompositeOperation = 'source-over'; fillPoly(g, bd); g.restore(); cutCircle(g, 0, hy + hr * 0.75, hr * 0.12); for (const s of [1, -1]) taper(g, [[s * hr * 0.25, hy + hr * 1.0], [s * hr * 0.2, hy + hr * 1.6], [s * hr * 0.08, hy + hr * 2.1]], hr * 0.08); }
    else crescent(g, 0, hy + hr * 0.38, hr * 0.22, Math.PI * 0.2, Math.PI * 0.8, hr * 0.09);
    if (child) for (const s of [1, -1]) swirl(g, s * hr * 0.85, hy - hr * 0.85, hr * 0.32, 1.4, hr * 0.1, 0, s);
    crescent(g, 0, sh - 0.02, 0.09, Math.PI * 0.15, Math.PI * 0.85, 0.025);
    if (child) { const d = [[0, sh + 0.06], [0.1, sh + 0.17], [0, sh + 0.29], [-0.1, sh + 0.17]]; inset(g, (q) => trace(q, d), 0.012, 0.01); plum(g, 0, sh + 0.17, 0.05); }
    else { taper(g, [[-0.02, sh + 0.04], [-0.06, (sh + hem) / 2], [-0.02, hem - 0.02]], 0.02); for (let i = 0; i < 3; i++) cutCircle(g, 0.04, sh + 0.1 + i * 0.08, 0.013); }
    sawRow(g, [[-wH * (skirt ? 1.2 : 0.95), hem - 0.035], [wH * (skirt ? 1.2 : 0.95), hem - 0.035]], 0.03, 0.02, 1);
    if (!skirt) for (const s of [1, -1]) { sawRow(g, [[s * 0.05, -0.08], [s * wH * 0.6, -0.08]], 0.025, 0.018, 1); plum(g, s * wH * 0.45, hip + 0.12, 0.035); }
    for (const s of [1, -1]) swirl(g, s * wS * 0.7, sh + 0.06, 0.035, 1.4, 0.012, 0, s);
  }
  /** figure(kind, cx, footY, h, o): a front-facing folk figure cut from one sheet, symmetric like a folded paper doll —
   *  'child' (twin hair buns, a diamond apron), 'girl', 'boy', 'woman', 'man', 'elder' (cap and beard). Smiling crescent
   *  eyes and cheek blossoms are cut in. h = height in px (220–620). o: { pose: 'stand'|'raise' (both arms up: cheer,
   *  greet the new year)|'hold' (hands at the chest, holding `holds`)|'bow' (拱手 greeting)|'dance', holds: a motif kind
   *  held at the chest ('lantern', 'fish', 'peach', 'firecracker', 'fu'…), color, at, enter: 'unfold' (the half figure
   *  opens out of the fold — natural for a paper doll)|'paste'|'cut'|'drop', hop: px, move: lt => [dx, dy], out }. */
  B.figure = function (kind, cx, footY, h = 420, o = {}) {
    const colr = paperCol(o.color || 'red'), key = 'fig|' + kind + '|' + (o.pose || 'stand') + '|' + h + '|' + colr;
    const p = ANIMAL_BOX[key] || (ANIMAL_BOX[key] = piece([-0.5 * h, -1.12 * h, 0.5 * h, 0.02 * h], (g) => { g.scale(h, h); drawFigure(g, kind, o.pose); }, { color: colr, seed: h | 0 }));
    const hnd = place(this, p, cx, footY, Object.assign({ enter: 'unfold', dur: 0.7, bob: o.hop }, o));
    if (o.holds) this.motif(o.holds, cx, footY - h * ((kind === 'child' || kind === 'girl' || kind === 'boy') ? 0.47 : 0.56), h * 0.28, { at: (o.at ?? 0) + (o.enter === 'paste' ? 0.1 : 0.6), color: o.holdsColor || 'gold', bob: o.hop, move: o.move });
    return hnd;
  };

  // ══════════════════════════════ motifs ══════════════════════════════
  const M = {};
  M.lantern = (g) => {
    fillEll(g, 0, 0, 0.5, 0.42); fillPoly(g, [[-0.28, -0.52], [0.28, -0.52], [0.34, -0.38], [-0.34, -0.38]]); fillPoly(g, [[-0.26, 0.5], [0.26, 0.5], [0.32, 0.38], [-0.32, 0.38]]);
    fillPoly(g, [[-0.03, -0.75], [0.03, -0.75], [0.03, -0.5], [-0.03, -0.5]]);
    for (let i = -3; i <= 3; i++) fillPoly(g, [[i * 0.05 - 0.012, 0.5], [i * 0.05 + 0.012, 0.5], [i * 0.045 + 0.01, 0.95], [i * 0.045 - 0.01, 0.95]]);
    for (const v of [-0.3, -0.1, 0.1, 0.3]) taper(g, [[v * 0.7, -0.34], [v * 1.15, 0], [v * 0.7, 0.34]], 0.06);
    sawRow(g, [[-0.3, -0.42], [0.3, -0.42]], 0.05, 0.035, -1); sawRow(g, [[-0.3, 0.42], [0.3, 0.42]], 0.05, 0.035, 1);
    return [-0.55, -0.78, 0.55, 0.98];
  };
  M.fu = (g) => {
    fillPoly(g, [[0, -0.95], [0.95, 0], [0, 0.95], [-0.95, 0]]); inset(g, (q) => trace(q, [[0, -0.95], [0.95, 0], [0, 0.95], [-0.95, 0]]), 0.035, 0.02);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.font = HAN(900, 0.95); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('福', 0, 0.04); g.restore();
    for (const [x, y] of [[0, -0.72], [0.72, 0], [0, 0.72], [-0.72, 0]]) plum(g, x, y, 0.07);
    return [-1, -1, 1, 1];
  };
  M.coin = (g) => { fillEll(g, 0, 0, 0.9, 0.9); cut(g, (q) => q.rect(-0.22, -0.22, 0.44, 0.44)); crescent(g, 0, 0, 0.75, Math.PI * 1.1, Math.PI * 1.9, 0.08); crescent(g, 0, 0, 0.75, Math.PI * 0.1, Math.PI * 0.9, 0.08); for (const [x, y] of [[0, -0.48], [0.48, 0], [0, 0.48], [-0.48, 0]]) cutCircle(g, x, y, 0.06); return [-0.95, -0.95, 0.95, 0.95]; };
  M.peach = (g) => { fillPoly(g, smooth([[0, -0.75], [0.55, -0.3], [0.62, 0.25], [0.25, 0.65], [-0.25, 0.65], [-0.62, 0.25], [-0.55, -0.3]])); for (const s of [1, -1]) fillPoly(g, smooth([[0, 0.55], [s * 0.45, 0.7], [s * 0.75, 0.95], [s * 0.3, 0.92]])); taper(g, [[0, -0.6], [0.08, 0], [0.02, 0.5]], 0.05); crescent(g, -0.15, 0.05, 0.35, Math.PI * 0.6, Math.PI * 1.3, 0.06); taper(g, [[0.1, 0.62], [0.45, 0.78], [0.65, 0.9]], 0.03); return [-0.8, -0.8, 0.8, 1.0]; };
  M.plum = (g) => { for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5; fillEll(g, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.4, 0.4); } fillEll(g, 0, 0, 0.4, 0.4); petals(g, 0, 0, 0.3, 5, -Math.PI / 2, 0.3); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5; crescent(g, Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.22, a - 1.1, a + 1.1, 0.05); } return [-0.92, -0.92, 0.92, 0.92]; };
  M.cloud = (g) => { for (const [x, y, r] of [[-0.45, 0.1, 0.32], [0, -0.12, 0.42], [0.48, 0.1, 0.32], [0.05, 0.22, 0.3]]) fillEll(g, x, y, r, r * 0.9); fillPoly(g, ribbonPts([[-0.75, 0.32], [0, 0.42], [0.85, 0.3]], 0.12, 0.08)); swirl(g, 0, -0.1, 0.3, 1.8, 0.05, 0, 1); swirl(g, -0.45, 0.12, 0.2, 1.5, 0.04, Math.PI, -1); swirl(g, 0.48, 0.12, 0.2, 1.5, 0.04, 0, 1); return [-0.85, -0.6, 0.95, 0.55]; };
  M.knot = (g) => {
    fillPoly(g, [[0, -0.7], [0.7, 0], [0, 0.7], [-0.7, 0]]); cut(g, (q) => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const x = (i - j) * 0.13, y = (i + j) * 0.13; q.rect(x - 0.045, y - 0.045, 0.09, 0.09); } });
    for (const [x, y] of [[0, -0.75], [0.75, 0], [-0.75, 0]]) fillEll(g, x, y, 0.12, 0.12); fillPoly(g, [[-0.03, -0.88], [0.03, -0.88], [0.03, -0.7], [-0.03, -0.7]]);
    for (let i = -3; i <= 3; i++) fillPoly(g, [[i * 0.035 - 0.01, 0.7], [i * 0.035 + 0.01, 0.7], [i * 0.05 + 0.008, 1.2], [i * 0.05 - 0.008, 1.2]]);
    return [-0.9, -0.92, 0.9, 1.22];
  };
  M.gourd = (g) => { fillEll(g, 0, -0.38, 0.3, 0.3); fillEll(g, 0, 0.28, 0.48, 0.45); fillPoly(g, ribbonPts([[0, -0.66], [0.05, -0.82], [0.2, -0.88]], 0.07, 0.03)); fillEll(g, 0.22, -0.82, 0.14, 0.07, -0.4); plum(g, 0, 0.3, 0.18); crescent(g, 0, -0.38, 0.2, Math.PI * 0.6, Math.PI * 1.4, 0.05); sawRow(g, [[-0.25, -0.12], [0.25, -0.12]], 0.05, 0.035, 1); return [-0.55, -0.95, 0.55, 0.78]; };
  M.firecracker = (g) => {
    fillPoly(g, [[-0.025, -1.0], [0.025, -1.0], [0.025, 0.95], [-0.025, 0.95]]);
    for (let i = 0; i < 8; i++) { const y = -0.85 + i * 0.24, s = i % 2 ? 1 : -1; g.save(); g.translate(s * 0.13, y); g.rotate(s * 0.5); fillPoly(g, [[-0.1, -0.06], [0.1, -0.06], [0.1, 0.06], [-0.1, 0.06]]); g.restore(); cutCircle(g, s * 0.13, y, 0.015); }
    return [-0.3, -1.05, 0.3, 1.0];
  };
  M.lotus = (g) => { for (const [a, L] of [[-Math.PI / 2, 0.85], [-Math.PI / 2 - 0.55, 0.75], [-Math.PI / 2 + 0.55, 0.75], [-Math.PI / 2 - 1.1, 0.6], [-Math.PI / 2 + 1.1, 0.6]]) { const tip = [Math.cos(a) * L, 0.35 + Math.sin(a) * L]; fillPoly(g, smooth([[0, 0.38], [Math.cos(a - 0.35) * L * 0.6, 0.35 + Math.sin(a - 0.35) * L * 0.6], tip, [Math.cos(a + 0.35) * L * 0.6, 0.35 + Math.sin(a + 0.35) * L * 0.6]])); taper(g, [[0, 0.3], [tip[0] * 0.5, 0.35 + (tip[1] - 0.35) * 0.5], [tip[0] * 0.85, 0.35 + (tip[1] - 0.35) * 0.85]], 0.05); } fillPoly(g, ribbonPts([[-0.7, 0.45], [0, 0.5], [0.7, 0.45]], 0.12, 0.12)); crescentRows(g, -0.6, 0.42, 0.6, 0.48, 0.07, 0.02); return [-0.9, -0.55, 0.9, 0.6]; };
  M.sun = (g) => { fillEll(g, 0, 0, 0.6, 0.6); const e = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * TAU, r = i % 2 ? 0.95 : 0.7; e.push([Math.cos(a) * r, Math.sin(a) * r]); } fillPoly(g, e); petals(g, 0, 0, 0.42, 8, 0, 0.25); sawRow(g, ellPts(0, 0, 0.58, 0.58, 0, 60), 0.06, 0.04, 1); return [-1, -1, 1, 1]; };
  M.moon = (g) => { fillEll(g, 0, 0, 0.95, 0.95); for (const [x, y, r, d] of [[-0.35, 0.3, 0.22, 1], [0.25, 0.45, 0.15, -1], [0.4, -0.2, 0.12, 1]]) swirl(g, x, y, r, 1.7, 0.04, 0, d); crescent(g, 0, 0, 0.82, Math.PI * 0.9, Math.PI * 1.45, 0.06); return [-1, -1, 1, 1]; };
  M.dumpling = (g) => { const top = []; for (let i = 0; i <= 12; i++) { const x = -0.9 + i * 0.15; top.push([x, -0.15 - Math.sin(i / 12 * Math.PI) * 0.45 + (i % 2 ? 0.06 : 0)]); } fillPoly(g, top.concat([[0.9, -0.1], [0.75, 0.3], [0, 0.42], [-0.75, 0.3], [-0.9, -0.1]])); for (let i = 1; i < 6; i++) taper(g, [[-0.6 + i * 0.2, -0.45 + Math.abs(i - 3) * 0.06], [-0.62 + i * 0.2, -0.25], [-0.65 + i * 0.2, -0.1]], 0.04); crescent(g, 0, -0.5, 0.75, Math.PI * 0.3, Math.PI * 0.7, 0.05); return [-0.95, -0.7, 0.95, 0.5]; };
  M.mooncake = (g) => { const e = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, r = 0.9 + 0.06 * Math.cos(a * 12); e.push([Math.cos(a) * r, Math.sin(a) * r]); } fillPoly(g, e); inset(g, (q) => q.arc(0, 0, 0.72, 0, TAU), 0.03, 0.025); g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.font = HAN(900, 0.62); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('月', 0, 0.03); g.restore(); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; cutCircle(g, Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.03); } return [-1, -1, 1, 1]; };
  M.ingot = (g) => { fillPoly(g, smooth([[-0.95, -0.35], [-0.55, 0.0], [0.55, 0.0], [0.95, -0.35], [0.7, 0.35], [-0.7, 0.35]])); fillEll(g, 0, -0.08, 0.38, 0.3); crescent(g, 0, -0.08, 0.28, Math.PI * 1.1, Math.PI * 1.9, 0.06); sawRow(g, [[-0.6, 0.22], [0.6, 0.22]], 0.06, 0.04, -1); return [-1, -0.45, 1, 0.42]; };
  M.house = (g) => {
    fillPoly(g, [[-0.8, -0.05], [0.8, -0.05], [0.8, 0.7], [-0.8, 0.7]]);
    const roof = [[-1.05, -0.05], [-0.7, -0.38], [0.7, -0.38], [1.05, -0.05], [1.12, -0.16], [0.95, -0.1]]; fillPoly(g, roof.concat([[-0.95, -0.1], [-1.12, -0.16]]));
    fillPoly(g, [[-0.75, -0.4], [0.75, -0.4], [0.62, -0.52], [-0.62, -0.52]]);
    for (const s of [1, -1]) swirl(g, s * 0.98, -0.18, 0.05, 1.3, 0.02, 0, s);
    sawRow(g, [[-0.65, -0.3], [0.65, -0.3]], 0.06, 0.04, 1); sawRow(g, [[-0.6, -0.45], [0.6, -0.45]], 0.05, 0.035, 1);
    cut(g, (q) => q.rect(-0.18, 0.2, 0.36, 0.5)); for (const s of [1, -1]) { cut(g, (q) => q.arc(s * 0.5, 0.28, 0.17, 0, TAU)); }
    for (const s of [1, -1]) { fillEll(g, s * 0.5, 0.28, 0.1, 0.1); petals(g, s * 0.5, 0.28, 0.08, 6, 0, 0.3); }
    redLine(g, (q) => { q.moveTo(0, 0.2); q.lineTo(0, 0.7); }, 0.025);
    return [-1.15, -0.6, 1.15, 0.72];
  };
  M.tree = (g) => { fillPoly(g, ribbonPts([[0, 1.0], [-0.04, 0.4], [0.05, 0.0]], 0.16, 0.08)); for (const [x, y, r] of [[0, -0.35, 0.45], [-0.38, -0.05, 0.32], [0.38, -0.05, 0.32], [0, -0.75, 0.3]]) fillEll(g, x, y, r, r * 0.85); sawRow(g, ellPts(0, -0.35, 0.6, 0.55, 0, 40, Math.PI * 0.9, Math.PI * 2.1), 0.06, 0.05, 1); for (const [x, y] of [[0, -0.4], [-0.35, -0.05], [0.35, -0.05], [0, -0.75]]) plum(g, x, y, 0.1); return [-0.75, -1.1, 0.75, 1.02]; };
  M.boat = (g) => { fillPoly(g, smooth([[-1.0, -0.15], [-0.7, 0.2], [0.7, 0.2], [1.0, -0.3], [1.08, -0.5], [0.9, -0.15], [-0.85, -0.1]], true, 3)); fillEll(g, 1.0, -0.5, 0.12, 0.1); fillPoly(g, sawEdge([[-0.6, -0.12], [0.6, -0.12]], 0.06, 0.08, 1).concat([[0.6, -0.05], [-0.6, -0.05]])); for (let i = 0; i < 6; i++) fillPoly(g, ribbonPts([[-0.55 + i * 0.22, -0.05], [-0.7 + i * 0.22, 0.32]], 0.03, 0.02)); crescentRows(g, -0.8, 0.0, 0.7, 0.1, 0.06, 0.02); eye(g, 1.02, -0.52, 0.04); return [-1.05, -0.65, 1.15, 0.38]; };
  M.drum = (g) => { fillPoly(g, smooth([[-0.7, -0.5], [0.7, -0.5], [0.85, 0], [0.7, 0.5], [-0.7, 0.5], [-0.85, 0]])); for (const y of [-0.42, 0.42]) sawRow(g, [[-0.65, y], [0.65, y]], 0.05, 0.05, y < 0 ? 1 : -1); plum(g, 0, 0, 0.2); for (const s of [1, -1]) swirl(g, s * 0.45, 0, 0.15, 1.6, 0.035, 0, s); return [-0.9, -0.55, 0.9, 0.55]; };
  M.candle = (g) => { fillPoly(g, [[-0.18, -0.2], [0.18, -0.2], [0.18, 0.8], [-0.18, 0.8]]); fillPoly(g, smooth([[0, -0.75], [0.12, -0.4], [0, -0.25], [-0.12, -0.4]])); fillPoly(g, [[-0.35, 0.8], [0.35, 0.8], [0.25, 0.92], [-0.25, 0.92]]); crescent(g, 0, -0.42, 0.08, Math.PI * 0.6, Math.PI * 1.4, 0.03); for (let i = 0; i < 3; i++) plum(g, 0, 0.05 + i * 0.25, 0.08); return [-0.4, -0.8, 0.4, 0.95]; };
  M.flowerpot = (g) => { fillPoly(g, [[-0.45, 0.2], [0.45, 0.2], [0.32, 0.9], [-0.32, 0.9]]); for (const [x, y] of [[0, -0.55], [-0.4, -0.25], [0.4, -0.3]]) { fillPoly(g, ribbonPts([[0, 0.2], [x * 0.5, (y + 0.2) / 2], [x, y]], 0.04, 0.03)); for (let k = 0; k < 5; k++) { const a = k * TAU / 5; fillEll(g, x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, 0.1, 0.1); } cutCircle(g, x, y, 0.04); } sawRow(g, [[-0.4, 0.3], [0.4, 0.3]], 0.05, 0.04, 1); crescent(g, 0, 0.55, 0.2, Math.PI * 0.1, Math.PI * 0.9, 0.05); return [-0.6, -0.75, 0.6, 0.95]; };
  const MOTIF_CACHE = {};
  function motifPiece(kind, size, colr) {
    const fn = M[kind] || M.plum, key = kind + '|' + size + '|' + colr;
    if (MOTIF_CACHE[key]) return MOTIF_CACHE[key];
    const probe = cv(1, 1).getContext('2d'); const bx = fn(new Proxy(probe, { get: (t, k) => (typeof t[k] === 'function' ? () => {} : t[k]), set: () => true }));
    const s = size / Math.max(bx[2] - bx[0], bx[3] - bx[1]);
    return (MOTIF_CACHE[key] = piece([bx[0] * s, bx[1] * s, bx[2] * s, bx[3] * s], (g) => { g.scale(s, s); fn(g); }, { color: colr, seed: size | 0 }));
  }
  /** motif(kind, cx, cy, size, o): an auspicious object cut from paper — 'lantern', 'fu' (the 福 diamond, o.flip
   *  hangs it upside down: 福到了), 'coin', 'peach' (longevity), 'plum' (blossom), 'cloud' (祥云), 'knot' (中国结),
   *  'gourd', 'firecracker' (a string), 'lotus', 'sun', 'moon', 'dumpling', 'mooncake', 'ingot' (元宝), 'house', 'tree',
   *  'boat' (dragon boat), 'drum', 'candle', 'flowerpot'. size = the larger side in px (120–600). o: { color: 'red'|'gold'|
   *  'pale'|'cream'|'deep', at, enter: 'paste'|'cut'|'drop'|'unfold', sway: deg (hanging things swing from the top), bob,
   *  move, rot, flip (upside down), out }. Returns { end, hide }. */
  B.motif = function (kind, cx, cy, size = 240, o = {}) {
    const p = motifPiece(kind, size, paperCol(o.color || 'red'));
    const oo = Object.assign({}, o, { rot: (o.rot ?? 0) + (o.flip ? 180 : 0), flip: false });
    if (o.sway) oo.pivot = [0, p.y0 + 20];
    return place(this, p, cx, cy, oo);
  };
  /** cutout(pts, o): ANY object the kit lacks, as a red paper silhouette: pts is its outline [[x, y], …] in stage px
   *  (smoothed; o.sharp keeps corners for buildings and tools). The kit cuts folk patterns into it: o.cuts 'crescent'
   *  (scales / quilting, default), 'saw' (sawtooth rows), 'swirl', 'plum', 'none'; o.holes [[x, y, r], …] extra round holes
   *  (windows, eyes). o: { color, inset: true (the 阴刻 double contour), at, enter: 'cut'|'paste'|'drop'|'unfold', sway,
   *  bob, move, out }. */
  B.cutout = function (pts, o = {}) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, loc = pts.map(([x, y]) => [x - cx, y - cy]), w = x1 - x0, h = y1 - y0, m = Math.min(w, h);
    const outl = wob(o.sharp ? along(loc.concat([loc[0]]), 4).map((q) => [q.x, q.y]) : smooth(loc, true, 3), 0.8, 5);
    const p = piece([-w / 2, -h / 2, w / 2, h / 2], (g) => {
      fillPoly(g, outl);
      const kind = o.cuts ?? 'crescent', clip = (fn) => { g.save(); g.beginPath(); trace(g, outl); g.clip(); fn(); g.restore(); };
      if (o.inset !== false) inset(g, (q) => trace(q, outl), Math.max(3, m * 0.02), Math.max(1.5, m * 0.01));
      const pad = Math.max(14, m * 0.12);
      clip(() => {
        g.save(); g.beginPath(); trace(g, outl.map(([x, y]) => [x * (1 - pad * 2 / w), y * (1 - pad * 2 / h)])); g.clip();
        if (kind === 'crescent') crescentRows(g, -w / 2, -h / 2 + pad, w / 2, h / 2 - pad, Math.max(9, m * 0.07), Math.max(3, m * 0.022));
        else if (kind === 'saw') for (let y = -h / 2 + pad * 1.5; y < h / 2 - pad; y += Math.max(26, m * 0.18)) sawRow(g, [[-w / 2, y], [w / 2, y]], Math.max(8, m * 0.05), Math.max(6, m * 0.035), 1);
        else if (kind === 'swirl') { const st = Math.max(60, m * 0.4); for (let y = -h / 2 + st / 2; y < h / 2; y += st) for (let x = -w / 2 + st / 2; x < w / 2; x += st) swirl(g, x, y, st * 0.3, 1.6, Math.max(3, st * 0.06), 0, 1); }
        else if (kind === 'plum') { const st = Math.max(50, m * 0.3); for (let y = -h / 2 + st / 2; y < h / 2; y += st) for (let x = -w / 2 + st / 2; x < w / 2; x += st) plum(g, x, y, st * 0.22); }
        g.restore();
      });
      for (const [hx, hy, hr] of o.holes || []) cutCircle(g, hx - cx, hy - cy, hr);
    }, { color: paperCol(o.color || 'red'), seed: (cx + cy) | 0 });
    return place(this, p, cx, cy, o);
  };

  // ══════════════════════════════ words ══════════════════════════════
  let mctx; const measure = (str, font) => { mctx = mctx || cv(4, 4).getContext('2d'); mctx.font = font; return mctx.measureText(str).width; };
  const isHan = (s) => /\p{Script=Han}/u.test(s);
  /** banner(str, x, y, o): a strip of red paper with gold characters, swallow-tailed ends and sawtooth trim — the way
   *  to put a name, a date, a label or the page's key sentence on screen (横批). (x, y) = top-left. o: { size (font px,
   *  default 48; labels ≥ 34), color: 'deep' (default)|'red'|'gold' (gold strip, red text), text color, vertical: true (a
   *  couplet column 春联 read top to bottom; x, y = top centre), at, enter: 'paste'|'drop'|'cut', out }. Returns { w, h, end, hide }. */
  B.banner = function (str, x, y, o = {}) {
    const sz = o.size ?? 48, vert = !!o.vertical, han = isHan(str);
    const font = han ? HAN(900, sz) : SERIF(800, sz), strip = paperCol(o.color || 'deep'), tcol = o.color === 'gold' ? PAPER.deep : (o.text ? paperCol(o.text) : '#F7DB92');
    const chars = [...str], tw = vert ? sz * 1.12 * chars.length : measure(str, font) + (han ? sz * 0.1 * chars.length : 0);
    const thick = sz * 1.7, tail = sz * 0.55, pad = sz * 0.75;
    const w = vert ? thick : tw + pad * 2 + tail * 2, h = vert ? tw + pad * 2 + tail * 2 : thick;
    const p = piece([-w / 2, -h / 2, w / 2, h / 2], (g) => {
      if (vert) g.rotate(Math.PI / 2);
      const L = vert ? h : w, T = thick;
      fillPoly(g, [[-L / 2, -T / 2], [L / 2, -T / 2], [L / 2 - tail, 0], [L / 2, T / 2], [-L / 2, T / 2], [-L / 2 + tail, 0]], strip);
      const tooth = Math.max(4, sz * 0.09);
      sawRow(g, [[-L / 2 + tail + 4, -T / 2 + tooth * 1.6], [L / 2 - tail - 4, -T / 2 + tooth * 1.6]], tooth, tooth * 0.9, 1);
      sawRow(g, [[-L / 2 + tail + 4, T / 2 - tooth * 1.6], [L / 2 - tail - 4, T / 2 - tooth * 1.6]], tooth, tooth * 0.9, -1);
      if (vert) g.rotate(-Math.PI / 2);
      g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = tcol; g.font = font; g.textBaseline = 'middle';
      if (vert) { g.textAlign = 'center'; chars.forEach((ch, i) => g.fillText(ch, 0, -tw / 2 + sz * 1.12 * (i + 0.5) + sz * 0.04)); }
      else { g.textAlign = 'center'; if (han) { const st = tw / chars.length; chars.forEach((ch, i) => g.fillText(ch, -tw / 2 + st * (i + 0.5), sz * 0.05)); } else g.fillText(str, 0, sz * 0.06); }
      g.restore();
    }, { color: strip, seed: (x + y) | 0, light: 'rgba(255,190,160,.4)' });
    // a banner never leaves the frame: it is slid back inside x 60–1860, y 40–880
    if (!vert) x = clamp(x, 60, Math.max(60, W - 60 - w)); else x = clamp(x, 60 + w / 2, W - 60 - w / 2);
    y = clamp(y, 40, Math.max(40, STAGE.area.y1 - h));
    const cx = vert ? x : x + w / 2, cy = vert ? y + h / 2 : y + h / 2;
    const hnd = place(this, p, cx, cy, Object.assign({ dur: 0.3 }, o));
    return Object.assign(hnd, { w, h });
  };
  /** word(str, cx, cy, o): one to four big characters (or a short Latin word) cut out of red paper — the one word a page
   *  is about (福, 春, 年, 团圆, LUCK). card: 'diamond' (the character cut THROUGH a red 斗方 diamond, yin-cut, like the 福
   *  on a door), 'square', 'circle', or none (yang-cut: the letters themselves are paper). Letters arrive one by one on
   *  twos. o: { size (px per character, 120–360), card, color, font: 'serif' (default) | 'brush' (Ma Shan Zheng), flip
   *  (upside down), gap, at, stagger (s between characters, default 0.25), enter, glow: t (light behind the holes), out }. */
  B.word = function (str, cx, cy, o = {}) {
    const sz = o.size ?? 220, chars = [...str], han = isHan(str), colr = paperCol(o.color || 'red');
    const font = o.font === 'brush' ? BRUSH(sz * 0.86) : han ? HAN(900, sz * (o.card ? 0.72 : 0.92)) : SERIF(800, sz * 0.9);
    const units = han || o.card ? chars : [str];
    const stepX = han || o.card ? sz * (o.card === 'diamond' ? 1.45 : 1.12) + (o.gap ?? 0) : 0;
    const total = han || o.card ? stepX * (units.length - 1) : 0, at = o.at ?? 0, stg = o.stagger ?? 0.25;
    const hs = units.map((ch, i) => {
      const cw = han || o.card ? sz : measure(ch, font) + sz * 0.2, ch2 = sz * 1.05;
      const p = piece([-cw / 2 - (o.card === 'diamond' ? sz * 0.22 : 0), -ch2 / 2 - (o.card === 'diamond' ? sz * 0.22 : 0), cw / 2 + (o.card === 'diamond' ? sz * 0.22 : 0), ch2 / 2 + (o.card === 'diamond' ? sz * 0.22 : 0)], (g) => {
        const card = o.card;
        if (card) {
          const d = card === 'diamond' ? [[0, -sz * 0.72], [sz * 0.72, 0], [0, sz * 0.72], [-sz * 0.72, 0]] : null;
          if (d) fillPoly(g, d); else if (card === 'circle') fillEll(g, 0, 0, sz * 0.52, sz * 0.52); else fillPoly(g, [[-sz * 0.5, -sz * 0.5], [sz * 0.5, -sz * 0.5], [sz * 0.5, sz * 0.5], [-sz * 0.5, sz * 0.5]]);
          inset(g, (q) => (d ? trace(q, d) : card === 'circle' ? q.arc(0, 0, sz * 0.52, 0, TAU) : q.rect(-sz * 0.5, -sz * 0.5, sz, sz)), sz * 0.025, sz * 0.012);
          g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, sz * 0.04); g.restore();
          if (d) for (const [x, y] of [[0, -sz * 0.56], [sz * 0.56, 0], [0, sz * 0.56], [-sz * 0.56, 0]]) plum(g, x, y, sz * 0.06);
        } else {
          g.fillStyle = colr; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, sz * 0.04);
        }
      }, { color: colr, seed: i * 7 + 3, edge: 2 });
      const x = cx - total / 2 + i * stepX;
      return place(this, p, x, cy, Object.assign({}, o, { at: at + i * stg, rot: (o.rot ?? 0) + (o.flip ? 180 : 0), flip: false, sway: o.sway }));
    });
    return { end: at + (units.length - 1) * stg + 0.3, w: total + sz, hide(t, d) { hs.forEach((x) => x.hide(t, d)); return this; } };
  };

  // ══════════════════════════════ groups and events ══════════════════════════════
  /** strip(kind, n, x, footY, unitW, o): a folded paper chain — n copies of one figure or motif cut from a single folded
   *  strip, joined at the hands, opening out one panel at a time from the left (a count you can see: 5 generations, 12
   *  months, 8 guests). kind is a figure kind ('child', 'girl', 'woman', 'elder'…) or a motif kind ('lantern', 'fu',
   *  'plum'…) or an animal kind. unitW = width of one panel (px). o: { color, pose, at, every (s per panel, default 0.3),
   *  size (height, default unitW × 1.6), out }. Returns { end, hide }. */
  B.strip = function (kind, n, x, footY, unitW, o = {}) {
    const hgt = o.size ?? unitW * 1.6, colr = paperCol(o.color || 'red');
    const isFig = ['child', 'girl', 'boy', 'woman', 'man', 'elder'].includes(kind), isAnimal = !!U[kind];
    const unit = piece([-unitW / 2, -hgt, unitW / 2, 0], (g) => {
      if (isFig) { g.save(); g.translate(0, 0); g.scale(hgt * 0.98, hgt * 0.98); drawFigure(g, kind, o.pose || 'dance'); g.restore(); fillPoly(g, [[-unitW / 2 - 1, -hgt * 0.62], [unitW / 2 + 1, -hgt * 0.62], [unitW / 2 + 1, -hgt * 0.58], [-unitW / 2 - 1, -hgt * 0.58]]); }
      else {
        const fn = isAnimal ? U[kind] : M[kind] || M.plum, probe = cv(1, 1).getContext('2d'); const bx = fn(new Proxy(probe, { get: (t, k) => (typeof t[k] === 'function' ? () => {} : t[k]), set: () => true }));
        const s = Math.min((unitW * 0.92) / (bx[2] - bx[0]), (hgt * 0.8) / (bx[3] - bx[1]));
        g.save(); g.translate(0, -hgt * 0.5 - (bx[1] + bx[3]) / 2 * s); g.scale(s, s); fn(g); g.restore();
        fillPoly(g, [[-unitW / 2 - 1, -hgt * 0.08], [unitW / 2 + 1, -hgt * 0.08], [unitW / 2 + 1, 0], [-unitW / 2 - 1, 0]]); sawRow(g, [[-unitW / 2, -hgt * 0.04], [unitW / 2, -hgt * 0.04]], hgt * 0.025, hgt * 0.025, 1);
      }
    }, { color: colr, seed: 9 });
    const at = o.at ?? 0, every = o.every ?? 0.3, W2 = unitW * n;
    const h = mount(this, x - 30, footY - hgt - 40, W2 + 60, hgt + 80, o, (lt) => (lt < at ? 'pre' : lt > at + every * n + 0.4 ? 'still' : step(lt, 24)), (g, lt) => {
      const ls = step(lt, 24); if (ls < at) return;
      for (let i = 0; i < n; i++) {
        const t0 = at + i * every, u = clamp((ls - t0) / every); if (u <= 0 && i > 0) break;
        const ux = x + unitW * (i + 0.5);
        if (i === 0 || u >= 1) { g.save(); g.translate(ux, footY); put(g, unit); g.restore(); continue; }
        const s = -Math.cos(Math.PI * ease.out(u)), hinge = x + unitW * i;
        g.save(); g.translate(hinge, footY); g.scale(s, 1); g.translate(unitW / 2, 0); put(g, unit, s < 0 ? backOf(unit) : unit.c);
        g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(40,0,8,${(0.4 * (1 - Math.abs(s))).toFixed(3)})`; g.fillRect(-unitW, -hgt - 20, unitW * 2, hgt + 40); g.restore();
      }
    });
    return Object.assign(h, { end: at + every * n });
  };
  /** wheel(items, cx, cy, r, o): a paper calendar wheel — n wedges round a small window flower, each wedge carrying one
   *  item (an animal or motif kind, or a short label) in gold paper; the wheel turns on twos to bring item i to the top,
   *  where it is lifted and lit. For cycles: the twelve zodiac animals, the four seasons, the 24 solar terms by season, the
   *  festivals of a year. items: [{ kind, label }] or kind strings. o: { at, turn: [[t, i], …] (keyframes: at t turn item i
   *  to the top), labels: true (small labels under each item), color, out }. r 260–440. */
  B.wheel = function (items, cx, cy, r, o = {}) {
    const its = items.map((it) => (typeof it === 'string' ? { kind: it } : it)), n = its.length, A = TAU / n, at = o.at ?? 0;
    const base = piece([-r, -r, r, r], (g) => {
      const e = []; for (let i = 0; i <= 360; i++) { const a = i / 360 * TAU, rr = r * (0.96 + 0.04 * Math.abs(Math.cos(a * n / 2))); e.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      fillPoly(g, e);
      for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + k * A + A / 2; cutTaper(g, [[Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36], [Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66], [Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93]], r * 0.018); }
      sawRow(g, ellPts(0, 0, r * 0.9, r * 0.9, 0, 120), r * 0.025, r * 0.018, 1); sawRow(g, ellPts(0, 0, r * 0.37, r * 0.37, 0, 80), r * 0.03, r * 0.02, -1);
      cutCircle(g, 0, 0, r * 0.33);
    }, { color: paperCol(o.color || 'deep'), seed: 4 });
    const hubR = r * 0.3;
    this.flower(cx, cy, hubR, { at, enter: 'paste', seed: o.seed ?? 5, fold: 8, color: 'red' });
    const isz = r * (n > 8 ? 0.34 : 0.42);
    const icons = its.map((it) => (it.kind && (U[it.kind] || M[it.kind]) ? (U[it.kind] ? animalPiece(it.kind, isz * 1.15, PAPER.gold, 3) : motifPiece(it.kind, isz * 0.8, PAPER.gold)) : null));
    const turns = (o.turn || []).slice().sort((a, b) => a[0] - b[0]);
    const angleAt = (lt) => { let idx = 0, from = 0, t0 = -1; for (const [t, i] of turns) { if (lt >= t) { from = idx; idx = i; t0 = t; } } const k = t0 < 0 ? 1 : ease.out(clamp((step(lt) - t0) / 0.8)); let d = idx - from; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return { rot: -(from + d * k) * A, cur: idx, k }; };
    const ext = r + 120, self = this;
    const h = mount(this, cx - ext, cy - ext, ext * 2, ext * 2, o, (lt) => (lt < at ? 'pre' : step(lt)), (g, lt) => {
      if (lt < at) return; const { rot, cur, k } = angleAt(lt), ls = step(lt);
      g.save(); g.translate(cx, cy); g.rotate(rot); put(g, base);
      its.forEach((it, i) => {
        const a = -Math.PI / 2 + i * A + A / 2 - A / 2 + A / 2, ra = r * 0.64;
        const aa = -Math.PI / 2 + i * A;
        const on = i === cur && turns.length > 0 && k >= 1, sc = on ? 1.18 : 1;
        g.save(); g.rotate(aa + Math.PI / 2); g.translate(0, -ra); g.rotate(-(aa + Math.PI / 2) - rot);
        if (icons[i]) { g.scale(sc, sc); put(g, icons[i]); }
        if (it.label && o.labels !== false) { g.fillStyle = '#F7DB92'; g.font = (isHan(it.label) ? HAN(900, r * 0.075) : SERIF(800, r * 0.07)); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.label, 0, icons[i] ? isz * 0.55 * sc : 0); }
        g.restore();
      });
      g.restore();
      if (turns.length) { g.save(); g.translate(cx, cy - r - 18); g.fillStyle = PAPER.gold; g.beginPath(); g.moveTo(-22, -26); g.lineTo(22, -26); g.lineTo(0, 10); g.closePath(); g.fill(); g.restore(); }
    });
    return Object.assign(h, { end: at + 0.3 });
  };
  /** lanterns(x1, x2, y, n, o): a cord of n red lanterns strung across the top of the frame, swaying on twos; o.lit: t
   *  lights them (a warm pool of light round each). o: { at (they drop in one by one), size (default 120), color, out }. */
  B.lanterns = function (x1, x2, y, n, o = {}) {
    const sz = o.size ?? 120, at = o.at ?? 0, colr = o.color || 'red';
    if (o.lit != null) for (let i = 0; i < n; i++) { const x = x1 + (x2 - x1) * (n === 1 ? 0.5 : i / (n - 1)), yy = y + Math.sin(Math.PI * (n === 1 ? 0.5 : i / (n - 1))) * 40 + sz * 0.75; this.glow(x, yy, sz * 1.5, { at: o.lit + i * 0.08, out: o.out }); }
    const p = motifPiece('lantern', sz, paperCol(colr));
    mount(this, x1 - 40, y - 20, x2 - x1 + 80, 80, o, (lt) => (lt < at ? 'pre' : 'c'), (g) => { g.strokeStyle = '#2A2C3A'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1 - 40, y); g.quadraticCurveTo((x1 + x2) / 2, y + 80, x2 + 40, y); g.stroke(); });
    const hs = [];
    for (let i = 0; i < n; i++) {
      const q = n === 1 ? 0.5 : i / (n - 1), x = x1 + (x2 - x1) * q, yy = y + Math.sin(Math.PI * q) * 40 + sz * 0.62;
      hs.push(place(this, p, x, yy, { at: at + i * 0.12, enter: 'drop', sway: o.sway ?? 4, phase: i * 0.9, pivot: [0, p.y0 + 20], out: o.out }));
    }
    return { end: at + n * 0.12 + 0.3, hide(t, d) { hs.forEach((x) => x.hide(t, d)); return this; } };
  };
  /** glow(cx, cy, r, o): warm light (screened onto everything under it) — a lit window, a candle, a lantern's pool,
   *  sunrise on paper. o: { at, color (default warm gold), strength (0..1, default 0.7), flicker: true, out }. */
  B.glow = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0;
    return mount(this, cx - r, cy - r, r * 2, r * 2, o, (lt) => (lt < at ? 'off' : o.flicker !== false ? step(lt) : clamp((step(lt) - at) / 0.5)), (g, lt) => {
      const k = clamp((step(lt) - at) / 0.5) * (o.strength ?? 0.7) * (o.flicker !== false ? 0.9 + 0.1 * Math.sin(step(lt) * 7 + cx) : 1);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(255,210,120,${k.toFixed(3)})`); gr.addColorStop(0.45, `rgba(245,140,50,${(k * 0.35).toFixed(3)})`); gr.addColorStop(1, 'rgba(200,60,20,0)');
      g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }, 0.5, 'pc-light');
  };
  /** fireworks(list, o): small window flowers bursting open in the sky — symmetry multiplying, a celebration, an idea
   *  spreading. list: [[x, y, r, t], …] (r 50–160, t = burst time). Each snaps open in three steps, hangs, then drifts down
   *  and fades as gold and red scraps. o: { colors (cycled, default ['gold','red','pale']), out }. */
  B.fireworks = function (list, o = {}) {
    const cols = o.colors || ['gold', 'red', 'pale'];
    list.forEach(([x, y, r, t], i) => {
      const p = (() => { let P = null; return () => P || (P = piece([-r, -r, r, r], (g) => drawFlower(g, r, 8, 30 + i * 7, null), { color: paperCol(cols[i % cols.length]), K: 1, seed: i })); })();
      const ext = r * 1.3 + 260;
      mount(this, x - ext, y - ext, ext * 2, ext * 2 + 200, o, (lt) => (lt < t || lt > t + 3.2 ? 'off' : step(lt, 24)), (g, lt) => {
        const ls = step(lt, 24), u = ls - t; if (u < 0 || u > 3.2) return;
        const sc = u < 0.25 ? [0.25, 0.6, 1.08][Math.min(2, Math.floor(u / 0.0834))] : 1, fall = Math.max(0, u - 1.3) * 60, a = 1 - clamp((u - 2.4) / 0.8);
        g.save(); g.globalAlpha = a; g.translate(x, y + fall); g.rotate(u * 0.4); g.scale(sc, sc); put(g, p()); g.restore();
        const rr = PV.rng(i * 31 + 7);
        for (let k = 0; k < 14; k++) { const an = rr() * TAU, sp = 120 + rr() * 220, d = Math.min(u, 1.2) * sp, sx = x + Math.cos(an) * (r * 0.6 + d), sy = y + Math.sin(an) * (r * 0.6 + d) + 120 * Math.max(0, u - 0.4) ** 2; g.save(); g.globalAlpha = a * 0.9; g.translate(sx, sy); g.rotate(an + u * 5); g.fillStyle = k % 2 ? PAPER.gold : PAPER.red; g.fillRect(-6, -3, 12, 6); g.restore(); }
      });
    });
    return { end: Math.max(...list.map((l) => l[3])) + 1 };
  };
  /** scissors(pts, o): the scissors themselves cutting along a line across the frame: a slit of light opens behind the
   *  blades and scraps drop — to start a film, to divide the frame (before | after), or to point at what is cut next.
   *  pts: [[x, y], …] the path (smoothed). o: { at, dur (default 1.4), size (blade length px, default 150), slit: false
   *  hides the lit slit, out }. Returns { end }. */
  B.scissors = function (pts, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.4, P = smooth(pts, false, 4), S = along(P, 6), L = o.size ?? 150;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const ext = L + 60, rr = PV.rng((x0 + y1) | 0), scr = [];
    for (let i = 0; i < 8; i++) { const q = (i + 0.5) / 8, s = S[Math.floor(q * (S.length - 1))]; scr.push({ t: at + q * dur, x: s.x, y: s.y, vx: (rr() - 0.5) * 70, r: 6 + rr() * 8, ph: rr() * 6, spin: (rr() - 0.5) * 8 }); }
    mount(this, x0 - ext, y0 - ext, x1 - x0 + ext * 2, y1 - y0 + ext * 2 + 260, o, (lt) => (lt < at ? 'pre' : lt > at + dur + 1.8 ? 'still' : step(lt, 24)), (g, lt) => {
      const ls = step(lt, 24); if (ls < at) return;
      const u = clamp((ls - at) / dur), m = Math.max(1, Math.floor(u * (S.length - 1)));
      if (o.slit !== false) { g.save(); g.strokeStyle = '#FFE7AE'; g.lineWidth = 3; g.shadowColor = 'rgba(255,190,90,.9)'; g.shadowBlur = 14; g.beginPath(); g.moveTo(S[0].x, S[0].y); for (let i = 1; i <= m; i++) g.lineTo(S[i].x, S[i].y); g.stroke(); g.restore(); }
      scrapsFrom(g, scr, ls);
      if (u < 1) { const a = S[m], b = S[Math.max(0, m - 3)]; scissors(g, a.x, a.y, Math.atan2(a.y - b.y, a.x - b.x), snipOpen(lt), L); }
    }, RES);
    return { end: at + dur };
  };
  /** scraps(o): paper scraps falling through the whole frame — 'confetti' (red and gold bits, celebration), 'snow' (punched
   *  white dots), 'petals' (plum petals). o: { kind, at, count (default 60), out }. */
  B.scraps = function (o = {}) {
    const at = o.at ?? 0, N = o.count ?? 60, kind = o.kind || 'confetti', rr = PV.rng(N * 13 + kind.length), fl = [];
    for (let i = 0; i < N; i++) fl.push({ x: rr() * W, y: -rr() * H * 1.2, v: 90 + rr() * 120, r: 5 + rr() * 8, ph: rr() * 6, c: i % 3 });
    return mount(this, 0, 0, W, H, o, (lt) => (lt < at ? 'pre' : step(lt, 24)), (g, lt) => {
      const t = step(lt, 24) - at; if (t < 0) return;
      for (const f of fl) {
        const y = f.y + f.v * t; if (y > H + 20 || y < -20) continue; const x = f.x + Math.sin(t * 1.5 + f.ph) * 30;
        g.save(); g.translate(x, y); g.rotate(t * 3 + f.ph);
        if (kind === 'snow') { g.fillStyle = '#EFE8D8'; g.beginPath(); g.arc(0, 0, f.r * 0.6, 0, TAU); g.fill(); }
        else if (kind === 'petals') { g.fillStyle = f.c ? '#EE8E92' : '#F3E2BC'; g.beginPath(); g.ellipse(0, 0, f.r, f.r * 0.6, 0, 0, TAU); g.fill(); }
        else { g.fillStyle = f.c === 0 ? PAPER.gold : PAPER.red; g.fillRect(-f.r, -f.r * 0.45, f.r * 2, f.r * 0.9); }
        g.restore();
      }
    }, 1);
  };

  // the page title: a deep-red paper banner with gold characters, pasted top left
  B.title = function (str, o = {}) {
    const T = this.hud || this;
    return T.banner(str, STAGE.title.x - 20, STAGE.title.y - 32, { at: o.at ?? 0.15, size: o.size ?? 44, color: o.accent === 'gold' ? 'gold' : 'deep' });
  };
})();
