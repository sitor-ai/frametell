/* Woodblock · printing kit: every object is a print made of blocks — a black keyline cut in the key block, then flat
 * colour blocks pressed on one after another, each landing a few pixels off and settling (the hair of misregistration
 * stays), with bare paper speckling through the pigment and bokashi gradients where a colour fades into the paper.
 * The scenery of the floating world (a bokashi sky, a plain sun, a peak with a snow cap, rolling hills, mist bands,
 * scalloped seas and a great curling wave, rain, a pine, blossoms, a bridge, a boat, a traveller) and the frame of a
 * print (cartouches, a seal, vertical text). Every component is a pure function of page-local time lt. */
(function () {
  const { col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const C = (c) => col(c || 'ink');
  const rgbOf = (c) => { const h = String(C(c)).replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const rgba = (c, a) => { const v = Array.isArray(c) ? c : rgbOf(c); return `rgba(${v[0]},${v[1]},${v[2]},${a.toFixed(3)})`; };
  let seedN = 1;

  // ── noise (value noise, smooth, about [-1, 1]) ──
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), v)) * 2 - 1;
  };

  // ── polylines ──
  const densify = (pts, per = 8, closed = false) => {
    const src = closed ? pts.concat([pts[0]]) : pts, n = src.length, out = [];
    const P_ = (i) => (closed ? src[((i % (n - 1)) + (n - 1)) % (n - 1)] : src[Math.max(0, Math.min(n - 1, i))]);
    if (n < 3) return src.slice();
    for (let i = 0; i < n - 1; i++) {
      const p0 = P_(i - 1), p1 = P_(i), p2 = P_(i + 1), p3 = P_(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    out.push(src[n - 1]); return out;
  };
  const resample = (pts, step = 5) => {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let d = step - acc;
      while (d <= L) { const q = d / L; out.push([a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]); d += step; }
      acc = L - (d - step);
    }
    out.push(pts[pts.length - 1]); return out;
  };
  const toPath = (pts, closed) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); if (closed) p.closePath(); return p; };
  const shape = (pts, smooth, closed = true) => (smooth ? densify(pts, 8, closed) : closed ? pts : pts);
  const bbox = (pts, pad) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 - x0 + pad * 2), Math.ceil(y1 - y0 + pad * 2)];
  };

  // ── the woodblock surface: bare paper biting through the pigment, and a faint wood grain in the block ──
  let speckle;
  const speckles = (c) => {
    if (!speckle) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 320; const g = cv.getContext('2d'), r = PV.rng(77);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.55).toFixed(2)})`; g.beginPath(); g.ellipse(r() * 320, r() * 320, 0.5 + r() * 1.8, 0.4 + r() * 1.1, r() * 3, 0, 6.3); g.fill(); }
      for (let i = 0; i < 46; i++) { g.strokeStyle = `rgba(0,0,0,${(0.05 + r() * 0.1).toFixed(2)})`; g.lineWidth = 0.6 + r() * 1.4; const y = r() * 320; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 320; x += 20) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3); g.stroke(); }
      speckle = cv;
    }
    return c.createPattern(speckle, 'repeat');
  };
  /** fill a path as a printed colour block: flat or bokashi, then the paper bites through */
  function printFill(c, path, color, o, box) {
    const [bx, by, bw, bh] = box;
    if (o.boka) {
      const dir = o.boka, len = o.bokaLen ?? 0.6, rgb = rgbOf(color);
      const g = dir === 'top' ? c.createLinearGradient(0, by, 0, by + bh) : dir === 'bottom' ? c.createLinearGradient(0, by + bh, 0, by)
        : dir === 'left' ? c.createLinearGradient(bx, 0, bx + bw, 0) : c.createLinearGradient(bx + bw, 0, bx, 0);
      if (o.bokaTo) { g.addColorStop(0, rgba(rgb, 1)); g.addColorStop(clamp(len * 0.3), rgba(rgb, 1)); g.addColorStop(clamp(len), rgba(o.bokaTo, 1)); g.addColorStop(1, rgba(o.bokaTo, 1)); }
      else { g.addColorStop(0, rgba(rgb, 1)); g.addColorStop(clamp(len * 0.35), rgba(rgb, 0.92)); g.addColorStop(clamp(len), rgba(rgb, 0)); }
      c.fillStyle = g;
    } else c.fillStyle = C(color);
    c.fill(path);
    if (o.grain !== false) {
      c.save(); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = o.grainAlpha ?? 0.55; c.fillStyle = speckles(c);
      c.translate(bx % 320, by % 320); c.fill(path); c.restore();
    }
  }
  /** the printer's press: k 0..1 how far the block is printed, and the offset it lands at (it settles to a residual) */
  const press = (lt, at, dur, seed) => {
    const k = clamp((lt - at) / dur), r = PV.rng(seed * 13 + 1);
    const rx = (r() - 0.5) * 4, ry = (r() - 0.5) * 4, f = 1 - ease.out(k);
    return { a: ss(0, 0.4, k), dx: rx + f * (14 + r() * 8) * (r() < 0.5 ? -1 : 1), dy: ry + f * (10 + r() * 6) * (r() < 0.5 ? -1 : 1), k };
  };
  /** a keyline: even width, round ends, drawn on along its length (reveal 0..1) */
  function keyline(c, pts, w, color, reveal, closed, seed = 1) {
    if (reveal <= 0) return;
    const D = resample(closed ? pts.concat([pts[0]]) : pts, 5);
    const m = Math.max(2, Math.ceil(D.length * clamp(reveal)));
    c.save(); c.strokeStyle = C(color); c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < m; i++) { const j = noise(i * 0.06 + seed, seed * 3.1) * 0.7; i ? c.lineTo(D[i][0] + j, D[i][1] - j) : c.moveTo(D[i][0], D[i][1]); }
    c.stroke(); c.restore();
  }

  // ── mounting: one canvas per component; fades out at hide(t) / o.out ──
  function mount(self, x, y, w, h, o, draw) {
    const cv = PV.h('canvas', 'uk-cv', null, self.html);
    cv.width = Math.ceil(w); cv.height = Math.ceil(h);
    Object.assign(cv.style, { position: 'absolute', left: x + 'px', top: y + 'px', mixBlendMode: o.blend || 'normal', pointerEvents: 'none' });
    const ctx = cv.getContext('2d');
    const st = { out: o.out, outDur: o.outDur ?? 0.6 };
    let last = '';
    self.tick((lt) => {
      const op = (st.out != null ? 1 - ss(st.out, st.out + st.outDur, lt) : 1) * val(o.op, lt, 1);
      cv.style.opacity = op.toFixed(3);
      if (op <= 0.001) return;
      const key = draw.key ? draw.key(lt) : null;   // a settled frame redraws nothing
      if (key != null && key === last) return;
      last = key;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save(); ctx.translate(-x, -y); draw(ctx, lt); ctx.restore();
    });
    return { el: cv, hide(t, d = 0.6) { st.out = t; st.outDur = d; return this; } };
  }
  /** a print of several blocks in one canvas: blocks [{ path, color, boka, bokaLen, bokaTo, grain }], a key block (lines)
   *  drawn first, colours pressed after it in order. Returns the draw function. */
  function printer(blocks, lines, o, box) {
    const at = o.at ?? 0, dur = o.dur ?? 1.4, seed = o.seed ?? seedN++, lw = o.lw ?? 4.5, lc = o.line ?? 'ink';
    const nB = blocks.length, keyDur = lines.length ? dur * 0.45 : 0;
    const draw = (c, lt) => {
      blocks.forEach((b, i) => {
        const t0 = at + keyDur * 0.55 + (i * (dur - keyDur * 0.55)) / Math.max(1, nB) * 0.8, p = press(lt, t0, (dur - keyDur * 0.55) / Math.max(1, nB) * 1.2, seed + i);
        if (p.a <= 0) return;
        c.save(); c.globalAlpha = p.a; c.translate(p.dx, p.dy); printFill(c, b.path, b.color, b, box); c.restore();
      });
      if (lc && lines.length) lines.forEach((l, i) => keyline(c, l.pts, l.w ?? lw, lc, ease.inOut(clamp((lt - at - (i * keyDur) / lines.length * 0.6) / Math.max(0.2, keyDur * 0.7))), l.closed, seed + i));
    };
    draw.key = (lt) => (lt > at + dur * 1.3 + 0.5 ? 'done' : lt.toFixed(3));
    return draw;
  }

  /** block(pts, o): one flat colour block in the shape of polygon pts [[x,y],…] (smooth: true rounds it into curves),
   *  outlined by a keyline drawn on first, then the colour pressed in a few pixels off and settling. The workhorse:
   *  draw any object (a house, a fan, a coin, a field, a robe, a bar of a chart) as one block or a few stacked ones.
   *  o: { color ('blue'), at, dur (1.0), smooth (false), line ('ink'; false for no keyline), lw (4.5), boka ('top' |
   *  'bottom' | 'left' | 'right': the colour fades into the paper that way), bokaLen (0.6), bokaTo (a second colour at
   *  the far end), grain (true), seed } */
  B.block = function (pts, o = {}) {
    const P2 = shape(pts, o.smooth), [x, y, w, h] = bbox(P2, 30), path = toPath(P2, true);
    const draw = printer([{ path, color: o.color ?? 'blue', boka: o.boka, bokaLen: o.bokaLen, bokaTo: o.bokaTo, grain: o.grain }], o.line === false ? [] : [{ pts: P2, closed: true }], { dur: 1.0, ...o }, [x, y, w, h]);
    return mount(this, x, y, w, h, o, draw);
  };

  /** keyline(pts, o): a black key-block line drawn on along points pts — open (a road, a horizon, a branch, an arrow's
   *  shaft, a river) or closed. Even width, round ends, no sketchiness. o: { at, dur (0.7), w (4.5), color ('ink'),
   *  smooth (true), closed (false) } */
  B.keyline = function (pts, o = {}) {
    const P2 = o.smooth === false ? pts : densify(pts, 8, !!o.closed), w = o.w ?? 4.5, at = o.at ?? 0, dur = o.dur ?? 0.7;
    const [x, y, bw, bh] = bbox(P2, w + 10), seed = o.seed ?? seedN++;
    const k = (lt) => ease.inOut(clamp((lt - at) / dur));
    const draw = (c, lt) => keyline(c, P2, w, o.color, k(lt), !!o.closed, seed);
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x, y, bw, bh, o, draw);
  };

  /** sky(o): the print's sky: a band of colour printed across the top that fades into the paper (bokashi) — Prussian
   *  blue by day, indigo by night, with an optional warm band rising from the horizon (dawn, dusk). Print it first, at
   *  lt 0, under everything. o: { color ('blue'), to (0.62: how far down the fade reaches, as a share of the frame),
   *  horizon (a colour for a glow above the horizon, e.g. 'redF' or 'yellow'), hy (720: horizon y), at, dur (1.2) } */
  B.sky = function (o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.2, to = o.to ?? 0.62, hy = o.hy ?? STAGE.area.y1 - 160, rgb = rgbOf(o.color || 'blue');
    const k = (lt) => clamp((lt - at) / dur);
    const draw = (c, lt) => {
      const e = ss(0, 1, k(lt)); if (e <= 0) return;
      const drop = (1 - ease.out(k(lt))) * -40;
      const g = c.createLinearGradient(0, drop, 0, H * to + drop);
      g.addColorStop(0, rgba(rgb, 0.98 * e)); g.addColorStop(0.18, rgba(rgb, 0.92 * e)); g.addColorStop(0.55, rgba(rgb, 0.42 * e)); g.addColorStop(1, rgba(rgb, 0));
      c.fillStyle = g; c.fillRect(-40, -40, W + 80, H * to + 80);
      if (o.horizon) {
        const hr = rgbOf(o.horizon), g2 = c.createLinearGradient(0, hy, 0, hy - 260);
        g2.addColorStop(0, rgba(hr, 0.85 * e)); g2.addColorStop(1, rgba(hr, 0));
        c.fillStyle = g2; c.fillRect(-40, hy - 260, W + 80, 262);
      }
      c.save(); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.35; c.fillStyle = speckles(c); c.fillRect(-40, -40, W + 80, H); c.restore();
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, -40, -40, W + 80, H + 80, o, draw);
  };

  /** sun(cx, cy, r, o): a plain flat disc — vermilion sun, or a pale moon ('paper' / 'yellow'), with a keyline. It rises
   *  into place (dy px below → its spot). Never rays. o: { color ('red'), at, dur (1.2), rise (60), line (true) } */
  B.sun = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.2, rise = o.rise ?? 60, color = o.color ?? 'red';
    const k = (lt) => clamp((lt - at) / dur);
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      const yy = cy + (1 - ease.out(e)) * rise, p = new Path2D(); p.arc(cx, yy, r, 0, Math.PI * 2);
      c.save(); c.globalAlpha = ss(0, 0.4, e); printFill(c, p, color, { grainAlpha: 0.35 }, [cx - r, yy - r, r * 2, r * 2]); c.restore();
      if (o.line !== false) { c.strokeStyle = C('ink'); c.lineWidth = 4; c.globalAlpha = ss(0.2, 0.7, e); c.stroke(p); c.globalAlpha = 1; }
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, cx - r - 20, cy - r - 20, r * 2 + 40, r * 2 + rise + 40, o, draw);
  };

  /** peak(x, baseY, w, h, o): a great mountain in the manner of the Fuji views — a broad cone (x = its centre, baseY its
   *  foot) in indigo fading to Prussian blue at the foot, a snow cap with a jagged lower edge, keylined; kind 'red' prints
   *  it red-brown at dawn. Prints in block by block. o: { kind ('snow' | 'red' | 'green'), snow (0.3: share of the height
   *  under snow), at, dur (1.6), seed } */
  B.peak = function (x, baseY, w, h, o = {}) {
    const seed = o.seed ?? seedN++, r = PV.rng(seed), kind = o.kind ?? 'snow', sn = o.snow ?? 0.3, top = baseY - h;
    const left = [], right = [];
    for (let i = 0; i <= 10; i++) { const q = i / 10, yy = top + h * Math.pow(q, 1.0), spread = (w / 2) * Math.pow(q, 0.72); left.push([x - spread * 0.18 - spread * 0.82 - (r() - 0.5) * 6, yy]); right.push([x + spread * 0.18 + spread * 0.82 + (r() - 0.5) * 6, yy]); }
    const capW = w * 0.08, body = [[x - capW, top + 4], ...left.slice(1).map((p) => p), ...right.slice(1).reverse(), [x + capW, top + 4]];
    const P2 = densify(body, 6, true), path = toPath(P2, true);
    const snowY = top + h * sn;
    const flankX = (yy, side) => { const q = clamp((yy - top) / h), spread = (w / 2) * Math.pow(q, 0.72); return x + side * Math.max(capW, spread); };
    const zig = []; const nz = 11;
    for (let i = 0; i <= nz; i++) { const q = i / nz, yy = snowY + (i % 2 ? h * (0.05 + r() * 0.09) : -h * 0.01); zig.push([lerp(flankX(snowY, 1) - 4, flankX(snowY, -1) + 4, q), yy]); }
    const capPts = [];
    for (let i = 0; i <= 6; i++) { const yy = lerp(snowY, top + 4, i / 6); capPts.push([flankX(yy, -1) + 2, yy]); }
    for (let i = 0; i <= 6; i++) { const yy = lerp(top + 4, snowY, i / 6); capPts.push([flankX(yy, 1) - 2, yy]); }
    const snow = toPath(capPts.concat(zig), true);
    const bodyColor = kind === 'red' ? '#9C3B22' : kind === 'green' ? 'green' : 'purple';
    const blocks = [
      { path, color: bodyColor, boka: 'bottom', bokaLen: 0.75, bokaTo: kind === 'red' ? 'orange' : 'blue' },
      { path: snow, color: 'paper', grain: false },
    ];
    const [bx, by, bw, bh] = bbox(P2, 30);
    const draw = printer(blocks, [{ pts: P2.slice(0, -1).concat([P2[0]]), closed: false }, { pts: zig, closed: false, w: 3.5 }], { dur: 1.6, ...o, seed }, [bx, by, bw, bh]);
    return mount(this, bx, by, bw, bh + 40, o, draw);
  };

  /** hills(o): a band of rolling hills across the bottom of the view, two or three ranges, far ones paler, each a
   *  keylined block with a bokashi crest; dotted with tiny trees. o: { y (760: top of the near range), ranges (3),
   *  colors (['greenF', 'green', 'purple']), trees (true), at, dur (1.6), seed } */
  B.hills = function (o = {}) {
    const y = o.y ?? STAGE.area.y1 - 120, n = o.ranges ?? 3, seed = o.seed ?? seedN++, r = PV.rng(seed);
    const colors = o.colors ?? ['#9DB39A', '#6F8E63', '#3F5E45'].slice(3 - n);
    const light = (c) => { const v = rgbOf(c); return '#' + v.map((x) => Math.round(lerp(x, 236, 0.45)).toString(16).padStart(2, '0')).join(''); };
    const blocks = [], lines = [];
    for (let i = 0; i < n; i++) {
      const yy = y - (n - 1 - i) * 70, amp = 30 + r() * 40, ph = r() * 6, pts = [];
      for (let xx = -60; xx <= W + 60; xx += 60) pts.push([xx, yy + Math.sin(xx * 0.004 + ph) * amp + Math.sin(xx * 0.011 + ph * 2) * amp * 0.35]);
      const ridge = densify(pts, 4), poly = ridge.concat([[W + 60, H + 40], [-60, H + 40]]);
      blocks.push({ path: toPath(poly, true), color: colors[i] ?? 'green', boka: 'top', bokaLen: 0.5, bokaTo: light(colors[i] ?? 'green') });
      lines.push({ pts: ridge, closed: false });
      if (o.trees !== false && i === n - 1) {
        for (let t = 0; t < 7; t++) {
          const tx = 120 + r() * (W - 240), ty = ridge[Math.min(ridge.length - 1, Math.round(((tx + 60) / (W + 120)) * (ridge.length - 1)))][1];
          const tp = new Path2D(); tp.ellipse(tx, ty - 14, 14, 20, 0, 0, Math.PI * 2);
          blocks.push({ path: tp, color: '#2F4A33', grain: false });
        }
      }
    }
    const draw = printer(blocks, lines, { dur: 1.6, ...o, seed }, [-60, y - 260, W + 120, H - y + 300]);
    return mount(this, -60, y - (n - 1) * 70 - 120, W + 120, H - y + (n - 1) * 70 + 180, o, draw);
  };

  /** kasumi(o): the print's mist bands (霞) — long horizontal bands with rounded ends, the colour of the paper or of
   *  peach / ochre, keylined top and bottom, lying across the view in front of hills and towns and drifting slowly;
   *  they hide part of what is behind them, which is what makes distance in a woodblock print. o: { y (560: centre of
   *  the band group), bands (3), color ('paper'; 'redF' peach, 'yellow' gold), speed (8 px/s), at, dur (1.2), seed } */
  B.kasumi = function (o = {}) {
    const y = o.y ?? H / 2 + 20, n = o.bands ?? 3, sp = o.speed ?? 8, at = o.at ?? 0, dur = o.dur ?? 1.2, seed = o.seed ?? seedN++, r = PV.rng(seed);
    const color = o.color ?? 'paper';
    const bands = Array.from({ length: n }, (_, i) => ({ x: -200 + r() * 700 + i * 260, y: y + (i - (n - 1) / 2) * 70 + (r() - 0.5) * 30, w: 700 + r() * 700, h: 34 + r() * 26, v: sp * (0.6 + r() * 0.8) * (i % 2 ? -1 : 1) }));
    const draw = (c, lt) => {
      const k = clamp((lt - at) / dur); if (k <= 0) return;
      bands.forEach((b, i) => {
        const e = ease.out(clamp(k * 1.4 - i * 0.2)); if (e <= 0) return;
        const bx = b.x + b.v * lt, w = b.w * e, hh = b.h;
        const p = new Path2D(); p.roundRect(bx, b.y - hh / 2, w, hh, hh / 2);
        c.save(); c.globalAlpha = 0.96; printFill(c, p, color, { grainAlpha: 0.25 }, [bx, b.y - hh, w, hh * 2]); c.restore();
        c.strokeStyle = C('ink'); c.lineWidth = 3; c.stroke(p);
      });
    };
    return mount(this, -400, y - n * 60 - 80, W + 800, n * 120 + 160, o, draw);
  };

  /** waves(o): a woodblock sea — rows of scalloped wave crests (pale at the horizon, deep Prussian blue toward the
   *  viewer, each crest with white foam lines) printed from the horizon down to the bottom of the frame and rolling
   *  sideways forever. o: { y0 (640: horizon), y1 (1080: nearest row), rows (7), speed (24 px/s), color ('blue'), at,
   *  dur (1.4), seed } */
  B.waves = function (o = {}) {
    const y0 = o.y0 ?? STAGE.area.y1 - 240, y1 = o.y1 ?? H, n = o.rows ?? 7, sp = o.speed ?? 24, at = o.at ?? 0, dur = o.dur ?? 1.4;
    const deep = rgbOf(o.color || 'blue'), pale = rgbOf('blueF'), paper = rgbOf('paper'), ink = rgbOf('ink');
    const mix = (q) => [0, 1, 2].map((j) => Math.round(lerp(pale[j], deep[j], q)));
    const draw = (c, lt) => {
      const k = clamp((lt - at) / dur); if (k <= 0) return;
      c.fillStyle = rgba(pale, ss(0, 0.4, k)); c.fillRect(-60, y0, W + 120, H - y0 + 60);
      for (let i = 0; i < n; i++) {
        const q = n === 1 ? 1 : i / (n - 1), e = ease.out(clamp(k * 1.6 - q * 0.6)); if (e <= 0) continue;
        const R = lerp(22, 90, Math.pow(q, 1.3)), yy = lerp(y0 + 18, y1 - R * 0.35, Math.pow(q, 0.85)) + (1 - e) * 30;
        const shift = ((sp * lt * (0.4 + q) + i * 53) % (R * 2)) * (i % 2 ? -1 : 1);
        c.save(); c.globalAlpha = e;
        // the row's water down to the next row
        c.beginPath();
        for (let xx = -R * 2 + shift; xx < W + R * 2; xx += R * 2) { c.moveTo(xx - R, yy); c.arc(xx, yy, R, Math.PI, 0); }
        c.rect(-60, yy, W + 120, H - yy + 60);
        c.fillStyle = rgba(mix(lerp(0.15, 1, q)), 1); c.fill();
        c.beginPath();
        for (let xx = -R * 2 + shift; xx < W + R * 2; xx += R * 2) { c.moveTo(xx - R, yy); c.arc(xx, yy, R, Math.PI, 0); }
        c.strokeStyle = rgba(ink, 1); c.lineWidth = lerp(2, 4, q); c.stroke();
        c.strokeStyle = rgba(paper, 0.95); c.lineWidth = lerp(1.5, 3.2, q);
        for (let xx = -R * 2 + shift; xx < W + R * 2; xx += R * 2) for (const f of [0.74, 0.5, 0.28]) { c.beginPath(); c.arc(xx, yy + R * 0.04, R * f, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
        c.restore();
      }
    };
    return mount(this, -60, y0 - 100, W + 120, H - y0 + 160, o, draw);
  };

  /** greatWave(x, y, s, o): the great wave — a towering indigo swell rising from the right and curling over to the
   *  left, its lip edged with a band of white foam that breaks into claws reaching forward and down, spray dotting the
   *  air. (x, y) is the foot of the wave's back on the right, s its scale (1 ≈ 900 px tall). It grows up out of the sea,
   *  curls, then heaves. The style's loudest image: once per film, for the force, the danger, the turning point.
   *  o: { at, dur (2.2), color ('purple'), flip (false: mirror it to curl right), seed } */
  B.greatWave = function (x, y, s = 1, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 2.2, seed = o.seed ?? seedN++, r = PV.rng(seed), fl = o.flip ? -1 : 1;
    const deep = rgbOf(o.color || 'purple'), mid = rgbOf('blue'), pale = rgbOf('blueF'), paper = rgbOf('paper'), ink = rgbOf('ink');
    const S = 900 * s;
    // unit outline: back rising on the right, crest top-left, the lip curling down and in, the hollow under it
    const U = [[0, 0], [0.03, -0.3], [-0.06, -0.62], [-0.26, -0.88], [-0.52, -0.99], [-0.76, -0.93], [-0.92, -0.76], [-0.96, -0.58], [-0.86, -0.5], [-0.8, -0.6], [-0.7, -0.7], [-0.58, -0.68], [-0.48, -0.56], [-0.44, -0.34], [-0.5, -0.12], [-0.64, 0]];
    const LIP = [2, 3, 4, 5, 6, 7, 8];
    const inner = [[-0.05, -0.1], [-0.1, -0.48], [-0.28, -0.78], [-0.52, -0.88], [-0.72, -0.82]];
    const claws = Array.from({ length: 22 }, (_, i) => ({ q: 0.12 + (i / 21) * 0.88, len: 0.035 + r() * 0.05, bend: 0.5 + r() * 0.5, w: 0.012 + r() * 0.01 }));
    const spray = Array.from({ length: 46 }, () => ({ u: -0.35 - r() * 0.75, v: -0.75 - r() * 0.45, rr: 3 + r() * 8 }));
    const draw = (c, lt) => {
      const g = clamp((lt - at) / dur); if (g <= 0) return;
      const k = ease.out(clamp(g * 1.3)), curl = ss(0.3, 1, g), heave = Math.sin((lt - at) * 0.9) * 0.012 * ss(0.8, 1, g);
      const m = (p) => [x + fl * p[0] * S, y + (p[1] + heave * p[1]) * S * k];
      const UU = U.map((p, i) => (i >= 6 && i <= 12 ? [lerp(p[0] + 0.3, p[0], curl), lerp(-0.86, p[1], curl)] : p));
      const body = densify(UU, 6, true).map(m), path = toPath(body, true);
      const gr = c.createLinearGradient(x, y - S * k, x - fl * S * 0.3, y);
      gr.addColorStop(0, rgba(deep, 1)); gr.addColorStop(0.55, rgba(mid, 1)); gr.addColorStop(1, rgba(pale, 1));
      c.save(); c.globalAlpha = ss(0, 0.25, g); c.fillStyle = gr; c.fill(path);
      c.globalCompositeOperation = 'destination-out'; c.globalAlpha = 0.28; c.fillStyle = speckles(c); c.fill(path); c.restore();
      const lip = densify(LIP.map((i) => UU[i]), 8).map(m);
      c.save(); c.clip(path);
      for (let j = 1; j <= 7; j++) { const pts = densify(inner.map((p) => [p[0] - j * 0.045, p[1] + j * 0.05]), 6).map(m); c.strokeStyle = rgba(pale, 0.85 * ss(0.2, 0.6, g)); c.lineWidth = 4 * s + 1.5; c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); }
      // the foam band along the inside of the lip
      c.strokeStyle = rgba(paper, ss(0.35, 0.8, g)); c.lineWidth = 46 * s; c.lineJoin = 'round'; c.beginPath(); lip.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
      c.strokeStyle = rgba(ink, ss(0.35, 0.8, g)); c.lineWidth = 2.5; c.beginPath(); lip.forEach((q, i) => { const d = 22 * s; i ? c.lineTo(q[0], q[1] + d) : c.moveTo(q[0], q[1] + d); }); c.stroke();
      c.restore();
      c.strokeStyle = rgba(ink, ss(0, 0.3, g)); c.lineWidth = 5; c.lineJoin = 'round'; c.stroke(path);
      // claws of foam reaching out from the lip, longer toward the tip, curling forward and down
      const fc = ss(0.45, 1, g);
      if (fc > 0) {
        let cx0 = 0, cy0 = 0; body.forEach((p) => { cx0 += p[0]; cy0 += p[1]; }); cx0 /= body.length; cy0 /= body.length;
        claws.forEach((cl, ci) => {
          const i = Math.min(lip.length - 2, Math.round(cl.q * (lip.length - 2))), [px, py] = lip[i], [qx, qy] = lip[i + 1];
          let nx = -(qy - py), ny = qx - px; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
          if ((px - cx0) * nx + (py - cy0) * ny < 0) { nx = -nx; ny = -ny; }
          const L = cl.len * S * fc * (0.6 + cl.q), tx = px + nx * L - fl * L * 0.5 * cl.bend, ty = py + ny * L + L * 0.6 * cl.bend + Math.sin(lt * 2 + ci) * 2;
          const bw = cl.w * S, tq = [qx - px, qy - py], tl = Math.hypot(...tq) || 1;
          const ax = px - (tq[0] / tl) * bw, ay = py - (tq[1] / tl) * bw, bx = px + (tq[0] / tl) * bw, by = py + (tq[1] / tl) * bw;
          c.fillStyle = rgba(paper, 1); c.strokeStyle = rgba(ink, 1); c.lineWidth = 2.4; c.lineJoin = 'round';
          c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(lerp(ax, tx, 0.55) + nx * L * 0.25, lerp(ay, ty, 0.55) + ny * L * 0.25, tx, ty); c.quadraticCurveTo(lerp(bx, tx, 0.45), lerp(by, ty, 0.45), bx, by); c.closePath(); c.fill(); c.stroke();
        });
      }
      const sp = ss(0.7, 1, g);
      if (sp > 0) spray.forEach((d, i) => { const px = x + fl * d.u * S + Math.sin(lt * 1.3 + i) * 6, py = y + d.v * S * k + Math.sin(lt * 0.9 + i * 2) * 5; c.fillStyle = rgba(paper, sp); c.strokeStyle = rgba(ink, sp); c.lineWidth = 1.5; c.beginPath(); c.arc(px, py, d.rr * s + 1, 0, Math.PI * 2); c.fill(); c.stroke(); });
    };
    const x0 = o.flip ? x - 80 : x - S * 1.2, y0 = y - S * 1.3;
    return mount(this, x0, y0, S * 1.35 + 80, S * 1.35 + 60, o, draw);
  };

  /** rain(o): Hiroshige's rain — long straight black lines slanting across the whole print, in two densities, falling
   *  without end. For a storm, sorrow, a sudden turn, crowds hurrying. o: { angle (0.12 rad from vertical), density (90),
   *  speed (900 px/s), color ('ink'), at, alpha (0.75), seed } */
  B.rain = function (o = {}) {
    const at = o.at ?? 0, n = o.density ?? 90, ang = o.angle ?? 0.12, sp = o.speed ?? 900, al = o.alpha ?? 0.75, seed = o.seed ?? seedN++, r = PV.rng(seed);
    const drops = Array.from({ length: n }, () => ({ x: r() * (W + 400) - 200, y: r() * H, len: 140 + r() * 320, w: r() < 0.3 ? 2.6 : 1.4, v: sp * (0.8 + r() * 0.4) }));
    const draw = (c, lt) => {
      const e = ss(at, at + 0.6, lt); if (e <= 0) return;
      c.strokeStyle = rgba(rgbOf(o.color), al * e); c.lineCap = 'butt';
      const dx = Math.sin(ang), dy = Math.cos(ang);
      drops.forEach((d) => { const yy = ((d.y + d.v * lt) % (H + d.len)) - d.len, xx = d.x - yy * dx; c.lineWidth = d.w; c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx - d.len * dx, yy + d.len * dy); c.stroke(); });
    };
    return mount(this, 0, 0, W, H, o, draw);
  };

  /** pine(x, y, h, o): a windswept pine — a twisting trunk rising from (x, y) and leaning over, with flat cloud-shaped
   *  pads of needles in dark green, keylined. A classic foreground frame for a view: put it at a side edge, tall, half
   *  out of the frame. o: { lean (0.35: + leans right), at, dur (1.6), seed } */
  B.pine = function (x, y, h, o = {}) {
    const seed = o.seed ?? seedN++, r = PV.rng(seed), lean = o.lean ?? 0.35;
    const trunk = []; for (let i = 0; i <= 8; i++) { const q = i / 8; trunk.push([x + Math.sin(q * 3.2 + seed) * h * 0.05 + lean * h * q * q, y - h * q]); }
    const T = densify(trunk, 6), wL = (q) => lerp(h * 0.05, h * 0.016, q);
    const L = [], R = [];
    T.forEach((p, i) => { const q = i / (T.length - 1), a = T[Math.max(0, i - 1)], b = T[Math.min(T.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; L.push([p[0] - (dy / d) * wL(q), p[1] + (dx / d) * wL(q)]); R.push([p[0] + (dy / d) * wL(q), p[1] - (dx / d) * wL(q)]); });
    const trunkPoly = L.concat(R.reverse());
    const blocks = [{ path: toPath(trunkPoly, true), color: '#6B4A33', boka: 'left', bokaLen: 1.0, bokaTo: 'orange' }];
    const lines = [{ pts: trunkPoly, closed: true, w: 3.5 }];
    const pads = Array.from({ length: 6 }, (_, i) => { const q = 0.45 + (i / 5) * 0.55, base = T[Math.round(q * (T.length - 1))]; return { cx: base[0] + (i % 2 ? 1 : -1) * h * (0.08 + r() * 0.12), cy: base[1] + (r() - 0.5) * h * 0.06, w: h * (0.16 + r() * 0.12), hh: h * (0.05 + r() * 0.03) }; });
    pads.forEach((p) => {
      const pts = []; for (let j = 0; j <= 16; j++) { const a = Math.PI + (j / 16) * Math.PI, bump = 1 + 0.18 * Math.sin(j * 1.9 + seed); pts.push([p.cx + Math.cos(a) * p.w * 0.5 * bump, p.cy + Math.sin(a) * p.hh * bump]); }
      pts.push([p.cx + p.w * 0.5, p.cy + p.hh * 0.25], [p.cx - p.w * 0.5, p.cy + p.hh * 0.25]);
      blocks.push({ path: toPath(pts, true), color: 'green', boka: 'top', bokaLen: 1.0, bokaTo: '#2F4A33' }); lines.push({ pts, closed: true, w: 3.5 });
    });
    const all = trunkPoly.concat(pads.flatMap((p) => [[p.cx - p.w, p.cy - p.hh * 2], [p.cx + p.w, p.cy + p.hh]]));
    const [bx, by, bw, bh] = bbox(all, 40);
    const draw = printer(blocks, lines, { dur: 1.6, ...o, seed }, [bx, by, bw, bh]);
    return mount(this, bx, by, bw, bh, o, draw);
  };

  /** blossoms(o): cherry (or plum) petals drifting across the print on the wind, each a small pink five-petal flower or
   *  a single petal with a keyline, turning as it falls; optional branch entering from a corner. For spring, a fleeting
   *  moment, beauty, things passing. o: { n (40), color ('redF'), wind (60 px/s), branch ('tl' | 'tr' | false), at, seed } */
  B.blossoms = function (o = {}) {
    const n = o.n ?? 40, at = o.at ?? 0, wind = o.wind ?? 60, seed = o.seed ?? seedN++, r = PV.rng(seed), pink = rgbOf(o.color || 'redF');
    const ps = Array.from({ length: n }, () => ({ x: r() * W, y: r() * H, s: 7 + r() * 11, v: 30 + r() * 50, ph: r() * 6, flower: r() < 0.35 }));
    const br = o.branch;
    const branch = br ? (() => { const sx = br === 'tl' ? -20 : W + 20, d = br === 'tl' ? 1 : -1; return densify([[sx, 160], [sx + d * 220, 190], [sx + d * 420, 160], [sx + d * 620, 210]], 6); })() : null;
    const flowers = branch ? Array.from({ length: 9 }, (_, i) => ({ p: branch[Math.round((i / 8) * (branch.length - 1))], dy: (r() - 0.5) * 50, s: 16 + r() * 10 })) : [];
    const petal = (c, x, y, s, a, flower) => {
      c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = rgba(pink, 1); c.strokeStyle = C('ink'); c.lineWidth = 1.6;
      const k = flower ? 5 : 1;
      for (let i = 0; i < k; i++) { c.rotate((Math.PI * 2) / 5); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.55, -s * 0.5, 0, -s); c.quadraticCurveTo(-s * 0.55, -s * 0.5, 0, 0); c.fill(); c.stroke(); }
      if (flower) { c.fillStyle = C('red'); c.beginPath(); c.arc(0, 0, s * 0.18, 0, 6.3); c.fill(); }
      c.restore();
    };
    const draw = (c, lt) => {
      const e = ss(at, at + 1, lt); if (e <= 0) return;
      if (branch) {
        const k = ease.out(clamp((lt - at) / 1.2)), m = Math.max(2, Math.ceil(branch.length * k));
        c.strokeStyle = '#4A3528'; c.lineCap = 'round'; c.lineWidth = 16; c.beginPath(); branch.slice(0, m).forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
        flowers.forEach((f, i) => { if (i / 9 < k) petal(c, f.p[0], f.p[1] + f.dy, f.s, i, true); });
      }
      c.globalAlpha = e;
      ps.forEach((p) => { const t = lt - at, xx = ((p.x + wind * t + Math.sin(t * 0.8 + p.ph) * 40) % (W + 80)) - 40, yy = ((p.y + p.v * t) % (H + 80)) - 40; petal(c, xx, yy, p.s, t * 1.4 + p.ph, p.flower); });
      c.globalAlpha = 1;
    };
    return mount(this, 0, 0, W, H, o, draw);
  };

  /** bridge(x, y, w, o): an arched wooden bridge in Hiroshige's manner, from (x, y) to (x + w, y), its deck rising in a
   *  gentle arch (rise 0.12·w), with posts, a rail and piers into the water; prints in. A connection, a crossing, a
   *  journey between two banks. o: { rise (0.12), at, dur (1.4), seed } */
  B.bridge = function (x, y, w, o = {}) {
    const rise = (o.rise ?? 0.12) * w, seed = o.seed ?? seedN++;
    const arc = (dy) => Array.from({ length: 21 }, (_, i) => { const q = i / 20; return [x + w * q, y - rise * Math.sin(q * Math.PI) + dy]; });
    const top = arc(0), bot = arc(26), rail = arc(-46);
    const deck = top.concat(bot.slice().reverse());
    const blocks = [{ path: toPath(deck, true), color: '#7A5638', boka: 'top', bokaLen: 1, bokaTo: 'orange' }];
    const lines = [{ pts: deck, closed: true }, { pts: rail, closed: false, w: 4 }];
    for (let i = 0; i <= 10; i++) { const p = top[i * 2]; lines.push({ pts: [[p[0], p[1]], [p[0], p[1] - 46]], closed: false, w: 3.5 }); }
    for (let i = 1; i < 5; i++) { const p = bot[i * 4]; const pier = [[p[0] - 7, p[1] - 4], [p[0] + 7, p[1] - 4], [p[0] + 7, y + 150], [p[0] - 7, y + 150]]; blocks.push({ path: toPath(pier, true), color: '#5A3E2A' }); lines.push({ pts: pier, closed: true, w: 3 }); }
    const [bx, by, bw, bh] = bbox(deck.concat(rail, [[x, y + 160]]), 30);
    const draw = printer(blocks, lines, { dur: 1.4, ...o, seed }, [bx, by, bw, bh]);
    return mount(this, bx, by, bw, bh, o, draw);
  };

  /** boat(pose, w, o): a long wooden boat with a curved prow and a row of crouching boatmen in straw hats (no faces),
   *  riding the water: pose(lt) → { x, y, ang } places the middle of its keel; give it a bob (Math.sin) and a path.
   *  o: { at, dur (1.0), rowers (3), sail (false: a square sail), seed } */
  B.boat = function (pose, w = 420, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.0, n = o.rowers ?? 3, seed = o.seed ?? seedN++;
    const hull = [[-0.5, -0.05], [-0.42, 0.1], [0.38, 0.1], [0.56, -0.16], [0.5, -0.12], [0.38, -0.02], [-0.5, -0.05]].map(([u, v]) => [u * w, v * w]);
    const draw = (c, lt) => {
      const k = clamp((lt - at) / dur); if (k <= 0) return;
      const p = typeof pose === 'function' ? pose(lt) : pose;
      c.save(); c.globalAlpha = ss(0, 0.4, k); c.translate(p.x, p.y + (1 - ease.out(k)) * 20); c.rotate(p.ang ?? 0);
      if (o.sail) { const sp = new Path2D(); sp.rect(-w * 0.08, -w * 0.62, w * 0.3, w * 0.5); printFill(c, sp, 'paper', { grainAlpha: 0.2 }, [-w, -w, w * 2, w]); c.strokeStyle = C('ink'); c.lineWidth = 3.5; c.stroke(sp); c.beginPath(); c.moveTo(-w * 0.08, -w * 0.66); c.lineTo(-w * 0.08, 0); c.stroke(); }
      for (let i = 0; i < n; i++) {
        const fx = lerp(-0.32, 0.22, n === 1 ? 0.5 : i / (n - 1)) * w;
        c.fillStyle = C('purple'); c.beginPath(); c.ellipse(fx, -w * 0.08, w * 0.04, w * 0.06, 0.3, 0, 6.3); c.fill();
        c.fillStyle = C('yellow'); c.strokeStyle = C('ink'); c.lineWidth = 2.5; c.beginPath(); c.moveTo(fx - w * 0.06, -w * 0.12); c.lineTo(fx, -w * 0.19); c.lineTo(fx + w * 0.06, -w * 0.12); c.closePath(); c.fill(); c.stroke();
      }
      const hp = toPath(hull, true); printFill(c, hp, '#7A5638', { boka: 'bottom', bokaLen: 1, bokaTo: 'orange', grainAlpha: 0.3 }, [-w, -w, w * 2, w * 2]);
      c.strokeStyle = C('ink'); c.lineWidth = 4; c.lineJoin = 'round'; c.stroke(hp);
      c.restore();
    };
    return mount(this, 0, 0, W, H, o, draw);
  };

  /** traveller(x, y, h, o): a small traveller of the Tōkaidō road — a wide conical straw hat hiding the face, a short
   *  indigo coat, a staff; walks (legs swing) while x moves. (x, y) are the feet; x may be a function of lt. Keep small
   *  (h 90–180) against a big landscape: the human scale. o: { coat ('purple'), at, dur (0.8), walk (true), dir (1 →) } */
  B.traveller = function (x, y, h = 140, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.8, coat = o.coat ?? 'purple', dir = o.dir ?? 1;
    const draw = (c, lt) => {
      const k = clamp((lt - at) / dur); if (k <= 0) return;
      const X = val(x, lt, 0), Y = val(y, lt, 0), sw = o.walk === false ? 0 : Math.sin(lt * 6) * 0.35;
      c.save(); c.globalAlpha = ss(0, 0.5, k); c.translate(X, Y); c.scale(dir, 1); c.lineJoin = 'round'; c.lineCap = 'round';
      c.strokeStyle = C('ink'); c.lineWidth = Math.max(2.5, h * 0.03);
      [sw, -sw].forEach((a) => { c.beginPath(); c.moveTo(0, -h * 0.42); c.lineTo(Math.sin(a) * h * 0.32, -h * 0.42 + Math.cos(a) * h * 0.42); c.stroke(); });
      const body = new Path2D(); body.moveTo(-h * 0.14, -h * 0.4); body.lineTo(h * 0.16, -h * 0.4); body.lineTo(h * 0.1, -h * 0.78); body.lineTo(-h * 0.1, -h * 0.78); body.closePath();
      printFill(c, body, coat, { grainAlpha: 0.3 }, [-h, -h, h * 2, h]); c.stroke(body);
      c.beginPath(); c.moveTo(h * 0.2, -h * 0.05); c.lineTo(h * 0.26, -h * 0.86); c.stroke();
      const hat = new Path2D(); hat.moveTo(-h * 0.24, -h * 0.78); hat.lineTo(0, -h * 0.98); hat.lineTo(h * 0.24, -h * 0.78); hat.quadraticCurveTo(0, -h * 0.74, -h * 0.24, -h * 0.78);
      printFill(c, hat, 'yellow', { grainAlpha: 0.3 }, [-h, -h, h * 2, h]); c.stroke(hat);
      c.restore();
    };
    return mount(this, 0, 0, W, H, o, draw);
  };

  // ── the frame of a print ──
  /** cartouche(str, x, y, o): a title panel as on a print — a keylined rectangle printed in ochre (or peach, or pale
   *  blue) with the words set in heavy type inside; vertical for Chinese (top-to-bottom, x y = top-left), horizontal
   *  for Latin, for anything with a number of two or more digits (1405年, 62 艘), or with dir 'h'. Use it for a name, a place, a date, a number with its unit, the one phrase a page lands
   *  on. Several small ones can label parts of a view like the captions on a map print. o: { size (54), dir ('v' | 'h'),
   *  fill ('yellow'; 'redF', 'blueF', 'paper'), color ('ink'), at, cps (8), frame (true: an inner double line) } */
  B.cartouche = function (str, x, y, o = {}) {
    const size = o.size ?? 54, latin = !/[㐀-鿿]/.test(str), dir = o.dir ?? (latin || /[0-9A-Za-z]{2,}/.test(str) ? 'h' : 'v'), at = o.at ?? 0, pad = size * 0.38;
    const chars = [...String(str)];
    const tw = dir === 'v' ? size : PV.tw(str, size) * (latin ? 1.16 : 1.06), th = dir === 'v' ? chars.length * size * 1.14 : size * 1.2;
    const w = tw + pad * 2, h = th + pad * 2;
    const path = new Path2D(); path.rect(x, y, w, h);
    const inner = [[x + 7, y + 7], [x + w - 7, y + 7], [x + w - 7, y + h - 7], [x + 7, y + h - 7]];
    const draw = printer([{ path, color: o.fill ?? 'yellow', grainAlpha: 0.35 }], [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true, w: 4 }].concat(o.frame === false ? [] : [{ pts: inner, closed: true, w: 1.8 }]), { dur: 0.7, at }, [x, y, w, h]);
    const m = mount(this, x - 30, y - 30, w + 60, h + 60, o, draw);
    const t = this.text(str, { x: x + pad + (dir === 'v' ? 0 : 0), y: y + pad * (dir === 'v' ? 0.9 : 0.75), size, at: at + 0.5, cps: o.cps ?? 8, color: o.color || 'ink', cls: (dir === 'v' ? 'vt ' : '') + 'wood' + (latin ? ' latin' : ''), lh: dir === 'v' ? 1.14 : 1.2 });
    return { el: m.el, w, h, text: t, hide(tt, d = 0.6) { m.hide(tt, d); t.hide?.(tt, d); return this; } };
  };

  /** seal(x, y, str, o): a vermilion seal stamped at its top-left (x, y), pressing down (1.5× → 1×) with a worn speckled
   *  face. The artist's seal of the print and the one loud red mark: the answer, the conclusion, the name. str 1–4
   *  characters. o: { size (90), at, white (true: characters cut out of red), color ('red') } */
  B.seal = function (x, y, str, o = {}) {
    const size = o.size ?? 90, at = o.at ?? 0, white = o.white ?? true, rgb = rgbOf(o.color || 'red'), chars = [...String(str)].slice(0, 4);
    const pad = size * 0.4, face = document.createElement('canvas'); face.width = face.height = size; const g = face.getContext('2d'), r = PV.rng(PV.hashStr(String(str)) + 5);
    const cols = chars.length === 4 ? [[chars[0], chars[1]], [chars[2], chars[3]]] : chars.length === 3 ? [[chars[0]], [chars[1], chars[2]]] : [chars];
    const drawChars = () => {
      const cw = size / cols.length;
      cols.forEach((cc, ci) => cc.forEach((ch, ri) => {
        const fs = Math.min(cw, size / cc.length) * 0.84;
        g.font = `900 ${fs}px "Noto Serif SC Variable", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, size - cw * (ci + 0.5), (size / cc.length) * (ri + 0.5) + fs * 0.04);
      }));
    };
    let built = false;
    const build = () => {
      if (built) return; built = true;
      g.clearRect(0, 0, size, size);
      if (white) { g.fillStyle = rgba(rgb, 1); g.fillRect(0, 0, size, size); g.globalCompositeOperation = 'destination-out'; drawChars(); }
      else { g.fillStyle = rgba(rgb, 1); drawChars(); g.strokeStyle = rgba(rgb, 1); g.lineWidth = size * 0.08; g.strokeRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92); }
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < size * 0.8; i++) { g.globalAlpha = 0.3 + r() * 0.7; g.fillRect(r() * size, r() * size, 1 + r() * size * 0.03, 1 + r() * size * 0.02); }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    };
    const k = (lt) => clamp((lt - at) / 0.26);
    const draw = (c, lt) => {
      const e = k(lt); if (e <= 0) return;
      build();
      const s = lerp(1.5, 1, ease.out(e));
      c.save(); c.globalAlpha = (0.15 + 0.85 * e) * 0.94; c.translate(x + size / 2, y + size / 2); c.scale(s, s); c.drawImage(face, -size / 2, -size / 2); c.restore();
    };
    draw.key = (lt) => k(lt).toFixed(3);
    return mount(this, x - pad, y - pad, size + pad * 2, size + pad * 2, { ...o, blend: 'multiply' }, draw);
  };

  /** vtext(str, x, y, o): a vertical column of characters, top to bottom (several columns right-to-left: separate them
   *  with \n), in the heavy woodblock face — an inscription beside the picture, a line of a poem, a name. (x, y) is the
   *  column's top-left. o: { size (58), at, cps (6), color ('ink'), font ('wood' | 'brush') } */
  B.vtext = function (str, x, y, o = {}) {
    const brushy = o.font === 'brush';
    return this.text(str, { lh: 1.4, cps: 6, size: 58, ...o, x, y, font: brushy ? 'brush' : undefined, cls: 'vt' + (brushy ? '' : ' wood') + (o.cls ? ' ' + o.cls : '') });
  };

  // ── the page title: a vertical cartouche at the top right with a small seal under it (Latin: horizontal, top left) ──
  B.title = function (str, o = {}) {
    const at = o.at ?? 0.1, T = this.hud || this, latin = !/[㐀-鿿]/.test(str);
    if (latin) {
      const size = o.size ?? 46, c = T.cartouche(str, STAGE.title.x, STAGE.title.y - 28, { size, at, dir: 'h', fill: o.fill ?? 'yellow' });
      if (o.seal !== false) T.seal(STAGE.title.x + c.w + 18, STAGE.title.y - 22, o.seal || '帧言', { size: 52, at: at + 1.2 });
      return c.text;
    }
    const n = [...String(str).replace(/\s+/g, '')].length, size = o.size ?? (n > 12 ? 40 : n > 9 ? 46 : 52);
    const pad = size * 0.38, w = size + pad * 2, x = W - 120 - w;
    const c = T.cartouche(str.replace(/\s+/g, ''), x, STAGE.title.y - 8, { size, at, dir: 'v', fill: o.fill ?? 'yellow' });
    if (o.seal !== false) T.seal(x + (w - 52) / 2, STAGE.title.y - 8 + c.h + 18, o.seal || '帧言', { size: 52, at: at + 1.2 });
    return c.text;
  };

  PV.UKIYOE = { printFill, keyline, densify, resample, noise, press };
})();
