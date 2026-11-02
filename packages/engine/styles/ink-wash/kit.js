/* Ink wash · brush-and-water kit: brush strokes that write themselves with pressure and flying white, ink that blooms
 * on wet paper, layered mountains dissolving into mist, drifting cloud, water, a cinnabar seal, vertical calligraphy,
 * and ink creatures (a great fish, a great bird, bamboo, a tiny sage). Everything is canvas multiplied onto the paper,
 * so ink over ink darkens the way real ink does. Every component is a pure function of page-local time lt.
 * The brush, bloom and mountain techniques are adapted from huashu-art-motion (MIT, © 2026 alchaincyf), see NOTICE.md. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const rgbOf = (c) => { const h = String(col(c || 'ink')).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  const PAPER = rgbOf('paper');

  // ── noise (Perlin 2D, about [-1, 1]) ──
  const perm = new Uint8Array(512);
  { const r = PV.rng(1337); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { const u = h & 1 ? x : -x, v = h & 2 ? y : -y; return h & 4 ? u + v * 0.5 : u * 0.5 + v; };
  const noise = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  };
  const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2; } return s; };

  // ── polylines: Catmull-Rom densify, equal-arc resample, variable-width ribbon ──
  const densify = (pts, per = 6) => {
    const out = [], n = pts.length, P_ = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    if (n < 2) return pts.slice();
    for (let i = 0; i < n - 1; i++) {
      const p0 = P_(i - 1), p1 = P_(i), p2 = P_(i + 1), p3 = P_(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    out.push(pts[n - 1]); return out;
  };
  const resample = (pts, step = 4) => {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let d = step - acc;
      while (d <= L) { const q = d / L; out.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]); d += step; }
      acc = L - (d - step);
    }
    out.push(pts[pts.length - 1]); return out;
  };
  const ribbon = (pts, w) => {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const hw = (typeof w === 'function' ? w(i / (n - 1 || 1), i) : w) / 2;
      L.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]); R.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
    }
    const p = new Path2D(); L.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    for (let i = n - 1; i >= 0; i--) p.lineTo(R[i][0], R[i][1]);
    p.closePath(); return p;
  };

  // ── the brush: pressure in and out, a wet core thinning as the ink runs out, bristles breaking into flying white ──
  // pts control points; w max width; tone ink density (焦 .95 / 浓 .8 / 重 .6 / 淡 .35 / 清 .15); dry 0..1; reveal 0..1
  function brush(c, pts, { w = 12, tone = 0.85, dry = 0.45, seed = 1, reveal = 1, bristles, color = 'ink', head = 0.12, tail = 0.4, per = 5 } = {}) {
    if (reveal <= 0 || pts.length < 2) return;
    bristles = Math.max(bristles ?? 0, Math.round(clamp(w / 2.4, 6, 48)));   // a wide brush has many hairs: never a few separate lines
    const D = resample(densify(pts, per), 4), n = D.length, m = Math.max(2, Math.ceil(n * clamp(reveal)));
    const r = PV.rng(seed * 7919 + 3), rgb = rgbOf(color);
    const prof = (q) => ss(0, head, q) * (1 - 0.7 * ss(1 - tail, 1, q)) * (0.85 + 0.15 * noise(seed * 3.3, q * 6)) + 0.08;
    const N = [];
    for (let i = 0; i < n; i++) { const A = D[Math.max(0, i - 1)], Bq = D[Math.min(n - 1, i + 1)]; const dx = Bq[0] - A[0], dy = Bq[1] - A[1], d = Math.hypot(dx, dy) || 1; N.push([-dy / d, dx / d]); }
    const core = (q) => w * prof(q) * (1 - dry * 0.85 * Math.pow(q, 0.8));
    c.save(); c.lineCap = 'butt'; c.lineJoin = 'round';
    c.fillStyle = rgba(rgb, tone * 0.72); c.fill(ribbon(D.slice(0, m), (q, i) => core(i / (n - 1))));
    for (let k = 0; k < bristles; k++) {
      const off = (k / (bristles - 1) - 0.5) * 0.95, bw = (w / bristles) * (0.9 + r() * 0.9), ph = r() * 50;
      c.strokeStyle = rgba(rgb, tone * (0.45 + r() * 0.35)); c.lineWidth = Math.max(0.7, bw);
      c.beginPath(); let on = false;
      for (let i = 0; i < m; i++) {
        const q = i / (n - 1), dryness = dry * Math.pow(q, 1.2);
        const vis = noise(k * 1.9 + ph, i * 0.09) * 0.5 + 0.5 > dryness * 0.95 + 0.05;
        const o = off * w * prof(q), x = D[i][0] + N[i][0] * o, y = D[i][1] + N[i][1] * o;
        if (vis) { on ? c.lineTo(x, y) : c.moveTo(x, y); on = true; } else on = false;
      }
      c.stroke();
    }
    c.restore();
  }
  /** a single tapered stroke (bamboo leaf, orchid blade, feather, fin): from (x,y) along ang, length L, max width w */
  function leaf(c, x, y, ang, L, w, tone = 0.86, rgb = rgbOf('ink'), bend = 0.08) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const q = i / 12, b = Math.sin(q * Math.PI) * bend * L; pts.push([x + Math.cos(ang) * L * q - Math.sin(ang) * b, y + Math.sin(ang) * L * q + Math.cos(ang) * b]); }
    c.fillStyle = rgba(rgb, tone); c.fill(ribbon(pts, (q) => w * Math.pow(Math.sin(Math.PI * Math.min(1, q * 1.08)), 0.7) + 0.6));
  }
  /** a brushed blade (feather, fin, tail lobe): one stroke pressed at the root, flying white toward a sharp tip */
  function feather(c, x, y, ang, L, w, tone = 0.85, color = 'ink', bend = 0.08, seed = 1, dry = 0.5, head = 0.04) {
    const pts = [];
    for (let i = 0; i <= 4; i++) { const q = i / 4, b = Math.sin(q * Math.PI) * bend * L; pts.push([x + Math.cos(ang) * L * q - Math.sin(ang) * b, y + Math.sin(ang) * L * q + Math.cos(ang) * b]); }
    brush(c, pts, { w, tone, dry, seed, head, tail: 0.75, color });
  }
  /** an irregular closed blob path (ink drop, wash edge), radius r, wobble wob */
  function blob(cx, cy, r, seed, wob = 0.22, n = 48) {
    const p = new Path2D();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + wob * fbm(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 + seed * 0.7, 3) * 1.6;
      const x = cx + Math.cos(a) * r * k, y = cy + Math.sin(a) * r * k;
      i ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    p.closePath(); return p;
  }

  // ── mounting: one canvas per component, multiplied onto the paper; fades in at `at`, out at hide(t) / o.out ──
  function mount(self, x, y, w, h, o, draw, blend = 'multiply') {
    const cv = PV.h('canvas', 'ink-cv', null, self.html);
    cv.width = Math.ceil(w); cv.height = Math.ceil(h);
    Object.assign(cv.style, { position: 'absolute', left: x + 'px', top: y + 'px', mixBlendMode: blend, pointerEvents: 'none' });
    const ctx = cv.getContext('2d');
    const st = { out: o.out, outDur: o.outDur ?? 0.6 };
    let last = '';
    self.tick((lt) => {
      const op = (st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1) * val(o.op, lt, 1);
      cv.style.opacity = op.toFixed(3);
      if (op <= 0.001) return;
      const key = draw.key ? draw.key(lt) : null;   // a static frame redraws nothing
      if (key != null && key === last) return;
      last = key;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save(); ctx.translate(-x, -y); draw(ctx, lt); ctx.restore();
    });
    return { el: cv, hide(t, d = 0.6) { st.out = t; st.outDur = d; return this; } };
  }
  const bbox = (pts, pad) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 - x0 + pad * 2), Math.ceil(y1 - y0 + pad * 2)];
  };
  const offscreen = (w, h) => { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
  let seedN = 1;

  /** inkStroke(pts, o): one brush stroke that writes itself along control points pts [[x,y],…] (Catmull-Rom smoothed),
   *  pressing in, thinning as the ink runs out and breaking into flying white (飞白) at the tail. The basic mark of the
   *  style: ridges, branches, a boat, a horizon, an underline, a character's robe. o: { at, dur (0.5), w (14), tone (0.85:
   *  0.95 scorched, 0.6 heavy, 0.35 light, 0.15 clear), dry (0.45: 0 wet, 0.9 very dry), color ('ink'), head, tail, bristles, seed } */
  B.inkStroke = function (pts, o = {}) {
    const w = o.w ?? 14, at = o.at ?? 0, dur = o.dur ?? 0.5, seed = o.seed ?? seedN++;
    const [x, y, bw, bh] = bbox(pts, w + 6);
    const opt = { w, tone: o.tone ?? 0.85, dry: o.dry ?? 0.45, seed, color: o.color, head: o.head, tail: o.tail, bristles: o.bristles };
    const k = (lt) => ease.out(clamp((lt - at) / dur));
    const draw = (c, lt) => brush(c, pts, { ...opt, reveal: k(lt) });
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x, y, bw, bh, o, draw);
  };

  /** inkStrokes(list, o): several brush strokes written one after another like a painter's hand — list of
   *  { p: [[x,y],…], w, tone, dry } (each may override o). Draw any object with it: a rock, a pavilion roof, a boat,
   *  a willow. o: { at, dur (total writing time, default 0.35 s a stroke), w, tone, dry, color } */
  B.inkStrokes = function (list, o = {}) {
    const at = o.at ?? 0, per = (o.dur ?? list.length * 0.35) / Math.max(1, list.length);
    const all = list.flatMap((s) => s.p), maxW = Math.max(...list.map((s) => s.w ?? o.w ?? 12));
    const [x, y, bw, bh] = bbox(all, maxW + 6), base = o.seed ?? (seedN += list.length);
    const ks = (lt) => list.map((_, i) => ease.out(clamp((lt - at - i * per) / (per * 1.4))));
    const draw = (c, lt) => ks(lt).forEach((k, i) => { const s = list[i]; brush(c, s.p, { w: s.w ?? o.w ?? 12, tone: s.tone ?? o.tone ?? 0.85, dry: s.dry ?? o.dry ?? 0.45, color: s.color ?? o.color, seed: base + i, reveal: k, head: s.head, tail: s.tail }); });
    draw.key = (lt) => ks(lt).map((k) => k.toFixed(2)).join();
    return mount(this, x, y, bw, bh, o, draw);
  };

  /** inkBloom(cx, cy, r, o): a drop of ink touching wet paper — an irregular blot spreads from nothing to radius r with a
   *  soft halo that keeps creeping outward. For emphasis, a reveal, a transition (a huge bloom of r 1400 floods the frame
   *  in dark ink; then hide() it), or the shadow under an object. o: { at, dur (1.4), tone (0.8), color ('ink'), seed } */
  B.inkBloom = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.4, tone = o.tone ?? 0.8, seed = o.seed ?? seedN++, rgb = rgbOf(o.color);
    const pad = r * 0.9 + 40, size = r * 2 + pad * 2;
    const k = (lt) => clamp((lt - at) / dur);
    const draw = (c, lt) => {
      const g = k(lt); if (g <= 0) return;
      const e = ease.out(g), creep = 1 + 0.06 * clamp((lt - at - dur) / 8);
      c.save();
      c.filter = `blur(${(r * 0.12 * (0.5 + e)).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.35 * e);
      c.fill(blob(cx, cy, r * e * 1.18 * creep, seed + 0.5, 0.3));
      c.filter = `blur(${(r * 0.025 + 1.5).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.8 * ss(0, 0.5, g));
      c.fill(blob(cx, cy, r * e * creep, seed, 0.22));
      c.filter = 'none'; c.fillStyle = rgba(rgb, tone * 0.25 * e);   // a darker heart where the drop landed
      c.fill(blob(cx + r * 0.08, cy - r * 0.05, r * e * 0.45, seed + 3, 0.35));
      c.restore();
    };
    draw.key = (lt) => (lt < at + dur ? k(lt).toFixed(3) : (Math.min(lt, at + dur + 8)).toFixed(1));
    return mount(this, cx - r - pad, cy - r - pad, size, size, o, draw);
  };

  /** wash(pts, o): a soft ink or colour wash filling the polygon pts [[x,y],…], blooming in from its centre with a
   *  watercolour edge — a lake, a robe, a cloud shadow, a field of colour behind a key word. o: { at, dur (1), tone
   *  (0.35), color ('ink'; 'blue' indigo, 'orange' ochre, 'green' stone green, 'red' cinnabar), blur (3), seed } */
  B.wash = function (pts, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1, tone = o.tone ?? 0.35, rgb = rgbOf(o.color), bl = o.blur ?? 3;
    const [x, y, bw, bh] = bbox(pts, 60);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const r = PV.rng(o.seed ?? seedN++);
    const layers = [0, 1, 2].map(() => pts.map(([px, py]) => [px + (r() - 0.5) * 14, py + (r() - 0.5) * 14]));
    const k = (lt) => ease.out(clamp((lt - at) / dur));
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      c.save(); c.translate(cx, cy); c.scale(0.6 + 0.4 * e, 0.6 + 0.4 * e); c.translate(-cx, -cy);
      layers.forEach((L, i) => {
        c.filter = `blur(${(bl + (1 - e) * 10 + i * 1.5).toFixed(1)}px)`;
        c.fillStyle = rgba(rgb, (tone / 2.2) * e);
        c.beginPath(); L.forEach(([px, py], j) => (j ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill();
      });
      c.restore();
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x, y, bw, bh, o, draw);
  };

  /** mountains(o): layered ink mountains across the whole frame (x -240…2160, so pans never show an edge), far ranges
   *  pale, near ranges dark with dry-brush texture strokes (皴), every range dissolving into mist at its foot. They rise
   *  out of the paper one range after another, far to near. The landscape ground of the style: put it low and leave the
   *  sky empty. o: { y (640: the near range's foot), height (420: the tallest peak above y), layers (3), peak (x of the
   *  main peak, 1240), at, dur (1.8), tone (0.85: the near range), seed } */
  B.mountains = function (o = {}) {
    const y = o.y ?? STAGE.area.y1 - 240, H0 = o.height ?? 420, n = o.layers ?? 3, peak = o.peak ?? W - 680, at = o.at ?? 0, dur = o.dur ?? 1.8;
    const tone = o.tone ?? 0.85, seed = o.seed ?? seedN++, x0 = -240, x1 = W + 240, rgb = rgbOf('ink');
    const top = y - H0 - 80, bottom = y + 160;
    const L = [];
    for (let i = 0; i < n; i++) {   // far (i = 0) to near
      const q = n === 1 ? 1 : i / (n - 1), foot = y - (1 - q) * H0 * 0.3, amp = H0 * lerp(0.6, 1, q) * (n > 1 && i === n - 1 ? 0.7 : 1);
      const rr = PV.rng(seed * 13 + i * 101);
      // peaks: the main one (on the middle range), a few smaller around it; near range peaks sit off to the sides
      const main = i === Math.max(0, n - 2) ? peak : peak + (rr() < 0.5 ? -1 : 1) * (380 + rr() * 420);
      // widths follow the height, so low ranges stay steep too (a peak is about as wide as it is tall), with shoulders
      const pw = () => amp * (0.22 + rr() * 0.14);
      const peaks = [{ x: main, h: 1, w: pw() }, { x: main - amp * (0.35 + rr() * 0.2), h: 0.55 + rr() * 0.2, w: pw() * 0.8 }, { x: main + amp * (0.3 + rr() * 0.25), h: 0.45 + rr() * 0.25, w: pw() * 0.7 }];
      for (let k = 0; k < 5; k++) { const px2 = main + (rr() - 0.5) * 1900; peaks.push({ x: px2, h: 0.3 + rr() * 0.45, w: pw() }, { x: px2 + amp * (rr() - 0.5) * 0.6, h: 0.2 + rr() * 0.25, w: pw() * 0.6 }); }
      const cv = offscreen(x1 - x0, bottom - top), g = cv.getContext('2d');
      g.translate(-x0, -top);
      const ridge = [];
      for (let x = x0; x <= x1; x += 6) {
        let h = amp * 0.16 * (0.6 + fbm(x * 0.0016 + seed * 3 + i * 7, i * 1.3, 3));
        for (const pk of peaks) { const d = Math.abs(x - pk.x) / pk.w; h = Math.max(h, amp * pk.h * Math.exp(-Math.pow(d, 1.25) * 1.1)); }
        h += amp * 0.07 * (1 - Math.abs(noise(x * 0.011 + i * 5, seed))) + amp * 0.03 * noise(x * 0.04, i + seed);   // rocky jags
        ridge.push([x, foot - Math.max(8, h)]);
      }
      const tt = lerp(0.2, tone, Math.pow(q, 0.85)), hAt = (j) => foot - ridge[j][1];
      // body: graded wash, dark under the ridge, dissolving into mist at the foot
      const minY = Math.min(...ridge.map((p) => p[1]));
      const gr = g.createLinearGradient(0, minY, 0, foot + 40);
      gr.addColorStop(0, rgba(rgb, tt * 0.9)); gr.addColorStop(0.5, rgba(rgb, tt * 0.42)); gr.addColorStop(1, rgba(rgb, 0));
      g.filter = 'blur(2px)'; g.fillStyle = gr; g.beginPath(); ridge.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.lineTo(x1, foot + 80); g.lineTo(x0, foot + 80); g.closePath(); g.fill();
      // a second, darker wash hugging the ridge (the light comes from the sky, the ink sits on the crest)
      g.filter = 'blur(6px)'; g.fillStyle = rgba(rgb, tt * 0.35); g.beginPath();
      ridge.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py)));
      for (let j = ridge.length - 1; j >= 0; j--) g.lineTo(ridge[j][0], ridge[j][1] + 26 + hAt(j) * 0.18);
      g.closePath(); g.fill(); g.filter = 'none';
      // the crest line: dry strokes only where the ridge stands up (never a line along the flat foot)
      let run = [];
      const flush = () => { if (run.length > 6) brush(g, run.filter((_, j) => j % 3 === 0), { w: lerp(2.5, 8, q), tone: Math.min(1, tt * 1.15), dry: 0.55, seed: seed + i * 31 + run.length, bristles: 6, head: 0.08, tail: 0.35 }); run = []; };
      ridge.forEach((p, j) => { if (hAt(j) > amp * 0.3 && run.length < 60) run.push(p); else flush(); });
      flush();
      // hemp-fibre texture strokes (披麻皴): long, slightly curved, running down the flanks along the slope, gathered
      // on the high ground; only on the middle and near ranges
      if (q > 0.3) {
        for (let s = 0; s < 120 * q; s++) {
          const j = 2 + Math.floor(rr() * (ridge.length - 4)), hh = hAt(j);
          if (hh < amp * 0.38 || rr() > hh / amp) continue;
          const slope = (ridge[j + 2][1] - ridge[j - 2][1]) / 24, dir = slope > 0 ? 1 : -1;   // downhill side
          const [rx, ry] = ridge[j], len = (0.2 + rr() * 0.35) * hh, steep = clamp(Math.abs(slope), 1.3, 4);
          const dx = dir * len / Math.sqrt(1 + steep * steep) * 0.6, dy = len * steep / Math.sqrt(1 + steep * steep) + len * 0.3;
          brush(g, [[rx, ry + 6], [rx + dx * 0.45 + (rr() - 0.5) * 10, ry + dy * 0.5], [rx + dx, ry + dy]], { w: 2 + rr() * 4.5 * q, tone: tt * (0.35 + rr() * 0.4), dry: 0.75, seed: seed + s * 7 + i, bristles: 4, head: 0.1, tail: 0.6 });
        }
        // moss dots (苔点) and small dotted trees on the crests of the near range
        g.fillStyle = rgba(rgb, Math.min(1, tt * 1.1));
        for (let s = 0; s < 70 * q; s++) {
          const j = Math.floor(rr() * ridge.length), hh = hAt(j); if (hh < amp * 0.35) continue;
          const [rx, ry] = ridge[j]; g.beginPath(); g.ellipse(rx + (rr() - 0.5) * 16, ry + rr() * 10, 2 + rr() * 4, 1.5 + rr() * 2.5, rr() * 3, 0, Math.PI * 2); g.fill();
        }
        if (q === 1 && o.trees !== false) for (let s = 0; s < 9; s++) {
          const j = Math.floor(rr() * ridge.length), hh = hAt(j); if (hh < amp * 0.4) continue;
          const [rx, ry] = ridge[j], th = 26 + rr() * 34;
          brush(g, [[rx, ry + 4], [rx + (rr() - 0.5) * 6, ry - th * 0.5], [rx + (rr() - 0.5) * 8, ry - th]], { w: 3, tone: tt, dry: 0.3, seed: seed + s * 13, bristles: 3 });
          for (let d = 0; d < 14; d++) { const a = rr() * Math.PI * 2, rad = rr() * th * 0.42; g.beginPath(); g.ellipse(rx + Math.cos(a) * rad * 1.2, ry - th * 0.75 + Math.sin(a) * rad * 0.8, 3 + rr() * 4, 2 + rr() * 2.5, rr() * 3, 0, Math.PI * 2); g.fill(); }
        }
      }
      L.push(cv);
    }
    const ks = (lt) => L.map((_, i) => clamp((lt - at - (i * dur) / (n + 1)) / ((dur * 2) / (n + 1))));
    const draw = (c, lt) => ks(lt).forEach((k, i) => {
      if (k <= 0) return;
      const e = ease.out(k);
      c.save(); c.globalAlpha = e; if (e < 1) c.filter = `blur(${((1 - e) * 10).toFixed(1)}px)`;
      c.drawImage(L[i], x0, top + (1 - e) * 24); c.restore();
    });
    draw.key = (lt) => ks(lt).map((k) => k.toFixed(3)).join();
    return mount(this, x0, top, x1 - x0, bottom - top, o, draw);
  };

  /** mist(o): bands of drifting cloud the colour of the paper, passing in front of whatever is under them (mountains
   *  appear and vanish). Endless: it wraps around. o: { y (520: band centre), h (180), bands (4), speed (34 px/s; negative
   *  drifts left), alpha (0.8), at, seed } */
  B.mist = function (o = {}) {
    const y = o.y ?? STAGE.area.y1 - 360, h = o.h ?? 180, n = o.bands ?? 4, sp = o.speed ?? 34, al = o.alpha ?? 0.8, at = o.at ?? 0;
    const r = PV.rng(o.seed ?? seedN++), span = W + 1400;
    const bands = Array.from({ length: n * 3 }, (_, i) => ({ x: r() * span, y: y + (r() - 0.5) * h, rx: 260 + r() * 420, ry: h * (0.18 + r() * 0.22), v: sp * (0.6 + r() * 0.8), a: al * (0.55 + r() * 0.45) }));
    const draw = (c, lt) => {
      const e = ss(at, at + 1.2, lt);
      for (const b of bands) {
        const bx = ((((b.x + b.v * lt) % span) + span) % span) - 700;
        const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(PAPER, b.a * e)); g.addColorStop(0.55, rgba(PAPER, b.a * e * 0.7)); g.addColorStop(1, rgba(PAPER, 0));
        c.save(); c.translate(bx, b.y); c.scale(b.rx, b.ry); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill(); c.restore();
      }
    };
    return mount(this, -200, y - h * 1.2, W + 400, h * 2.4, o, draw, 'normal');
  };

  /** waves(o): calm water — rows of dry, fine brush ripples drifting sideways, denser and darker toward the viewer.
   *  o: { y0 (720: farthest row), y1 (880: nearest row), rows (7), amp (6), speed (18 px/s), tone (0.45), at, seed } */
  B.waves = function (o = {}) {
    const y0 = o.y0 ?? STAGE.area.y1 - 160, y1 = o.y1 ?? STAGE.area.y1, n = o.rows ?? 7, amp = o.amp ?? 6, sp = o.speed ?? 18, tone = o.tone ?? 0.45, at = o.at ?? 0, seed = o.seed ?? seedN++;
    const draw = (c, lt) => {
      for (let i = 0; i < n; i++) {
        const q = n === 1 ? 1 : i / (n - 1), yy = lerp(y0, y1, Math.pow(q, 1.4)), k = ease.out(clamp((lt - at - i * 0.08) / 0.8));
        if (k <= 0) continue;
        const r = PV.rng(seed * 31 + i);
        let x = -120 + ((sp * lt * (0.6 + q)) % 260) - 260;
        while (x < W + 120) {
          const len = 120 + r() * 260, pts = [];
          for (let s = 0; s <= 6; s++) { const px = x + (len * s) / 6; pts.push([px, yy + Math.sin(px * 0.018 + i * 1.7 + lt * 1.4) * amp * (0.5 + q)]); }
          brush(c, pts, { w: lerp(2.5, 7, q), tone: tone * lerp(0.45, 1, q), dry: 0.6, seed: seed + i * 97 + Math.round(x), reveal: k, bristles: 4, head: 0.15, tail: 0.5 });
          x += len + 40 + r() * 140;
        }
      }
    };
    return mount(this, -200, y0 - 40, W + 400, y1 - y0 + 80, o, draw);
  };

  /** ripple(cx, cy, o): rings spreading on still water from where something touched it (a drop, a fish rising, a
   *  thought landing). o: { at, rings (3), r (260: final radius), dur (2.4), tone (0.5), flat (0.32: ellipse squash) } */
  B.ripple = function (cx, cy, o = {}) {
    const at = o.at ?? 0, n = o.rings ?? 3, R = o.r ?? 260, dur = o.dur ?? 2.4, tone = o.tone ?? 0.5, fl = o.flat ?? 0.32, rgb = rgbOf('ink');
    const draw = (c, lt) => {
      for (let i = 0; i < n; i++) {
        const k = clamp((lt - at - i * 0.35) / dur); if (k <= 0 || k >= 1) continue;
        const rr = R * ease.out(k), a = tone * (1 - k);
        c.strokeStyle = rgba(rgb, a); c.lineWidth = 2 + 4 * (1 - k);
        c.beginPath(); c.ellipse(cx, cy, rr, rr * fl, 0, 0.15, Math.PI * 2 - 0.25); c.stroke();
      }
    };
    return mount(this, cx - R - 20, cy - R * fl - 20, R * 2 + 40, R * fl * 2 + 40, o, draw);
  };

  /** moon(cx, cy, r, o): kind 'moon' (default) leaves the disc as bare paper and washes grey cloud around it (烘云托月:
   *  the moon is the paper nobody painted); kind 'sun' is a cinnabar disc with a soft bleeding edge. o: { kind, at, dur (1.6), tone } */
  B.moon = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.6, sun = o.kind === 'sun', tone = o.tone ?? (sun ? 0.85 : 0.4);
    const ext = sun ? r * 1.6 : r * 3.2, rgb = rgbOf(sun ? 'red' : 'ink');
    const k = (lt) => ease.out(clamp((lt - at) / dur));
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      if (sun) {
        c.save(); c.filter = `blur(${(r * 0.06).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * e); c.fill(blob(cx, cy, r, 9, 0.03)); c.restore();
        c.save(); c.filter = `blur(${(r * 0.3).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.22 * e); c.beginPath(); c.arc(cx, cy, r * 1.25, 0, Math.PI * 2); c.fill(); c.restore();
        return;
      }
      const g = c.createRadialGradient(cx, cy, r * 1.02, cx, cy, ext);
      g.addColorStop(0, rgba(rgb, tone * e)); g.addColorStop(0.18, rgba(rgb, tone * 0.6 * e)); g.addColorStop(1, rgba(rgb, 0));
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, ext, 0, Math.PI * 2); c.arc(cx, cy, r, 0, Math.PI * 2, true); c.fill();
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, cx - ext, cy - ext, ext * 2, ext * 2, o, draw);
  };

  /** seal(x, y, str, o): a cinnabar seal stamped onto the paper at its top-left (x, y): it presses down (1.5× → 1×) and
   *  the ink bites in with a speckled worn face. The one loud colour of the style — at most one per screen, on the
   *  answer, the conclusion or the name. str: 1–4 characters (4 read in two columns, right to left). o: { size (96),
   *  at, white (true: 白文, characters cut out of red; false: 朱文, red characters in a red frame), color ('red') } */
  B.seal = function (x, y, str, o = {}) {
    const size = o.size ?? 96, at = o.at ?? 0, white = o.white ?? true, rgb = rgbOf(o.color || 'red'), chars = [...String(str)].slice(0, 4);
    const pad = size * 0.4, face = offscreen(size, size), g = face.getContext('2d'), r = PV.rng(PV.hashStr(String(str)) + 5);
    const edge = new Path2D(); const jit = () => (r() - 0.5) * size * 0.025;
    edge.moveTo(jit(), jit()); edge.lineTo(size + jit(), jit()); edge.lineTo(size + jit(), size + jit()); edge.lineTo(jit(), size + jit()); edge.closePath();
    const cols = chars.length === 4 ? [[chars[0], chars[1]], [chars[2], chars[3]]] : chars.length === 3 ? [[chars[0]], [chars[1], chars[2]]] : [chars];
    const drawChars = () => {
      const cw = size / cols.length;
      cols.forEach((cc, ci) => cc.forEach((ch, ri) => {
        const fs = Math.min(cw, size / cc.length) * 0.86;
        g.font = `400 ${fs}px "Ma Shan Zheng", "Noto Serif SC Variable", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, size - cw * (ci + 0.5), (size / cc.length) * (ri + 0.5) + fs * 0.04);
      }));
    };
    let built = false;
    const build = () => {   // after the fonts load
      if (built) return; built = true;
      g.clearRect(0, 0, size, size);
      if (white) { g.fillStyle = rgba(rgb, 1); g.fill(edge); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; drawChars(); }
      else { g.fillStyle = rgba(rgb, 1); drawChars(); g.strokeStyle = rgba(rgb, 1); g.lineWidth = size * 0.07; g.stroke(edge); }
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < size * 0.9; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillRect(r() * size, r() * size, 1 + r() * size * 0.03, 1 + r() * size * 0.02); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    };
    const k = (lt) => clamp((lt - at) / 0.26);
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      build();
      const s = lerp(1.5, 1, ease.out(e));
      c.save(); c.globalAlpha = (0.15 + 0.85 * e) * 0.92; c.translate(x + size / 2, y + size / 2); c.scale(s, s); c.rotate(-0.02);
      c.drawImage(face, -size / 2, -size / 2); c.restore();
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x - pad, y - pad, size + pad * 2, size + pad * 2, o, draw);
  };

  /** vtext(str, x, y, o): a vertical column of characters written top to bottom (right-to-left for several columns:
   *  separate them with \n), in brush calligraphy by default. (x, y) is the column's top-left. Use it for a poem line,
   *  a quotation, a name, a key phrase standing beside the picture like an inscription (题款). o: { size (64), at,
   *  cps (6), color ('ink'), font ('brush' | 'hand' for the serif body face), weight } */
  B.vtext = function (str, x, y, o = {}) {
    return this.text(str, { lh: 1.5, cps: 6, size: 64, ...o, x, y, font: o.font || 'brush', cls: 'vt' + (o.cls ? ' ' + o.cls : '') });
  };

  /** bigChar(ch, cx, cy, o): one huge calligraphic character (or two) centred on (cx, cy), swept in by the brush from
   *  top-left to bottom-right with a bleed of wet ink behind it that slowly spreads. The style's title card and its
   *  strongest beat: the one word the page is about (道, 鹏, 空, 变). o: { size (440), at, dur (1.1), color ('ink') } */
  B.bigChar = function (ch, cx, cy, o = {}) {
    const size = o.size ?? 440, at = o.at ?? 0, dur = o.dur ?? 1.1, c = col(o.color || 'ink');
    const mk = (cls) => {
      const el = PV.h('div', 'tx brush ' + cls, null, this.html);
      el.textContent = ch;
      Object.assign(el.style, { left: cx + 'px', top: cy + 'px', fontSize: size + 'px', lineHeight: '1', color: c, whiteSpace: 'nowrap', transform: 'translate(-50%, -50%)', pointerEvents: 'none' });
      return el;
    };
    const bleed = mk('ink-bleed'), el = mk('');
    Object.assign(bleed.style, { filter: `blur(${Math.round(size * 0.025)}px)`, mixBlendMode: 'multiply' });
    el.style.mixBlendMode = 'multiply';
    const st = { out: o.out, outDur: 0.6 };
    this.tick((lt) => {
      const k = clamp((lt - at) / dur), e = ease.inOut(k), out = st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1;
      const m = `linear-gradient(160deg, #000 ${(e * 130 - 20).toFixed(1)}%, transparent ${(e * 130 - 4).toFixed(1)}%)`;
      el.style.maskImage = el.style.webkitMaskImage = m;
      el.style.opacity = (out * (k > 0 ? 1 : 0)).toFixed(3);
      const spread = 1 + 0.05 * ease.out(clamp((lt - at) / (dur + 6)));
      bleed.style.opacity = (out * 0.32 * ss(0.3, 1, k)).toFixed(3);
      bleed.style.transform = `translate(-50%, -50%) scale(${spread.toFixed(4)})`;
    });
    return { el, hide(t, d = 0.6) { st.out = t; st.outDur = d; return this; } };
  };

  // ── creatures ──
  /** inkFish(pose, o): a great ink fish in the manner of Bada Shanren — a soft wash body darker along the back, a
   *  dry-brush spine stroke, fins and a forked tail that beat, an eye ringed with bare paper. It swims: its body waves
   *  as it moves. pose(lt) → { x, y, ang (radians, heading; 0 = swimming right), s (scale, 1) } places its head. len
   *  is its length in px at s = 1 (a carp 360; a 鲲 crossing the whole frame 1500). o: { at, dur (fade-in 0.8), tone
   *  (0.8), color ('ink'), beat (tail beats a second, 1.6), op (lt → opacity), seed } */
  B.inkFish = function (pose, len = 420, o = {}) {
    const at = o.at ?? 0, tone = o.tone ?? 0.8, beat = o.beat ?? 1.6, rgb = rgbOf(o.color), seed = o.seed ?? seedN++;
    // half-width along the body, head (0) to tail root (1): a blunt round head, plump front, a slim tail root
    const prof = (u) => (u < 0.1 ? 0.62 + 3.4 * u - 13 * u * u : u < 0.38 ? 1 - 0.6 * Math.pow((u - 0.24) / 0.14, 2) * 0.12 : lerp(0.98, 0.16, Math.pow((u - 0.38) / 0.62, 1.15)));
    const draw = (c, lt) => {
      const vis = ease.out(clamp((lt - at) / (o.dur ?? 0.8))); if (vis <= 0) return;
      const p = pose(lt), s = p.s ?? 1, L = len * s, ang = p.ang ?? 0, ph = lt * beat * Math.PI * 2;
      const bodyL = L * 0.78, Wm = L * 0.13, N = 30;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const spine = [], nrm = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, lat = L * 0.06 * Math.pow(u, 1.8) * Math.sin(u * 3.6 - ph);
        spine.push([p.x - ca * bodyL * u - sa * lat, p.y - sa * bodyL * u + ca * lat]);
      }
      for (let i = 0; i <= N; i++) { const A = spine[Math.max(0, i - 1)], Bq = spine[Math.min(N, i + 1)], dx = Bq[0] - A[0], dy = Bq[1] - A[1], d = Math.hypot(dx, dy) || 1; nrm.push([-dy / d, dx / d]); }   // points to the back (up when swimming right)
      const side = (k, f) => spine.map(([x, y], i) => [x + nrm[i][0] * Wm * prof(i / N) * k, y + nrm[i][1] * Wm * prof(i / N) * k]);
      const back = side(1, 1), belly = side(-1, 1);
      const outline = new Path2D();
      back.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
      for (let i = N; i >= 0; i--) outline.lineTo(belly[i][0], belly[i][1]);
      outline.closePath();
      c.save(); c.globalAlpha = vis;
      // tail fan first (under the body): two broad blades and a fine centre, beating
      const root = spine[N], tdir = Math.atan2(spine[N][1] - spine[N - 3][1], spine[N][0] - spine[N - 3][0]) + Math.sin(ph - 1.2) * 0.25;
      const cn = o.color || 'ink';
      [[-0.5, 1, -0.16], [0.5, 1, 0.16], [-0.18, 0.7, -0.05], [0.18, 0.7, 0.05]].forEach(([d, l, bend], i) => feather(c, root[0], root[1], tdir + d, L * 0.27 * l, L * 0.07 * (i < 2 ? 1 : 0.6), tone * (i < 2 ? 0.8 : 0.5), cn, bend, seed + 20 + i, 0.6));
      // paper under the body (the fish is in front of what is behind it), then a soft halo and the washes
      c.save(); c.filter = `blur(${(L * 0.006 + 1).toFixed(1)}px)`; c.fillStyle = rgba(PAPER, 0.9); c.fill(outline); c.restore();
      c.filter = `blur(${(L * 0.014 + 1).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.22); c.fill(outline);
      c.filter = 'none';
      const mid = spine[Math.round(N * 0.3)], n0 = nrm[Math.round(N * 0.3)];
      const gr = c.createLinearGradient(mid[0] + n0[0] * Wm, mid[1] + n0[1] * Wm, mid[0] - n0[0] * Wm, mid[1] - n0[1] * Wm);
      gr.addColorStop(0, rgba(rgb, tone * 0.85)); gr.addColorStop(0.45, rgba(rgb, tone * 0.45)); gr.addColorStop(1, rgba(rgb, tone * 0.06));
      c.fillStyle = gr; c.filter = `blur(${(L * 0.003 + 0.6).toFixed(1)}px)`; c.fill(outline);
      c.beginPath(); c.ellipse(spine[1][0], spine[1][1], Wm * 0.62, Wm * 0.6, ang, 0, Math.PI * 2); c.fill(); c.filter = 'none';   // the round snout
      // a second wash, irregular, along the back (the ink pooled where the brush lay)
      c.save(); c.clip(outline); c.filter = `blur(${(L * 0.01 + 1).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.35);
      c.fill(ribbon(side(0.55, 1).slice(1, N - 2), (u) => Wm * 0.7 * prof(u) + Wm * 0.15 * noise(u * 5, seed))); c.restore();
      // the back: one confident dry stroke; the belly: a thin pale line that breaks
      brush(c, back.slice(2, N - 1), { w: L * 0.045, tone: Math.min(1, tone * 1.15), dry: 0.55, seed, bristles: 8, head: 0.1, tail: 0.45 });
      brush(c, belly.slice(4, N - 3).filter((_, i) => i % 3 === 0), { w: L * 0.01, tone: tone * 0.5, dry: 0.8, seed: seed + 1, bristles: 3 });
      // dorsal fin on the back, a pelvic fin under the belly, a paddling pectoral fin behind the gill
      const dj = Math.round(N * 0.42), dpt = back[dj], dang = Math.atan2(back[dj + 2][1] - back[dj][1], back[dj + 2][0] - back[dj][0]);
      feather(c, dpt[0], dpt[1], dang - 0.32, L * 0.22, L * 0.05, tone * 0.85, cn, -0.2, seed + 30, 0.55);
      feather(c, back[dj + 3][0], back[dj + 3][1], dang - 0.22, L * 0.15, L * 0.03, tone * 0.6, cn, -0.15, seed + 31, 0.7);
      const vj = Math.round(N * 0.55), vpt = belly[vj];
      feather(c, vpt[0], vpt[1], dang + 0.5, L * 0.1, L * 0.028, tone * 0.6, cn, 0.1, seed + 32, 0.6);
      const pj = Math.round(N * 0.24), ppt = spine[pj];
      feather(c, ppt[0] - nrm[pj][0] * Wm * 0.3, ppt[1] - nrm[pj][1] * Wm * 0.3, dang + 0.75 + Math.sin(ph * 1.4) * 0.3, L * 0.13, L * 0.035, tone * 0.8, cn, 0.12, seed + 33, 0.5);
      // gill: a curved dry stroke; head cap darker
      const gj = Math.round(N * 0.17);
      brush(c, [[back[gj][0] * 0.8 + spine[gj][0] * 0.2, back[gj][1] * 0.8 + spine[gj][1] * 0.2], [spine[gj - 1][0], spine[gj - 1][1]], [belly[gj][0] * 0.7 + spine[gj][0] * 0.3, belly[gj][1] * 0.7 + spine[gj][1] * 0.3]], { w: L * 0.016, tone: tone * 0.9, dry: 0.5, seed: seed + 3, bristles: 4 });
      // the eye, high on the head, ringed with bare paper; the mouth
      const ej = Math.round(N * 0.06), ex = spine[ej][0] + nrm[ej][0] * Wm * 0.32, ey = spine[ej][1] + nrm[ej][1] * Wm * 0.32;
      c.fillStyle = rgba(PAPER, 0.96); c.beginPath(); c.arc(ex, ey, L * 0.022, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba(rgb, Math.min(1, tone * 1.1)); c.lineWidth = Math.max(1.5, L * 0.005); c.stroke();
      c.fillStyle = rgba(rgb, 0.95); c.beginPath(); c.arc(ex + nrm[ej][0] * L * 0.007, ey + nrm[ej][1] * L * 0.007, L * 0.009, 0, Math.PI * 2); c.fill();
      brush(c, [[p.x - nrm[0][0] * Wm * 0.1, p.y - nrm[0][1] * Wm * 0.1], [p.x - ca * L * 0.04 - nrm[0][0] * Wm * 0.25, p.y - sa * L * 0.04 - nrm[0][1] * Wm * 0.25]], { w: L * 0.012, tone, dry: 0.2, seed: seed + 2, bristles: 3 });
      c.restore();
    };
    return mount(this, -80, -60, W + 160, H + 120, o, draw);
  };

  /** inkBird(pose, span, o): a great bird in flight (crane, wild goose, the 鹏) drawn in brush — wings of tapered
   *  feather strokes over a pale wash, splayed primaries at the tips, beating up and down; a dark head and a trailing
   *  tail. pose(lt) → { x, y, ang (heading, 0 = flying right; flying left it is mirrored, never upside down), s (scale) }
   *  places its body centre; span is its size in px at s = 1 (a swallow 160; the 鹏 filling the sky 1600). o: { at,
   *  dur (fade-in 0.8), tone (0.85), flap (beats a second, 0.9; slow and grand for a huge bird: 0.35), neck (true: a
   *  crane's long neck), legs (true: trailing legs), crown (true: a red crown), color ('ink'), op (lt → opacity), seed } */
  B.inkBird = function (pose, span = 600, o = {}) {
    const at = o.at ?? 0, tone = o.tone ?? 0.85, flap = o.flap ?? 0.9, rgb = rgbOf(o.color), seed = o.seed ?? seedN++;
    const draw = (c, lt) => {
      const vis = ease.out(clamp((lt - at) / (o.dur ?? 0.8))); if (vis <= 0) return;
      const p = pose(lt), s = (p.s ?? 1) * span, ang = p.ang ?? 0, ph = lt * flap * Math.PI * 2;
      const flip = Math.cos(ang) < 0;   // flying left: mirror so the bird stays upright
      c.save(); c.globalAlpha = vis; c.translate(p.x, p.y); c.rotate(flip ? ang + Math.PI : ang); if (flip) c.scale(-1, 1);
      // a wing in 3D: it rotates about the body axis by the flap angle th (+ up) and is seen obliquely, so a level wing
      // points toward the viewer instead of collapsing; side +1 is the near wing, -1 the far one. The trailing edge is
      // always behind (toward -x), so the feathers sweep back the way they do in a painting.
      const wing = (th, side, tn, sd) => {
        const L = s * 0.5, R = [s * 0.03, -s * 0.03];
        const z = side * L * Math.cos(th), tip = [R[0] - s * 0.1 + 0.32 * z, R[1] - L * Math.sin(th) + 0.28 * z];
        const elbow = [lerp(R[0], tip[0], 0.45) + s * 0.03, lerp(R[1], tip[1], 0.45) - s * 0.03];
        const lead = (q) => (q < 0.45 ? [lerp(R[0], elbow[0], q / 0.45), lerp(R[1], elbow[1], q / 0.45)] : [lerp(elbow[0], tip[0], (q - 0.45) / 0.55), lerp(elbow[1], tip[1], (q - 0.45) / 0.55)]);
        const at2 = (q, back) => { const [x, y] = lead(q), ch = s * 0.17 * (1.3 - 0.85 * q); return [x - ch * back, y + ch * back * 0.18]; };
        const shape = [at2(0, -0.1), at2(0.45, -0.12), at2(1, 0), at2(0.85, 0.7), at2(0.5, 1), at2(0.15, 1.05), at2(0, 0.8)];
        c.save(); c.filter = `blur(${Math.max(1, s * 0.004).toFixed(1)}px)`;
        c.fillStyle = rgba(PAPER, 0.85); c.beginPath(); shape.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
        c.fillStyle = rgba(rgb, tn * 0.3); c.fill(); c.restore();
        // wide wet sweeps from the leading edge back to the trailing edge, then dry primaries splayed at the tip
        for (let i = 0; i < 6; i++) {
          const q = 0.03 + i * 0.12;
          brush(c, [at2(q, -0.05), at2(q + 0.02, 0.5), at2(q + 0.04, 1.05 - i * 0.07)], { w: s * (0.075 - i * 0.006), tone: tn * (0.55 + i * 0.05), dry: 0.42, seed: seed + sd * 50 + i, head: 0.22, tail: 0.55, color: cn });
        }
        const td = Math.atan2(tip[1] - elbow[1], tip[0] - elbow[0]), pa = Math.atan2(Math.sin(td) * 0.45, Math.cos(td) * 0.45 - 0.55);   // out along the hand, swept back
        for (let i = 0; i < 5; i++) { const q = 0.8 + i * 0.05, [x, y] = at2(q, 0.1 + i * 0.12); feather(c, x, y, pa + (i - 2) * 0.13 + Math.sin(ph + i) * 0.03, s * (0.13 + (4 - Math.abs(i - 2)) * 0.012), s * 0.03, Math.min(1, tn * 1.1), cn, -0.05, seed + sd * 70 + i, 0.4, 0.2); }
        brush(c, [lead(0), lead(0.25), lead(0.45), lead(0.75), lead(1)], { w: s * 0.028, tone: Math.min(1, tn * 1.1), dry: 0.5, seed: seed + sd, head: 0.05, tail: 0.55, color: cn });
      };
      const th = 0.35 + 0.8 * Math.sin(ph), th2 = 0.35 + 0.8 * Math.sin(ph - 0.25), cn = o.color || 'ink';
      wing(th2, -1, tone * 0.5, 1);   // far wing
      // body: a long teardrop wash; tail feathers; legs trailing (crane) when o.legs
      c.save(); c.filter = `blur(${Math.max(1, s * 0.003).toFixed(1)}px)`; c.fillStyle = rgba(rgb, tone * 0.55);
      c.beginPath(); c.ellipse(-s * 0.02, 0, s * 0.13, s * 0.04, 0.04, 0, Math.PI * 2); c.fill(); c.restore();
      brush(c, [[s * 0.1, -s * 0.03], [-s * 0.02, -s * 0.04], [-s * 0.13, -s * 0.015]], { w: s * 0.022, tone: tone * 0.9, dry: 0.5, seed: seed + 7, bristles: 6 });
      [-0.1, 0.05, 0.18].forEach((d, i) => feather(c, -s * 0.1, s * 0.005, Math.PI + d + Math.sin(ph * 0.5) * 0.04, s * (0.17 - i * 0.02), s * 0.03, tone * (0.9 - i * 0.12), cn, 0.05, seed + 90 + i, 0.6, 0.2));
      if (o.legs) brush(c, [[-s * 0.08, s * 0.03], [-s * 0.22, s * 0.05], [-s * 0.36, s * 0.06]], { w: s * 0.012, tone: tone * 0.8, dry: 0.3, seed: seed + 9, bristles: 3 });
      // neck and head (a long neck when o.neck, e.g. a crane), the eye left as paper, the beak
      const nk = o.neck ? 0.16 : 0.06;
      brush(c, [[s * 0.08, -s * 0.01], [s * (0.1 + nk * 0.6), -s * 0.03], [s * (0.12 + nk), -s * 0.035]], { w: s * 0.034, tone: tone * 0.95, dry: 0.25, seed: seed + 5, bristles: 6, head: 0.05, tail: 0.15 });
      const hx = s * (0.135 + nk), hy = -s * 0.038;
      c.fillStyle = rgba(rgb, Math.min(1, tone * 1.1)); c.beginPath(); c.ellipse(hx, hy, s * 0.026, s * 0.019, -0.1, 0, Math.PI * 2); c.fill();
      if (o.crown) { c.fillStyle = rgba(rgbOf('red'), 0.9); c.beginPath(); c.arc(hx - s * 0.004, hy - s * 0.014, s * 0.008, 0, Math.PI * 2); c.fill(); }
      leaf(c, hx + s * 0.018, hy + s * 0.002, 0.12, s * (o.neck ? 0.07 : 0.045), s * 0.01, Math.min(1, tone * 1.1), rgb, 0);
      c.fillStyle = rgba(PAPER, 0.96); c.beginPath(); c.arc(hx + s * 0.006, hy - s * 0.004, Math.max(1.6, Math.min(5, s * 0.0045)), 0, Math.PI * 2); c.fill();
      wing(th, 1, tone, 2);   // near wing on top
      c.restore();
    };
    return mount(this, -80, -60, W + 160, H + 120, o, draw);
  };

  /** bamboo(x, y, o): a bamboo branch entering from (x, y) — a jointed pale stalk and clusters of dark 个-shaped leaves
   *  that sway in the wind. A frame-edge accent (enter from a top corner) that gives a still page constant life.
   *  o: { len (520), ang (radians, the branch's direction; 2.4 = down-left), at, dur (1.2), tone (0.85), wind (1), seed } */
  B.bamboo = function (x, y, o = {}) {
    const len = o.len ?? 520, ang = o.ang ?? 2.4, at = o.at ?? 0, dur = o.dur ?? 1.2, tone = o.tone ?? 0.85, wind = o.wind ?? 1, seed = o.seed ?? seedN++;
    const rgb = rgbOf('ink'), r = PV.rng(seed * 17), nodes = 5;
    const groups = Array.from({ length: 6 }, (_, i) => ({ ni: 1 + (i % 4), a0: (r() - 0.5) * 2.4, n: 3 + (i % 2), l: 0.8 + r() * 0.5 }));
    const draw = (c, lt) => {
      const rev = clamp((lt - at) / dur); if (rev <= 0) return;
      const sw = (Math.sin(lt * 2.3) * 0.06 + Math.sin(lt * 5.1 + 1) * 0.02) * wind;
      const pt = (q) => { const a = ang + sw * q; return [x + Math.cos(a) * len * q, y + Math.sin(a) * len * q]; };
      for (let i = 0; i < nodes; i++) {
        const a = pt(i / nodes + 0.012), b = pt((i + 1) / nodes - 0.012);
        brush(c, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b], { w: len * 0.026, tone: tone * 0.55, dry: 0.3, seed: seed + i, reveal: ss(i / nodes, (i + 1) / nodes, rev * 1.6), head: 0.06, tail: 0.1, bristles: 5 });
      }
      groups.forEach((g, gi) => {
        const k = ss(0.35 + gi * 0.08, 0.6 + gi * 0.08, rev); if (k <= 0) return;
        const [px, py] = pt(g.ni / nodes), fl = Math.sin(lt * 6 + gi * 1.3) * 0.16 * wind;
        for (let j = 0; j < g.n; j++) leaf(c, px, py, ang + 0.9 + g.a0 + (j - 1) * 0.42 + fl * (1 + j * 0.3) + sw * 2, len * 0.2 * g.l * k * (j === 0 ? 1 : 0.8), len * 0.03, tone, rgb, 0.1);
      });
    };
    const ext = len * 1.3;
    return mount(this, x - ext, y - ext, ext * 2, ext * 2, o, draw);
  };

  /** sage(x, y, o): a tiny figure in a scholar's robe, a few brush strokes, standing with feet at (x, y) — the human
   *  scale in a vast landscape (put it small: h 90–160, beside a huge mountain, under the great bird, on a boat).
   *  o: { h (130), facing (1 right, -1 left), at, dur (0.9), tone (0.85), robe ('blue' indigo wash; null for none) } */
  B.sage = function (x, y, o = {}) {
    const h = o.h ?? 130, f = o.facing ?? 1, at = o.at ?? 0, dur = o.dur ?? 0.9, tone = o.tone ?? 0.85, seed = o.seed ?? seedN++;
    const P2 = (dx, dy) => [x + dx * h * f, y - dy * h];
    const strokes = [
      { p: [P2(0.02, 0.86), P2(-0.06, 0.6), P2(-0.16, 0.25), P2(-0.2, 0.02)], w: h * 0.05, dry: 0.4 },   // back of the robe
      { p: [P2(0.06, 0.82), P2(0.12, 0.55), P2(0.16, 0.25), P2(0.2, 0.02)], w: h * 0.04, dry: 0.5 },     // front
      { p: [P2(-0.2, 0.02), P2(0, 0.0), P2(0.2, 0.02)], w: h * 0.03, dry: 0.7 },                         // hem
      { p: [P2(0.05, 0.75), P2(0.2, 0.6), P2(0.26, 0.48)], w: h * 0.05, dry: 0.3 },                      // sleeve
      { p: [P2(-0.02, 0.8), P2(-0.14, 0.62), P2(-0.12, 0.46)], w: h * 0.04, dry: 0.4 },
    ];
    const draw = (c, lt) => {
      const rev = clamp((lt - at) / dur); if (rev <= 0) return;
      if (o.robe !== null) {
        c.save(); c.globalAlpha = ss(0.4, 1, rev); c.filter = 'blur(2px)'; c.fillStyle = rgba(rgbOf(o.robe || 'blue'), 0.35);
        c.beginPath(); [P2(0.03, 0.84), P2(0.18, 0.6), P2(0.21, 0.02), P2(-0.21, 0.02), P2(-0.12, 0.62)].forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill(); c.restore();
      }
      strokes.forEach((s, i) => brush(c, s.p, { w: s.w, tone, dry: s.dry, seed: seed + i, reveal: ss(i * 0.12, i * 0.12 + 0.45, rev), bristles: 5, head: 0.1, tail: 0.4 }));
      const k = ss(0.5, 0.8, rev); if (k <= 0) return;
      const [hx, hy] = P2(0.04, 0.93);
      c.fillStyle = rgba(rgbOf('ink'), tone * k); c.beginPath(); c.arc(hx, hy, h * 0.065, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(hx - h * 0.01 * f, hy - h * 0.07, h * 0.03, h * 0.04, 0, 0, Math.PI * 2); c.fill();   // topknot
    };
    return mount(this, x - h * 0.6, y - h * 1.2, h * 1.2, h * 1.35, o, draw);
  };

  // ── the page title: a vertical inscription in brush calligraphy down the right edge, closed by a small seal ──
  // (Latin titles stay horizontal at the top left, in the serif face, with the seal after them.)
  B.title = function (str, o = {}) {
    const at = o.at ?? 0.15, T = this.hud || this, chars = [...String(str)].filter((ch) => ch !== ' ');
    if (!/[㐀-鿿]/.test(str)) {
      const size = o.size ?? 52, t = T.text(str, { x: STAGE.title.x, y: STAGE.title.y - 4, size, weight: 600, at, cps: o.cps ?? 16, color: 'ink' });
      if (o.seal !== false) T.seal(STAGE.title.x + Math.min(W - 420, PV.tw(str, size) * 0.98) + 22, STAGE.title.y + 8, o.seal || '帧言', { size: 44, at: at + t.a.dur + 0.1 });
      return t;
    }
    const n = chars.length, size = o.size ?? (n > 12 ? 46 : n > 9 ? 52 : 60), adv = size * 1.12;
    const x = W - 130 - size, y = STAGE.title.y + 14;
    const t = T.text(str.replace(/\s+/g, ''), { x, y, size, at, cps: o.cps ?? 7, color: 'ink', font: 'brush', cls: 'vt', lh: 1.2 });
    if (o.seal !== false) T.seal(x + size / 2 - 20, y + n * adv + 22, o.seal || '帧言', { size: 40, at: at + t.a.dur + 0.1 });
    return t;
  };

  PV.INK = { brush, leaf, blob, noise, fbm, densify, resample, ribbon };
})();
