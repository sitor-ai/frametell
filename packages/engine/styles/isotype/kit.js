/* Isotype · kit: pictorial statistics in the Vienna Method tradition. A library of flat geometric pictograms (each one
 * built from circles, rectangles and simple polygons on a 100-unit-high box, one weight and one proportion for all),
 * counted rows and blocks of identical figures that stamp in one by one in counting order, a cut (never shrunk) last
 * figure for a fraction, keys, labelled row comparisons, columns on a baseline, a grid of map regions, figures that
 * re-colour or walk from one group to another, a year ticker and flat block arrows.
 * Everything is a pure function of page-local time lt: every timeline (arrivals, colour changes, moves, dims) is fixed
 * at build, and one per-frame tick reads it. Original code; no third-party source. */
(function () {
  const { col, clamp, lerp, ease, Builder, h, s } = PV;
  const B = Builder.prototype;
  const f2 = (n) => (+n).toFixed(2);
  const io = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const cjk = (str) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(str || '');
  let uid = 0;

  // ── shape helpers: each returns path data, wound the same way (clockwise on screen), so a union is a plain nonzero fill
  const n1 = (v) => (Math.round(v * 100) / 100).toString();
  const R = (x, y, w, hh, r = 0) => {
    r = Math.min(r, w / 2, hh / 2);
    if (!r) return `M${n1(x)} ${n1(y)}H${n1(x + w)}V${n1(y + hh)}H${n1(x)}Z`;
    return `M${n1(x + r)} ${n1(y)}H${n1(x + w - r)}A${r} ${r} 0 0 1 ${n1(x + w)} ${n1(y + r)}V${n1(y + hh - r)}A${r} ${r} 0 0 1 ${n1(x + w - r)} ${n1(y + hh)}H${n1(x + r)}A${r} ${r} 0 0 1 ${n1(x)} ${n1(y + hh - r)}V${n1(y + r)}A${r} ${r} 0 0 1 ${n1(x + r)} ${n1(y)}Z`;
  };
  /** a rectangle rounded on its top corners only (shoulders, roofs of cabs) */
  const T = (x, y, w, hh, r) => { r = Math.min(r, w / 2, hh); return `M${n1(x)} ${n1(y + hh)}V${n1(y + r)}A${r} ${r} 0 0 1 ${n1(x + r)} ${n1(y)}H${n1(x + w - r)}A${r} ${r} 0 0 1 ${n1(x + w)} ${n1(y + r)}V${n1(y + hh)}Z`; };
  const C = (cx, cy, r) => `M${n1(cx - r)} ${n1(cy)}A${r} ${r} 0 1 1 ${n1(cx + r)} ${n1(cy)}A${r} ${r} 0 1 1 ${n1(cx - r)} ${n1(cy)}Z`;
  const Pg = (...p) => {
    let a = 0;
    for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
    const pts = [];
    for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    if (a < 0) pts.reverse();
    return 'M' + pts.map((q) => n1(q[0]) + ' ' + n1(q[1])).join('L') + 'Z';
  };
  /** an ellipse as a polygon, rotated by rot degrees (grains, leaves, fish) */
  const E = (cx, cy, rx, ry, rot = 0, n = 28) => {
    const a = (rot * Math.PI) / 180, p = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2, x = Math.cos(t) * rx, y = Math.sin(t) * ry; p.push(cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)); }
    return Pg(...p);
  };
  /** a straight bar of thickness t from (x1,y1) to (x2,y2) (bicycle frames, hands of a clock) */
  const Bar = (x1, y1, x2, y2, t) => { const l = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (-(y2 - y1) / l) * t / 2, ny = ((x2 - x1) / l) * t / 2; return Pg(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny); };
  /** a disc segment: the part of circle (cx,cy,r) from angle a0 to a1 (degrees, 0 = east, clockwise), closed by its chord */
  const Seg = (cx, cy, r, a0, a1, n = 24) => { const p = []; for (let i = 0; i <= n; i++) { const t = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180; p.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r); } return Pg(...p); };

  // ── the pictogram library. Every glyph sits in a box 100 units high and `w` wide, standing on y = 100.
  //    s: the solid parts (their union is the figure); x: holes cut through it (windows, slits between arm and body);
  //    k: parts kept solid after the holes (a wheel inside the gap that frees it from the body).
  const man = (dx = 0, dy = 0) => ({
    s: [C(23 + dx, 11 + dy, 10.5), T(3 + dx, 25 + dy, 40, 34 - dy, 10), R(11 + dx, 58, 11.5, 42), R(23.5 + dx, 58, 11.5, 42)],
    x: [R(9.6 + dx, 35 + dy, 2, 24.5 - dy), R(34.4 + dx, 35 + dy, 2, 24.5 - dy)],
  });
  const G = {
    man: Object.assign({ w: 46 }, man()),
    woman: { w: 46,
      s: [C(23, 11, 10.5), T(5, 25, 36, 25.5, 10), Pg(7.5, 49.5, 38.5, 49.5, 45, 82, 1, 82), R(12.5, 81, 8.5, 19), R(25, 81, 8.5, 19)],
      x: [R(11, 34, 2, 16.6), R(33, 34, 2, 16.6), R(1, 49.6, 44, 1.6)] },
    child: { w: 36,
      s: [C(18, 42, 8.6), T(4, 54, 28, 23.5, 7.5), R(10, 76.5, 7.5, 23.5), R(18.5, 76.5, 7.5, 23.5)],
      x: [R(8.6, 61, 1.7, 16.6), R(25.7, 61, 1.7, 16.6)] },
    worker: (() => { const m = man(); return { w: 46, s: m.s.concat([T(12, -1.5, 22, 8.5, 6), R(12, 4.4, 27.5, 3.6)]), x: m.x.concat([R(11, 8.2, 30, 1.8)]) }; })(),
    elder: (() => { const m = man(0, 5); return { w: 54, s: m.s.concat([R(47.4, 48, 3.8, 52), T(42, 45.5, 9.2, 4.5, 2.2), Bar(38.5, 41, 47.5, 49, 5.5)]), x: m.x }; })(),
    doctor: (() => { const m = man(); return { w: 46, s: m.s, x: m.x.concat([R(20.6, 31.5, 4.8, 16), R(15.4, 37.1, 15.2, 4.8)]) }; })(),
    house: { w: 80,
      s: [Pg(0, 46, 40, 8, 80, 46), R(57, 12, 9, 26), R(7, 46, 66, 54)],
      x: [R(34, 72, 12, 29), R(15, 56, 12, 11), R(53, 56, 12, 11), R(7, 44.8, 66, 1.8)] },
    flats: { w: 56,
      s: [R(4, 6, 48, 94)],
      x: [0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2].map((c) => R(10 + c * 13.5, 14 + r * 13.5, 9, 7.5))).concat([R(22, 84, 12, 17)]) },
    factory: { w: 100,
      s: [Pg(0, 100, 0, 46, 22, 30, 22, 46, 44, 30, 44, 46, 66, 30, 66, 46, 78, 46, 78, 4, 90, 4, 90, 46, 100, 46, 100, 100)],
      x: [R(6, 60, 11, 13), R(28, 60, 11, 13), R(50, 60, 11, 13), R(80, 72, 12, 29), R(78, 12, 12, 2.6)] },
    car: { w: 100,
      s: [R(2, 54, 96, 24, 5), Pg(22, 55, 32, 33, 68, 33, 80, 55), C(26, 82, 11.5), C(74, 82, 11.5)],
      x: [Pg(36, 39, 48, 39, 48, 53, 30, 53), Pg(52, 39, 65, 39, 72, 53, 52, 53), C(26, 82, 15), C(74, 82, 15)],
      k: [C(26, 82, 11.5), C(74, 82, 11.5)] },
    bus: { w: 112,
      s: [R(2, 18, 108, 62, 7), C(28, 84, 11), C(86, 84, 11)],
      x: [0, 1, 2, 3, 4].map((k) => R(10 + k * 19.5, 28, 14, 18)).concat([R(4, 58, 104, 2), C(28, 84, 14.5), C(86, 84, 14.5)]),
      k: [C(28, 84, 11), C(86, 84, 11)] },
    truck: { w: 116,
      s: [R(2, 20, 72, 60, 2), T(78, 40, 36, 40, 8), C(24, 86, 11), C(92, 86, 11)],
      x: [Pg(86, 47, 104, 47, 108, 60, 86, 60), C(24, 86, 14.5), C(92, 86, 14.5)],
      k: [C(24, 86, 11), C(92, 86, 11)] },
    tractor: { w: 100,
      s: [C(70, 72, 26), C(20, 86, 13), R(16, 50, 40, 22, 3), R(52, 18, 32, 32), R(26, 30, 5, 21)],
      x: [R(57, 23, 22, 18), C(70, 72, 29.5), C(20, 86, 16.5), C(70, 72, 9), Bar(54, 18.5, 86, 18.5, 2)],
      k: [Seg(70, 72, 26, 0, 360), C(20, 86, 13)] },
    ship: { w: 116,
      s: [Pg(0, 62, 116, 62, 102, 92, 12, 92), R(24, 44, 60, 18), R(36, 30, 36, 14), R(62, 8, 13, 22)],
      x: [C(28, 74, 3.8), C(46, 74, 3.8), C(64, 74, 3.8), C(82, 74, 3.8), R(62, 14, 13, 3), R(24, 61.2, 60, 1.6)] },
    plane: { w: 116,
      s: [R(8, 44, 104, 15, 7.5), Pg(46, 52, 70, 52, 54, 88, 42, 88), Pg(46, 48, 66, 48, 54, 22, 46, 22), Pg(8, 46, 22, 46, 12, 22, 4, 22)],
      x: [C(96, 50.5, 2.6), C(88, 50.5, 2.6), C(80, 50.5, 2.6)] },
    bike: { w: 100,
      s: [C(22, 74, 20), C(78, 74, 20), Bar(22, 74, 44, 74, 4.5), Bar(44, 74, 62, 46, 4.5), Bar(36, 46, 22, 74, 4.5), Bar(36, 46, 64, 46, 4.5), Bar(62, 40, 78, 74, 4.5), Bar(36, 40, 37, 50, 4.5), R(30, 36, 14, 5, 2.5), R(58, 36, 12, 5, 2.5)],
      x: [C(22, 74, 15.5), C(78, 74, 15.5)],
      k: [C(22, 74, 3.5), C(78, 74, 3.5), Bar(22, 74, 44, 74, 4.5), Bar(36, 46, 22, 74, 4.5), Bar(62, 40, 78, 74, 4.5)] },
    coin: { w: 64,
      s: [C(32, 64, 30)],
      x: [C(32, 64, 24.5), C(32, 64, 1)],
      k: [C(32, 64, 21.5)],
      x2: [R(29, 50, 6, 28), R(22, 56, 20, 3), R(22, 64, 20, 3)] },
    note: { w: 104,
      s: [R(2, 34, 100, 54, 2)],
      x: [R(7, 39, 90, 44)],
      k: [R(10, 42, 84, 38)],
      x2: [C(52, 61, 12), R(16, 47, 12, 4), R(76, 70, 12, 4)] },
    sack: { w: 64,
      s: [Pg(18, 26, 46, 26, 58, 46, 62, 74, 58, 100, 6, 100, 2, 74, 6, 46), R(22, 14, 20, 9, 2), Pg(20, 13, 44, 13, 52, 2, 12, 2)],
      x: [R(2, 64, 60, 4.5), R(20, 22.5, 24, 2.5)] },
    wheat: { w: 44,
      s: [R(20.6, 34, 2.8, 66), E(22, 12, 5, 10)].concat([0, 1, 2].flatMap((k) => [E(13.5, 25 + k * 13, 5, 9.5, -35), E(30.5, 25 + k * 13, 5, 9.5, 35)])) },
    bowl: { w: 92,
      s: [Seg(42, 56, 40, 0, 180), R(28, 92, 28, 8, 2), Seg(42, 53, 31, 180, 360), Bar(56, 36, 84, 6, 4), Bar(62, 39, 92, 13, 4)],
      x: [R(0, 52.5, 92, 3.5)] },
    bread: { w: 92,
      s: [Pg(4, 100, 4, 62, 10, 50, 24, 42, 46, 38, 68, 42, 82, 50, 88, 62, 88, 100)],
      x: [Bar(28, 52, 36, 72, 4), Bar(46, 50, 54, 70, 4), Bar(64, 52, 72, 72, 4)] },
    fish: { w: 104,
      s: [E(46, 60, 40, 20), Pg(78, 60, 102, 40, 102, 80)],
      x: [C(20, 54, 3.4), Bar(30, 44, 30, 76, 2.2)] },
    cow: { w: 112,
      s: [R(16, 34, 74, 32, 8), R(22, 62, 9, 38), R(36, 62, 9, 38), R(66, 62, 9, 38), R(80, 62, 9, 38), Pg(86, 30, 106, 32, 110, 54, 98, 60, 86, 52), Pg(90, 31, 92, 18, 97, 31), Bar(16, 38, 6, 70, 4)],
      x: [C(100, 42, 2.4)] },
    sheep: { w: 100,
      s: [C(24, 54, 15), C(40, 44, 17), C(58, 45, 16), C(70, 58, 13), C(36, 64, 15), C(54, 64, 14), R(26, 70, 7, 30), R(58, 70, 7, 30)],
      x: [C(86, 46, 13)],
      k: [E(86, 47, 11, 8.5, 25)],
      x2: [C(89, 44, 2)] },
    tree: { w: 72,
      s: [C(36, 36, 30), R(32, 60, 8, 40)],
      x: [] },
    pine: { w: 64,
      s: [Pg(32, 2, 54, 34, 10, 34), Pg(32, 20, 60, 58, 4, 58), Pg(32, 40, 64, 82, 0, 82), R(28, 82, 8, 18)] },
    book: { w: 76,
      s: [Pg(2, 28, 36, 20, 36, 92, 2, 100), Pg(40, 20, 74, 28, 74, 100, 40, 92)],
      x: [Bar(8, 42, 30, 37, 2.4), Bar(8, 54, 30, 49, 2.4), Bar(8, 66, 30, 61, 2.4), Bar(46, 37, 68, 42, 2.4), Bar(46, 49, 68, 54, 2.4), Bar(46, 61, 68, 66, 2.4)] },
    phone: { w: 46,
      s: [R(6, 4, 34, 96, 7)],
      x: [R(13, 17, 20, 56), C(23, 87.5, 4.5)] },
    computer: { w: 84,
      s: [R(4, 14, 76, 54, 3), R(36, 68, 12, 18), R(18, 86, 48, 14, 2)],
      x: [R(10, 20, 64, 42)] },
    hospital: { w: 92,
      s: [R(4, 20, 84, 80)],
      x: [R(40, 28, 12, 34), R(29, 39, 34, 12), R(38, 76, 16, 25), R(12, 72, 14, 12), R(66, 72, 14, 12)] },
    school: { w: 92,
      s: [Pg(0, 46, 46, 12, 92, 46), R(6, 46, 80, 54), R(42, 0, 8, 14)],
      x: [C(46, 34, 6), R(39, 72, 14, 29), R(14, 58, 14, 14), R(64, 58, 14, 14), R(6, 44.8, 80, 1.8)] },
    bed: { w: 112,
      s: [R(2, 28, 9, 72, 2), R(11, 60, 99, 15), R(101, 62, 9, 38), R(15, 47, 26, 12, 6), R(44, 50, 60, 10, 3)],
      x: [] },
    cross: { w: 80,
      s: [Pg(28, 20, 52, 20, 52, 44, 76, 44, 76, 68, 52, 68, 52, 92, 28, 92, 28, 68, 4, 68, 4, 44, 28, 44)] },
    bolt: { w: 52,
      s: [Pg(32, 0, 6, 58, 24, 58, 14, 100, 48, 38, 29, 38, 40, 0)] },
    drop: { w: 54,
      s: [C(27, 70, 24), Pg(27, 2, 4.5, 62, 49.5, 62)],
      x: [E(17, 72, 4, 9, 20)] },
    barrel: { w: 62,
      s: [R(6, 6, 50, 94, 7)],
      x: [R(6, 26, 50, 3.6), R(6, 76, 50, 3.6), C(31, 52, 6)] },
    cloud: { w: 104,
      s: [C(28, 64, 22), C(52, 50, 28), C(78, 62, 22), R(28, 64, 50, 22)],
      x: [] },
    clock: { w: 84,
      s: [C(42, 58, 40)],
      x: [Bar(42, 58, 42, 28, 8), Bar(42, 58, 64, 70, 8), R(39, 19, 6, 7), R(39, 90, 6, 7), R(3, 55, 7, 6), R(74, 55, 7, 6)] },
    globe: { w: 84,
      s: [C(42, 58, 40)],
      x: [C(42, 58, 34.5)],
      k: [E(42, 58, 15, 34.5), R(7.5, 56, 69, 4)],
      x2: [E(42, 58, 10.5, 30)] },
  };
  /** PV.glyphs: the names of every pictogram the kit draws. */
  // below ~64 px the fine cuts (arm slits, phone screens, window grids, hollow rims) close up into outlines: a small
  // figure keeps only the cuts that make it what it is, so it stays a solid silhouette
  const XS = {
    house: [R(34, 70, 12, 31)], school: [R(39, 70, 14, 31)], hospital: [R(39, 28, 14, 36), R(28, 39, 36, 14)],
    doctor: [R(19.6, 30.5, 6.8, 18), R(14.4, 36.4, 17.2, 6.4)], flats: [R(11, 16, 13, 12), R(32, 16, 13, 12), R(11, 40, 13, 12), R(32, 40, 13, 12), R(21, 76, 14, 25)],
    factory: [R(80, 70, 12, 31)], coin: [R(27, 46, 10, 36)], note: [C(52, 61, 14)], clock: [Bar(42, 58, 42, 28, 8), Bar(42, 58, 64, 70, 8)],
    globe: [R(0, 54, 84, 7), R(38.5, 16, 7, 84)], computer: [R(14, 24, 56, 34)], phone: [C(23, 88, 5.5)], bus: [R(10, 28, 92, 16)],
    barrel: [R(6, 25, 50, 7), R(6, 74, 50, 7)], sack: [R(2, 62, 60, 7)], bike: [C(22, 74, 11), C(78, 74, 11)], fish: [C(20, 54, 5)],
    tractor: [R(57, 23, 22, 18)], car: [Pg(36, 39, 48, 39, 48, 53, 30, 53), Pg(52, 39, 65, 39, 72, 53, 52, 53)],
  };
  PV.glyphs = Object.keys(G);
  const gw = (name) => (G[name] || G.man).w;

  // ── colours
  const hex = (c) => { c = col(c) || c; return /^#[0-9a-f]{6}$/i.test(c) ? c : '#1F1D1A'; };
  const rgb = (c) => { c = hex(c); return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  const mix = (a, b, k) => { if (k <= 0) return hex(a); if (k >= 1) return hex(b); const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };

  // ── per-page state: one svg layer for every figure, the masks of the glyphs, one tick that renders all of them
  function M(P) {
    if (P.sh.iso) return P.sh.iso;
    const svg = P.svg;
    const defs = s('defs', {}, svg);
    const m = { P, svg, defs, masks: {}, figs: [], renders: [], extra: [], glyphs: [] };
    P.sh.iso = m;
    // the page fit is measured once, right after every page is built (a microtask after ENGINE.init), from geometry only:
    // the same in every browser whatever frame it draws first. The act is a fallback that can only run the same measure.
    queueMicrotask(() => { if (!m.fitted) fitPage(m); });
    P.act({ at: 0, dur: 0.01, g: svg, kind: 'show', pen: false, apply: () => { if (!m.fitted) fitPage(m); } });
    P.tick((lt) => { for (const f of m.figs) renderFig(f, lt); for (const r of m.renders) r(lt); });
    return m;
  }
  // ── the page fit. Pages often hand the kit small figures hung from the top of the frame. Once the page is built, the
  //    whole drawing (figures, keys, captions, close-ups, the page's own marks) is measured and, as one piece, scaled up
  //    (≤ 1.45×) and centred to fill the content area x 140–1780, y 190–880; a drawing already as wide as the area but
  //    leaving more than a quarter of it empty below is moved down to the centre. A page may only get bigger.
  const CA = { x0: STAGE.area.x0, y0: STAGE.area.y0 + 10, x1: STAGE.area.x1, y1: STAGE.area.y1 };
  const SHIFT = { r: [-1, -0.5], m: [0, -0.5], c: [-0.5, 0], rt: [-1, 0] };
  function fitPage(m) {
    m.fitted = true;
    const cam = m.P.host.closest('.cam') || m.P.host;
    if (!cam.isConnected) return;
    // measure with the page shown (a page hidden by the timeline has no layout); restored before anything paints
    const root = cam.closest('.page') || cam, disp = root.style.display;
    root.style.display = 'block';
    try { fitMeasured(m, cam); } finally { root.style.display = disp; }
  }
  function fitMeasured(m, cam) {
    growGrids(m);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const add = (a, b, c, d) => { if (!(c > a) || !(d > b)) return; x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
    for (const sv of cam.querySelectorAll('svg.ink')) { try { const b = sv.getBBox(); add(b.x, b.y, b.x + b.width, b.y + b.height); } catch (e) { /* not rendered */ } }
    for (const txt of cam.querySelectorAll('.txt')) for (const el of txt.children) {
      if (el.dataset.isoSkip) continue;
      const w = el.offsetWidth, hh = el.offsetHeight;
      if (!w || !hh) continue;
      let dx = 0, dy = 0;
      if (el.classList.contains('is-cap')) { for (const k in SHIFT) if (el.classList.contains(k)) { dx = SHIFT[k][0]; dy = SHIFT[k][1]; } }
      else if (el.classList.contains('is-num')) dy = -0.5;
      else if (el.classList.contains('is-year')) dx = -0.5;
      add(el.offsetLeft + dx * w, el.offsetTop + dy * hh, el.offsetLeft + (dx + 1) * w, el.offsetTop + (dy + 1) * hh);
    }
    for (const b of m.extra) add(b[0], b[1], b[2], b[3]);
    if (!(x1 > x0)) return;
    const bw = x1 - x0, bh = y1 - y0, aw = CA.x1 - CA.x0, ah = CA.y1 - CA.y0;
    let sc = Math.min(aw / bw, ah / bh, 1.45);
    // what started below the content top stays below it: scaling may only push things down from y 190, never up
    if (y1 > CA.y0) sc = Math.min(sc, ah / (y1 - CA.y0));
    if (sc < 1.06) sc = 1;
    let tx = 0, ty = 0;
    if (sc > 1) { tx = (CA.x0 + CA.x1) / 2 - sc * (x0 + x1) / 2; ty = (CA.y0 + CA.y1) / 2 - sc * (y0 + y1) / 2; }
    else if (CA.y1 - y1 > ah * 0.25 && y0 - CA.y0 < ah * 0.12) ty = (CA.y0 + CA.y1) / 2 - (y0 + y1) / 2;
    if (sc * CA.y0 + ty < CA.y0) ty = CA.y0 * (1 - sc);
    // a drawing the page put above the content top comes down, as far as the room below allows
    if (sc * y0 + ty < CA.y0) ty += Math.max(0, Math.min(CA.y0 - (sc * y0 + ty), CA.y1 - (sc * y1 + ty)));
    const B2 = { x0: sc * x0 + tx, y0: sc * y0 + ty, x1: sc * x1 + tx, y1: sc * y1 + ty };
    clampCams(m, B2, sc, tx, ty);
    if (sc === 1 && Math.abs(ty) < 4 && Math.abs(tx) < 4) return;
    const wrap = h('div', 'is-fit', null, null);
    Object.assign(wrap.style, { position: 'absolute', left: '0px', top: '0px', width: STAGE.w + 'px', height: STAGE.h + 'px', transformOrigin: '0 0', transform: `translate(${f2(tx)}px, ${f2(ty)}px) scale(${sc.toFixed(4)})` });
    while (cam.firstChild) wrap.appendChild(cam.firstChild);
    cam.appendChild(wrap);
    m.fit = { sc, tx, ty };
  }
  // a camera push may never carry the drawing over the title or into the subtitles: its scale drops until the whole
  // drawing fits inside x 140–1780, y 190–880, and its centre is clamped so it does
  function clampCams(m, b, sc, tx, ty) {
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    for (const k of m.P.sh.cams || []) {
      if (!k || k.x == null || !(k.s > 1.001)) continue;
      const x = sc * k.x + tx, y = sc * k.y + ty;   // keys were aimed at the unfitted drawing
      let sk = Math.min(k.s, (CA.x1 - CA.x0) / bw, (CA.y1 - CA.y0) / bh);
      if (sk < 1.02) { k.s = 1; k.x = STAGE.w / 2; k.y = STAGE.h / 2; continue; }
      const xl = b.x1 - (CA.x1 - STAGE.w / 2) / sk, xh = b.x0 + (STAGE.w / 2 - CA.x0) / sk, yl = b.y1 - (CA.y1 - STAGE.h / 2) / sk, yh = b.y0 + (STAGE.h / 2 - CA.y0) / sk;
      k.s = sk; k.x = clamp(x, Math.min(xl, xh), Math.max(xl, xh)); k.y = clamp(y, Math.min(yl, yh), Math.max(yl, yh));
    }
  }
  // many small P.glyph calls set out on the page's own grid (a hand-made counted block) grow to fill their cells, so
  // the gap stays about 30% of a figure's width instead of pins in wide spaces
  function growGrids(m) {
    const groups = {};
    for (const g of m.glyphs) (groups[Math.round(g.size)] ||= []).push(g);   // one grid = one size, whatever the glyphs
    for (const key in groups) {
      const L = groups[key];
      if (L.length < 6) continue;
      let dx = Infinity, dy = Infinity;
      for (const a of L) for (const b of L) {
        if (a === b) continue;
        if (Math.abs(a.cy - b.cy) < 1 && b.cx > a.cx) dx = Math.min(dx, b.cx - a.cx);
        if (Math.abs(a.cx - b.cx) < 1 && b.cy > a.cy) dy = Math.min(dy, b.cy - a.cy);
      }
      const r = Math.max(...L.map((g) => gw(g.name))) / 100, size = L[0].size;
      let ns = Math.min(dx / (r * 1.3), dy / 1.22, size * 3);
      if (!isFinite(ns) || ns < size * 1.12) ns = size;
      // cells far wider than the figure (pins in wide gaps): the columns close up, from the block's left edge
      const left = Math.min(...L.map((g) => g.cx)), pitch = r * ns * 1.3;
      const k = isFinite(dx) && dx > pitch * 1.25 ? pitch / dx : 1;
      if (ns === size && k === 1) continue;
      for (const g of L) {
        const f = g.f, cx = left + (g.cx - left) * k;
        f.sc = ns / 100; f.hh = ns; f.w = r * ns; f.x = cx - f.w / 2; f.y = g.cy - ns / 2; f.last = {};
        f.el.setAttribute('transform', `translate(${f2(f.x)} ${f2(f.y)}) scale(${f.sc.toFixed(4)})`);
      }
    }
  }
  function maskFor(m, name, small) {
    const g = G[name], key = name + (small ? '|s' : '');
    const holes = small ? XS[name] || [] : g.x || [];
    if (!holes.length) return null;
    if (m.masks[key]) return m.masks[key];
    const id = `iso-m${++uid}`;
    const mk = s('mask', { id, maskUnits: 'userSpaceOnUse', x: -20, y: -20, width: g.w + 40, height: 140 }, m.defs);
    s('rect', { x: -20, y: -20, width: g.w + 40, height: 140, fill: '#fff' }, mk);
    s('path', { d: holes.join(''), fill: '#000' }, mk);
    if (!small && g.k) s('path', { d: g.k.join(''), fill: '#fff' }, mk);
    if (!small && g.x2) s('path', { d: g.x2.join(''), fill: '#000' }, mk);
    m.masks[key] = `url(#${id})`;
    return m.masks[key];
  }
  /** a figure: an svg group placed at (x, y) (top left of its box), height hh, cut to `frac` of its width */
  function makeFig(m, parent, name, x, y, hh, color, frac) {
    name = G[name] ? name : 'man';
    const g = G[name], sc = hh / 100;
    const outer = s('g', { visibility: 'hidden', transform: `translate(${f2(x)} ${f2(y)}) scale(${sc.toFixed(4)})` }, parent || m.svg);
    let inner = outer;
    if (frac < 0.999) {
      const id = `iso-c${++uid}`;
      const cp = s('clipPath', { id }, m.defs);
      s('rect', { x: -2, y: -20, width: f2(g.w * frac + 2), height: 140 }, cp);
      inner = s('g', { 'clip-path': `url(#${id})` }, outer);
    }
    const mk = maskFor(m, name, hh < 64);
    const body = s('g', mk ? { mask: mk } : {}, inner);
    const path = s('path', { d: g.s.join(''), fill: hex(color) }, body);
    const f = { el: outer, path, name, sc, w: g.w * sc, hh, x, y, color: hex(color), frac, t0: 1e9, moves: [], cols: [], ops: [], last: {} };
    m.figs.push(f);
    return f;
  }
  function figPos(f, lt) {
    let x = f.x, y = f.y;
    for (const mv of f.moves) {
      if (lt < mv.t0) break;
      const k = io((lt - mv.t0) / (mv.t1 - mv.t0));
      x = lerp(mv.fx, mv.tx, k); y = lerp(mv.fy, mv.ty, k) - Math.sin(Math.PI * k) * (mv.lift || 0);
      if (lt < mv.t1) break;
    }
    return [x, y];
  }
  function figColor(f, lt) {
    let c = f.color;
    for (const cc of f.cols) { if (lt < cc.t) break; c = mix(c, cc.c, (lt - cc.t) / cc.d); }
    return c;
  }
  function figOp(f, lt) {
    let v = 1;
    for (const o of f.ops) { if (lt < o.t) break; v = lerp(v, o.v, clamp((lt - o.t) / o.d)); }
    return v;
  }
  function renderFig(f, lt) {
    const k = clamp((lt - f.t0) / 0.18);
    const op = k * figOp(f, lt);
    const vis = op > 0.004;
    if (f.last.vis !== vis) { f.last.vis = vis; f.el.setAttribute('visibility', vis ? 'visible' : 'hidden'); }
    if (!vis) return;
    const [x, y] = figPos(f, lt);
    const dy = (1 - out(k)) * -10;   // stamped down onto the paper: a short drop, decelerating
    const tr = `translate(${f2(x)} ${f2(y + dy)}) scale(${f.sc.toFixed(4)})`;
    if (f.last.tr !== tr) { f.last.tr = tr; f.el.setAttribute('transform', tr); }
    const o = op.toFixed(3);
    if (f.last.op !== o) { f.last.op = o; f.el.setAttribute('opacity', o); }
    const c = figColor(f, lt);
    if (f.last.c !== c) { f.last.c = c; f.path.setAttribute('fill', c); }
  }
  const timing = (P, at, dur, g) => P.act({ at, dur: Math.max(0.05, dur), g, kind: 'show', pen: false, apply: () => {} });

  // ── text: small capitals in the geometric sans
  function capEl(P, cls, str, x, y, size, color, at) {
    const el = h('div', 'tx is-cap ' + cls + (cjk(str) ? ' zh' : ''), null, P.html);
    const lines = String(str).split('\n');
    el.innerHTML = '';
    const t = h('span', 't', null, el); t.textContent = lines[0];
    if (lines[1]) { const sb = h('span', 's', null, el); sb.textContent = lines[1]; }
    Object.assign(el.style, { left: f2(x) + 'px', top: f2(y) + 'px', fontSize: size + 'px', color: hex(color || 'ink'), opacity: '0' });
    const a = P.act({ at, dur: 0.35, g: el, kind: 'text', pen: false, apply: (k, lt, vis) => { el.style.opacity = f2((lt >= at ? out(k) : 0) * vis); } });
    return P.handle(a, el);
  }

  /** caption(x, y, str, o): a caption in small capitals of the geometric sans — row and column labels, units, the source
   *  line, a group's name beside its figures. '\n' adds a second, lighter line. o: { size (32; never under 30), color ('ink'),
   *  align 'l' | 'r' | 'c' (x is the left edge, right edge or centre), at }. Fades in over 0.35 s. */
  B.caption = function (x, y, str, o = {}) {
    const cls = { l: '', r: 'rt', c: 'c' }[o.align || 'l'];
    return capEl(this, cls, str, x, y, Math.max(30, o.size ?? 32), o.color, o.at ?? 0);
  };

  /** glyph(name, cx, cy, size, o): one pictogram on its own, centred on (cx, cy), size px tall — the subject of a page as a
   *  symbol (the one worker the film follows), an extreme close-up (size up to 620), or a figure in a key. Never a quantity:
   *  a bigger figure never means "more". name: any of PV.glyphs. o: { color ('ink'), at, cut (0–1: keep only this
   *  fraction of its width, cut straight down) }. Returns a handle: .recolor(t, color), .hide(t). */
  B.glyph = function (name, cx, cy, size, o = {}) {
    const m = M(this), at = o.at ?? 0;
    const w = gw(name) * size / 100;
    const f = makeFig(m, this.svg, name, cx - w / 2, cy - size / 2, size, o.color || 'ink', clamp(o.cut ?? 1, 0.05, 1));
    if (!(o.cut < 1)) m.glyphs.push({ f, name: G[name] ? name : 'man', cx, cy, size });
    f.t0 = at;
    const a = timing(this, at, 0.2, f.el);
    return {
      el: f.el, a, box: () => ({ x: cx - w / 2, y: cy - size / 2, w, h: size }),
      recolor(t, c, d = 0.35) { f.cols.push({ t, c, d }); return this; },
      hide(t, d = 0.4) { f.ops.push({ t, v: 0, d }); return this; },
    };
  };

  // ── arrays: slots on a grid, figures that fill them in counting order
  function makeArray(P, o) {
    const m = M(P);
    const hh = o.h ?? 64;
    const glyphs = (o.groups || [{ n: o.n ?? 10, color: o.color, glyph: o.glyph }]).map((g) => g.glyph || o.glyph || 'man');
    const wMax = Math.max(...glyphs.map(gw)) * hh / 100;
    const gap = o.gap ?? Math.max(4, hh * 0.14), rowGap = o.rowGap ?? hh * 0.26;
    const px = wMax + gap, py = hh + rowGap;
    const A = { m, P, x: o.x, y: o.y, hh, px, py, wMax, cols: 1, dir: o.dir || 'down', order: o.order || 'row', members: [], spans: [], cap: 0 };
    return A;
  }
  function slotOf(A, i) {
    let c, r;
    if (A.order === 'col') { c = Math.floor(i / A.rows); r = i % A.rows; } else { c = i % A.cols; r = Math.floor(i / A.cols); }
    const x = A.x + c * A.px;
    const y = A.dir === 'up' ? A.y - A.hh - r * A.py : A.y + r * A.py;
    return { x, y };
  }
  // the largest figure (≤ maxH) that lets n figures fit a W × H box; rows balanced so the last one is not a stub
  const unitCount = (o) => (o.groups || [{ n: o.n ?? 10 }]).reduce((a, g) => { const n = Math.max(0, +g.n || 0), f = Math.floor(n + 1e-6); return a + f + (n - f > 0.04 ? 1 : 0); }, 0);
  function fitH(n, r, W, H, cols, maxH = 220) {
    for (let hh = maxH; hh > 18; hh -= 2) {
      const g = r * hh, px = g + Math.max(4, hh * 0.14);
      const c = cols || Math.max(1, Math.floor((W + px - g) / px));
      if (c * px - (px - g) > W) continue;
      const rows = Math.max(1, Math.ceil(n / c));
      if (rows * hh * 1.26 - hh * 0.26 <= H) return { hh, cols: cols || Math.ceil(n / rows) };
    }
    return { hh: 18, cols: cols || Math.max(1, Math.floor(W / (r * 18 + 4))) };
  }
  const glyphR = (o) => Math.max(...(o.groups || [{}]).map((g) => gw(g.glyph || o.glyph || 'man'))) / 100;
  /** the key under a block: [figure] = amount, at the block's bottom left */
  function keyUnder(P, o, x, y) {
    if (!o.key) return null;
    const g0 = (o.groups && o.groups[0]) || {};
    return P.key(x, y, [{ glyph: g0.glyph || o.glyph || 'man', color: o.keyColor || 'ink', text: o.key }], { at: o.keyAt ?? Math.max(0, (o.at ?? o.land ?? 0.4) - 0.1) });
  }
  function fillArray(A, o) {
    const groups = o.groups || [{ n: o.n ?? 10, color: o.color || 'ink', glyph: o.glyph || 'man' }];
    const total = groups.reduce((a, g) => a + Math.max(0, +g.n || 0), 0);
    const units = [];
    for (const g of groups) {
      const n = Math.max(0, +g.n || 0), full = Math.floor(n + 1e-6), fr = n - full;
      for (let i = 0; i < full; i++) units.push({ glyph: g.glyph || o.glyph || 'man', color: g.color || o.color || 'ink', frac: 1 });
      if (fr > 0.04) units.push({ glyph: g.glyph || o.glyph || 'man', color: g.color || o.color || 'ink', frac: fr });
    }
    const n = units.length;
    if (o.cols) A.cols = o.cols;
    else { const w = o.w ?? CA.x1 - CA.x0; A.cols = Math.max(1, Math.floor((w + (A.px - A.wMax)) / A.px)); }
    A.rows = o.rows || Math.max(1, Math.ceil(Math.max(n, o.cap || 0) / A.cols));
    if (A.order === 'col' && !o.cols) A.cols = Math.ceil(Math.max(n, o.cap || 0) / A.rows);
    // counting cadence: a few figures are counted one by one, a crowd arrives quicker
    const st = o.stagger ?? (o.dur != null ? o.dur / Math.max(1, n) : n <= 12 ? 0.16 : n <= 40 ? 0.07 : clamp(3 / n, 0.02, 0.05));
    let at = o.at ?? 0;
    if (o.land != null) at = o.land - Math.max(0, n - 1) * st - 0.18;
    A.at = at; A.end = at + Math.max(0, n - 1) * st + 0.18; A.total = total;
    units.forEach((u, i) => {
      const p = slotOf(A, i);
      const f = makeFig(A.m, A.P.svg, u.glyph, p.x + (A.wMax - gw(u.glyph) * A.hh / 100) / 2, p.y, A.hh, u.color, u.frac);
      f.t0 = at + i * st;
      f.weight = u.frac;
      A.members.push(f);
      A.spans.push({ f, enter: f.t0, leave: 1e9 });
    });
    return A;
  }
  const tallyAt = (A, lt) => { let v = 0; for (const sp of A.spans) if (lt >= sp.enter && lt < sp.leave) v += sp.f.weight; return v; };
  const fmtN = (v) => (Math.abs(v - Math.round(v)) < 0.02 ? String(Math.round(v)) : v.toFixed(1));
  function arrayHandle(A, P, o) {
    const g = A.members[0] ? A.members[0].el : A.m.svg;
    const a = timing(P, A.at, A.end - A.at, g);
    const H = {
      el: g, a, A,
      get end() { return A.end; },
      get count() { return A.members.length; },
      /** the top-left of slot i (where the i-th figure stands), for placing a label beside a figure */
      slot: (i) => slotOf(A, i),
      box: () => { const n = Math.max(1, A.members.length); const last = slotOf(A, n - 1); const cols = Math.min(A.cols, n); return { x: A.x, y: A.dir === 'up' ? last.y : A.y, w: cols * A.px - (A.px - A.wMax), h: Math.ceil(n / A.cols) * A.py - (A.py - A.hh) }; },
      recolor(t, from, to, c, oo = {}) {
        const list = A.members.slice(from ?? 0, to ?? A.members.length), st = oo.stagger ?? clamp(1.2 / Math.max(1, list.length), 0.02, 0.12);
        list.forEach((f, i) => f.cols.push({ t: t + i * st, c, d: oo.dur ?? 0.3 }));
        return H;
      },
      dim(t, oo = {}) {
        const keep = oo.except ? new Set(A.members.slice(oo.except[0], oo.except[1])) : new Set();
        for (const f of A.members) if (!keep.has(f)) f.ops.push({ t, v: oo.op ?? 0.28, d: 0.4 });
        return H;
      },
      undim(t) { for (const f of A.members) f.ops.push({ t, v: 1, d: 0.4 }); return H; },
      hide(t, d = 0.4) { for (const f of A.members) f.ops.push({ t, v: 0, d }); if (H._label) H._label.hide(t, d); if (H._tally) H._tallyOut = t; return H; },
      move(t, k, target, oo = {}) {
        const T = target.A || target;
        const list = A.members.splice(Math.max(0, A.members.length - k), k).reverse();
        const st = oo.stagger ?? clamp(1.6 / Math.max(1, list.length), 0.05, 0.22), dur = oo.dur ?? 1.1;
        list.forEach((f, i) => {
          const j = T.members.length, p = slotOf(T, j);
          const [fx, fy] = figPos(f, 1e8);
          const t0 = t + i * st, t1 = t0 + dur;
          f.moves.push({ t0, t1, fx, fy, tx: p.x + (T.wMax - f.w) / 2, ty: p.y, lift: oo.lift ?? 0 });
          A.m.extra.push([p.x, p.y - (oo.lift || 0), p.x + f.w, p.y + f.hh]);
          const sp = A.spans.find((q) => q.f === f && q.leave > 1e8); if (sp) sp.leave = t0;
          T.members.push(f); T.spans.push({ f, enter: t1, leave: 1e9 });
          const c = oo.color === undefined ? T.color : oo.color;
          if (c) f.cols.push({ t: t0 + dur * 0.35, c, d: dur * 0.3 });
        });
        return H;
      },
    };
    A.color = o.color || (o.groups && o.groups.length === 1 ? o.groups[0].color : null);
    // a running count that follows the latest figure, so the eye can count along
    if (o.tally) {
      const el = h('div', 'tx is-num', null, P.html);
      el.style.fontSize = (o.tallySize ?? Math.round(clamp(A.hh * 0.5, 40, 72))) + 'px';
      el.style.color = hex(o.tallyColor || 'ink');
      const fmt = typeof o.tally === 'function' ? o.tally : (v) => fmtN(v) + (o.unit ? `<span class="u">${o.unit}</span>` : '');
      H._tally = el;
      el.dataset.isoSkip = '1';
      A.m.renders.push((lt) => {
        const v = tallyAt(A, lt), on = lt >= A.at && v > 0 && (H._tallyOut == null || lt < H._tallyOut);
        el.style.opacity = on ? '1' : '0';
        if (!on) return;
        const s0 = fmt(v);
        if (el._s !== s0) { el._s = s0; el.innerHTML = s0; }
        // after the last figure present in the first row (or the array's right edge once a row is full)
        const n = Math.max(1, Math.ceil(A.spans.filter((q) => lt >= q.enter && lt < q.leave).length));
        const rowN = Math.min(n, A.cols);
        const x = A.x + rowN * A.px + 14;
        const y = A.dir === 'up' ? A.y - A.hh / 2 : A.y + A.hh / 2;
        const pos = `${f2(x)}|${f2(y)}`;
        if (el._p !== pos) { el._p = pos; el.style.left = f2(x) + 'px'; el.style.top = f2(y) + 'px'; }
      });
    }
    return H;
  }

  /** array(x, y, o): the counted array — n identical figures in rows from (x, y) (top left), stamped in one by one in
   *  counting order, left to right, row by row. Each figure is one unit of the key; a fraction is the last figure cut
   *  straight down (n: 7.4 → seven figures and 0.4 of one), never a smaller figure. o: { glyph ('man'; any of PV.glyphs),
   *  n, color ('ink'), groups ([{ n, color, glyph }] in place of n: one array split into coloured groups, e.g. survey
   *  shares "3 in 10" as [{ n: 3, color: 'red' }, { n: 7, color: 'muted' }]). SIZE: leave h out — the kit picks the
   *  largest figure that fits the space (10 figures ≈ 200 px tall, 100 ≈ 100 px) and balances the rows. x / y null:
   *  the block is centred in the content area (x 140–1780, y 190–880); or give area: { x, y, w, h } to centre it in a
   *  part of the frame (the half beside a close-up). like (another array's handle: the same figure size, for two blocks
   *  that are compared or trade figures), fixed + h (force a size), cols (figures per row), w / maxH (the space from
   *  x, y), key ('8000万人': draws "[figure] = 8000万人" under the block's bottom left — the one place for the key), cap
   *  (slots to reserve for figures that will move in), dir ('down' | 'up': rows stack upward from y, the baseline), order ('row' | 'col'), at, land (the time
   *  the LAST figure lands: put it on the spoken number), stagger (s between figures; default 0.16 for ≤ 12, faster for
   *  crowds), dur (spread all arrivals over this), tally (true: a running count after the latest figure; or (v) → html),
   *  unit (word after the tally, e.g. '百万人') }. Returns a handle with .recolor .move .dim .undim .hide .slot .box. Typical: P.array(null, null, { n: 26, key: '8000万人', land: P.cw(0, '26') }). */
  B.array = function (x, y, o = {}) {
    const n = Math.max(unitCount(o), o.cap || 0), r = glyphR(o);
    const ax = o.area ? o.area.x : x ?? CA.x0, ay = o.area ? o.area.y : y ?? CA.y0;
    const aw = o.area ? o.area.w : o.w ?? CA.x1 - ax, ah = (o.area ? o.area.h : o.maxH ?? CA.y1 - ay) - (o.key ? 84 : 0);
    let hh, cols = o.cols;
    if (o.like) hh = (o.like.A || o.like).hh;
    else if (o.fixed && o.h) hh = o.h;
    if (hh) { if (!cols) { const px = r * hh + Math.max(4, hh * 0.14); cols = Math.max(1, Math.floor((aw - (o.tally ? 160 : 0) + px - r * hh) / px)); } }
    else {
      const W = aw - (o.tally ? 160 : 0);
      let f = fitH(n, r, W, ah, o.cols, o.maxFig ?? 220);
      // a page's cols that leave the box half empty (a narrow 10-wide tower) give way to rows that fill the width
      if (o.cols && n >= 40) { const g = fitH(n, r, W, ah, 0, o.maxFig ?? 220); if (g.hh >= f.hh * 1.2) f = g; }
      hh = f.hh; cols = f.cols;
    }
    const px = r * hh + Math.max(4, hh * 0.14), rows = Math.max(1, Math.ceil(n / cols));
    const bw = Math.min(cols, n) * px - (px - r * hh), bh = rows * hh * 1.26 - hh * 0.26;
    const bx = x == null || o.area ? ax + (aw - (o.tally ? 160 : 0) - bw) / 2 : x;
    const by = y == null || o.area ? ay + (ah - bh) / 2 : y;
    const oo = Object.assign({}, o, { h: hh, cols });
    const A = fillArray(makeArray(this, Object.assign({}, oo, { x: bx, y: by })), oo);
    const H = arrayHandle(A, this, oo);
    H._key = keyUnder(this, Object.assign({ at: A.at }, o), bx, by + bh + 30);
    return H;
  };
  /** A.recolor(t, from, to, color, o): figures from..to-1 change colour one by one from t, in counting order (a share
   *  that turns, "now 4 in 10 own a car"). o: { stagger, dur (0.3) }. */
  /** A.move(t, k, target, o): the last k figures of this array walk across to the next free slots of the target array
   *  (another A, or the handle of a row or column), one after another, changing to the target's colour on the way — the
   *  signature move: country people walking into the city column as the years tick. Give the target `cap` so its slots
   *  exist. o: { stagger (s between walkers), dur (1.1 s per walk), color (null keeps their colour), lift (px of a low arc) }. */
  /** A.dim(t, o): every figure but o.except ([from, to]) fades to o.op (0.28): the group being spoken about stays bright.
   *  A.undim(t) brings them back. */

  /** rows(x, y, rows, o): the classic Isotype comparison — one labelled row of figures per country, year or group, all in
   *  one unit, labels in small capitals on the left, every row starting on one vertical line, each row counting in after
   *  the one before. rows: [{ label ('1900' or '城市\n二〇二〇年'), n, color, glyph, groups, at, land, value (text after the
   *  row, e.g. '4.2 亿'; or tally: true) }]. o: { glyph, color, labelW (240), w (width for figures), key ('2.5 亿人': the key under
   *  the rows), rowH (h × 1.42), x / y null (rows centred in the content area); leave h out: the figures are sized to
   *  the widest row and the height (up to 170 px), labels 32 px, values 40–64 px; at (first row; later rows follow 0.25 s after the one
   *  before unless they have their own at), tally (true: running counts on every row), unit }. Returns { rows: [A…], box }. */
  B.rows = function (x, y, rows, o = {}) {
    x = x ?? CA.x0;
    const lw = o.labelW ?? 240, fx = x + lw;
    const avail = o.w ?? (CA.x1 - 40 - fx - (o.tally || rows.some((r) => r.value || r.tally) ? 190 : 0));
    const maxN = Math.max(...rows.map((r) => Math.ceil(r.groups ? r.groups.reduce((a, g) => a + g.n, 0) : r.n || 0)), 1);
    const wMax = Math.max(...rows.map((r) => gw(r.glyph || o.glyph || 'man')));
    const areaH = (o.maxH ?? CA.y1 - (y ?? CA.y0)) - (o.key ? 84 : 0);
    // one figure size for every row: as big as the widest row and the height allow (≤ 170 px)
    // a long row may break into 2–3 lines when that lets every figure be clearly bigger (few rows, much height)
    const sizeFor = (L) => {
      const across = Math.ceil(maxN / L);
      let hh0 = Math.min(170, areaH / (rows.length * (L * 1.26 + 0.2) - 0.46));
      while (hh0 > 22 && across * (wMax * hh0 / 100 + Math.max(4, hh0 * 0.14)) > avail + Math.max(4, hh0 * 0.14)) hh0 -= 2;
      return { hh: hh0, across };
    };
    let best = { hh: 0 }, lines = 1;
    if (o.fixed && o.h) best = { hh: o.h, across: 1000 };
    else for (const L of [1, 2, 3]) { const c = sizeFor(L); if (L === 1 || c.hh > best.hh * 1.3) { if (c.hh > best.hh) { best = c; lines = L; } } }
    const hh = Math.floor(best.hh), across = lines > 1 ? best.across : 1000;
    const rowH = o.rowH ?? Math.max(hh * (lines * 1.26 + 0.16), Math.min(hh * (lines * 1.26 + 0.84), (areaH + hh * 0.42) / rows.length));
    const totalH = rows.length * rowH - (rowH - hh * (lines * 1.26 - 0.26));
    if (y == null) y = CA.y0 + (areaH - totalH) / 2;
    let t = o.at ?? 0;
    const list = [];
    rows.forEach((r, i) => {
      const yy = y + i * rowH;
      const ro = { glyph: r.glyph || o.glyph, color: r.color || o.color, n: r.n, groups: r.groups, h: hh, w: avail, cols: across, at: r.at ?? t, land: r.land, stagger: r.stagger ?? o.stagger, tally: r.tally ?? o.tally, unit: r.unit ?? o.unit, cap: r.cap };
      if (r.land != null) delete ro.at;
      const A = fillArray(makeArray(this, Object.assign({}, ro, { x: fx, y: yy })), ro);
      const H = arrayHandle(A, this, ro);
      if (r.label != null) H._label = capEl(this, 'r', r.label, x + lw - 30, yy + hh / 2, Math.max(30, o.size ?? 32), r.labelColor || 'ink', Math.max(0, A.at - 0.15));
      if (r.value != null) {
        const n = A.members.length, last = slotOf(A, Math.max(0, n - 1));
        const el = h('div', 'tx is-num', null, this.html);
        el.innerHTML = r.value;
        Object.assign(el.style, { left: f2(last.x + A.px + 14) + 'px', top: f2(last.y + hh / 2) + 'px', fontSize: Math.round(clamp(hh * 0.5, 40, 64)) + 'px', opacity: '0' });
        const te = A.end;
        this.act({ at: te, dur: 0.3, g: el, kind: 'text', pen: false, apply: (k, lt, vis) => { el.style.opacity = f2((lt >= te ? out(k) : 0) * vis); } });
      }
      t = A.end + 0.25;
      list.push(H);
    });
    const kk = keyUnder(this, Object.assign({ at: o.at ?? 0.2, glyph: o.glyph || rows[0].glyph }, o), fx, y + totalH + 34);
    return { rows: list, key: kk, box: () => ({ x, y, w: lw + avail, h: totalH }) };
  };

  /** columns(x, y, cols, o): figures stacked in blocks of `per` on one baseline at y, side by side — the two-column (or
   *  few-column) comparison: town and country, then and now, men and women. Each block fills from the bottom row up,
   *  left to right; its label sits under the baseline in small capitals. cols: [{ label, n, color, glyph, groups, at,
   *  land, cap (slots kept free for figures that will walk in) }]. o: { per (5 figures a row), gap (110 px between
   *  blocks), x null (centred in w), y null (baseline at 800, or 740 with a key), w (width the blocks may take, from x),
   *  key ('1000万人': under the labels, bottom left); leave h out: the figures are sized to fill from the baseline up to
   *  y 200 (≤ 200 px), labels 34 px, counts 44–72 px; glyph, color, at, tally (a count above each block), unit, rule (true: the black baseline) }.
   *  Returns { cols: [A…], box }. A column's handle is a target for A.move. */
  B.columns = function (x, y, cols, o = {}) {
    const per = o.per ?? 5, gapB = o.gap ?? 110;
    if (y == null) y = o.key ? CA.y1 - 140 : CA.y1 - 80;
    const W = o.w ?? (x == null ? CA.x1 - CA.x0 : CA.x1 - x);
    const r = Math.max(...cols.map((c) => gw(c.glyph || o.glyph || 'man'))) / 100;
    const maxRows = Math.max(...cols.map((c) => Math.ceil(Math.max(unitCount(c), c.cap || 0) / per)), 1);
    const availH = y - (CA.y0 + 10) - (o.tally ? 64 : 0);
    let hh = o.fixed && o.h ? o.h : Math.min(200, availH / (maxRows * 1.26 - 0.26));
    if (!(o.fixed && o.h)) while (hh > 22 && cols.length * (per * (r * hh + Math.max(4, hh * 0.14)) - Math.max(4, hh * 0.14)) + (cols.length - 1) * gapB > W) hh -= 2;
    hh = Math.floor(hh);
    const wMax = r * hh;
    const pxx = wMax + Math.max(4, hh * 0.14), totalW = cols.length * (per * pxx - (pxx - wMax)) + (cols.length - 1) * gapB;
    if (x == null) x = CA.x0 + (W - totalW) / 2;
    let cx = x, t = o.at ?? 0;
    const outA = [];
    const px = wMax + Math.max(4, hh * 0.14);
    const blockW = per * px - (px - wMax);
    if (o.rule !== false) {
      const W = cols.length * blockW + (cols.length - 1) * gapB;
      const r = h('div', 'is-rule', null, this.html);
      Object.assign(r.style, { left: f2(x - 20) + 'px', top: f2(y + 8) + 'px', width: f2(W + 40) + 'px', height: '4px' });
      const at0 = t;
      this.act({ at: at0, dur: 0.5, g: r, kind: 'show', pen: false, apply: (k, lt, vis) => { r.style.transform = `scaleX(${(lt >= at0 ? out(k) : 0).toFixed(4)})`; r.style.opacity = f2(vis); } });
    }
    cols.forEach((c) => {
      const co = { glyph: c.glyph || o.glyph, color: c.color || o.color, n: c.n, groups: c.groups, h: hh, cols: per, dir: 'up', at: c.at ?? t, land: c.land, stagger: c.stagger ?? o.stagger, cap: c.cap, gap: px - wMax, tally: c.tally ?? false };
      if (c.land != null) delete co.at;
      const A = fillArray(makeArray(this, Object.assign({}, co, { x: cx, y })), co);
      const H = arrayHandle(A, this, co);
      if (c.label != null) H._label = capEl(this, 'c', c.label, cx + blockW / 2, y + 24, Math.max(30, o.size ?? 34), c.labelColor || 'ink', Math.max(0, (c.at ?? t) - 0.2));
      if (o.tally || c.tally) {
        const el = h('div', 'tx is-num', null, this.html);
        el.style.fontSize = (o.tallySize ?? Math.round(clamp(hh * 0.45, 44, 72))) + 'px';
        el.style.color = hex(c.color || o.color || 'ink');
        el.style.transform = 'translate(-50%, -100%)';
        el.dataset.isoSkip = '1';
        const unit = c.unit ?? o.unit, bx = cx;
        A.m.renders.push((lt) => {
          const v = tallyAt(A, lt), on = lt >= A.at && v > 0;
          el.style.opacity = on ? '1' : '0';
          if (!on) return;
          const s0 = fmtN(v) + (unit ? `<span class="u">${unit}</span>` : '');
          if (el._s !== s0) { el._s = s0; el.innerHTML = s0; }
          const n = A.spans.filter((q) => lt >= q.enter && lt < q.leave).length;
          const rowsN = Math.max(1, Math.ceil(n / per));
          const top = y - hh - (rowsN - 1) * A.py - 18;
          const pos = f2(top);
          if (el._p !== pos) { el._p = pos; el.style.left = f2(bx + blockW / 2) + 'px'; el.style.top = pos + 'px'; }
        });
      }
      if (o.tally || c.tally) { const rowsMax = Math.ceil(Math.max(A.members.length, c.cap || 0) / per); A.m.extra.push([cx, y - hh - (rowsMax - 1) * A.py - 80, cx + blockW, y]); }
      outA.push(H);
      t = A.end + 0.3;
      cx += blockW + gapB;
    });
    const kk = keyUnder(this, Object.assign({ at: o.at ?? 0.2, glyph: o.glyph || cols[0].glyph }, o), x, y + 96);
    return { cols: outA, key: kk, box: () => ({ x, y: y - 600, w: cx - gapB - x, h: 600 }), blockW };
  };

  /** regions(x, y, w, height, cells, o): a map made of blocks — the Isotype way of drawing countries, provinces or districts
   *  as flat tinted rectangles on a coarse grid, each holding its own counted figures. Geography only as arrangement:
   *  north up, neighbours touching, no coastlines. cells: [{ c, r, w (1), h (1), name, n, glyph, color, tint ('faintF'
   *  or a *F tint), at, land }] on a grid of o.cols × o.rows. o: { cols (6), rows (4), gap (10 px between tiles), h (max
   *  figure height, 54; figures shrink to fit their tile, one size for the whole map), glyph, color, at (tiles appear
   *  together at at; figures count in tile by tile after), key (amount: drawn under the map's bottom left; leave 84 px) }. Returns { cells: [A…] }: each cell's handle can recolor,
   *  dim or be a move target. */
  B.regions = function (x, y, w, height, cells, o = {}) {
    const cols = o.cols ?? 6, rows = o.rows ?? 4, gap = o.gap ?? 10, at = o.at ?? 0;
    const cw = (w - (cols - 1) * gap) / cols, ch = (height - (rows - 1) * gap) / rows;
    const m = M(this);
    const tileG = s('g', {}, this.svg);
    // one figure size for the whole map: the largest that lets every tile hold its count
    let fh = o.h ?? 96;
    const fits = (c, fh0) => {
      const tw = (c.w || 1) * cw + ((c.w || 1) - 1) * gap - 36, th = (c.h || 1) * ch + ((c.h || 1) - 1) * gap - 80;
      const g = gw(c.glyph || o.glyph || 'man') * fh0 / 100, pxx = g + Math.max(4, fh0 * 0.14), pyy = fh0 + fh0 * 0.22;
      const nc = Math.max(1, Math.floor((tw + pxx - g) / pxx)), nr = Math.max(0, Math.floor((th + pyy - fh0) / pyy));
      return nc * nr >= Math.ceil(Math.max(c.n || 0, c.cap || 0));
    };
    while (fh > 18 && !cells.every((c) => fits(c, fh))) fh -= 2;
    const outA = [];
    let t = at + 0.4;
    cells.forEach((c, i) => {
      const tx = x + c.c * (cw + gap), ty = y + c.r * (ch + gap);
      const tw = (c.w || 1) * cw + ((c.w || 1) - 1) * gap, th = (c.h || 1) * ch + ((c.h || 1) - 1) * gap;
      const rect = s('rect', { x: f2(tx), y: f2(ty), width: f2(tw), height: f2(th), fill: hex(c.tint || 'faintF') }, tileG);
      const ta = at + i * 0.04;
      this.act({ at: ta, dur: 0.4, g: rect, kind: 'show', pen: false, apply: (k, lt, vis) => { rect.setAttribute('opacity', f2((lt >= ta ? out(k) : 0) * vis)); } });
      if (c.name) capEl(this, '', c.name, tx + 18, ty + 14, Math.max(30, o.size ?? 30), c.nameColor || 'soft', ta + 0.1);
      const co = { glyph: c.glyph || o.glyph, color: c.color || o.color, n: c.n, groups: c.groups, h: fh, w: tw - 36, at: c.at ?? t, land: c.land, cap: c.cap, stagger: c.stagger ?? o.stagger };
      if (c.land != null) delete co.at;
      const A = fillArray(makeArray(this, Object.assign({}, co, { x: tx + 18, y: ty + 62 })), co);
      outA.push(arrayHandle(A, this, co));
      if (c.at == null && c.land == null) t = A.end + 0.1;
    });
    const kk = keyUnder(this, Object.assign({ at, glyph: o.glyph || cells[0].glyph }, o), x, y + height + 26);
    return { cells: outA, key: kk, figH: fh };
  };

  /** key(x, y, items, o): the key that makes every figure a unit — "[figure] = 1 million people". Always on the page
   *  that first shows a unit, in the free space under or beside the chart (never in a corner by itself). items:
   *  [{ glyph, color, text }] in one row (one item is usual; two or three when groups mean different things). o: { at,
   *  h (figure height, 60) }. Prefer the `key` option of array / rows / columns / regions, which puts it in its one place. The text is
   *  the amount only ('8000万人', '10 million people'), worded the same on every page. */
  B.key = function (x, y, items, o = {}) {
    const fh = o.h ?? 60, at = o.at ?? 0;
    const el = h('div', 'is-key', null, this.html);
    Object.assign(el.style, { left: f2(x) + 'px', top: f2(y) + 'px', opacity: '0' });
    for (const it of items) {
      const name = G[it.glyph] ? it.glyph : 'man', g = G[name];
      const row = h('div', 'it', null, el);
      const sv = s('svg', { width: f2(g.w * fh / 100), height: fh, viewBox: `0 0 ${g.w} 100` }, row);
      const m = M(this);
      const mk = maskFor(m, name);
      s('path', Object.assign({ d: g.s.join(''), fill: hex(it.color || 'ink') }, mk ? { mask: mk } : {}), s('g', {}, sv));
      h('span', 'eq', '=', row);
      const t = h('span', 't' + (cjk(it.text) ? ' zh' : ''), null, row); t.textContent = it.text;
    }
    const a = this.act({ at, dur: 0.4, g: el, kind: 'text', pen: false, apply: (k, lt, vis) => { el.style.opacity = f2((lt >= at ? out(k) : 0) * vis); el.style.transform = `translateY(${f2((1 - out(k)) * 8)}px)`; } });
    return this.handle(a, el);
  };

  /** year(x, y, o): the year ticker — a large year in the geometric sans, centred on x with its top at y, and under it
   *  a thin time strip with decade ticks and a black pointer that slides as the years turn. Drive it with keys: [[t, year],
   *  …]; between keys the year counts through every value (eased), so figures that move between groups move WITH the
   *  years. o: { keys, from / to (the strip's range; default the keys' range), step (tick spacing, 10), w (strip width,
   *  560), size (numeral, 128), at, strip (false: the numeral alone), color ('ink') }. Returns a handle with .yearAt(lt). */
  B.year = function (x, y, o = {}) {
    const keys = (o.keys || [[0, o.from ?? 1900]]).slice().sort((a, b) => a[0] - b[0]);
    const from = o.from ?? keys[0][1], to = o.to ?? keys[keys.length - 1][1];
    const size = o.size ?? 128, w = o.w ?? 560, step = o.step ?? 10, at = o.at ?? keys[0][0];
    const yearAt = (lt) => {
      if (lt <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) if (lt < keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], io((lt - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])));
      return keys[keys.length - 1][1];
    };
    const el = h('div', 'tx is-year', null, this.html);
    Object.assign(el.style, { left: f2(x) + 'px', top: f2(y) + 'px', fontSize: size + 'px', color: hex(o.color || 'ink'), opacity: '0' });
    el.textContent = String(Math.round(keys[keys.length - 1][1]));
    const sy = y + size * 0.86 + 34;
    let strip = null, ptr = null;
    if (o.strip !== false) {
      strip = s('g', { opacity: 0 }, this.svg);
      s('rect', { x: f2(x - w / 2), y: f2(sy), width: f2(w), height: 3, fill: hex('ink') }, strip);
      const first = Math.ceil(from / step) * step;
      for (let v = first; v <= to + 1e-6; v += step) {
        const tx = x - w / 2 + ((v - from) / ((to - from) || 1)) * w, major = v % (step * 5) === 0 || v === first || v + step > to;
        s('rect', { x: f2(tx - 1.5), y: f2(sy - (major ? 14 : 8)), width: 3, height: major ? 14 : 8, fill: hex('ink') }, strip);
      }
      ptr = s('path', { d: 'M-13 0L13 0L0 -18Z', fill: hex(o.pointer || 'red'), transform: `translate(${f2(x - w / 2 + clamp((keys[0][1] - from) / ((to - from) || 1)) * w)} ${f2(sy + 3)}) rotate(180) translate(0 18)` }, strip);
      const lab = (v, tx, al) => { const t = s('text', { x: f2(tx), y: f2(sy + 40), 'text-anchor': al, fill: hex('soft'), style: 'font: 500 30px "Jost Variable", sans-serif; letter-spacing: 0.06em' }, strip); t.textContent = String(v); };
      lab(from, x - w / 2, 'start'); lab(to, x + w / 2, 'end');
    }
    const a = this.act({ at, dur: 0.4, g: el, kind: 'text', pen: false, apply: () => {} });
    M(this).renders.push((lt) => {
      const vis = a.out == null ? 1 : 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt);
      const k = lt >= at ? out((lt - at) / 0.4) : 0;
      el.style.opacity = f2(k * vis);
      const yv = yearAt(lt), sv = String(Math.round(yv));
      if (el._s !== sv) { el._s = sv; el.textContent = sv; }
      if (strip) {
        strip.setAttribute('opacity', f2(k * vis));
        const px = x - w / 2 + clamp((yv - from) / ((to - from) || 1)) * w;
        ptr.setAttribute('transform', `translate(${f2(px)} ${f2(sy + 3)}) rotate(180) translate(0 18)`);
      }
    });
    const hd = this.handle(a, el);
    hd.yearAt = yearAt;
    return hd;
  };

  /** flow(x1, y1, x2, y2, o): a flat block arrow (a solid shaft and a wide triangular head, no outline) that grows from
   *  its tail — "goes to", "becomes", exports from one region to another, people leaving. Straight only. o: { color
   *  ('ink'; or the colour of what flows), w (shaft thickness, 26), at, dur (0.6), label (caps text set along the shaft
   *  in paper colour, short) }. */
  B.flow = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.6, t = o.w ?? 42;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const g = s('g', { transform: `translate(${f2(x1)} ${f2(y1)}) rotate(${f2(ang)})`, visibility: 'hidden' }, this.svg);
    const p = s('path', { fill: hex(o.color || 'ink') }, g);
    { const hw0 = t * 1.15; M(this).extra.push([Math.min(x1, x2) - hw0, Math.min(y1, y2) - hw0, Math.max(x1, x2) + hw0, Math.max(y1, y2) + hw0]); }
    const head = Math.min(L * 0.45, t * 1.9), hw = t * 1.15;
    let lab = null;
    if (o.label) {
      lab = s('text', { x: f2((L - head) / 2), y: f2(t * 0.34), 'text-anchor': 'middle', fill: hex('paper'), style: `font: 500 ${Math.round(Math.max(30, t * 0.78))}px "Jost Variable", "Noto Sans SC Variable", sans-serif; letter-spacing: 0.12em; text-transform: uppercase` }, g);
      lab.textContent = String(o.label).toUpperCase();
      if (Math.abs(ang) > 90) lab.setAttribute('transform', `rotate(180 ${f2((L - head) / 2)} 0)`);
    }
    const a = this.act({ at, dur, g, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const e = lt >= at ? out(k) : 0;
      g.setAttribute('visibility', e > 0.002 ? 'visible' : 'hidden');
      g.setAttribute('opacity', f2(vis));
      const l = Math.max(head + 1, L * e), sh = l - head;
      p.setAttribute('d', `M0 ${f2(-t / 2)}H${f2(sh)}V${f2(-hw)}L${f2(l)} 0L${f2(sh)} ${f2(hw)}V${f2(t / 2)}H0Z`);
      if (lab) lab.setAttribute('opacity', f2(clamp((k - 0.6) / 0.4)));
    } });
    return this.handle(a, g);
  };

  // ── square, flat boxes if a page reaches for P.box
  const box0 = B.box;
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 0, texture: false }, o)); };

  // ── the page title: small capitals in the geometric sans, an optional lighter line under it (the chart's unit or
  //    question), and a black rule that runs out across the grid, like the head of an Isotype plate
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1;
    const wrap = h('div', 'tx is-tt' + (cjk(str) ? ' zh' : ''), null, T.html);
    const t = h('span', 't', null, wrap); t.textContent = str;
    if (o.kick) { const k = h('span', 'k', null, wrap); k.textContent = o.kick; }
    const rule = h('div', 'is-rule', null, T.html);
    Object.assign(rule.style, { left: STAGE.title.x + 'px', top: STAGE.title.y + (o.kick ? 90 : 50) + 'px', width: STAGE.w - 2 * STAGE.title.x + 'px', height: '3px' });
    const a = T.act({ at, dur: 0.7, g: wrap, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const on = lt >= at ? 1 : 0;
      wrap.style.opacity = f2(on * clamp(k * 2.5) * vis);
      wrap.style.transform = `translateY(${f2((1 - out(k)) * 10)}px)`;
      rule.style.transform = `scaleX(${(on * out(k)).toFixed(4)})`;
      rule.style.opacity = f2(vis);
    } });
    return Object.assign(T.handle(a, wrap), { spans: [t], box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 16, w: wrap.offsetWidth, h: 46 }) });
  };
})();
