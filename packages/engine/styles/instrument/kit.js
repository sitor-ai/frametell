/* Instrument · kit: a real machine (or, for an abstract idea, a machine that acts it out) on a bench, drawn as a technical figure. P.bench(...)
 * opens a scene (a camera at any azimuth that fits the machine into the card by itself) and returns S, whose methods
 * add solid parts: a base on feet, rounded blocks, cylinders on any axis, rails, rulers, label plates, dial gauges,
 * coil springs, drawers, gears, turntables, pins, dot matrices, screens on faces, wires and moving balls. Every part
 * is filled in paper white, its sides shaded by which way they face, outlined in graphite hairline, and painted back to
 * front every frame. Exactly one part at a time is lit in the accent. The card's corners hold the figure number and
 * title, the machine's name, the phase word and a live readout computed from the same variable that moves the parts.
 * Everything is a pure function of page-local time lt.
 *
 * The projection, the facing-shaded prism, rounded plans, knurls, coil halves and ruler/radial ticks are adapted from
 * Anatomy (https://github.com/wheresryan22/anatomy, MIT License, Copyright (c) 2026 Ryan), rewritten for a 2D canvas
 * and film time. See NOTICE.md. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const TAU = Math.PI * 2, RAD = Math.PI / 180;
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);

  // ── colour ────────────────────────────────────────────
  const hex = (c) => { c = col(c) || c || '#ffffff'; if (c[0] !== '#') return [255, 255, 255]; const x = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const rgba = (a, al = 1) => `rgba(${a.map((v) => Math.round(v)).join(',')},${al})`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return rgba(x.map((v, i) => v + (y[i] - v) * k)); };
  /** the figure's tones: paper fills, four facing shades between dark and light, graphite lines in four weights */
  const TONE = { paper: '#FBFBFA', top: '#FFFFFF', dark: '#D3D3CE', light: '#F4F4F0', hi: '#26262A', mid: '#8A8A8F', lo: '#B4B4B8', faint: '#D6D6D9', dot: '#3A3A3E', glass: '#232427' };
  const LW = { hi: 2.1, mid: 1.5, lo: 1.25, faint: 1.15 };
  const ACC = () => col('orange') || '#FF4F00', ACCF = () => col('orangeF') || '#FFE2D4';

  /** a critically damped arrival from 0 to 1 that starts at `at` and is settled after about `dur` s: no overshoot, no jump */
  const settle = (lt, at, dur = 0.5) => { const t = lt - at; if (t <= 0) return 0; const w = 6 / dur, k = 1 - (1 + w * t) * Math.exp(-w * t); return k > 0.999 ? 1 : k; };
  PV.settle = settle;

  // ── vectors and frames ────────────────────────────────
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // a part's local frame: U, V span its cross-section (V is "up" on its face), W runs along its axis
  const FRAME = { z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], y: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], x: [[0, -1, 0], [0, 0, 1], [1, 0, 0]] };
  const at3 = (o, F, u, v, s) => [o[0] + F[0][0] * u + F[1][0] * v + F[2][0] * s, o[1] + F[0][1] * u + F[1][1] * v + F[2][1] * s, o[2] + F[0][2] * u + F[1][2] * v + F[2][2] * s];
  // plans (CCW in u, v)
  const rrect = (u0, v0, w, d, r = 0, steps = 5) => {
    r = Math.max(0, Math.min(r, w / 2, d / 2));
    if (r < 0.01) return [[u0, v0], [u0 + w, v0], [u0 + w, v0 + d], [u0, v0 + d]];
    const out = [], C = [[u0 + w - r, v0 + r, -90], [u0 + w - r, v0 + d - r, 0], [u0 + r, v0 + d - r, 90], [u0 + r, v0 + r, 180]];
    for (const [cx, cy, a0] of C) for (let i = 0; i <= steps; i++) { const a = (a0 + (90 * i) / steps) * RAD; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return out;
  };
  const circ = (r, n = 40, ph = 0) => Array.from({ length: n }, (_, i) => { const a = ph + (i / n) * TAU; return [Math.cos(a) * r, Math.sin(a) * r]; });

  // ── drawing ───────────────────────────────────────────
  const path = (c, pts, close) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); if (close) c.closePath(); };
  const fillP = (c, pts, f) => { path(c, pts, true); c.fillStyle = f; c.fill(); c.strokeStyle = f; c.lineWidth = 0.9; c.stroke(); };
  const lineP = (c, pts, color, w, close) => { path(c, pts, close); c.strokeStyle = color; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); };
  const disc = (c, p, r, f) => { c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.fillStyle = f; c.fill(); };
  // a face's tone from its world normal: tops are white, sides fall between light and dark by facing the light
  const toneOf = (J, n) => (n[2] > 0.93 ? TONE.top : mix(TONE.dark, TONE.light, clamp(0.5 + 0.42 * dot3(n, J.light) + 0.5 * n[2])));
  const litFill = (f, k) => (k > 0 ? mix(f, ACCF(), 0.6 * k) : f);
  const litLine = (k, base = TONE.hi) => (k > 0 ? mix(base, ACC(), k) : base);

  /** the core solid: `ring` (a plan in u, v) extruded `len` along W of frame F from o. Sides are painted back to front, each in
   *  its facing tone; then the visible end cap; lines: the cap's outline, each visible side's far edge, and the edges where a side
   *  turns away (the silhouette). Returns where the visible cap sits (s) and the frame, for details drawn on it. */
  function prism(c, J, o, ring, F, len, st = {}) {
    const n = ring.length, lk = st.lit || 0;
    let area = 0; for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = area >= 0 ? 1 : -1;
    const W = F[2], capS = dot3(W, J.view) > 0 ? len : 0, backS = len - capS;
    const faces = ring.map((a, i) => {
      const b = ring[(i + 1) % n], du = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(du, dv) || 1, nu = (sg * dv) / L, nv = (-sg * du) / L;
      const nw = [F[0][0] * nu + F[1][0] * nv, F[0][1] * nu + F[1][1] * nv, F[0][2] * nu + F[1][2] * nv];
      return { a, b, nw, vis: dot3(nw, J.view) > 1e-4 };
    });
    const P = (uv, s) => J.p(at3(o, F, uv[0], uv[1], s));
    const lc = litLine(lk, st.line || TONE.hi);
    const order = faces.map((f, i) => i).filter((i) => faces[i].vis && len > 0.001)
      .sort((i, j) => J.depth(at3(o, F, (faces[i].a[0] + faces[i].b[0]) / 2, (faces[i].a[1] + faces[i].b[1]) / 2, len / 2)) - J.depth(at3(o, F, (faces[j].a[0] + faces[j].b[0]) / 2, (faces[j].a[1] + faces[j].b[1]) / 2, len / 2)));
    for (const i of order) {
      const f = faces[i], q = [P(f.a, backS), P(f.b, backS), P(f.b, capS), P(f.a, capS)];
      fillP(c, q, litFill(st.side || toneOf(J, f.nw), lk));
      lineP(c, [q[0], q[1]], lc, LW.hi);
      if (!faces[(i - 1 + n) % n].vis) lineP(c, [q[0], q[3]], lc, LW.hi);
      if (!faces[(i + 1) % n].vis) lineP(c, [q[1], q[2]], lc, LW.hi);
    }
    const cap = ring.map((uv) => P(uv, capS));
    const capN = capS === len ? W : [-W[0], -W[1], -W[2]];
    fillP(c, cap, litFill(st.cap || toneOf(J, capN), lk));
    lineP(c, cap, lc, LW.hi, true);
    return { s: capS, P, lc };
  }

  // text laid flat in a plane: (u, v) of frame F at s, v up; size in world units
  const TOPT = [[1, 0, 0], [0, -1, 0], [0, 0, 1]];
  function planeText(c, J, o, F, s, u, v, str, size, color, align = 'center', font = 'mono', weight = 500) {
    if (F === FRAME.z) { F = TOPT; v = -v; }   // on a top face, text reads along +x with its top away from the viewer
    const O = J.p(at3(o, F, u, v, s)), ex = J.p(at3(o, F, u + 1, v, s)), ey = J.p(at3(o, F, u, v + 1, s));
    c.save();
    c.transform(ex[0] - O[0], ex[1] - O[1], O[0] - ey[0], O[1] - ey[1], O[0], O[1]);
    c.font = `${weight} ${size}px ${font === 'mono' ? '"IBM Plex Mono", monospace' : '"Inter Tight Variable", "Noto Sans SC Variable", sans-serif'}`;
    c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color;
    String(str).split('\n').forEach((line, i, all) => c.fillText(line, 0, (i - (all.length - 1) / 2) * size * 1.25));
    c.restore();
  }
  // the visible near half of a circle of radius r around W at s (a seam, a band, a bezel edge)
  function seam(c, J, o, F, r, s, color, w, n = 48) {
    let run = [];
    const flush = () => { if (run.length > 1) lineP(c, run, color, w); run = []; };
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, nw = [F[0][0] * Math.cos(a) + F[1][0] * Math.sin(a), F[0][1] * Math.cos(a) + F[1][1] * Math.sin(a), F[0][2] * Math.cos(a) + F[1][2] * Math.sin(a)];
      if (dot3(nw, J.view) > 0) run.push(J.p(at3(o, F, Math.cos(a) * r, Math.sin(a) * r, s))); else flush();
    }
    flush();
  }
  // knurl: lines along a cylinder's length where its surface faces the viewer, turning with `ph`
  function knurl(c, J, o, F, r, s0, s1, count, ph, color) {
    for (let i = 0; i < count; i++) {
      const a = ph + (i / count) * TAU, nw = [F[0][0] * Math.cos(a) + F[1][0] * Math.sin(a), F[0][1] * Math.cos(a) + F[1][1] * Math.sin(a), F[0][2] * Math.cos(a) + F[1][2] * Math.sin(a)];
      const k = dot3(nw, J.view); if (k < 0.12) continue;
      lineP(c, [J.p(at3(o, F, Math.cos(a) * r, Math.sin(a) * r, s0)), J.p(at3(o, F, Math.cos(a) * r, Math.sin(a) * r, s1))], mix(TONE.lo, TONE.mid, clamp(k)), LW.faint);
    }
  }
  // a screw on a face: a ring and a dot
  const screw = (c, J, p3, r = 2.2) => { const p = J.p(p3); c.beginPath(); c.arc(p[0], p[1], r * J.k * 0.9, 0, TAU); c.strokeStyle = TONE.mid; c.lineWidth = LW.faint; c.stroke(); disc(c, p, Math.max(1.6, r * J.k * 0.38), TONE.dot); };

  // ── the bench ─────────────────────────────────────────
  /** bench({ box=[150, 176, 1620, 630], azimuth=45, elevation=30, fill=0.92, at=0 }) → S: one instrument, seen from above at an angle
   *  and fitted into `box` (page px) by itself. World units are about a millimetre of the real thing: x and y on the floor, z up; a
   *  typical machine is 160–260 units across. Add parts with S.base / S.block / S.cyl / S.rail / S.ruler / S.plate / S.dial /
   *  S.spring / S.drawer / S.gear / S.turntable / S.pins / S.dots / S.screen / S.wire / S.ball; name them with S.key; move the
   *  camera with S.view. Parts are painted back to front every frame, so call them in story order. azimuth 30–60 turns the bench
   *  (45 shows both sides equally; 35 shows the long +y side, 55 the +x side); elevation 40–50 looks down into something open.
   *  Two benches on one page (box: the left / right half) compare two machines. */
  B.bench = function (o = {}) {
    const self = this, at0 = o.at ?? 0, box = o.box ?? [150, STAGE.area.y0 - 4, STAGE.w - 300, STAGE.area.y1 - STAGE.area.y0 - 70];
    const a = (o.azimuth ?? 45) * RAD, e = (o.elevation ?? 30) * RAD, sA = Math.sin(a), cA = Math.cos(a), sE = Math.sin(e), cE = Math.cos(e);
    const q = (x, y, z) => [x * sA - y * cA, (x * cA + y * sA) * sE - z * cE];
    const view = [cA * cE, sA * cE, sE], light = norm3([-sA, cA, 0]);
    const depth = (p) => p[0] * view[0] + p[1] * view[1] + p[2] * view[2];
    const items = [], views = [];
    const add = (it) => { items.push(it); return it; };
    // the canvas is the box and a margin: what the camera pushes past it is cut, like a figure's frame
    // while the camera is pushed in, it grows to the card's drawing area
    const pad = 30, RECT = { wide: [Math.floor(box[0] - pad), Math.floor(box[1] - pad), Math.ceil(box[2] + 2 * pad), Math.ceil(box[3] + 2 * pad)], close: [78, STAGE.area.y0 - 48, STAGE.w - 156, STAGE.area.y1 - STAGE.area.y0 - 10] };
    let cx0 = 0, cy0 = 0, rectNow = null;
    const canvas = h('canvas', null, null, self.html);
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none' });
    const FADE = 'linear-gradient(to bottom, transparent, #000 40px, #000 calc(100% - 24px), transparent), linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent)';
    const resize = (r) => {
      if (rectNow === r) return; rectNow = r; [cx0, cy0, canvas.width, canvas.height] = r; canvas.style.left = cx0 + 'px'; canvas.style.top = cy0 + 'px';
      // pushed in, the drawing fades out at the card's edges instead of being cut
      const m = r === RECT.close ? FADE : 'none';
      Object.assign(canvas.style, { maskImage: m, webkitMaskImage: m, maskComposite: 'intersect', webkitMaskComposite: 'source-in' });
    };
    resize(RECT.wide);
    const ctx = canvas.getContext('2d');
    let fit = null;
    const fitNow = () => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const it of items) for (const p of it.pts ? it.pts() : []) { const [u, v] = q(p[0], p[1], p[2]); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      if (x0 > x1) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
      const k = Math.min(box[2] / (x1 - x0), box[3] / (y1 - y0)) * (o.fill ?? 0.97);
      fit = { k, ox: box[0] + box[2] / 2 - ((x0 + x1) / 2) * k, oy: box[1] + box[3] / 2 - ((y0 + y1) / 2) * k };
    };
    // the camera: base fit, then S.view keyframes push in on a point and come back, easing in and out
    const camAt = (lt) => {
      let z = 1, f = null, fz = 1, fp = null;
      for (const kf of views) {
        if (lt <= kf.at) break;
        const k = ease.inOut(clamp((lt - kf.at) / (kf.dur ?? 1)));
        const tz = kf.zoom ?? (kf.focus ? 1.6 : 1), tp = kf.focus ? (Array.isArray(kf.focus) ? kf.focus : kf.focus.c) : null;
        const from = { z, p: fp }; z = lerp(from.z, tz, k);
        fp = tp && from.p ? [lerp(from.p[0], tp[0], k), lerp(from.p[1], tp[1], k), lerp(from.p[2], tp[2], k)] : tp || from.p;
        fz = tp ? k : from.p ? 1 - k : 0; f = fp;
      }
      let k = fit.k * z, ox = fit.ox, oy = fit.oy;
      if (f) {
        const [u, v] = q(f[0], f[1], f[2]), mx = box[0] + box[2] / 2, my = box[1] + box[3] / 2;
        const bx = fit.ox + u * fit.k, by = fit.oy + v * fit.k;          // where the focus sits in the wide shot
        const tx = lerp(bx, mx, Math.min(1, fz)), ty = lerp(by, my, Math.min(1, fz));
        ox = tx - u * k; oy = ty - v * k;
      } else { const mx = box[0] + box[2] / 2, my = box[1] + box[3] / 2; ox = mx - (mx - fit.ox) * z; oy = my - (my - fit.oy) * z; }
      resize(z > 1.001 ? RECT.close : RECT.wide);
      return { k, p: (w) => { const [u, v] = q(w[0], w[1], w[2]); return [ox + u * k - cx0, oy + v * k - cy0]; }, view, light, depth };
    };
    self.tick((lt) => {
      if (!fit) fitNow();
      const J = camAt(lt);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      const list = items.map((it, i) => [it, it.layer ?? 1, it.depth ? it.depth(lt) : 0, i]);
      list.sort((x, y) => x[1] - y[1] || x[2] - y[2] || x[3] - y[3]);
      for (const [it] of list) { ctx.save(); it.draw(ctx, lt, J); ctx.restore(); }
    });

    const S = { items };
    // every part: an entrance (it settles down into place from above), an optional exit, a move, and a lit envelope
    const part = (b, rest, draw, x = {}) => {
      const mv = (lt) => (b.move ? b.move(lt) : null) || [0, 0, 0];
      const lits = [];
      if (b.lit === true) lits.push([b.at ?? at0, Infinity]);
      const litK = (lt) => { let k = typeof b.lit === 'function' ? +b.lit(lt) || 0 : 0; for (const [s0, s1] of lits) k = Math.max(k, settle(lt, s0, 0.35) - (s1 < Infinity ? settle(lt, s1, 0.35) : 0)); return clamp(k); };
      add({ layer: x.layer ?? 1, pts: x.pts,
        depth: (lt) => { const m = mv(lt), r = typeof rest === 'function' ? rest(lt) : rest; return depth([r[0] + m[0], r[1] + m[1], r[2] + m[2]]) + (x.bias || 0) + (b.front ? 1e4 : 0) - (b.back ? 1e4 : 0); },
        draw: (c, lt, J) => {
          const at = b.at ?? at0, k = b.enter === 'none' ? (lt >= at ? 1 : 0) : settle(lt, at, b.dur ?? 0.55);
          const ko = b.out != null ? 1 - settle(lt, b.out, 0.45) : 1;
          if (k * ko <= 0.003) return;
          c.globalAlpha = clamp(k * 1.7) * ko;
          if (b.enter !== 'fade' && b.enter !== 'none') c.translate(0, -(1 - k) * 46);
          draw(c, lt, J, mv(lt), litK(lt));
        } });
      const hd = { c: rest, lit(s0, s1 = Infinity) { lits.push([s0, s1]); return hd; }, ...x.handle };
      return hd;
    };
    const shift = (p, m) => [p[0] + m[0], p[1] + m[1], p[2] + m[2]];
    const box8 = (x, y, z, w, d, hh) => [[x, y, z], [x + w, y, z], [x, y + d, z], [x + w, y + d, z], [x, y, z + hh], [x + w, y, z + hh], [x, y + d, z + hh], [x + w, y + d, z + hh]];

    /** S.base(x, y, w, d, { h=10, r=6, feet=true, screws=true, groove=true, at }) → { z }: the heavy base plate the whole instrument stands
     *  on: a soft shadow, four feet, a rounded slab with a groove inset from its edge and a screw in each corner. Start every bench with one
     *  (or a long one per row of stations). Its handle's z is the height of its top: stand everything else on it. */
    S.base = (x, y, w, d, b = {}) => {
      const hh = b.h ?? 10, r = b.r ?? 6, fz = b.feet === false ? 0 : 4, top = fz + hh;
      add({ layer: 0, pts: () => box8(x, y, 0, w, d, top), draw: (c, lt, J) => {
        const k = settle(lt, b.at ?? at0, 0.6); if (k <= 0) return;
        c.globalAlpha = 0.5 * k; c.filter = 'blur(16px)';
        fillP(c, rrect(x + 6, y + 10, w, d, r).map(([u, v]) => J.p([u, v, 0])), 'rgba(90,90,80,0.55)');
        c.filter = 'none';
      } });
      return part(b, [x + w / 2, y + d / 2, 0], (c, lt, J, m, lk) => {
        const o = shift([0, 0, 0], m);
        if (fz) for (const [fx, fy] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + d - 12], [x + w - 12, y + d - 12]].sort((p1, p2) => depth([p1[0], p1[1], 0]) - depth([p2[0], p2[1], 0]))) prism(c, J, shift([fx, fy, 0], m), circ(6, 24), FRAME.z, fz, {});
        prism(c, J, shift([0, 0, fz], m), rrect(x, y, w, d, r), FRAME.z, hh, { lit: lk });
        if (b.groove !== false) lineP(c, rrect(x + 5, y + 5, w - 10, d - 10, Math.max(0, r - 3)).map(([u, v]) => J.p(shift([u, v, top], o))), TONE.faint, LW.faint, true);
        if (b.screws !== false) for (const [sx, sy] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + d - 10], [x + w - 10, y + d - 10]]) screw(c, J, shift([sx, sy, top], o));
      }, { layer: 0.5, pts: () => box8(x, y, 0, w, d, top), handle: { z: top } });
    };

    /** S.block(x, y, z, w, d, h, { r=2, lit, at, out, move, groove, screws, slots, enter }) → { z, lit(at, until) }: a rounded solid block
     *  standing on z: a housing, a carriage, a post, a case, a stop, a step. groove: an inset line on its top; screws: one in each top
     *  corner; slots: n closed vent slots on its +y face. move: lt => [dx, dy, dz] (a carriage riding its rails, a plunger going down).
     *  Every part takes front: true / back: true to force it in front of / behind its neighbours when the automatic order is wrong (a
     *  long rod passing a block, a part lying on a long one). */
    S.block = (x, y, z, w, d, hh, b = {}) => part(b, [x + w / 2, y + d / 2, z + hh / 2], (c, lt, J, m, lk) => {
      const o = shift([0, 0, z], m), r = b.r ?? 2;
      prism(c, J, o, rrect(x, y, w, d, r), FRAME.z, hh, { lit: lk });
      const tz = shift([0, 0, z + hh], m);
      if (b.groove) lineP(c, rrect(x + 3, y + 3, w - 6, d - 6, Math.max(0, r - 1.5)).map(([u, v]) => J.p(shift([u, v, 0], tz))), lk ? litLine(lk, TONE.faint) : TONE.faint, LW.faint, true);
      if (b.screws) for (const [sx, sy] of [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + d - 5], [x + w - 5, y + d - 5]]) screw(c, J, shift([sx, sy, 0], tz), 1.6);
      if (b.slots) { const n = b.slots, sw = (w * 0.7) / n; for (let i = 0; i < n; i++) { const u0 = x + w * 0.15 + i * sw + sw * 0.25, sz = z + hh * 0.3; lineP(c, [[u0, y + d, sz], [u0 + sw * 0.5, y + d, sz], [u0 + sw * 0.5, y + d, sz + hh * 0.4], [u0, y + d, sz + hh * 0.4]].map((p) => J.p(shift(p, m))), TONE.mid, LW.lo, true); } }
    }, { pts: () => box8(x, y, z, w, d, hh), handle: { z: z + hh } });

    /** S.cyl(x, y, z, r, len, { axis='z', lit, at, out, move, knurl, bands, spin, pointer, hole, cap }) → { z, lit }: a cylinder from (x, y, z)
     *  along `axis` ('z' up: (x, y, z) is the bottom centre; 'x' / 'y': the centre of its start face): a post, a rod, a roller, a knob, a
     *  puck, a bushing, a nozzle. knurl: n grip lines that turn with spin (lt => degrees); bands: [s, …] seam rings at those distances;
     *  pointer: a line on its end face showing the turn; hole: the radius of a bore in its end face; holes: n drilled holes around
     *  its end face that turn with spin (a brake disc, a flywheel, a wheel hub). len may be a function of lt. */
    S.cyl = (x, y, z, r, len, b = {}) => {
      const F = FRAME[b.axis ?? 'z'], L0 = val(len, 0, 10);
      return part(b, (lt) => at3([x, y, z], F, 0, 0, val(len, lt, 10) / 2), (c, lt, J, m, lk) => {
        const o = shift([x, y, z], m), L = val(len, lt, 10), ph = (val(b.spin, lt, 0) || 0) * RAD;
        const { s, lc } = prism(c, J, o, circ(r, Math.max(24, Math.min(64, Math.round(r * 3)))), F, L, { lit: lk, cap: b.cap });
        if (b.knurl) knurl(c, J, o, F, r, 0, L, b.knurl, ph, TONE.mid);
        for (const bs of b.bands || []) seam(c, J, o, F, r, bs, TONE.mid, LW.lo);
        if (b.hole) { const ring = circ(b.hole, 32).map(([u, v]) => J.p(at3(o, F, u, v, s))); fillP(c, ring, TONE.dark); lineP(c, ring, lc, LW.mid, true); }
        if (b.holes) for (let i = 0; i < b.holes; i++) { const a = ph + (i / b.holes) * TAU, hr = r * 0.07, cx = Math.cos(a) * r * 0.66, cy = Math.sin(a) * r * 0.66; const ring = circ(hr, 14).map(([u, v]) => J.p(at3(o, F, cx + u, cy + v, s))); fillP(c, ring, TONE.dark); lineP(c, ring, TONE.mid, LW.faint, true); }
        if (b.pointer) lineP(c, [J.p(at3(o, F, Math.sin(ph) * r * 0.2, Math.cos(ph) * r * 0.2, s)), J.p(at3(o, F, Math.sin(ph) * r * 0.85, Math.cos(ph) * r * 0.85, s))], lk ? ACC() : TONE.hi, LW.hi);
      }, { pts: () => [at3([x, y, z], F, -r, -r, 0), at3([x, y, z], F, r, r, L0), at3([x, y, z], F, r, -r, 0), at3([x, y, z], F, -r, r, L0)], handle: { z: (b.axis ?? 'z') === 'z' ? z + L0 : z + r } });
    };

    /** S.rail(x, y, z, len, { axis='x', gap=26, at }) → { z }: a pair of guide rails `gap` apart (centred on y for axis x), each 5 wide
     *  and 3 high, with an end stop and two screws at each end. Put a carriage (S.block with move) on top of it. */
    S.rail = (x, y, z, len, b = {}) => {
      const ax = b.axis ?? 'x', g = b.gap ?? 26;
      const P = (s, t, zz) => (ax === 'x' ? [x + s, y + t, zz] : [x + t, y + s, zz]);
      return part(b, P(len / 2, 0, z), (c, lt, J, m) => {
        const pieces = [];
        for (const t of [-g / 2, g / 2]) pieces.push(['rail', t]);
        pieces.sort((p1, p2) => depth(P(0, p1[1], z)) - depth(P(0, p2[1], z)));
        const end = (s) => { const o = shift(P(s, 0, z), m); const [u0, v0] = ax === 'x' ? [-4, -g / 2 - 6] : [-g / 2 - 6, -4]; prism(c, J, o, rrect(u0, v0, ax === 'x' ? 8 : g + 12, ax === 'x' ? g + 12 : 8, 1.5), FRAME.z, 8, {}); screw(c, J, shift(P(s, -g / 2, z + 8), m), 1.5); screw(c, J, shift(P(s, g / 2, z + 8), m), 1.5); };
        const ends = [0, len].sort((s1, s2) => depth(P(s1, 0, z)) - depth(P(s2, 0, z)));
        end(ends[0]);
        for (const [, t] of pieces) { const o = shift(P(0, t, z), m); prism(c, J, o, ax === 'x' ? rrect(4, -2.5, len - 8, 5, 1) : rrect(-2.5, 4, 5, len - 8, 1), FRAME.z, 3, {}); }
        end(ends[1]);
      }, { layer: 0.8, pts: () => [P(0, -g / 2 - 6, z), P(len, g / 2 + 6, z + 8)], handle: { z: z + 3 } });
    };

    /** S.ruler(x, y, z, len, { axis='x', w=9, every=4, major=5, nums, at }) → { z }: a thin ruler strip lying on a surface with ticks rooted on
     *  its near edge (minor every `every` units, a longer major every `major`th). nums: [first, step] prints a small number at each major.
     *  Lay one beside anything that moves along a line, so its travel can be read. */
    S.ruler = (x, y, z, len, b = {}) => {
      const ax = b.axis ?? 'x', w = b.w ?? 9, ev = b.every ?? 4, mj = b.major ?? 5;
      return part(b, ax === 'x' ? [x + len / 2, y + w / 2, z] : [x + w / 2, y + len / 2, z], (c, lt, J, m) => {
        const o = shift([x, y, z], m);
        prism(c, J, o, ax === 'x' ? rrect(0, 0, len, w, 0.6) : rrect(0, 0, w, len, 0.6), FRAME.z, 1.4, { lit: 0 });
        const tz = z + 1.4;
        for (let i = 0, s = 2; s <= len - 2; s += ev, i++) {
          const big = i % mj === 0, tl = big ? w * 0.62 : w * 0.34;
          const a = ax === 'x' ? [x + s, y + w, tz] : [x + w, y + s, tz], bb = ax === 'x' ? [x + s, y + w - tl, tz] : [x + w - tl, y + s, tz];
          lineP(c, [J.p(shift(a, m)), J.p(shift(bb, m))], big ? TONE.mid : TONE.lo, big ? LW.lo : LW.faint);
          if (big && b.nums) planeText(c, J, shift(ax === 'x' ? [x + s, y + w * 0.2, tz] : [x + w * 0.2, y + s, tz], m), FRAME.z, 0, 0, 0, b.nums[0] + (i / mj) * b.nums[1], w * 0.32, TONE.mid);
        }
      }, { layer: 0.9, pts: () => box8(x, y, z, ax === 'x' ? len : w, ax === 'x' ? w : len, 1.4), handle: { z: z + 1.4 } });
    };

    /** S.plate(x, y, z, w, d, { text, at }): a small label plate screwed onto a surface: an inset outline, three rule lines standing for its
     *  print and two screws, or `text` engraved on it (a few capitals: the one word allowed inside the drawing). */
    S.plate = (x, y, z, w, d, b = {}) => part(b, [x + w / 2, y + d / 2, z], (c, lt, J, m) => {
      const o = shift([0, 0, z], m), tz = shift([0, 0, z + 1.2], m);
      prism(c, J, o, rrect(x, y, w, d, 1.5), FRAME.z, 1.2, {});
      lineP(c, rrect(x + 2, y + 2, w - 4, d - 4, 0.8).map(([u, v]) => J.p(shift([u, v, 0], tz))), TONE.faint, LW.faint, true);
      if (b.text) planeText(c, J, tz, FRAME.z, 0, x + w / 2, y + d / 2, b.text, Math.min(d * 0.42, (w * 1.5) / Math.max(4, String(b.text).length)), TONE.hi, 'center', 'mono', 600);
      else [0.72, 0.5, 0.86].forEach((f, i) => { const yy = y + d * (0.3 + i * 0.2); lineP(c, [J.p(shift([x + w * 0.22, yy, 0], tz)), J.p(shift([x + w * (0.22 + 0.6 * f), yy, 0], tz))], TONE.mid, LW.lo); });
      screw(c, J, shift([x + w * 0.09, y + d / 2, 0], tz), 1.2); screw(c, J, shift([x + w * 0.91, y + d / 2, 0], tz), 1.2);
    }, { layer: 0.9, pts: () => box8(x, y, z, w, d, 1.2) });

    /** S.dial(x, y, z, r, { value: lt => v, min=0, max=100, face='y', h=10, ticks=50, major=5, nums=true, sweep=270, unit, lit, at }) → { z }:
     *  a dial gauge: a puck with a knurled bezel, radial ticks with a major every `major`th, numbers, and a needle that points at value(lt).
     *  face: 'y' (it stands upright facing front-left; (x, y, z) is the bottom of its back face), 'x' (facing front-right) or 'z' (lying
     *  face-up; (x, y, z) is its bottom centre). Drive value with the same function as the readout and the moving parts. */
    S.dial = (x, y, z, r, b = {}) => {
      const fc = b.face ?? 'y', F = fc === 'z' ? TOPT : FRAME[fc], hh = b.h ?? 10, min = b.min ?? 0, max = b.max ?? 100, sweep = (b.sweep ?? 270) * RAD;
      const o0 = fc === 'z' ? [x, y, z] : [x, y, z + r * 1.1];
      const ang = (v) => -sweep / 2 + sweep * clamp((v - min) / (max - min || 1));
      return part(b, at3(o0, F, 0, 0, hh / 2), (c, lt, J, m, lk) => {
        const o = shift(o0, m);
        if (fc !== 'z') prism(c, J, shift([x, y, z], m), fc === 'y' ? rrect(-r * 0.35, -2, r * 0.7, hh, 1) : rrect(-2, -r * 0.35, hh, r * 0.7, 1), FRAME.z, r * 0.25, {});   // the lug it stands on
        const { s } = prism(c, J, o, circ(r * 1.08, 64), F, hh, { cap: TONE.top });
        knurl(c, J, o, F, r * 1.08, hh * 0.15, hh * 0.95, 84, 0, TONE.lo);
        seam(c, J, o, F, r * 1.08, hh * 0.15, TONE.mid, LW.faint);
        lineP(c, circ(r * 0.97, 64).map(([u, v]) => J.p(at3(o, F, u, v, s))), TONE.mid, LW.lo, true);
        const nt = b.ticks ?? 50, mj = b.major ?? 5;
        for (let i = 0; i <= nt; i++) {
          if (sweep >= TAU - 0.01 && i === nt) break;
          const a = -sweep / 2 + (sweep * i) / nt, big = i % mj === 0, r0 = r * (big ? 0.76 : 0.83), r1 = r * 0.92;
          lineP(c, [J.p(at3(o, F, Math.sin(a) * r0, Math.cos(a) * r0, s)), J.p(at3(o, F, Math.sin(a) * r1, Math.cos(a) * r1, s))], big ? TONE.hi : TONE.mid, big ? LW.mid : LW.faint);
          if (big && b.nums !== false) { const v = min + ((max - min) * i) / nt; planeText(c, J, o, F, s, Math.sin(a) * r * 0.6, Math.cos(a) * r * 0.6, Number.isInteger(v) ? v : v.toFixed(1), r * 0.13, TONE.hi); }
        }
        if (b.unit) planeText(c, J, o, F, s, 0, -r * 0.42, b.unit, r * 0.12, TONE.mid);
        const a = ang(val(b.value, lt, min)), nc = lk || b.lit == null ? ACC() : TONE.hi;
        lineP(c, [J.p(at3(o, F, -Math.sin(a) * r * 0.16, -Math.cos(a) * r * 0.16, s)), J.p(at3(o, F, Math.sin(a) * r * 0.86, Math.cos(a) * r * 0.86, s))], nc, LW.hi * 1.3);
        const hub = circ(r * 0.07, 20).map(([u, v]) => J.p(at3(o, F, u, v, s)));
        fillP(c, hub, TONE.hi);
      }, { pts: () => [at3(o0, F, -r * 1.1, -r * 1.1, 0), at3(o0, F, r * 1.1, r * 1.1, hh), [x, y, z]], handle: { z: fc === 'z' ? z + hh : z + r * 2.2 } });
    };

    /** S.spring(x, y, z, len, { axis='z', r=6, turns=8, at, move }): a coil spring along `axis` from (x, y, z); len may be a function of lt
     *  (it compresses and stretches). Its back half is painted behind and its front half in front of whatever runs through it (a rod, a
     *  plunger): put the rod at the same x, y. Springs mean "it pushes back" or "it returns". */
    S.spring = (x, y, z, len, b = {}) => {
      const F = FRAME[b.axis ?? 'z'], r = b.r ?? 6, turns = b.turns ?? 8;
      const coil = (lt, front, J, m) => {
        const L = val(len, lt, 30), N = Math.round(turns * 28), o = shift([x, y, z], m);
        let run = [];
        const flush = (c) => { if (run.length > 1) lineP(c, run, front ? TONE.hi : TONE.mid, front ? LW.mid + 0.3 : LW.lo); run = []; };
        return (c) => {
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * turns * TAU, s = (i / N) * L, nw = [F[0][0] * Math.cos(a) + F[1][0] * Math.sin(a), F[0][1] * Math.cos(a) + F[1][1] * Math.sin(a), F[0][2] * Math.cos(a) + F[1][2] * Math.sin(a)];
            if ((dot3(nw, J.view) > 0) === front) run.push(J.p(at3(o, F, Math.cos(a) * r, Math.sin(a) * r, s))); else flush(c);
          }
          flush(c);
        };
      };
      const mid = (lt) => at3([x, y, z], F, 0, 0, val(len, lt, 30) / 2);
      const L0 = val(len, 0, 30), pts = () => [at3([x, y, z], F, -r, -r, 0), at3([x, y, z], F, r, r, L0)];
      part(b, mid, (c, lt, J, m) => coil(lt, false, J, m)(c), { bias: -r * 1.2, pts });
      return part(b, mid, (c, lt, J, m) => coil(lt, true, J, m)(c), { bias: r * 1.2, pts });
    };

    /** S.drawer(x, y, z, w, d, h, { open: lt => 0..1, items, fill: lt => n, lit, at }) → { z }: a case with one drawer that slides out of its
     *  +y face by open(lt) of its depth: a label holder and a pull on its front, and `items` small cubes in rows on its floor (fill(lt) of
     *  them in the accent: bytes, records, slots used). Stack several (z += h) for a chest of drawers whose depths or contents differ. */
    S.drawer = (x, y, z, w, d, hh, b = {}) => part(b, (lt) => [x + w / 2, y + d / 2 + (val(b.open, lt, 0) * d) / 2, z + hh / 2], (c, lt, J, m, lk) => {
      const o = shift([0, 0, z], m), k = clamp(val(b.open, lt, 0)), ext = k * d * 0.85, t = 2.2;
      prism(c, J, o, rrect(x, y, w, d, 1.5), FRAME.z, hh, {});
      const y0 = y + d - 1, y1 = y + d + ext;
      if (ext > 0.5) {
        const fl = shift([0, 0, z + t], m);
        prism(c, J, fl, rrect(x + t, y0, w - 2 * t, ext, 0), FRAME.z, 1.2, { lit: lk * 0.4 });
        prism(c, J, shift([0, 0, z + t], m), rrect(x + t, y0, 1.6, ext, 0), FRAME.z, hh - 2 * t - 1, {});
        const n = b.items ?? 0, on = Math.round(val(b.fill, lt, 0));
        if (n) {
          const cols = Math.max(1, Math.round(Math.sqrt((n * (w - 4 * t)) / Math.max(1, d * 0.85)))), rows = Math.ceil(n / cols), cw = (w - 4 * t) / cols, rh = (d * 0.85 - 2 * t) / rows, sz = Math.min(cw, rh) * 0.62;
          const cells = [];
          for (let i = 0; i < n; i++) { const cx = x + 2 * t + (i % cols) * cw + cw / 2, cy = y1 - t - (Math.floor(i / cols) + 0.5) * rh; if (cy > y0 + sz / 2) cells.push([cx, cy, i]); }
          cells.sort((p1, p2) => depth([p1[0], p1[1], 0]) - depth([p2[0], p2[1], 0]));
          for (const [cx, cy, i] of cells) prism(c, J, shift([cx - sz / 2, cy - sz / 2, z + t + 1.2], m), rrect(0, 0, sz, sz, 0.5), FRAME.z, sz * 0.8, { lit: i < on ? 1 : 0 });
        }
        prism(c, J, shift([0, 0, z + t], m), rrect(x + w - t - 1.6, y0, 1.6, ext, 0), FRAME.z, hh - 2 * t - 1, {});
      }
      const fy = y + d + ext;
      prism(c, J, shift([0, 0, z + 0.6], m), rrect(x + 0.6, fy - 0.5, w - 1.2, 3, 0.8), FRAME.z, hh - 1.2, { lit: lk });
      const face = (u, v) => J.p(shift([u, fy + 2.5, v], m));
      lineP(c, [face(x + w * 0.38, z + hh * 0.62), face(x + w * 0.62, z + hh * 0.62), face(x + w * 0.62, z + hh * 0.84), face(x + w * 0.38, z + hh * 0.84)], TONE.mid, LW.lo, true);
      lineP(c, [face(x + w * 0.4, z + hh * 0.3), face(x + w * 0.6, z + hh * 0.3)], TONE.hi, LW.hi * 1.4);
      for (const u of [x + w * 0.4, x + w * 0.6]) disc(c, face(u, z + hh * 0.3), 2.2, TONE.dot);
      if (b.label) planeText(c, J, shift([x + w / 2, fy + 2.6, z + hh * 0.73], m), FRAME.y, 0, 0, 0, b.label, hh * 0.13, TONE.hi, 'center', 'mono', 600);
    }, { pts: () => box8(x, y, z, w, d * 1.85, hh), handle: { z: z + hh } });

    /** S.gear(x, y, z, r, { teeth=16, h=6, axis='z', angle: lt => degrees, hole, lit, at, move }) → { z }: a spur gear with its teeth around
     *  it, turning to angle(lt). axis 'z': lying flat, (x, y, z) its bottom centre; 'x' / 'y': standing on a shaft along that axis, (x, y, z)
     *  the centre of its back face (a gearbox's gears on parallel shafts, a bicycle sprocket, a clock wheel). Two gears mesh when their
     *  centres are r1 + r2 apart and angle2 = -angle1 × r1 / r2 (plus half a tooth). */
    S.gear = (x, y, z, r, b = {}) => {
      const n = b.teeth ?? 16, hh = b.h ?? 6, td = Math.min(6, r * 0.18), F = FRAME[b.axis ?? 'z'];
      return part(b, at3([x, y, z], F, 0, 0, hh / 2), (c, lt, J, m, lk) => {
        const ph = (val(b.angle, lt, 0) || 0) * RAD, ring = [];
        for (let i = 0; i < n; i++) for (const [f, rr] of [[0, r - td], [0.18, r], [0.5, r], [0.68, r - td]]) { const a = ph + ((i + f) / n) * TAU; ring.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
        const o = shift([x, y, z], m);
        const { s } = prism(c, J, o, ring, F, hh, { lit: lk });
        const face = (rr) => circ(rr, 40).map(([u, v]) => J.p(at3(o, F, u, v, s)));
        lineP(c, face(r * 0.62), TONE.faint, LW.faint, true);
        const hub = face(b.hole ?? r * 0.16); fillP(c, hub, TONE.dark); lineP(c, hub, litLine(lk), LW.mid, true);
        for (let i = 0; i < 4; i++) { const a = ph + (i / 4) * TAU + 0.4; screw(c, J, at3(o, F, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, s), 1.1); }
      }, { pts: () => [at3([x, y, z], F, -r, -r, 0), at3([x, y, z], F, r, r, hh), at3([x, y, z], F, r, -r, 0), at3([x, y, z], F, -r, r, hh)], handle: { z: (b.axis ?? 'z') === 'z' ? z + hh : z + r } });
    };

    /** S.turntable(x, y, z, r, { angle: lt => degrees, slots=0, active: lt => index, h=7, at }) → { z }: a round table with degree ticks on its
     *  rim that turns to angle(lt); slots: n pucks standing on it at even spacing, turning with it, the one at index active(lt) lit (one
     *  server of many, the slot being served, the station under the head). */
    S.turntable = (x, y, z, r, b = {}) => {
      const hh = b.h ?? 7;
      return part(b, [x, y, z + hh / 2], (c, lt, J, m) => {
        const o = shift([x, y, z], m), ph = (val(b.angle, lt, 0) || 0) * RAD;
        prism(c, J, shift([x, y, z], m), circ(r * 0.5, 40), FRAME.z, hh * 0.5, {});
        prism(c, J, shift([x, y, z + hh * 0.45], m), circ(r, 72), FRAME.z, hh * 0.55, {});
        const tz = hh;
        for (let i = 0; i < 72; i++) { const a = ph + (i / 72) * TAU, big = i % 6 === 0, r0 = r * (big ? 0.88 : 0.93); lineP(c, [J.p(shift([Math.cos(a) * r0, Math.sin(a) * r0, tz], o)), J.p(shift([Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98, tz], o))], big ? TONE.mid : TONE.lo, LW.faint); }
        lineP(c, circ(r * 0.8, 60).map(([u, v]) => J.p(shift([u, v, tz], o))), TONE.faint, LW.faint, true);
        const n = b.slots ?? 0, act = b.active ? Math.round(val(b.active, lt, -1)) : -1;
        const pucks = Array.from({ length: n }, (_, i) => { const a = ph + (i / n) * TAU; return [Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, i]; }).sort((p1, p2) => depth([p1[0], p1[1], 0]) - depth([p2[0], p2[1], 0]));
        const pr = Math.min(r * 0.16, (r * 0.62 * Math.PI) / Math.max(1, n) * 0.7);
        for (const [u, v, i] of pucks) prism(c, J, shift([u, v, tz], o), circ(pr, 28), FRAME.z, pr * 0.9, { lit: i === ((act % n) + n) % n && act >= 0 ? 1 : 0 });
        screw(c, J, shift([0, 0, tz], o), 2.4);
      }, { pts: () => [[x - r, y - r, z], [x + r, y + r, z + hh], [x + r, y - r, z], [x - r, y + r, z + hh + r * 0.15]], handle: { z: z + hh } });
    };

    /** S.pins(x, y, z, n, { pitch=14, r=4, height: (i, lt) => h, axis='x', lit: (i, lt) => 0..1, cap=true, at, stagger=0.08 }) → { z }: a row of
     *  n upright pins in a slotted bar, each its own height: the pins of a lock, the keys of a keyboard, a physical bar chart, queue
     *  lengths, voltages. height and lit are functions of the pin and time; the lit pins wear the accent. */
    S.pins = (x, y, z, n, b = {}) => {
      const pitch = b.pitch ?? 14, r = b.r ?? 4, ax = b.axis ?? 'x';
      const at = (i) => (ax === 'x' ? [x + i * pitch, y, z] : [x, y + i * pitch, z]);
      const hd = { z };
      const L = ax === 'x' ? (n - 1) * pitch : 0, D = ax === 'y' ? (n - 1) * pitch : 0;
      part(b, [x + L / 2, y + D / 2, z], (c, lt, J, m) => prism(c, J, shift([0, 0, z - 4], m), rrect(x - r * 2, y - r * 2, L + r * 4, D + r * 4, 2), FRAME.z, 4, {}), { pts: () => [[x - r * 2, y - r * 2, z - 4], [x + L + r * 2, y + D + r * 2, z]] });
      for (let i = 0; i < n; i++) {
        const p = at(i);
        part({ ...b, at: (b.at ?? at0) + i * (b.stagger ?? 0.08), lit: b.lit ? (lt) => b.lit(i, lt) : undefined }, (lt) => [p[0], p[1], z + (b.height ? b.height(i, lt) : 20) / 2], (c, lt, J, m, lk) => {
          const hh = Math.max(0.5, b.height ? b.height(i, lt) : 20), o = shift(p, m);
          const { s } = prism(c, J, o, circ(r, 28), FRAME.z, hh, { lit: lk });
          if (b.cap !== false) { const top = circ(r * 0.45, 20).map(([u, v]) => J.p(shift([u, v, s], o))); fillP(c, top, lk ? ACC() : TONE.lo); }
        }, { pts: () => [[p[0] - r, p[1] - r, z], [p[0] + r, p[1] + r, z + (b.height ? Math.max(...[0, 1, 2, 4, 8].map((t) => b.height(i, t))) : 20)]] });
      }
      return hd;
    };

    /** S.dots(x, y, z, cols, rows, { pitch=7, plane='z', on: (i, j, lt) => 0..1, at }): a grid of small dots on a flat surface (plane 'z':
     *  lying on top at height z; 'y': upright on a +y face): perforations, a speaker grille, an LED matrix, memory cells, seats. Dots
     *  that are on(i, j, lt) fill in the accent: bits set, cells used, the pattern that matches. */
    S.dots = (x, y, z, cols, rows, b = {}) => {
      const pp = b.pitch ?? 7, pl = b.plane ?? 'z';
      const P = (i, j) => (pl === 'z' ? [x + i * pp, y + j * pp, z] : [x + i * pp, y, z + (rows - 1 - j) * pp]);
      return part(b, P((cols - 1) / 2, (rows - 1) / 2), (c, lt, J, m) => {
        const rr = pp * 0.26 * J.k;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = J.p(shift(P(i, j), m)), k = b.on ? clamp(+b.on(i, j, lt) || 0) : 0;
          c.beginPath(); c.arc(p[0], p[1], rr, 0, TAU); c.strokeStyle = TONE.lo; c.lineWidth = LW.faint; c.stroke();
          if (k > 0) { c.globalAlpha *= 1; disc(c, p, rr * (0.55 + 0.45 * k), mix(TONE.paper, ACC(), k)); }
          else disc(c, p, Math.max(0.9, rr * 0.28), TONE.lo);
        }
      }, { layer: 0.95, pts: () => [P(0, 0), P(cols - 1, rows - 1)] });
    };

    /** S.screen(x, y, z, w, h, { face='y', text: lt => string, size, color, at }): a recessed display window on the face of a housing
     *  (face 'y': the plane y = const, spanning x..x+w and z..z+h; 'x': the plane x = const, spanning y..y+w): dark glass with what the
     *  machine shows in light mono type, fitted and clipped to the window. Text may be a function of lt; \n breaks lines; {o:…} marks
     *  a part in the accent. The only place where words live inside the drawing. */
    S.screen = (x, y, z, w, hh, b = {}) => {
      const fc = b.face ?? 'y', F = fc === 'y' ? FRAME.y : FRAME.x, o0 = fc === 'y' ? [x, y, z] : [x, y + w, z];
      return part(b, at3(o0, F, w / 2, hh / 2, 0.5), (c, lt, J, m) => {
        const o = shift(o0, m), win = rrect(0, 0, w, hh, Math.min(3, hh * 0.15)).map(([u, v]) => J.p(at3(o, F, u, v, 0.4)));
        lineP(c, rrect(-2, -2, w + 4, hh + 4, 3.5).map(([u, v]) => J.p(at3(o, F, u, v, 0.4))), TONE.mid, LW.lo, true);
        fillP(c, win, TONE.glass);
        c.save(); path(c, win, true); c.clip();
        const str = String(val(b.text, lt, '')), lines = str.split('\n');
        const ems = (t) => [...t].reduce((n, ch) => n + (/[\u2e80-\uffff]/.test(ch) ? 1 : 0.6), 0);   // CJK is a full em, mono Latin 0.6
        const longest = Math.max(1, ...lines.map((l) => ems(l.replace(/\{\w:|\}/g, ''))));
        const size = Math.min(b.size ?? hh * 0.42, (hh * 0.8) / lines.length / 1.2, (w * 0.86) / longest);
        lines.forEach((line, i) => {
          const v = hh / 2 - (i - (lines.length - 1) / 2) * size * 1.2;
          const parts = line.split(/(\{\w:[^}]*\})/).filter(Boolean);
          const plain = line.replace(/\{\w:([^}]*)\}/g, '$1');
          let u = w / 2 - (ems(plain) * size) / 2;
          for (const pt of parts) {
            const mm = pt.match(/^\{(\w):([^}]*)\}$/), s = mm ? mm[2] : pt;
            planeText(c, J, o, F, 0.5, u, v, s, size, mm ? ACC() : (b.color ? col(b.color) : '#ECECE6'), 'left', 'mono', 500);
            u += ems(s) * size;
          }
        });
        c.restore();
      }, { bias: 0.5, pts: () => [at3(o0, F, 0, 0, 0), at3(o0, F, w, hh, 0)] });
    };

    /** S.wire([[x, y, z], …], { r=1.6, at, dur=0.8, pulse: lt => 0..1, over=false, color }): a cable along a route of 3D points, with a
     *  terminal dot where it lands at each end. Run it along the structure, not across the subject's face; end it on a part. pulse:
     *  a bright bead at that fraction of its length (a signal, a request, current). over: true paints it above the parts. */
    S.wire = (pts3, b = {}) => {
      const r = b.r ?? 1.6;
      const lens = []; let L = 0; for (let i = 1; i < pts3.length; i++) { const l = Math.hypot(pts3[i][0] - pts3[i - 1][0], pts3[i][1] - pts3[i - 1][1], pts3[i][2] - pts3[i - 1][2]); lens.push(l); L += l; }
      const along = (s) => { s = clamp(s, 0, L); for (let i = 0; i < lens.length; i++) { if (s <= lens[i] || i === lens.length - 1) { const k = lens[i] ? s / lens[i] : 0, a = pts3[i], bb = pts3[i + 1]; return [lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)]; } s -= lens[i]; } return pts3[0]; };
      S.along = along;
      return part({ ...b, enter: 'fade' }, pts3[0], (c, lt, J, m) => {
        const k = ease.inOut(clamp((lt - (b.at ?? at0)) / (b.dur ?? 0.8))), upto = L * k;
        const pts = [pts3[0]]; let s = 0;
        for (let i = 1; i < pts3.length; i++) { if (s + lens[i - 1] <= upto) { pts.push(pts3[i]); s += lens[i - 1]; } else { pts.push(along(upto)); break; } }
        const sp = pts.map((p) => J.p(shift(p, m)));
        if (sp.length > 1) { lineP(c, sp, b.color ? col(b.color) : TONE.mid, r * 2 * J.k + 2.4); lineP(c, sp, '#F2F2EE', Math.max(0.6, r * 2 * J.k - 1.2)); }
        disc(c, sp[0], Math.max(3, r * 1.4 * J.k), TONE.dot);
        if (k >= 0.999) disc(c, sp[sp.length - 1], Math.max(3, r * 1.4 * J.k), TONE.dot);
        const pv = b.pulse ? val(b.pulse, lt, null) : null;
        if (pv != null && pv >= 0 && pv <= 1) disc(c, J.p(shift(along(L * pv), m)), Math.max(4.5, r * 2.2 * J.k), ACC());
      }, { layer: b.over ? 2 : 0.97, pts: () => pts3 });
    };

    /** S.ball([[x, y, z], …], { r=5, t: lt => 0..1, at, dur=1.4, kind='ball' | 'coin', lit=true }): a ball bearing (or a coin) that travels
     *  a route of 3D points, from the first at `at` to the last over `dur` s (or wherever t(lt) puts it): the request, the coin, the
     *  token, the drop. Lit in the accent unless lit: false. */
    S.ball = (pts3, b = {}) => {
      const lens = []; let L = 0; for (let i = 1; i < pts3.length; i++) { const l = Math.hypot(pts3[i][0] - pts3[i - 1][0], pts3[i][1] - pts3[i - 1][1], pts3[i][2] - pts3[i - 1][2]); lens.push(l); L += l; }
      const along = (s) => { s = clamp(s, 0, L); for (let i = 0; i < lens.length; i++) { if (s <= lens[i] || i === lens.length - 1) { const k = lens[i] ? s / lens[i] : 0, a = pts3[i], bb = pts3[i + 1]; return [lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)]; } s -= lens[i]; } return pts3[0]; };
      const r = b.r ?? 5, tk = (lt) => (b.t ? clamp(b.t(lt)) : ease.inOut(clamp((lt - (b.at ?? at0)) / (b.dur ?? 1.4))));
      return part({ ...b, lit: undefined, enter: 'fade' }, (lt) => along(L * tk(lt)), (c, lt, J) => {
        const p3 = along(L * tk(lt)), p = J.p(p3), R = r * J.k, lit = b.lit !== false;
        if (b.kind === 'coin') {
          c.beginPath(); c.ellipse(p[0], p[1] + R * 0.25, R, R * 0.55, 0, 0, TAU); c.fillStyle = lit ? mix(ACC(), '#000', 0.15) : TONE.dark; c.fill();
          c.beginPath(); c.ellipse(p[0], p[1], R, R * 0.55, 0, 0, TAU); c.fillStyle = lit ? ACC() : TONE.light; c.fill(); c.strokeStyle = TONE.hi; c.lineWidth = LW.lo; c.stroke();
          return;
        }
        const g = c.createRadialGradient(p[0] - R * 0.35, p[1] - R * 0.4, R * 0.1, p[0], p[1], R);
        g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.55, lit ? mix(ACC(), '#FFFFFF', 0.25) : TONE.light); g.addColorStop(1, lit ? mix(ACC(), '#000000', 0.12) : TONE.dark);
        c.beginPath(); c.arc(p[0], p[1], R, 0, TAU); c.fillStyle = g; c.fill(); c.strokeStyle = TONE.hi; c.lineWidth = LW.lo; c.stroke();
      }, { pts: () => pts3 });
    };

    // a convex hull of points in a plane (monotone chain), CCW
    const hull = (pts) => {
      const P2 = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const p of P2) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of P2.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    // the back half of a hollow cylinder, cut open toward the viewer: its inner wall, the cut faces hatched, the rim
    const sleeve = (c, J, o, F, r, len, t = 2.5) => {
      const n = 48, back = [];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, am = (a0 + a1) / 2;
        const nw = [F[0][0] * Math.cos(am) + F[1][0] * Math.sin(am), F[0][1] * Math.cos(am) + F[1][1] * Math.sin(am), F[0][2] * Math.cos(am) + F[1][2] * Math.sin(am)];
        if (dot3(nw, J.view) < 0) back.push([a0, a1, nw]);
      }
      back.sort((p1, p2) => J.depth(at3(o, F, Math.cos(p2[0]) * r, Math.sin(p2[0]) * r, len / 2)) - J.depth(at3(o, F, Math.cos(p1[0]) * r, Math.sin(p1[0]) * r, len / 2)));
      for (const [a0, a1, nw] of back) {
        const q = [at3(o, F, Math.cos(a0) * r, Math.sin(a0) * r, 0), at3(o, F, Math.cos(a1) * r, Math.sin(a1) * r, 0), at3(o, F, Math.cos(a1) * r, Math.sin(a1) * r, len), at3(o, F, Math.cos(a0) * r, Math.sin(a0) * r, len)].map(J.p);
        fillP(c, q, mix(toneOf(J, [-nw[0], -nw[1], -nw[2]]), '#BEBEB8', 0.55));
      }
      // the two cut faces where the front half was removed, hatched like a section
      const ends = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, b = ((i + 1) / n) * TAU, va = (k) => { const nw = [F[0][0] * Math.cos(k) + F[1][0] * Math.sin(k), F[0][1] * Math.cos(k) + F[1][1] * Math.sin(k), F[0][2] * Math.cos(k) + F[1][2] * Math.sin(k)]; return dot3(nw, J.view) < 0; };
        if (va(a) !== va(b)) ends.push(b);
      }
      for (const a of ends) {
        const q = [at3(o, F, Math.cos(a) * r, Math.sin(a) * r, 0), at3(o, F, Math.cos(a) * (r + t), Math.sin(a) * (r + t), 0), at3(o, F, Math.cos(a) * (r + t), Math.sin(a) * (r + t), len), at3(o, F, Math.cos(a) * r, Math.sin(a) * r, len)].map(J.p);
        fillP(c, q, TONE.top); lineP(c, q, TONE.hi, LW.mid, true);
        c.save(); path(c, q, true); c.clip();
        const [x0, y0] = q[0], L = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + 40;
        for (let k = -L; k < L; k += 7) lineP(c, [[x0 - 30, y0 + k], [x0 + 30, y0 + k - 30]], TONE.lo, LW.faint);
        c.restore();
      }
      let run = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, nw = [F[0][0] * Math.cos(a) + F[1][0] * Math.sin(a), F[0][1] * Math.cos(a) + F[1][1] * Math.sin(a), F[0][2] * Math.cos(a) + F[1][2] * Math.sin(a)]; if (dot3(nw, J.view) <= 0) run.push(J.p(at3(o, F, Math.cos(a) * (r + t / 2), Math.sin(a) * (r + t / 2), len))); }
      if (run.length > 1) lineP(c, run, TONE.hi, LW.hi + t * J.k * 0.6);
    };

    /** S.crank(x, y, z, { r=18, rod=55, bore=14, stroke, angle: lt => degrees, piston=true, sleeve=true, lit, at }) → { z: lt => piston top, pin: lt => [x, y, z] }:
     *  a crankshaft throw turning about the y axis at (x, y, z) (counterweighted web, pin), its connecting rod, and the piston it drives up
     *  and down inside a cylinder cut open toward the viewer. The engine's heart, a pump, a compressor, a steam engine: rotation ↔ up and
     *  down. Put several side by side (x apart by 2.6 × bore) with angles 180° apart for an inline engine. Lit: the piston. */
    S.crank = (x, y, z, b = {}) => {
      const r = b.r ?? 18, L = b.rod ?? 55, pr = b.bore ?? 14, ph = pr * 1.1;
      const th = (lt) => (val(b.angle, lt, 0) || 0) * RAD;
      const pin = (lt) => [x + r * Math.sin(th(lt)), y, z + r * Math.cos(th(lt))];
      const zp = (lt) => z + r * Math.cos(th(lt)) + Math.sqrt(Math.max(0, L * L - (r * Math.sin(th(lt))) ** 2));
      const s0 = z + L - r - ph * 0.55, s1 = z + L + r + ph * 0.75;
      const hd = part(b, [x, y, (z + s1) / 2], (c, lt, J, m, lk) => {
        const sh = (p) => shift(p, m), a = th(lt), P = pin(lt), Z = zp(lt);
        if (b.sleeve !== false) sleeve(c, J, sh([x, y, s0]), FRAME.z, pr + 1.2, s1 - s0, 3);
        // the web: a counterweight opposite the pin, turning with the shaft
        const web = hull([...circ(r * 0.85, 28).map(([u, v]) => [u - Math.sin(a) * r * 0.2, v - Math.cos(a) * r * 0.2]), ...circ(r * 0.38, 16).map(([u, v]) => [u + Math.sin(a) * r, v + Math.cos(a) * r])]);
        prism(c, J, sh([x, y - 10, z]), web, FRAME.y, 6, {});
        prism(c, J, sh([x, y - 14, z]), circ(r * 0.3, 20), FRAME.y, 4, {});
        prism(c, J, sh([P[0], y - 4, P[2]]), circ(r * 0.28, 20), FRAME.y, 7, {});
        // the connecting rod, big end on the pin, small end in the piston
        const A = J.p(sh([P[0], y + 1, P[2]])), Bp = J.p(sh([x, y + 1, Z])), dx = Bp[0] - A[0], dy = Bp[1] - A[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w0 = r * 0.32 * J.k, w1 = r * 0.2 * J.k;
        const rod = [[A[0] + nx * w0, A[1] + ny * w0], [Bp[0] + nx * w1, Bp[1] + ny * w1], [Bp[0] - nx * w1, Bp[1] - ny * w1], [A[0] - nx * w0, A[1] - ny * w0]];
        fillP(c, rod, TONE.light); lineP(c, rod, TONE.hi, LW.mid, true);
        c.beginPath(); c.arc(A[0], A[1], w0 * 1.25, 0, TAU); c.fillStyle = TONE.top; c.fill(); c.strokeStyle = TONE.hi; c.lineWidth = LW.mid; c.stroke();
        disc(c, A, w0 * 0.45, TONE.dot);
        if (b.piston !== false) {
          const po = sh([x, y, Z - ph * 0.35]);
          prism(c, J, po, circ(pr, 40), FRAME.z, ph, { lit: lk });
          for (const f of [0.7, 0.82]) seam(c, J, po, FRAME.z, pr, ph * f, lk ? ACC() : TONE.mid, LW.lo);
          disc(c, J.p(sh([x, y + pr, Z])), Math.max(2, w1 * 0.7), TONE.dot);
        }
      }, { pts: () => [[x - pr - r, y - 14, z - r * 1.2], [x + pr + r, y + pr, s1], [x - pr, y + pr, s0]], handle: { z: (lt) => zp(lt) + ph * 0.65, pin } });
      return hd;
    };

    /** S.belt([x1, y1, z1, r1], [x2, y2, z2, r2], { w=6, run: lt => distance, at }): a toothed belt (or a chain) wrapped around two pulleys
     *  that turn about the y axis, lying in the plane y = y1; its teeth travel by run(lt). Draw the pulleys first with S.cyl(…, { axis: 'y' }).
     *  A timing belt, a fan belt, a bicycle chain (pair it with S.gear-like sprockets). */
    S.belt = (A, Bq, b = {}) => {
      const yy = A[1];
      return part({ ...b, enter: b.enter ?? 'fade' }, [(A[0] + Bq[0]) / 2, yy, (A[2] + Bq[2]) / 2], (c, lt, J, m) => {
        const ring = hull([...circ(A[3] + 1.5, 40).map(([u, v]) => [A[0] + u, A[2] + v]), ...circ(Bq[3] + 1.5, 40).map(([u, v]) => [Bq[0] + u, Bq[2] + v])]);
        const pts = ring.concat([ring[0]]).map(([u, v]) => J.p(shift([u, yy, v], m)));
        const wpx = (b.w ?? 6) * J.k * 0.5;
        lineP(c, pts, TONE.hi, wpx + 2.6); lineP(c, pts, TONE.light, wpx);
        c.save(); c.setLineDash([Math.max(2, wpx * 0.5), Math.max(3, wpx * 0.9)]); c.lineDashOffset = -(val(b.run, lt, 0) || 0) * J.k;
        lineP(c, pts, TONE.mid, wpx * 0.7); c.restore();
      }, { bias: 50, pts: () => [[A[0] - A[3], yy, A[2] - A[3]], [Bq[0] + Bq[3], yy, Bq[2] + Bq[3]]] });
    };

    /** S.pipe([[x, y, z], …], { r=3.5, flow: lt => speed | true, color='blue', at, dur=0.8, over }): a rigid pipe or hose along a route of
     *  3D points with a flange at each end: fuel, oil, brake fluid, coolant, air. flow: dashes of `color` running through it (what flows is
     *  blue). End both ends on parts. */
    S.pipe = (pts3, b = {}) => {
      const r = b.r ?? 3.5;
      const lens = []; let L = 0; for (let i = 1; i < pts3.length; i++) { const l = Math.hypot(pts3[i][0] - pts3[i - 1][0], pts3[i][1] - pts3[i - 1][1], pts3[i][2] - pts3[i - 1][2]); lens.push(l); L += l; }
      const along = (s) => { s = clamp(s, 0, L); for (let i = 0; i < lens.length; i++) { if (s <= lens[i] || i === lens.length - 1) { const k = lens[i] ? s / lens[i] : 0, a = pts3[i], bb = pts3[i + 1]; return [lerp(a[0], bb[0], k), lerp(a[1], bb[1], k), lerp(a[2], bb[2], k)]; } s -= lens[i]; } return pts3[0]; };
      return part({ ...b, enter: 'fade' }, pts3[Math.floor(pts3.length / 2)], (c, lt, J, m) => {
        const k = ease.inOut(clamp((lt - (b.at ?? at0)) / (b.dur ?? 0.8))), upto = L * k;
        const pts = [pts3[0]]; let s = 0;
        for (let i = 1; i < pts3.length; i++) { if (s + lens[i - 1] <= upto) { pts.push(pts3[i]); s += lens[i - 1]; } else { pts.push(along(upto)); break; } }
        const sp = pts.map((p) => J.p(shift(p, m))), w = r * 2 * J.k;
        if (sp.length < 2) return;
        lineP(c, sp, TONE.hi, w + 2.6); lineP(c, sp, TONE.light, w);
        lineP(c, sp.map(([px, py]) => [px - w * 0.18, py - w * 0.22]), '#FFFFFF', Math.max(1, w * 0.22));
        const fv = b.flow ? (b.flow === true ? 1 : val(b.flow, lt, 0)) : 0;
        if (fv) { c.save(); c.setLineDash([w * 0.5, w * 1.1]); c.lineDashOffset = -lt * 40 * fv * J.k / 4; lineP(c, sp, col(b.color ?? 'blue'), Math.max(1.5, w * 0.38)); c.restore(); }
        for (const e of [sp[0], ...(k >= 0.999 ? [sp[sp.length - 1]] : [])]) { c.beginPath(); c.arc(e[0], e[1], w * 0.85, 0, TAU); c.fillStyle = TONE.top; c.fill(); c.strokeStyle = TONE.hi; c.lineWidth = LW.mid; c.stroke(); disc(c, e, Math.max(1.6, w * 0.22), TONE.dot); }
      }, { layer: b.over ? 2 : 1, bias: -5, pts: () => pts3 });
    };

    /** S.glow(x, y, z, r, { k: lt => 0..1, color='orange' }): light given off at a point: combustion in a cylinder, a spark, a red-hot brake
     *  disc, a filament. A soft orange body with a pale core whose strength follows k(lt) (rise and fade it with PV.settle; never switch it
     *  on in one frame). The only glow the style allows, at most one at a time. */
    S.glow = (x, y, z, r, b = {}) => part({ ...b, enter: 'none', at: b.at ?? -1 }, [x, y, z], (c, lt, J) => {
      const k = clamp(val(b.k, lt, 1)); if (k <= 0.004) return;
      const p = J.p([x, y, z]), R = r * J.k * (0.6 + 0.4 * k), base = hex(col(b.color ?? 'orange') || '#FF4F00');
      const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
      g.addColorStop(0, `rgba(255,248,232,${0.95 * k})`); g.addColorStop(0.35, rgba(base, 0.85 * k)); g.addColorStop(1, rgba(base, 0));
      c.fillStyle = g; c.beginPath(); c.arc(p[0], p[1], R, 0, TAU); c.fill();
    }, { bias: 30, pts: () => [[x, y, z]] });

    /** S.key(n, [x, y, z], text, { at, out }): names a part the way a technical figure does: a small numbered disc set on the part at
     *  (x, y, z) and the same number with `text` in the legend along the card's bottom edge. No leader lines. Call it when the narration names
     *  the part (at: P.cw(i, 'word')); number parts in the order they are named; at most 5 per page. */
    S.key = (n, p3, text, b = {}) => {
      const at = b.at ?? at0;
      add({ layer: 3, depth: () => 0, pts: () => [], draw: (c, lt, J) => {
        const k = settle(lt, at, 0.4) * (b.out != null ? 1 - settle(lt, b.out, 0.4) : 1); if (k <= 0.003) return;
        const p = J.p(p3), R = 15;
        c.globalAlpha = clamp(k * 1.5);
        c.beginPath(); c.arc(p[0], p[1], R * (0.7 + 0.3 * k), 0, TAU); c.fillStyle = TONE.hi; c.fill();
        c.font = '600 17px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#FFFFFF';
        c.fillText(String(n).padStart(2, '0'), p[0], p[1] + 1);
      } });
      self.legend(n, text, { at, out: b.out });
      return S;
    };

    /** S.view([{ at, focus: [x, y, z] | a part's handle, zoom=1.6, dur=1 }, { at, zoom: 1 }]): the camera, inside the figure: push in on a
     *  point (the detail the narration is about) and come back to the whole (zoom: 1, no focus). The parts are redrawn at the new scale,
     *  so lines stay sharp. At most two pushes per page. */
    S.view = (list) => { views.push(...[].concat(list).sort((p1, p2) => p1.at - p2.at)); return S; };
    return S;
  };

  // ── the card: legend, phase word, readout, a big value, the title ─
  const hudOf = (self) => self.hud || self;
  // the card's bottom row: the legend on the left; the phase word and the readout on the right
  const rightBox = (T) => T._rightBox || (T._rightBox = h('div', 'ins-right', null, T.html));
  /** legend(n, text, { at, out }): one entry of the legend along the card's bottom left (S.key calls it for you). */
  B.legend = function (n, text, o = {}) {
    const T = hudOf(this);
    let box = T._legendBox;
    if (!box) { box = T._legendBox = h('div', 'ins-legend', null, T.html); }
    const row = h('div', 'ins-key', null, box);
    row.innerHTML = `<b>${String(n).padStart(2, '0')}</b><span>${text}</span>`;
    const at = o.at ?? 0, rows = T._legendRows || (T._legendRows = []);
    rows.push(at);
    // the legend holds the 4 most recently named parts: an older entry folds away when a fifth is named
    T.tick((lt) => {
      const later = rows.filter((t) => t > at && t <= lt).length, gone = later >= 4 ? rows.filter((t) => t > at).sort((a, b) => a - b)[3] : null;
      const k = settle(lt, at, 0.4) * (o.out != null ? 1 - settle(lt, o.out, 0.4) : 1) * (gone != null ? 1 - settle(lt, gone, 0.35) : 1);
      row.style.opacity = clamp(k * 1.4).toFixed(3); row.style.transform = `translateX(${((1 - k) * 12).toFixed(1)}px)`;
      row.style.display = gone != null && lt > gone + 0.4 ? 'none' : '';
    });
    return row;
  };
  /** track([[t, v], …], { from=0, dur=0.6 }) → lt => value: the page's model variable. It starts at `from` and settles to each v from time
   *  t (critically damped: no overshoot). Pass the same function to the parts that move (a needle's value, a pin's height, a drawer's
   *  open) AND to P.readout / P.value, so the number on screen is always the one the machine shows. */
  B.track = function (keys, o = {}) {
    const ks = [...keys].sort((a, b) => a[0] - b[0]), dur = o.dur ?? 0.6, from = o.from ?? 0;
    return (lt) => { let v = from, prev = from; for (const [t, x] of ks) { v += (x - prev) * settle(lt, t, dur); prev = x; } return v; };
  };
  /** readout(lt => value, { fmt, label, unit, at }): the live readout at the card's bottom right, in mono: `label` then the value as
   *  fmt(value) (default: a rounded number) and its unit. Feed it the same function that moves the parts. One per page. */
  B.readout = function (fn, o = {}) {
    const T = hudOf(this), el = h('div', 'ins-readout', null, rightBox(T)), at = o.at ?? 0;
    const fmt = o.fmt || ((v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10).toString()) : String(v)));
    T.tick((lt) => {
      const txt = `${o.label ? `<i>${o.label}</i>` : ''}<b>${fmt(fn(lt))}</b>${o.unit ? `<i>${o.unit}</i>` : ''}`;
      if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      el.style.opacity = clamp(settle(lt, at, 0.4) * 1.4).toFixed(3);
    });
    return el;
  };
  /** phase([[t, 'word'], …]): the phase word at the card's bottom right, before the readout (what the machine is doing now: "ARMING", "PINS SET", "TURNING"),
   *  switching at each t with a short crossfade. A few words in capitals. */
  B.phase = function (list) {
    const T = hudOf(this), el = h('div', 'ins-phase', null, rightBox(T)), ks = [...list].sort((a, b) => a[0] - b[0]);
    T.tick((lt) => {
      let cur = null, t0 = 0; for (const [t, w] of ks) if (lt >= t) { cur = w; t0 = t; }
      if (cur == null) { el.style.opacity = '0'; return; }
      const txt = `<s></s>${cur}`; if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      el.style.opacity = clamp(settle(lt, t0, 0.3) * 1.4).toFixed(3);
    });
    return el;
  };
  /** caption(str, { at }): the machine's name at the card's top right, small mono capitals ("PIN-TUMBLER LOCK · 5 PINS"). Say what the
   *  object is, not the concept. */
  B.caption = function (str, o = {}) {
    const T = hudOf(this), el = h('div', 'ins-caption', null, T.html); el.textContent = str;
    const at = o.at ?? 0.2; T.tick((lt) => { el.style.opacity = clamp(settle(lt, at, 0.4) * 1.3).toFixed(3); });
    return el;
  };
  /** value(x, y, lt => v, { fmt, unit, label, size=104, align='l', at }): a big measured number in the card's margin, with a hairline above
   *  it and a small mono label: the page's key figure. It reads the same model function as the parts, so it counts as they move. Keep it
   *  beside the machine, never over it; at most one per page. */
  B.value = function (x, y, fn, o = {}) {
    const el = h('div', 'ins-value', null, this.html), size = o.size ?? 104, at = o.at ?? 0;
    const fmt = o.fmt || ((v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10).toString()));
    el.style.fontSize = size + 'px';
    this.tick((lt) => {
      const txt = `${o.label ? `<small>${o.label}</small>` : ''}<b>${fmt(fn(lt))}${o.unit ? `<em>${o.unit}</em>` : ''}</b>`;
      if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      const w = el.offsetWidth; el.style.left = Math.min(STAGE.w - 120 - w, o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px'; el.style.top = y - size * 0.75 + 'px';   // never past the card's right edge
      const k = settle(lt, at, 0.45); el.style.opacity = clamp(k * 1.4).toFixed(3); el.style.transform = `translateY(${((1 - k) * 10).toFixed(1)}px)`;
    });
    return el;
  };
  // the page title: "FIG 03" in the accent, then the title in graphite, top left of the card
  B.title = function (str, o = {}) {
    const T = hudOf(this), at = o.at ?? 0.1;
    const n = parseInt(String(this.page?.id || '').replace(/\D/g, ''), 10) || 1;
    const el = h('div', 'ins-title', null, T.html);
    el.innerHTML = `<b>FIG ${String(o.fig ?? n).padStart(2, '0')}</b><span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
    T.tick((lt) => { const k = settle(lt, at, 0.45); el.style.opacity = clamp(k * 1.3).toFixed(3); el.style.transform = `translateY(${((1 - k) * 10).toFixed(1)}px)`; });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // text appears as a block (no handwriting pen), in the figure's sans
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.4, font: 'latin' }, o, { pen: false })); };
})();
