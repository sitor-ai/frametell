/* Swiss grid · kit: kinetic type, giant numbers, flat geometric blocks, rules, mono labels, band wipes and bar rows on a
 * 12-column grid. Words and numbers are the actors; every entrance is a fast expo-out, every exit faster.
 * Everything is a pure function of page-local time lt (no CSS transitions, no randomness). Ideas from huashu-art-motion's
 * kinetic-type and keynote grammars (MIT, alchaincyf). */
(function () {
  const { h, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const expoIn = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * clamp(x) - 10));
  const back = (x) => { const c1 = 1.9, c3 = c1 + 1, k = clamp(x) - 1; return 1 + c3 * k * k * k + c1 * k * k; };
  const f2 = (n) => n.toFixed(2);

  // ── the grid: 12 columns between x 140 and 1780, 24px gutters
  const A = STAGE.area, M = A.x0, G = 24, CW = (A.x1 - A.x0 - 11 * G) / 12;
  /** PV.gx(i): x of the left edge of grid column i (0–11; 12 = the right margin, 1780). Place everything on these. */
  PV.gx = (i) => (i >= 12 ? A.x1 : M + i * (CW + G));
  /** PV.gw(n): width of n grid columns including their gutters (12 = 1640). */
  PV.gw = (n) => n * CW + (n - 1) * G;

  const MARK = { r: 'red', b: 'blue', g: 'green', o: 'orange', p: 'purple', m: 'muted', s: 'soft', k: 'ink', y: 'yellow', w: 'paper' };
  /** "{r:red words} plain" → [{ text, color }] */
  function segs(str) {
    const out = [], re = /\{(\w):([^}]*)\}/g;
    let last = 0, m;
    while ((m = re.exec(str))) { if (m.index > last) out.push({ text: str.slice(last, m.index) }); out.push({ text: m[2], color: MARK[m[1]] }); last = m.index + m[0].length; }
    if (last < str.length) out.push({ text: str.slice(last) });
    return out;
  }
  const cjk = (c) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(c);
  /** units that reveal one by one: a CJK character, or a Latin word with its trailing space; '\n' breaks the line */
  function units(str) {
    const out = [];
    for (const sg of segs(str)) {
      const toks = sg.text.match(/\n|[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+\s*|\s+/g) || [];
      for (const t of toks) out.push({ text: t, color: sg.color, cjk: cjk(t[0]) });
    }
    return out;
  }

  /**
   * kinetic(str, o): a headline whose words / characters enter one by one on the beat — the signature of this style.
   * o: { x, y, size (default 120), weight (900), color ('ink'), at, mode, stagger (s per unit; default 0.035 CJK, 0.07 Latin),
   * dur (0.5), w (wrap width; else one line, '\n' breaks), lh (1.02), align 'l'|'c'|'r', font 'hand'|'display' (display =
   * Archivo Black for Latin and numbers), track (letter-spacing em, default -0.03), out (time the words exit upward, fast) }.
   * mode: 'rise' (default: each unit rises out of an invisible mask, like a printed line being pulled up),
   * 'slam' (each unit lands from 1.6× scale in 0.17 s — for one or two words that must hit), 'slide' (enters from the left
   * edge of its own mask), 'drop' (falls in from above). Markup: {r:word} red, {b:…} blue, {m:…} muted, {w:…} paper-white.
   * Returns a handle: .hide(t), .box() → { x, y, w, h } (measure for layout), .el.
   */
  B.kinetic = function (str, o = {}) {
    const size = o.size ?? 120, at = o.at ?? 0, mode = o.mode || 'rise', dur = o.dur ?? (mode === 'slam' ? 0.22 : 0.5);
    const el = h('div', 'tx sw-k' + (o.w ? ' wrap' : ''), null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', fontWeight: o.weight ?? 900, lineHeight: String(o.lh ?? 1.02), letterSpacing: (o.track ?? -0.03) + 'em', color: col(o.color || 'ink') });
    if (o.font === 'display') el.style.fontFamily = 'var(--display)';
    const align = o.align || 'l';
    if (o.w) el.style.width = o.w + 'px';
    el.style.textAlign = { l: 'left', c: 'center', r: 'right' }[align];
    const list = units(str), spans = [];
    for (const u of list) {
      if (u.text === '\n') { h('br', null, null, el); continue; }
      const outer = h('span', 'sw-o', null, el);
      const inner = h('span', 'ch', null, outer);
      inner.textContent = u.text.replace(/ /g, ' ');
      if (u.color) inner.style.color = col(u.color);
      if (/^\s+$/.test(u.text)) { outer.style.width = '0.28em'; }
      spans.push(inner);
    }
    const place = () => {
      const w = el.offsetWidth;
      el.style.left = (align === 'c' ? o.x - w / 2 : align === 'r' ? o.x - w : o.x) + 'px';
      el.style.top = o.y + 'px';
    };
    place();
    const n = spans.length, st = o.stagger ?? (list.some((u) => u.cjk) ? 0.035 : 0.07);
    const total = dur + st * Math.max(0, n - 1);
    let placed = false;
    // an act only re-applies while its progress changes: stretch it over the exit so the exit animates
    const span = o.out != null ? Math.max(total, o.out + 0.3 + st * n * 0.5 - at) : total;
    const a = this.act({
      at, dur: span, g: el, kind: 'text', pen: false,
      apply: (k, lt, vis) => {
        if (!placed) { place(); placed = true; }
        el.style.opacity = f2(vis);
        const outK = o.out != null ? clamp((lt - o.out) / 0.28) : 0;
        for (let i = 0; i < n; i++) {
          const p = clamp((lt - at - i * st) / dur), sp = spans[i];
          const q = o.out != null ? clamp((lt - o.out - i * st * 0.5) / 0.22) : 0;
          let tr;
          if (mode === 'slam') { const e = p < 1 ? lerp(1.6, 1, back(p)) : 1; tr = `scale(${f2(e)})`; sp.style.opacity = p > 0 ? f2(clamp(p * 4)) : '0'; }
          else if (mode === 'slide') { tr = `translateX(${f2((1 - expo(p)) * -105)}%)`; sp.style.opacity = p > 0 ? '1' : '0'; }
          else if (mode === 'drop') { tr = `translateY(${f2((1 - expo(p)) * -110)}%)`; sp.style.opacity = p > 0 ? '1' : '0'; }
          else { tr = `translateY(${f2((1 - expo(p)) * 110)}%)`; sp.style.opacity = p > 0 ? '1' : '0'; }
          if (q > 0) tr = `translateY(${f2(-expoIn(q) * 115)}%)`;
          sp.style.transform = tr;
        }
        if (outK >= 1) el.style.opacity = '0';
      },
    });
    const hnd = this.handle(a, el);
    hnd.spans = spans;
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  /**
   * bignum(x, y, o): a giant number set in Archivo Black that counts up and lands exactly when it is spoken.
   * o: { to, from (0), at (start of the count; for word sync use P.cw(i, '30%') - dur), dur (0.9), decimals (0), prefix, suffix
   * (same size, e.g. '%'), unit (smaller grotesk after the number, e.g. '倍' or 'x'), size (default 320), color ('ink'),
   * align 'l'|'r', sep (true: thousands separators), mode 'count' (default) | 'slam' (no count: lands from 1.4× in 0.2 s), out }.
   * Keep one bignum per screen; it IS the composition (let it bleed toward the edges of the content area).
   */
  B.bignum = function (x, y, o = {}) {
    const size = o.size ?? 320, at = o.at ?? 0, dur = o.dur ?? 0.9, dec = o.decimals ?? 0, from = o.from ?? 0, to = o.to ?? 0;
    const el = h('div', 'tx sw-num', null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', color: col(o.color || 'ink'), top: y + 'px' });
    const fmt = (v) => { let s = v.toFixed(dec); if (o.sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (o.prefix || '') + s + (o.suffix || ''); };
    const num = h('span', null, fmt(to), el);
    if (o.unit) { const u = h('span', 'u', o.unit, el); u.style.fontSize = '0.34em'; u.style.marginLeft = '0.08em'; }
    const place = () => { el.style.left = (o.align === 'r' ? x - el.offsetWidth : x) + 'px'; };
    place();
    const mode = o.mode || 'count';
    let placed = false;
    const d0 = mode === 'slam' ? 0.22 : dur;
    const a = this.act({
      at, dur: o.out != null ? Math.max(d0, o.out + 0.25 - at) : d0, g: el, kind: 'text', pen: false,
      apply: (_, lt, vis) => {
        const k = clamp((lt - at) / d0);
        if (!placed) { place(); placed = true; }
        const q = o.out != null ? clamp((lt - o.out) / 0.2) : 0;
        if (mode === 'slam') { el.style.transform = `scale(${f2(k < 1 ? lerp(1.4, 1, back(k)) : 1)})`; el.style.opacity = f2((lt >= at ? 1 : 0) * vis * (1 - q)); return; }
        const e = ease.out(k);
        num.textContent = fmt(lerp(from, to, e));
        el.style.opacity = f2((lt >= at ? 1 : 0) * vis * (1 - q));
        el.style.transform = `translateY(${f2((1 - expo(clamp(k * 3))) * 40)}px)`;
      },
    });
    const hnd = this.handle(a, el);
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  // blocks are tiny SVGs (not divs) so the engine's checks count them as drawn content
  const svgBox = (host, w, hh, fill, round) => {
    const el = PV.s('svg', { class: 'sw-blk', width: w, height: hh, viewBox: `0 0 ${w} ${hh}` }, host);
    PV.s(round ? 'ellipse' : 'rect', round ? { cx: w / 2, cy: hh / 2, rx: w / 2, ry: hh / 2, fill } : { width: w, height: hh, fill }, el);
    return el;
  };
  const DIRS = { l: ['scaleX', '0 50%'], r: ['scaleX', '100% 50%'], u: ['scaleY', '50% 100%'], d: ['scaleY', '50% 0'], c: ['scale', '50% 50%'] };
  /**
   * block(x, y, w, h, o): a flat solid rectangle that wipes in from one side in 0.35 s — poster geometry, colour fields,
   * bars behind words. o: { color ('ink'), at, dur (0.35), dir 'l'|'r'|'u'|'d'|'c' (grows from that side / the centre),
   * out (wipes away toward the far side), op (opacity), rot (degrees), z }. A block wider than the frame (x < 0 to
   * x + w > 1920) makes a full-bleed band. Text placed on a block must use a contrasting colour ('paper' on red/ink).
   */
  B.block = function (x, y, w, hh, o = {}) {
    const el = svgBox(this.html, w, hh, col(o.color || 'ink'), o.round);
    const [fn, origin] = DIRS[o.dir || 'l'];
    Object.assign(el.style, { left: x + 'px', top: y + 'px', transformOrigin: origin, opacity: o.op ?? 1 });
    if (o.z != null) el.style.zIndex = o.z;
    const rot = o.rot ? `rotate(${o.rot}deg) ` : '';
    const at = o.at ?? 0, dur = o.dur ?? 0.35;
    const flip = { '0 50%': '100% 50%', '100% 50%': '0 50%', '50% 100%': '50% 0', '50% 0': '50% 100%', '50% 50%': '50% 50%' };
    const a = this.act({
      at, dur: o.out != null ? Math.max(dur, o.out + 0.35 - at) : dur, g: el, kind: 'show', pen: false,
      apply: (_, lt, vis) => {
        let e = expo(clamp((lt - at) / dur));
        el.style.transformOrigin = origin;
        if (o.out != null && lt > o.out) { e = 1 - expoIn(clamp((lt - o.out) / 0.3)); el.style.transformOrigin = flip[origin]; }
        el.style.visibility = lt < at || e <= 0.001 ? 'hidden' : 'visible';
        el.style.transform = rot + (fn === 'scale' ? `scale(${f2(e)})` : `${fn}(${e.toFixed(4)})`);
        el.style.opacity = f2((o.op ?? 1) * vis);
      },
    });
    return this.handle(a, el);
  };

  /** disc(cx, cy, d, o): a flat circle that grows from its centre — o: { color ('red'), at, dur (0.4), ring (sw: outline only), out }.
   *  Use with blocks and a triangle path for Bauhaus-style geometry; one disc per screen at most. */
  B.disc = function (cx, cy, d, o = {}) {
    const el = PV.s('svg', { class: 'sw-blk', width: d, height: d, viewBox: `0 0 ${d} ${d}` }, this.html);
    const r = o.ring ? (d - o.ring) / 2 : d / 2;
    PV.s('circle', { cx: d / 2, cy: d / 2, r, fill: o.ring ? 'none' : col(o.color || 'red'), stroke: o.ring ? col(o.color || 'red') : 'none', 'stroke-width': o.ring || 0 }, el);
    Object.assign(el.style, { left: cx - d / 2 + 'px', top: cy - d / 2 + 'px', transformOrigin: '50% 50%' });
    const at = o.at ?? 0, dur = o.dur ?? 0.4;
    const a = this.act({ at, dur: o.out != null ? Math.max(dur, o.out + 0.3 - at) : dur, g: el, kind: 'show', pen: false, apply: (_, lt, vis) => {
      let e = back(clamp((lt - at) / dur));
      if (o.out != null && lt > o.out) e = 1 - expoIn(clamp((lt - o.out) / 0.25));
      el.style.visibility = lt < at ? 'hidden' : 'visible';
      el.style.transform = `scale(${Math.max(0, e).toFixed(4)})`;
      el.style.opacity = f2(vis);
    } });
    return this.handle(a, el);
  };

  /** rule(x, y, len, o): a hard straight bar that shoots out from its start in 0.3 s — dividers, axes, underlines under a key word.
   *  o: { sw (thickness, default 6), color ('ink'), at, dur (0.3), v (true: vertical, len goes down), out }. */
  B.rule = function (x, y, len, o = {}) {
    const sw = o.sw ?? 6;
    return this.block(x, y - (o.v ? 0 : sw / 2), o.v ? sw : len, o.v ? len : sw, { color: o.color || 'ink', at: o.at, dur: o.dur ?? 0.3, dir: o.v ? 'd' : 'l', out: o.out });
  };

  /** label(x, y, str, o): a small mono caption in caps — the annotation layer of the grid (sources, units, "FIG. 2", axis names).
   *  o: { no (an index printed before it in red, e.g. '01'), color ('ink'), size (26; never smaller), at, align 'l'|'r', out }. Types on in 0.3 s. */
  B.label = function (x, y, str, o = {}) {
    const el = h('div', 'tx sw-lab', null, this.html);
    el.innerHTML = (o.no ? `<span style="color:${col('red')}">${o.no}</span>&nbsp;&nbsp;` : '') + `<span class="t"></span>`;
    Object.assign(el.style, { fontSize: (o.size ?? 26) + 'px', color: col(o.color || 'ink'), top: y + 'px' });
    const t = el.querySelector('.t');
    t.textContent = str;
    el.style.left = (o.align === 'r' ? x - el.offsetWidth : x) + 'px';
    const at = o.at ?? 0, chars = [...str], d0 = Math.max(0.2, chars.length / 60);
    const a = this.act({ at, dur: o.out != null ? Math.max(d0, o.out + 0.2 - at) : d0, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
      const k = clamp((lt - at) / d0);
      const q = o.out != null ? clamp((lt - o.out) / 0.15) : 0;
      el.style.opacity = f2((lt >= at ? 1 : 0) * vis * (1 - q));
      const nn = Math.round(k * chars.length);
      if (t._n !== nn) { t._n = nn; t.textContent = chars.slice(0, nn).join('') + (nn < chars.length ? '█' : ''); }
    } });
    return this.handle(a, el);
  };

  /**
   * wipe(at, o): a full-frame band wipe for a scene change inside a page — bands of colour sweep across, cover the frame
   * at `at + 0.3`, then clear. Swap content at that moment: old things `.hide(w.mid, 0.01)`, new things `at: w.mid`.
   * o: { colors (default ['red', 'ink']: one band per colour, staggered), dir 'l'|'r'|'u'|'d', dur (0.6) }. Returns { mid }.
   * Use at most once or twice per film, on a topic change; never as decoration.
   */
  B.wipe = function (at, o = {}) {
    const colors = o.colors || ['red', 'ink'], dur = o.dur ?? 0.6, dir = o.dir || 'l', n = colors.length;
    const horiz = dir === 'l' || dir === 'r';
    colors.forEach((c, i) => {
      const el = svgBox(this.html, STAGE.w + 200, STAGE.h + 200, col(c));
      Object.assign(el.style, { left: '-100px', top: '-100px', zIndex: 30 + i });
      const d0 = at + i * 0.06, half = dur / 2;
      this.tick((lt) => {
        const p = clamp((lt - d0) / half), q = clamp((lt - d0 - half - (n - 1 - i) * 0.06) / half);
        if (p <= 0 || q >= 1) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        const a = expo(p), b = expoIn(q);
        // covers from the entry side, then uncovers toward the far side
        const from = (1 - a) * 100, to = b * 100;
        const s = dir === 'l' || dir === 'u' ? 1 : -1;
        el.style.transform = horiz ? `translateX(${f2(s * (q > 0 ? to : -from))}%)` : `translateY(${f2(s * (q > 0 ? to : -from))}%)`;
      });
    });
    return { mid: at + dur / 2 + (n - 1) * 0.06 };
  };

  /** flood(color, o): the whole page ground turns one colour (a red page, a black page) by a wipe — o: { at, dir ('u'), out }.
   *  Then set text to 'paper'. A red or black flooded page is the loudest move in this style: one per film, for the thesis. */
  B.flood = function (color, o = {}) {
    const hnd = this.block(-200, -200, STAGE.w + 400, STAGE.h + 400, { color, at: o.at, dir: o.dir || 'u', dur: o.dur ?? 0.45, out: o.out });
    // the fixed title (and the band behind it when the camera pushes in) turns to the flood colour, its text to paper
    const hud = (this.hud || this).host, at = (o.at ?? 0) + (o.dur ?? 0.45) * 0.5, c = col(color);
    const rgb = /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : [0, 0, 0];
    const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 170;
    this.tick((lt) => {
      const on = lt >= at && (o.out == null || lt < o.out + 0.15);
      if (hud._sw === on) return;
      hud._sw = on;
      hud.classList.toggle('sw-inv', on && !light);
      hud.style.setProperty('--band-color', on ? c : '');
    });
    return hnd;
  };

  /**
   * hbars(x, y, w, items, o): horizontal bars on the grid, each with its label left and its value at the bar's end in heavy
   * type — comparisons and rankings. items: [{ label, value, color?, note? }]; the highlighted item is red, the rest ink/faint.
   * o: { max (value of full width), at, stagger (0.25 s), rowH (96), barH (40), labelW (300), fmt(v) → string, hi (index of the
   * one bar in red), countUp (true: values count while the bar grows) }. The bar of item i grows at at + i * stagger.
   */
  B.hbars = function (x, y, w, items, o = {}) {
    const rowH = o.rowH ?? 96, barH = o.barH ?? 40, lw = o.labelW ?? 300, at = o.at ?? 0, st = o.stagger ?? 0.25;
    const max = o.max ?? Math.max(...items.map((it) => it.value));
    const fmt = o.fmt || ((v) => String(Math.round(v)));
    const bw = w - lw - 180;
    items.forEach((it, i) => {
      const yy = y + i * rowH, t0 = at + i * st, c = it.color || (o.hi === i ? 'red' : o.hi != null ? 'muted' : 'ink');
      this.label(x, yy + barH / 2 - 14, it.label, { at: t0, size: 28, color: o.hi === i ? 'red' : 'ink' });
      const full = (it.value / max) * bw;
      const bar = svgBox(this.html, Math.max(2, full), barH, col(c));
      Object.assign(bar.style, { left: x + lw + 'px', top: yy + 'px', transformOrigin: '0 50%' });
      const val = h('div', 'tx sw-num', null, this.html);
      Object.assign(val.style, { fontSize: barH * 1.25 + 'px', color: col(c), top: yy - barH * 0.14 + 'px' });
      this.tick((lt) => {
        const e = expo(clamp((lt - t0) / 0.7));
        bar.style.visibility = lt < t0 ? 'hidden' : 'visible';
        bar.style.transform = `scaleX(${e.toFixed(4)})`;
        val.style.opacity = lt < t0 ? '0' : '1';
        val.style.left = f2(x + lw + full * e + 18) + 'px';
        const v = o.countUp === false ? it.value : it.value * e;
        const s = fmt(v);
        if (val._s !== s) { val._s = s; val.textContent = s; }
      });
    });
  };

  /**
   * ghost(str, x, y, o): huge background type in a pale tint behind the composition — a page number "04", a year, a key
   * word in English — that fills the empty paper the way a Swiss poster does. It sits under everything and slides in once.
   * o: { size (default 620), color (default: ink at 5% opacity; 'redF' or a darker red on a red page), at (0), font 'display'|'hand', align 'l'|'r',
   * dir 'l'|'r'|'u' (slides 120px in from that side, 0.6 s) }. Let it bleed off the frame edge; never more than one per page.
   */
  B.ghost = function (str, x, y, o = {}) {
    const size = o.size ?? 620, at = o.at ?? 0;
    const svg = PV.s('svg', { class: 'sw-blk sw-ghost', width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` }, this.html);
    Object.assign(svg.style, { left: '0px', top: '0px', zIndex: -1, overflow: 'visible' });
    const t = PV.s('text', { x, y: y + size * 0.86, fill: col(o.color || 'ink'), 'fill-opacity': o.color ? 1 : 0.05, 'font-size': size, 'text-anchor': o.align === 'r' ? 'end' : 'start',
      style: `font-family: ${o.font === 'hand' ? 'var(--hand)' : 'var(--display)'}; font-weight: 900; letter-spacing: -0.04em` }, svg);
    t.textContent = str;
    const d = { l: [-1, 0], r: [1, 0], u: [0, 1] }[o.dir || 'l'];
    const a = this.act({ at, dur: 0.6, g: svg, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const e = expo(k);
      svg.style.opacity = f2((lt >= at ? 1 : 0) * vis);
      svg.style.transform = `translate(${f2(d[0] * 120 * (1 - e))}px, ${f2(d[1] * 120 * (1 - e))}px)`;
    } });
    return this.handle(a, svg);
  };

  // ── square corners, flat fills: P.box defaults to r 0 and no hatching
  const box0 = B.box;
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 0, texture: false }, o)); };

  // ── the page title: a red square, the title in black heavy type, a hairline-heavy rule across the grid, the page number
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1;
    const wrap = h('div', 'tx sw-tt', '<span class="sq"></span><span class="t"></span>', T.html);
    wrap.querySelector('.t').textContent = str;
    const rule = h('div', 'sw-rule', null, T.html);
    const idx = this.page.index + 1, tot = (window.SCRIPT?.PAGES || []).length;
    const pg = h('div', 'sw-pg', `${String(idx).padStart(2, '0')} / ${String(tot).padStart(2, '0')}`, T.html);
    const sq = wrap.querySelector('.sq'), t = wrap.querySelector('.t');
    // placed from STAGE.title (the CSS holds the landscape numbers: 140, 66, 138, 1640, right 140, 76)
    const TT = STAGE.title;
    Object.assign(wrap.style, { left: TT.x + 'px', top: TT.y - 12 + 'px' });
    Object.assign(rule.style, { left: TT.x + 'px', top: TT.y + 60 + 'px', width: STAGE.w - 2 * TT.x + 'px' });
    Object.assign(pg.style, { right: TT.x + 'px', top: TT.y - 2 + 'px' });
    const a = T.act({ at, dur: 0.7, g: wrap, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const e = expo(k);
      wrap.style.opacity = f2((lt >= at ? 1 : 0) * vis);
      sq.style.transform = `scale(${f2(clamp(k * 3))})`;
      t.style.clipPath = `inset(0 ${f2((1 - expo(clamp((k - 0.1) / 0.9))) * 100)}% 0 0)`;
      rule.style.transform = `scaleX(${e.toFixed(4)})`;
      rule.style.opacity = f2(vis);
      pg.style.opacity = f2(clamp((k - 0.4) * 3) * vis);
    } });
    return Object.assign(T.handle(a, wrap), { spans: [t], box: () => ({ x: TT.x, y: TT.y - 12, w: wrap.offsetWidth, h: 44 }) });
  };
})();
