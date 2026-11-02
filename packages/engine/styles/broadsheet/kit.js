/* Broadsheet kit: the financial newspaper's data desk. Charts that build in order (axes → data → one annotation),
 * newspaper furniture (masthead, headline, clipping, ticker, source line) and money objects (an engraved banknote).
 * Every value that changes takes a number or a function of page-local time lt, and everything is a pure function
 * of lt. Chart grammar adapted from huashu-art-motion's t3_finance_chart (MIT, (c) 2026 alchaincyf). */
(function () {
  const { s, h, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const quint = (x) => 1 - Math.pow(1 - clamp(x), 5);
  const smooth5 = (x) => { const k = clamp(x); return k * k * k * (k * (k * 6 - 15) + 10); };
  const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const K = (lt, at, dur, e = ease.out) => e(clamp((lt - at) / dur));
  const f2 = (n) => (+n).toFixed(2);
  let uid = 0;
  const id = (self, p) => `bs${p}${++uid}${self.page.id}`;
  const rgb = (c) => { const x = String(col(c)).replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const mix = (a, b, k) => { const p = rgb(a), q = rgb(b); return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * clamp(k))).join(',')})`; };
  /** number formatting with thousands separators: PV.bsFmt(12345.6, 1) → "12,345.6" */
  const fmt = (v, d = 0) => (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  PV.bsFmt = fmt;
  function niceTicks(min, max, n = 5) {
    const span = max - min || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, out = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return { ticks: out, lo, hi, dec: step < 1 ? Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)) : 0 };
  }
  /** inverse of a monotone easing on [0,1], by bisection */
  const inv = (e, y) => { let a = 0, b = 1; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (e(m) < y) a = m; else b = m; } return (a + b) / 2; };

  // ── small builders ──
  function tx(self, str, o) {
    const el = h('div', 'tx ' + (o.cls || 'hand'), null, o.parent || self.html);
    if (o.html) el.innerHTML = str; else el.textContent = str;
    const align = o.align || 'l', w = o.w ?? (align === 'c' ? 600 : null);
    Object.assign(el.style, { fontSize: o.size + 'px', lineHeight: String(o.lh ?? 1.2), color: col(o.color || 'ink'), whiteSpace: o.w && o.wrap !== false ? 'normal' : 'nowrap', opacity: '0' });
    if (o.weight) el.style.fontWeight = o.weight;
    if (o.ls != null) el.style.letterSpacing = o.ls;
    if (w) el.style.width = w + 'px';
    el.style.textAlign = { l: 'left', c: 'center', r: 'right' }[align];
    if (align === 'r' && !w) el.style.right = (STAGE.w - o.x) + 'px';
    else el.style.left = (align === 'c' ? o.x - w / 2 : align === 'r' ? o.x - w : o.x) + 'px';
    el.style.top = o.y + 'px';
    return el;
  }
  function fade(self, el, at, o = {}) {
    const dur = o.dur ?? 0.45, dy = o.dy ?? 10, dx = o.dx ?? 0;
    self.tick((lt) => {
      const k = K(lt, at, dur) * (o.out != null ? 1 - K(lt, o.out, 0.35) : 1);
      el.style.opacity = f2(k);
      el.style.transform = `translate(${f2((1 - k) * dx)}px, ${f2((1 - k) * dy)}px)`;
    });
    return el;
  }
  /** a straight line that draws from (x1,y1) to (x2,y2) between at and at+dur */
  function drawLine(self, x1, y1, x2, y2, o) {
    const len = Math.hypot(x2 - x1, y2 - y1) + 1;
    const el = s('line', { x1, y1, x2, y2, stroke: col(o.color || 'ink'), 'stroke-width': o.sw ?? 1.5, 'stroke-dasharray': `${len} ${len}`, 'stroke-dashoffset': len, opacity: o.opacity ?? 1 }, o.g || self.svg);
    const at = o.at ?? 0, dur = o.dur ?? 0.5;
    self.tick((lt) => {
      const k = K(lt, at, dur, quint) * (o.out != null ? 1 - K(lt, o.out, 0.35) : 1);
      el.setAttribute('stroke-dashoffset', f2(len * (1 - Math.min(1, K(lt, at, dur, quint)))));
      el.style.opacity = o.out != null ? f2(1 - K(lt, o.out, 0.35)) : '';
      el.style.visibility = k <= 0 && lt < at ? 'hidden' : 'visible';
    });
    return el;
  }
  const outOf = (o) => (o.out != null ? (lt) => 1 - K(lt, o.out, 0.35) : () => 1);

  /** title(str, o): the page headline, newspaper style — a claret bar and small-caps kicker (o.kicker, default the
   *  page's section), a bold serif headline, and a hairline rule across the page. Stays fixed while the camera moves.
   *  o: { kicker, size (56), at (0.15), color } */
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15, size = o.size ?? 56;
    const kicker = o.kicker ?? this.page.section;
    const TX = STAGE.title.x, TY = STAGE.title.y, TR = STAGE.w - STAGE.title.x;
    const bar = s('rect', { x: TX, y: TY - 26, width: 0, height: 7, fill: col('red') }, T.svg);
    T.tick((lt) => bar.setAttribute('width', f2(64 * K(lt, at, 0.35, quint))));
    if (kicker) fade(T, tx(T, kicker, { x: TX + 82, y: TY - 41, size: 26, cls: 'kicker', color: 'red' }), at + 0.1, { dy: 0, dx: -12 });
    const t = T.text(str, { x: TX, y: TY - 4, size, cls: 'serif', weight: 800, at: at + 0.15, cps: o.cps ?? 26, mode: 'words', pen: false, color: o.color || 'ink', lh: 1.25 });
    drawLine(T, TX, TY - 4 + size * 1.25 + 10, TR, TY - 4 + size * 1.25 + 10, { color: 'ink', sw: 1.4, at: at + 0.2, dur: 0.8, opacity: 0.55 });
    return t;
  };

  /** masthead(o): a newspaper nameplate across the top of the page (y 40–250) — thick and thin rules, the paper's name
   *  in big serif, a dateline row (left · centre · right). For an opening page instead of P.title.
   *  o: { name ('经济周报'), left ('第 1024 期'), date ('2005年 · 星期一'), right ('定价 ¥2.00'), y (40), size (110), at (0.1) } */
  B.masthead = function (o = {}) {
    const y = o.y ?? STAGE.title.y - 38, size = o.size ?? 110, at = o.at ?? 0.1;
    const yName = y + 28, yRow = yName + size * 1.18 + 14;
    const L = STAGE.title.x, R = STAGE.w - STAGE.title.x, C = STAGE.w / 2;
    drawLine(this, C, y, L, y, { sw: 6, at, dur: 0.5 }); drawLine(this, C, y, R, y, { sw: 6, at, dur: 0.5 });
    drawLine(this, C, y + 12, L, y + 12, { sw: 1.4, at: at + 0.08, dur: 0.5 }); drawLine(this, C, y + 12, R, y + 12, { sw: 1.4, at: at + 0.08, dur: 0.5 });
    fade(this, tx(this, o.name ?? '经济周报', { x: C, y: yName, w: R - L, align: 'c', size, cls: 'serif', weight: 900, ls: '0.06em' }), at + 0.25, { dy: 14, dur: 0.6 });
    drawLine(this, L, yRow, R, yRow, { sw: 1.4, at: at + 0.45, dur: 0.6 });
    drawLine(this, L, yRow + 48, R, yRow + 48, { sw: 1.4, at: at + 0.5, dur: 0.6 });
    const row = (str, x, align) => str && fade(this, tx(this, str, { x, y: yRow + 10, w: 520, align, size: 24, cls: 'label', color: 'soft' }), at + 0.7, { dy: 0 });
    row(o.left ?? '第 1024 期', L + 10, 'l'); row(o.date, C, 'c'); row(o.right ?? '定价 ¥2.00', R - 10, 'r');
    return { bottom: yRow + 48 };
  };

  /** headline(str, o): a big serif headline anywhere on the page, wiped in line by line, with an optional kicker above and
   *  a sans deck (sub-headline) below. o: { x, y, w (1200), size (84), align, color, kicker, deck, deckSize (34), at, out } */
  B.headline = function (str, o = {}) {
    const x = o.x ?? STAGE.area.x0, y = o.y ?? STAGE.area.y0 + 80, w = o.w ?? 1200, size = o.size ?? 84, at = o.at ?? 0, align = o.align || 'l';
    let top = y;
    if (o.kicker) { fade(this, tx(this, o.kicker, { x, y: top, w, align, size: Math.round(size * 0.3), cls: 'kicker', color: 'red' }), at, { dy: 0, out: o.out }); top += size * 0.5; }
    const el = tx(this, str, { x, y: top, w, align, size, cls: 'serif', weight: 900, lh: 1.12, color: o.color });
    this.tick((lt) => {
      const k = K(lt, at + 0.1, o.dur ?? 0.7, quint), out = outOf(o)(lt);
      el.style.opacity = f2(Math.min(1, k * 3) * out);
      el.style.clipPath = `inset(0 ${f2((1 - k) * 100)}% 0 0)`;
    });
    if (o.deck) {
      const lines = Math.max(1, Math.ceil(PV.tw ? PV.tw(str, size) / w : 1));
      fade(this, tx(this, o.deck, { x, y: top + size * 1.12 * lines + size * 0.28, w, align, size: o.deckSize ?? 34, cls: 'hand', color: 'soft', lh: 1.4 }), at + 0.6, { out: o.out });
    }
    return el;
  };

  /** a printed halftone photograph drawn as dots (45° screen): 'city' skyline at dusk, 'crowd' heads, 'market' a trading floor */
  function halftone(sv, x, y, w, hh, kind, R) {
    const blds = [], heads = [];
    for (let bx = 0; bx < w;) { const bw = 30 + R() * 70; blds.push([bx, bw, hh * (0.25 + R() * 0.55)]); bx += bw + 4; }
    for (let i = 0; i < 40; i++) heads.push([R() * w, hh * (0.45 + R() * 0.55), 18 + R() * 22]);
    const dark = (px, py) => {   // 0 light … 1 dark
      if (kind === 'crowd' || kind === 'market') {
        let d = 0.15 + 0.25 * (py / hh);
        for (const [hx, hy, r] of heads) { const q = Math.hypot(px - hx, (py - hy) * 0.9); if (q < r) d = Math.max(d, 0.85 - q / r * 0.3); else if (py > hy && Math.abs(px - hx) < r * 1.3) d = Math.max(d, 0.7); }
        if (kind === 'market') d = Math.max(d, py < hh * 0.25 && Math.floor(px / 46) % 2 ? 0.55 : 0);
        return d;
      }
      let d = 0.06 + 0.32 * Math.pow(1 - py / hh, 1.6) * 0.4 + 0.18 * Math.hypot(px - w * 0.7, py - hh * 0.3) / w;
      const sun = Math.hypot(px - w * 0.7, py - hh * 0.32); if (sun < hh * 0.12) d = 0;
      for (const [bx, bw, bh] of blds) if (px >= bx && px < bx + bw && py > hh - bh) { d = 0.78; if ((Math.floor((px - bx) / 9) + Math.floor(py / 12)) % 3 === 0 && px - bx > 5 && bx + bw - px > 5) d = 0.35; }
      if (py > hh * 0.88) d = 0.9;
      return d;
    };
    const g = s('g', {}, sv), step = 6.5;
    s('rect', { x, y, width: w, height: hh, fill: '#F6EDE4' }, g);
    for (let j = 0; j * step < hh + step; j++) for (let i = 0; i * step < w + step; i++) {
      const px = i * step + (j % 2 ? step / 2 : 0), py = j * step;
      if (px > w || py > hh) continue;
      const r = Math.sqrt(dark(px, py)) * step * 0.58;
      if (r > 0.4) s('circle', { cx: f2(x + px), cy: f2(y + py), r: f2(r), fill: col('ink') }, g);
    }
  }

  /** body(x, y, w, h, o): newspaper body text typeset as grey column lines that set in top to bottom, column by column —
   *  the density of a real front page around your headline and charts. o: { cols (3), at, dur (1.2), dropCap (a character
   *  set in big serif at the start of column 1), gutter (28), out } */
  B.body = function (x, y, w, hh, o = {}) {
    const cols = o.cols ?? 3, gut = o.gutter ?? 28, cw = (w - gut * (cols - 1)) / cols, at = o.at ?? 0, dur = o.dur ?? 1.2, out = outOf(o);
    const R = PV.rng(PV.hashStr(this.page.id) + Math.round(x + y * 3)), lines = [];
    for (let c = 0; c < cols; c++) {
      if (c) lines.push(drawLine(this, x + c * (cw + gut) - gut / 2, y, x + c * (cw + gut) - gut / 2, y + hh, { color: 'faint', sw: 1.2, at: at + c * 0.15, dur: 0.6, out: o.out }));
      for (let ly = 0, n = 0; ly < hh - 8; ly += 19, n++) {
        const capped = o.dropCap && c === 0 && ly < 76;
        const lx = x + c * (cw + gut) + (capped ? 78 : 0), full = cw - (capped ? 78 : 0);
        const para = R() < 0.09;
        const r = s('rect', { x: f2(lx), y: f2(y + ly), height: 7, width: f2(full * (para ? 0.45 + R() * 0.3 : 0.9 + R() * 0.1)), fill: col('faint'), opacity: 0 }, this.svg);
        const t0 = at + (c * hh + ly) / (cols * hh) * dur;
        this.tick((lt) => { r.style.opacity = f2(K(lt, t0, 0.25) * out(lt)); });
      }
    }
    if (o.dropCap) fade(this, tx(this, o.dropCap, { x: x - 4, y: y - 14, size: 92, cls: 'serif', weight: 900, color: 'red', lh: 1 }), at, { dy: 0, out: o.out });
  };

  /** splash(o): the big moment — a full-width claret (or o.color) band wipes across the content area and a huge serif
   *  figure in paper colour lands on the spoken word, with a kicker above and a serif line below. Use once or twice a film,
   *  for THE number. o: { value, from (0), prefix, suffix, decimals, land, dur (1.0), kicker, line, color ('red'), y (190),
   *  h (700), size (300), spark ([values]: a ghost line of the data drawn behind the figure), text (a word instead of a
   *  number, when value is omitted), at (when the band wipes in; default land - 1.4), out (wipe off) } */
  B.splash = function (o = {}) {
    const land = o.land ?? 1.4, at = o.at ?? land - 1.4, y = o.y ?? STAGE.area.y0 + 10, hh = o.h ?? STAGE.area.y1 - STAGE.area.y0, size = o.size ?? 300, d = o.decimals ?? 0;
    const box = h('div', null, null, this.html);
    Object.assign(box.style, { position: 'absolute', left: '-40px', top: y + 'px', width: (STAGE.w + 80) + 'px', height: hh + 'px', background: col(o.color || 'red'), clipPath: 'inset(0 100% 0 0)' });
    const grain = h('div', null, null, box);
    Object.assign(grain.style, { position: 'absolute', inset: '0', opacity: '0.5', backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1.4px)', backgroundSize: '6px 6px' });
    const paper = '#FFF1E5';
    const k1 = o.kicker ? tx(this, o.kicker, { x: 180, y: 50, size: 30, cls: 'kicker', color: paper, parent: box }) : null;
    const num = tx(this, '', { x: 172, y: 70 + (hh - 140 - size * 1.3) / 2, size, cls: 'num', color: paper, lh: 1.05, parent: box });
    num.style.fontWeight = 800;
    if (o.spark) {   // a ghost of the data behind the figure, in paper colour, drawing in with the band
      const sv = s('svg', { width: 1100, height: hh - 160, style: `position:absolute;right:${80}px;top:80px;overflow:visible` }, box);
      const v = o.spark, lo = Math.min(...v), hi = Math.max(...v), W = 1100, H = hh - 160;
      const d = 'M' + v.map((q, i) => `${f2((i / (v.length - 1)) * W)} ${f2(H - ((q - lo) / (hi - lo || 1)) * H)}`).join(' L');
      const pa = s('path', { d, fill: 'none', stroke: paper, 'stroke-width': 6, 'stroke-linejoin': 'round', opacity: 0.32 }, sv);
      const len = pa.getTotalLength() + 1;
      pa.setAttribute('stroke-dasharray', `${len} ${len}`);
      this.tick((lt) => pa.setAttribute('stroke-dashoffset', f2(len * (1 - smooth5((lt - at - 0.3) / Math.max(0.6, land - at))))));
    }
    const ln = o.line ? tx(this, o.line, { x: 180, y: hh - 130, w: STAGE.w - 420, size: 48, cls: 'serif', color: paper, parent: box, lh: 1.3 }) : null;
    this.tick((lt) => {
      const kin = K(lt, at, 0.55, quint), kout = o.out != null ? K(lt, o.out, 0.45, quint) : 0;
      box.style.clipPath = `inset(0 ${f2((1 - kin) * 100)}% 0 ${f2(kout * 100)}%)`;
      const v = lerp(o.from ?? 0, o.value ?? 0, lt >= land ? 1 : expo((lt - (land - (o.dur ?? 1.0))) / (o.dur ?? 1.0)));
      num.textContent = o.value == null ? (o.text ?? '') : (o.prefix ?? '') + fmt(v, d) + (o.suffix ?? '');
      const press = lt >= land ? 1 + 0.05 * Math.sin(clamp((lt - land) / 0.22) * Math.PI) : 1;
      num.style.opacity = f2(K(lt, at + 0.3, 0.3)); num.style.transform = `scale(${press.toFixed(4)})`; num.style.transformOrigin = '0 70%';
      if (k1) k1.style.opacity = f2(K(lt, at + 0.35, 0.3));
      if (ln) { const kl = K(lt, land + 0.15, 0.4); ln.style.opacity = f2(kl); ln.style.transform = `translateY(${f2((1 - kl) * 10)}px)`; }
    });
    return box;
  };

  /** quote(text, o): a pull quote — giant claret quotation mark, the words in large serif, a hairline and the attribution
   *  in small caps. o: { x (240), y (300), w (1300), size (64), by ('— 凯恩斯，1923'), at, cps (16: written word by word), out } */
  B.quote = function (text, o = {}) {
    const x = o.x ?? STAGE.area.x0 + 100, y = o.y ?? STAGE.area.y0 + 120, w = o.w ?? 1300, size = o.size ?? 64, at = o.at ?? 0;
    const qm = s('text', { x: x - size * 0.2, y: y + size * 1.5, 'font-size': size * 3.4, fill: col('red'), 'font-family': "'Fraunces Variable', serif", 'font-weight': 800, opacity: 0 }, this.svg);
    qm.textContent = '“';
    this.tick((lt) => { const k = K(lt, at, 0.45) * outOf(o)(lt); qm.setAttribute('opacity', f2(k)); qm.setAttribute('transform', `translate(0 ${f2((1 - k) * 20)})`); });
    const t = this.text(text, { x: x + size * 0.9, y, w: w - size * 0.9, size, cls: 'serif', weight: 700, lh: 1.35, at: at + 0.25, cps: o.cps ?? 16, mode: 'words', pen: false });
    if (o.out != null) t.hide(o.out, 0.35);
    const lines = Math.max(1, Math.ceil((PV.tw ? PV.tw(text, size) : text.length * size) / (w - size * 0.9)));
    const by = y + lines * size * 1.35 + 36;
    drawLine(this, x + size * 0.9, by, x + size * 0.9 + 120, by, { color: 'red', sw: 3, at: at + 0.25 + t.a.dur, dur: 0.4, out: o.out });
    if (o.by) fade(this, tx(this, o.by, { x: x + size * 0.9, y: by + 18, size: 28, cls: 'kicker', color: 'soft' }), at + 0.4 + t.a.dur, { dy: 0, out: o.out });
    return t;
  };

  // ── charts ──
  /** shared frame: horizontal gridlines drawn left→right one after another, tick values on the right above each line, a solid
   *  ink baseline at zero (or the bottom), and a unit line top-left */
  function chartFrame(self, x, y, w, hh, min, max, o) {
    const nt = niceTicks(min, max, o.ticksN ?? 4);
    const lo = o.min ?? nt.lo, hi = o.max ?? nt.hi;
    const Y = (v) => y + hh - ((v - lo) / (hi - lo)) * hh;
    const at = o.at ?? 0, tf = o.tickFmt || ((v) => fmt(v, nt.dec));
    nt.ticks.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).forEach((v, i) => {
      const base = Math.abs(v) < 1e-9 || (lo > 0 && i === 0);
      drawLine(self, x, Y(v), x + w, Y(v), { color: base ? 'ink' : 'faint', sw: base ? 2.6 : 1.4, at: at + i * 0.07, dur: 0.55, out: o.out });
      fade(self, tx(self, tf(v), { x: x + w, y: Y(v) - 35, align: 'r', size: 25, cls: 'label', color: 'muted' }), at + 0.15 + i * 0.07, { dy: 6, out: o.out });
    });
    if (o.unit) fade(self, tx(self, o.unit, { x, y: y - 48, size: 26, cls: 'label', color: 'soft' }), at, { dy: 0, out: o.out });
    return { Y, lo, hi };
  }
  function xLabels(self, labels, X, yb, at, o) {
    (labels || []).forEach((l, i) => { if (l === '' || l == null) return; fade(self, tx(self, String(l), { x: X(i), y: yb + 12, w: 220, align: 'c', size: 24, cls: 'label', color: 'soft' }), at + 0.2 + i * 0.03, { dy: -6, out: o.out }); });
  }

  /** lineChart(x, y, w, h, series, o): a newspaper line chart. Axes build first (at), then each line draws through
   *  time left→right (dataAt, dur) with a dot and a live value riding its head, then one annotation pops when the head
   *  passes it. series: [{ values: [..], color ('red' = the story; give others 'blue' or 'muted'), label, area: bool, sw }].
   *  o: { labels: x labels ('' to skip one), min, max, unit ('购买力，元'), at, dataAt (at+0.8), dur (1.8), stagger (0.4),
   *  fmt(v) head label, tickFmt(v), head (true), endLabel (true: series.label at the line's end),
   *  note: { i, text, sub, s (series 0), dx (-60), dy (-130) } — fires the moment the head passes point i,
   *  bands: [{ from, to (x indices), label, at }] shaded periods behind the data (a crisis, a policy), out }
   *  The value riding the head is a solid tag in the line's colour; end labels replace it once the line is drawn.
   *  → { X(i), Y(v), hit(i, s) time the head passes point i, pt(i, s) → [x, y] } */
  B.lineChart = function (x, y, w, hh, series, o = {}) {
    const all = series.flatMap((d) => d.values);
    const fr = chartFrame(this, x, y, w, hh, Math.min(o.zero === false ? Infinity : 0, ...all), Math.max(...all), o);
    const n = Math.max(...series.map((d) => d.values.length));
    const X = (i) => x + (n === 1 ? 0 : (i / (n - 1)) * w);
    const at = o.at ?? 0, dataAt = o.dataAt ?? at + 0.8, dur = o.dur ?? 1.8, fm = o.fmt || ((v) => fmt(v, 0));
    xLabels(this, o.labels, X, y + hh, at, o);
    const out = outOf(o);
    for (const b of o.bands || []) {
      const bx = X(b.from), bw2 = X(b.to) - bx, ba = b.at ?? at + 0.5;
      const r = s('rect', { x: bx, y, width: 0, height: hh, fill: col(b.color || 'inkF'), opacity: 0.75 }, this.svg);
      this.tick((lt) => { r.setAttribute('width', f2(bw2 * K(lt, ba, 0.5, quint))); r.style.opacity = f2(0.75 * out(lt)); });
      if (b.label) fade(this, tx(this, b.label, { x: bx + 10, y: y + 8, size: 24, cls: 'label', color: 'soft' }), ba + 0.3, { dy: 0, out: o.out });
    }
    const start = (si) => dataAt + si * (o.stagger ?? 0.4);
    const hit = (i, si = 0) => start(si) + dur * inv(smooth5, i / (n - 1));
    const pt = (i, si = 0) => [X(i), fr.Y(series[si].values[i])];
    series.forEach((d, si) => {
      const c = d.color || (si === 0 ? 'red' : 'muted');
      const pts = d.values.map((v, i) => [X(i), fr.Y(v)]);
      const dline = 'M' + pts.map((p) => p.map(f2).join(' ')).join(' L');
      const cid = id(this, 'c');
      const cr = s('rect', { x: x - 10, y: y - 200, width: 0, height: hh + 400 }, s('clipPath', { id: cid }, s('defs', {}, this.svg)));
      const g = s('g', { 'clip-path': `url(#${cid})` }, this.svg);
      if (d.area) {
        const gid = id(this, 'a'), gr = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, s('defs', {}, this.svg));
        s('stop', { offset: '0', 'stop-color': col(c), 'stop-opacity': 0.28 }, gr); s('stop', { offset: '1', 'stop-color': col(c), 'stop-opacity': 0.02 }, gr);
        s('path', { d: `${dline} L${f2(pts[pts.length - 1][0])} ${f2(fr.Y(Math.max(fr.lo, 0)))} L${f2(pts[0][0])} ${f2(fr.Y(Math.max(fr.lo, 0)))} Z`, fill: `url(#${gid})` }, g);
      }
      s('path', { d: dline, fill: 'none', stroke: col(c), 'stroke-width': d.sw ?? (si === 0 ? 5 : 3.5), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
      const dot = s('circle', { r: 9, fill: col(c), stroke: '#FFF1E5', 'stroke-width': 3, opacity: 0 }, this.svg);
      const lab = o.head !== false ? tx(this, '', { x: 0, y: 0, size: 32, cls: 'num', color: '#FFF8F1' }) : null;
      if (lab) Object.assign(lab.style, { background: col(c), padding: '2px 12px 4px', borderRadius: '3px', lineHeight: '1.2' });
      const end = d.label && o.endLabel !== false ? tx(this, d.label, { x: pts[pts.length - 1][0] + 18, y: pts[pts.length - 1][1] + 18, size: 26, cls: 'label', color: c }) : null;
      this.tick((lt) => {
        const p = smooth5((lt - start(si)) / dur), on = lt >= start(si) ? out(lt) : 0;
        cr.setAttribute('width', f2(p * (w + 20) + 10));
        g.style.opacity = f2(out(lt));
        const fi = p * (d.values.length - 1), i0 = Math.min(d.values.length - 2, Math.floor(fi)), v = lerp(d.values[i0], d.values[i0 + 1] ?? d.values[i0], fi - i0);
        const hx = x + p * w * ((d.values.length - 1) / (n - 1)), hy = fr.Y(v);
        dot.setAttribute('cx', f2(hx)); dot.setAttribute('cy', f2(hy)); dot.setAttribute('opacity', f2(on));
        if (lab) { lab.textContent = fm(v); lab.style.left = f2(hx + 18) + 'px'; lab.style.top = f2(hy - 62) + 'px'; lab.style.opacity = f2(on * (p >= 1 && end ? 1 - K(lt, start(si) + dur + 0.6, 0.4) : 1)); }
        if (end) end.style.opacity = f2(K(lt, start(si) + dur + 0.6, 0.4) * out(lt));
      });
    });
    if (o.note) {
      const nt = o.note, si = nt.s ?? 0, [px, py] = pt(nt.i, si);
      this.callout(px, py, px + (nt.dx ?? -60), py + (nt.dy ?? -130), nt.text, { sub: nt.sub, at: hit(nt.i, si), color: series[si].color || 'red', out: o.out });
    }
    return { X, Y: fr.Y, hit, pt };
  };

  /** callout(px, py, tx, ty, text, o): the one annotation — a dot pops on the data point, an elbow leader line draws to
   *  (tx, ty), then the text (bold serif) and an optional sub line fade in beside it. o: { sub, at, color ('ink'), size (34),
   *  align ('l' | 'r', default: away from the point), out } */
  B.callout = function (px, py, X, Y, text, o = {}) {
    const at = o.at ?? 0, c = o.color || 'ink', out = outOf(o), size = o.size ?? 34;
    const ring = s('circle', { cx: px, cy: py, r: 0, fill: 'none', stroke: col(c), 'stroke-width': 2.5 }, this.svg);
    const dot = s('circle', { cx: px, cy: py, r: 0, fill: col('ink'), stroke: '#FFF1E5', 'stroke-width': 3 }, this.svg);
    const pts = [[px, py], [X, Y]], d = `M${px} ${py} L${X} ${Y}`;
    const len = Math.hypot(X - px, Y - py) + 1;
    const ln = s('path', { d, fill: 'none', stroke: col('ink'), 'stroke-width': 2, 'stroke-dasharray': `${len} ${len}`, 'stroke-dashoffset': len }, this.svg);
    const align = o.align || (X < px ? 'r' : 'l');
    const tX = align === 'r' ? X - 14 : X + 14;
    const t1 = tx(this, text, { x: tX, y: Y - size * 0.75, align, size, cls: 'serif', weight: 800, color: o.tcolor || 'ink' });
    const t2 = o.sub ? tx(this, o.sub, { x: tX, y: Y + size * 0.55, align, size: 26, cls: 'label', color: 'soft' }) : null;
    this.tick((lt) => {
      const k = clamp((lt - at) / 0.35), sp = k <= 0 ? 0 : 1 + Math.sin(k * Math.PI) * 0.35 * (1 - k), q = out(lt);
      dot.setAttribute('r', f2(8 * sp * (k > 0 ? 1 : 0))); dot.style.opacity = f2(q);
      const pk = clamp((lt - at) / 0.7);
      ring.setAttribute('r', f2(8 + pk * 30)); ring.style.opacity = f2(pk > 0 && pk < 1 ? (1 - pk) * q : 0);
      ln.setAttribute('stroke-dashoffset', f2(len * (1 - K(lt, at + 0.12, 0.3, quint)))); ln.style.opacity = f2(q);
      const kt = K(lt, at + 0.32, 0.35);
      t1.style.opacity = f2(kt * q); t1.style.transform = `translateY(${f2((1 - kt) * 8)}px)`;
      if (t2) { t2.style.opacity = f2(K(lt, at + 0.45, 0.35) * q); }
    });
    return { text: t1 };
  };

  /** barChart(x, y, w, h, items, o): columns that grow from zero one after another, each value counting up on its top;
   *  then the story bar(s) turn claret and the rest fall back to pale grey (focus, focusAt). Bars always start at zero.
   *  items: [{ label, value, at (optional: when this bar grows, e.g. P.cw(2, '2015')) }]. o: { at, max, unit, fmt(v),
   *  focus (index or [indices]), focusAt (default: after the last bar), color ('blue'), focusColor ('red'), gap (0.38), out }
   *  → { X(i) bar centre, top(i) bar top y } */
  B.barChart = function (x, y, w, hh, items, o = {}) {
    const vals = items.map((d) => d.value);
    const fr = chartFrame(this, x, y, w, hh, Math.min(0, ...vals), Math.max(...vals, o.max ?? -Infinity), o);
    const n = items.length, slot = w / n, bw = slot * (1 - (o.gap ?? 0.38));
    const X = (i) => x + slot * (i + 0.5);
    const at = o.at ?? 0, fm = o.fmt || ((v) => fmt(v, 0)), out = outOf(o);
    const grow = (i) => items[i].at ?? at + 0.7 + i * 0.18;
    const focus = [].concat(o.focus ?? []);
    const fAt = o.focusAt ?? Math.max(...items.map((_, i) => grow(i))) + 1.0;
    xLabels(this, items.map((d) => d.label), X, y + hh, at, o);
    items.forEach((d, i) => {
      const r = s('rect', { x: f2(X(i) - bw / 2), width: f2(bw), y: fr.Y(0), height: 0 }, this.svg);
      const lab = tx(this, '', { x: X(i), y: 0, w: slot + 60, align: 'c', size: Math.min(40, Math.max(26, bw * 0.3)), cls: 'num' });
      this.tick((lt) => {
        const k = quint((lt - grow(i)) / 1.0), v = d.value * k, y0 = fr.Y(0), y1 = fr.Y(v);
        r.setAttribute('y', f2(Math.min(y0, y1))); r.setAttribute('height', f2(Math.abs(y1 - y0)));
        const fk = K(lt, fAt, 0.5), isF = focus.includes(i);
        const c = focus.length ? (isF ? mix(o.color || 'blue', o.focusColor || 'red', fk) : mix(o.color || 'blue', 'faint', fk)) : col(o.color || 'blue');
        r.setAttribute('fill', c); r.style.opacity = f2(out(lt));
        lab.textContent = fm(v); lab.style.color = focus.length && !isF ? mix('ink', 'muted', fk) : c;
        lab.style.top = f2(v >= 0 ? y1 - 50 : y1 + 8) + 'px';
        lab.style.opacity = f2((k > 0.02 ? 1 : 0) * out(lt));
      });
    });
    return { X, top: (i) => fr.Y(items[i].value) };
  };

  /** rank(x, y, w, rows, o): a bar-chart race. Horizontal bars sorted by value; when values change over time the rows
   *  glide to their new rank. rows: [{ label, value (number or fn of lt), color }]. o: { at, rowH (68), labelW (230),
   *  max (number or fn of lt; default the largest value at that moment), fmt(v), out } */
  B.rank = function (x, y, w, rows, o = {}) {
    const rowH = o.rowH ?? 68, lw = o.labelW ?? 230, bw = w - lw - 170, at = o.at ?? 0, fm = o.fmt || ((v) => fmt(v, 0)), out = outOf(o);
    const vAt = (r, i, lt) => val(r.value, lt) * quint((lt - at - i * 0.1) / 0.9);
    const order = (lt) => { const vs = rows.map((r, i) => [i, val(r.value, lt)]); vs.sort((a, b) => b[1] - a[1]); const pos = []; vs.forEach(([i], k) => (pos[i] = k)); return pos; };
    const els = rows.map((r) => ({
      bar: s('rect', { x: x + lw, height: rowH * 0.66, width: 0, fill: col(r.color || 'blue') }, this.svg),
      lab: tx(this, r.label, { x: x + lw - 18, y: 0, align: 'r', size: 28, cls: 'label', color: r.color === 'red' ? 'red' : 'ink' }),
      num: tx(this, '', { x: 0, y: 0, w: 220, size: 30, cls: 'num', color: r.color || 'blue' }),
    }));
    drawLine(this, x + lw, y - 10, x + lw, y + rows.length * rowH, { color: 'ink', sw: 2.6, at, dur: 0.5, out: o.out });
    this.tick((lt) => {
      const pos = rows.map(() => 0);
      for (let k = 0; k < 6; k++) order(lt - k * 0.07).forEach((p, i) => (pos[i] += p / 6));
      const max = val(o.max, lt) ?? Math.max(...rows.map((r) => val(r.value, lt)));
      rows.forEach((r, i) => {
        const v = vAt(r, i, lt), ry = y + pos[i] * rowH, bwid = Math.max(0, (v / max) * bw), q = K(lt, at + i * 0.1, 0.4) * out(lt);
        const e = els[i];
        e.bar.setAttribute('y', f2(ry + rowH * 0.17)); e.bar.setAttribute('width', f2(bwid)); e.bar.style.opacity = f2(q);
        e.lab.style.top = f2(ry + rowH * 0.5 - 20) + 'px'; e.lab.style.opacity = f2(q);
        e.num.textContent = fm(v); e.num.style.left = f2(x + lw + bwid + 14) + 'px'; e.num.style.top = f2(ry + rowH * 0.5 - 24) + 'px'; e.num.style.opacity = f2(q);
      });
    });
  };

  /** bigNumber(x, y, o): a huge serif figure that counts up and lands exactly on `land` (time it is spoken, e.g.
   *  P.cw(1, '一半')), settles with a small press and a claret rule drawn under it; a sans label sits below.
   *  o: { value, from (0), prefix, suffix, decimals, land, dur (1.1), size (220), color ('red'), label, labelSize (34),
   *  align ('l' | 'c' | 'r'), w (1000), at (when it first appears; default land - dur), out } */
  B.bigNumber = function (x, y, o = {}) {
    const size = o.size ?? 220, land = o.land ?? (o.at ?? 0) + 1.2, dur = o.dur ?? 1.1, at = o.at ?? land - dur, d = o.decimals ?? 0;
    const align = o.align || 'l', w = o.w ?? 1000, out = outOf(o), c = o.color || 'red';
    const el = tx(this, '', { x, y, w, align, size, cls: 'num', color: c, lh: 1 });
    el.style.fontWeight = 800;
    el.style.transformOrigin = align === 'c' ? '50% 70%' : align === 'r' ? '100% 70%' : '0% 70%';
    const lab = o.label ? tx(this, o.label, { x, y: y + size * 1.08 + 26, w, align, size: o.labelSize ?? 34, cls: 'hand', color: 'soft', lh: 1.35 }) : null;
    const rw = Math.min(w, size * 2.2), rx = align === 'c' ? x - rw / 2 : align === 'r' ? x - rw : x;
    const rule = s('rect', { x: rx, y: y + size * 1.04, width: 0, height: 8, fill: col(c) }, this.svg);
    this.tick((lt) => {
      const k = expo((lt - (land - dur)) / dur), v = lerp(o.from ?? 0, o.value, lt >= land ? 1 : k), q = K(lt, at, 0.3) * out(lt);
      el.textContent = (o.prefix ?? '') + fmt(v, d) + (o.suffix ?? '');
      const press = lt >= land ? 1 + 0.06 * Math.sin(clamp((lt - land) / 0.22) * Math.PI) : 1;
      el.style.opacity = f2(q); el.style.transform = `scale(${press.toFixed(4)})`;
      rule.setAttribute('width', f2(rw * K(lt, land, 0.45, quint))); rule.style.opacity = f2(out(lt));
      if (lab) { const kl = K(lt, land + 0.1, 0.4); lab.style.opacity = f2(kl * out(lt)); lab.style.transform = `translateY(${f2((1 - kl) * 8)}px)`; }
    });
    return el;
  };

  /** smallMultiples(x, y, w, h, panels, o): a grid of small line charts sharing one scale, drawn one after another; the
   *  story panel's line is claret, the others ink. panels: [{ title, values: [..] }]. o: { cols (auto), focus (index),
   *  at, stagger (0.3), dur (1.0), fmt(v) end value, min, max, out } */
  B.smallMultiples = function (x, y, w, hh, panels, o = {}) {
    const n = panels.length, cols = o.cols ?? Math.min(n, n <= 4 ? n : Math.ceil(n / 2)), rowsN = Math.ceil(n / cols);
    const gx = 48, gy = 64, pw = (w - gx * (cols - 1)) / cols, ph = (hh - gy * (rowsN - 1)) / rowsN;
    const all = panels.flatMap((p) => p.values), lo = o.min ?? Math.min(0, ...all), hi = o.max ?? Math.max(...all);
    const at = o.at ?? 0, fm = o.fmt || ((v) => fmt(v, 0)), out = outOf(o);
    panels.forEach((p, i) => {
      const cx = x + (i % cols) * (pw + gx), cy = y + Math.floor(i / cols) * (ph + gy), t0 = at + i * (o.stagger ?? 0.3);
      const c = o.focus === i ? 'red' : 'ink';
      fade(this, tx(this, p.title, { x: cx, y: cy, size: 26, cls: 'label', color: o.focus === i ? 'red' : 'ink' }), t0, { dy: 6, out: o.out });
      const top = cy + 44, bh = ph - 44 - 10;
      drawLine(this, cx, top + bh, cx + pw, top + bh, { color: 'ink', sw: 2, at: t0, dur: 0.4, out: o.out });
      drawLine(this, cx, top + bh / 2, cx + pw, top + bh / 2, { color: 'faint', sw: 1.2, at: t0 + 0.05, dur: 0.4, out: o.out });
      const Y = (v) => top + bh - ((v - lo) / (hi - lo || 1)) * bh, m = p.values.length;
      const pts = p.values.map((v, j) => [cx + (j / (m - 1)) * (pw - 70), Y(v)]);
      const d = 'M' + pts.map((q) => q.map(f2).join(' ')).join(' L');
      const pa = s('path', { d, fill: 'none', stroke: col(c), 'stroke-width': o.focus === i ? 4.5 : 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, this.svg);
      const len = pa.getTotalLength ? pa.getTotalLength() + 1 : 4000;
      pa.setAttribute('stroke-dasharray', `${len} ${len}`);
      const end = tx(this, fm(p.values[m - 1]), { x: pts[m - 1][0] + 10, y: pts[m - 1][1] - 20, size: 26, cls: 'num', color: c });
      this.tick((lt) => {
        pa.setAttribute('stroke-dashoffset', f2(len * (1 - smooth5((lt - t0 - 0.2) / (o.dur ?? 1.0))))); pa.style.opacity = f2(out(lt));
        end.style.opacity = f2(K(lt, t0 + 0.2 + (o.dur ?? 1.0), 0.3) * out(lt));
      });
    });
  };

  /** clipping(x, y, w, h, o): a cut-out newspaper clipping with deckled edges and a soft shadow, sliding onto the desk
   *  and settling at a slight angle — kicker, serif headline, date, a hairline, a sans deck and grey column lines for body
   *  text; optional halftone photo block. Use it for "the news said…", a historical moment, a quote with a source.
   *  o: { head, kicker, date, deck, photo (true: a halftone block at the top), rot (-2.5), at, size (headline px, auto),
   *  accent ('red'), out } → the wrapper element */
  B.clipping = function (x, y, w, hh, o = {}) {
    const at = o.at ?? 0, rot = o.rot ?? -2.5, out = outOf(o), R = PV.rng(PV.hashStr(this.page.id + (o.head || '')) + x * 7 + y);
    const wrap = h('div', null, null, this.html);
    Object.assign(wrap.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', filter: 'drop-shadow(0 14px 18px rgba(90,45,20,0.20)) drop-shadow(0 2px 3px rgba(90,45,20,0.18))', opacity: '0' });
    const sv = s('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, style: 'position:absolute;left:0;top:0;overflow:visible' }, wrap);
    const edge = [];
    const jag = (x1, y1, x2, y2, n, amp) => { for (let i = 0; i < n; i++) { const k = i / n; edge.push([lerp(x1, x2, k) + (y1 === y2 ? 0 : (R() - 0.5) * amp), lerp(y1, y2, k) + (y1 === y2 ? (R() - 0.5) * amp : 0)]); } };
    jag(0, 0, w, 0, Math.round(w / 9), 5); jag(w, 0, w, hh, Math.round(hh / 9), 5); jag(w, hh, 0, hh, Math.round(w / 9), 5); jag(0, hh, 0, 0, Math.round(hh / 9), 5);
    s('path', { d: 'M' + edge.map((p) => p.map(f2).join(' ')).join(' L') + ' Z', fill: col('paper') }, sv);
    const pad = Math.max(28, w * 0.06);
    let cy = pad;
    if (o.photo) {
      const ph = Math.round(hh * 0.36), pw = w - pad * 2;
      halftone(sv, pad, cy, pw, ph, o.photo === true ? 'city' : o.photo, R);
      cy += ph + 18;
    }
    const lab = (str, size, cls, color, extra = {}) => { const el = tx(this, str, { x: pad, y: cy, w: w - pad * 2, size, cls, color, parent: wrap, lh: extra.lh ?? 1.15, ...extra }); el.style.opacity = '1'; return el; };
    if (o.kicker || o.date) {
      if (o.kicker) lab(o.kicker, 24, 'kicker', o.accent || 'red', { w: null });
      if (o.date) lab(o.date, 24, 'label', 'muted', { x: w - pad - (PV.tw ? PV.tw(o.date, 24) : o.date.length * 13) - 8, w: null });
      cy += 52;
    }
    const hs = o.size ?? Math.round(Math.min(64, Math.max(34, (w - pad * 2) / Math.max(6, (o.head || '').length * 0.62))));
    if (o.head) { const el = lab(o.head, hs, 'serif', 'ink', { weight: 900 }); cy += Math.ceil((PV.tw ? PV.tw(o.head, hs) : o.head.length * hs) / (w - pad * 2) + 0.15) * hs * 1.15 + 12; }
    s('line', { x1: pad, y1: cy, x2: w - pad, y2: cy, stroke: col('ink'), 'stroke-width': 1.2, opacity: 0.6 }, sv);
    cy += 14;
    if (o.deck) { lab(o.deck, 24, 'hand', 'soft', { lh: 1.4 }); cy += Math.ceil((PV.tw ? PV.tw(o.deck, 24) : o.deck.length * 24) / (w - pad * 2) + 0.1) * 34 + 10; }
    const colsN = w > 560 ? 2 : 1, cw = (w - pad * 2 - (colsN - 1) * 24) / colsN;
    for (let c = 0; c < colsN; c++) for (let ly = cy; ly < hh - pad; ly += 18) s('rect', { x: pad + c * (cw + 24), y: ly, width: f2(cw * (ly + 18 >= hh - pad ? 0.55 : 0.82 + R() * 0.18)), height: 7, fill: col('faint'), opacity: 0.9 }, sv);
    this.tick((lt) => {
      const k = K(lt, at, 0.7), q = out(lt);
      wrap.style.opacity = f2(Math.min(1, k * 2.5) * q);
      wrap.style.transform = `translate(${f2((1 - k) * 40)}px, ${f2((1 - k) * 70)}px) rotate(${f2(rot + (1 - k) * 7)}deg)`;
    });
    return wrap;
  };

  /** banknote(cx, cy, w, o): an engraved banknote — guilloche rosette, fine-line ground, double frame, the value in big
   *  serif. o.worth (fn of lt → 0..1) shows purchasing power: the part beyond it fades to a ghost behind a dashed claret
   *  cut line — inflation eating the note. o: { value ('100'), unit ('元'), label ('中国人民银行'), serial, color ('green'),
   *  scale (number or fn of lt), rot (-3), worth, at, out } → { worthX(k) screen x of the cut line at fraction k } */
  B.banknote = function (cx, cy, w, o = {}) {
    const hh = w * 0.5, c = col(o.color || 'green'), at = o.at ?? 0, out = outOf(o);
    const g = s('g', { opacity: 0 }, this.svg), x0 = -w / 2, y0 = -hh / 2;
    const cid = id(this, 'n'), defs = s('defs', {}, g);
    s('rect', { x: x0, y: y0, width: w, height: hh, rx: 10 }, s('clipPath', { id: cid }, defs));
    const body = s('g', { 'clip-path': `url(#${cid})` }, g);
    s('rect', { x: x0, y: y0, width: w, height: hh, fill: mix(o.color || 'green', 'paper', 0.82) }, body);
    for (let i = -hh; i < w; i += 9) s('line', { x1: x0 + i, y1: y0 + hh, x2: x0 + i + hh, y2: y0, stroke: c, 'stroke-width': 0.8, opacity: 0.16 }, body);
    const rose = (rx, ry, R1, r2, dd, rotA, sw, op) => {
      const pts = [];
      for (let t = 0; t <= Math.PI * 2 * r2 / 3 + 0.01; t += 0.02) {
        const a = (R1 - r2) / r2 * t;
        pts.push([rx + (R1 - r2) * Math.cos(t + rotA) + dd * Math.cos(a - rotA), ry + (R1 - r2) * Math.sin(t + rotA) - dd * Math.sin(a - rotA)]);
      }
      s('path', { d: 'M' + pts.map((p) => p.map(f2).join(' ')).join(' L'), fill: 'none', stroke: c, 'stroke-width': sw, opacity: op }, body);
    };
    const rr = hh * 0.36, rcx = x0 + w * 0.26;
    rose(rcx, 0, rr, rr * 0.35, rr * 0.62, 0, 1.1, 0.75); rose(rcx, 0, rr * 0.8, rr * 0.27, rr * 0.5, 0.4, 0.9, 0.55);
    s('circle', { cx: rcx, cy: 0, r: rr * 1.08, fill: 'none', stroke: c, 'stroke-width': 1.5, opacity: 0.6 }, body);
    s('rect', { x: x0 + 10, y: y0 + 10, width: w - 20, height: hh - 20, rx: 6, fill: 'none', stroke: c, 'stroke-width': 3 }, body);
    s('rect', { x: x0 + 20, y: y0 + 20, width: w - 40, height: hh - 40, rx: 4, fill: 'none', stroke: c, 'stroke-width': 1 }, body);
    const txt = (str, x, y, size, anchor, fam, weight, op = 1) => { const e = s('text', { x, y, 'font-size': size, 'text-anchor': anchor, fill: c, 'font-family': fam, 'font-weight': weight, opacity: op }, body); e.textContent = str; return e; };
    txt(o.value ?? '100', x0 + w - 44, y0 + hh * 0.72, hh * 0.46, 'end', "'Fraunces Variable', 'Noto Serif SC Variable', serif", 800);
    if (o.unit ?? '元') txt(o.unit ?? '元', x0 + w - 44, y0 + hh * 0.86, hh * 0.1, 'end', "'Noto Serif SC Variable', serif", 700);
    txt(o.label ?? '中国人民银行', x0 + w * 0.5, y0 + hh * 0.2, hh * 0.085, 'start', "'Noto Serif SC Variable', serif", 800);
    txt(o.serial ?? 'FT 2005 0417', x0 + w * 0.5, y0 + hh * 0.31, hh * 0.05, 'start', "'IBM Plex Mono', monospace", 400, 0.75);
    // purchasing-power cut
    const ghost = s('rect', { x: x0, y: y0 - 4, width: 0, height: hh + 8, fill: '#FFF1E5', opacity: 0.78 }, g);
    const cut = s('line', { x1: 0, y1: y0 - 18, x2: 0, y2: y0 + hh + 18, stroke: col('red'), 'stroke-width': 3, 'stroke-dasharray': '12 8', opacity: 0 }, g);
    this.tick((lt) => {
      const k = K(lt, at, 0.6), q = out(lt), sc = val(o.scale, lt, 1) * lerp(0.92, 1, k), r = (o.rot ?? -3) + (1 - k) * -5;
      g.setAttribute('opacity', f2(k * q));
      g.setAttribute('transform', `translate(${f2(cx)} ${f2(cy + (1 - k) * 30)}) rotate(${f2(r)}) scale(${sc.toFixed(4)})`);
      if (o.worth) {
        const wk = clamp(val(o.worth, lt, 1)), xx = x0 + w * wk;
        ghost.setAttribute('x', f2(xx)); ghost.setAttribute('width', f2(w * (1 - wk)));
        cut.setAttribute('x1', f2(xx)); cut.setAttribute('x2', f2(xx)); cut.setAttribute('opacity', wk < 0.999 ? '1' : '0');
      }
    });
    return { worthX: (k) => cx + (x0 + w * k) * val(o.scale, at + 1, 1) };
  };

  /** ticker(x, y, w, items, o): a stock-ticker tape — a dark strip with names, prices and ▲/▼ changes scrolling left.
   *  items: [{ name, value, change (number, + up / − down) }]. o: { at, speed (px/s, 90), size (28), upColor ('green'),
   *  downColor ('red'), out }. Up/down colours: say which convention the film uses if it matters. */
  B.ticker = function (x, y, w, items, o = {}) {
    const size = o.size ?? 28, hh = size * 2, at = o.at ?? 0, out = outOf(o);
    const box = h('div', null, null, this.html);
    Object.assign(box.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', overflow: 'hidden', background: col('ink'), opacity: '0' });
    const inner = h('div', null, null, box);
    Object.assign(inner.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', lineHeight: hh + 'px', fontSize: size + 'px', color: '#F3E6DA', opacity: '1' });
    const one = items.map((it) => {
      const up = it.change >= 0, cc = col(up ? o.upColor || 'green' : o.downColor || 'red');
      const bright = mix(cc, '#FFFFFF', 0.35);
      return `<span style="font-family:var(--hand);font-weight:700;letter-spacing:.04em">${it.name}</span>&nbsp;&nbsp;<span style="font-family:var(--latin);font-weight:700">${it.value}</span>&nbsp;<span style="color:${bright};font-family:var(--latin);font-weight:700">${up ? '▲' : '▼'}${Math.abs(it.change)}%</span><span style="display:inline-block;width:64px"></span>`;
    }).join('');
    inner.innerHTML = one + one;
    let half = 0;
    this.tick((lt) => {
      if (!half) half = inner.scrollWidth / 2 || 1;
      const q = K(lt, at, 0.4) * out(lt);
      box.style.opacity = f2(q);
      inner.style.transform = `translateX(${f2(-(((Math.max(0, lt - at) * (o.speed ?? 90)) % half)))}px)`;
    });
    return box;
  };

  /** source(text, o): the footnote line every chart page carries — "来源：…" small, bottom-left (y 846), with an optional
   *  badge bottom-right (o.badge, e.g. '示意数据' when the numbers are illustrative). o: { at, badge, out } */
  B.source = function (text, o = {}) {
    const at = o.at ?? 0.6;
    fade(this, tx(this, text, { x: STAGE.area.x0, y: o.y ?? STAGE.area.y1 - 34, size: 24, cls: 'label', color: 'muted' }), at, { dy: 0, out: o.out });
    if (o.badge) {
      const el = tx(this, o.badge, { x: STAGE.area.x1, y: (o.y ?? STAGE.area.y1 - 34) - 4, align: 'r', size: 24, cls: 'label', color: 'red' });
      Object.assign(el.style, { border: `2px solid ${col('red')}`, padding: '2px 10px', borderRadius: '3px' });
      fade(this, el, at + 0.1, { dy: 0, out: o.out });
    }
  };

  /** rule(x, y, w, o): a printed hairline that draws left→right; o.double adds a second line below (a section break),
   *  o.heavy makes it a 6px column rule. o: { at, dur (0.6), color ('ink'), double, heavy, vertical (draws downward, w = length), out } */
  B.rule = function (x, y, w, o = {}) {
    const at = o.at ?? 0, sw = o.heavy ? 6 : 1.4;
    const x2 = o.vertical ? x : x + w, y2 = o.vertical ? y + w : y;
    drawLine(this, x, y, x2, y2, { color: o.color || 'ink', sw, at, dur: o.dur ?? 0.6, out: o.out });
    if (o.double) drawLine(this, o.vertical ? x + 8 : x, o.vertical ? y : y + 8, o.vertical ? x + 8 : x2, o.vertical ? y2 : y + 8, { color: o.color || 'ink', sw: 1.4, at: at + 0.06, dur: o.dur ?? 0.6, out: o.out });
  };
})();
