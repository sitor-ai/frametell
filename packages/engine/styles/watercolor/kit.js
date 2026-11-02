/* Watercolor · wash-and-pencil kit: transparent washes that spread from where the brush touched and dry with a darker
 * pooled edge, wet-in-wet colour bleeding into colour, pigment granulating in the paper's tooth, a loose graphite
 * underdrawing that stays visible, painted lettering, skies, hills, trees, water, figures, a flick of spatter.
 * Everything is canvas multiplied onto the paper, so a wash over a wash glazes darker the way real watercolour does.
 * Every component is a pure function of page-local time lt. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const rgbOf = (c) => { const h = String(col(c || 'blue')).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a).toFixed(3)})`;
  const darker = (c, k = 0.62) => c.map((v) => Math.round(v * k));

  // ── noise (value-gradient 2D, about [-1, 1]) ──
  const perm = new Uint8Array(512);
  { const r = PV.rng(4242); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { const u = h & 1 ? x : -x, v = h & 2 ? y : -y; return h & 4 ? u + v * 0.5 : u * 0.5 + v; };
  const noise = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  };
  const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2; } return s; };

  // ── shapes ──
  /** a closed polygon, resampled every `step` px and pushed in/out by noise: the loose edge of a wash */
  function wobble(pts, seed, amt = 9, step = 7) {
    const out = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / step));
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    const m = out.length, res = [];
    for (let i = 0; i < m; i++) {
      const p = out[i], q = out[(i + 1) % m], o = out[(i - 1 + m) % m];
      let nx = q[1] - o[1], ny = o[0] - q[0]; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
      const w = fbm(p[0] * 0.012 + seed, p[1] * 0.012 - seed, 3) * amt + noise(p[0] * 0.08 + seed * 3, p[1] * 0.08) * amt * 0.25;
      res.push([p[0] + nx * w, p[1] + ny * w]);
    }
    return res;
  }
  const toPath = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };
  /** an irregular round blob (a drop, a crown of leaves, a sun) as polygon points */
  function blobPts(cx, cy, rx, ry, seed, wob = 0.16, n = 56) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + wob * fbm(Math.cos(a) * 1.2 + seed, Math.sin(a) * 1.2 + seed * 0.7, 3) * 1.8;
      out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return out;
  }
  const bbox = (pts, pad) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 - x0 + pad * 2), Math.ceil(y1 - y0 + pad * 2)];
  };
  const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

  // ── granulation: pigment settling into the paper's tooth, one tile per colour ──
  const grainCache = {};
  function grainTile(rgb) {
    const key = rgb.join();
    if (grainCache[key]) return grainCache[key];
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d'), r = PV.rng(77), d = darker(rgb, 0.55);
    for (let i = 0; i < 1500; i++) {
      const x = r() * 256, y = r() * 256, s = 0.5 + r() * 1.6, cl = noise(x * 0.05, y * 0.05) * 0.5 + 0.5;
      g.fillStyle = rgba(d, (0.08 + r() * 0.22) * (0.3 + cl)); g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    return (grainCache[key] = cv);
  }

  /**
   * paint one wash into c, clipped to polygon `shape`:
   * body (uneven pigment), wet-in-wet bleed, granulation, a dark pooled rim (stronger as it dries), lifted blooms.
   * reveal: radius of the wet front from `from` (Infinity = all). dry 0..1.
   */
  function paint(c, shape, o) {
    const { rgb, tone = 0.55, rim = 1, grain = 0.5, bleed, bleedAt, bleedR, dry = 1, seed = 1, front, fadeY, fadeX } = o;
    const path = toPath(shape);
    c.save();
    c.clip(path);
    if (front) c.clip(toPath(front));
    const [x, y, w, h] = bbox(shape, 0), r = PV.rng(seed * 131 + 7);
    const wet = 1 - dry, bloom = o.bloom ?? (Math.min(w, h) > 170 ? 1 : 0);   // a big wash gets one backrun by default
    // body: a flat transparent layer, then a few soft pools of extra pigment
    c.filter = `blur(${(0.8 + wet * 2).toFixed(1)}px)`;
    c.fillStyle = rgba(rgb, tone * (0.5 + 0.08 * wet)); c.fill(path);
    c.filter = `blur(${Math.max(14, Math.min(w, h) * 0.16).toFixed(0)}px)`;
    for (let i = 0; i < 5; i++) {
      c.fillStyle = rgba(rgb, tone * (0.18 + r() * 0.24));
      c.beginPath(); c.ellipse(x + w * (0.15 + r() * 0.7), y + h * (0.2 + r() * 0.7), w * (0.18 + r() * 0.22), h * (0.18 + r() * 0.24), r() * 3, 0, Math.PI * 2); c.fill();
    }
    // wet-in-wet: a second colour flowing in from one side and feathering out
    if (bleed) {
      const [bx, by] = bleedAt || [x + w * 0.8, y + h * 0.25], br = bleedR || Math.max(w, h) * 0.6;
      const g = c.createRadialGradient(bx, by, 0, bx, by, br), b = rgbOf(bleed);
      g.addColorStop(0, rgba(b, tone * 0.7)); g.addColorStop(0.55, rgba(b, tone * 0.32)); g.addColorStop(1, rgba(b, 0));
      c.filter = 'blur(6px)'; c.fillStyle = g; c.fill(path);
    }
    // granulation in the tooth
    if (grain > 0) {
      c.filter = 'none'; c.globalAlpha = clamp(grain * tone * 1.3);
      const pat = c.createPattern(grainTile(rgb), 'repeat'); pat.setTransform?.(new DOMMatrix().translate(seed * 37 % 256, seed * 53 % 256));
      c.fillStyle = pat; c.fill(path); c.globalAlpha = 1;
    }
    // blooms (backruns): paler cauliflower patches with a dark lacy edge, where water crept back into drying paint
    for (let i = 0; i < bloom; i++) {
      const bp = blobPts(x + w * (0.25 + r() * 0.5), y + h * (0.25 + r() * 0.5), Math.min(w, h) * (0.08 + r() * 0.08), Math.min(w, h) * (0.06 + r() * 0.07), seed + i * 9, 0.35, 40);
      c.filter = 'blur(2px)';
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = `rgba(0,0,0,${(0.16 * dry).toFixed(2)})`; c.fill(toPath(bp));
      c.globalCompositeOperation = 'source-over'; c.lineWidth = 1.6; c.strokeStyle = rgba(darker(rgb, 0.7), tone * 0.35 * dry); c.stroke(toPath(bp));
    }
    // the pooled edge: pigment carried to the rim as the water evaporates (only the inner half shows: we are clipped)
    if (rim > 0) {
      c.filter = `blur(${(1.2 + wet * 3).toFixed(1)}px)`;
      c.lineWidth = 8 * rim; c.strokeStyle = rgba(darker(rgb, 0.68), tone * (0.3 + 0.6 * dry) * rim); c.stroke(path);
      c.filter = 'blur(0.6px)'; c.lineWidth = 2.2 * rim; c.strokeStyle = rgba(darker(rgb, 0.6), tone * (0.15 + 0.6 * dry) * rim); c.stroke(path);
    }
    // the wash thinning out into white paper (a vignette): below fadeY[0] it fades to nothing at fadeY[1]; fadeX
    // [left, right] softens both ends over ~260 px
    if (fadeY || fadeX) {
      c.filter = 'none'; c.globalCompositeOperation = 'destination-out';
      if (fadeY) { const g = c.createLinearGradient(0, fadeY[0], 0, fadeY[1]); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = g; c.fillRect(x - 40, fadeY[0], w + 80, Math.max(fadeY[1], y + h) - fadeY[0] + 80); }
      if (fadeX) {
        const [l, rr] = fadeX, L = 260;
        let g = c.createLinearGradient(l, 0, l + L, 0); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - 40, y - 40, l + L - x + 40, h + 80);
        g = c.createLinearGradient(rr - L, 0, rr, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = g; c.fillRect(rr - L, y - 40, x + w - rr + L + 40, h + 80);
      }
    }
    c.restore();
  }

  // ── mounting: one canvas per component, multiplied onto the paper; fades out at hide(t) / o.out ──
  function mount(self, x, y, w, h, o, draw, blend = 'multiply') {
    const cv = PV.h('canvas', 'wc-cv', null, self.html);
    cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h));
    Object.assign(cv.style, { position: 'absolute', left: x + 'px', top: y + 'px', mixBlendMode: blend, pointerEvents: 'none' });
    const ctx = cv.getContext('2d');
    const st = { out: o.out, outDur: o.outDur ?? 0.6 };
    let last = '';
    self.tick((lt) => {
      const op = (st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1) * val(o.op, lt, 1);
      cv.style.opacity = op.toFixed(3);
      if (op <= 0.001) return;
      const key = draw.key ? draw.key(lt) : null;
      if (key != null && key === last) return;
      last = key;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save(); ctx.translate(-x, -y); draw(ctx, lt); ctx.restore();
    });
    return { el: cv, hide(t, d = 0.6) { st.out = t; st.outDur = d; return this; } };
  }
  const group = (hs) => ({ parts: hs, hide(t, d = 0.6) { hs.forEach((q) => q && q.hide && q.hide(t, d)); return this; } });
  let seedN = 1;

  // a wash's life: the wet front spreads from `from` over dur, then the paint dries (rim darkens) over the next 0.9 s
  function washTiming(shape, o) {
    const at = o.at ?? 0, dur = o.dur ?? 1.1, from = o.from || centroid(shape);
    const R = Math.max(...shape.map(([px, py]) => Math.hypot(px - from[0], py - from[1]))) * 1.18 + 20;
    const seed = o.seed ?? seedN++;
    const spread = (lt) => ease.out(clamp((lt - at) / dur));
    const dry = (lt) => ss(at + dur * 0.6, at + dur + 0.9, lt);
    const front = (lt) => { const e = spread(lt); return e >= 1 ? null : blobPts(from[0], from[1], R * e + 4, R * e + 4, seed + 0.3, 0.28, 48); };
    return { at, dur, seed, spread, dry, front };
  }

  /** wash(pts, o): a transparent watercolour wash filling polygon pts [[x,y],…]. It spreads outward from where the brush
   *  touched (o.from, default its centre) and then dries, the pigment pooling into a darker edge; colour granulates in
   *  the paper. The basic mark of the style: a field, a lake, a roof, a coat, a country on a map, the colour behind a
   *  word. Washes overlap and glaze darker. o: { at, dur (1.1), color ('blue'), tone (0.55: 0.3 pale … 0.85 rich),
   *  bleed (a second colour flowing in wet-in-wet, e.g. 'purple'), bleedAt [x,y], from [x,y], rim (1), grain (0.5),
   *  bloom (0: number of paler backrun blooms), wobble (9: edge looseness px), fadeY [y0, y1] (thins out into the paper
   *  between y0 and y1), fadeX [left, right] (soft ends), seed, out } */
  B.wash = function (pts, o = {}) {
    const shape = wobble(pts, (o.seed ?? seedN) * 1.7, o.wobble ?? 9);
    const tm = washTiming(shape, o), rgb = rgbOf(o.color || 'blue');
    const [x, y, w, h] = bbox(shape, 24);
    const opt = { rgb, tone: o.tone ?? 0.55, rim: o.rim ?? 1, grain: o.grain ?? 0.5, bleed: o.bleed, bleedAt: o.bleedAt, bleedR: o.bleedR, seed: tm.seed, bloom: o.bloom, fadeY: o.fadeY, fadeX: o.fadeX };
    const draw = (c, lt) => { if (tm.spread(lt) <= 0) return; paint(c, shape, { ...opt, dry: tm.dry(lt), front: tm.front(lt) }); };
    draw.key = (lt) => (lt < tm.at ? 'pre' : `${tm.spread(lt).toFixed(3)}:${tm.dry(lt).toFixed(2)}`);
    return mount(this, x, y, w, h, o, draw);
  };

  /** blot(cx, cy, r, o): a round wash — a sun, a moon, an apple, a planet, a tree crown, a coin, a drop of colour that
   *  marks the point. Same paint as wash. o: { ...wash options, ry (r: vertical radius), wob (0.16: lumpiness) } */
  B.blot = function (cx, cy, r, o = {}) {
    const seed = o.seed ?? seedN++;
    return this.wash(blobPts(cx, cy, r, o.ry ?? r, seed, o.wob ?? 0.16), { wobble: 4, ...o, seed, from: o.from || [cx - r * 0.2, cy - r * 0.2] });
  };

  // ── pencil: the graphite underdrawing, left visible under the paint ──
  function pencilLine(c, pts, k, seed, o) {
    if (k <= 0 || pts.length < 2) return;
    const r = PV.rng(seed * 17 + 1), passes = o.passes ?? 2, jit = o.jitter ?? 1.6;
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    const g = rgbOf(o.color || 'soft');
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let p = 0; p < passes; p++) {
      const dx = (r() - 0.5) * jit * 2, dy = (r() - 0.5) * jit * 2, over = p === 0 ? 0 : 6 + r() * 10;
      c.strokeStyle = rgba(g, (o.tone ?? 0.55) * (p === 0 ? 1 : 0.55)); c.lineWidth = (o.w ?? 1.7) * (p === 0 ? 1 : 0.75);
      c.beginPath();
      let acc = 0, lim = total * k;
      // the second pass overshoots the ends a little, the way a quick hand does
      const a0 = pts[0], a1 = pts[1], L0 = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      c.moveTo(a0[0] - ((a1[0] - a0[0]) / L0) * over + dx, a0[1] - ((a1[1] - a0[1]) / L0) * over + dy);
      for (let i = 1; i < pts.length; i++) {
        const q = pts[i], pr = pts[i - 1], l = seg[i - 1];
        const wob = noise(i * 0.7 + seed + p * 9, p) * jit;
        if (acc + l <= lim) { c.lineTo(q[0] + dx + wob, q[1] + dy - wob); acc += l; }
        else { const f = (lim - acc) / l; c.lineTo(pr[0] + (q[0] - pr[0]) * f + dx, pr[1] + (q[1] - pr[1]) * f + dy); break; }
        if (i === pts.length - 1 && k >= 1 && over) { const L1 = l || 1; c.lineTo(q[0] + ((q[0] - pr[0]) / L1) * over + dx, q[1] + ((q[1] - pr[1]) / L1) * over + dy); }
      }
      c.stroke();
    }
  }
  const asLines = (p) => (Array.isArray(p[0][0]) ? p : [p]);
  const closeLine = (pts) => pts.concat([pts[0]]);

  /** pencil(lines, o): a loose graphite underdrawing that sketches itself, line after line — one polyline [[x,y],…] or a
   *  list of them. Two quick passes, ends overshooting. It stays visible under the paint: draw the object's outline
   *  first, then wash colour into it on the beat (or use paint, which does both). Also for construction lines, a
   *  horizon, arrows of thought, a leader line to a label. o: { at, dur (0.7), closed (false), tone (0.55), w (1.7),
   *  color ('soft'), passes (2), seed } */
  B.pencil = function (lines, o = {}) {
    let L = asLines(lines); if (o.closed) L = L.map(closeLine);
    const at = o.at ?? 0, dur = o.dur ?? 0.7, seed = o.seed ?? seedN++;
    const [x, y, w, h] = bbox(L.flat(), 24);
    const lens = L.map((p) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0)), tot = lens.reduce((a, b) => a + b, 0) || 1;
    const k = (lt) => ease.inOut(clamp((lt - at) / dur));
    const draw = (c, lt) => { let rem = k(lt) * tot; L.forEach((p, i) => { pencilLine(c, p, clamp(rem / (lens[i] || 1)), seed + i, o); rem -= lens[i]; }); };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x, y, w, h, o, draw);
  };

  /** paint(parts, o): the signature move — an object is pencilled in, then colour floods into it on the beat and dries.
   *  parts: one polygon [[x,y],…] or a list of { p: polygon, color, tone, bleed, bleedAt, from, line (false: no pencil
   *  for this part) }. o: { at (pencil starts), sketch (0.8: pencil time), fill (when the colour floods; default
   *  at + sketch), stagger (0.18 between parts), dur (1.0 per wash), color, tone, bleed, grain, rim, seed }.
   *  Returns { parts, hide }. Draw houses, boats, bottles, books, mountains, a cup, a map outline with it. */
  B.paint = function (parts, o = {}) {
    const list = Array.isArray(parts[0]) && typeof parts[0][0] === 'number' ? [{ p: parts }] : parts.map((q) => (Array.isArray(q) ? { p: q } : q));
    const at = o.at ?? 0, sketch = o.sketch ?? 0.8, fill = o.fill ?? at + sketch, st = o.stagger ?? 0.18, seed = o.seed ?? (seedN += list.length + 1);
    const hs = [];
    const lines = list.filter((q) => q.line !== false).map((q) => closeLine(q.p));
    if (lines.length && o.pencil !== false) hs.push(this.pencil(lines, { at, dur: sketch, tone: o.lineTone ?? 0.5, seed, out: o.out }));
    list.forEach((q, i) => hs.push(this.wash(q.p, { at: fill + i * st, dur: q.dur ?? o.dur ?? 1.0, color: q.color || o.color, tone: q.tone ?? o.tone, bleed: q.bleed ?? o.bleed, bleedAt: q.bleedAt, from: q.from, grain: o.grain, rim: o.rim, bloom: q.bloom ?? o.bloom, seed: seed + i + 1, wobble: q.wobble ?? o.wobble ?? 6, out: o.out })));
    return group(hs);
  };

  /** sky(o): a wet-in-wet sky laid in one sweep across the top of the page: colour at the top melting into a second
   *  colour lower down, soft white clouds lifted out as bare paper, ragged sides and a lower edge that thins into the
   *  white paper (it never reaches the frame's edges). The opening move of a landscape. o: { at, dur (1.6), top ('blue'),
   *  bottom ('yellow'), y (520: how far down it reaches), x0 (150), x1 (1770), tone (0.55), clouds (3), from ('left' |
   *  'right'), seed } */
  B.sky = function (o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.6, yb = o.y ?? STAGE.area.y0 + 340, tone = o.tone ?? 0.55, seed = o.seed ?? seedN++;
    const x0 = o.x0 ?? STAGE.area.x0 + 10, x1 = o.x1 ?? STAGE.area.x1 - 10, y0 = o.y0 ?? STAGE.area.y0 - 30;
    const top = rgbOf(o.top || 'blue'), bot = rgbOf(o.bottom || 'yellow'), r = PV.rng(seed * 7 + 3), fromR = o.from === 'right';
    const clouds = Array.from({ length: o.clouds ?? 3 }, (_, i) => ({ x: lerp(x0 + 200, x1 - 200, (i + 0.3 + r() * 0.4) / (o.clouds ?? 3)), y: y0 + 60 + r() * (yb - y0) * 0.35, rx: 110 + r() * 150, ry: 34 + r() * 30, s: r() * 10 }));
    const shape = [];
    for (let x = x0; x <= x1; x += 14) shape.push([x, y0 + fbm(x * 0.006 + seed, 4, 3) * 40]);
    for (let y = y0; y <= yb; y += 14) shape.push([x1 + fbm(y * 0.01 + seed, 7, 3) * 70, y]);
    for (let x = x1; x >= x0; x -= 14) shape.push([x, yb + fbm(x * 0.004 + seed, seed, 3) * 80]);
    for (let y = yb; y >= y0; y -= 14) shape.push([x0 + fbm(y * 0.01 + seed, 9, 3) * 70, y]);
    const k = (lt) => ease.inOut(clamp((lt - at) / dur)), dry = (lt) => ss(at + dur * 0.7, at + dur + 1, lt);
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      const path = toPath(shape), d = dry(lt);
      c.save();
      const fx = lerp(x0 - 200, x1 + 250, e), front = new Path2D();
      if (!fromR) { front.moveTo(x0 - 300, y0 - 200); for (let y = y0 - 200; y <= yb + 200; y += 20) front.lineTo(fx + fbm(y * 0.01 + seed, 2) * 120, y); front.lineTo(x0 - 300, yb + 200); }
      else { front.moveTo(x1 + 300, y0 - 200); for (let y = y0 - 200; y <= yb + 200; y += 20) front.lineTo(x1 + x0 - fx + fbm(y * 0.01 + seed, 2) * 120, y); front.lineTo(x1 + 300, yb + 200); }
      front.closePath(); c.clip(front); c.clip(path);
      const g = c.createLinearGradient(0, y0, 0, yb + 60);
      g.addColorStop(0, rgba(top, tone * 0.85)); g.addColorStop(0.5, rgba(top, tone * 0.45)); g.addColorStop(0.75, rgba(bot, tone * 0.4)); g.addColorStop(1, rgba(bot, tone * 0.12));
      c.filter = 'blur(4px)'; c.fillStyle = g; c.fill(path);
      c.filter = 'blur(12px)';
      for (let i = 0; i < 5; i++) { c.fillStyle = rgba(top, tone * 0.1); c.fillRect(x0, y0 + 20 + i * (yb - y0) * 0.16 + r() * 20, x1 - x0, 16 + r() * 22); }
      c.filter = 'none'; c.globalAlpha = 0.45 * tone; c.fillStyle = c.createPattern(grainTile(top), 'repeat'); c.fill(path); c.globalAlpha = 1;
      c.globalCompositeOperation = 'destination-out';
      for (const cl of clouds) { c.filter = 'blur(14px)'; c.fillStyle = `rgba(0,0,0,${(0.9 * ss(0.3, 1, e)).toFixed(2)})`; c.fill(toPath(blobPts(cl.x, cl.y, cl.rx, cl.ry, seed + cl.s, 0.32))); }
      // the sheet's edges stay white: soften the sides and the foot into the paper
      c.filter = 'none';
      let gl = c.createLinearGradient(x0, 0, x0 + 220, 0); gl.addColorStop(0, 'rgba(0,0,0,1)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gl; c.fillRect(x0 - 100, y0 - 100, 320, yb - y0 + 300);
      gl = c.createLinearGradient(x1 - 220, 0, x1, 0); gl.addColorStop(0, 'rgba(0,0,0,0)'); gl.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = gl; c.fillRect(x1 - 220, y0 - 100, 400, yb - y0 + 300);
      c.globalCompositeOperation = 'source-over';
      c.restore();
    };
    draw.key = (lt) => `${k(lt).toFixed(3)}:${dry(lt).toFixed(2)}`;
    return mount(this, x0 - 120, y0 - 120, x1 - x0 + 240, yb - y0 + 260, o, draw);
  };

  /** hills(o): rolling hills in overlapping transparent washes, far ranges pale and cool, near ones warmer and
   *  stronger, each drying with its own dark ridge line where it overlaps the one behind; every range thins out into the
   *  white paper below and at both ends (a vignette, never a full-bleed ground). They are laid far to near. The ground of a
   *  landscape, a journey, a country seen from the side. o: { y (700: the nearest ridge), height (280), layers (3),
   *  colors (['blue', 'green', 'orange'] far→near), tone (0.6), x0 (140), x1 (1780), at, dur (1.0 per range), gap
   *  (0.45), seed } */
  B.hills = function (o = {}) {
    const y = o.y ?? STAGE.area.y1 - 180, Hh = o.height ?? 280, n = o.layers ?? 3, at = o.at ?? 0, dur = o.dur ?? 1.0, gap = o.gap ?? 0.45, seed = o.seed ?? seedN++;
    const x0 = o.x0 ?? STAGE.area.x0, x1 = o.x1 ?? STAGE.area.x1;
    const colors = o.colors || ['blue', 'green', 'orange'], tone = o.tone ?? 0.6, hs = [];
    for (let i = 0; i < n; i++) {
      const q = n === 1 ? 1 : i / (n - 1), base = y - (1 - q) * Hh * 0.7, amp = Hh * lerp(0.4, 0.8, q), band = 150 + q * 120;
      const ridge = [];
      for (let x = x0 - 60; x <= x1 + 60; x += 26) ridge.push([x, base - amp * (0.3 + 0.7 * (fbm(x * 0.0019 + seed + i * 5.3, i * 2.1, 3) * 0.9 + 0.5))]);
      const foot = [];
      for (let x = x1 + 60; x >= x0 - 60; x -= 40) foot.push([x, base + band + fbm(x * 0.004 + i, seed, 2) * 60]);
      hs.push(this.wash([...ridge, ...foot], { at: at + i * gap, dur, color: colors[Math.min(i, colors.length - 1)], tone: tone * lerp(0.55, 1, q), bleed: i === n - 1 ? (o.bleed ?? 'yellow') : undefined, bleedAt: [lerp(x0, x1, 0.3), base], bleedR: 560, from: [lerp(x0, x1, 0.2 + 0.6 * ((seed + i) % 2)), base], seed: seed * 10 + i, wobble: 5, grain: 0.55, fadeY: [base + band * 0.25, base + band + 40], fadeX: [x0, x1] }));
    }
    return group(hs);
  };

  /** tree(x, y, h, o): a painted tree standing at (x, y) (the foot), h tall: a tapering trunk stroke and a crown of
   *  overlapping wet blots, green bleeding into yellow on the lit side. It sways a little. o: { at, kind ('round' |
   *  'pine' | 'bare'), color ('green'), light ('yellow'), trunk ('orange'), tone (0.65), seed } */
  B.tree = function (x, y, h, o = {}) {
    const at = o.at ?? 0, kind = o.kind || 'round', seed = o.seed ?? seedN++, r = PV.rng(seed * 3 + 1), tone = o.tone ?? 0.65, hs = [];
    const tk = rgbOf(o.trunk || 'orange');
    const trunkH = kind === 'pine' ? h * 0.25 : kind === 'bare' ? h : h * 0.45;
    const tw = Math.max(6, h * 0.045);
    const [bx, by, bw, bh] = [x - h * 0.4, y - h - 20, h * 0.8, h + 40];
    const tkDraw = (c, lt) => {
      const k = ease.out(clamp((lt - at) / 0.5)); if (k <= 0) return;
      const sway = Math.sin(lt * 0.9 + seed) * h * 0.006;
      c.fillStyle = rgba(darker(tk, 0.7), tone * 0.8);
      c.beginPath(); c.moveTo(x - tw / 2, y); c.quadraticCurveTo(x - tw * 0.3, y - trunkH * k * 0.5, x + sway - tw * 0.15, y - trunkH * k);
      c.lineTo(x + sway + tw * 0.15, y - trunkH * k); c.quadraticCurveTo(x + tw * 0.3, y - trunkH * k * 0.5, x + tw / 2, y); c.closePath(); c.fill();
      if (kind === 'bare') { c.strokeStyle = rgba(darker(tk, 0.6), tone * 0.7); c.lineCap = 'round';
        for (let i = 0; i < 7; i++) { const t0 = 0.35 + i * 0.09, a = (i % 2 ? -1 : 1) * (0.5 + r() * 0.5), L = h * (0.18 + r() * 0.18) * ss(0.4, 1, k);
          const px = x + sway * t0, py = y - trunkH * t0; c.lineWidth = tw * (0.5 - i * 0.05); c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.sin(a) * L * 0.5, py - L * 0.6, px + Math.sin(a) * L, py - L * 0.9); c.stroke(); } }
    };
    tkDraw.key = (lt) => (lt < at ? 'pre' : (Math.round(lt * 12) / 12).toFixed(2));
    hs.push(mount(this, bx, by, bw, bh, o, tkDraw));
    if (kind === 'round') {
      const cy = y - trunkH - h * 0.22;
      for (let i = 0; i < 4; i++) {
        const ox = (r() - 0.5) * h * 0.32, oy = (r() - 0.5) * h * 0.2, rr = h * (0.2 + r() * 0.08);
        hs.push(this.blot(x + ox, cy + oy, rr, { at: at + 0.25 + i * 0.12, dur: 0.8, color: o.color || 'green', tone: tone * (0.7 + r() * 0.3), bleed: o.light ?? 'yellow', bleedAt: [x - h * 0.2, cy - h * 0.2], bleedR: h * 0.35, wob: 0.25, seed: seed * 10 + i, out: o.out }));
      }
    } else if (kind === 'pine') {
      for (let i = 0; i < 4; i++) {
        const ty = y - trunkH * 0.4 - i * h * 0.19, hw = h * (0.3 - i * 0.06);
        hs.push(this.wash([[x - hw, ty], [x + hw, ty], [x, ty - h * 0.32]], { at: at + 0.25 + i * 0.12, dur: 0.7, color: o.color || 'green', tone: tone * (0.8 + i * 0.05), bleed: i === 3 ? (o.light ?? 'yellow') : 'blue', seed: seed * 10 + i, wobble: 5, out: o.out }));
      }
    }
    return group(hs);
  };

  /** water(x0, y, x1, o): a band of water from x0 to x1 starting at y: a pale wash that thins into the paper below,
   *  crossed by tapered horizontal brushstrokes (longer near the top, shorter and darker lower down) with white paper
   *  glinting between them; it shimmers. A sea, a river, a lake under the hills. o: { at, dur (1.0), color ('blue'),
   *  depth (180), tone (0.55), seed } */
  B.water = function (x0, y, x1, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.0, depth = o.depth ?? 180, seed = o.seed ?? seedN++, tone = o.tone ?? 0.55, rgb = rgbOf(o.color || 'blue'), r = PV.rng(seed);
    const hs = [];
    hs.push(this.wash([[x0, y], [x1, y], [x1, y + depth], [x0, y + depth]], { at, dur, color: o.color || 'blue', tone: tone * 0.55, wobble: 8, rim: 0.4, seed, fadeY: [y + depth * 0.3, y + depth], fadeX: [x0, x1], from: [lerp(x0, x1, 0.3), y + 10] }));
    const strokes = [];
    const rows = Math.max(4, Math.round(depth / 26));
    for (let i = 0; i < rows; i++) {
      const q = i / (rows - 1); let x = x0 + 80 + r() * 120;
      while (x < x1 - 120) { const L = (90 + r() * 240) * (1 - q * 0.5); if (r() < 0.75) strokes.push({ x, y: y + 12 + q * depth * 0.8, L, w: 5 + q * 8 + r() * 4, ph: r() * 6, q, bend: (r() - 0.5) * 6 }); x += L + 40 + r() * 140; }
    }
    const k = (lt) => ease.out(clamp((lt - at - dur * 0.4) / dur));
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      c.save(); c.filter = 'blur(0.9px)';
      const span = x1 - x0;
      for (const s of strokes) {
        const vis = clamp((e * span * 1.2 - (s.x - x0)) / 160); if (vis <= 0) continue;
        const edge = Math.min(1, Math.min(s.x - x0, x1 - s.x - s.L) / 220 + 0.2);
        const dx = Math.sin(lt * 0.7 + s.ph) * 5, L = s.L * vis, sx = s.x + dx;
        c.fillStyle = rgba(rgb, tone * (0.35 + 0.45 * s.q) * clamp(edge) * (1 - 0.5 * s.q * s.q));
        c.beginPath(); c.moveTo(sx, s.y);
        c.quadraticCurveTo(sx + L * 0.5, s.y - s.w * 0.6 + s.bend, sx + L, s.y);
        c.quadraticCurveTo(sx + L * 0.55, s.y + s.w * 0.5 + s.bend, sx, s.y); c.fill();
      }
      c.restore();
    };
    draw.key = (lt) => (lt < at ? 'pre' : (Math.round(lt * 15) / 15).toFixed(2));
    hs.push(mount(this, x0 - 40, y - 30, x1 - x0 + 80, depth + 60, o, draw));
    return group(hs);
  };

  /** person(x, y, h, o): a small painted figure standing at (x, y) (the feet), h tall — a loose wash body and a round
   *  head, no face, pencilled first. For scale, a traveller, a crowd, a merchant, a reader. o: { at, color ('blue':
   *  the coat), skin ('orange'), pose ('stand' | 'walk' | 'point'), dir (1 | -1), tone (0.6), seed } */
  B.person = function (x, y, h, o = {}) {
    const at = o.at ?? 0, d = o.dir ?? 1, pose = o.pose || 'stand', seed = o.seed ?? seedN++;
    const hd = h * 0.13, sh = y - h + hd * 2.2;
    const coat = [[x - h * 0.13, sh + h * 0.04], [x + h * 0.13, sh + h * 0.04], [x + h * 0.17, y - h * 0.35], [x + h * 0.06, y - h * 0.33], [x - h * 0.06, y - h * 0.33], [x - h * 0.17, y - h * 0.35]];
    const st = pose === 'walk' ? h * 0.12 : h * 0.05;
    const legs = [[x - h * 0.06, y - h * 0.34], [x - st * d, y], [x - st * d - h * 0.05, y], [x - h * 0.01, y - h * 0.3], [x + h * 0.01, y - h * 0.3], [x + st * d + h * 0.05, y], [x + st * d, y], [x + h * 0.06, y - h * 0.34]];
    const arm = pose === 'point' ? [[x + h * 0.1 * d, sh + h * 0.06], [x + h * 0.42 * d, sh - h * 0.02], [x + h * 0.43 * d, sh + h * 0.04], [x + h * 0.12 * d, sh + h * 0.14]] : null;
    const parts = [{ p: legs, color: 'ink', tone: 0.45 }, { p: coat, color: o.color || 'blue', tone: o.tone ?? 0.6, bleed: o.bleed }, { p: blobPts(x, sh - hd * 1.1, hd, hd * 1.1, seed, 0.06, 28), color: o.skin || 'orange', tone: 0.45 }];
    if (arm) parts.push({ p: arm, color: o.color || 'blue', tone: o.tone ?? 0.6 });
    return this.paint(parts, { at, sketch: o.sketch ?? 0.6, dur: 0.7, stagger: 0.1, seed, wobble: 2.5, grain: 0.3, out: o.out });
  };

  /** spatter(cx, cy, o): a flick of the loaded brush — droplets of paint burst out from a point and land around it.
   *  A punctuation mark: the moment of a discovery, a number landing, the end of a page. Use sparingly. o: { at,
   *  color ('red'), n (40), r (180: spread), size (9: largest drop), tone (0.7), dir (angle in radians to throw toward;
   *  default all round), seed } */
  B.spatter = function (cx, cy, o = {}) {
    const at = o.at ?? 0, n = o.n ?? 40, R = o.r ?? 180, sz = o.size ?? 9, seed = o.seed ?? seedN++, tone = o.tone ?? 0.7, rgb = rgbOf(o.color || 'red'), r = PV.rng(seed);
    const drops = Array.from({ length: n }, () => { const a = o.dir != null ? o.dir + (r() - 0.5) * 1.3 : r() * Math.PI * 2, d = Math.pow(r(), 0.7) * R; return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, s: sz * Math.pow(r(), 2.2) + 1.2, t: r() * 0.18, sx: 1 + r() * 0.6, a }; });
    const draw = (c, lt) => {
      if (lt < at) return;
      for (const p of drops) {
        const k = ease.out(clamp((lt - at - p.t) / 0.22)); if (k <= 0) continue;
        c.fillStyle = rgba(rgb, tone * (0.55 + 0.45 * ss(0.1, 1, k)));
        c.beginPath(); c.ellipse(lerp(cx, p.x, k), lerp(cy, p.y, k), p.s * p.sx, p.s, p.a, 0, Math.PI * 2); c.fill();
        c.fillStyle = rgba(darker(rgb, 0.65), tone * 0.35 * k); c.beginPath(); c.arc(lerp(cx, p.x, k) + p.s * 0.2, lerp(cy, p.y, k) + p.s * 0.2, p.s * 0.45, 0, Math.PI * 2); c.fill();
      }
    };
    draw.key = (lt) => (lt < at ? 'pre' : Math.min(lt - at, 0.5).toFixed(2));
    return mount(this, cx - R - sz * 3, cy - R - sz * 3, (R + sz * 3) * 2, (R + sz * 3) * 2, o, draw);
  };

  // ── words ──
  const FACE = (str, w) => (/[㐀-鿿]/.test(str) ? `${w} {S}px "Noto Serif SC Variable", "Songti SC", serif` : `${w} {S}px "Fraunces Variable", "Noto Serif SC Variable", serif`);

  /** painted(str, x, y, o): big words or a number painted in watercolour — the letters are a wash that spreads across
   *  them from the left, granulates and dries with dark rims, a pencil baseline under them. The one key word or number
   *  of the page (至少 1 per film, at most 1 per page), e.g. painted('1,600 km', …) the moment it is spoken. (x, y) is
   *  the top left. o: { at, dur (1.2), size (200), color ('blue'), bleed ('purple'), tone (0.75), weight (900),
   *  align ('l' | 'c': x is the centre), seed } */
  B.painted = function (str, x, y, o = {}) {
    const size = o.size ?? 200, at = o.at ?? 0, dur = o.dur ?? 1.2, seed = o.seed ?? seedN++, tone = o.tone ?? 0.75;
    const font = FACE(str, o.weight ?? 900).replace('{S}', size);
    const mc = document.createElement('canvas').getContext('2d'); mc.font = font;
    const tw = mc.measureText(str).width || PV.tw(str, size), x0 = o.align === 'c' ? x - tw / 2 : x;
    const rgb = rgbOf(o.color || 'blue'), bl = o.bleed === null ? null : rgbOf(o.bleed || 'purple');
    const pad = 40, w = tw + pad * 2, h = size * 1.35 + pad * 2;
    const mask = document.createElement('canvas'); mask.width = Math.ceil(w); mask.height = Math.ceil(h);
    const r = PV.rng(seed);
    const k = (lt) => ease.out(clamp((lt - at) / dur)), dry = (lt) => ss(at + dur * 0.6, at + dur + 0.9, lt);
    let ready = false;
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      const m = mask.getContext('2d');
      if (!ready) { ready = true; }
      m.clearRect(0, 0, w, h); m.save();
      // wet front sweeping left to right, ragged
      const fx = lerp(-80, w + 120, e);
      m.beginPath(); m.moveTo(0, 0); for (let yy = 0; yy <= h; yy += 16) m.lineTo(fx + fbm(yy * 0.02 + seed, 1) * 90, yy); m.lineTo(0, h); m.closePath(); m.clip();
      m.font = font; m.textBaseline = 'top';
      // body
      m.filter = 'blur(0.7px)'; m.fillStyle = rgba(rgb, tone * 0.85); m.fillText(str, pad, pad);
      m.globalCompositeOperation = 'source-atop';
      if (bl) { const g = m.createLinearGradient(pad, pad, pad + tw, pad + size); g.addColorStop(0, rgba(bl, 0)); g.addColorStop(0.55, rgba(bl, tone * 0.25)); g.addColorStop(1, rgba(bl, tone * 0.55)); m.filter = 'blur(8px)'; m.fillStyle = g; m.fillRect(0, 0, w, h); }
      m.filter = 'blur(16px)'; for (let i = 0; i < 5; i++) { m.fillStyle = rgba(darker(rgb, 0.8), tone * 0.3); m.beginPath(); m.ellipse(pad + r() * tw, pad + size * (0.2 + r() * 0.7), size * 0.5, size * 0.3, 0, 0, Math.PI * 2); m.fill(); }
      m.filter = 'none'; m.globalAlpha = 0.55 * tone; m.fillStyle = m.createPattern(grainTile(rgb), 'repeat'); m.fillRect(0, 0, w, h); m.globalAlpha = 1;
      m.globalCompositeOperation = 'source-over';
      // rims: the glyph outline, darker as it dries
      const d = dry(lt);
      m.lineJoin = 'round'; m.filter = `blur(${(0.8 + (1 - d) * 1.6).toFixed(1)}px)`; m.lineWidth = Math.max(2, size * 0.018); m.strokeStyle = rgba(darker(rgb, 0.6), tone * (0.2 + 0.6 * d)); m.strokeText(str, pad, pad);
      m.restore();
      c.drawImage(mask, x0 - pad, y - pad);
      // a pencil baseline, drawn first
    };
    draw.key = (lt) => `${k(lt).toFixed(3)}:${dry(lt).toFixed(2)}`;
    const hs = [];
    if (o.line !== false) hs.push(this.pencil([[x0 - 10, y + size * 1.1], [x0 + tw + 20, y + size * 1.08]], { at: Math.max(0, at - 0.45), dur: 0.45, tone: 0.45, seed: seed + 5, out: o.out }));
    hs.push(mount(this, x0 - pad, y - pad, w, h, o, draw));
    return Object.assign(group(hs), { w: tw });
  };

  /** label(x, y, str, o): a hand-lettered caption in graphite-dark ink, optionally with a pencil leader line from the
   *  caption to the thing it names (o.to [x,y]). Names, dates, small facts beside the painting — the way a sketchbook is
   *  annotated. o: { at, size (40), color ('ink'), to [x,y], w (wrap width), align, cps (14) } — returns the text handle */
  B.label = function (x, y, str, o = {}) {
    const size = o.size ?? 40, at = o.at ?? 0;
    if (o.to) {
      const tx = o.to[0], ty = o.to[1], sx = tx < x ? x - 12 : x + Math.min(PV.tw(str, size), o.w ?? 9999) + 12, sy = y + size * 0.6;
      this.pencil([[sx, sy], [lerp(sx, tx, 0.55), lerp(sy, ty, 0.4) - 14], [tx, ty]], { at, dur: 0.45, tone: 0.5, out: o.out });
      this.blot(tx, ty, 7, { at: at + 0.4, dur: 0.3, color: o.dot || 'red', tone: 0.8, grain: 0, rim: 0.6, out: o.out });
    }
    return this.text(str, { x, y, size, color: o.color || 'ink', at: at + (o.to ? 0.3 : 0), cps: o.cps ?? 14, w: o.w, align: o.align, weight: o.weight ?? 600, mode: o.mode });
  };

  /** swatch(x, y, str, o): a paint chip — a loose rectangular wash with a hand-lettered word or number on it, like the
   *  colour tests at the edge of a painting. For a term, a step, a key figure in a row of them. (x, y) top left.
   *  o: { at, w (fits the text), h (size × 1.9), size (44), color ('yellow'), tone (0.55), text ('ink') } */
  B.swatch = function (x, y, str, o = {}) {
    const size = o.size ?? 44, w = o.w ?? Math.max(size * 3, PV.tw(str, size) * (/[㐀-鿿]/.test(str) ? 1.12 : 1) + size * 1.4), h = o.h ?? size * 1.9, at = o.at ?? 0;
    const sk = (o.seed ?? seedN) % 2 ? 1 : -1;
    const ws = this.wash([[x, y + 4 * sk], [x + w, y - 4 * sk], [x + w + 6, y + h], [x - 4, y + h + 6 * sk]], { at, dur: 0.7, color: o.color || 'yellow', tone: o.tone ?? 0.55, wobble: 6, from: [x + 20, y + h / 2], seed: o.seed, out: o.out });
    const t = this.text(str, { x: x + w / 2, y: y + (h - size * 1.25) / 2, size, align: 'c', w: w - 20, color: o.text || 'ink', at: at + 0.35, cps: o.cps ?? 16, weight: 700 });
    return Object.assign(group([ws, t]), { text: t });
  };

  // ── the page title: hand-lettered, with a loose wash stripe laid under it ──
  B.title = function (str, o = {}) {
    const at = o.at ?? 0.15, T = this.hud || this, size = o.size ?? 58;
    const w = Math.min(W - 420, PV.tw(str, size) * (/[㐀-鿿]/.test(str) ? 1.02 : 0.9)), TX = STAGE.title.x, TY = STAGE.title.y;
    T.wash([[TX - 8, TY + 34], [TX - 8 + w + 40, TY + 26], [TX - 8 + w + 56, TY + 84], [TX - 14, TY + 92]], { at, dur: 0.9, color: o.accent || 'yellow', tone: 0.5, wobble: 5, from: [TX, TY + 62], grain: 0.6 });
    return T.text(str, { x: TX + 10, y: TY, size, weight: 700, at: at + 0.2, cps: o.cps ?? 12, color: 'ink' });
  };

  PV.WC = { paint, wobble, blobPts, noise, fbm, grainTile };
})();
