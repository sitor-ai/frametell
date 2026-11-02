/* Manga · kit: the pieces that make a frame read as a black-and-white Japanese comic page — panels cut by slanted white
 * gutters, G-pen ink that swells and tapers, screentone (dot tones, dot gradients, line tone) instead of grey,
 * concentration lines and speed lines, a manga character with big eyes and eight expressions, balloons with vertical
 * lettering, hand-lettered sound effects, the ゴゴゴ menace, a shadow boss for a shōnen showdown, and the realisation
 * splash. Written for Frametell Cloud; no third-party code.
 * Every component is a pure function of page-local time lt: no Math.random, Date or requestAnimationFrame; jitter is
 * hash-stepped. Any option marked "fn" may be a value, a function of lt, or a keyframe list [[t0, v0], [t1, v1], …]. */
(function () {
  const { s, h, col, clamp, lerp, ease, Builder, hashStr } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, SAFE_B = STAGE.area.y1 + 10, SA = STAGE.area;
  const TAU = Math.PI * 2;
  const f1 = (n) => (+n).toFixed(1);
  const f2 = (n) => (+n).toFixed(2);
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'number';
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  const hash = (i, j = 0) => { let x = Math.imul((i | 0) * 374761393 + (j | 0) * 668265263, 1274126177) >>> 0; x = Math.imul(x ^ (x >>> 13), 1103515245) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const outK = (lt, out, dur = 0.25) => (out == null ? 1 : 1 - clamp((lt - out) / dur));
  const INK = () => col('ink');
  const WHITE = '#FFFFFF';
  const isCJK = (str) => /[⺀-鿿豈-﫿＀-￯぀-ヿ]/.test(str);
  /** text width estimate (CJK 1 em, Latin caps 0.66, lower 0.55) */
  const tw = (str, size) => [...String(str)].reduce((a, ch) => a + (/[⺀-￯]/.test(ch) ? 1.0 : /[A-Z0-9#$%&@WM]/.test(ch) ? 0.68 : /[a-z]/.test(ch) ? 0.56 : /\s/.test(ch) ? 0.28 : 0.4), 0) * size;
  let uid = 0;
  const nid = (p) => `mg${p}${++uid}`;

  function defs(svg) { return svg.querySelector(':scope > defs') || s('defs', null, svg); }
  /** an absolutely placed box in the builder's html layer with its own svg (viewBox vb = [x, y, w, h] in its units) */
  function box(self, x, y, w, hh, vb, z) {
    const el = h('div', 'mg-node', null, self.html);
    Object.assign(el.style, { position: 'absolute', left: f1(x) + 'px', top: f1(y) + 'px', width: f1(w) + 'px', height: f1(hh) + 'px', opacity: 0 });
    if (z != null) el.style.zIndex = z;
    const v = vb || [0, 0, w, hh];
    const svg = s('svg', { width: f1(w), height: f1(hh), viewBox: v.map(f1).join(' '), style: 'position:absolute;left:0;top:0;overflow:visible' }, el);
    return { el, svg };
  }

  // ── tone (screentone) ────────────────────────────────────────────────────────────────────────────────────
  const TONES = { light: [9, 1.45], mid: [8, 2.15], dark: [7, 2.75], heavy: [6, 2.85] };
  /** a dot screentone pattern (45° lattice of black dots), aligned to the page so it never swims */
  function tonePat(svg, kind = 'mid', color) {
    const id = nid('t');
    if (kind === 'lines') {
      const p = s('pattern', { id, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs(svg));
      s('rect', { x: 0, y: 0, width: 1.7, height: 7, fill: col(color || 'ink') }, p);
      return `url(#${id})`;
    }
    const [pitch, r] = TONES[kind] || TONES.mid;
    const p = s('pattern', { id, width: pitch, height: pitch, patternUnits: 'userSpaceOnUse' }, defs(svg));
    for (const [x, y] of [[0, 0], [pitch, 0], [0, pitch], [pitch, pitch], [pitch / 2, pitch / 2]]) s('circle', { cx: x, cy: y, r, fill: col(color || 'ink') }, p);
    return `url(#${id})`;
  }
  PV.mgTone = tonePat;
  /** a dot gradient (dots grow along dir): path data. dir: 'down' (dark at the bottom) | 'up' | 'left' | 'right' | 'in' (dark at the centre) | 'out' (dark at the edges) */
  function gradDots(x, y, w, hh, dir = 'down', pitch = 11, rmax) {
    rmax = rmax ?? pitch * 0.62;
    let d = '';
    const rows = Math.ceil(hh / (pitch / 2)) + 1, cols = Math.ceil(w / pitch) + 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const cx = x + i * pitch + (j % 2 ? pitch / 2 : 0), cy = y + j * (pitch / 2);
      const u = (cx - x) / w, v = (cy - y) / hh;
      const k = dir === 'up' ? 1 - v : dir === 'left' ? 1 - u : dir === 'right' ? u : dir === 'in' ? 1 - Math.hypot(u - 0.5, v - 0.5) * 1.7 : dir === 'out' ? Math.hypot(u - 0.5, v - 0.5) * 1.9 - 0.25 : v;
      const rr = rmax * clamp(k) ** 1.1;
      if (rr > 0.7) d += `M${f1(cx - rr)} ${f1(cy)}a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(rr * 2)} 0a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(-rr * 2)} 0`;
    }
    return d;
  }

  // ── the G-pen line ─────────────────────────────────────────────────────────────────────────────────────────
  /** Catmull-Rom through pts, sampled */
  function spline(pts, seg = 8) {
    if (pts.length < 3) { const out = []; for (let i = 0; i <= seg; i++) out.push([lerp(pts[0][0], pts[1][0], i / seg), lerp(pts[0][1], pts[1][1], i / seg)]); return out; }
    const out = [], n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let k = 0; k < seg; k++) {
        const t = k / seg, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    out.push(pts[n - 1]);
    return out;
  }
  /** a pen stroke as a filled outline: thin where the nib lands, full in the middle, tapering to a point as it lifts.
   * o: { a: share of the length that swells in (0.3), b: share that tapers out (0.3), min: thinnest share (0.1) } */
  function pen(pts, w, o = {}) {
    const P = spline(pts, o.seg || 8), n = P.length;
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = len[n - 1] || 1, ta = o.a ?? 0.3, tb = o.b ?? 0.3, mn = o.min ?? 0.1;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const t = len[i] / tot;
      let k = 1;
      if (ta > 0 && t < ta) k = Math.min(k, (t / ta) ** 0.6);
      if (tb > 0 && t > 1 - tb) k = Math.min(k, ((1 - t) / tb) ** 0.6);
      const hw = (w * Math.max(mn, k)) / 2;
      L.push([P[i][0] - ty * hw, P[i][1] + tx * hw]); R.unshift([P[i][0] + ty * hw, P[i][1] - tx * hw]);
    }
    return 'M' + L.concat(R).map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z';
  }
  PV.mgPen = pen;
  const P_ = (parent, d, fill, extra) => s('path', Object.assign({ d, fill: fill || INK() }, extra || {}), parent);
  const strokeP = (parent, d, fill, sw = 5, extra) => s('path', Object.assign({ d, fill: fill || 'none', stroke: INK(), 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, extra || {}), parent);
  const poly = (pts) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z';
  /** a closed smooth outline through pts */
  function blob(pts, seg = 6) { const q = spline(pts.concat([pts[0], pts[1], pts[2]]), seg); const k = Math.floor(q.length * (pts.length) / (pts.length + 2)); return poly(q.slice(seg, k + seg)); }

  /** rectangle helper for a panel / the page */
  const rectOf = (self, o) => o.rect || (typeof self.area === "object" && self.area) || { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 };

  // ── page title ─────────────────────────────────────────────────────────────────────────────────────────────
  /** title(str, o): the page title as a manga chapter tab (top left, black with white lettering, a small white number box before it; stays put while the camera moves) — o: { no: the chapter number or label shown in the white box (default: the page number, e.g. '#03'; '' hides it), at, size (40) } */
  B.title = function (str, o = {}) {
    const T = this.hud || this;
    const at = o.at ?? 0.05;
    const el = h('div', 'mg-title', null, T.html);
    const pid = (this.page && this.page.id) || '';
    const no = o.no ?? (pid.match(/\d+/) ? '#' + pid.match(/\d+/)[0].padStart(2, '0') : '');
    if (no) h('div', 'no', String(no), el);
    const t = h('div', 't', null, el);
    t.textContent = String(str);
    if (o.size) t.style.fontSize = clamp(o.size, 28, 52) + 'px';
    el.style.opacity = 0;
    T.tick((lt) => {
      const k = ease.out(clamp((lt - at) / 0.22));
      el.style.opacity = f2(k > 0 ? 1 : 0);
      el.style.clipPath = `inset(0 ${f1((1 - k) * 100)}% 0 0)`;
    });
    return { el, a: { dur: 0.22 }, spans: [] };
  };

  // ── page grid ──────────────────────────────────────────────────────────────────────────────────────────────
  /** convex polygon inset by d on every edge */
  function inset(pts, d) {
    let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = area > 0 ? 1 : -1, n = pts.length, lines = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const nx = -dy * sg, ny = dx * sg;   // inward normal (y down, clockwise on screen when area > 0)
      lines.push([a[0] + nx * d, a[1] + ny * d, dx, dy]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1, dx1, dy1] = lines[(i - 1 + n) % n], [x2, y2, dx2, dy2] = lines[i];
      const den = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(den) < 1e-6) { out.push([x2, y2]); continue; }
      const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
      out.push([x1 + dx1 * t, y1 + dy1 * t]);
    }
    return out;
  }
  const LAYOUTS = {
    full: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    2: [[[0.55, 0], [1, 0], [1, 1], [0.45, 1]], [[0, 0], [0.55, 0], [0.45, 1], [0, 1]]],
    3: [[[0.69, 0], [1, 0], [1, 1], [0.64, 1]], [[0.36, 0], [0.69, 0], [0.64, 1], [0.31, 1]], [[0, 0], [0.36, 0], [0.31, 1], [0, 1]]],
    '1+2': [[[0.44, 0], [1, 0], [1, 1], [0.39, 1]], [[0, 0], [0.44, 0], [0.418, 0.44], [0, 0.54]], [[0, 0.54], [0.418, 0.44], [0.39, 1], [0, 1]]],
    '2+1': [[[0.58, 0], [1, 0], [1, 0.46], [0.6, 0.56]], [[0.6, 0.56], [1, 0.46], [1, 1], [0.62, 1]], [[0, 0], [0.58, 0], [0.62, 1], [0, 1]]],
    'top+2': [[[0, 0], [1, 0], [1, 0.38], [0, 0.47]], [[0.53, 0.425], [1, 0.38], [1, 1], [0.47, 1]], [[0, 0.47], [0.53, 0.425], [0.47, 1], [0, 1]]],
    '2x2': [[[0.52, 0], [1, 0], [1, 0.46], [0.505, 0.5]], [[0, 0], [0.52, 0], [0.505, 0.5], [0, 0.53]], [[0.505, 0.5], [1, 0.46], [1, 1], [0.48, 1]], [[0, 0.53], [0.505, 0.5], [0.48, 1], [0, 1]]],
    slash: [[[0.64, 0], [1, 0], [1, 1], [0.36, 1]], [[0, 0], [0.64, 0], [0.36, 1], [0, 1]]],
    strip: [[[0, 0], [1, 0], [1, 0.33], [0, 0.37]], [[0, 0.37], [1, 0.33], [1, 1], [0, 1]]],
  };
  /** grid(layout, o): the panels of a manga page tiling the whole content area (x 100–1820, y 160–885) with white gutters and slanted cuts — returns [{ x, y, w, h, cx, cy, pts }, …] in manga reading order (RIGHT to left, then top to bottom), ready for P.panel(R[i], …). layout: 'full' (one splash), '2' (two columns, slanted cut), '3', '1+2' (a big panel right, read first + two stacked left), '2+1' (two stacked right + a big panel left), 'top+2' (a wide strip on top + two below), '2x2', 'slash' (two halves split by a steep diagonal: a confrontation, before/after), 'strip' (a thin wide strip on top for an eye close-up + a big panel below). o: { x, y, w, h, gap (26) } to tile another area. */
  B.grid = function (layout = '2', o = {}) {
    const g = clamp(o.gap ?? 26, 10, 60);
    const X = (o.x ?? SA.x0 - 40) - g / 2, Y = (o.y ?? SA.y0 - 20) - g / 2, Wd = (o.w ?? SA.x1 - SA.x0 + 80) + g, Hd = (o.h ?? SA.y1 - SA.y0 + 25) + g;
    const L = LAYOUTS[layout] || LAYOUTS[2];
    return L.map((q) => {
      const pts = inset(q.map(([u, v]) => [X + u * Wd, Y + v * Hd]), g / 2).map((p) => [Math.round(p[0]), Math.round(p[1])]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, hh = Math.max(...ys) - y;
      return { x, y, w, h: hh, cx: Math.round(x + w / 2), cy: Math.round(y + hh / 2), pts };
    });
  };

  // ── panels ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** panel(r, o): a manga panel — a white (or toned) ground inside a black ink border, cut in on its cue. r is a rectangle from P.grid (or call panel(x, y, w, h, o)). RETURNS A LAYER: draw the panel's contents on it (const A = P.panel(R[0], { at }); A.chara(…); A.focus(…)); everything on it is clipped to the panel and A.area = { x, y, w, h, cx, cy } is its box. To break the frame (a head or a sound effect over the border), draw that one thing on P instead. o: { at, tone: 'white' (default) | 'light' | 'mid' | 'dark' (dot tones) | 'black' (a black panel: flashback, darkness, a monster) | 'fade' (a dot gradient darkening downward) | 'lines' (line tone) | 'focus' (concentration lines on the centre) | 'speed' (horizontal speed lines), from: 'cut' (default, appears at once) | 'left' | 'right' | 'top' | 'slam' (zooms down onto the page: the dramatic one), sw: border width (5), out } */
  B.panel = function (r, o, ...more) {
    let pts;
    if (r && typeof r === 'object') { o = o || {}; pts = r.pts || [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]; }
    else { const [x, y, w, hh] = [r, o, more[0], more[1]]; o = more[2] || {}; pts = [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]; }
    pts = pts.map(([px, py]) => [clamp(px, 0, W), clamp(py, 0, H)]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const R = { x: Math.min(...xs), y: Math.min(...ys) }; R.w = Math.max(...xs) - R.x; R.h = Math.max(...ys) - R.y; R.cx = R.x + R.w / 2; R.cy = R.y + R.h / 2; R.pts = pts;
    const at = o.at ?? 0, sw = o.sw ?? 5, from = o.from || 'cut', tone = o.tone || 'white';
    const d = poly(pts);
    // the page's layout pencilled in before the panel is inked: an unread panel shows as a faint frame, never bare paper
    s('path', { d, fill: 'none', stroke: '#C9C9C6', 'stroke-width': 3, 'stroke-linejoin': 'miter' }, this.svg);
    const back = this.layer(), L = this.layer(), front = this.layer();
    s('path', { d, fill: tone === 'black' ? INK() : WHITE }, back.svg);
    if (['light', 'mid', 'dark', 'lines'].includes(tone)) s('path', { d, fill: tonePat(back.svg, tone) }, back.svg);
    if (tone === 'fade') { const cid = nid('c'); s('path', { d }, s('clipPath', { id: cid }, defs(back.svg))); s('path', { d: gradDots(R.x, R.y, R.w, R.h, 'down', 11), fill: INK(), 'clip-path': `url(#${cid})` }, back.svg); }
    const clip = `polygon(${pts.map((p) => `${f1(p[0])}px ${f1(p[1])}px`).join(', ')})`;
    back.wrap.style.clipPath = clip; L.wrap.style.clipPath = clip;
    s('path', { d, fill: 'none', stroke: INK(), 'stroke-width': sw, 'stroke-linejoin': 'miter' }, front.svg);
    L.area = R;
    if (tone === 'focus') back.focus(R.cx, R.cy, { rect: R, at, r0: Math.min(R.w, R.h) * 0.3 });
    if (tone === 'speed') back.speedlines({ rect: R, at });
    const wraps = [back.wrap, L.wrap, front.wrap];
    for (const el of wraps) el.style.transformOrigin = `${f1(R.cx)}px ${f1(R.cy)}px`;
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / (from === 'cut' ? 0.12 : 0.3))), vis = (lt >= at ? 1 : 0) * outK(lt, o.out);
      const dd = (1 - k) * 90;
      const tr = from === 'slam' ? `scale(${f2(lerp(1.18, 1, k))})` : from === 'cut' ? `scale(${f2(lerp(1.025, 1, k))})`
        : `translate(${f1(from === 'left' ? -dd : from === 'right' ? dd : 0)}px, ${f1(from === 'top' ? -dd : 0)}px)`;
      for (const el of wraps) { el.style.opacity = f2(vis * clamp(k * 2.2)); el.style.transform = tr; }
    });
    return L;
  };

  // ── tone fields ────────────────────────────────────────────────────────────────────────────────────────────
  /** tone(x, y, w, h, o): a patch of screentone — the manga's only grey. Shadows, skies, a mood behind a character, a darkened half of a panel. o: { kind: 'light' | 'mid' | 'dark' | 'lines' | 'fade' (dot gradient), dir: for 'fade': 'down' | 'up' | 'left' | 'right' | 'in' | 'out', d: an SVG path to fill instead of the rectangle, at, out } */
  B.tone = function (x, y, w, hh, o = {}) {
    const g = s('g', { opacity: 0 }, this.svg);
    const kind = o.kind || 'mid';
    if (kind === 'fade') {
      const cid = nid('c'); s(o.d ? 'path' : 'rect', o.d ? { d: o.d } : { x, y, width: w, height: hh }, s('clipPath', { id: cid }, defs(this.svg)));
      s('path', { d: gradDots(x, y, w, hh, o.dir || 'down', 11), fill: INK(), 'clip-path': `url(#${cid})` }, g);
    } else if (o.d) s('path', { d: o.d, fill: tonePat(this.svg, kind) }, g);
    else s('rect', { x, y, width: w, height: hh, fill: tonePat(this.svg, kind) }, g);
    const at = o.at ?? 0;
    this.tick((lt) => g.setAttribute('opacity', f2((lt >= at ? clamp((lt - at) / 0.15) : 0) * outK(lt, o.out))));
    return { g };
  };

  // ── concentration lines (集中線) and speed lines ──────────────────────────────────────────────────────────
  /** focus(cx, cy, o): concentration lines (集中線) — hundreds of tapered ink strokes rushing in from the panel edge toward (cx, cy), leaving a clear centre: the realisation, the shock, the reveal. Inside a panel layer they fill that panel; on P they fill the frame. They flicker (redrawn 8 times a second). o: { r0: clear radius around the centre (0.3 × the panel's short side), n: number of lines (150), color: 'ink' | 'paper' (white lines on a black panel), at, dur (how long they stay; default to the page end), out } */
  B.focus = function (cx, cy, o = {}) {
    const R = rectOf(this, o);
    const g = s('g', { opacity: 0 }, this.svg);
    const n = clamp(o.n ?? 150, 40, 260), r0 = clamp(o.r0 ?? Math.min(R.w, R.h) * 0.3, 60, 700), seed = (cx * 7 + cy * 3) | 0;
    const rOut = Math.hypot(Math.max(cx - R.x, R.x + R.w - cx), Math.max(cy - R.y, R.y + R.h - cy)) + 40;
    const path = s('path', { fill: col(o.color || 'ink') }, g);
    const at = o.at ?? 0, end = o.dur != null ? at + o.dur : null;
    let last = -1;
    this.tick((lt) => {
      const vis = lt >= at && (end == null || lt < end) ? 1 : 0;
      g.setAttribute('opacity', f2(vis * clamp((lt - at) / 0.08) * outK(lt, o.out)));
      if (!vis) return;
      const st = Math.floor(lt * 8);
      if (st === last) return; last = st;
      let d = '';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + hash(i, seed) * 0.04, w = 0.0025 + hash(i, seed + 2) ** 2 * 0.011;
        const rin = r0 * (0.9 + hash(i, st * 13 + seed) * 0.75 + (i % 7 === 0 ? 0.5 : 0));
        d += `M${f1(cx + Math.cos(a - w) * rOut)} ${f1(cy + Math.sin(a - w) * rOut)}L${f1(cx + Math.cos(a) * rin)} ${f1(cy + Math.sin(a) * rin)}L${f1(cx + Math.cos(a + w) * rOut)} ${f1(cy + Math.sin(a + w) * rOut)}Z`;
      }
      path.setAttribute('d', d);
    });
    return { g };
  };

  /** speedlines(o): speed lines (流線) — long thin tapered strokes streaming across the panel at one angle, sliding as they flicker: a dash, a fall, time rushing, a character charging in. Inside a panel layer they fill that panel. o: { angle: degrees (0 = horizontal, 90 = vertical; default 0), n (70), color ('ink'), at, dur, out } */
  B.speedlines = function (o = {}) {
    const R = rectOf(this, o);
    const g = s('g', { opacity: 0 }, this.svg);
    const n = clamp(o.n ?? 70, 20, 160), ang = ((o.angle ?? 0) * Math.PI) / 180, ux = Math.cos(ang), uy = Math.sin(ang), seed = (R.x + R.y * 3) | 0;
    const span = Math.hypot(R.w, R.h), cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const path = s('path', { fill: col(o.color || 'ink') }, g);
    const at = o.at ?? 0, end = o.dur != null ? at + o.dur : null;
    let last = -1;
    this.tick((lt) => {
      const vis = lt >= at && (end == null || lt < end) ? 1 : 0;
      g.setAttribute('opacity', f2(vis * clamp((lt - at) / 0.08) * outK(lt, o.out)));
      if (!vis) return;
      const st = Math.floor(lt * 12);
      if (st === last) return; last = st;
      let d = '';
      for (let i = 0; i < n; i++) {
        const off = (hash(i, seed) - 0.5) * span, len = span * (0.25 + hash(i, seed + 1) * 0.5), th = 1.5 + hash(i, seed + 2) ** 2 * 9;
        const along = (((hash(i, seed + 3) + st * 0.045 * (0.6 + hash(i, seed + 4))) % 1) - 0.5) * span * 1.4;
        const mx = cx + ux * along - uy * off, my = cy + uy * along + ux * off;
        const ax = mx - ux * len / 2, ay = my - uy * len / 2, bx = mx + ux * len / 2, by = my + uy * len / 2;
        d += `M${f1(ax)} ${f1(ay)}L${f1(mx - uy * th / 2)} ${f1(my + ux * th / 2)}L${f1(bx)} ${f1(by)}L${f1(mx + uy * th / 2)} ${f1(my - ux * th / 2)}Z`;
      }
      path.setAttribute('d', d);
    });
    return { g };
  };

  // ── the manga character ────────────────────────────────────────────────────────────────────────────────────
  // unit space: face centre (0, 0) between the eyes; hair top y ≈ -200, bust cut at y = 340
  const MOODS = ['calm', 'happy', 'shock', 'determined', 'despair', 'smug', 'crying', 'angry'];
  const BLINKS = { calm: 1, determined: 1, smug: 1, angry: 1, happy: 0 };
  const FACE = 'M-110 -70 C-112 -10 -106 40 -92 70 C-76 104 -40 136 0 150 C40 136 76 104 92 70 C106 40 112 -10 110 -70 C100 -150 -100 -150 -110 -70 Z';
  function hairShapes(style) {
    if (style === 'bob' || style === 'long') {
      const back = style === 'long'
        ? 'M-146 300 C-176 120 -168 -60 -150 -120 C-120 -200 120 -200 150 -120 C168 -60 176 120 146 300 L110 296 L104 120 L-104 120 L-110 296 Z'
        : 'M-142 96 C-160 -60 -118 -196 0 -196 C118 -196 160 -60 142 96 L118 86 L106 104 L84 80 L-84 80 L-106 104 L-118 86 Z';
      const bangs = 'M-122 -56 C-130 -150 -64 -180 0 -180 C64 -180 130 -150 122 -56 L106 -34 L94 -60 L72 -36 L50 -62 L26 -40 L2 -64 L-22 -40 L-46 -62 L-70 -38 L-92 -60 L-108 -34 Z';
      const lockL = style === 'long' ? 'M-116 -60 C-128 20 -124 120 -108 210 L-92 150 L-84 196 C-92 100 -94 0 -90 -56 Z' : 'M-114 -60 C-124 0 -118 60 -102 116 L-90 80 L-82 100 C-90 40 -92 -20 -88 -56 Z';
      const lockR = lockL.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, a, b) => `${-a} ${b}`);
      const strands = [[[-60, -170], [-80, -120], [-86, -70]], [[-10, -176], [-14, -120], [-12, -72]], [[44, -172], [56, -120], [60, -70]], [[96, -150], [104, -100], [100, -64]]];
      return { back, bangs, locks: [lockL, lockR], strands, shine: [[-92, -128], [-48, -150], [0, -156], [48, -150], [92, -128]] };
    }
    if (style === 'neat') {
      const back = 'M-124 10 C-140 -70 -118 -178 0 -184 C118 -178 140 -70 124 10 L112 -10 L106 20 L96 -30 L-96 -30 L-106 20 L-112 -10 Z';
      const bangs = 'M-120 -40 C-128 -130 -76 -172 -20 -172 C62 -174 126 -136 124 -50 L112 -24 C104 -76 64 -104 14 -102 C-18 -100 -46 -90 -64 -72 L-80 -98 L-92 -60 L-104 -82 L-110 -30 Z';
      const strands = [[[-20, -168], [30, -140], [80, -96], [104, -56]], [[-40, -160], [10, -126], [56, -104]], [[-70, -150], [-80, -120], [-88, -86]]];
      return { back, bangs, locks: [], strands, shine: [[-70, -140], [-30, -158], [20, -156], [64, -140]] };
    }
    // spiky (shōnen)
    const back = poly([[-120, 40], [-156, -6], [-128, -40], [-182, -86], [-140, -112], [-172, -172], [-110, -162], [-120, -236], [-62, -186], [-24, -262], [18, -192], [78, -248], [94, -178], [166, -198], [134, -132], [186, -96], [138, -62], [168, -10], [122, -18], [120, 40]]);
    const bangs = poly([[-128, -112], [-114, -26], [-92, -82], [-70, -10], [-50, -86], [-22, -28], [-4, -92], [22, -18], [40, -90], [64, -30], [80, -84], [110, -38], [118, -92], [128, -112], [60, -156], [0, -164], [-62, -156]]);
    const strands = [[[-96, -140], [-100, -90]], [[-60, -150], [-66, -90]], [[-12, -156], [-12, -100]], [[34, -152], [38, -96]], [[80, -144], [96, -96]]];
    return { back, bangs, locks: [], strands, shine: [[-100, -128], [-60, -148], [-14, -156], [34, -152], [80, -140], [112, -118]] };
  }
  /** draws a character into svg group g (unit space); returns the per-mood groups and the shared ones */
  function drawChara(svg, g, o) {
    const ink = INK();
    const hairStyle = ['spiky', 'bob', 'neat', 'long'].includes(o.hair) ? o.hair : 'spiky';
    const hairTone = ['black', 'tone', 'white'].includes(o.hairTone) ? o.hairTone : (hairStyle === 'neat' ? 'tone' : 'black');
    const outfit = ['school', 'sailor', 'suit', 'tee'].includes(o.outfit) ? o.outfit : 'school';
    const mid = tonePat(svg, 'mid'), light = tonePat(svg, 'light'), dark = tonePat(svg, 'dark');
    const hairFill = hairTone === 'black' ? ink : WHITE;
    const H_ = hairShapes(hairStyle);
    const hairPath = (d, parent) => { s('path', { d, fill: hairFill, stroke: ink, 'stroke-width': 6, 'stroke-linejoin': 'round' }, parent); if (hairTone === 'tone') s('path', { d, fill: mid }, parent); };
    // back hair
    hairPath(H_.back, g);
    // body
    const body = 'M-42 172 C-84 200 -168 206 -206 256 C-222 290 -232 360 -236 470 L236 470 C232 360 222 290 206 256 C168 206 84 200 42 172 Z';
    if (outfit === 'school') {
      s('path', { d: body, fill: ink, stroke: ink, 'stroke-width': 6 }, g);
      P_(g, pen([[-190, 262], [-140, 226], [-80, 210]], 7, { a: 0.4, b: 0.5 }), WHITE);
      P_(g, pen([[190, 262], [140, 226], [80, 210]], 7, { a: 0.4, b: 0.5 }), WHITE);
      s('path', { d: 'M-52 168 L-56 222 Q0 240 56 222 L52 168 Z', fill: ink, stroke: WHITE, 'stroke-width': 3 }, g);
      s('path', { d: 'M0 236 L0 470', stroke: WHITE, 'stroke-width': 3 }, g);
      for (const yy of [262, 318]) s('circle', { cx: 0, cy: yy, r: 9, fill: WHITE, stroke: ink, 'stroke-width': 3 }, g);
    } else if (outfit === 'sailor') {
      strokeP(g, body, WHITE, 6);
      s('path', { d: 'M-46 176 C-110 196 -170 214 -190 250 L-120 236 L0 330 L120 236 L190 250 C170 214 110 196 46 176 L0 250 Z', fill: ink, stroke: ink, 'stroke-width': 5, 'stroke-linejoin': 'round' }, g);
      strokeP(g, 'M-166 246 L-116 238 L0 318 L116 238 L166 246', null, 3, { stroke: WHITE });
      s('path', { d: 'M-30 300 L0 286 L30 300 L52 344 L22 330 L0 312 L-22 330 L-52 344 Z', fill: WHITE, stroke: ink, 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
      s('path', { d: 'M-30 300 L0 286 L30 300 L52 344 L22 330 L0 312 L-22 330 L-52 344 Z', fill: mid }, g);
      s('path', { d: 'M120 236 L190 250 C218 290 228 360 232 470 L120 470 Z', fill: light }, g);
    } else if (outfit === 'suit') {
      s('path', { d: body, fill: WHITE, stroke: ink, 'stroke-width': 6 }, g);
      s('path', { d: body, fill: dark }, g);
      s('path', { d: 'M-42 176 L0 300 L42 176 Z', fill: WHITE, stroke: ink, 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
      s('path', { d: 'M-12 196 L12 196 L18 296 L0 322 L-18 296 Z', fill: ink }, g);
      strokeP(g, 'M-44 176 L-70 240 L-40 250 L0 300 M44 176 L70 240 L40 250 L0 300', null, 4);
    } else {
      strokeP(g, body, WHITE, 6);
      strokeP(g, 'M-46 178 Q0 214 46 178', null, 4);
      s('path', { d: 'M60 200 C120 210 190 230 210 270 L232 470 L110 470 Z', fill: light }, g);
      P_(g, pen([[-170, 300], [-160, 270], [-150, 250]], 4), ink);
    }
    // neck and the shadow under the chin
    s('path', { d: 'M-42 110 L-44 196 Q0 214 44 196 L42 110 Z', fill: WHITE }, g);
    s('path', { d: 'M-42 118 Q0 176 42 118 L44 168 Q0 192 -44 168 Z', fill: light }, g);
    P_(g, pen([[-40, 118], [-42, 160], [-46, 196]], 5, { a: 0.1, b: 0.4 }));
    P_(g, pen([[40, 118], [42, 160], [46, 196]], 5, { a: 0.1, b: 0.4 }));
    // ears and face
    for (const sx of [-1, 1]) { s('path', { d: `M${sx * 104} -18 C${sx * 130} -30 ${sx * 136} 10 ${sx * 120} 34 C${sx * 112} 44 ${sx * 102} 42 ${sx * 98} 36 Z`, fill: WHITE, stroke: ink, 'stroke-width': 4.5, 'stroke-linejoin': 'round' }, g); P_(g, pen([[sx * 118, -6], [sx * 112, 14], [sx * 116, 26]], 3)); }
    s('path', { d: FACE, fill: WHITE }, g);
    P_(g, pen([[-112, -86], [-110, -10], [-100, 52], [-80, 96], [-42, 134], [0, 150]], 6.5, { a: 0.15, b: 0.02, min: 0.5 }));
    P_(g, pen([[112, -86], [110, -10], [100, 52], [80, 96], [42, 134], [0, 150]], 6.5, { a: 0.15, b: 0.02, min: 0.5 }));
    const faceClip = nid('f'); s('path', { d: FACE }, s('clipPath', { id: faceClip }, defs(svg)));
    // slots in z order; each mood puts a group in each slot
    const slot = {}; for (const k of ['gloom', 'eyes', 'nose', 'mouth', 'bangs', 'brows', 'over']) slot[k] = s('g', null, g);
    // nose
    P_(slot.nose, pen([[8, 46], [0, 64], [8, 68]], 4.5, { a: 0.2, b: 0.4 }));
    // bangs + locks + strands + shine
    hairPath(H_.bangs, slot.bangs);
    for (const d of H_.locks) hairPath(d, slot.bangs);
    const strandC = hairTone === 'black' ? WHITE : ink;
    for (const st of H_.strands) P_(slot.bangs, pen(st, hairTone === 'black' ? 3 : 3.5, { a: 0.2, b: 0.6 }), strandC, hairTone === 'black' ? { opacity: 0.5 } : null);
    if (hairTone !== 'white') for (let i = 0; i < H_.shine.length; i++) { const [x0, y0] = H_.shine[i]; P_(slot.bangs, pen([[x0 - 6, y0 - 8], [x0, y0 + 6], [x0 + 6, y0 + 26]], 9, { a: 0.4, b: 0.5 }), WHITE); }
    // ── eyes, brows, mouths per mood
    const M = {};
    const sub = (k, m) => s('g', { style: 'display:none' }, slot[k]);
    const irisList = [];
    const eye = (pg, sx, m) => {
      const open = m === 'shock' ? 1.3 : m === 'determined' ? 0.72 : m === 'angry' ? 0.66 : m === 'smug' ? 0.62 : m === 'crying' ? 1.1 : 1;
      const I = [sx * 20, 2], O = [sx * 92, -6];
      const top = (k) => [sx * lerp(20, 92, k), -Math.sin(Math.PI * Math.min(1, k * 1.08)) * 34 * open - 2 + k * 4];
      const white = `M${I[0]} ${I[1]} C${sx * 30} ${-30 * open} ${sx * 74} ${-38 * open} ${O[0]} ${O[1]} C${sx * 84} 24 ${sx * 38} 30 ${I[0]} ${I[1]} Z`;
      s('path', { d: white, fill: WHITE }, pg);
      const cid = nid('e'); s('path', { d: white }, s('clipPath', { id: cid }, defs(svg)));
      const ig = s('g', { 'clip-path': `url(#${cid})` }, pg);
      const ir = s('g', null, ig); irisList.push(ir);
      const icx = sx * 54, icy = 4;
      if (m === 'shock' || m === 'despair') {
        s('circle', { cx: icx, cy: icy, r: m === 'shock' ? 7 : 4.5, fill: ink }, ir);
        if (m === 'shock') s('circle', { cx: icx, cy: icy, r: 15, fill: 'none', stroke: ink, 'stroke-width': 2.5 }, ir);
      } else {
        const rx = m === 'angry' ? 18 : 25, ry = m === 'angry' ? 22 : 31;
        s('ellipse', { cx: icx, cy: icy, rx, ry, fill: WHITE, stroke: ink, 'stroke-width': 4 }, ir);
        s('ellipse', { cx: icx, cy: icy, rx, ry, fill: dark }, ir);
        s('path', { d: `M${icx - rx} ${icy} A${rx} ${ry} 0 0 1 ${icx + rx} ${icy} Q${icx} ${icy - ry * 0.25} ${icx - rx} ${icy} Z`, fill: ink }, ir);
        s('ellipse', { cx: icx, cy: icy + 2, rx: rx * 0.44, ry: ry * 0.48, fill: ink }, ir);
        s('ellipse', { cx: icx - rx * 0.36, cy: icy - ry * 0.4, rx: rx * 0.34, ry: ry * 0.3, fill: WHITE, transform: `rotate(-20 ${icx - rx * 0.36} ${icy - ry * 0.4})` }, ir);
        s('circle', { cx: icx + rx * 0.38, cy: icy + ry * 0.42, r: rx * 0.16, fill: WHITE }, ir);
        if (m === 'crying' || m === 'happy') { s('circle', { cx: icx - rx * 0.1, cy: icy + ry * 0.5, r: rx * 0.12, fill: WHITE }, ir); s('circle', { cx: icx + rx * 0.45, cy: icy - ry * 0.1, r: rx * 0.1, fill: WHITE }, ir); }
        if (m === 'crying') strokeP(ir, `M${icx - rx} ${icy + ry * 0.62} Q${icx - rx * 0.4} ${icy + ry * 0.5} ${icx} ${icy + ry * 0.66} T${icx + rx} ${icy + ry * 0.6}`, null, 3, { stroke: WHITE });
      }
      if (m === 'smug') s('path', { d: `M${sx * 14} -40 L${sx * 100} -40 L${sx * 100} ${-30 * open + 10} L${sx * 14} ${-30 * open + 10} Z`, fill: WHITE }, ig);
      // upper lash line: thin at the inner corner, heavy over the eye, flicking out at the outer corner
      const lash = [I, top(0.2), top(0.5), top(0.8), O, [sx * 104, 4]];
      if (m === 'smug') { for (const p of lash) p[1] = Math.max(p[1], -12 + Math.abs(p[0]) * 0.02); }
      P_(pg, pen(lash, m === 'determined' || m === 'angry' ? 13 : 11, { a: 0.45, b: 0.12, min: 0.2 }));
      if (m !== 'angry' && m !== 'determined') { P_(pg, pen([[sx * 84, -14], [sx * 98, -24], [sx * 108, -26]], 5, { a: 0.1, b: 0.7 })); P_(pg, pen([[sx * 90, -4], [sx * 104, -8], [sx * 112, -6]], 4, { a: 0.1, b: 0.7 })); }
      P_(pg, pen([[sx * 50, 26], [sx * 70, 24], [sx * 84, 14]], 3.5, { a: 0.3, b: 0.5 }));
      if (m === 'crying') { P_(pg, pen([[sx * 30, 30], [sx * 56, 34], [sx * 82, 22]], 4), WHITE); strokeP(pg, `M${sx * 30} 32 Q${sx * 56} 40 ${sx * 84} 24`, null, 2.5); }
    };
    const brow = (pg, sx, yin, yout, w = 7) => P_(pg, pen([[sx * 26, yin], [sx * 56, (yin + yout) / 2 - 7], [sx * 90, yout]], w, { a: 0.25, b: 0.55 }));
    const blinkG = s('g', { style: 'display:none' }, slot.eyes);
    for (const sx of [-1, 1]) P_(blinkG, pen([[sx * 20, 4], [sx * 56, 12], [sx * 96, 0]], 9, { a: 0.3, b: 0.3 }));
    const talkG = s('g', { style: 'display:none' }, slot.mouth);
    s('path', { d: 'M-16 96 Q0 90 16 96 Q12 116 0 117 Q-12 116 -16 96 Z', fill: ink }, talkG);
    for (const m of MOODS) {
      const G = M[m] = { eyes: sub('eyes', m), brows: sub('brows', m), mouth: sub('mouth', m), gloom: sub('gloom', m), over: sub('over', m) };
      // eyes
      if (m === 'happy') for (const sx of [-1, 1]) P_(G.eyes, pen([[sx * 24, 10], [sx * 56, -18], [sx * 90, 8]], 10, { a: 0.3, b: 0.3 }));
      else for (const sx of [-1, 1]) eye(G.eyes, sx, m);
      // brows
      if (m === 'determined' || m === 'angry') for (const sx of [-1, 1]) brow(G.brows, sx, m === 'angry' ? -28 : -34, -66, 9);
      else if (m === 'despair' || m === 'crying') for (const sx of [-1, 1]) brow(G.brows, sx, -70, -46);
      else if (m === 'shock') for (const sx of [-1, 1]) brow(G.brows, sx, -76, -72);
      else if (m === 'smug') { brow(G.brows, -1, -50, -54); brow(G.brows, 1, -64, -76); }
      else for (const sx of [-1, 1]) brow(G.brows, sx, -54, -58);
      // mouths
      if (m === 'calm') P_(G.mouth, pen([[-16, 100], [0, 103], [16, 99]], 4.5));
      else if (m === 'happy') { s('path', { d: 'M-32 92 Q0 100 32 92 Q24 132 0 134 Q-24 132 -32 92 Z', fill: ink }, G.mouth); s('ellipse', { cx: 0, cy: 124, rx: 14, ry: 7, fill: WHITE }, G.mouth); s('ellipse', { cx: 0, cy: 124, rx: 14, ry: 7, fill: mid }, G.mouth); }
      else if (m === 'shock') { s('ellipse', { cx: 0, cy: 114, rx: 15, ry: 24, fill: ink }, G.mouth); s('ellipse', { cx: 0, cy: 122, rx: 8, ry: 10, fill: dark }, G.mouth); }
      else if (m === 'determined') { P_(G.mouth, pen([[-28, 106], [-10, 100], [10, 100], [28, 106]], 6, { a: 0.2, b: 0.2 })); P_(G.mouth, pen([[-8, 118], [8, 118]], 3)); }
      else if (m === 'despair') P_(G.mouth, pen([[-30, 110], [-20, 100], [-10, 110], [0, 100], [10, 110], [20, 100], [30, 108]], 4.5, { a: 0.1, b: 0.1, min: 0.5 }));
      else if (m === 'smug') { P_(G.mouth, pen([[-22, 104], [2, 108], [24, 98], [32, 88]], 5.5, { a: 0.2, b: 0.4 })); P_(G.mouth, pen([[36, 84], [40, 94]], 3)); }
      else if (m === 'crying') s('path', { d: 'M-28 106 Q-14 92 0 100 Q14 92 28 106 Q14 128 0 124 Q-14 128 -28 106 Z', fill: ink }, G.mouth);
      else if (m === 'angry') { s('path', { d: 'M-34 96 L34 96 L30 122 L-30 122 Z', fill: WHITE, stroke: ink, 'stroke-width': 4.5, 'stroke-linejoin': 'round' }, G.mouth); strokeP(G.mouth, 'M-32 109 L32 109 M-16 96 L-16 122 M0 96 L0 122 M16 96 L16 122', null, 2.5); }
      // gloom (despair): a dark tone over the upper face with vertical lines
      if (m === 'despair') {
        const gg = s('g', { 'clip-path': `url(#${faceClip})` }, G.gloom);
        s('rect', { x: -130, y: -140, width: 260, height: 150, fill: dark }, gg);
        s('path', { d: gradDots(-130, 0, 260, 60, 'up', 7, 3), fill: ink }, gg);
        for (let i = 0; i < 16; i++) { const x = -96 + i * 13; P_(gg, pen([[x, -130], [x, -40 + hash(i, 3) * 60]], 3.5, { a: 0, b: 0.6 })); }
      }
      // cheeks and extras
      if (m === 'happy' || m === 'crying' || m === 'smug') for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) P_(G.over, pen([[sx * (50 + i * 11), 52], [sx * (42 + i * 11), 66]], 3, { a: 0.3, b: 0.3 }));
      if (m === 'crying') for (const sx of [-1, 1]) {
        const d = `M${sx * 62} 28 C${sx * 70} 70 ${sx * 60} 110 ${sx * 72} 160 L${sx * 92} 160 C${sx * 82} 110 ${sx * 92} 70 ${sx * 84} 26 Z`;
        s('path', { d, fill: WHITE, stroke: ink, 'stroke-width': 3.5, 'stroke-linejoin': 'round' }, G.over);
        strokeP(G.over, `M${sx * 74} 50 C${sx * 78} 80 ${sx * 72} 110 ${sx * 80} 140`, null, 2);
      }
      if (m === 'shock') { drawEmote(G.over, 'sweat', 128, -96, 1); drawEmote(G.over, 'gasp', 0, -40, 1); }
      if (m === 'angry') drawEmote(G.over, 'anger', 78, -128, 0.9);
      if (m === 'despair') drawEmote(G.over, 'sweat', 126, -70, 0.8);
    }
    // glasses
    if (o.glasses) {
      const gl = s('g', null, slot.over);
      for (const sx of [-1, 1]) {
        const x0 = sx > 0 ? 16 : -100;
        s('rect', { x: x0, y: -42, width: 84, height: 70, rx: 16, fill: o.glasses === 'glint' ? WHITE : 'none', stroke: ink, 'stroke-width': 5 }, gl);
        P_(gl, pen([[x0 + 54, -34], [x0 + 30, 16]], 6, { a: 0.3, b: 0.3 }), o.glasses === 'glint' ? ink : WHITE);
        if (o.glasses === 'glint') s('rect', { x: x0 + 4, y: -6, width: 76, height: 30, fill: tonePat(svg, 'light') }, gl);
      }
      strokeP(gl, 'M-16 -14 Q0 -22 16 -14', null, 4.5);
    }
    return { M, blinkG, talkG, irisList, slotOver: slot.over };
  }

  // ── emotes (manga symbols) ─────────────────────────────────────────────────────────────────────────────────
  function drawEmote(parent, kind, x, y, k = 1) {
    const g = s('g', { transform: `translate(${f1(x)} ${f1(y)}) scale(${f2(k)})` }, parent);
    const ink = INK();
    if (kind === 'sweat') {
      s('path', { d: 'M0 -44 C14 -16 28 4 28 20 C28 38 14 48 0 48 C-14 48 -28 38 -28 20 C-28 4 -14 -16 0 -44 Z', fill: WHITE, stroke: ink, 'stroke-width': 4.5, 'stroke-linejoin': 'round' }, g);
      P_(g, pen([[-14, 16], [-12, 30], [-4, 38]], 5), ink);
    } else if (kind === 'anger') {
      for (const [r, sx, sy] of [[0, 1, 1], [90, 1, 1], [180, 1, 1], [270, 1, 1]]) P_(g, pen([[8, -34], [10, -12], [32, -10]], 9, { a: 0.3, b: 0.3, min: 0.4 }), ink, { transform: `rotate(${r})` });
    } else if (kind === 'sparkle') {
      for (const [dx, dy, r] of [[0, 0, 40], [46, 34, 20], [-38, 40, 14]]) s('path', { d: `M${dx} ${dy - r} Q${dx + r * 0.12} ${dy - r * 0.12} ${dx + r} ${dy} Q${dx + r * 0.12} ${dy + r * 0.12} ${dx} ${dy + r} Q${dx - r * 0.12} ${dy + r * 0.12} ${dx - r} ${dy} Q${dx - r * 0.12} ${dy - r * 0.12} ${dx} ${dy - r} Z`, fill: WHITE, stroke: ink, 'stroke-width': 3.5 }, g);
    } else if (kind === 'exclaim') {
      s('path', { d: 'M-14 -70 L14 -70 L8 10 L-8 10 Z', fill: ink }, g); s('circle', { cx: 0, cy: 34, r: 11, fill: ink }, g);
      for (const a of [-0.9, -0.45, 0.45, 0.9]) P_(g, pen([[Math.sin(a) * 60, -Math.cos(a) * 60 - 10], [Math.sin(a) * 90, -Math.cos(a) * 90 - 10]], 6), ink);
    } else if (kind === 'question') {
      strokeP(g, 'M-22 -40 C-22 -72 26 -76 26 -44 C26 -20 0 -18 0 6', null, 12);
      s('circle', { cx: 0, cy: 32, r: 9, fill: ink }, g);
    } else if (kind === 'heart') {
      s('path', { d: 'M0 34 C-50 0 -46 -40 -20 -40 C-8 -40 0 -30 0 -22 C0 -30 8 -40 20 -40 C46 -40 50 0 0 34 Z', fill: WHITE, stroke: ink, 'stroke-width': 5 }, g);
      s('path', { d: 'M0 34 C-50 0 -46 -40 -20 -40 C-8 -40 0 -30 0 -22 C0 -30 8 -40 20 -40 C46 -40 50 0 0 34 Z', fill: tonePat(parent.ownerSVGElement || parent, 'mid') }, g);
    } else if (kind === 'gasp') {
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) P_(g, pen([[sx * (150 + i * 4), -120 + i * 36], [sx * (184 + i * 8), -138 + i * 36]], 6), ink);
    } else if (kind === 'zzz') {
      for (const [dx, dy, sz] of [[0, 0, 26], [34, -36, 34], [74, -82, 44]]) strokeP(g, `M${dx} ${dy} l${sz} 0 l${-sz} ${sz} l${sz} 0`, null, 6);
    } else if (kind === 'gloom') {
      for (let i = 0; i < 9; i++) P_(g, pen([[-80 + i * 20, -60], [-80 + i * 20, 10 + hash(i, 9) * 40]], 4, { a: 0, b: 0.6 }), ink);
    } else if (kind === 'idea') {
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.38; P_(g, pen([[Math.cos(a) * 40, Math.sin(a) * 40], [Math.cos(a) * 82, Math.sin(a) * 82]], 9, { a: 0.1, b: 0.6 }), ink); }
    }
    return g;
  }
  const EMOTES = ['sweat', 'anger', 'sparkle', 'exclaim', 'question', 'heart', 'gasp', 'zzz', 'gloom', 'idea'];
  const EMOTE_AT = { sweat: [130, -100], anger: [84, -132], sparkle: [150, -150], exclaim: [0, -250], question: [110, -230], heart: [130, -130], gasp: [0, -40], zzz: [120, -170], gloom: [0, -260], idea: [0, -250] };

  /** chara(cx, cy, size, o): a manga character from the head to the chest — inked with a G-pen, big glossy eyes, screentone shading under the chin and on the clothes. (cx, cy) is the middle of the face (between the eyes); size is the height of the whole bust in px (180–1000; a close-up in a panel 520–760). The body continues below and is cut by the panel's border. o: { mood (fn): 'calm' | 'happy' | 'shock' (tiny pupils, sweat, gasp lines) | 'determined' (heavy brows, narrowed eyes) | 'despair' (blank eyes, the dark gloom shadow with vertical lines) | 'smug' (half-lidded, raised brow, smirk) | 'crying' (shining eyes, streams of tears) | 'angry' (bared teeth, vein mark) — switches instantly on the cue, hair: 'spiky' (shōnen) | 'bob' | 'neat' (side part) | 'long', hairTone: 'black' | 'tone' | 'white', outfit: 'school' (black gakuran) | 'sailor' | 'suit' | 'tee', glasses: true | 'glint' (lenses flash white: the schemer), look (fn, -1..1 eyes left/right), talk (fn, true while the character speaks: the mouth moves), emote (fn): 'sweat' | 'anger' | 'sparkle' | 'exclaim' | 'question' | 'heart' | 'zzz' | 'gloom' | 'idea' (a symbol by the head), flip: true (mirror), at, from: 'cut' | 'slam' (zooms in from 1.2× with a jolt) | 'up' (rises into the panel), out } Keep each character's hair / hairTone / outfit / glasses the same on every page. Returns { el, head: [x, y] of the top of the head, mouth: [x, y] }. */
  B.chara = function (cx, cy, size = 600, o = {}) {
    size = clamp(+size || 600, 180, 1000);
    const k = size / 540, VB = [-270, -280, 540, 640];
    const n = box(this, cx - 270 * k, cy - 280 * k, 540 * k, 640 * k, VB, 2);
    const g = s('g', { transform: o.flip ? 'scale(-1 1)' : '' }, n.svg);
    const C = drawChara(n.svg, g, o);
    const em = {};
    for (const kd of EMOTES) { const [ex, ey] = EMOTE_AT[kd]; em[kd] = drawEmote(s('g', { style: 'display:none' }, C.slotOver), kd, ex, ey, 1.1).parentNode; }
    const at = o.at ?? 0, from = o.from || 'cut';
    let cur = null, curE = null, blinkOn = null, talkOn = null;
    const seed = hashStr(String(o.hair) + cx + cy) % 97;
    this.tick((lt) => {
      let m = val(o.mood, lt, 'calm'); if (!C.M[m]) m = 'calm';
      if (m !== cur) { for (const q in C.M) for (const kk in C.M[q]) C.M[q][kk].style.display = q === m ? '' : 'none'; cur = m; blinkOn = null; talkOn = null; }
      const bl = BLINKS[m] && ((lt + seed * 0.05) % 3.6) > 3.47;
      if (bl !== blinkOn) { C.M[m].eyes.style.display = bl ? 'none' : ''; C.blinkG.style.display = bl ? '' : 'none'; blinkOn = bl; }
      const talking = !!val(o.talk, lt, false) && m !== 'shock' && m !== 'crying' && m !== 'happy' && (hash(Math.floor(lt * 7), seed) > 0.4);
      if (talking !== talkOn) { C.M[m].mouth.style.display = talking ? 'none' : ''; C.talkG.style.display = talking ? '' : 'none'; talkOn = talking; }
      const e = val(o.emote, lt, null);
      if (e !== curE) { for (const q in em) em[q].style.display = q === e ? '' : 'none'; curE = e; }
      const look = clamp(val(o.look, lt, 0), -1, 1) * 9;
      for (const ir of C.irisList) ir.setAttribute('transform', `translate(${f1(look)} 0)`);
      const kk = clamp((lt - at) / (from === 'cut' ? 0.1 : 0.26));
      const vis = (lt >= at ? 1 : 0) * outK(lt, o.out);
      n.el.style.opacity = f2(vis * (from === 'cut' ? kk : clamp(kk * 3)));
      const sc = from === 'slam' ? lerp(1.22, 1, ease.out(kk)) : 1;
      const dy = from === 'up' ? (1 - ease.out(kk)) * 120 : 0;
      const jit = from === 'slam' && lt > at && lt < at + 0.35 ? (hash(Math.floor(lt * 24), seed) - 0.5) * 10 : 0;
      n.el.style.transform = `translate(${f1(jit)}px, ${f1(dy)}px) scale(${f2(sc)})`;
    });
    return { el: n.el, head: [cx, cy - 200 * k], mouth: [cx, cy + 105 * k] };
  };

  /** eyes(cx, cy, w, o): the extreme close-up — only the eyes and brows of a character across a wide strip, the manga's moment of resolve or dread (put it in a thin wide panel, e.g. the top strip of P.grid('strip')). (cx, cy) is the point between the eyes, w the width of the shot in px (600–1700). o: { mood (fn): 'determined' (default) | 'shock' | 'calm' | 'angry' | 'despair' | 'smug' | 'crying', hair, hairTone, glasses (same as the character's), look (fn), at, out } */
  B.eyes = function (cx, cy, w = 1200, o = {}) {
    w = clamp(+w || 1200, 400, 1800);
    // fit the panel: brows to the lower lids fill its height (an eyes shot never shows only hair), centred on (cx, cy)
    const A = typeof this.area === 'object' && this.area;
    const k = A ? Math.min(w / 300, Math.max(A.h, 160) / 82) : w / 300;
    w = 300 * k;
    const VB = [-150, -100, 300, 160];
    const n = box(this, cx - w / 2, cy - 90 * k, w, 160 * k, VB, 2);
    const C = drawChara(n.svg, s('g', null, n.svg), { ...o, hair: o.hair || 'spiky' });
    const at = o.at ?? 0;
    let cur = null;
    this.tick((lt) => {
      let m = val(o.mood, lt, 'determined'); if (!C.M[m]) m = 'determined';
      if (m !== cur) { for (const q in C.M) for (const kk in C.M[q]) C.M[q][kk].style.display = q === m ? '' : 'none'; cur = m; }
      C.slotOver.style.display = 'none';
      const look = clamp(val(o.look, lt, 0), -1, 1) * 9;
      for (const ir of C.irisList) ir.setAttribute('transform', `translate(${f1(look)} 0)`);
      const kk = clamp((lt - at) / 0.3);
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * clamp(kk * 4) * outK(lt, o.out));
      n.el.style.transform = `scale(${f2(lerp(1.08, 1, ease.out(kk)))})`;
    });
    return { el: n.el };
  };

  /** emote(kind, x, y, o): a manga symbol by itself — 'sweat' (a big drop: awkward), 'anger' (the vein cross), 'sparkle' (pride, something shiny), 'exclaim' (!), 'question' (?), 'heart', 'zzz', 'gloom' (vertical lines of dejection), 'idea' (a burst of rays: it clicks). o: { size (120), at, out } It pops on, shivering for a moment. A character's own symbol is better as P.chara's emote option. */
  B.emote = function (kind, x, y, o = {}) {
    const size = clamp(o.size ?? 120, 50, 320), k = size / 120;
    const n = box(this, x - 150 * k, y - 150 * k, 300 * k, 300 * k, [-150, -150, 300, 300], 4);
    drawEmote(n.svg, EMOTES.includes(kind) ? kind : 'sweat', 0, 0, 1);
    const at = o.at ?? 0;
    this.tick((lt) => {
      const kk = ease.back(clamp((lt - at) / 0.2));
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      const j = lt > at && lt < at + 0.3 ? (hash(Math.floor(lt * 24), 5) - 0.5) * 8 : 0;
      n.el.style.transform = `translate(${f1(j)}px, 0) scale(${f2(clamp(kk, 0, 1.2))})`;
    });
    return { el: n.el };
  };

  // ── balloons and captions ──────────────────────────────────────────────────────────────────────────────────
  /** balloon(cx, cy, str, o): a speech balloon centred on (cx, cy), sized to its words and kept inside the frame. Chinese of up to 18 characters is lettered vertically, right to left, like a manga (break columns with \n); English and longer lines run across in capitals. o: { tail: [x, y] (the speaker's mouth; the tail points there), kind: 'speech' (oval, default) | 'shout' (a spiky flash balloon) | 'think' (a cloud with bubbles) | 'whisper' (dashed), vertical: false to force horizontal, size: letter size (40), w: max text width for horizontal text, at, out } Keep it to ≤ 14 Chinese characters or ≤ 8 English words. */
  B.balloon = function (cx, cy, str, o = {}) {
    const txt = String(str), cjk = isCJK(txt), size = clamp(o.size ?? 40, 24, 64), kind = o.kind || 'speech';
    const flat = [...txt.replace(/\n/g, '')];
    const vertical = o.vertical ?? (cjk && flat.length <= 18);
    let lines, tW, tH;
    if (vertical) {
      lines = txt.includes('\n') ? txt.split('\n') : (() => { const per = flat.length <= 6 ? flat.length : Math.ceil(flat.length / Math.ceil(flat.length / 6)); const out = []; for (let i = 0; i < flat.length; i += per) out.push(flat.slice(i, i + per).join('')); return out; })();
      tW = lines.length * size * 1.25; tH = Math.max(...lines.map((l) => [...l].length)) * size * 1.06;
    } else {
      const maxW = clamp(o.w ?? (cjk ? size * 9 : size * 11), size * 4, 900);
      lines = [];
      for (const para of txt.split('\n')) {
        if (cjk) { let cur = ''; for (const ch of para) { if (tw(cur + ch, size) > maxW) { lines.push(cur); cur = ch; } else cur += ch; } lines.push(cur); }
        else { let cur = ''; for (const wd of para.toUpperCase().split(/\s+/)) { const t2 = cur ? cur + ' ' + wd : wd; if (tw(t2, size) > maxW && cur) { lines.push(cur); cur = wd; } else cur = t2; } lines.push(cur); }
      }
      tW = Math.max(...lines.map((l) => tw(l, size))); tH = lines.length * size * 1.2;
    }
    const sp = kind === 'shout' ? 1.5 : 1.36;
    const rx = tW / 2 * sp + size * 0.5, ry = tH / 2 * sp + size * 0.45;
    cx = clamp(cx, rx + 24, W - rx - 24); cy = clamp(cy, ry + 24, SAFE_B - ry);
    const m = 220;
    const n = box(this, cx - rx - m, cy - ry - m, (rx + m) * 2, (ry + m) * 2, [-rx - m, -ry - m, (rx + m) * 2, (ry + m) * 2], 6);
    const ink = INK(), seed = hashStr(txt) % 89;
    let tail = o.tail ? [o.tail[0] - cx, o.tail[1] - cy] : null;
    if (tail) { const dl = Math.hypot(tail[0], tail[1]), maxL = Math.max(rx, ry) + 150; if (dl > maxL) tail = [tail[0] / dl * maxL, tail[1] / dl * maxL]; }
    const outline = s('g', null, n.svg), fillG = s('g', null, n.svg);
    let body;
    if (kind === 'shout') {
      const pts = []; const N = 30;
      for (let i = 0; i < N * 2; i++) { const a = (i / (N * 2)) * TAU; const r = i % 2 ? 1.0 : 1.16 + hash(i, seed) * 0.14; pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]); }
      body = poly(pts);
    } else if (kind === 'think') {
      const N = Math.max(9, Math.round((rx + ry) / 34)); let d = '';
      for (let i = 0; i < N; i++) { const a = (i / N) * TAU, a2 = ((i + 1) / N) * TAU; const p1 = [Math.cos(a) * rx, Math.sin(a) * ry], p2 = [Math.cos(a2) * rx, Math.sin(a2) * ry], am = (a + a2) / 2; const c = [Math.cos(am) * rx * 1.2, Math.sin(am) * ry * 1.2]; d += (i ? '' : `M${f1(p1[0])} ${f1(p1[1])}`) + `Q${f1(c[0])} ${f1(c[1])} ${f1(p2[0])} ${f1(p2[1])}`; }
      body = d + 'Z';
    } else body = `M${-rx} 0 A${rx} ${ry} 0 1 0 ${rx} 0 A${rx} ${ry} 0 1 0 ${-rx} 0 Z`;
    const dash = kind === 'whisper' ? { 'stroke-dasharray': '14 10' } : {};
    s('path', Object.assign({ d: body, fill: WHITE, stroke: ink, 'stroke-width': kind === 'shout' ? 5 : 4.5, 'stroke-linejoin': 'miter' }, dash), outline);
    if (tail && kind !== 'think') {
      const a = Math.atan2(tail[1], tail[0]), sp2 = 0.16, e = (aa) => [Math.cos(aa) * rx * 0.86, Math.sin(aa) * ry * 0.86];
      const b1 = e(a - sp2), b2 = e(a + sp2);
      const td = `M${f1(b1[0])} ${f1(b1[1])}Q${f1((b1[0] + tail[0]) / 2)} ${f1((b1[1] + tail[1]) / 2)} ${f1(tail[0])} ${f1(tail[1])}Q${f1((b2[0] + tail[0]) / 2 + 6)} ${f1((b2[1] + tail[1]) / 2)} ${f1(b2[0])} ${f1(b2[1])}Z`;
      s('path', Object.assign({ d: td, fill: WHITE, stroke: ink, 'stroke-width': 4.5, 'stroke-linejoin': 'round' }, dash), outline);
      s('path', { d: td, fill: WHITE }, fillG);
      s('path', { d: body, fill: WHITE, transform: 'scale(0.97)' }, fillG);
    } else if (tail) {
      const dl = Math.hypot(tail[0], tail[1]) || 1, ex = Math.hypot(tail[0] / rx, tail[1] / ry) || 1;
      for (const [q, r] of [[0.45, 16], [0.75, 10], [0.95, 6]]) { const t = 1 / ex + (1 - 1 / ex) * q; s('circle', { cx: tail[0] * t, cy: tail[1] * t + 0 * dl, r, fill: WHITE, stroke: ink, 'stroke-width': 4 }, fillG); }
    }
    const el = h('div', 'mg-say' + (vertical ? ' v' : '') + (!cjk ? ' en' : ''), null, n.el);
    el.innerHTML = lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
    Object.assign(el.style, { left: f1(m + rx - tW / 2 - size * 0.2) + 'px', top: f1(m + ry - tH / 2 - size * 0.1) + 'px', width: f1(tW + size * 0.4) + 'px', height: f1(tH + size * 0.2) + 'px', fontSize: size + 'px' });
    const at = o.at ?? 0;
    n.el.style.transformOrigin = `${f1(m + rx)}px ${f1(m + ry)}px`;
    this.tick((lt) => {
      const kk = ease.back(clamp((lt - at) / 0.2));
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      const j = kind === 'shout' && lt > at && lt < at + 0.4 ? (hash(Math.floor(lt * 24), seed) - 0.5) * 8 : 0;
      n.el.style.transform = `translate(${f1(j)}px, 0) scale(${f2(clamp(lerp(0.8, 1, kk), 0, 1.1))})`;
    });
    return { el: n.el, rx, ry, cx, cy };
  };

  /** caption(x, y, str, o): a narration box (rectangular, thin black frame, mincho lettering) at its top-left (x, y) — "那天，我第一次……", "Three weeks later." Kept inside the frame. o: { w (auto, ≤ 760), size (34), dark: true (a black box, white letters: an inner voice, a flashback), at, out } At most 2 lines. */
  B.caption = function (x, y, str, o = {}) {
    const txt = String(str), cjk = isCJK(txt), size = clamp(o.size ?? 34, 22, 56);
    const w = clamp(o.w ?? Math.min(760, tw(txt, size) * 1.04 + 52), 160, 900);
    const lines = Math.min(3, Math.max(1, Math.ceil((tw(txt, size) * 1.04) / (w - 44))));
    const hh = lines * size * 1.3 + 26;
    x = clamp(x, 24, W - w - 24); y = clamp(y, 24, SAFE_B - hh);
    const n = box(this, x, y, w, hh, null, 5);
    s('rect', { x: 0, y: 0, width: w, height: hh, fill: o.dark ? INK() : WHITE, stroke: INK(), 'stroke-width': 3.5 }, n.svg);
    const el = h('div', 'mg-cap' + (cjk ? '' : ' en'), null, n.el);
    el.textContent = txt;
    Object.assign(el.style, { left: '22px', top: '12px', width: f1(w - 44) + 'px', fontSize: size + 'px', color: o.dark ? WHITE : INK() });
    const at = o.at ?? 0;
    this.tick((lt) => { n.el.style.opacity = f2(clamp((lt - at) / 0.15) * (lt >= at ? 1 : 0) * outK(lt, o.out)); });
    return { el: n.el, w, h: hh };
  };

  // ── hand-lettered sound effects ────────────────────────────────────────────────────────────────────────────
  /** one lettered glyph: black rim, white rim, then the fill (black, white or spot red) */
  function glyph(parent, ch, x, y, size, rot, style, font) {
    const g = s('g', { transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) skewX(-8)` }, parent);
    const cls = 'mg-sfx' + (font === 'brush' ? ' brush' : '');
    const mk = (attrs) => { const t = s('text', Object.assign({ x: 0, y: size * 0.36, 'text-anchor': 'middle', class: cls, 'font-size': f1(size), 'stroke-linejoin': 'round' }, attrs), g); t.textContent = ch; return t; };
    const fill = style === 'white' ? WHITE : style === 'spot' ? col('red') : INK();
    if (style === 'black') { mk({ fill: 'none', stroke: WHITE, 'stroke-width': f1(size * 0.2) }); mk({ fill, stroke: INK(), 'stroke-width': f1(size * 0.03) }); }
    else { mk({ fill: 'none', stroke: INK(), 'stroke-width': f1(size * 0.22) }); mk({ fill: 'none', stroke: WHITE, 'stroke-width': f1(size * 0.1) }); mk({ fill, stroke: INK(), 'stroke-width': f1(size * 0.035) }); }
    return g;
  }
  /** sfx(cx, cy, str, o): a hand-lettered sound effect drawn into the picture — 'ドン' (the impact), 'ガーン' (shock), 'ザワ…' (unease), 'バン!', '咚！', '轰——', 'BOOM', 'tick tick' — each letter skewed, rotated and stepping up in size, rimmed in white so it reads over any art. It slams in on its word, shudders, then holds. o: { size (190, clamped 60–320), style: 'black' (black letters, white rim; default) | 'white' (white letters, black outline: on dark tone) | 'spot' (red: the film's single climax only), font: 'heavy' (default) | 'brush' (Chinese brush letters), rot (-8), dir: 'right' (default) | 'down' (letters fall in a column), at, shake (0.4 s), out } Two per page at most. */
  B.sfx = function (cx, cy, str, o = {}) {
    const chars = [...String(str)].slice(0, 8), size = clamp(o.size ?? 190, 60, 320), seed = hashStr(String(str)) % 89, down = o.dir === 'down';
    const steps = chars.map((_, i) => size * (0.82 + 0.3 * (i / Math.max(1, chars.length - 1))) * (chars.length === 1 ? 1.15 : 1));
    const adv = steps.map((sz, i) => (/[\x00-\x7F]/.test(chars[i]) ? 0.62 : 0.9) * sz);
    const totW = down ? Math.max(...steps) : adv.reduce((a, b) => a + b, 0), totH = down ? adv.reduce((a, b) => a + b, 0) : Math.max(...steps);
    const bw = totW + size * 0.6, bh = totH + size * 0.6;
    cx = clamp(cx, bw / 2 + 10, W - bw / 2 - 10); cy = clamp(cy, bh / 2 + 10, SAFE_B - bh / 2 + size * 0.1);
    const n = box(this, cx - bw / 2, cy - bh / 2, bw, bh, [-bw / 2, -bh / 2, bw, bh], 7);
    const g = s('g', { transform: `rotate(${f1(o.rot ?? -8)})` }, n.svg);
    let p = -(down ? totH : totW) / 2;
    chars.forEach((ch, i) => {
      const sz = steps[i], c = p + adv[i] / 2; p += adv[i];
      const r = (hash(i, seed) - 0.5) * 16, j = (hash(i, seed + 4) - 0.5) * size * 0.12;
      glyph(g, ch, down ? j : c, down ? c : j, sz, r, o.style || 'black', o.font);
    });
    const at = o.at ?? 0, shake = o.shake ?? 0.4;
    this.tick((lt) => {
      const kk = ease.out(clamp((lt - at) / 0.14));
      const on = lt > at && lt < at + shake, st = Math.floor(lt * 24);
      const jx = on ? (hash(st, seed) - 0.5) * size * 0.1 : 0, jy = on ? (hash(st, seed + 7) - 0.5) * size * 0.08 : 0;
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      n.el.style.transform = `translate(${f1(jx)}px, ${f1(jy)}px) scale(${f2(lerp(1.7, 1, kk))})`;
    });
    return { el: n.el };
  };

  /** menace(x, y, o): the ゴゴゴ menace — a slanting column of outlined 'ゴ' letters that appear one by one and never stop trembling: dread building before the turn, a rival arriving, the boss waking. (x, y) is the first letter; the column runs down and to the side. o: { text ('ゴゴゴゴ'; '轰轰轰' or 'ドドド' work too), size (110), side: 'right' (default) | 'left' (direction the column leans), at, out } Pair it with P.aura around the one who menaces. */
  B.menace = function (x, y, o = {}) {
    const chars = [...String(o.text ?? 'ゴゴゴゴ')].slice(0, 6), size = clamp(o.size ?? 110, 60, 220), sd = o.side === 'left' ? -1 : 1;
    const stepX = size * 0.28 * sd, stepY = size * 0.86, n0 = chars.length;
    const bw = Math.abs(stepX) * n0 + size * 2, bh = stepY * n0 + size * 1.4;
    x = clamp(x, size, W - size); y = clamp(y, size * 0.8, SAFE_B - stepY * (n0 - 1) - size * 0.6);
    const n = box(this, x - bw / 2, y - size, bw, bh, [-bw / 2, -size, bw, bh], 7);
    const gs = chars.map((ch, i) => { const g = s('g', { opacity: 0 }, n.svg); glyph(g, ch, stepX * i, stepY * i, size * (0.9 + i * 0.08), (i % 2 ? 6 : -6), 'white'); return g; });
    const at = o.at ?? 0;
    this.tick((lt) => {
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      const st = Math.floor(lt * 14);
      gs.forEach((g, i) => {
        const a = at + i * 0.16;
        const vis = lt >= a ? clamp((lt - a) / 0.08) : 0;
        g.setAttribute('opacity', f2(vis));
        g.setAttribute('transform', `translate(${f1((hash(st, i * 5) - 0.5) * 7)} ${f1((hash(st, i * 5 + 1) - 0.5) * 7)})`);
      });
    });
    return { el: n.el };
  };

  /** aura(cx, cy, r, o): a dark aura rising around a figure — flickering tapered ink flames on a ring of radius r around (cx, cy), with a dot-tone halo behind: fighting spirit, menace, rage. o: { at, color: 'ink' | 'paper' (white flames on a black panel), out } Draw it before the character so the figure stands in front. */
  B.aura = function (cx, cy, r = 300, o = {}) {
    r = clamp(r, 120, 700);
    const R2 = r * 1.6;
    const n = box(this, cx - R2, cy - R2, R2 * 2, R2 * 2, [-R2, -R2, R2 * 2, R2 * 2], 1);
    const halo = s('path', { d: gradDots(-r * 1.25, -r * 1.25, r * 2.5, r * 2.5, 'in', 10), fill: col(o.color === 'paper' ? 'paper' : 'ink'), opacity: 0.85 }, n.svg);
    const path = s('path', { fill: col(o.color || 'ink') }, n.svg);
    const at = o.at ?? 0, seed = (cx + cy) | 0;
    let last = -1;
    this.tick((lt) => {
      const kk = clamp((lt - at) / 0.3);
      n.el.style.opacity = f2((lt >= at ? kk : 0) * outK(lt, o.out));
      halo.setAttribute('transform', `scale(${f2(0.92 + 0.08 * kk)})`);
      const st = Math.floor(lt * 10);
      if (st === last) return; last = st;
      let d = '';
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU + (hash(i, seed) - 0.5) * 0.15;
        const up = -Math.PI / 2, lean = Math.sin(a) * 0.0 + 0.45 * Math.cos(a - up);
        const r0 = r * (0.95 + hash(i, st + seed) * 0.12), L = r * (0.25 + hash(i, st * 3 + seed) * 0.3) * (Math.sin(a) < 0.3 ? 1.3 : 0.6);
        const bx = Math.cos(a) * r0, by = Math.sin(a) * r0;
        const tx = bx + Math.cos(a) * L * 0.4, ty = by - L;   // flames lick upward
        d += pen([[bx, by], [(bx + tx) / 2 + Math.cos(a) * 14 + (hash(i, st) - 0.5) * 20, (by + ty) / 2], [tx, ty]], 22 + hash(i, seed + 3) * 18, { a: 0.1, b: 0.85 });
        void lean;
      }
      path.setAttribute('d', d);
    });
    return { el: n.el };
  };

  // ── the boss ───────────────────────────────────────────────────────────────────────────────────────────────
  /** boss(cx, cy, size, o): a shōnen-manga boss — a hulking black silhouette with horns, glaring white slit eyes and a jagged grin, standing in for an abstract enemy (procrastination, the deadline, self-doubt, the exam). (cx, cy) is the middle of its head; size is its height in px (300–900). o: { label: its name on a plate under it ('拖延大魔王', 'THE DEADLINE'), mood (fn): 'menace' (default) | 'laugh' (mouth wide, shaking) | 'hit' (X eyes, cracks), defeat: time it shatters and vanishes, at, from: 'cut' | 'rise' (rises from below), out } */
  B.boss = function (cx, cy, size = 600, o = {}) {
    size = clamp(+size || 600, 260, 950);
    const k = size / 600, VB = [-320, -200, 640, 640];
    const n = box(this, cx - 320 * k, cy - 200 * k, 640 * k, 640 * k, VB, 2);
    const ink = INK(), mid = tonePat(n.svg, 'mid');
    const g = s('g', null, n.svg);
    // body: shoulders and arms mass
    const bodyD = 'M-300 440 C-300 300 -260 200 -170 150 C-130 128 -90 120 -60 110 L60 110 C90 120 130 128 170 150 C260 200 300 300 300 440 Z';
    s('path', { d: bodyD, fill: ink }, g);
    // horns
    for (const sx of [-1, 1]) s('path', { d: `M${sx * 60} -80 C${sx * 110} -110 ${sx * 150} -150 ${sx * 160} -196 C${sx * 170} -140 ${sx * 140} -80 ${sx * 96} -40 Z`, fill: WHITE, stroke: ink, 'stroke-width': 7, 'stroke-linejoin': 'round' }, g);
    for (const sx of [-1, 1]) s('path', { d: `M${sx * 60} -80 C${sx * 110} -110 ${sx * 150} -150 ${sx * 160} -196 C${sx * 170} -140 ${sx * 140} -80 ${sx * 96} -40 Z`, fill: mid }, g);
    // head
    s('path', { d: 'M-130 20 C-140 -80 -80 -120 0 -120 C80 -120 140 -80 130 20 C126 90 80 140 0 150 C-80 140 -126 90 -130 20 Z', fill: ink }, g);
    // rim light lines on the silhouette
    for (const sx of [-1, 1]) { P_(g, pen([[sx * 120, -40], [sx * 128, 30], [sx * 100, 110]], 6, { a: 0.4, b: 0.5 }), WHITE); P_(g, pen([[sx * 200, 190], [sx * 260, 260], [sx * 284, 360]], 7, { a: 0.4, b: 0.5 }), WHITE); }
    const faces = {};
    for (const m of ['menace', 'laugh', 'hit']) {
      const fg = faces[m] = s('g', { style: 'display:none' }, g);
      if (m === 'hit') for (const sx of [-1, 1]) strokeP(fg, `M${sx * 30} -30 L${sx * 80} 10 M${sx * 80} -30 L${sx * 30} 10`, null, 12, { stroke: WHITE });
      else for (const sx of [-1, 1]) { s('path', { d: `M${sx * 22} -6 L${sx * 98} -42 C${sx * 92} -6 ${sx * 60} 14 ${sx * 22} -6 Z`, fill: WHITE }, fg); s('circle', { cx: sx * 62, cy: -16, r: 6, fill: ink }, fg); }
      const open = m === 'laugh' ? 70 : m === 'hit' ? 30 : 34;
      const teeth = []; const N = 9; for (let i = 0; i <= N; i++) { const x = -80 + (160 * i) / N; teeth.push([x, 50 + (i % 2 ? 22 : 0)]); }
      const lower = []; for (let i = N; i >= 0; i--) { const x = -80 + (160 * i) / N; lower.push([x, 50 + open - (i % 2 ? 0 : 20)]); }
      s('path', { d: `M-92 46 Q0 ${66 + open * 1.4} 92 46 Q0 ${30 + open * 0.2} -92 46 Z`, fill: WHITE }, fg);
      strokeP(fg, poly(teeth.concat(lower)), null, 4);
      if (m === 'hit') for (const [a, b] of [[[-40, -110], [-10, -40]], [[30, -100], [60, 0]], [[-120, 200], [-40, 300]]]) strokeP(fg, `M${a[0]} ${a[1]} L${(a[0] + b[0]) / 2 + 18} ${(a[1] + b[1]) / 2} L${b[0]} ${b[1]}`, null, 7, { stroke: WHITE });
    }
    let plate = null;
    if (o.label) {
      const lsz = 46, lw = tw(String(o.label), lsz) + 80;
      plate = h('div', 'mg-label', null, n.el);
      plate.textContent = String(o.label);
      Object.assign(plate.style, { left: f1(320 * k - lw / 2) + 'px', top: f1(560 * k) + 'px', width: f1(lw) + 'px', fontSize: lsz + 'px', background: WHITE, color: ink, border: '5px solid ' + ink, padding: '6px 0 10px', boxShadow: `8px 8px 0 ${ink}` });
    }
    const at = o.at ?? 0, from = o.from || 'cut', seed = 31;
    let cur = null;
    this.tick((lt) => {
      let m = val(o.mood, lt, 'menace'); if (o.defeat != null && lt >= o.defeat) m = 'hit'; if (!faces[m]) m = 'menace';
      if (m !== cur) { for (const q in faces) faces[q].style.display = q === m ? '' : 'none'; cur = m; }
      const kk = clamp((lt - at) / (from === 'rise' ? 0.6 : 0.12));
      const dy = from === 'rise' ? (1 - ease.out(kk)) * 260 : 0;
      const st = Math.floor(lt * 20);
      const sh = m === 'laugh' ? (hash(st, seed) - 0.5) * 10 : m === 'hit' && o.defeat != null && lt < o.defeat + 0.4 ? (hash(st, seed + 1) - 0.5) * 22 : 0;
      const gone = o.defeat != null ? clamp((lt - o.defeat - 0.35) / 0.45) : 0;
      n.el.style.opacity = f2((lt >= at ? clamp(kk * 2) : 0) * (1 - gone) * outK(lt, o.out));
      n.el.style.transform = `translate(${f1(sh)}px, ${f1(dy + gone * 60)}px) scale(${f2(1 - gone * 0.25)})`;
    });
    return { el: n.el };
  };

  // ── props ──────────────────────────────────────────────────────────────────────────────────────────────────
  const PROPS = ['phone', 'clock', 'alarm', 'book', 'laptop', 'paper', 'coffee', 'bulb', 'trophy', 'calendar', 'bed', 'game'];
  /** prop(kind, cx, cy, size, o): an inked object with tone shading — 'phone' | 'clock' | 'alarm' (ringing alarm clock) | 'book' (open) | 'laptop' | 'paper' (a test or report sheet; label is its score or title) | 'coffee' | 'bulb' (lights up at o.on) | 'trophy' | 'calendar' (label is the date) | 'bed' | 'game' (a game controller). size in px (100–700). o: { label: short text on the screen / sheet / calendar ('23:47', '38', '7/14'), spot: true (the label in red: climax only), time (fn): hours shown on a clock (e.g. lt => 23 + lt / 60), ring: time it starts ringing (alarm, phone: shakes with lines), on: time a bulb lights, rot (degrees), at, out } */
  B.prop = function (kind, cx, cy, size = 260, o = {}) {
    if (!PROPS.includes(kind)) kind = 'paper';
    size = clamp(+size || 260, 80, 760);
    const k = size / 200;
    const n = box(this, cx - 130 * k, cy - 130 * k, 260 * k, 260 * k, [-130, -130, 260, 260], 3);
    const ink = INK(), mid = tonePat(n.svg, 'mid'), light = tonePat(n.svg, 'light'), dark = tonePat(n.svg, 'dark');
    const g = s('g', { transform: `rotate(${o.rot ?? 0})` }, n.svg);
    const F = (d, fill, sw = 5) => s('path', { d, fill: fill || WHITE, stroke: ink, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    const T = (d, pat) => s('path', { d, fill: pat }, g);
    let label = null, hands = null, rays = null, lineG = null;
    const lab = (x, y, sz, color) => { if (o.label == null) return; const t = s('text', { x, y, 'text-anchor': 'middle', class: 'mg-sfx', 'font-size': sz, fill: o.spot ? col('red') : color || ink }, g); t.textContent = String(o.label); label = t; };
    if (kind === 'phone') {
      F(PV.rrect(-56, -98, 112, 196, 18)); F(PV.rrect(-46, -80, 92, 156, 6), WHITE, 3); T(PV.rrect(-46, -80, 92, 156, 6), light);
      s('rect', { x: -18, y: -92, width: 36, height: 6, rx: 3, fill: ink }, g);
      P_(g, pen([[-30, -70], [30, 40]], 8), WHITE);
      lab(0, 12, o.label && String(o.label).length > 4 ? 26 : 40);
    } else if (kind === 'clock' || kind === 'alarm') {
      if (kind === 'alarm') { for (const sx of [-1, 1]) { F(`M${sx * 40} -78 A44 44 0 0 1 ${sx * 96} -36 Z`, ink); F(`M${sx * 56} 70 L${sx * 76} 100`, null, 9); } F('M-6 -96 L6 -96 L6 -84 L-6 -84 Z', ink); }
      F('M-86 0 A86 86 0 1 0 86 0 A86 86 0 1 0 -86 0 Z', WHITE, 7);
      s('circle', { cx: 0, cy: 0, r: 72, fill: 'none', stroke: ink, 'stroke-width': 2.5 }, g);
      T('M30 -62 A72 72 0 0 1 30 62 A86 86 0 0 0 30 -62 Z', mid);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; s('line', { x1: Math.cos(a) * 60, y1: Math.sin(a) * 60, x2: Math.cos(a) * (i % 3 ? 66 : 70), y2: Math.sin(a) * (i % 3 ? 66 : 70), stroke: ink, 'stroke-width': i % 3 ? 3 : 6 }, g); }
      hands = { h: s('path', { d: pen([[0, 6], [0, -40]], 11, { a: 0, b: 0.5, min: 0.4 }), fill: ink }, g), m: s('path', { d: pen([[0, 8], [0, -60]], 7, { a: 0, b: 0.5, min: 0.4 }), fill: ink }, g) };
      s('circle', { cx: 0, cy: 0, r: 7, fill: ink }, g);
    } else if (kind === 'book') {
      F('M0 -50 C-40 -70 -90 -70 -116 -56 L-116 66 C-90 54 -40 54 0 74 Z'); F('M0 -50 C40 -70 90 -70 116 -56 L116 66 C90 54 40 54 0 74 Z');
      T('M0 -50 C40 -70 90 -70 116 -56 L116 66 C90 54 40 54 0 74 Z', light);
      for (let i = 0; i < 6; i++) { s('path', { d: `M-100 ${-40 + i * 16} C-70 ${-50 + i * 16} -40 ${-48 + i * 16} -16 ${-36 + i * 16}`, fill: 'none', stroke: ink, 'stroke-width': 2 }, g); s('path', { d: `M16 ${-36 + i * 16} C40 ${-48 + i * 16} 70 ${-50 + i * 16} 100 ${-40 + i * 16}`, fill: 'none', stroke: ink, 'stroke-width': 2 }, g); }
      F('M-116 66 C-90 54 -40 54 0 74 C40 54 90 54 116 66 L116 76 C90 64 40 64 0 84 C-40 64 -90 64 -116 76 Z', ink, 3);
    } else if (kind === 'laptop') {
      F('M-100 -84 L100 -84 L100 40 L-100 40 Z'); F('M-88 -72 L88 -72 L88 28 L-88 28 Z', WHITE, 3); T('M-88 -72 L88 -72 L88 28 L-88 28 Z', light);
      F('M-100 40 L100 40 L124 76 L-124 76 Z'); T('M-100 40 L100 40 L124 76 L-124 76 Z', mid);
      P_(g, pen([[-60, -60], [-10, 10]], 7), WHITE);
      lab(0, -8, o.label && String(o.label).length > 4 ? 30 : 46);
    } else if (kind === 'paper') {
      F('M-74 -98 L50 -98 L76 -72 L76 98 L-74 98 Z'); F('M50 -98 L50 -72 L76 -72', WHITE, 4);
      for (let i = 0; i < 8; i++) s('line', { x1: -56, y1: -40 + i * 16, x2: 56, y2: -40 + i * 16, stroke: ink, 'stroke-width': 2, opacity: 0.8 }, g);
      T('M-74 60 L76 60 L76 98 L-74 98 Z', light);
      if (o.label != null) { s('circle', { cx: -18, cy: -62, r: 30, fill: 'none', stroke: o.spot ? col('red') : ink, 'stroke-width': 5 }, g); lab(-18, -48, String(o.label).length > 3 ? 26 : 38); }
    } else if (kind === 'coffee') {
      F('M-60 -50 L60 -50 L50 70 C46 84 -46 84 -50 70 Z'); T('M20 -50 L60 -50 L50 70 C48 78 30 82 20 82 Z', mid);
      F('M60 -24 C100 -24 100 40 54 40', null, 9);
      s('ellipse', { cx: 0, cy: -50, rx: 60, ry: 12, fill: ink }, g);
      lineG = s('g', null, g);
      for (let i = 0; i < 3; i++) strokeP(lineG, `M${-24 + i * 24} -70 C${-36 + i * 24} -90 ${-12 + i * 24} -104 ${-24 + i * 24} -124`, null, 4);
    } else if (kind === 'bulb') {
      rays = s('g', { opacity: 0 }, g);
      for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.36; P_(rays, pen([[Math.cos(a) * 90, Math.sin(a) * 90 - 20], [Math.cos(a) * 124, Math.sin(a) * 124 - 20]], 10, { a: 0.1, b: 0.6 })); }
      F('M-30 40 C-30 10 -64 -6 -64 -44 C-64 -84 -34 -106 0 -106 C34 -106 64 -84 64 -44 C64 -6 30 10 30 40 Z');
      const dim = T('M-30 40 C-30 10 -64 -6 -64 -44 C-64 -84 -34 -106 0 -106 C34 -106 64 -84 64 -44 C64 -6 30 10 30 40 Z', mid);
      rays.dim = dim;
      strokeP(g, 'M-14 36 L-14 -20 L-4 -36 L4 -20 L14 -36 L14 36', null, 3);
      F('M-32 40 L32 40 L30 70 L-30 70 Z', WHITE); T('M-32 40 L32 40 L30 70 L-30 70 Z', dark);
      for (const yy of [50, 60]) s('line', { x1: -32, y1: yy, x2: 32, y2: yy, stroke: ink, 'stroke-width': 3 }, g);
      F('M-18 70 L18 70 L10 84 L-10 84 Z', ink);
    } else if (kind === 'trophy') {
      F('M-64 -90 L64 -90 C64 -10 40 24 0 30 C-40 24 -64 -10 -64 -90 Z'); T('M20 -90 L64 -90 C64 -10 40 24 0 30 C14 10 22 -40 20 -90 Z', mid);
      for (const sx of [-1, 1]) F(`M${sx * 64} -70 C${sx * 108} -70 ${sx * 104} -10 ${sx * 40} 6`, null, 8);
      F('M-12 30 L12 30 L16 66 L-16 66 Z'); F('M-54 66 L54 66 L54 92 L-54 92 Z', ink);
      P_(g, pen([[-40, -76], [-34, -20]], 8), WHITE);
      lab(0, -26, 34);
    } else if (kind === 'calendar') {
      F('M-90 -80 L90 -80 L90 96 L-90 96 Z'); F('M-90 -80 L90 -80 L90 -36 L-90 -36 Z', ink);
      for (const x of [-50, 0, 50]) F(`M${x} -100 L${x} -64`, null, 10);
      for (let i = 0; i < 4; i++) s('line', { x1: -90, y1: -36 + i * 33, x2: 90, y2: -36 + i * 33, stroke: ink, 'stroke-width': 1.5, opacity: 0.5 }, g);
      T('M30 30 L90 30 L90 96 L30 96 Z', light);
      if (o.label != null) { const L2 = String(o.label); const t = s('text', { x: 0, y: 46, 'text-anchor': 'middle', class: 'mg-sfx', 'font-size': L2.length > 3 ? 54 : 80, fill: o.spot ? col('red') : ink }, g); t.textContent = L2; label = t; }
    } else if (kind === 'bed') {
      F('M-120 10 L120 10 L120 60 L-120 60 Z'); F('M-120 -60 L-96 -60 L-96 96 L-120 96 Z', ink); F('M96 -10 L120 -10 L120 96 L96 96 Z', ink);
      F('M-96 -8 C-40 -40 40 -40 96 -8 L96 30 L-96 30 Z'); T('M-96 -8 C-40 -40 40 -40 96 -8 L96 30 L-96 30 Z', light);
      F('M-90 -30 C-90 -50 -40 -52 -40 -30 C-40 -14 -90 -12 -90 -30 Z');
    } else if (kind === 'game') {
      F('M-100 -10 C-100 -50 -60 -56 -30 -44 L30 -44 C60 -56 100 -50 100 -10 C110 60 70 80 50 46 L-50 46 C-70 80 -110 60 -100 -10 Z'); T('M-100 -10 C-100 -50 -60 -56 -30 -44 L30 -44 C60 -56 100 -50 100 -10 C110 60 70 80 50 46 L-50 46 C-70 80 -110 60 -100 -10 Z', light);
      F('M-70 -14 L-56 -14 L-56 -28 L-44 -28 L-44 -14 L-30 -14 L-30 -2 L-44 -2 L-44 12 L-56 12 L-56 -2 L-70 -2 Z', ink, 2);
      for (const [x, y] of [[50, -24], [70, -8], [50, 8], [30, -8]]) s('circle', { cx: x, cy: y, r: 9, fill: ink }, g);
    }
    const at = o.at ?? 0, seed = hashStr(kind) % 50;
    this.tick((lt) => {
      const kk = ease.back(clamp((lt - at) / 0.22));
      const ringing = o.ring != null && lt >= o.ring;
      const st = Math.floor(lt * 20);
      const jx = ringing ? (hash(st, seed) - 0.5) * 14 : 0, jr = ringing ? (hash(st, seed + 1) - 0.5) * 10 : 0;
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      n.el.style.transform = `translate(${f1(jx)}px, 0) rotate(${f1(jr)}deg) scale(${f2(clamp(lerp(0.7, 1, kk), 0, 1.1))})`;
      if (hands) { const hr = val(o.time, lt, 10.17); hands.h.setAttribute('transform', `rotate(${f1((hr % 12) * 30)})`); hands.m.setAttribute('transform', `rotate(${f1((hr % 1) * 360)})`); }
      if (rays) { const on = o.on != null && lt >= o.on; rays.setAttribute('opacity', on ? (Math.floor(lt * 8) % 4 === 0 && lt < o.on + 0.5 ? '0.3' : '1') : '0'); rays.dim.setAttribute('opacity', on ? '0' : '1'); }
      if (lineG) lineG.setAttribute('transform', `translate(0 ${f1(-((lt * 20) % 12))})`);
    });
    if (o.ring != null) { this.emote('exclaim', cx + 120 * k, cy - 110 * k, { size: 70 * k, at: o.ring }); }
    return { el: n.el, label };
  };

  // ── scenes (backgrounds) ───────────────────────────────────────────────────────────────────────────────────
  /** scene(kind, o): a pen-and-tone background filling the panel (call it on the panel layer first, before the characters) or the whole frame — 'classroom' (blackboard, windows) | 'office' (blinds, desks, monitors) | 'street' (a Japanese street in one-point perspective with utility poles and wires) | 'room' (a bedroom wall with a window at night) | 'sky' (clouds) | 'night' (black sky, moon, stars) | 'sparkle' (soft bubbles and sparkles: a happy or shōjo moment) | 'dark' (a dark dot gradient: dread, the inner world). o: { at, out } */
  B.scene = function (kind = 'room', o = {}) {
    const R = rectOf(this, o);
    const g = s('g', { opacity: 0 }, this.svg);
    const ink = INK(), X = (u) => R.x + u * R.w, Y = (v) => R.y + v * R.h;
    const cid = nid('c'); s('rect', { x: R.x, y: R.y, width: R.w, height: R.h }, s('clipPath', { id: cid }, defs(this.svg)));
    const G = s('g', { 'clip-path': `url(#${cid})` }, g);
    const line = (x1, y1, x2, y2, w = 2.5) => s('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), stroke: ink, 'stroke-width': w, 'stroke-linecap': 'round' }, G);
    const rect = (x, y, w, hh, fill, sw = 2.5) => s('rect', { x: f1(x), y: f1(y), width: f1(w), height: f1(hh), fill: fill || 'none', stroke: ink, 'stroke-width': sw }, G);
    const tone = (x, y, w, hh, kd) => s('rect', { x: f1(x), y: f1(y), width: f1(w), height: f1(hh), fill: tonePat(this.svg, kd) }, G);
    if (kind === 'classroom') {
      rect(X(0.06), Y(0.12), R.w * 0.5, R.h * 0.4, WHITE, 4); tone(X(0.06), Y(0.12), R.w * 0.5, R.h * 0.4, 'dark');
      line(X(0.06), Y(0.54), X(0.56), Y(0.54), 5);
      for (let i = 0; i < 4; i++) line(X(0.1 + i * 0.1), Y(0.2 + (i % 2) * 0.1), X(0.16 + i * 0.1), Y(0.22 + (i % 2) * 0.1), 3).setAttribute('stroke', WHITE);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rect(X(0.66 + i * 0.16), Y(0.06 + j * 0.27), R.w * 0.15, R.h * 0.25, null, 3.5);
      s('path', { d: gradDots(X(0.66), Y(0.06), R.w * 0.32, R.h * 0.53, 'down', 10, 3.2), fill: ink }, G);
      line(R.x, Y(0.68), X(1), Y(0.68), 3);
      tone(R.x, Y(0.68), R.w, R.h * 0.32, 'lines');
      for (const u of [0.1, 0.45, 0.8]) { s('path', { d: `M${X(u - 0.08)} ${Y(0.82)} L${X(u + 0.08)} ${Y(0.82)} L${X(u + 0.1)} ${Y(0.92)} L${X(u - 0.1)} ${Y(0.92)} Z`, fill: WHITE, stroke: ink, 'stroke-width': 3 }, G); }
    } else if (kind === 'office') {
      rect(X(0.02), Y(0.04), R.w * 0.96, R.h * 0.42, WHITE, 3.5);
      for (let i = 0; i < 18; i++) line(X(0.02), Y(0.06 + i * 0.022), X(0.98), Y(0.06 + i * 0.022), 1.6);
      for (let i = 1; i < 4; i++) line(X(0.02 + i * 0.24), Y(0.04), X(0.02 + i * 0.24), Y(0.46), 5);
      tone(R.x, Y(0.46), R.w, R.h * 0.54, 'light');
      for (let i = 0; i < 5; i++) { const u = 0.04 + i * 0.2; rect(X(u), Y(0.52), R.w * 0.13, R.h * 0.16, ink, 3); rect(X(u + 0.05), Y(0.68), R.w * 0.03, R.h * 0.05, WHITE, 3); }
      line(R.x, Y(0.73), X(1), Y(0.73), 5);
      s('rect', { x: R.x, y: Y(0.73), width: R.w, height: R.h * 0.27, fill: WHITE }, G);
      tone(R.x, Y(0.73), R.w, R.h * 0.27, 'mid');
    } else if (kind === 'street') {
      const vx = X(0.5), vy = Y(0.42);
      s('path', { d: gradDots(R.x, R.y, R.w, R.h * 0.42, 'up', 11, 3.4), fill: ink }, G);
      for (const sd of [-1, 1]) {
        const xe = sd < 0 ? R.x : X(1);
        for (let b = 0; b < 3; b++) {
          const u0 = 0.0 + b * 0.13, u1 = u0 + 0.12;
          const xa = lerp(xe, vx, u0), xb = lerp(xe, vx, u1), ta = lerp(Y(0.0) - R.h * 0.2 * (b === 1 ? 1 : 0), vy, u0), tb = lerp(Y(0.0) - R.h * 0.2 * (b === 1 ? 1 : 0), vy, u1), ba = lerp(Y(1), vy, u0), bb = lerp(Y(1), vy, u1);
          s('path', { d: `M${f1(xa)} ${f1(ta + R.h * 0.08)} L${f1(xb)} ${f1(tb + R.h * 0.08)} L${f1(xb)} ${f1(bb)} L${f1(xa)} ${f1(ba)} Z`, fill: WHITE, stroke: ink, 'stroke-width': 3 }, G);
          if (b % 2) s('path', { d: `M${f1(xa)} ${f1(ta + R.h * 0.08)} L${f1(xb)} ${f1(tb + R.h * 0.08)} L${f1(xb)} ${f1(bb)} L${f1(xa)} ${f1(ba)} Z`, fill: tonePat(this.svg, 'light') }, G);
          for (let r = 1; r < 5; r++) { const q = r / 5; line(lerp(xa, xb, 0.1), lerp(ta + R.h * 0.08, ba, q), lerp(xa, xb, 0.9), lerp(tb + R.h * 0.08, bb, q), 2); }
        }
      }
      s('path', { d: `M${f1(X(0.1))} ${f1(Y(1))} L${f1(vx)} ${f1(vy)} L${f1(X(0.9))} ${f1(Y(1))} Z`, fill: tonePat(this.svg, 'light') }, G);
      line(X(0.1), Y(1), vx, vy, 3); line(X(0.9), Y(1), vx, vy, 3);
      for (const u of [0.22, 0.86]) { const px = X(u); s('rect', { x: px - 9, y: R.y - 10, width: 18, height: R.h + 20, fill: ink }, G); line(px - 40, Y(0.12), px + 40, Y(0.12), 6); line(px - 30, Y(0.18), px + 30, Y(0.18), 5); }
      for (let i = 0; i < 3; i++) s('path', { d: `M${f1(X(0.22) - 40 + i * 40)} ${f1(Y(0.12))} Q${f1(X(0.54))} ${f1(Y(0.3 + i * 0.03))} ${f1(X(0.86) - 40 + i * 40)} ${f1(Y(0.12))}`, fill: 'none', stroke: ink, 'stroke-width': 2 }, G);
    } else if (kind === 'room') {
      tone(R.x, R.y, R.w, R.h, 'light');
      const wx = X(0.58), wy = Y(0.08), ww = R.w * 0.34, wh = R.h * 0.5;
      rect(wx, wy, ww, wh, ink, 7); line(wx + ww / 2, wy, wx + ww / 2, wy + wh, 6); line(wx, wy + wh / 2, wx + ww, wy + wh / 2, 6);
      s('circle', { cx: wx + ww * 0.75, cy: wy + wh * 0.25, r: Math.min(ww, wh) * 0.12, fill: WHITE }, G);
      for (const sd of [-1, 1]) { const cxw = sd < 0 ? wx - 20 : wx + ww + 20; s('path', { d: `M${f1(cxw - 30)} ${f1(wy - 20)} L${f1(cxw + 30)} ${f1(wy - 20)} C${f1(cxw + 20)} ${f1(wy + wh * 0.5)} ${f1(cxw + 40)} ${f1(wy + wh)} ${f1(cxw + 24)} ${f1(wy + wh + 30)} L${f1(cxw - 24)} ${f1(wy + wh + 30)} C${f1(cxw - 40)} ${f1(wy + wh)} ${f1(cxw - 20)} ${f1(wy + wh * 0.5)} ${f1(cxw - 30)} ${f1(wy - 20)} Z`, fill: WHITE, stroke: ink, 'stroke-width': 3 }, G); }
      rect(X(0.08), Y(0.14), R.w * 0.16, R.h * 0.3, WHITE, 3);
      line(R.x, Y(0.74), X(1), Y(0.74), 3);
      s('rect', { x: R.x, y: Y(0.74), width: R.w, height: R.h * 0.26, fill: WHITE }, G);
      tone(R.x, Y(0.74), R.w, R.h * 0.26, 'lines');
    } else if (kind === 'sky') {
      s('path', { d: gradDots(R.x, R.y, R.w, R.h * 0.7, 'up', 11, 3.6), fill: ink }, G);
      for (const [u, v, sc] of [[0.2, 0.55, 1], [0.7, 0.35, 1.3], [0.92, 0.7, 0.8]]) {
        const cx = X(u), cy = Y(v), r = Math.min(R.w, R.h) * 0.1 * sc;
        const puffs = [[-1.5, 0.15, 0.6], [-0.7, -0.35, 0.8], [0.3, -0.55, 0.95], [1.25, -0.2, 0.75], [1.9, 0.25, 0.5], [0.2, 0.2, 0.7], [-0.9, 0.3, 0.55], [1.0, 0.3, 0.6]];
        for (const [a, b, q] of puffs) s('circle', { cx: f1(cx + a * r), cy: f1(cy + b * r), r: f1(q * r), fill: 'none', stroke: ink, 'stroke-width': 7 }, G);
        for (const [a, b, q] of puffs) s('circle', { cx: f1(cx + a * r), cy: f1(cy + b * r), r: f1(q * r), fill: WHITE }, G);
        P_(G, pen([[cx - 1.2 * r, cy + 0.55 * r], [cx + 0.2 * r, cy + 0.75 * r], [cx + 1.6 * r, cy + 0.6 * r]], 4, { a: 0.3, b: 0.3 }));
      }
    } else if (kind === 'night') {
      s('rect', { x: R.x, y: R.y, width: R.w, height: R.h, fill: ink }, G);
      s('path', { d: gradDots(R.x, Y(0.55), R.w, R.h * 0.45, 'up', 9, 3.4), fill: '#555' }, G);
      s('circle', { cx: X(0.8), cy: Y(0.22), r: Math.min(R.w, R.h) * 0.09, fill: WHITE }, G);
      for (let i = 0; i < 26; i++) { const x = X(hash(i, 1)), y = Y(hash(i, 2) * 0.6), r = 1.5 + hash(i, 3) * 3; s('circle', { cx: f1(x), cy: f1(y), r: f1(r), fill: WHITE }, G); }
    } else if (kind === 'sparkle') {
      s('path', { d: gradDots(R.x, R.y, R.w, R.h, 'out', 11, 3.2), fill: ink }, G);
      for (let i = 0; i < 14; i++) { const x = X(hash(i, 11)), y = Y(hash(i, 12)), r = 14 + hash(i, 13) * 40; s('circle', { cx: f1(x), cy: f1(y), r: f1(r), fill: WHITE, stroke: ink, 'stroke-width': 2.5 }, G); s('circle', { cx: f1(x - r * 0.35), cy: f1(y - r * 0.35), r: f1(r * 0.18), fill: ink, opacity: 0.25 }, G); }
      for (let i = 0; i < 8; i++) drawEmote(G, 'sparkle', X(hash(i, 21)), Y(hash(i, 22)), 0.5 + hash(i, 23) * 0.6);
    } else {
      s('path', { d: gradDots(R.x - 10, R.y - 10, R.w + 20, R.h + 20, 'out', 9, 4.2), fill: ink }, G);
      s('rect', { x: R.x, y: R.y, width: R.w, height: R.h, fill: tonePat(this.svg, 'light') }, G);
    }
    const at = o.at ?? 0;
    this.tick((lt) => g.setAttribute('opacity', f2((lt >= at ? clamp((lt - at) / 0.12) : 0) * outK(lt, o.out))));
    return { g };
  };

  // the camera: a push centres its point, so near an edge it would show bare paper beyond the page. Keep the frame on the
  // page (and the zoom at a reader's 1.0–1.3), wherever the push is aimed.
  B.push = function (at, x, y, sc = 1.2) {
    sc = clamp(+sc || 1.2, 1, 1.3);
    const hx = W / (2 * sc), hy = H / (2 * sc);
    return { at, x: clamp(+x || W / 2, hx, W - hx), y: clamp(+y || H / 2, hy, H - hy), s: sc, dur: 0.28, ease: 'out' };
  };

  // ── the signature: the realisation splash ──────────────────────────────────────────────────────────────────
  /** realize(o): THE SIGNATURE MOVE — the moment it clicks. A black flash, then a full-frame splash panel slams onto the page over everything: concentration lines rushing at the character's face, the face huge in 'shock' (or another mood), a giant sound effect, an optional line of narration. Use it once or twice per film, on the cue of the realisation. o: { at, chara: { hair, hairTone, outfit, glasses, mood (default 'shock') } (the same look as the protagonist), side: 'left' (face at x ≈ 700, the sfx on the right; default) | 'right', sfx ('ドン'; '!!', '咚', 'ガーン', or null for none), spot: true (the sfx in the spot red: only at the film's climax), line: a caption (≤ 16 Chinese characters / 8 words), out } */
  B.realize = function (o = {}) {
    const L = (this.hud || this).layer({ z: 20 });   // on the hud: the splash fills the frame even while the camera is pushed in
    const at = o.at ?? 0, right = o.side === 'right';
    // the splash is the film's loudest picture: it holds at least 2.5 s, however early the page asks it to go
    if (o.out != null) o = { ...o, out: typeof o.out === 'number' ? Math.max(o.out, at + 2.5) : o.out };
    const fx = right ? W / 2 + 260 : W / 2 - 260, fy = 440;
    s('rect', { x: 0, y: 0, width: W, height: H, fill: WHITE }, L.svg);
    L.area = { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 };
    L.focus(fx, fy - 30, { at, r0: 330, n: 190 });
    L.chara(fx, fy, 860, { from: 'cut', ...(o.chara || {}), mood: (o.chara && o.chara.mood) || 'shock', at });
    if (o.sfx !== null) L.sfx(right ? W / 2 - 490 : W / 2 + 500, 380, o.sfx || 'ドン', { size: 250, style: o.spot ? 'spot' : 'black', at: at + 0.05, rot: right ? 8 : -10 });
    if (o.line) L.caption(right ? 120 : W / 2 + 220, 700, String(o.line), { at: at + 0.5, size: 38, w: 600 });
    s('rect', { x: 18, y: 18, width: W - 36, height: H - 36, fill: 'none', stroke: INK(), 'stroke-width': 8 }, s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: 'position:absolute;left:0;top:0;z-index:9' }, L.html));
    const flash = h('div', null, null, L.html);
    Object.assign(flash.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', background: INK(), zIndex: 10 });
    L.wrap.style.transformOrigin = `${fx}px ${fy}px`;
    this.tick((lt) => {
      const vis = (lt >= at ? 1 : 0) * outK(lt, o.out, 0.15);
      L.wrap.style.opacity = f2(vis);
      flash.style.opacity = lt >= at && lt < at + 0.07 ? '1' : '0';
      const kk = ease.out(clamp((lt - at - 0.07) / 0.2));
      const sh = lt > at && lt < at + 0.4 ? (hash(Math.floor(lt * 30), 77) - 0.5) * 16 : 0;
      L.wrap.style.transform = `translate(${f1(sh)}px, ${f1(sh * 0.6)}px) scale(${f2(lerp(1.12, 1, kk))})`;
    });
    return L;
  };
})();
