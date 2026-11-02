/* Transit Map · kit: a metro diagram in the Harry Beck tradition. Lines are routed on a 60 px grid with only 0° / 45° /
 * 90° runs and rounded bends (the page names grid points, never path geometry); a train draws each line as it runs and
 * arrives at every station on its spoken word; stations tick, label themselves clear of every line and other label,
 * and turn into white interchange rings by themselves where two lines share a stop. Badges, a legend box, a river,
 * fare-zone fields, callout notes, a "you are here" pin, big numbers and a train that rides a finished line.
 * Everything is a pure function of page-local time lt: all timing and geometry are computed at build, label placement
 * once on the first frame (time-independent). Original code; no third-party source. */
(function () {
  const { col, clamp, lerp, ease, Builder, h, s } = PV;
  const B = Builder.prototype;
  const f2 = (n) => (+n).toFixed(2);
  const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const back = (x) => { const c1 = 1.7, c3 = c1 + 1, k = clamp(x) - 1; return 1 + c3 * k * k * k + c1 * k * k; };
  const io = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const cjk = (str) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(str || '');
  const zh = () => (window.SCRIPT?.META?.lang === 'zh') || cjk(window.SCRIPT?.META?.title);

  // ── the grid: 27 columns × 12 rows of 60 px inside the content area
  const A = STAGE.area, U = 60, X0 = A.x0 + 30, Y0 = A.y0 + 20, CMAX = Math.floor((A.x1 - A.x0 - 80) / U), RMAX = Math.floor((A.y1 - A.y0 - 40) / U);
  const snap = (v, max) => clamp(Math.round((+v || 0) * 2) / 2, 0, max);
  /** PV.mx(c): x in px of grid column c (0–26, halves allowed; 0 = 170, 26 = 1730). */
  PV.mx = (c) => X0 + snap(c, CMAX) * U;
  /** PV.my(r): y in px of grid row r (0–11, halves allowed; 0 = 200, 11 = 860). */
  PV.my = (r) => Y0 + snap(r, RMAX) * U;
  const BOUND = { x0: A.x0 + 6, y0: A.y0 - 6, x1: A.x1 - 6, y1: A.y1 + 12 };

  // ── colours: palette names, plus a few extra line colours a network needs
  const EXTRA = { brown: '#8E5B2E', pink: '#E2609B', teal: '#00A0A4', lime: '#7DB51C', navy: '#233C8F', grey: '#8C9196' };
  const AUTO = ['red', 'blue', 'green', 'orange', 'purple', 'teal', 'pink', 'brown', 'navy'];
  const lc = (c) => EXTRA[c] || col(c) || c;
  const rgb = (c) => { c = lc(c); if (!/^#[0-9a-f]{6}$/i.test(c)) return [27, 30, 35]; return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * clamp(k))).join(',')})`; };
  const light = (c) => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b > 175; };
  // every component renders in a per-frame tick (lines dim, pins pulse, trains fade long after they were drawn); the act
  // only carries the timing and .hide() for the handle
  const visOf = (a, lt) => (a.out == null ? 1 : 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt));
  const anim = (P, at, dur, g, fn) => { const a = P.act({ at, dur, g, kind: 'show', pen: false, apply: () => {} }); P.tick((lt) => fn(clamp((lt - at) / dur), lt, visOf(a, lt))); return a; };
  const INK = '#1B1E23', PAPER = '#F7F6F1', FAINT = '#D7D8D3';

  // ── per-page state: layers, the station registry, obstacles for label placement
  function M(P) {
    if (P.sh.metro) return P.sh.metro;
    const host = P.host;
    const mk = (cls) => s('svg', { class: 'mt-svg ' + cls, width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` });
    // the whole network lives in one root that the kit frames to fill the content area; the legend sits outside it
    const root = h('div', 'mt-root', null, null);
    host.insertBefore(root, host.firstChild);
    const under = mk('mt-under'), lines = mk('mt-lines'), marks = mk('mt-marks'), top = mk('mt-top'), trains = mk('mt-trains');
    for (const el of [under, lines, marks, top, trains]) root.appendChild(el);
    const labels = h('div', 'txt mt-labels', null, root);
    const over = h('div', 'txt mt-over', null, host);
    const m = { P, root, under, lines, marks, top, trains, labels, over, routes: [], stations: new Map(), items: [], boxes: [], zones: [], legend: null, placed: false, fit: { s: 1, tx: 0, ty: 0 } };
    P.sh.metro = m;
    P.tick((lt) => { if (!m.placed) layout(m); for (const st of m.stations.values()) renderStation(m, st, lt); for (const it of m.items) it.render && it.render(lt); });
    return m;
  }

  // ── geometry: octilinear routing between grid points, rounded bends, sampled for position along the line
  const pt = (p) => {
    if (Array.isArray(p)) return { c: snap(p[0], CMAX), r: snap(p[1], RMAX), name: typeof p[2] === 'string' ? p[2] : '', at: typeof p[2] === 'number' ? p[2] : p[3], opts: (p.find((v) => v && typeof v === 'object')) || {} };
    return { c: snap(p.c ?? p.x, CMAX), r: snap(p.r ?? p.y, RMAX), name: p.name || '', at: p.at, opts: p };
  };
  /** the vertices from a to b along 0/45/90° runs: 'straight' first (default) or 'diag' first */
  function octi(a, b, mode) {
    const dx = b.c - a.c, dy = b.r - a.r, ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [];
    const d = Math.min(ax, ay), sx = Math.sign(dx), sy = Math.sign(dy);
    if (mode === 'diag') return [{ c: a.c + sx * d, r: a.r + sy * d }];
    return [ax > ay ? { c: b.c - sx * d, r: a.r } : { c: a.c, r: b.r - sy * d }];
  }
  function buildGeom(points, o) {
    // grid points → px vertices (keeping which vertex is which input point)
    const V = [], idx = [];
    points.forEach((p, i) => {
      if (i > 0) {
        let mode = p.opts.via || o.bend;
        // no order asked for: the one that turns least after the run that came in (no hooks on short hops)
        if (!mode && V.length > 1) {
          const a = V[V.length - 2], b = V[V.length - 1], inc = Math.atan2(b.y - a.y, b.x - a.x);
          const turn = (ms) => { let dir = inc, sum = 0, cur = { x: b.x, y: b.y }; for (const q of ms.concat([{ c: p.c, r: p.r }])) { const v = { x: X0 + q.c * U, y: Y0 + q.r * U }, d2 = Math.atan2(v.y - cur.y, v.x - cur.x); let dd = Math.abs(d2 - dir) % (2 * Math.PI); if (dd > Math.PI) dd = 2 * Math.PI - dd; sum += dd; dir = d2; cur = v; } return sum; };
          mode = turn(octi(points[i - 1], p, 'diag')) < turn(octi(points[i - 1], p, 'straight')) - 0.01 ? 'diag' : 'straight';
        }
        for (const m of octi(points[i - 1], p, mode)) V.push({ x: X0 + m.c * U, y: Y0 + m.r * U });
      }
      const v = { x: X0 + p.c * U, y: Y0 + p.r * U };
      const last = V[V.length - 1];
      if (last && Math.hypot(last.x - v.x, last.y - v.y) < 0.5) { idx.push(V.length - 1); return; }
      idx.push(V.length); V.push(v);
    });
    // sideways offset (a line running beside another): mitred
    const off = clamp(+o.offset || 0, -60, 60);
    if (off && V.length > 1) {
      const dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
      const W = V.map((v, i) => {
        const d1 = i > 0 ? dir(V[i - 1], v) : dir(v, V[i + 1]), d2 = i < V.length - 1 ? dir(v, V[i + 1]) : d1;
        const n1 = { x: -d1.y, y: d1.x }, n2 = { x: -d2.y, y: d2.x }, m = { x: n1.x + n2.x, y: n1.y + n2.y };
        const ml = Math.hypot(m.x, m.y) || 1, mm = { x: m.x / ml, y: m.y / ml }, k = off / Math.max(0.35, mm.x * n1.x + mm.y * n1.y);
        return { x: v.x + mm.x * k, y: v.y + mm.y * k };
      });
      V.splice(0, V.length, ...W);
    }
    // rounded bends (quadratic through the corner), sampled
    const R = clamp(o.radius ?? 46, 10, 140);
    const S = [{ x: V[0].x, y: V[0].y }], vL = [0];
    const segLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const cuts = V.map((v, i) => {
      if (i === 0 || i === V.length - 1) return 0;
      const a = V[i - 1], b = V[i + 1], l1 = segLen(a, v), l2 = segLen(v, b);
      if (l1 < 0.5 || l2 < 0.5) return 0;
      const u1 = { x: (v.x - a.x) / l1, y: (v.y - a.y) / l1 }, u2 = { x: (b.x - v.x) / l2, y: (b.y - v.y) / l2 };
      const th = Math.acos(clamp(u1.x * u2.x + u1.y * u2.y, -1, 1));
      if (th < 0.02 || th > 2.6) return 0;
      return Math.min(R * Math.tan(th / 2), l1 * 0.48, l2 * 0.48);
    });
    let L = 0;
    const push = (p) => { const q = S[S.length - 1]; L += segLen(q, p); S.push(p); };
    let d = `M${f2(V[0].x)} ${f2(V[0].y)}`;
    for (let i = 1; i < V.length; i++) {
      const v = V[i], a = V[i - 1], l = segLen(a, v) || 1, u = { x: (v.x - a.x) / l, y: (v.y - a.y) / l };
      const c = cuts[i];
      if (!c) { push({ x: v.x, y: v.y }); d += ` L${f2(v.x)} ${f2(v.y)}`; vL[i] = L; continue; }
      const b = V[i + 1], l2 = segLen(v, b), u2 = { x: (b.x - v.x) / l2, y: (b.y - v.y) / l2 };
      const p1 = { x: v.x - u.x * c, y: v.y - u.y * c }, p2 = { x: v.x + u2.x * c, y: v.y + u2.y * c };
      push(p1); d += ` L${f2(p1.x)} ${f2(p1.y)} Q${f2(v.x)} ${f2(v.y)} ${f2(p2.x)} ${f2(p2.y)}`;
      for (let k = 1; k <= 10; k++) {
        const t = k / 10, q = 1 - t;
        push({ x: q * q * p1.x + 2 * q * t * v.x + t * t * p2.x, y: q * q * p1.y + 2 * q * t * v.y + t * t * p2.y });
        if (k === 5) vL[i] = L;
      }
    }
    const cum = [0];
    for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + segLen(S[i - 1], S[i]));
    const total = cum[cum.length - 1] || 1;
    const at = (len) => {
      len = clamp(len, 0, total);
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= len) lo = m; else hi = m; }
      const a = S[lo], b = S[hi], k = (len - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), tx: (b.x - a.x) / tl, ty: (b.y - a.y) / tl };
    };
    return { d, S, total, at, V, ptL: idx.map((i) => vL[i] ?? 0) };
  }

  // ── timing: the tip dwells at a station, then runs (ease in-out) to arrive at the next timed one exactly on time
  function buildClock(G, points, o) {
    const speed = clamp(o.speed ?? 700, 200, 3000);
    const T0 = o.at ?? points[0].at ?? 0;
    const A = [{ L: 0, t: T0 }];
    points.forEach((p, i) => {
      if (i === 0 || p.at == null) return;
      const Lp = G.ptL[i], prev = A[A.length - 1];
      if (Lp <= prev.L + 1) return;
      A.push({ L: Lp, t: Math.max(p.at, prev.t + Math.max(0.12, (Lp - prev.L) / 4000)) });
    });
    const last = A[A.length - 1];
    if (G.total > last.L + 1) A.push({ L: G.total, t: last.t + Math.max(0.35, (G.total - last.L) / speed) });
    for (let j = 1; j < A.length; j++) A[j].tau = Math.min(A[j].t - A[j - 1].t, Math.max(0.35, (A[j].L - A[j - 1].L) / speed));
    const L = (lt) => {
      if (lt <= A[0].t) return 0;
      for (let j = 1; j < A.length; j++) {
        if (lt < A[j].t) { const dep = A[j].t - A[j].tau; return lt < dep ? A[j - 1].L : lerp(A[j - 1].L, A[j].L, io((lt - dep) / A[j].tau)); }
      }
      return G.total;
    };
    const tOf = (len) => {
      if (len <= 0.5) return A[0].t;
      for (let j = 1; j < A.length; j++) {
        if (len <= A[j].L + 0.5) {
          const f = clamp((len - A[j - 1].L) / ((A[j].L - A[j - 1].L) || 1));
          let lo = 0, hi = 1;
          for (let n = 0; n < 30; n++) { const m = (lo + hi) / 2; if (io(m) < f) lo = m; else hi = m; }
          return A[j].t - A[j].tau + hi * A[j].tau;
        }
      }
      return A[A.length - 1].t;
    };
    return { L, tOf, start: T0, end: A[A.length - 1].t };
  }

  // ── stations: one registry entry per grid point, shared by every line that stops there
  function addStation(m, key, x, y, info) {
    let st = m.stations.get(key);
    if (!st) {
      st = { key, members: [], name: '', sub: '', side: null, size: 32, x, y, forced: false, gx: info.gx, gy: info.gy };
      m.stations.set(key, st);
    }
    if (info.name && !st.name) { st.name = info.name; st.sub = info.sub || ''; }
    if (info.side && !st.side) st.side = info.side;
    if (info.size) st.size = clamp(info.size, 26, 40);
    if (info.x) st.forced = true;
    st.members.push(info.member);
    return st;
  }
  const isX = (st) => st.forced || new Set(st.members.filter((mm) => mm.route).map((mm) => mm.route)).size > 1;
  const tFirst = (st) => Math.min(...st.members.map((mm) => mm.t));

  function buildStationEls(m, st) {
    if (st.built) return;
    st.built = true;
    st.g = s('g', null, m.marks);
    st.ticks = st.members.map((mm) => (mm.route ? s('line', { stroke: lc(mm.route.color), 'stroke-width': f2(mm.route.sw * 0.62), 'stroke-linecap': 'butt' }, st.g) : null));
    st.pulses = st.members.map(() => s('circle', { fill: 'none', stroke: INK, 'stroke-width': 4, r: 1, visibility: 'hidden' }, st.g));
    st.ringOut = s('path', { fill: 'none', stroke: INK, 'stroke-linecap': 'round', visibility: 'hidden' }, m.top);
    st.ringIn = s('path', { fill: 'none', stroke: '#FFFFFF', 'stroke-linecap': 'round', visibility: 'hidden' }, m.top);
    if (st.name) {
      st.el = h('div', 'tx mt-lab', null, m.labels);
      st.el.innerHTML = '';
      const t = h('span', 't', null, st.el); t.textContent = st.name;
      if (st.sub) { const sb = h('span', 's', null, st.el); sb.textContent = st.sub; }
      st.el.style.fontSize = st.size + 'px';
      st.el.style.opacity = '0';
    }
  }

  // ── label placement: every label tries the sides of its station and takes the first spot clear of all lines,
  //    rings, badges, boxes and earlier labels (once, on the first frame, when fonts are in)
  const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
  const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  function boxAt(p, dir, w, hh, g) {
    const [dx, dy] = DIRS[dir], gg = dx && dy ? g * 0.72 : g;
    const x0 = dx > 0 ? p.x + gg : dx < 0 ? p.x - gg - w : p.x - w / 2;
    const y0 = dy > 0 ? p.y + gg : dy < 0 ? p.y - gg - hh : p.y - hh / 2;
    return { x0, y0, x1: x0 + w, y1: y0 + hh };
  }
  function order(pref, tx, ty) {
    const all = Object.keys(DIRS);
    let base;
    if (Math.abs(ty) < 0.3) base = ['n', 's', 'ne', 'se', 'nw', 'sw', 'e', 'w'];
    else if (Math.abs(tx) < 0.3) base = ['e', 'w', 'ne', 'se', 'nw', 'sw', 'n', 's'];
    else if (tx * ty > 0) base = ['ne', 'sw', 'e', 'w', 'n', 's', 'nw', 'se'];
    else base = ['nw', 'se', 'w', 'e', 'n', 's', 'ne', 'sw'];
    const p = String(pref || '').toLowerCase();
    return (all.includes(p) ? [p] : []).concat(base.filter((d) => d !== p));
  }
  function layout(m) {
    m.placed = true;
    for (const st of m.stations.values()) buildStationEls(m, st);
    const obst = [];
    for (const r of m.routes) {
      const pad = r.sw / 2 + 5;
      for (let i = 0; i < r.G.S.length; i++) {
        const a = r.G.S[i], b = r.G.S[Math.min(i + 1, r.G.S.length - 1)];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 14));
        for (let k = 0; k < n; k++) { const x = lerp(a.x, b.x, k / n), y = lerp(a.y, b.y, k / n); obst.push({ x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad, line: true }); }
      }
    }
    for (const st of m.stations.values()) if (isX(st) || !st.members.some((mm) => mm.route)) obst.push({ x0: st.x - 24, y0: st.y - 24, x1: st.x + 24, y1: st.y + 24 });
    for (const b of m.boxes) obst.push(typeof b === 'function' ? b() : b);
    const placed = [];
    m.placedBoxes = placed;
    const place = (el, p, pref, tan, g) => {
      const w = el.offsetWidth, hh = el.offsetHeight;
      let best = null;
      for (const dir of order(pref, tan.x, tan.y)) {
        const bx = boxAt(p, dir, w, hh, g);
        let score = 0;
        const out = Math.max(0, BOUND.x0 - bx.x0) + Math.max(0, bx.x1 - BOUND.x1) + Math.max(0, BOUND.y0 - bx.y0) + Math.max(0, bx.y1 - BOUND.y1);
        score += out * 400;
        for (const o of obst) score += inter(bx, o) * (o.line ? 3 : 1);
        for (const o of placed) score += inter(bx, o) * 4;
        if (!best || score < best.score - 1) best = { dir, bx, score };
        if (score < 1) break;
      }
      // still poking out of the frame: slide it in
      const bx = best.bx, sx = Math.max(0, BOUND.x0 - bx.x0) - Math.max(0, bx.x1 - BOUND.x1), sy = Math.max(0, BOUND.y0 - bx.y0) - Math.max(0, bx.y1 - BOUND.y1);
      const fb = { x0: bx.x0 + sx, y0: bx.y0 + sy, x1: bx.x1 + sx, y1: bx.y1 + sy };
      placed.push(fb);
      el.style.left = f2(fb.x0) + 'px'; el.style.top = f2(fb.y0) + 'px';
      const [dx] = DIRS[best.dir];
      el.classList.toggle('r', dx < 0); el.classList.toggle('c', dx === 0);
      return best.dir;
    };
    for (const st of m.stations.values()) {
      if (!st.el) continue;
      const mm = st.members.find((q) => q.route) || st.members[0];
      const tan = mm.tan || { x: 1, y: 0 };
      const x = isX(st);
      const g = x ? 30 : (mm.route ? mm.route.sw / 2 + 22 : 30);
      if (x || st.members.some((q) => q.end)) st.el.classList.add('b');
      st.dir = place(st.el, { x: st.x, y: st.y }, st.side, tan, g);
    }
    // fixed candidate boxes (a river's name along its straights): the clearest one
    const fit = (cands) => {
      let best = null;
      for (const bx of cands) {
        let sc = 0;
        for (const o of obst) sc += inter(bx, o) * (o.line ? 3 : 1);
        for (const o of placed) sc += inter(bx, o) * 4;
        if (bx.x0 < BOUND.x0 || bx.x1 > BOUND.x1) sc += 1e6;
        if (!best || sc < best.sc) best = { bx, sc };
      }
      if (best) placed.push(best.bx);
      return best && best.bx;
    };
    for (const it of m.items) if (it.place) { const r = it.place(place, fit); if (r) placed.push(r); }
    frame(m, placed);
  }

  // ── framing: the finished network (lines, rings, names, notes, numbers, zones) is scaled and centred to fill the
  //    content area, leaving the legend's corner free. Time-independent: computed once with the label layout.
  function frame(m, placed) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const all = [];
    const add = (b) => { all.push(b); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); };
    for (const r of m.routes) for (const p of r.G.S) add({ x0: p.x - r.sw, y0: p.y - r.sw, x1: p.x + r.sw, y1: p.y + r.sw });
    for (const b of placed) add(b);
    for (const b of m.boxes) add(typeof b === 'function' ? b() : b);
    for (const z of m.zones) add(z);
    if (x1 <= x0) return;
    const T = { x0: BOUND.x0 + 6, y0: BOUND.y0 + 6, x1: BOUND.x1 - 6, y1: BOUND.y1 - 6 };
    const bw = x1 - x0, bh = y1 - y0;
    const fitTo = (t) => {
      const sc = clamp(Math.min((t.x1 - t.x0) / bw, (t.y1 - t.y0) / bh), 0.86, 1.45);
      // centred; content wider or taller than the target keeps inside the content area instead of spilling evenly
      let tx = (t.x0 + t.x1) / 2 - sc * (x0 + x1) / 2, ty = (t.y0 + t.y1) / 2 - sc * (y0 + y1) / 2;
      if (sc * bw > T.x1 - T.x0) tx = T.x0 - sc * x0; else tx = clamp(tx, T.x0 - sc * x0, T.x1 - sc * x1);
      if (sc * bh > T.y1 - T.y0) ty = T.y0 - sc * y0; else ty = clamp(ty, T.y0 - sc * y0, T.y1 - sc * y1);
      return { sc, tx, ty };
    };
    const L = m.legend && m.legend();
    const hitsLegend = (f) => L && all.some((b) => b.x0 * f.sc + f.tx < L.x1 + 12 && b.x1 * f.sc + f.tx > L.x0 - 12 && b.y0 * f.sc + f.ty < L.y1 + 12 && b.y1 * f.sc + f.ty > L.y0 - 12);
    const opts = [T];
    if (L) {
      const left = L.x0 < STAGE.w / 2, topSide = L.y0 < STAGE.h / 2;
      opts.push(Object.assign({}, T, left ? { x0: L.x1 + 16 } : { x1: L.x0 - 16 }), Object.assign({}, T, topSide ? { y0: L.y1 + 16 } : { y1: L.y0 - 16 }));
    }
    let best = null;
    for (const t of opts) {
      const f = fitTo(t);
      const sc = f.sc - (hitsLegend(f) ? 10 : 0);
      if (!best || sc > best.score) best = { f, score: sc };
    }
    const { sc, tx, ty } = best.f;
    m.fit = { s: sc, tx, ty };
    m.root.style.transformOrigin = '0 0';
    m.root.style.transform = `translate(${f2(tx)}px, ${f2(ty)}px) scale(${sc.toFixed(4)})`;
  }

  function renderStation(m, st, lt) {
    buildStationEls(m, st);
    const x = isX(st), t0 = tFirst(st);
    const vis = Math.min(...st.members.map((mm) => (mm.route ? mm.route.vis(lt) : 1)));
    // ticks (a plain stop) or a terminus bar, on the side the label went
    st.members.forEach((mm, i) => {
      const tk = st.ticks[i];
      if (!tk) return;
      const k = back((lt - mm.t) / 0.25);
      if (x || lt < mm.t || k <= 0.01) { tk.setAttribute('visibility', 'hidden'); return; }
      tk.setAttribute('visibility', 'visible');
      const r = mm.route, n = { x: -mm.tan.y, y: mm.tan.x };
      const [ldx, ldy] = DIRS[st.dir || 'n'];
      let side = Math.sign(n.x * ldx + n.y * ldy) || 1;
      const len = r.sw / 2 + r.sw * 0.85;
      const a = mm.end ? -len * k : 0, b = side * len * k;
      const p0 = mm.end ? { x: mm.x + n.x * a, y: mm.y + n.y * a } : { x: mm.x, y: mm.y };
      tk.setAttribute('x1', f2(p0.x)); tk.setAttribute('y1', f2(p0.y));
      tk.setAttribute('x2', f2(mm.x + n.x * (mm.end ? len * k : b))); tk.setAttribute('y2', f2(mm.y + n.y * (mm.end ? len * k : b)));
      tk.setAttribute('stroke', r.colorAt(lt));
      tk.setAttribute('opacity', f2(vis));
    });
    // the light-up pulse at every arrival (an ink ring for interchanges, the line's colour for a plain stop)
    st.members.forEach((mm, i) => {
      const pl = st.pulses[i], k = (lt - mm.t) / 0.65;
      if (k < 0 || k > 1) { pl.setAttribute('visibility', 'hidden'); return; }
      pl.setAttribute('visibility', 'visible');
      pl.setAttribute('cx', f2(mm.x)); pl.setAttribute('cy', f2(mm.y));
      const r0 = mm.route ? mm.route.sw * 0.7 : 16;
      pl.setAttribute('r', f2(r0 + (x ? 36 : 26) * expo(k)));
      pl.setAttribute('stroke', x || !mm.route ? INK : lc(mm.route.color));
      pl.setAttribute('stroke-width', x ? 5 : 4);
      pl.setAttribute('opacity', f2((1 - k) * 0.8 * vis));
    });
    // interchange ring (a capsule when the lines run side by side)
    if (x || !st.members.some((q) => q.route)) {
      const k = back((lt - t0) / 0.3);
      if (lt < t0 || k <= 0.01) { st.ringOut.setAttribute('visibility', 'hidden'); st.ringIn.setAttribute('visibility', 'hidden'); }
      else {
        const xs = st.members.map((q) => q.x), ys = st.members.map((q) => q.y);
        const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
        const sw = Math.max(...st.members.map((q) => (q.route ? q.route.sw : 18)));
        const R = (sw * 0.78 + 6) * k;
        const d = `M${f2(a.x)} ${f2(a.y)} L${f2(b.x + 0.01)} ${f2(b.y)}`;
        // a later arrival makes the ring beat once
        let beat = 0;
        for (const q of st.members) if (q.t > t0 + 0.05 && lt >= q.t && lt < q.t + 0.5) beat = Math.sin(Math.PI * (lt - q.t) / 0.5) * 0.22;
        const RR = R * (1 + beat);
        for (const [el, w] of [[st.ringOut, RR * 2], [st.ringIn, Math.max(1, RR * 2 - 13)]]) {
          el.setAttribute('d', d); el.setAttribute('stroke-width', f2(w)); el.setAttribute('visibility', 'visible'); el.setAttribute('opacity', f2(vis));
        }
      }
    }
    // the name: wipes out from the station on the first arrival
    if (st.el) {
      const k = expo((lt - t0 - 0.05) / 0.35);
      st.el.style.opacity = lt < t0 ? '0' : f2(clamp(k * 1.6) * vis);
      const [dx, dy] = DIRS[st.dir || 'n'];
      st.el.style.transform = `translate(${f2(-dx * 10 * (1 - k))}px, ${f2(-dy * 10 * (1 - k))}px)`;
      const dim = st.members.every((q) => q.route && q.route.dimK(lt) > 0.5);
      st.el.style.color = dim ? '#9AA0A6' : '';
    }
  }

  /**
   * route(points, o): one metro line, drawn by a train that runs it and stops at every station on its spoken word —
   * the signature of this style. points: grid points [c, r] (c 0–26, r 0–11) or named stations [c, r, 'name', at] or
   * { c, r, name, at, sub, side, via, x }. You only give the stops and bends: the kit routes 0°/45°/90° runs with
   * rounded bends between them (by default whichever order turns least; o.bend 'diag' or a point's via: 'diag' puts the 45° run
   * first). at = when the train reaches that station (P.cw(i, 'word')); stations without at are passed at cruise speed.
   * A grid point used by two lines becomes an interchange ring by itself (name it once); a branch starts at a station
   * of another line. Labels place themselves clear of lines and other labels; side: 'n'|'s'|'e'|'w'|'ne'|… prefers one.
   * o: { color (line colour: red blue green orange purple yellow teal pink brown navy lime; default: the next unused),
   * at (when the line starts; default the first point's at; a branch never leaves before its first station is reached), name (for the legend), badge ('1', 'A': round badge
   * at both ends), sw (line width 24, 14–32), offset (px sideways to run beside another line on the same points, ±22),
   * planned (true: hollow line under construction), train (false: no train), speed (700 px/s), size (label px 32), side }.
   * Returns a handle: .st(i | 'name') → { x, y, t } of a station, .end (time the line is finished), .dim(t) (greys the
   * line: the road not taken), .solo(t) (greys every other line), .hide(t).
   */
  B.route = function (points, o = {}) {
    const m = M(this);
    const pts = (points || []).map(pt).filter((p, i, a) => i === 0 || p.c !== a[i - 1].c || p.r !== a[i - 1].r);
    if (pts.length < 2) throw new Error('P.route needs at least two grid points, e.g. [[2, 8, "A", 0.5], [10, 8, "B", 2]]');
    const used = new Set(m.routes.map((r) => r.color));
    const color = o.color || AUTO.find((c) => !used.has(c)) || 'ink';
    const sw = clamp(o.sw ?? 24, 14, 32);
    // a branch leaves an existing station no earlier than its first line reaches it (default: right then)
    const st0 = m.stations.get(`${pts[0].c},${pts[0].r}`), t0 = st0 ? Math.min(...st0.members.map((q) => q.t)) : null;
    if (t0 != null) o = Object.assign({}, o, { at: Math.max(o.at ?? pts[0].at ?? t0, t0) });
    const G = buildGeom(pts, o), C = buildClock(G, pts, o);
    const r = { color, sw, G, C, name: o.name, badge: o.badge, dimAt: null, solos: [] };
    const fade = (lt) => { let k = 0; if (r.dimAt != null) k = Math.max(k, clamp((lt - r.dimAt) / 0.5)); for (const t of r.solos) k = Math.max(k, clamp((lt - t) / 0.5)); return k; };
    r.dimK = fade;
    r.colorAt = (lt) => { const k = fade(lt); return k > 0 ? mix(color, FAINT, k * 0.85) : lc(color); };
    r.vis = (lt) => 1;
    m.routes.push(r);
    // the line: a paper casing (so crossings read cleanly), the colour, and for a planned line a hollow core
    const g = s('g', null, m.lines);
    const casing = s('path', { d: G.d, fill: 'none', stroke: PAPER, 'stroke-width': sw + 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: f2(G.total) }, g);
    const body = s('path', { d: G.d, fill: 'none', stroke: lc(color), 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: f2(G.total) }, g);
    const core = o.planned ? s('path', { d: G.d, fill: 'none', stroke: PAPER, 'stroke-width': Math.max(4, sw - 10), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: f2(G.total) }, g) : null;
    const parts = [casing, body, core].filter(Boolean);
    // stations (ends that already belong to another line are branch points: no badge there)
    const shared = [pts[0], pts[pts.length - 1]].map((p) => m.stations.has(`${p.c},${p.r}`));
    pts.forEach((p, i) => {
      const key = `${p.c},${p.r}`;
      const named = !!p.name || p.opts.x || m.stations.has(key);
      if (!named) return;
      const len = G.ptL[i], q = G.at(len), q2 = G.at(Math.min(G.total, len + 2)), q1 = G.at(Math.max(0, len - 2));
      const tl = Math.hypot(q2.x - q1.x, q2.y - q1.y) || 1;
      const member = { route: r, t: C.tOf(len), x: q.x, y: q.y, tan: { x: (q2.x - q1.x) / tl, y: (q2.y - q1.y) / tl }, end: i === 0 || i === pts.length - 1 };
      addStation(m, key, X0 + p.c * U, Y0 + p.r * U, { name: p.name, sub: p.opts.sub, side: p.opts.side || o.side, size: o.size, x: p.opts.x, member, gx: p.c, gy: p.r });
    });
    // the train: a short ink car riding the tip of the line while it draws
    const train = o.train === false ? null : s('g', { visibility: 'hidden' }, m.trains);
    if (train) {
      s('rect', { x: -sw * 1.25, y: -sw * 0.62, width: sw * 2.5, height: sw * 1.24, rx: sw * 0.62, fill: INK }, train);
      s('rect', { x: -sw * 0.75, y: -sw * 0.16, width: sw * 1.5, height: sw * 0.32, rx: sw * 0.16, fill: '#FFFFFF' }, train);
    }
    // badges at both ends
    const badges = [];
    if (o.badge != null) {
      for (const end of [0, 1]) {
        if (shared[end]) continue;
        const len = end ? G.total : 0, q = G.at(len), dir = end ? 1 : -1, d = 52;
        const cx = q.x + q.tx * dir * (sw / 2 + d / 2 + 12), cy = q.y + q.ty * dir * (sw / 2 + d / 2 + 12);
        if (cx - d / 2 < BOUND.x0 || cx + d / 2 > BOUND.x1 || cy - d / 2 < BOUND.y0 || cy + d / 2 > BOUND.y1 - 4) continue;
        if (m.boxes.some((b) => typeof b === 'object' && b.badge && Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) < d)) continue;
        const el = h('div', 'tx mt-badge', null, m.labels);
        el.textContent = String(o.badge);
        Object.assign(el.style, { width: d + 'px', height: d + 'px', left: f2(cx - d / 2) + 'px', top: f2(cy - d / 2) + 'px', background: lc(color), fontSize: (String(o.badge).length > 1 ? 27 : 31) + 'px', color: light(color) ? INK : '#fff' });
        m.boxes.push({ x0: cx - d / 2 - 4, y0: cy - d / 2 - 4, x1: cx + d / 2 + 4, y1: cy + d / 2 + 4, badge: true });
        const ep = pts[end ? pts.length - 1 : 0];
        badges.push({ el, t: end ? C.end : C.start, key: `${ep.c},${ep.r}` });
      }
    }
    const a = anim(this, C.start, Math.max(0.05, C.end - C.start), g, (_, lt, vis) => {
        const L = C.L(lt), on = lt >= C.start;
        for (const el of parts) { el.style.strokeDasharray = `${f2(on ? Math.max(0.01, L) : 0)} ${f2(G.total + 10)}`; el.style.visibility = on ? 'visible' : 'hidden'; }
        body.setAttribute('stroke', r.colorAt(lt));
        g.style.opacity = f2(vis);
        if (train) {
          const shown = on && lt < C.end + 0.6;
          train.setAttribute('visibility', shown ? 'visible' : 'hidden');
          if (shown) {
            const q = G.at(Math.max(L, 0.5)), q0 = G.at(Math.max(0, L - 6)), q1 = G.at(Math.min(G.total, L + 6));
            const ang = Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
            const pop = Math.min(back((lt - C.start) / 0.25), 1 - clamp((lt - C.end - 0.25) / 0.35));
            train.setAttribute('transform', `translate(${f2(q.x)} ${f2(q.y)}) rotate(${f2(ang)}) scale(${f2(Math.max(0.01, pop))})`);
            train.setAttribute('opacity', f2(vis));
          }
        }
        for (const b of badges) {
          // an end that another line later joins is an interchange, not a terminus: no badge there
          const xs = m.stations.get(b.key); if (xs && xs.members.length > 1) { b.el.style.display = 'none'; continue; }
          const k = back((lt - b.t) / 0.3); b.el.style.opacity = lt < b.t ? '0' : f2(vis); b.el.style.transform = `scale(${f2(lerp(0.75, 1, k))})`; }
    });
    r.vis = (lt) => visOf(a, lt);
    const hnd = this.handle(a, g);
    const find = (i) => {
      const named = pts.map((p, k) => ({ p, k })).filter((x) => x.p.name);
      const hit = typeof i === 'string' ? named.find((x) => x.p.name === i) : named[clamp(i | 0, 0, named.length - 1)];
      const k = hit ? hit.k : 0, q = G.at(G.ptL[k]);
      return { x: q.x, y: q.y, t: C.tOf(G.ptL[k]), c: pts[k].c, r: pts[k].r };
    };
    return Object.assign(hnd, {
      route: r, st: find,
      dim(t) { r.dimAt = t; return this; },
      solo(t) { for (const q of m.routes) if (q !== r) q.solos.push(t); return this; },
    });
  };

  /**
   * station(c, r, name, o): a lone stop that is not on a line drawn yet (a destination ahead, a stop on a line off the
   * map) — a white ring with its name; if a line stops there later it becomes that line's station. Also adds a label to
   * an existing unnamed point of a line. o: { at, sub (a second, smaller line: a date, a duration), side, size (30) }.
   */
  B.station = function (c, r, name, o = {}) {
    const m = M(this), p = pt([c, r]);
    const member = { route: null, t: o.at ?? 0, x: X0 + p.c * U, y: Y0 + p.r * U, tan: { x: 1, y: 0 }, end: false };
    addStation(m, `${p.c},${p.r}`, member.x, member.y, { name, sub: o.sub, side: o.side, size: o.size, member, gx: p.c, gy: p.r });
    return { t: member.t, x: member.x, y: member.y };
  };

  /**
   * train(route, o): a train riding a finished line — a parcel, a request, a person travelling the path while the
   * narration follows it; it stops at stations on their words. route: the handle P.route returned. o: { at (departure),
   * from (station index or name, default 0), to (default the last), dur (default by distance), stops: [[t, i], …]
   * (arrive at named station i at time t, instead of from/to/dur), label (a short tag riding above it: '请求', 'you'),
   * color ('ink'), out (time it disappears; default 1.2 s after its last stop), stay (true: it stays parked) }. Several trains on one page are fine; one label each.
   */
  B.train = function (route, o = {}) {
    const m = M(this), r = route && route.route;
    if (!r) throw new Error('P.train(route, o) needs the handle returned by P.route');
    const G = r.G;
    const lenOf = (i) => { const q = route.st(i); let best = 0, bd = 1e9; for (let L = 0; L <= G.total; L += 4) { const p = G.at(L), dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd < bd) { bd = dd; best = L; } } return best; };
    let keys;
    if (Array.isArray(o.stops) && o.stops.length) keys = o.stops.map(([t, i]) => ({ t, L: lenOf(i) }));
    else {
      const L0 = lenOf(o.from ?? 0), L1 = o.to == null ? G.total : lenOf(o.to), at = o.at ?? 0;
      keys = [{ t: at, L: L0 }, { t: at + (o.dur ?? Math.max(0.8, Math.abs(L1 - L0) / 450)), L: L1 }];
    }
    keys.sort((a, b) => a.t - b.t);
    const Lat = (lt) => {
      if (lt <= keys[0].t) return keys[0].L;
      for (let j = 1; j < keys.length; j++) if (lt < keys[j].t) { const tau = Math.min(keys[j].t - keys[j - 1].t, Math.max(0.5, Math.abs(keys[j].L - keys[j - 1].L) / 600)); const dep = keys[j].t - tau; return lt < dep ? keys[j - 1].L : lerp(keys[j - 1].L, keys[j].L, io((lt - dep) / tau)); }
      return keys[keys.length - 1].L;
    };
    const sw = r.sw, gT = s('g', { visibility: 'hidden' }, m.trains);
    s('rect', { x: -sw * 1.35, y: -sw * 0.68, width: sw * 2.7, height: sw * 1.36, rx: sw * 0.68, fill: lc(o.color || 'ink'), stroke: '#FFFFFF', 'stroke-width': 3 }, gT);
    s('rect', { x: -sw * 0.8, y: -sw * 0.17, width: sw * 1.6, height: sw * 0.34, rx: sw * 0.17, fill: '#FFFFFF' }, gT);
    let tag = null;
    if (o.label) { tag = h('div', 'tx mt-note', null, m.labels); tag.textContent = o.label; Object.assign(tag.style, { fontSize: '30px', padding: '6px 14px 7px', borderRadius: '999px', fontWeight: 800, opacity: 0 }); }
    const t0 = keys[0].t, t1 = o.out ?? (o.stay ? Infinity : keys[keys.length - 1].t + 1.2);   // a train leaves 1.2 s after its last stop
    const a = anim(this, t0, Math.max(0.1, keys[keys.length - 1].t - t0 + 0.2), gT, (_, lt, vis) => {
      const on = lt >= t0 && lt < t1 + 0.3;
      gT.setAttribute('visibility', on ? 'visible' : 'hidden');
      const fadeOut = 1 - clamp((lt - t1) / 0.3);
      if (!on) { if (tag) tag.style.opacity = '0'; return; }
      const L = Lat(lt), q = G.at(L), q0 = G.at(Math.max(0, L - 6)), q1 = G.at(Math.min(G.total, L + 6));
      const ang = Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI;
      const pop = Math.min(back((lt - t0) / 0.3), fadeOut);
      gT.setAttribute('transform', `translate(${f2(q.x)} ${f2(q.y)}) rotate(${f2(ang)}) scale(${f2(Math.max(0.01, pop))})`);
      gT.setAttribute('opacity', f2(vis));
      if (tag) {
        const w = tag.offsetWidth, hh = tag.offsetHeight;
        // above the train, else below, else beside: wherever no station name is
        const gap = sw + 14, cands = [[q.x - w / 2, q.y - gap - hh], [q.x - w / 2, q.y + gap], [q.x + gap, q.y - hh / 2], [q.x - gap - w, q.y - hh / 2]]
          .map(([x, y]) => { const F = m.fit, bx0 = (BOUND.x0 - F.tx) / F.s, bx1 = (BOUND.x1 - F.tx) / F.s, by0 = (BOUND.y0 - F.ty) / F.s, by1 = (BOUND.y1 - F.ty) / F.s; x = clamp(x, bx0, bx1 - w); y = clamp(y, by0, by1 - hh); return { x0: x, y0: y, x1: x + w, y1: y + hh }; });
        const hit = (b) => (m.placedBoxes || []).reduce((acc, o) => acc + inter(b, o), 0);
        const pick = cands.find((b) => hit(b) < 1) || cands.reduce((a, b) => (hit(b) < hit(a) ? b : a));
        tag.style.left = f2(pick.x0) + 'px';
        tag.style.top = f2(pick.y0) + 'px';
        tag.style.opacity = f2(clamp((lt - t0) / 0.25) * fadeOut * vis);
      }
    });
    return this.handle(a, gT);
  };

  /**
   * badge(c, r, str, o): a round line badge — a coloured disc with the line's number or letter in white ('1', 'A',
   * 'M2'), pops in. For a line's name beside the map or in a note; P.route's o.badge already puts one at both ends.
   * o: { color ('red'), at, d (diameter 56, 40–110) }.
   */
  B.badge = function (c, r, str, o = {}) {
    const m = M(this), d = clamp(o.d ?? 56, 40, 110), cx = PV.mx(c), cy = PV.my(r), at = o.at ?? 0;
    const el = h('div', 'tx mt-badge', null, m.labels);
    el.textContent = String(str);
    Object.assign(el.style, { width: d + 'px', height: d + 'px', left: f2(cx - d / 2) + 'px', top: f2(cy - d / 2) + 'px', background: lc(o.color || 'red'), fontSize: f2(d * (String(str).length > 1 ? 0.42 : 0.54)) + 'px', color: light(o.color || 'red') ? INK : '#fff' });
    m.boxes.push({ x0: cx - d / 2 - 4, y0: cy - d / 2 - 4, x1: cx + d / 2 + 4, y1: cy + d / 2 + 4 });
    const a = anim(this, at, 0.35, el, (k, lt, vis) => { el.style.opacity = lt < at ? '0' : f2(vis); el.style.transform = `scale(${f2(lerp(0.75, 1, back(k)))})`; });
    return this.handle(a, el);
  };

  /**
   * legend(items, o): the map's key — a white box with an ink border listing each line (colour bar, badge, name) and the
   * interchange ring. items: [{ color, name, badge }]; leave it out to list every P.route on this page that has a name.
   * o: { at, pos 'br' (default) | 'bl' | 'tr' | 'tl' (corner of the content area), title ('线路' / 'Lines'; false: none),
   * xchg (the interchange row's text; false: no row) }. Rows land one by one. One per page, in a corner the lines avoid.
   */
  B.legend = function (items, o = {}) {
    const m = M(this), at = o.at ?? 0;
    const el = h('div', 'mt-leg', null, m.over);
    const fromRoutes = !Array.isArray(items);
    const rows = [];
    const fill = () => {
      const list = fromRoutes ? m.routes.filter((r) => r.name).map((r) => ({ color: r.color, name: r.name, badge: r.badge })) : items;
      el.innerHTML = '';
      if (o.title !== false) { const t = h('div', 'tx hd', null, el); t.textContent = o.title || (zh() ? '线路图例' : 'Lines'); rows.push(t); }
      for (const it of list) {
        const row = h('div', 'tx row', null, el);
        h('i', 'bar', null, row).style.background = lc(it.color || 'ink');
        if (it.badge != null) { const b = h('b', 'bd', null, row); b.textContent = String(it.badge); b.style.background = lc(it.color || 'ink'); if (light(it.color)) b.style.color = INK; }
        const t = h('span', null, null, row); t.textContent = it.name || '';
        rows.push(row);
      }
      if (o.xchg !== false) { const row = h('div', 'tx row', null, el); h('i', 'ring', null, row); const t = h('span', null, null, row); t.textContent = o.xchg || (zh() ? '换乘站' : 'Interchange'); rows.push(row); }
    };
    if (!fromRoutes) fill();
    const pos = o.pos || 'br';
    let box = null;
    const put = () => {
      if (fromRoutes && !rows.length) fill();
      const w = el.offsetWidth, hh = el.offsetHeight;
      const x = pos.includes('l') ? BOUND.x0 + 6 : BOUND.x1 - 6 - w, y = pos.includes('t') ? BOUND.y0 + 10 : BOUND.y1 - 8 - hh;
      el.style.left = f2(x) + 'px'; el.style.top = f2(y) + 'px';
      box = { x0: x - 8, y0: y - 8, x1: x + w + 8, y1: y + hh + 8 };
      return box;
    };
    m.legend = () => put();
    const a = anim(this, at, 0.4 + 0.12 * 8, el, (_, lt, vis) => {
      if (!box) put();
      const k = expo((lt - at) / 0.35);
      el.style.opacity = lt < at ? '0' : f2(clamp(k * 1.5) * vis);
      el.style.transform = `translateY(${f2((1 - k) * 14)}px)`;
      rows.forEach((row, i) => { row.style.opacity = f2(clamp((lt - at - 0.15 - i * 0.12) / 0.2)); });
    });
    return this.handle(a, el);
  };

  /**
   * river(points, o): the pale blue river running behind the network (Beck's Thames) — geography as one calm shape that
   * the lines cross. points: grid points [c, r]; runs 0°/45°/90° with wide bends, and may leave the grid edge (c −2 or 28
   * to run off the frame). o: { name (italic, along its longest straight), at (0), w (width 56), color ('blueF') }.
   * At most one per film's page; draw it first.
   */
  B.river = function (points, o = {}) {
    const m = M(this);
    const pts = (points || []).map((p) => ({ c: clamp(Math.round((+p[0] || 0) * 2) / 2, -4, CMAX + 4), r: clamp(Math.round((+p[1] || 0) * 2) / 2, -2, RMAX + 2), name: '', opts: {} }));
    if (pts.length < 2) throw new Error('P.river needs at least two grid points');
    const G = buildGeom(pts, { radius: 120 });
    const at = o.at ?? 0, w = clamp(o.w ?? 56, 24, 120);
    const path = s('path', { d: G.d, fill: 'none', stroke: lc(o.color || 'blueF'), 'stroke-width': w, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round', pathLength: f2(G.total) }, m.under);
    let lab = null;
    if (o.name) {
      // the longest straight run carries the name
      let best = null;
      for (let i = 1; i < G.V.length; i++) { const a = G.V[i - 1], b = G.V[i], l = Math.hypot(b.x - a.x, b.y - a.y); if (!best || l > best.l) best = { a, b, l }; }
      const cx = clamp((best.a.x + best.b.x) / 2, A.x0 + 160, A.x1 - 160), cy = clamp((best.a.y + best.b.y) / 2, A.y0 + 50, A.y1 - 20);
      let ang = Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      lab = h('div', 'tx mt-rv', null, m.labels);
      lab.textContent = o.name;
      lab.style.opacity = '0';
      m.items.push({ place: (_, fit) => {
        const ww = lab.offsetWidth, hh = lab.offsetHeight, cands = [];
        for (let i = 1; i < G.V.length; i++) {
          const a = G.V[i - 1], b = G.V[i];
          if (Math.abs(a.y - b.y) > 1 || a.y < A.y0 + 40 || a.y > A.y1 - 20) continue;
          const xa = Math.min(a.x, b.x) + 90 + ww / 2, xb = Math.max(a.x, b.x) - 90 - ww / 2;
          for (let x = xa; x <= xb; x += 30) cands.push({ x0: x - ww / 2, y0: a.y - hh / 2, x1: x + ww / 2, y1: a.y + hh / 2 });
        }
        const bx = cands.length ? fit(cands) : null;
        if (bx) { lab.style.left = f2(bx.x0) + 'px'; lab.style.top = f2(bx.y0) + 'px'; return null; }
        lab.style.left = f2(cx - ww / 2) + 'px'; lab.style.top = f2(cy - hh / 2) + 'px'; lab.style.transform = `rotate(${f2(ang)}deg)`; return null;
      } });
    }
    const a = anim(this, at, 1.4, path, (k, lt, vis) => {
      path.style.strokeDasharray = `${f2(lt < at ? 0 : G.total * ease.out(k))} ${f2(G.total + 10)}`;
      path.style.opacity = f2(vis);
      if (lab) lab.style.opacity = f2(clamp((lt - at - 0.8) / 0.5) * vis);
    });
    return this.handle(a, path);
  };

  /**
   * zone(c0, r0, c1, r1, o): a fare-zone field — a pale rounded panel behind part of the network that groups stations
   * (a phase, a department, a country, 'Zone 1'), its name in small spaced capitals in its top-left corner.
   * o: { name, at, color ('ink' → the faintest grey; or a line colour for a pale tint of it) }. Draw zones first; 1–3 per page; it appears with the first station inside it.
   */
  B.zone = function (c0, r0, c1, r1, o = {}) {
    const m = M(this), at = o.at ?? 0;
    const x0 = Math.min(PV.mx(c0), PV.mx(c1)) - 40, x1 = Math.max(PV.mx(c0), PV.mx(c1)) + 40, y0 = Math.min(PV.my(r0), PV.my(r1)) - 40, y1 = Math.max(PV.my(r0), PV.my(r1)) + 40;
    const c = o.color && o.color !== 'ink' ? mix(o.color, '#FFFFFF', 0.86) : '#ECEBE4';
    const rect = s('rect', { x: f2(x0), y: f2(y0), width: f2(x1 - x0), height: f2(y1 - y0), rx: 28, fill: c }, m.under);
    m.zones.push({ x0, y0, x1, y1 });
    let lab = null;
    if (o.name) {
      lab = h('div', 'tx mt-zl', null, m.labels);
      lab.textContent = o.name;
      Object.assign(lab.style, { left: f2(x0 + 22) + 'px', top: f2(y0 + 12) + 'px' });
      if (o.color && o.color !== 'ink') lab.style.color = mix(o.color, INK, 0.25);
      m.boxes.push(() => ({ x0: x0 + 18, y0: y0 + 8, x1: x0 + 26 + lab.offsetWidth, y1: y0 + 16 + lab.offsetHeight }));
    }
    // a zone never waits empty: it appears with the first station inside it (or at o.at, whichever is later)
    let tz = null;
    const start = () => {
      if (tz != null) return tz;
      let first = Infinity;
      for (const st of m.stations.values()) if (st.x >= x0 && st.x <= x1 && st.y >= y0 && st.y <= y1) for (const mm of st.members) if (Number.isFinite(mm.t)) first = Math.min(first, mm.t);
      return (tz = Number.isFinite(first) ? Math.max(at, first - 0.2) : at);
    };
    const a = anim(this, at, 0.5, rect, (_, lt, vis) => {
      const t0 = start(), k = clamp((lt - t0) / 0.5), e = expo(k);
      rect.setAttribute('opacity', f2((lt < t0 ? 0 : e) * vis));
      if (lab) lab.style.opacity = f2((lt < t0 ? 0 : clamp(k * 2 - 0.4)) * vis);
    });
    return this.handle(a, rect);
  };

  /**
   * note(c, r, str, o): a callout box pinned to a grid point by a short ink leader — the map's annotation: a time
   * ('≈ 2 年'), 'change here for …', a rule of the network. It finds a free side by itself. Markup **bold**.
   * o: { at, side (preferred), w (max width, 220–520, default 380), size (28) }. At most two per page; a few words each.
   */
  B.note = function (c, r, str, o = {}) {
    const m = M(this), at = o.at ?? 0, p = { x: PV.mx(c), y: PV.my(r) };
    const el = h('div', 'tx mt-note', null, m.labels);
    el.innerHTML = String(str).replace(/[<&]/g, (ch) => (ch === '<' ? '&lt;' : '&amp;')).replace(/\*\*([^*]+)\*\*/g, '<span class="k">$1</span>').replace(/\n/g, '<br>');
    Object.assign(el.style, { fontSize: clamp(o.size ?? 28, 24, 40) + 'px', maxWidth: clamp(o.w ?? 380, 220, 520) + 'px', opacity: 0 });
    const lead = s('line', { stroke: INK, 'stroke-width': 3, visibility: 'hidden' }, m.marks);
    const dot = s('circle', { r: 6, fill: INK, cx: p.x, cy: p.y, visibility: 'hidden' }, m.marks);
    let q = null;
    m.items.push({ place: (place) => { place(el, p, o.side, { x: 1, y: 0 }, 70); const L = el.offsetLeft, T = el.offsetTop, W = el.offsetWidth, H = el.offsetHeight; q = { x: clamp(p.x, L, L + W), y: clamp(p.y, T, T + H) }; return null; } });
    const a = anim(this, at, 0.5, el, (k, lt, vis) => {
      const on = lt >= at;
      dot.setAttribute('visibility', on ? 'visible' : 'hidden');
      lead.setAttribute('visibility', on && q ? 'visible' : 'hidden');
      if (q) { const e = expo(clamp(k * 2)); lead.setAttribute('x1', p.x); lead.setAttribute('y1', p.y); lead.setAttribute('x2', f2(lerp(p.x, q.x, e))); lead.setAttribute('y2', f2(lerp(p.y, q.y, e))); }
      lead.setAttribute('opacity', f2(vis)); dot.setAttribute('opacity', f2(vis));
      el.style.opacity = on ? f2(clamp((k - 0.3) / 0.4) * vis) : '0';
    });
    return this.handle(a, el);
  };

  /**
   * here(c, r, o): the "you are here" pin — a red dot with a white rim and a slow pulsing ring, and its words in bold
   * red. For where the viewer (or the subject) stands on the network now. o: { at, text (default '你在这里' / 'You are
   * here'), side, color ('red') }. One per page.
   */
  B.here = function (c, r, o = {}) {
    const m = M(this), at = o.at ?? 0, p = { x: PV.mx(c), y: PV.my(r) }, cc = lc(o.color || 'red');
    const g = s('g', { visibility: 'hidden' }, m.top);
    const ring = s('circle', { cx: p.x, cy: p.y, r: 20, fill: 'none', stroke: cc, 'stroke-width': 4 }, g);
    s('circle', { cx: p.x, cy: p.y, r: 19, fill: '#FFFFFF' }, g);
    s('circle', { cx: p.x, cy: p.y, r: 13, fill: cc }, g);
    const el = h('div', 'tx mt-lab b', null, m.labels);
    el.textContent = o.text || (zh() ? '你在这里' : 'You are here');
    Object.assign(el.style, { fontSize: '32px', color: cc, opacity: 0 });
    m.items.push({ place: (place) => { place(el, p, o.side, { x: 1, y: 0 }, 34); return null; } });
    m.boxes.push({ x0: p.x - 24, y0: p.y - 24, x1: p.x + 24, y1: p.y + 24 });
    const a = anim(this, at, 0.4, g, (k, lt, vis) => {
      g.setAttribute('visibility', lt >= at ? 'visible' : 'hidden');
      g.setAttribute('opacity', f2(vis));
      const ph = lt < at ? 0 : ((lt - at) % 1.6) / 1.6;
      ring.setAttribute('r', f2(20 + 30 * ease.out(ph)));
      ring.setAttribute('opacity', f2(lt < at ? 0 : 0.9 * (1 - ph)));
      g.setAttribute('transform', `translate(${f2(p.x)} ${f2(p.y)}) scale(${f2(Math.max(0.01, back(k)))}) translate(${f2(-p.x)} ${f2(-p.y)})`);
      el.style.opacity = lt < at ? '0' : f2(clamp((lt - at - 0.1) / 0.3) * vis);
    });
    return this.handle(a, g);
  };

  /**
   * stat(c, r, o): a big number in heavy grotesk set on the map's white space (the top-left of the number at grid
   * point c, r) that counts up and lands on its spoken word, with a caption under it — journey time, number of stops,
   * years. o: { to, from (0), at (start of the count: P.cw(i, 'word') - dur), dur (0.9), decimals, prefix, suffix,
   * unit (smaller, after it: '年', 'stops'), cap (caption line), color ('ink'; a line's colour to tie it to that line),
   * size (150, 90–240), align 'l' | 'r' }. One per page; the lines keep clear of it.
   */
  B.stat = function (c, r, o = {}) {
    const m = M(this), at = o.at ?? 0, dur = o.dur ?? 0.9, size = clamp(o.size ?? 150, 90, 240), dec = o.decimals ?? 0;
    const el = h('div', 'tx mt-stat', null, m.labels);
    Object.assign(el.style, { fontSize: size + 'px', color: lc(o.color || 'ink'), opacity: 0 });
    const num = h('span', null, null, el);
    if (o.unit) { const u = h('span', 'u', null, el); u.textContent = o.unit; }
    if (o.cap) { const cp = h('span', 'cap', null, el); cp.textContent = o.cap; }
    const fmt = (v) => (o.prefix || '') + (+v).toFixed(dec) + (o.suffix || '');
    num.textContent = fmt(o.to ?? 0);
    let pos = null;
    const put = () => {
      const w = el.offsetWidth, hh = el.offsetHeight;
      let x = o.align === 'r' ? PV.mx(c) - w : PV.mx(c), y = PV.my(r);
      x = clamp(x, BOUND.x0, BOUND.x1 - w); y = clamp(y, BOUND.y0, BOUND.y1 - hh);
      el.style.left = f2(x) + 'px'; el.style.top = f2(y) + 'px';
      pos = { x0: x - 10, y0: y - 10, x1: x + w + 10, y1: y + hh + 10 };
      return pos;
    };
    m.boxes.push(() => put());
    const a = anim(this, at, dur, el, (k, lt, vis) => {
      if (!pos) put();
      const v = lerp(o.from ?? 0, o.to ?? 0, ease.out(k));
      const s0 = fmt(v); if (num._s !== s0) { num._s = s0; num.textContent = s0; }
      el.style.opacity = lt < at ? '0' : f2(vis);
      el.style.transform = `translateY(${f2((1 - expo(clamp(k * 3))) * 24)}px)`;
    });
    return this.handle(a, el);
  };

  /**
   * walk(a, b, o): a dotted ink connector between two grid points — an out-of-station change on foot, a step outside the
   * network, a link that is not a line (a = [c, r], b = [c, r]). Runs straight; dots draw in order. o: { at, dur (0.6) }.
   */
  B.walk = function (a0, b0, o = {}) {
    const m = M(this), at = o.at ?? 0, dur = o.dur ?? 0.6;
    const a = { x: PV.mx(a0[0]), y: PV.my(a0[1]) }, b = { x: PV.mx(b0[0]), y: PV.my(b0[1]) };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ln = s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: INK, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': '0.1 16', visibility: 'hidden' }, m.lines);
    const n = Math.max(1, Math.ceil(len / 14));
    for (let i = 0; i <= n; i++) { const x = lerp(a.x, b.x, i / n), y = lerp(a.y, b.y, i / n); m.boxes.push({ x0: x - 6, y0: y - 6, x1: x + 6, y1: y + 6 }); }
    const act = anim(this, at, dur, ln, (k, lt, vis) => {
      const e = ease.out(k);
      ln.setAttribute('visibility', lt >= at ? 'visible' : 'hidden');
      ln.setAttribute('x2', f2(lerp(a.x, b.x, e))); ln.setAttribute('y2', f2(lerp(a.y, b.y, e)));
      ln.setAttribute('opacity', f2(vis));
    });
    return this.handle(act, ln);
  };

  // ── square-free, round-cornered boxes; no hatching
  const box0 = B.box;
  // the camera aims at the map as it is framed: P.push(t, PV.mx(c), PV.my(r), s) lands on that grid point after the kit
  // has scaled and centred the network (P.back is left alone)
  const cam0 = B.cam;
  B.cam = function (keys) {
    const m = M(this);
    for (const k of keys || []) {
      if (!k || typeof k.x !== 'number' || typeof k.y !== 'number' || (k.s === 1 && k.x === STAGE.w / 2 && k.y === STAGE.h / 2)) continue;
      const rx = k.x, ry = k.y;
      if (typeof k.s === 'number') k.s = Math.min(k.s, 1.15);
      Object.defineProperty(k, 'x', { enumerable: true, get: () => { if (!m.placed) layout(m); return rx * m.fit.s + m.fit.tx; } });
      Object.defineProperty(k, 'y', { enumerable: true, get: () => { if (!m.placed) layout(m); return ry * m.fit.s + m.fit.ty; } });
    }
    return cam0.call(this, keys);
  };
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 14, texture: false }, o)); };

  // ── the page title: a round badge with the page number in this page's line colour, then the title in heavy sans
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1;
    const idx = this.page.index;
    const c = lc(o.accent || AUTO[idx % 5]);
    const wrap = h('div', 'tx mt-tt', '<span class="no"></span><span class="t"></span>', T.html);
    const no = wrap.querySelector('.no'), t = wrap.querySelector('.t');
    no.textContent = String(idx + 1);
    no.style.background = c;
    t.textContent = str;
    const a = anim(T, at, 0.7, wrap, (k, lt, vis) => {
      wrap.style.opacity = f2((lt >= at ? 1 : 0) * vis);
      no.style.transform = `scale(${f2(Math.max(0, back(clamp(k * 2.2))))})`;
      t.style.clipPath = `inset(0 ${f2((1 - expo(clamp((k - 0.15) / 0.85))) * 100)}% 0 0)`;
    });
    return Object.assign(T.handle(a, wrap), { spans: [t], box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 14, w: wrap.offsetWidth, h: 60 }) });
  };
})();
