/* Math animation · kit: programmatic mathematics in motion. Clean vector lines created with a smooth ease (no wobble,
 * no pen tremor), formulas typeset in TeX by KaTeX and "written" (outline first, then the fill), coordinate planes,
 * graphs traced by a moving dot, tangents that slide, areas that accumulate, vectors, a grid that a matrix bends, shapes
 * that morph into one another, and the signature: formulas whose matching terms travel into the next line while the
 * rest fades. Every variable keeps one colour for the whole film (P.vars). Everything is a pure function of lt.
 * KaTeX is loaded by this kit itself (from the engine's own katex dependency), so no film depends on META.libs.
 * Shape helpers for P.shape: PV.M.circle, rect, poly, regular, arc, sector (each returns an SVG path d). */
(function () {
  const { h, s, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const f1 = (n) => n.toFixed(1), f2 = (n) => n.toFixed(2), f3 = (n) => n.toFixed(3);
  const smooth = ease.inOut, out = ease.out;
  const K = (lt, at, dur, e = smooth) => e(clamp((lt - at) / Math.max(1e-6, dur)));
  /** no `at` given: the object is already standing, complete, when the page opens (carried over from the last page) */
  const STAND = -30;
  const val = (v, lt) => (typeof v === 'function' ? v(lt) : v);
  let uid = 0;

  // ── KaTeX, loaded once, synchronously, before the pages (this file is a parser-inserted script) ─────────────────
  (function loadKatex() {
    if (window.katex || window.__mtKatex) return;
    window.__mtKatex = true;
    const me = (document.currentScript && document.currentScript.src) || '';
    const nmMeta = document.querySelector('meta[name="engine-modules"]');
    const m = /^(.*\/)styles\/[^/]+\/kit\.js(\?.*)?$/.exec(me);
    const NM = nmMeta ? new URL(nmMeta.content, location.href).href : m ? m[1] + 'node_modules/' : 'engine_modules/';
    const hasCss = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /katex(\.min)?\.css/.test(l.href));
    document.write((hasCss ? '' : `<link rel="stylesheet" href="${NM}katex/dist/katex.min.css">`) + `<script src="${NM}katex/dist/katex.min.js"><\/script>`);
  })();

  // ── variables keep their colour: P.vars sets the page's table, every formula and label reads it ─────────────────
  const varsOf = (P) => P.sh.mtVars || window.__mtVars || {};
  /** the colour of a variable (a key of P.vars) or a palette name */
  const vcol = (P, c, d = 'ink') => { const v = varsOf(P); return col((c != null && v[c]) || c || d); };
  const TEXT_ARG = new Set(['\\text', '\\mathrm', '\\operatorname', '\\mathbb', '\\mathcal', '\\textbf', '\\textit', '\\begin', '\\end', '\\textcolor', '\\color', '\\htmlClass', '\\mathsf', '\\texttt', '\\mathfrak', '\\textrm']);
  const groupEnd = (src, i) => { let d = 0; for (let j = i; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return j; } } return src.length - 1; };
  /** colours every variable of the table in a TeX string (skips command names and \text{…} arguments) */
  function paint(src, vars) {
    if (!vars || !Object.keys(vars).length) return src;
    let o = '', i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        let j = i + 1;
        if (/[A-Za-z]/.test(src[j] || '')) { while (j < src.length && /[A-Za-z]/.test(src[j])) j++; } else j++;
        const cmd = src.slice(i, j);
        if (TEXT_ARG.has(cmd)) { let k = j; while (src[k] === ' ') k++; if (src[k] === '{') { const e = groupEnd(src, k); o += src.slice(i, e + 1); i = e + 1; continue; } }
        o += vars[cmd] ? `{\\textcolor{${col(vars[cmd])}}{${cmd}}}` : cmd; i = j; continue;
      }
      if (/[A-Za-z]/.test(c) && vars[c]) { o += `{\\textcolor{${col(vars[c])}}{${c}}}`; i++; continue; }
      o += c; i++;
    }
    return o;
  }
  /** {{…}} marks a term (matched by its TeX between steps); {{key::…}} names it. → { tex, keys } */
  function termsOf(src) {
    let o = '', i = 0; const keys = [];
    while (i < src.length) {
      if (src[i] === '{' && src[i + 1] === '{') {
        let d = 0, j = i;
        for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
        let inner = src.slice(i + 2, j - 1), key = inner;
        const m = /^\s*([A-Za-z0-9_-]+)::/.exec(inner);
        if (m) { key = m[1]; inner = inner.slice(m[0].length); }
        o += `\\htmlClass{mt-t${keys.length}}{${inner}}`; keys.push(key.replace(/\s+/g, ''));
        i = j + 1; continue;
      }
      o += src[i]; i++;
    }
    return { tex: o, keys };
  }
  const render = (tex, el) => {
    if (!window.katex) { el.textContent = tex; return; }
    // display style (full-size fractions, limits above and below) laid out inline, as a typeset derivation looks
    katex.render('\\displaystyle ' + tex, el, { throwOnError: false, displayMode: false, output: 'html', strict: 'ignore', trust: (c) => c.command === '\\htmlClass' });
    // KaTeX's zero-width struts (a Safari workaround, at 0.05em) read as unreadably small text to the page checks
    for (const sp of el.querySelectorAll('.vlist-s')) if (sp.textContent === '\u200b') sp.textContent = '';
  };
  /** position of el inside root, in stage px, at any camera or frame scale */
  const rel = (el, root) => {
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect(), sc = root.offsetWidth ? b.width / root.offsetWidth : 1;
    return { x: (a.left - b.left) / sc, y: (a.top - b.top) / sc, w: a.width / sc, h: a.height / sc };
  };
  /** the Write reveal: the outline copy leads, the fill follows it left to right */
  const writeK = (fill, line, k) => {
    const lag = 0.32, p = k * (1 + lag), r1 = clamp(p), r2 = clamp(p - lag);
    line.style.clipPath = `inset(-45% ${f1((1 - r1) * 100)}% -45% -3%)`;
    fill.style.clipPath = r2 >= 1 ? 'none' : `inset(-45% ${f1((1 - r2) * 100)}% -45% -3%)`;
    line.style.visibility = k > 0 && k < 1 ? 'visible' : 'hidden';
    fill.style.visibility = r2 > 0 ? 'visible' : 'hidden';
  };

  // ── small drawing helpers ───────────────────────────────────────────────────────────────────────────────────
  const tipD = (x, y, ang, L = 22, W = 9) => {
    const bx = x - L * Math.cos(ang), by = y - L * Math.sin(ang), nx = -Math.sin(ang) * W, ny = Math.cos(ang) * W;
    return `M${f1(x)} ${f1(y)}L${f1(bx + nx)} ${f1(by + ny)}L${f1(bx - nx)} ${f1(by - ny)}Z`;
  };
  const stroke = (g, d, color, sw, extra = {}) => s('path', Object.assign({ d, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, extra), g);
  const dashOn = (p) => { const n = p.getTotalLength() + 1; p._n = n; p.style.strokeDasharray = `${n} ${n}`; p.style.strokeDashoffset = String(n); return p; };
  const runDash = (p, k) => { p.style.strokeDashoffset = f1(p._n * (1 - k)); p.style.visibility = k <= 0 ? 'hidden' : 'visible'; };
  const lab = (P, str, x, y, o = {}) => {
    const el = h('div', 'tx mt-lab', null, P.html);
    el.textContent = str;
    Object.assign(el.style, { left: f1(x) + 'px', top: f1(y) + 'px', fontSize: (o.size ?? 26) + 'px', color: o.color || col('soft'), transform: o.tf || 'translate(-50%, 0)' });
    return el;
  };
  /** a handle whose hide() also hides the labels the component made */
  const withKids = (hd, kids) => { const h0 = hd.hide.bind(hd); hd.hide = (t, d) => { h0(t, d); for (const k of kids) if (k) k.hide(t, d); return hd; }; return hd; };
  const poly = (pts) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L');

  // ── shape helpers (SVG path d) ─────────────────────────────────────────────────────────────────────────────
  const M = {
    /** circle(cx, cy, r): a circle, starting at its rightmost point */
    circle: (cx, cy, r) => `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}Z`,
    /** rect(x, y, w, h): a rectangle */
    rect: (x, y, w, hh) => `M${x} ${y}H${x + w}V${y + hh}H${x}Z`,
    /** poly(pts, closed=true): a polygon through [[x, y], …] */
    poly: (pts, closed = true) => poly(pts) + (closed ? 'Z' : ''),
    /** regular(cx, cy, r, n, rot=-90): a regular n-gon (rot in degrees; -90 puts a vertex on top) */
    regular: (cx, cy, r, n, rot = -90) => poly(Array.from({ length: n }, (_, i) => { const a = ((rot + (360 * i) / n) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; })) + 'Z',
    /** arc(cx, cy, r, a0, a1): an arc between two angles in degrees (0 = right, counter-clockwise as in mathematics) */
    arc: (cx, cy, r, a0, a1) => { const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 3)); return poly(Array.from({ length: n + 1 }, (_, i) => { const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; })); },
    /** sector(cx, cy, r, a0, a1): a pie slice (degrees, counter-clockwise) */
    sector: (cx, cy, r, a0, a1) => `M${cx} ${cy}L` + M.arc(cx, cy, r, a0, a1).slice(1) + 'Z',
  };
  PV.M = M;

  /**
   * vars(table): fixes the colour of every variable for this page — call it first, with the film's table from the
   * storyboard, identical on every page: P.vars({ x: 'blue', y: 'yellow', r: 'green', '\\theta': 'orange' }). Every
   * formula (P.tex, P.morph), axis label, value readout and label then paints those letters in their colour by itself.
   */
  B.vars = function (table) { this.sh.mtVars = Object.assign({}, table); window.__mtVars = this.sh.mtVars; return this.sh.mtVars; };

  // ── formulas: one or more TeX steps in one place; step 0 is written, each later step takes over by matching terms ─
  function formula(P, steps, o) {
    if (o.fixed && P.hud) P = P.hud;
    const vars = varsOf(P), size = o.size ?? (steps.length > 1 ? 88 : 64), align = o.align || 'l', af = align === 'c' ? 0.5 : align === 'r' ? 1 : 0;
    const box = h('div', 'tx mt-box', null, P.html);
    box.style.fontSize = size + 'px';
    box.style.color = vcol(P, o.color);
    const S = steps.map((src) => {
      const { tex, keys } = termsOf(String(src));
      const L = h('div', 'mt-f', null, box);
      render(paint(tex, vars), L);
      const Mv = L.cloneNode(true); Mv.style.visibility = 'hidden'; box.appendChild(Mv);
      return { L, Mv, keys, terms: keys.map((_, n) => L.querySelector('.mt-t' + n)), movers: keys.map((_, n) => Mv.querySelector('.mt-t' + n)), pos: [], w: 0, h: 0, x: 0, y: 0 };
    });
    const OL = S[0].L.cloneNode(true); OL.classList.add('mt-ol'); box.appendChild(OL);
    // matches between step i-1 and step i: same key, nth occurrence with nth occurrence
    const match = S.map((st, i) => {
      if (!i) return [];
      const prev = S[i - 1], used = new Set(), mm = [];
      st.keys.forEach((k, n) => { const j = prev.keys.findIndex((pk, jj) => pk === k && !used.has(jj)); if (j >= 0) { used.add(j); mm.push([j, n]); } });
      return mm;
    });
    let ok = false, W = 0, H = 0;
    const measure = () => {
      if (ok) return;
      W = 0; H = 0;
      for (const st of S) { st.w = st.L.offsetWidth; st.h = st.L.offsetHeight; W = Math.max(W, st.w); H = Math.max(H, st.h); }
      if (!W) return;
      for (const st of S) {
        st.x = (W - st.w) * af; st.y = (H - st.h) / 2;
        for (const el of [st.L, st.Mv]) { el.style.left = f1(st.x) + 'px'; el.style.top = f1(st.y) + 'px'; }
      }
      Object.assign(OL.style, { left: S[0].L.style.left, top: S[0].L.style.top });
      for (const st of S) st.pos = st.terms.map((el) => (el ? rel(el, st.L) : { x: 0, y: 0, w: 1, h: 1 }));
      const va = o.valign || 't';
      Object.assign(box.style, { left: f1(o.x - W * af) + 'px', top: f1(o.y - (va === 'm' ? H / 2 : va === 'b' ? H : 0)) + 'px', width: f1(W) + 'px', height: f1(H) + 'px' });
      ok = true;
    };
    measure();
    const at = o.at ?? STAND, wdur = o.dur ?? clamp(0.45 + 0.05 * String(steps[0]).replace(/\\[A-Za-z]+|[{}^_ ]/g, '').length, 0.6, 1.8);
    const tdur = o.tdur ?? 1.1, times = [];
    for (const t of [].concat(o.times ?? [])) times.push(times.length ? Math.max(t, times[times.length - 1] + tdur + 0.3) : Math.max(t, at + wdur + 0.2));   // one transition at a time, never before the write ends
    const apply = (lt) => {
      measure();
      // which step is on, and how far into its transition
      let i = 0;
      for (let q = 0; q < times.length; q++) if (lt >= times[q]) i = q + 1;
      const k = i ? clamp((lt - times[i - 1]) / tdur) : 1, e = smooth(k);
      S.forEach((st, n) => {
        const on = n === i, before = n === i - 1 && k < 1;
        st.L.style.visibility = on || before ? 'visible' : 'hidden';
        st.Mv.style.visibility = 'hidden';
        for (const t of st.movers) if (t) { t.style.visibility = ''; t.style.transform = ''; }
        for (const t of st.terms) if (t) t.style.visibility = '';
        st.L.style.opacity = '1';
      });
      if (!i) { writeK(S[0].L, OL, K(lt, at, wdur, ease.lin)); return; }
      OL.style.visibility = 'hidden'; S[0].L.style.clipPath = 'none';
      if (k >= 1) return;
      const A = S[i - 1], Bs = S[i];
      A.L.style.opacity = f3(1 - clamp(k / 0.3));
      Bs.L.style.opacity = f3(clamp((k - 0.65) / 0.35));
      for (const [ja, nb] of match[i]) {
        const ta = A.terms[ja], tb = Bs.terms[nb], mv = Bs.movers[nb];
        if (ta) ta.style.visibility = 'hidden';
        if (tb) tb.style.visibility = 'hidden';
        if (!mv) continue;
        const pa = A.pos[ja], pb = Bs.pos[nb];
        const dx = A.x + pa.x - (Bs.x + pb.x), dy = A.y + pa.y - (Bs.y + pb.y), sc = pb.w ? pa.w / pb.w : 1;
        // matched terms travel on a shallow arc, so a term crossing another reads as moving, not swapping
        const lift = -Math.sin(Math.PI * e) * Math.min(26, Math.abs(dx) * 0.08);
        mv.style.visibility = 'visible';
        mv.style.transform = `translate(${f1(dx * (1 - e))}px, ${f1(dy * (1 - e) + lift)}px) scale(${f3(lerp(sc, 1, e))})`;
      }
    };
    const a = P.act({ at, dur: Math.max(wdur, times.length ? times[times.length - 1] + tdur - at : 0), g: box, kind: 'draw', pen: false, apply: () => {} });
    P.tick(apply);
    const hd = P.handle(a, box);
    /** stage box of a term (its key) in step `step` (default: the last step that has it), or of the whole formula */
    hd.box = (key, step) => {
      measure();
      const bx = parseFloat(box.style.left) || 0, by = parseFloat(box.style.top) || 0;
      if (key == null) return { x: bx, y: by, w: W, h: H };
      let si = step;
      if (si == null) for (let q = S.length - 1; q >= 0; q--) if (S[q].keys.includes(String(key).replace(/\s+/g, ''))) { si = q; break; }
      const st = S[si ?? 0], n = st.keys.indexOf(String(key).replace(/\s+/g, ''));
      if (n < 0) return { x: bx + st.x, y: by + st.y, w: st.w, h: st.h };
      const p = st.pos[n];
      return { x: bx + st.x + p.x, y: by + st.y + p.y, w: p.w, h: p.h };
    };
    hd.writeEnd = at + wdur;
    return hd;
  }

  /**
   * tex(latex, o): a formula typeset in TeX and written on (outline first, then the fill), with the page's variables in
   * their colours. Mark terms you will point at with {{…}} ({{key::…}} to name one): handle.box(key) → { x, y, w, h }.
   * o: { x, y (top; valign 'm' makes y the middle), size (64; the lead formula 80–110, secondary ≥ 52), color ('ink'), align 'l'|'c'|'r', at, dur (write), fixed (true:
   * on the glass, still while the camera zooms) }.
   * Formulas are the main text of this style: 56–96px for the formula the narration reads, ≥ 40px for labels.
   */
  B.tex = function (src, o = {}) { return formula(this, [src], o); };

  /**
   * morph(steps, o): THE signature move — a derivation that stays in one place. steps[0] is written at o.at; at each
   * o.times[i] the formula becomes steps[i+1]: terms wrapped in {{…}} with the same TeX (or the same {{key::…}}) travel
   * to their new places, everything else fades out and the new parts fade in. Wrap every symbol that should travel,
   * operators included: '{{a^2}} {{+}} {{b^2}} {{=}} {{c^2}}' → '{{a^2}} {{=}} {{c^2}} {{-}} {{b^2}}'.
   * o: { x, y, size (88), align ('c' recommended), at, times: [t1, t2, …], tdur (1.1 per transition), color, valign, fixed }.
   * handle.box(key, step) gives a term's box (for P.surround / P.brace). Three to five steps on one page at most.
   */
  B.morph = function (steps, o = {}) { return formula(this, steps, Object.assign({ align: 'c' }, o)); };

  /**
   * surround(target, key, o): a thin rectangle created around one term of a formula (target = a P.tex/P.morph handle
   * and the term's key) or around a box ([x, y, w, h], key = null). Use it on the word that names the term.
   * o: { at, dur (0.6), color (the term's variable colour, or 'ink'), pad (14), step (morph step), label (TeX under it),
   * lsize (44), above (label above instead), out }.
   */
  B.surround = function (target, key, o = {}) {
    const bx = Array.isArray(target) ? { x: target[0], y: target[1], w: target[2], h: target[3] } : target.box(key, o.step);
    const pad = o.pad ?? 14, at = o.at ?? 0, dur = o.dur ?? 0.6, color = vcol(this, o.color);
    const g = s('g', {}, this.svg);
    const x = bx.x - pad, y = bx.y - pad * 0.7, w = bx.w + pad * 2, hh = bx.h + pad * 1.4;
    const p = dashOn(stroke(g, `M${f1(x)} ${f1(y)}H${f1(x + w)}V${f1(y + hh)}H${f1(x)}Z`, color, o.sw ?? 3, { 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter' }));
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: (k) => runDash(p, smooth(k)) });
    const lb = o.label ? this.tex(o.label, { x: x + w / 2, y: o.above ? y - 12 : y + hh + 12, valign: o.above ? 'b' : 't', align: 'c', size: o.lsize ?? 44, at: at + dur * 0.6, color: o.lcolor || o.color }) : null;
    return withKids(this.handle(a, g), [lb]);
  };

  /**
   * brace(x1, y1, x2, y2, o): a curly brace along a segment, grown from its middle, with a TeX label at its tip. The
   * brace bulges to the right of the walk from point 1 to point 2: left→right = below, bottom→top = right side.
   * Also brace(handle, key, o): under one term of a formula. o: { at, dur (0.6), color ('soft'), depth (16–30 by length), label
   * (TeX), lsize (48), lcolor, gap (14), sw (thickness, 8), out }.
   */
  B.brace = function (x1, y1, x2, y2, o) {
    if (typeof x1 === 'object') { const bx = x1.box(y1, x2 && x2.step); o = x2 || {}; return this.brace(bx.x, bx.y + bx.h + 8, bx.x + bx.w, bx.y + bx.h + 8, o); }
    o = o || {};
    const at = o.at ?? 0, dur = o.dur ?? 0.6, color = vcol(this, o.color, 'soft');
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, q = o.depth ?? clamp(L * 0.06, 16, 30), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
    const P2 = (t, n) => [x1 + ux * t + nx * n, y1 + uy * t + ny * n];
    const m = L / 2, c = Math.min(q * 1.1, L / 4), W = o.sw ?? 8;
    // the centre line of each half, from the tip out to its end (two quarter-turns joined by a straight run)
    const halfPts = (sg) => {
      const T = (t) => m - sg * (m - t), out = [], cub = (p0, p1, p2, p3, n) => { for (let i = 0; i <= n; i++) { const u = i / n, v = 1 - u; out.push([v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]); } };
      cub(P2(m, q), P2(m, q * 0.5), P2(T(m - c * 0.5), q * 0.5), P2(T(m - c), q * 0.5), 14);
      out.push(P2(T(c), q * 0.5));
      cub(P2(T(c), q * 0.5), P2(T(c * 0.5), q * 0.5), P2(T(0), q * 0.5), P2(T(0), 0), 14);
      return out;
    };
    const g = s('g', {}, this.svg), masks = [];
    for (const sg of [1, -1]) {
      const pts = halfPts(sg), n = pts.length, acc = [0];
      for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const tot = acc[n - 1] || 1, left = [], right = [];
      // thick along the run, tapering to a point at the tip and a fine end
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
        const sN = acc[i] / tot, w = (W / 2) * Math.max(0.12, Math.min(1, sN / 0.18, (1 - sN) / 0.22));
        left.push([p[0] - (dy / dl) * w, p[1] + (dx / dl) * w]); right.push([p[0] + (dy / dl) * w, p[1] - (dx / dl) * w]);
      });
      const id = 'mtb' + ++uid, mk = s('mask', { id, maskUnits: 'userSpaceOnUse', x: -200, y: -200, width: STAGE.w + 400, height: STAGE.h + 400 }, s('defs', {}, g));
      masks.push(dashOn(stroke(mk, poly(pts), '#fff', W + 14)));
      s('path', { d: poly(left) + 'L' + right.reverse().map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + 'Z', fill: color, mask: `url(#${id})` }, g);
    }
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: (k) => masks.forEach((p) => runDash(p, smooth(k))) });
    let lb = null;
    if (o.label) {
      const gap = o.gap ?? 14, tx = x1 + ux * m + nx * (q + gap), ty = y1 + uy * m + ny * (q + gap);
      const side = Math.abs(nx) > Math.abs(ny);
      lb = this.tex(o.label, { x: tx, y: ty, size: o.lsize ?? 48, at: at + dur * 0.6, color: o.lcolor, align: side ? (nx > 0 ? 'l' : 'r') : 'c', valign: side ? 'm' : ny > 0 ? 't' : 'b' });
    }
    return withKids(this.handle(a, g), [lb]);
  };

  /**
   * plane(o): coordinate axes with ticks and numbers — the stage of most pages. Axes are created from the origin
   * outward, then the ticks, then the numbers. Returns A: A.p(x, y) → [px, py] on stage, A.X(x), A.Y(y), A.ux / A.uy
   * (px per unit), A.ox / A.oy (the origin). o: { x: [min, max, step] ([-5, 5, 1]), y: [min, max, step] ([-3, 3, 1]),
   * box: [left, top, width, height] of the plotting area ([200, 190, 1100, 660]: the left 60% of the frame, full height;
   * [200, 190, 1480, 660] when nothing sits beside it — never smaller than 1000 wide or 560 tall), equal (true: same px per unit on both
   * axes — use for geometry, vectors and matrices), grid (false; true draws the background grid lines of a number
   * plane), nums (true), labels (['x', 'y'], TeX, coloured by P.vars; null for none), at, dur (0.9), color ('soft') }.
   */
  B.plane = function (o = {}) {
    const [x0, x1, xs] = o.x || [-5, 5, 1], [y0, y1, ys] = o.y || [-3, 3, 1];
    let [bx, by, bw, bh] = o.box || [STAGE.area.x0 + 60, STAGE.area.y0 + 10, 1100, 660];
    let ux = bw / (x1 - x0), uy = bh / (y1 - y0);
    if (o.equal) { const u = Math.min(ux, uy); bx += (bw - u * (x1 - x0)) / 2; by += (bh - u * (y1 - y0)) / 2; bw = u * (x1 - x0); bh = u * (y1 - y0); ux = uy = u; }
    const X = (v) => bx + (v - x0) * ux, Y = (v) => by + (y1 - v) * uy;
    const ax0 = clamp(0, y0, y1), ay0 = clamp(0, x0, x1);   // where the axes cross
    const at = o.at ?? STAND, dur = o.dur ?? 0.9, color = col(o.color || 'soft');
    const g = s('g', { class: 'mt-plane' }, this.svg);
    const lines = [];
    if (o.grid) {
      const gg = s('g', {}, g);
      for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) if (Math.abs(v) > 1e-9) lines.push(dashOn(stroke(gg, `M${f1(X(v))} ${f1(Y(ax0))}V${f1(Y(y1))}M${f1(X(v))} ${f1(Y(ax0))}V${f1(Y(y0))}`, '#24384A', 1.6, { 'stroke-linecap': 'butt' })));
      for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) if (Math.abs(v) > 1e-9) lines.push(dashOn(stroke(gg, `M${f1(X(ay0))} ${f1(Y(v))}H${f1(X(x1))}M${f1(X(ay0))} ${f1(Y(v))}H${f1(X(x0))}`, '#24384A', 1.6, { 'stroke-linecap': 'butt' })));
    }
    const ox = X(ay0), oy = Y(ax0);
    const axes0 = [`M${f1(ox)} ${f1(oy)}H${f1(X(x1) + 18)}`, `M${f1(ox)} ${f1(oy)}H${f1(X(x0))}`, `M${f1(ox)} ${f1(oy)}V${f1(Y(y1) - 18)}`, `M${f1(ox)} ${f1(oy)}V${f1(Y(y0))}`]; const axes = axes0.map((d) => dashOn(stroke(g, d, color, o.sw ?? 3, { 'stroke-linecap': 'butt' })));
    const heads = [s('path', { d: tipD(X(x1) + 30, oy, 0, 20, 8), fill: color }, g), s('path', { d: tipD(ox, Y(y1) - 30, -Math.PI / 2, 20, 8), fill: color }, g)];
    const ticks = [], nums = [];
    const tk = s('g', {}, g);
    const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(+v.toFixed(2))).replace('-', '−');
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
      if (Math.abs(v) < 1e-9) continue;
      ticks.push(stroke(tk, `M${f1(X(v))} ${f1(oy - 9)}V${f1(oy + 9)}`, color, 2.2, { 'stroke-linecap': 'butt' }));
      if (o.nums !== false) nums.push(lab(this, fmt(v), X(v), oy + 18, { size: o.nsize ?? 30, color }));
    }
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
      if (Math.abs(v) < 1e-9) continue;
      ticks.push(stroke(tk, `M${f1(ox - 9)} ${f1(Y(v))}H${f1(ox + 9)}`, color, 2.2, { 'stroke-linecap': 'butt' }));
      if (o.nums !== false) nums.push(lab(this, fmt(v), ox - 20, Y(v) - (o.nsize ?? 30) * 0.5, { size: o.nsize ?? 30, color, tf: 'translate(-100%, 0)' }));
    }
    const a = this.act({ at, dur: dur + 0.6, g, kind: 'draw', pen: false, apply: (k, lt, vis) => {
      const t = lt - at, ka = smooth(clamp(t / dur));
      lines.forEach((p, i) => runDash(p, smooth(clamp((t - 0.1 - (i % 12) * 0.02) / (dur * 0.9)))));
      axes.forEach((p) => runDash(p, ka));
      heads.forEach((p) => { p.style.opacity = f2(clamp((t - dur * 0.85) / 0.15)); });
      tk.style.opacity = f2(clamp((t - dur * 0.6) / 0.3));
      nums.forEach((el, i) => { el.style.opacity = f2(clamp((t - dur * 0.7 - (i % 10) * 0.02) / 0.3) * vis); });
    } });
    const labels = o.labels === undefined ? ['x', 'y'] : o.labels;
    const kl = [];
    if (labels && labels[0]) kl.push(this.tex(labels[0], { x: X(x1) + 44, y: oy, valign: 'm', size: o.lsize ?? 50, at: at + dur * 0.8 }));
    if (labels && labels[1]) kl.push(this.tex(labels[1], { x: ox + 30, y: Y(y1) - 12, valign: 'm', size: o.lsize ?? 50, at: at + dur * 0.8 }));
    const A = { X, Y, p: (x, y) => [X(x), Y(y)], ux, uy, ox, oy, x0, x1, y0, y1, box: [bx, by, bw, bh], end: at + dur + 0.6, el: g, hide: (t, d) => { a.out = t; a.outDur = d ?? 0.5; for (const k of kl) k.hide(t, d); } };
    /** A.p(x, y) → [px, py]: a point of the plane on the stage (A.X(x), A.Y(y) for one coordinate) */
    return A;
  };

  /** samples of a function (or a parametric curve) as stage points, broken where the curve leaves the plane */
  function curvePts(A, f, o) {
    const out = [[]], n = o.samples ?? 260, para = !!o.t;
    const [t0, t1] = o.t || [o.from ?? A.x0, o.to ?? A.x1];
    const ylo = A.y0 - (A.y1 - A.y0) * 0.08, yhi = A.y1 + (A.y1 - A.y0) * 0.08;
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const [x, y] = para ? f(t) : [t, f(t)];
      if (!Number.isFinite(y) || y < ylo || y > yhi) { if (out[out.length - 1].length) out.push([]); continue; }
      out[out.length - 1].push(A.p(x, y));
    }
    return out.filter((q) => q.length > 1);
  }
  const ptsD = (segs) => segs.map(poly).join('');

  /**
   * graph(A, f, o): the graph of y = f(x) on plane A, created left to right with a smooth ease; or a parametric curve
   * with o.t: [t0, t1] and f(t) → [x, y]. o: { from, to (x range; default the plane's), color (a variable key like 'y'
   * or a palette name; default 'blue'), sw (5), at, dur (1.4), label (TeX, e.g. 'f(x)=x^2'), lx (the x where the label
   * sits, default 85% along), ldy (label offset px, -60 = above), dashed, out }. Returns a handle with .pt(x) → [px, py].
   */
  B.graph = function (A, f, o = {}) {
    const at = o.at ?? STAND, dur = o.dur ?? 1.4, color = vcol(this, o.color, 'blue');
    const g = s('g', {}, this.svg);
    const p = dashOn(stroke(g, ptsD(curvePts(A, f, o)), color, o.sw ?? 5));
    let dash = null;
    if (o.dashed) { dash = p.cloneNode(); dash.style.strokeDasharray = '14 12'; dash.style.strokeDashoffset = '0'; const id = 'mtm' + ++uid; const mk = s('mask', { id, maskUnits: 'userSpaceOnUse', x: -200, y: -200, width: STAGE.w + 400, height: STAGE.h + 400 }, s('defs', {}, g)); const mp = p.cloneNode(); mp.setAttribute('stroke', '#fff'); mp.setAttribute('stroke-width', 12); mk.appendChild(mp); dash.setAttribute('mask', `url(#${id})`); g.appendChild(dash); p.style.opacity = '0'; p._mp = mp; }
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: (k) => { runDash(p, smooth(k)); if (p._mp) { p._mp.style.strokeDasharray = p.style.strokeDasharray; p._mp.style.strokeDashoffset = p.style.strokeDashoffset; } } });
    let glab = null;
    if (o.label) {
      const lx = o.lx ?? (o.t ? null : (o.from ?? A.x0) + ((o.to ?? A.x1) - (o.from ?? A.x0)) * 0.85);
      if (lx != null) { const [px, py] = A.p(lx, f(lx)); glab = this.tex(o.label, { x: px + (o.ldx ?? 16), y: py + (o.ldy ?? -60), valign: 'm', size: o.lsize ?? 50, color: o.lcolor ?? o.color ?? 'blue', at: at + dur * 0.85, align: o.lalign || 'l' }); }
    }
    const hd = withKids(this.handle(a, g), [glab]);
    hd.pt = (x) => A.p(x, f(x));
    return hd;
  };

  /**
   * trace(A, f, xOf, o): a dot riding the graph of f at x = xOf(lt), with dashed drop lines to both axes and its
   * coordinates read out where they meet the axes — the way this medium shows "as x moves, y follows". With o.trail
   * the dot draws the graph behind itself from where it started. o: { at, color (dot, default the curve's 'blue'), drop
   * (true), readout (true: x and y values on the axes), decimals (1), xcolor ('x' var), ycolor ('y' var), trail (false),
   * tcolor, r (dot radius 10), out }.
   */
  B.trace = function (A, f, xOf, o = {}) {
    const at = o.at ?? 0, color = vcol(this, o.color, 'blue'), r = o.r ?? 10;
    const g = s('g', {}, this.svg);
    const trail = o.trail ? stroke(g, '', vcol(this, o.tcolor ?? o.color, 'blue'), o.sw ?? 5) : null;
    const dx = stroke(g, '', vcol(this, o.xcolor ?? 'x', 'soft'), 2, { 'stroke-dasharray': '8 8', 'stroke-linecap': 'butt', opacity: 0.85 });
    const dy = stroke(g, '', vcol(this, o.ycolor ?? 'y', 'soft'), 2, { 'stroke-dasharray': '8 8', 'stroke-linecap': 'butt', opacity: 0.85 });
    const dot = s('circle', { r, fill: color }, g);
    const rx = o.readout !== false ? h('div', 'tx mt-num', null, this.html) : null, ry = o.readout !== false ? h('div', 'tx mt-num', null, this.html) : null;
    if (rx) Object.assign(rx.style, { fontSize: '34px', color: vcol(this, o.xcolor ?? 'x', 'soft') });
    if (ry) Object.assign(ry.style, { fontSize: '34px', color: vcol(this, o.ycolor ?? 'y', 'soft') });
    const fmt = (v) => v.toFixed(o.decimals ?? 1).replace('-', '−');
    const x0 = xOf(at);
    const a = this.act({ at, dur: 0.3, g, kind: 'draw', pen: false, apply: () => {} });
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      for (const el of [rx, ry]) if (el) el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const k = out(clamp((lt - at) / 0.3)), x = xOf(lt), y = f(x), [px, py] = A.p(x, y);
      dot.setAttribute('cx', f1(px)); dot.setAttribute('cy', f1(py)); dot.setAttribute('r', f2(r * k));
      const show = o.drop !== false;
      dx.setAttribute('d', show ? `M${f1(px)} ${f1(py)}V${f1(A.oy)}` : ''); dy.setAttribute('d', show ? `M${f1(px)} ${f1(py)}H${f1(A.ox)}` : '');
      dx.style.opacity = dy.style.opacity = f2(k * 0.85);
      if (trail) { const lo = Math.min(x0, x), hi = Math.max(x0, x); trail.setAttribute('d', hi - lo > 1e-6 ? ptsD(curvePts(A, f, { from: lo, to: hi, samples: 160 })) : ''); }
      const vis = a.out != null ? 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt) : 1;
      if (rx) { rx.textContent = fmt(x); Object.assign(rx.style, { left: f1(px) + 'px', top: f1(A.oy + (y >= 0 ? 58 : -96)) + 'px', transform: 'translate(-50%, 0)', opacity: f2(k * vis) }); }
      if (ry) { ry.textContent = fmt(y); Object.assign(ry.style, { left: f1(A.ox + (x >= 0 ? -66 : 66)) + 'px', top: f1(py) + 'px', transform: x >= 0 ? 'translate(-100%, -50%)' : 'translate(0, -50%)', opacity: f2(k * vis) }); }
    });
    return this.handle(a, g);
  };

  /**
   * tangent(A, f, xOf, o): the tangent line to f at x = xOf(lt), sliding along the curve as x moves, with its point
   * and an optional slope readout riding with it. The derivative made visible. o: { at, len (px, 560), color ('orange'),
   * sw (4), slope (true: show 'slope = …' next to the point), decimals (2), label (TeX instead of 'slope'), out }.
   */
  B.tangent = function (A, f, xOf, o = {}) {
    const at = o.at ?? 0, color = vcol(this, o.color, 'orange'), len = o.len ?? 560;
    const g = s('g', {}, this.svg);
    const ln = stroke(g, '', color, o.sw ?? 4);
    const dot = s('circle', { r: 8, fill: color }, g);
    const rd = o.slope === false ? null : h('div', 'tx mt-num', null, this.html);
    if (rd) Object.assign(rd.style, { fontSize: '40px', color });
    let head = '';
    if (rd && window.katex) { const t = h('span', null, null, null); render(paint(o.label || '\\text{slope}', varsOf(this)) + '=', t); head = t.innerHTML; }
    const a = this.act({ at, dur: 0.5, g, kind: 'draw', pen: false, apply: () => {} });
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (rd) rd.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const k = smooth(clamp((lt - at) / 0.5)), x = xOf(lt), e = 1e-4 * (A.x1 - A.x0);
      const m = (f(x + e) - f(x - e)) / (2 * e), [px, py] = A.p(x, f(x));
      let vx = A.ux, vy = -m * A.uy; const n = Math.hypot(vx, vy); vx /= n; vy /= n;
      const L = (len / 2) * k;
      ln.setAttribute('d', `M${f1(px - vx * L)} ${f1(py - vy * L)}L${f1(px + vx * L)} ${f1(py + vy * L)}`);
      dot.setAttribute('cx', f1(px)); dot.setAttribute('cy', f1(py));
      if (rd) {
        const vis = a.out != null ? 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt) : 1;
        const sv = m.toFixed(o.decimals ?? 2).replace('-', '−');
        if (rd._v !== sv) { rd._v = sv; rd.innerHTML = head + '&nbsp;' + sv; }
        // beside the point, on the side away from the line's upward direction
        Object.assign(rd.style, { left: f1(px + (m >= 0 ? 26 : -26)) + 'px', top: f1(py + 24) + 'px', transform: m >= 0 ? 'none' : 'translate(-100%, 0)', opacity: f2(clamp((lt - at - 0.3) / 0.3) * vis) });
      }
    });
    return this.handle(a, g);
  };

  /**
   * area(A, f, a, b, o): the area under f between x = a and x = b, accumulating left to right with a bright front edge.
   * b can be a number (it sweeps from a to b over dur) or a function of lt (the area follows it). With o.rects the area
   * is n Riemann rectangles instead (a number, or lt => n so they refine on cue). o: { at, dur (1.6), color ('blue'),
   * op (fill opacity 0.32), rects, rule 'left'|'mid'|'right' ('mid'), label (TeX at the area's centre, after it
   * fills), lsize (48), out }.
   */
  B.area = function (A, f, a0, b, o = {}) {
    const at = o.at ?? STAND, dur = o.dur ?? 1.6, color = vcol(this, o.color, 'blue');
    const g = s('g', {}, this.svg);
    const fill = s('path', { d: '', fill: color, 'fill-opacity': o.op ?? 0.32, stroke: 'none' }, g);
    const edge = stroke(g, '', color, 3, { 'stroke-linecap': 'butt' });
    const rg = s('g', {}, g);
    const bOf = (lt) => (typeof b === 'function' ? b(lt) : lerp(a0, b, smooth(clamp((lt - at) / dur))));
    const a = this.act({ at, dur: typeof b === 'function' ? 0.4 : dur, g, kind: 'draw', pen: false, apply: () => {} });
    let lastN = -1;
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const bb = bOf(lt);
      if (o.rects) {
        const n = Math.max(1, Math.round(val(o.rects, lt)));
        const bEnd = typeof b === 'function' ? bb : b;
        if (n !== lastN || typeof b === 'function') {
          lastN = n; rg.textContent = '';
          for (let i = 0; i < n; i++) {
            const xl = a0 + (bEnd - a0) * (i / n), xr = a0 + (bEnd - a0) * ((i + 1) / n);
            const xm = o.rule === 'left' ? xl : o.rule === 'right' ? xr : (xl + xr) / 2;
            const X0 = A.X(xl), X1 = A.X(xr), Y0 = A.Y(0), Y1 = A.Y(f(xm));
            s('path', { d: `M${f1(X0)} ${f1(Y0)}V${f1(Y1)}H${f1(X1)}V${f1(Y0)}Z`, fill: color, 'fill-opacity': o.op ?? 0.55, stroke: '#0E0F12', 'stroke-width': n > 40 ? 0.8 : 2 }, rg);
          }
        }
        rg.style.opacity = f2(clamp((lt - at) / 0.4));
        fill.setAttribute('d', ''); edge.setAttribute('d', '');
        return;
      }
      if (bb - a0 < 1e-6) { fill.setAttribute('d', ''); edge.setAttribute('d', ''); return; }
      const segs = curvePts(A, f, { from: a0, to: bb, samples: 160 });
      const pts = segs.flat();
      if (!pts.length) return;
      fill.setAttribute('d', `M${f1(A.X(a0))} ${f1(A.Y(0))}L` + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + `L${f1(A.X(bb))} ${f1(A.Y(0))}Z`);
      edge.setAttribute('d', `M${f1(A.X(bb))} ${f1(A.Y(0))}V${f1(A.Y(f(bb)))}`);
      edge.style.opacity = typeof b === 'function' ? '1' : f2(1 - clamp((lt - at - dur) / 0.4));
    });
    let alab = null;
    if (o.label && typeof b !== 'function') { const xm = (a0 + b) / 2; alab = this.tex(o.label, { x: A.X(xm), y: (A.Y(0) + A.Y(f(xm))) / 2, align: 'c', valign: 'm', size: o.lsize ?? 48, at: at + dur + 0.1 }); }
    return withKids(this.handle(a, g), [alab]);
  };

  /**
   * numline(x, y, w, o): a number line from x to x + w at height y, with ticks and numbers; with o.marker a pointer
   * slides along it (lt => value) carrying its value. Returns { X(v) → px, end }. o: { range: [min, max, step] ([0, 10,
   * 1]), at, dur (0.8), color ('soft'), nums (true), nsize (34), marker (lt => v), mcolor ('yellow' or a variable key),
   * mlabel (TeX over the pointer, e.g. 'x'), decimals (1), arrows (true: both ends), out }.
   */
  B.numline = function (x, y, w, o = {}) {
    const [v0, v1, st] = o.range || [0, 10, 1], at = o.at ?? STAND, dur = o.dur ?? 0.8, color = col(o.color || 'soft');
    const X = (v) => x + ((v - v0) / (v1 - v0)) * w;
    const g = s('g', {}, this.svg);
    const ext = 34;
    const ln = dashOn(stroke(g, `M${f1(x - ext)} ${y}H${f1(x + w + ext)}`, color, 3, { 'stroke-linecap': 'butt' }));
    const heads = o.arrows === false ? [] : [s('path', { d: tipD(x + w + ext + 14, y, 0, 18, 7), fill: color }, g), s('path', { d: tipD(x - ext - 14, y, Math.PI, 18, 7), fill: color }, g)];
    const ticks = [], nums = [];
    for (let v = v0, i = 0; v <= v1 + 1e-9; v += st, i++) {
      ticks.push(stroke(g, `M${f1(X(v))} ${y - 12}V${y + 12}`, color, 2.2, { 'stroke-linecap': 'butt' }));
      if (o.nums !== false) nums.push(lab(this, (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(+v.toFixed(2))).replace('-', '−'), X(v), y + 26, { size: o.nsize ?? 34, color }));
    }
    const a = this.act({ at, dur: dur + 0.4, g, kind: 'draw', pen: false, apply: (k, lt, vis) => {
      const t = lt - at;
      runDash(ln, smooth(clamp(t / dur)));
      heads.forEach((p) => { p.style.opacity = f2(clamp((t - dur * 0.85) / 0.15)); });
      ticks.forEach((p, i) => { p.style.opacity = f2(clamp((t - dur * 0.3 - (i / ticks.length) * dur * 0.6) / 0.15)); });
      nums.forEach((el, i) => { el.style.opacity = f2(clamp((t - dur * 0.45 - (i / nums.length) * dur * 0.6) / 0.2) * vis); });
    } });
    if (o.marker) {
      const mc = vcol(this, o.mcolor, 'yellow');
      const mg = s('g', {}, this.svg), tri = s('path', { d: '', fill: mc }, mg);
      const num = h('div', 'tx mt-num', null, this.html);
      Object.assign(num.style, { fontSize: '44px', color: mc, transform: 'translate(-50%, 0)' });
      let head = '';
      if (o.mlabel && window.katex) { const t = h('span', null, null, null); render(paint(o.mlabel, varsOf(this)) + '=', t); head = t.innerHTML + '&nbsp;'; }
      const m0 = at + dur * 0.8;
      this.tick((lt) => {
        const on = lt >= m0, vis = a.out != null ? 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt) : 1;
        mg.style.visibility = num.style.visibility = on ? 'visible' : 'hidden';
        if (!on) return;
        const v = o.marker(lt), px = X(clamp(v, v0 - (v1 - v0) * 0.05, v1 + (v1 - v0) * 0.05)), k = out(clamp((lt - m0) / 0.3));
        tri.setAttribute('d', `M${f1(px)} ${f1(y - 16)}L${f1(px - 13)} ${f1(y - 40)}L${f1(px + 13)} ${f1(y - 40)}Z`);
        mg.style.opacity = f2(k * vis);
        const sv = v.toFixed(o.decimals ?? 1).replace('-', '−');
        if (num._v !== sv) { num._v = sv; num.innerHTML = head + sv; }
        Object.assign(num.style, { left: f1(px) + 'px', top: f1(y - 108) + 'px', opacity: f2(k * vis) });
      });
    }
    return Object.assign(this.handle(a, g), { X });
  };

  /**
   * arrow(x1, y1, x2, y2, o): a clean straight (or bent) arrow with a solid triangular tip, created from its tail.
   * o: { at, dur (0.6), color ('soft' or a variable key), sw (3), bend (curvature, e.g. 0.2), dashed, head (tip length
   * 20), out }. For maps between things: "this becomes that", "plug in".
   */
  B.arrow = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.6, color = vcol(this, o.color, 'soft'), hl = o.head ?? 20;
    const bend = o.bend ?? 0, mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const g = s('g', {}, this.svg);
    const d = bend ? `M${x1} ${y1}Q${f1(mx)} ${f1(my)} ${x2} ${y2}` : `M${x1} ${y1}L${x2} ${y2}`;
    const probe = s('path', { d }, g), L = probe.getTotalLength();
    const e = probe.getPointAtLength(L), pre = probe.getPointAtLength(Math.max(0, L - 4)); probe.remove();
    const ang = Math.atan2(e.y - pre.y, e.x - pre.x);
    const shaft = dashOn(stroke(g, bend ? `M${x1} ${y1}Q${f1(mx)} ${f1(my)} ${f1(x2 - Math.cos(ang) * hl * 0.8)} ${f1(y2 - Math.sin(ang) * hl * 0.8)}` : `M${x1} ${y1}L${f1(x2 - Math.cos(ang) * hl * 0.8)} ${f1(y2 - Math.sin(ang) * hl * 0.8)}`, color, o.sw ?? 3, { 'stroke-linecap': 'butt', 'stroke-dasharray': o.dashed ? '12 10' : null }));
    const tip = s('path', { d: tipD(x2, y2, ang, hl, hl * 0.42), fill: color }, g);
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: (k) => {
      const ke = smooth(k);
      if (o.dashed) { shaft.style.strokeDasharray = '12 10'; shaft.style.strokeDashoffset = '0'; shaft.style.clipPath = ''; shaft.style.opacity = f2(clamp(ke * 2)); } else runDash(shaft, ke);
      tip.style.opacity = ke > 0.92 ? '1' : '0';
    } });
    return this.handle(a, g);
  };

  /**
   * vec(A, to, o): a vector arrow on plane A from o.from (default the origin) to `to` ([x, y], or lt => [x, y] for a
   * vector that turns or stretches), grown from its tail, with a TeX label at its tip. o: { at, dur (0.7), color (a
   * variable key like 'v' or a palette name; 'yellow'), sw (6), label (TeX, e.g. '\\vec v'), lsize (50), coords (true:
   * the column [x; y] next to the tip), from, out }.
   */
  B.vec = function (A, to, o = {}) {
    const at = o.at ?? STAND, dur = o.dur ?? 0.7, color = vcol(this, o.color, 'yellow'), sw = o.sw ?? 6;
    const g = s('g', {}, this.svg);
    const shaft = stroke(g, '', color, sw, { 'stroke-linecap': 'butt' }), tip = s('path', { d: '', fill: color }, g);
    const from = o.from || [0, 0];
    let L = null, cl = null;
    const T = (lt) => val(to, lt);
    if (o.label) L = this.tex(o.label, { x: 0, y: 0, size: o.lsize ?? 50, at: at + dur * 0.7, color: o.lcolor ?? o.color ?? 'yellow', valign: 'm', align: 'c' });
    if (o.coords) { cl = h('div', 'tx mt-num', null, this.html); Object.assign(cl.style, { fontSize: '38px', color }); }
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: () => {} });
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) { if (cl) cl.style.visibility = 'hidden'; return; }
      const k = out(clamp((lt - at) / dur)), [tx, ty] = T(lt);
      const [ax, ay] = A.p(from[0], from[1]), [bx, by] = A.p(from[0] + (tx - from[0]) * k, from[1] + (ty - from[1]) * k);
      const ang = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay), hl = Math.min(26, len * 0.45);
      shaft.setAttribute('d', len > 1 ? `M${f1(ax)} ${f1(ay)}L${f1(bx - Math.cos(ang) * hl * 0.8)} ${f1(by - Math.sin(ang) * hl * 0.8)}` : '');
      tip.setAttribute('d', len > 1 ? tipD(bx, by, ang, hl, hl * 0.45) : '');
      const nx = Math.cos(ang), ny = Math.sin(ang);
      if (L) { L.el.style.transform = `translate(${f1(bx + nx * 38 - parseFloat(L.el.style.left || 0) - (parseFloat(L.el.style.width) || 0) / 2)}px, ${f1(by + ny * 38 - parseFloat(L.el.style.top || 0) - (parseFloat(L.el.style.height) || 0) / 2)}px)`; }
      if (cl) {
        const vis = a.out != null ? 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt) : 1;
        const sv = `[${tx.toFixed(1)}, ${ty.toFixed(1)}]`.replace(/-/g, '−');
        if (cl._v !== sv) { cl._v = sv; cl.textContent = sv; }
        const lw = L ? (parseFloat(L.el.style.width) || 0) / 2 + 16 : 20, cx0 = bx + nx * 38;
        Object.assign(cl.style, { visibility: 'visible', left: f1(cx0 + (nx >= 0 ? lw : -lw)) + 'px', top: f1(by + ny * 38) + 'px', transform: nx >= 0 ? 'translate(0, -50%)' : 'translate(-100%, -50%)', opacity: f2(clamp((lt - at - dur) / 0.3) * vis) });
      }
    });
    return withKids(this.handle(a, g), [L]);
  };

  /**
   * matrix(A, M, o): a linear transformation of the whole plane — the grid lines, the basis vectors î (green) and ĵ
   * (red) and optionally the unit square bend together from the identity to the matrix M = [[a, b], [c, d]] over dur,
   * on plane A (make it with equal: true). M can also be lt => matrix (a sequence of transformations). The plane's own
   * axes stay as the ghost of where things were. o: { at, dur (1.8), grid (true), basis (true), unit (false: the unit
   * square in yellow, whose area is the determinant), icolor ('green'), jcolor ('red'), extra (grid lines beyond the
   * plane, 4), out }.
   */
  B.matrix = function (A, Mx, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.8;
    const id = 'mtc' + ++uid, [bx, by, bw, bh] = A.box;
    const g = s('g', {}, this.svg);
    const cp = s('clipPath', { id }, s('defs', {}, g)); s('rect', { x: bx - 40, y: by - 40, width: bw + 80, height: bh + 80 }, cp);
    const gg = s('g', { 'clip-path': `url(#${id})` }, g);
    const unit = o.unit ? s('path', { d: '', fill: col('yellow'), 'fill-opacity': 0.3, stroke: col('yellow'), 'stroke-width': 2.4 }, gg) : null;
    const E = o.extra ?? 4, gx0 = Math.floor(A.x0) - E, gx1 = Math.ceil(A.x1) + E, gy0 = Math.floor(A.y0) - E, gy1 = Math.ceil(A.y1) + E;
    const gl = [];
    if (o.grid !== false) {
      for (let v = gx0; v <= gx1; v++) gl.push({ el: stroke(gg, '', v === 0 ? '#7DB7D6' : '#3F7EA6', v === 0 ? 3 : 2, { 'stroke-linecap': 'butt' }), a: [v, gy0], b: [v, gy1] });
      for (let v = gy0; v <= gy1; v++) gl.push({ el: stroke(gg, '', v === 0 ? '#7DB7D6' : '#3F7EA6', v === 0 ? 3 : 2, { 'stroke-linecap': 'butt' }), a: [gx0, v], b: [gx1, v] });
    }
    const mk = (c) => ({ shaft: stroke(g, '', c, 6, { 'stroke-linecap': 'butt' }), tip: s('path', { d: '', fill: c }, g) });
    const bi = o.basis !== false ? [mk(vcol(this, o.icolor, 'green')), mk(vcol(this, o.jcolor, 'red'))] : [];
    const Mof = (lt) => {
      if (typeof Mx === 'function') return Mx(lt);
      const k = smooth(clamp((lt - at) / dur));
      return [[lerp(1, Mx[0][0], k), lerp(0, Mx[0][1], k)], [lerp(0, Mx[1][0], k), lerp(1, Mx[1][1], k)]];
    };
    const a = this.act({ at, dur: typeof Mx === 'function' ? 0.5 : dur, g, kind: 'draw', pen: false, apply: () => {} });
    const appear = at - 0.6;
    this.tick((lt) => {
      const k0 = smooth(clamp((lt - appear) / 0.6));
      g.style.visibility = k0 > 0 ? 'visible' : 'hidden';
      if (k0 <= 0) return;
      const m = Mof(Math.max(lt, at)), T = ([x, y]) => A.p(m[0][0] * x + m[0][1] * y, m[1][0] * x + m[1][1] * y);
      gg.style.opacity = f2(k0 * (o.op ?? 0.9));
      for (const q of gl) { const p1 = T(q.a), p2 = T(q.b); q.el.setAttribute('d', `M${f1(p1[0])} ${f1(p1[1])}L${f1(p2[0])} ${f1(p2[1])}`); }
      if (unit) unit.setAttribute('d', poly([[0, 0], [1, 0], [1, 1], [0, 1]].map(T)) + 'Z');
      bi.forEach((v, i) => {
        const [ax, ay] = T([0, 0]), [ex, ey] = T(i ? [0, 1] : [1, 0]), ang = Math.atan2(ey - ay, ex - ax), len = Math.hypot(ex - ax, ey - ay) * k0, hl = Math.min(26, len * 0.4);
        const tx = ax + Math.cos(ang) * len, ty = ay + Math.sin(ang) * len;
        v.shaft.setAttribute('d', len > 1 ? `M${f1(ax)} ${f1(ay)}L${f1(tx - Math.cos(ang) * hl * 0.8)} ${f1(ty - Math.sin(ang) * hl * 0.8)}` : '');
        v.tip.setAttribute('d', len > 1 ? tipD(tx, ty, ang, hl, hl * 0.45) : '');
      });
    });
    return this.handle(a, g);
  };

  /** n points evenly along a path d (measured once, at build) */
  function sample(P, d, n) {
    const p = s('path', { d, fill: 'none' }, P.svg), L = p.getTotalLength(), pts = [];
    for (let i = 0; i < n; i++) { const q = p.getPointAtLength((L * i) / n); pts.push([q.x, q.y]); }
    p.remove();
    return pts;
  }
  /** rotate (and if needed reverse) b so that its points line up with a's: the morph then moves, it doesn't twist */
  function align(a, b) {
    const n = a.length; let best = 0, bestD = Infinity, rev = false;
    for (const r of [false, true]) {
      const bb = r ? b.slice().reverse() : b;
      for (let o = 0; o < n; o += 2) { let d = 0; for (let i = 0; i < n; i += 3) { const q = bb[(i + o) % n]; d += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2; } if (d < bestD) { bestD = d; best = o; rev = r; } }
    }
    const bb = rev ? b.slice().reverse() : b;
    return bb.map((_, i) => bb[(i + best) % n]);
  }

  /**
   * shape(d, o): a geometric figure (an SVG path d, from PV.M or your own) created as a clean outline, then filled; with
   * o.to it morphs continuously into other figures on cue — the equivalence made visible (a square into a circle of the
   * same area, a parallelogram into a rectangle). o: { at, dur (1.0), color ('ink' or a variable key), fill (a colour;
   * filled at fop 0.3), fop, sw (3.5), to: [{ d, at, dur (1.4), color, fill }], move (lt => ({ dx, dy, rot, cx, cy,
   * s })), out }. Morphs work best between closed figures.
   */
  B.shape = function (d, o = {}) {
    const at = o.at ?? STAND, dur = o.dur ?? 1.0, N = 200;
    const g = s('g', {}, this.svg);
    const fill = o.fill || (o.to || []).some((q) => q.fill) ? s('path', { d, fill: vcol(this, o.fill || 'ink'), 'fill-opacity': o.fill ? o.fop ?? 0.3 : 0, stroke: 'none' }, g) : null;
    const line = dashOn(stroke(g, d, vcol(this, o.color, 'ink'), o.sw ?? 3.5));
    const keys = [{ pts: o.to ? sample(this, d, N) : null, color: o.color || 'ink', fill: o.fill }];
    for (const q of o.to || []) keys.push({ pts: align(keys[keys.length - 1].pts, sample(this, q.d, N)), color: q.color ?? keys[keys.length - 1].color, fill: q.fill ?? keys[keys.length - 1].fill, at: q.at, dur: q.dur ?? 1.4 });
    const a = this.act({ at, dur: dur + (fill ? 0.4 : 0), g, kind: 'draw', pen: false, apply: (k, lt) => {
      const t = lt - at;
      runDash(line, smooth(clamp(t / dur)));
      if (fill && o.fill) fill.setAttribute('fill-opacity', f3(clamp((t - dur * 0.8) / 0.4) * (o.fop ?? 0.3)));
    } });
    if (keys.length > 1 || o.move) this.tick((lt) => {
      if (keys.length > 1 && lt >= keys[1].at) {
        let i = 1; for (let q = 1; q < keys.length; q++) if (lt >= keys[q].at) i = q;
        const A0 = keys[i - 1], A1 = keys[i], e = smooth(clamp((lt - A1.at) / A1.dur));
        const pts = A0.pts.map((p, j) => [lerp(p[0], A1.pts[j][0], e), lerp(p[1], A1.pts[j][1], e)]);
        const dd = poly(pts) + 'Z';
        line.setAttribute('d', dd); line.style.strokeDasharray = 'none'; line.style.visibility = 'visible';
        line.setAttribute('stroke', PV.mix(vcol(this, A0.color), vcol(this, A1.color), e));
        if (fill) { fill.setAttribute('d', dd); const f0 = A0.fill ? vcol(this, A0.fill) : null, fA = A1.fill ? vcol(this, A1.fill) : null; fill.setAttribute('fill', PV.mix(f0 || fA || col('ink'), fA || f0 || col('ink'), e)); fill.setAttribute('fill-opacity', f3((o.fop ?? 0.3) * lerp(f0 ? 1 : 0, fA ? 1 : 0, e))); }
      } else if (keys.length > 1) {
        line.setAttribute('d', d); line.setAttribute('stroke', vcol(this, o.color, 'ink')); line.style.strokeDasharray = `${line._n} ${line._n}`; if (fill) { fill.setAttribute('d', d); fill.setAttribute('fill', vcol(this, o.fill || 'ink')); }
        runDash(line, smooth(clamp((lt - at) / dur)));
        if (fill) fill.setAttribute('fill-opacity', f3(o.fill ? clamp((lt - at - dur * 0.8) / 0.4) * (o.fop ?? 0.3) : 0));
      }
      if (o.move) {
        const m = o.move(lt) || {}, cx = m.cx ?? 0, cy = m.cy ?? 0;
        g.setAttribute('transform', `translate(${f2(m.dx ?? 0)} ${f2(m.dy ?? 0)})` + (m.rot ? ` rotate(${f2(m.rot)} ${cx} ${cy})` : '') + (m.s != null && m.s !== 1 ? ` translate(${cx} ${cy}) scale(${f3(m.s)}) translate(${-cx} ${-cy})` : ''));
      }
    });
    return this.handle(a, g);
  };

  /**
   * unroll(cx, cy, r, o): the circle-into-triangle proof of πr². A disc of radius r (px; 140–200) is drawn as n thin
   * rings, its radius marked 'r'; on cue every ring is cut at the bottom and straightens into a horizontal strip as long
   * as its circumference, the strips stacking into a triangle of base 2πr and height r; then the triangle's outline, a
   * brace '2\\pi r' under the base and a brace 'r' for its height. Put the disc top left and the triangle across the
   * lower half. o: { at (rings drawn), open (when they unroll; default at + 1.6), dur (2.6), n (rings, 16), tx, ty (the
   * triangle's base centre; default 960, cy + r + 200; ty ≤ 770, the brace and its label sit under it), color ('blue' or the key 'r'… any variable), labels (true),
   * rlabel ('r'), blabel ('2\\pi r'), out }. Returns a handle with .tri = { x0, x1, y, apex }.
   */
  B.unroll = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, n = o.n ?? 16, open = o.open ?? at + 1.6, dur = o.dur ?? 2.6;
    const tx = o.tx ?? STAGE.w / 2, ty = Math.min(o.ty ?? cy + r + 200, STAGE.area.y1 - 110);
    const c1 = vcol(this, o.color, 'blue'), c2 = PV.mix(c1, '#0E0F12', 0.32);
    const g = s('g', {}, this.svg), th = r / n, N = 110;
    const rings = Array.from({ length: n }, (_, i) => {
      const ri = (r * (i + 0.5)) / n;
      return { ri, el: stroke(g, '', i % 2 ? c2 : c1, th * 0.92, { 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }) };
    });
    const outline = dashOn(stroke(g, `M${f1(tx - Math.PI * r)} ${f1(ty)}L${f1(tx)} ${f1(ty - r)}L${f1(tx + Math.PI * r)} ${f1(ty)}Z`, col('ink'), 3));
    const rim = dashOn(stroke(g, M.circle(cx, cy, r), col('ink'), 3));
    const radius = dashOn(stroke(g, `M${cx} ${cy}L${cx + r} ${cy}`, col('ink'), 3.5, { 'stroke-linecap': 'butt' }));
    const cut = stroke(g, `M${cx} ${cy}V${cy + r + 18}`, col('ink'), 3, { 'stroke-dasharray': '10 8', 'stroke-linecap': 'butt' });
    const hx = tx + Math.PI * r + 34;
    const height = stroke(g, `M${f1(tx)} ${f1(ty - r)}V${f1(ty)}M${f1(tx)} ${f1(ty - r)}H${f1(hx)}`, col('soft'), 2.4, { 'stroke-dasharray': '10 9', 'stroke-linecap': 'butt' });
    const ringD = (ri, k, ax, ay) => {
      // a ring of length 2πri whose curvature relaxes from 1/ri to 0 while its bottom point travels to (ax, ay)
      const Lr = 2 * Math.PI * ri, cv = (1 - k) / ri, pts = [];
      for (let j = 0; j <= N; j++) {
        const u = -Lr / 2 + (Lr * j) / N;
        if (cv < 1e-6) pts.push([ax + u, ay]);
        else { const ph = u * cv; pts.push([ax + Math.sin(ph) / cv, ay - (1 - Math.cos(ph)) / cv]); }
      }
      return poly(pts) + (k <= 0 ? 'Z' : '');
    };
    const t1 = open + dur + 0.2;
    const a = this.act({ at, dur: t1 + 1.6 - at, g, kind: 'draw', pen: false, apply: () => {} });
    const rl = o.labels !== false ? this.tex(o.rlabel ?? 'r', { x: cx + r / 2, y: cy - 14, valign: 'b', align: 'c', size: o.lsize ?? 52, at: at + 1.3 }) : null;
    if (rl) rl.hide(open - 0.1, 0.3);
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const kd = clamp((lt - at) / 1.1);   // the disc fills from the centre out
      runDash(rim, smooth(clamp((lt - at) / 1.0)));
      rim.style.opacity = f2(1 - clamp((lt - open) / 0.3));
      runDash(radius, smooth(clamp((lt - at - 1.0) / 0.4)));
      radius.style.opacity = f2(1 - clamp((lt - open + 0.1) / 0.3));
      cut.style.opacity = f2(clamp((lt - open + 0.5) / 0.2) * (1 - clamp((lt - open - 0.15) / 0.25)));
      rings.forEach((q, i) => {
        q.el.style.opacity = f2(clamp((kd * n - i) / 1.5));
        const d0 = (0.3 * (n - 1 - i)) / n;   // the outer rings start first
        const k = smooth(clamp((lt - open - d0 * dur) / (dur * 0.7)));
        q.el.setAttribute('d', ringD(q.ri, k, lerp(cx, tx, k), lerp(cy + q.ri, ty - (r - q.ri), k)));
      });
      runDash(outline, smooth(clamp((lt - t1) / 0.8)));
      height.style.opacity = f2(clamp((lt - t1 - 0.9) / 0.4));
    });
    const kids = [];
    if (o.labels !== false) {
      kids.push(this.brace(tx - Math.PI * r, ty + 12, tx + Math.PI * r, ty + 12, { at: t1 + 0.5, label: o.blabel ?? '2\\pi r' }));
      kids.push(this.brace(hx, ty, hx, ty - r, { at: t1 + 1.0, label: o.rlabel ?? 'r', depth: 16 }));
    }
    const hd = withKids(this.handle(a, g), kids);
    hd.tri = { x0: tx - Math.PI * r, x1: tx + Math.PI * r, y: ty, apex: [tx, ty - r] };
    return hd;
  };

  /**
   * value(x, y, label, fn, o): a live readout "label = 1.73" whose number follows fn(lt) every frame — the ticking
   * value of a variable while something moves. The label is TeX, painted with its variable's colour, and the number
   * takes the same colour. o: { at, size (56), decimals (2), color (default the label's variable), unit (text after the
   * number), align 'l'|'r', fixed (true: on the glass, still while the camera zooms; false: on the
   * plane, zoomed with it), out }.
   */
  B.value = function (x, y, label, fn, o = {}) {
    const T = o.fixed !== false && this.hud ? this.hud : this;
    const at = o.at ?? 0, vars = varsOf(this), size = o.size ?? 56;
    const el = h('div', 'tx mt-num', null, T.html);
    const color = vcol(this, o.color ?? (vars[label] ? label : null), 'ink');
    Object.assign(el.style, { fontSize: size + 'px', color, left: x + 'px', top: y + 'px', transform: o.align === 'r' ? 'translate(-100%, 0)' : 'none' });
    let head = '';
    if (window.katex) { const t = h('span', null, null, null); render(paint(label, vars) + '=', t); head = t.innerHTML + '&nbsp;'; }
    const a = T.act({ at, dur: 0.4, g: el, kind: 'text', pen: false, apply: () => {} });
    T.tick((lt) => {
      const vis = a.out != null ? 1 - PV.smooth(a.out, a.out + (a.outDur || 0.5), lt) : 1;
      el.style.opacity = f2(clamp((lt - at) / 0.4) * vis);
      const v = fn(Math.max(lt, at)), sv = (typeof v === 'number' ? v.toFixed(o.decimals ?? 2).replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ? ',' : '').replace('-', '−') : String(v)) + (o.unit ? ' ' + o.unit : '');
      if (el._v !== sv) { el._v = sv; el.innerHTML = head + sv; }
    });
    return T.handle(a, el);
  };

  /**
   * unitcircle(cx, cy, r, theta, o): the unit circle with a radius turning to angle theta(lt) (radians), its angle arc,
   * and the two projections that define cosine (along the horizontal axis) and sine (the vertical drop). o: { at,
   * dur (1.0), cos ('blue' or a variable key), sin ('yellow'), angle ('orange' or the key '\\theta'), labels (true:
   * '\\cos\\theta', '\\sin\\theta' beside the projections, 'θ' at the arc), out }.
   */
  B.unitcircle = function (cx, cy, r, theta, o = {}) {
    const at = o.at ?? STAND, dur = o.dur ?? 1.0;
    const g = s('g', {}, this.svg), soft = col('soft');
    const ax = dashOn(stroke(g, `M${cx - r - 60} ${cy}H${cx + r + 60}M${cx} ${cy + r + 60}V${cy - r - 60}`, soft, 2.2, { 'stroke-linecap': 'butt' }));
    const circ = dashOn(stroke(g, M.circle(cx, cy, r), col('ink'), 3));
    const cc = vcol(this, o.cos, 'blue'), sc = vcol(this, o.sin, 'yellow'), tc = vcol(this, o.angle ?? (varsOf(this)['\\theta'] ? '\\theta' : null), 'orange');
    const arc = stroke(g, '', tc, 3), cosL = stroke(g, '', cc, 6, { 'stroke-linecap': 'butt' }), sinL = stroke(g, '', sc, 6, { 'stroke-linecap': 'butt' });
    const rad = stroke(g, '', col('ink'), 3.5), dot = s('circle', { r: 10, fill: col('ink') }, g);
    const a = this.act({ at, dur: dur + 0.5, g, kind: 'draw', pen: false, apply: () => {} });
    const lc = o.labels !== false ? this.tex('\\cos\\theta', { x: 0, y: 0, size: 44, color: o.cos ?? 'blue', at: at + dur, align: 'c' }) : null;
    const ls = o.labels !== false ? this.tex('\\sin\\theta', { x: 0, y: 0, size: 44, color: o.sin ?? 'yellow', at: at + dur, valign: 'm' }) : null;
    const lt0 = o.labels !== false ? this.tex('\\theta', { x: 0, y: 0, size: 44, color: o.angle ?? (varsOf(this)['\\theta'] ? '\\theta' : 'orange'), at: at + dur, valign: 'm', align: 'c' }) : null;
    const place = (L, x, y) => { if (!L) return; const b = L.box(); L.el.style.transform = `translate(${f1(x - b.x)}px, ${f1(y - b.y)}px)`; };
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      runDash(ax, smooth(clamp((lt - at) / dur))); runDash(circ, smooth(clamp((lt - at - 0.2) / dur)));
      const k = clamp((lt - at - dur * 0.8) / 0.4), t = theta(Math.max(lt, at + dur));
      const px = cx + r * Math.cos(t), py = cy - r * Math.sin(t);
      for (const el of [arc, cosL, sinL, rad, dot]) el.style.opacity = f2(k);
      rad.setAttribute('d', `M${cx} ${cy}L${f1(px)} ${f1(py)}`); dot.setAttribute('cx', f1(px)); dot.setAttribute('cy', f1(py));
      cosL.setAttribute('d', `M${cx} ${cy}H${f1(px)}`); sinL.setAttribute('d', `M${f1(px)} ${cy}V${f1(py)}`);
      const ar = Math.min(70, r * 0.3), na = Math.max(2, Math.ceil(Math.abs(t) / 0.05)), pts = [];
      for (let i = 0; i <= na; i++) { const u = (t * i) / na; pts.push([cx + ar * Math.cos(u), cy - ar * Math.sin(u)]); }
      arc.setAttribute('d', poly(pts));
      place(lc, (cx + px) / 2 - (lc ? lc.box().w / 2 : 0), cy + (Math.sin(t) >= 0 ? 14 : -60));
      if (ls) place(ls, px + (Math.cos(t) >= 0 ? 16 : -16 - ls.box().w), (cy + py) / 2 - ls.box().h / 2);
      if (lt0) { const hm = t / 2, rr = ar + 34; place(lt0, cx + rr * Math.cos(hm) - lt0.box().w / 2, cy - rr * Math.sin(hm) - lt0.box().h / 2); }
    });
    return withKids(this.handle(a, g), [lc, ls, lt0]);
  };

  /**
   * dots(x, y, cols, rows, o): a grid of dots for counting and probability — every dot one equally likely outcome (one
   * person, one draw). The grid appears row by row; o.hit(lt) → k lights the first k dots (in a fixed shuffled order
   * when o.shuffle) in o.hitColor, or o.color(i, lt) → a colour name (or null) decides each dot. o: { gap (36), r (11),
   * at, dur (0.8), base ('faint'), hit, hitColor ('yellow' or a variable key), shuffle (false; a seed number), color,
   * out }. Returns { pos(i) → [px, py], w, h }.
   */
  B.dots = function (x, y, cols, rows, o = {}) {
    const gap = o.gap ?? 36, r = o.r ?? 11, at = o.at ?? STAND, dur = o.dur ?? 0.8, N = cols * rows;
    const g = s('g', {}, this.svg), base = col(o.base || 'faint'), hc = vcol(this, o.hitColor, 'yellow');
    const pos = (i) => [x + (i % cols) * gap, y + Math.floor(i / cols) * gap];
    const els = Array.from({ length: N }, (_, i) => { const [px, py] = pos(i); return s('circle', { cx: f1(px), cy: f1(py), r, fill: base }, g); });
    let order = els.map((_, i) => i);
    if (o.shuffle) { const rnd = PV.rng(typeof o.shuffle === 'number' ? o.shuffle : 7); for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    const rank = new Array(N); order.forEach((d, i) => { rank[d] = i; });
    const a = this.act({ at, dur, g, kind: 'draw', pen: false, apply: () => {} });
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const kk = clamp((lt - at) / dur) * (rows + 1), hits = o.hit ? Math.round(o.hit(lt)) : -1;
      els.forEach((el, i) => {
        const row = Math.floor(i / cols), k = clamp(kk - row);
        const c = o.color ? o.color(i, lt) : hits >= 0 && rank[i] < hits ? 'hit' : null;
        const fc = c === 'hit' ? hc : c ? vcol(this, c) : base;
        if (el._c !== fc) { el._c = fc; el.setAttribute('fill', fc); }
        const sv = f3(k);
        if (el._k !== sv) { el._k = sv; el.style.opacity = sv; }
      });
    });
    return Object.assign(this.handle(a, g), { pos, w: (cols - 1) * gap, h: (rows - 1) * gap });
  };

  /**
   * epicycles(cx, cy, terms, o): a Fourier series drawn by rotating circles — each term a circle of radius r (px)
   * turning n times per cycle, chained tip to tail; the last tip draws the curve their sum makes. With o.wave the tip's
   * height is also traced as a wave scrolling to the right (a sound, a signal). terms: [{ r, n, ph (radians) }].
   * o: { at, period (seconds per cycle, 6), color (pen, 'yellow'), circles ('muted'), arms ('soft'), trail (fraction of
   * a cycle kept, 1; 0 when wave is set), grow (0.25 s between circles appearing), wave ({ x (where the wave starts), len (px, 700) }), maxCircles (5: smaller terms add to the arm
   * without a circle, so the chain reads), out }. Make the biggest circle r 180–240.
   */
  B.epicycles = function (cx, cy, terms, o = {}) {
    const at = o.at ?? STAND, per = o.period ?? 6, grow = o.grow ?? 0.25, pc = vcol(this, o.color, 'yellow');
    const g = s('g', {}, this.svg);
    const cap = o.maxCircles ?? 5;   // only the big circles are drawn; the small ones ride as a thin arm
    const cs = terms.map((_, i) => s('circle', { r: 0, fill: 'none', stroke: col(o.circles || 'muted'), 'stroke-width': i < cap ? 1.8 : 0 }, g));
    const arms = stroke(g, '', col(o.arms || 'soft'), 2.4);
    const pen = stroke(g, '', pc, 4), tipDot = s('circle', { r: 7, fill: pc }, g);
    const wv = o.wave ? stroke(g, '', pc, 4) : null, link = o.wave ? stroke(g, '', col('muted'), 1.6, { 'stroke-dasharray': '6 8', 'stroke-linecap': 'butt' }) : null;
    const t1 = at + terms.length * grow + 0.4;
    const chain = (th, upto = terms.length) => { let x = cx, y = cy; const pts = [[x, y]]; for (let i = 0; i < upto; i++) { const q = terms[i], a = (q.n ?? 1) * th + (q.ph ?? 0); x += q.r * Math.cos(a); y -= q.r * Math.sin(a); pts.push([x, y]); } return pts; };
    const a = this.act({ at, dur: t1 - at, g, kind: 'draw', pen: false, apply: () => {} });
    this.tick((lt) => {
      const on = lt >= at;
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const th = (2 * Math.PI * Math.max(0, lt - t1)) / per, pts = chain(th);
      terms.forEach((q, i) => { const k = out(clamp((lt - at - i * grow) / 0.4)); cs[i].setAttribute('cx', f1(pts[i][0])); cs[i].setAttribute('cy', f1(pts[i][1])); cs[i].setAttribute('r', f1(i < cap ? q.r * k : 0)); });
      const shown = terms.filter((_, i) => lt >= at + i * grow).length;
      arms.setAttribute('d', poly(pts.slice(0, shown + 1)));
      const tip = pts[terms.length];
      tipDot.setAttribute('cx', f1(tip[0])); tipDot.setAttribute('cy', f1(tip[1]));
      tipDot.style.opacity = lt >= t1 ? '1' : '0';
      const span = Math.min(th, 2 * Math.PI * (o.trail ?? (o.wave ? 0 : 1))), ns = Math.max(2, Math.ceil(span / 0.02)), tr = [];
      for (let i = 0; i <= ns; i++) tr.push(chain(th - span + (span * i) / ns)[terms.length]);
      pen.setAttribute('d', th > 0.001 && span > 0.001 ? poly(tr) : '');
      if (wv) {
        const wx = o.wave.x ?? cx + 320, wl = o.wave.len ?? 700, wsp = wl / (per * 1.0), ws = [];
        const tspan = Math.min(Math.max(0, lt - t1), wl / wsp), nw = Math.max(2, Math.ceil(tspan / 0.02));
        for (let i = 0; i <= nw; i++) { const dt = (tspan * i) / nw; ws.push([wx + dt * wsp, chain((2 * Math.PI * (Math.max(0, lt - t1) - dt)) / per)[terms.length][1]]); }
        wv.setAttribute('d', tspan > 0.01 ? poly(ws) : '');
        link.setAttribute('d', lt >= t1 ? `M${f1(tip[0])} ${f1(tip[1])}H${f1(wx)}` : '');
      }
    });
    return this.handle(a, g);
  };

  /**
   * point(x, y, o): a labelled dot — a vertex A, a point P on a curve, a solution. o: { at, color ('ink' or a variable
   * key), r (9), label (TeX), dir ('ur' | 'ul' | 'dr' | 'dl' | 'u' | 'd' | 'l' | 'r', where the label sits; 'ur'),
   * lsize (44), out }. On a plane: P.point(...A.p(2, 4), { label: 'P' }).
   */
  B.point = function (x, y, o = {}) {
    const at = o.at ?? STAND, color = vcol(this, o.color, 'ink'), r = o.r ?? 10;
    const g = s('g', {}, this.svg), dot = s('circle', { cx: x, cy: y, r, fill: color }, g);
    const a = this.act({ at, dur: 0.35, g, kind: 'draw', pen: false, apply: (k) => dot.setAttribute('r', f2(r * out(k))) });
    let pl = null;
    if (o.label) {
      const d = o.dir || 'ur', gx = d.includes('r') ? 16 : d.includes('l') ? -16 : 0, gy = d.includes('u') ? -14 : d.includes('d') ? 14 : 0;
      pl = this.tex(o.label, { x: x + gx, y: y + gy, size: o.lsize ?? 44, color: o.lcolor ?? o.color, at: at + 0.15, align: gx > 0 ? 'l' : gx < 0 ? 'r' : 'c', valign: gy < 0 ? 'b' : gy > 0 ? 't' : 'm', dur: 0.4 });
    }
    return withKids(this.handle(a, g), [pl]);
  };

  // ── square corners, flat: P.box defaults to r 0 and no hatching
  const box0 = B.box;
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 0, texture: false, sw: 2.6 }, o)); };

  // ── the page title: a short line of serif type written on top left, a hairline rule under it
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.05;
    const el = h('div', 'tx mt-title', null, T.html); el.textContent = str;
    const ol = h('div', 'mt-title mt-ol', null, T.html); ol.textContent = str;
    const rule = h('div', null, null, T.html);
    Object.assign(rule.style, { position: 'absolute', left: STAGE.title.x + 'px', top: (STAGE.title.y + 58) + 'px', height: '2px', width: '120px', background: col('faint'), transformOrigin: '0 0' });
    const n = [...str].length, dur = clamp(0.4 + n * 0.035, 0.5, 1.2);
    const a = T.act({ at, dur: dur + 0.4, g: el, kind: 'text', pen: false, apply: (k, lt, vis) => {
      const t = lt - at;
      writeK(el, ol, clamp(t / dur));
      el.style.opacity = ol.style.opacity = f2(vis);
      rule.style.transform = `scaleX(${f3(smooth(clamp((t - dur * 0.5) / 0.5)))})`;
      rule.style.opacity = f2(vis);
    } });
    return Object.assign(T.handle(a, el), { spans: [el], box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 22, w: el.offsetWidth, h: 70 }) });
  };
})();
