/* Neon noir · kit: everything is drawn in light. Neon tubes that ignite stroke by stroke with a flicker, neon-sign
 * lettering, numbers that glitch into place with an RGB split, mono HUD labels and readouts, glowing nodes joined by
 * links that carry pulses, segmented LED meters, a synthwave grid floor with a striped sun, a city skyline, rain, HUD
 * panels, a scanline cut between scenes and a bloom flash for the one moment that must hit.
 * Every component is a pure function of page time lt: no Math.random, Date or requestAnimationFrame. */
(function () {
  const { s, h, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const f2 = (n) => (+n).toFixed(2);
  const f4 = (n) => (+n).toFixed(4);
  const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const expoIn = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * clamp(x) - 10));
  const hash = (i, j = 0) => { let x = Math.imul((i | 0) * 374761393 + (j | 0) * 668265263, 1274126177) >>> 0; x = Math.imul(x ^ (x >>> 13), 1103515245) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  let uid = 0;

  // ── colour: a neon colour, its white-hot core, its glow ───────────────────────────────────────────────────────
  const hex = (c) => { const v = col(c); return /^#[0-9a-f]{6}$/i.test(v) ? v : '#FF2E88'; };
  const rgb = (c) => { const v = hex(c); return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  /** the colour pushed toward white by t (0..1): the bright core of a lit tube */
  const hot = (c, t = 0.6) => { const [r, g, b] = rgb(c); return `rgb(${[r, g, b].map((v) => Math.round(v + (255 - v) * t)).join(',')})`; };
  const rgba = (c, a) => `rgba(${rgb(c).join(',')},${a})`;
  /** the halo of neon text: a white-hot rim, then two widening coloured blooms (k scales the spread) */
  const glow = (c, k = 1) => `0 0 ${f2(2 * k)}px rgba(255,255,255,0.75), 0 0 ${f2(7 * k)}px ${rgba(c, 0.95)}, 0 0 ${f2(18 * k)}px ${rgba(c, 0.75)}, 0 0 ${f2(42 * k)}px ${rgba(c, 0.45)}`;
  PV.neonGlow = glow;
  /**
   * ignition flicker: brightness of a tube u seconds after it is switched on — a stutter of off/on for ~0.4 s, then
   * steady. seed picks the stutter, so neighbouring tubes don't blink in unison.
   */
  const flick = (u, seed = 0) => {
    if (u < 0) return 0;
    if (u > 0.42) return 1;
    const v = hash(Math.floor(u * 30), seed);
    return u < 0.12 ? (v > 0.45 ? 0.85 : 0.06) : (v > 0.25 ? 1 : 0.22);
  };
  PV.neonFlick = flick;

  // ── svg plumbing: one full-stage svg per component, with its own glow filter ───────────────────────────────────
  function stageSvg(self, z) {
    const svg = s('svg', { class: 'ne-svg', width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` }, self.html);
    if (z != null) svg.style.zIndex = z;
    return svg;
  }
  const defs = (svg) => svg.querySelector(':scope > defs') || s('defs', null, svg);
  function glowFilter(svg, k = 1) {
    const id = `ng${++uid}`;
    const f = s('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%', 'color-interpolation-filters': 'sRGB' }, defs(svg));
    s('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: f2(2.5 * k), result: 'a' }, f);
    s('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: f2(9 * k), result: 'b' }, f);
    const m = s('feMerge', null, f);
    for (const r of ['b', 'b', 'a', 'SourceGraphic']) s('feMergeNode', { in: r }, m);
    return `url(#${id})`;
  }

  // ── paths ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** PV.rr(x, y, w, h, r): a rounded-rectangle path, drawn clockwise from the top-left corner (for P.tube) */
  PV.rr = (x, y, w, hh, r = 18) => { r = Math.min(r, w / 2, hh / 2); return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + hh - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + hh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + hh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`; };
  /** PV.circ(cx, cy, r): a circle path starting at the top (for P.tube) */
  PV.circ = (cx, cy, r) => `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}Z`;

  /**
   * tube(d, o): a neon tube along an SVG path — it is drawn on from its start like a gas tube lighting up, stutters on
   * with an ignition flicker, then glows steadily: a coloured tube with a white-hot core and a wide bloom. The basic
   * mark of this style: outlines, arrows, underlines, signs, icons drawn as paths. PV.rr(x, y, w, h, r) and
   * PV.circ(cx, cy, r) make paths. o: { color ('red' = magenta; 'blue' cyan, 'purple' violet, 'green', 'yellow',
   * 'orange', 'ink' white), sw (tube width, 6), at, dur (draw-on time, 0.6), flicker (true), glow (bloom size, 1),
   * fill (a colour: the shape glows faintly inside), dashed (true: a dashed tube, for a path not yet taken), z, out }.
   */
  B.tube = function (d, o = {}) {
    const c = o.color || 'red', sw = o.sw ?? 6, at = o.at ?? 0, dur = o.dur ?? 0.6, seed = ++uid;
    const svg = stageSvg(this, o.z);
    const g = s('g', { filter: glowFilter(svg, o.glow ?? 1), opacity: 0 }, svg);
    const dash = o.dashed ? { 'stroke-dasharray': `${sw * 3} ${sw * 2.6}` } : {};
    if (o.fill) s('path', { d, fill: rgba(o.fill, 0.16), stroke: 'none' }, g);
    const base = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const outer = s('path', { ...base, stroke: hex(c), 'stroke-width': sw, ...dash }, g);
    const core = s('path', { ...base, stroke: hot(c, 0.72), 'stroke-width': Math.max(1.4, sw * 0.36), ...dash }, g);
    // a clip that grows along the path's bounding box would cut corners: draw on with a dash over a measured length
    let len = 0;
    const span = o.out != null ? Math.max(dur + 0.45, o.out + 0.3 - at) : dur + 0.45;
    const a = this.act({ at, dur: span, g: svg, kind: 'draw', pen: false, apply: (_, lt, vis) => {
      if (!len) {
        len = outer.getTotalLength() + 2;
        if (!o.dashed) for (const p of [outer, core]) p.style.strokeDasharray = `${len} ${len}`;
      }
      const p = ease.out(clamp((lt - at) / dur));
      if (o.dashed) { const cl = `inset(0 ${f2((1 - p) * 100)}% 0 0)`; g.style.clipPath = cl; }
      else for (const q of [outer, core]) q.style.strokeDashoffset = f2(len * (1 - p));
      const fl = o.flicker === false ? (lt >= at ? 1 : 0) : flick(lt - at, seed);
      const out = o.out != null ? 1 - clamp((lt - o.out) / 0.25) : 1;
      g.setAttribute('opacity', f2(fl * vis * out));
    } });
    return this.handle(a, svg);
  };

  /** neonBox(x, y, w, h, o): a rounded neon frame (a P.tube around a rectangle) — o: everything P.tube takes, plus r (corner radius, 18). Cards, screens, boxes for a word. */
  B.neonBox = function (x, y, w, hh, o = {}) { return this.tube(PV.rr(x, y, w, hh, o.r ?? 18), o); };
  /** neonRing(cx, cy, r, o): a neon circle (a P.tube) — o: as P.tube. Circling the thing that matters, a planet, a coin, a target. */
  B.neonRing = function (cx, cy, r, o = {}) { return this.tube(PV.circ(cx, cy, r), o); };
  /** neonLine(x1, y1, x2, y2, o): a straight neon tube — o: as P.tube, plus head (true: an arrowhead at the end). Arrows, rules, axes. */
  B.neonLine = function (x1, y1, x2, y2, o = {}) {
    let d = `M${x1} ${y1}L${x2} ${y2}`;
    if (o.head) { const ang = Math.atan2(y2 - y1, x2 - x1), L = o.headLen ?? 26; for (const s0 of [-1, 1]) { const a2 = ang + Math.PI + s0 * 0.5; d += `M${x2} ${y2}L${f2(x2 + Math.cos(a2) * L)} ${f2(y2 + Math.sin(a2) * L)}`; } }
    return this.tube(d, o);
  };

  // ── lettering ──────────────────────────────────────────────────────────────────────────────────────────────
  const MARK = { r: 'red', b: 'blue', p: 'purple', g: 'green', y: 'yellow', o: 'orange', k: 'ink', m: 'muted', s: 'soft' };
  function segs(str) {
    const out = [], re = /\{(\w):([^}]*)\}/g;
    let last = 0, m;
    while ((m = re.exec(str))) { if (m.index > last) out.push({ text: str.slice(last, m.index) }); out.push({ text: m[2], color: MARK[m[1]] }); last = m.index + m[0].length; }
    if (last < str.length) out.push({ text: str.slice(last) });
    return out;
  }

  /**
   * sign(str, o): neon-sign lettering — each character switches on in turn with its own ignition flicker and then
   * glows: pale core, coloured halo. The headline voice of this style (key words, the thesis, a name, a slogan).
   * o: { x, y, size (110), color (glow colour, 'red' magenta), weight (700), at, stagger (s per character, 0.045),
   * align 'l'|'c'|'r', w (wrap width; else one line, '\n' breaks), lh (1.08), hollow (true: outlined tube letters — for
   * one or two huge words), glow (halo size, 1), buzz (index of one character that keeps flickering faintly — a dying
   * sign; use once a film at most), out }. Markup: {b:word} cyan, {p:…} violet, {g:…} green, {y:…} yellow, {k:…} white,
   * {m:…} dim. Keep it short: a sign is 1–6 words; supporting lines use P.text or P.label.
   * Returns a handle with .box() → { x, y, w, h }.
   */
  B.sign = function (str, o = {}) {
    const size = o.size ?? 110, at = o.at ?? 0, st = o.stagger ?? 0.045, base = o.color || 'red', seed = ++uid;
    const el = h('div', 'tx ne-sign' + (o.w ? ' wrap' : '') + (o.hollow ? ' hollow' : ''), null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', fontWeight: o.weight ?? 700, lineHeight: String(o.lh ?? 1.08), textShadow: 'none' });
    if (o.w) el.style.width = o.w + 'px';
    const align = o.align || 'l';
    el.style.textAlign = { l: 'left', c: 'center', r: 'right' }[align];
    const chars = [];
    for (const sg of segs(String(str))) {
      const c = sg.color || base;
      for (const part of sg.text.split(/(\n)/)) {
        if (part === '\n') { h('br', null, null, el); continue; }
        // a Latin word stays together; CJK breaks anywhere
        for (const word of part.match(/[⺀-￯]|[^\s⺀-￯]+|\s+/g) || []) {
          const wrap = /^\s+$/.test(word) || /[⺀-￯]/.test(word) ? el : h('span', 'w', null, el);
          for (const ch of word) {
            const sp = h('span', 'ch', null, wrap);
            sp.textContent = ch;
            const dim = c === 'muted' || c === 'soft';
            sp.style.color = dim ? col(c) : hot(c, 0.62);
            if (o.hollow) { sp.style.webkitTextStroke = `${f2(Math.max(2, size * 0.03))}px ${dim ? col(c) : hot(c, 0.55)}`; sp.style.color = 'transparent'; }
            // hollow letters glow through a filter: a text-shadow would paint the whole glyph and fill them in
            const gk = (o.glow ?? 1) * size / 110;
            sp._glow = dim ? 'none' : o.hollow ? `drop-shadow(0 0 ${f2(3 * gk)}px ${rgba(c, 1)}) drop-shadow(0 0 ${f2(14 * gk)}px ${rgba(c, 0.7)})` : glow(c, gk);
            sp._off = rgba(dim ? 'muted' : c, 0.18);
            if (!/\s/.test(ch)) chars.push(sp);
          }
        }
      }
    }
    const place = () => { const w = el.offsetWidth; el.style.left = (align === 'c' ? o.x - w / 2 : align === 'r' ? o.x - w : o.x) + 'px'; el.style.top = o.y + 'px'; };
    place();
    const n = chars.length, total = 0.45 + st * Math.max(0, n - 1);
    const span = o.out != null ? Math.max(total, o.out + 0.3 - at) : total;
    let placed = false;
    const a = this.act({ at, dur: span, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
      if (!placed) { place(); placed = true; }
      const out = o.out != null ? 1 - clamp((lt - o.out) / 0.22) : 1;
      el.style.opacity = f2((lt >= at ? 1 : 0) * vis * out);
      for (let i = 0; i < n; i++) {
        const u = lt - at - i * st, sp = chars[i];
        const b = flick(u, seed + i * 7);
        const key = b <= 0 ? 0 : b < 0.5 ? 1 : 2;
        if (sp._k === key) continue;
        sp._k = key;
        sp.style.opacity = key === 0 ? '0' : '1';
        if (o.hollow) sp.style.filter = key === 2 ? sp._glow : key === 1 ? 'brightness(0.35)' : 'none';
        else { sp.style.textShadow = key === 2 ? sp._glow : 'none'; sp.style.filter = key === 1 ? 'brightness(0.35)' : 'none'; }
      }
    } });
    // a dying sign: one letter keeps stuttering after the rest have settled
    if (o.buzz != null && chars[o.buzz]) {
      const sp = chars[o.buzz], t0 = at + o.buzz * st + 0.6;
      this.tick((lt) => {
        if (lt < t0) return;
        const dim = hash(Math.floor(lt * 14), seed) > 0.86;
        if (o.hollow) sp.style.filter = dim ? 'brightness(0.3)' : sp._glow;
        else { sp.style.filter = dim ? 'brightness(0.3)' : 'none'; sp.style.textShadow = dim ? 'none' : sp._glow; }
      });
    }
    const hnd = this.handle(a, el);
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  /**
   * glitch(x, y, o): a big number that glitches into place — its digits scramble, lock one by one from the left, and
   * land with an RGB split (magenta and cyan ghosts) that snaps back to a clean glow. Lands exactly at at + dur: for a
   * spoken number use at: P.cw(i, '30%') - dur. o: { to, decimals (0), prefix, suffix (same size, e.g. '%'), unit
   * (smaller, after it: 'x', '亿'), size (260), color ('ink' white with a violet halo; or 'red', 'blue'…), at, dur (0.7),
   * mode 'scramble' (default) | 'count' (counts up from `from`, for growth), from (0), sep (true: 1,000), align 'l'|'r'|'c', out }.
   * One per screen; it IS the composition.
   */
  B.glitch = function (x, y, o = {}) {
    const size = o.size ?? 260, at = o.at ?? 0, dur = o.dur ?? 0.7, dec = o.decimals ?? 0, c = o.color || 'ink', seed = ++uid;
    const el = h('div', 'tx ne-num', null, this.html);
    const halo = c === 'ink' ? 'purple' : c;
    Object.assign(el.style, { fontSize: size + 'px', color: c === 'ink' ? '#F6F3FF' : hot(c, 0.55), top: y + 'px' });
    const fmt = (v) => { let t = (+v).toFixed(dec); if (o.sep) t = t.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (o.prefix || '') + t + (o.suffix || ''); };
    const final = fmt(o.to ?? 0);
    const num = h('span', null, final, el);
    if (o.unit) { const u = h('span', 'u', o.unit, el); u.style.fontSize = '0.36em'; }
    const place = () => { const w = el.offsetWidth; el.style.left = (o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px'; };
    place();
    const g0 = glow(halo, size / 160);
    let placed = false;
    const span = o.out != null ? Math.max(dur + 0.4, o.out + 0.25 - at) : dur + 0.4;
    const a = this.act({ at, dur: span, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
      if (!placed) { place(); placed = true; }
      const k = clamp((lt - at) / dur), f = Math.floor(lt * 24);
      const out = o.out != null ? 1 - clamp((lt - o.out) / 0.2) : 1;
      el.style.opacity = f2((lt >= at ? 1 : 0) * vis * out);
      let txt = final;
      if (k < 1) {
        if (o.mode === 'count') txt = fmt(lerp(o.from ?? 0, o.to ?? 0, ease.out(k)));
        else {
          const n = final.length;
          txt = [...final].map((ch, j) => (/\d/.test(ch) && k < (j + 1) / (n + 1) ? String(Math.floor(hash(f, seed + j) * 10)) : ch)).join('');
        }
      }
      if (num._t !== txt) { num._t = txt; num.textContent = txt; }
      // the split: wide while scrambling, a jolt on landing, then a hairline
      const after = lt - at - dur;
      const sp = k < 1 ? 10 + 8 * hash(f, seed) : after < 0.3 ? 12 * (1 - after / 0.3) + 1.5 : 1.5;
      el.style.textShadow = `${f2(-sp)}px 0 rgba(255,46,136,0.8), ${f2(sp)}px 0 rgba(34,229,255,0.8), ${g0}`;
      el.style.transform = k < 1 ? `translateX(${f2((hash(f, seed + 99) - 0.5) * 16)}px) skewX(${f2((hash(f, seed + 7) - 0.5) * 8)}deg)` : 'none';
    } });
    const hnd = this.handle(a, el);
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  /**
   * label(x, y, str, o): a mono HUD caption in caps that types on with a block cursor — units, sources, axis names,
   * "SYS://04", an English echo of a Chinese key word, a status line. o: { color ('blue' cyan), size (26; never smaller),
   * no (an index printed before it in magenta, e.g. '01'), align 'l'|'c'|'r', at, out }.
   */
  B.label = function (x, y, str, o = {}) {
    const el = h('div', 'tx ne-lab', null, this.html);
    el.innerHTML = (o.no ? `<span style="color:${hex('red')}">${o.no}</span>&nbsp;&nbsp;` : '') + '<span class="t"></span>';
    const t = el.querySelector('.t');
    t.textContent = str;
    Object.assign(el.style, { fontSize: (o.size ?? 26) + 'px', color: col(o.color || 'blue'), top: y + 'px' });
    const w = el.offsetWidth;
    el.style.left = (o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px';
    const at = o.at ?? 0, chars = [...str], d0 = Math.max(0.2, chars.length / 55);
    const a = this.act({ at, dur: o.out != null ? Math.max(d0, o.out + 0.2 - at) : d0 + 0.6, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
      const k = clamp((lt - at) / d0);
      const q = o.out != null ? clamp((lt - o.out) / 0.15) : 0;
      el.style.opacity = f2((lt >= at ? 1 : 0) * vis * (1 - q));
      const nn = Math.round(k * chars.length);
      const cur = nn < chars.length || (lt - at - d0 < 0.6 && Math.floor((lt - at) * 4) % 2 === 0);
      const s1 = chars.slice(0, nn).join('') + (cur ? '▌' : '');
      if (t._s !== s1) { t._s = s1; t.textContent = s1; }
    } });
    return this.handle(a, el);
  };

  /**
   * readout(x, y, o): a HUD readout — a mono caption above a number that counts up with a glow and a thin neon rule
   * under it. Dashboards, stats beside a diagram, "USERS 1.2B". o: { label, to, from (0), decimals, prefix, suffix,
   * unit, size (number size, 84), color ('blue'), at, dur (0.9), align 'l'|'r', w (rule width, 300) }.
   */
  B.readout = function (x, y, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 84, w = o.w ?? 300, c = o.color || 'blue';
    const xr = o.align === 'r' ? x - w : x;
    if (o.label) this.label(o.align === 'r' ? x : x, y, o.label, { at, color: 'soft', size: 24, align: o.align === 'r' ? 'r' : 'l' });
    const n = this.glitch(x, y + 38, { mode: 'count', to: o.to, from: o.from, decimals: o.decimals, prefix: o.prefix, suffix: o.suffix, unit: o.unit, size, color: c, at: at + 0.1, dur: o.dur ?? 0.9, align: o.align === 'r' ? 'r' : 'l', sep: o.sep });
    this.neonLine(xr, y + 38 + size * 1.02, xr + w, y + 38 + size * 1.02, { color: c, sw: 3, at: at + 0.15, dur: 0.4, glow: 0.6 });
    return n;
  };

  // ── diagrams in light ──────────────────────────────────────────────────────────────────────────────────────
  /**
   * node(cx, cy, o): a glowing node — a neon ring with a lit core (or an engine icon inside), a ripple when it switches
   * on, and an optional mono label under it. Networks, models, people, servers, steps. o: { r (radius, 46), color
   * ('blue'), at, label, sub (a second, dimmer line), icon (an engine icon name drawn inside, e.g. 'brain', 'person',
   * 'cpu'), core (true: a filled core dot when there is no icon), ripple (true), out }.
   */
  B.node = function (cx, cy, o = {}) {
    const r = o.r ?? 46, c = o.color || 'blue', at = o.at ?? 0, seed = ++uid;
    const ring = this.neonRing(cx, cy, r, { color: c, sw: 5, at, dur: 0.45, out: o.out });
    const svg = stageSvg(this);
    const g = s('g', { filter: glowFilter(svg, 0.8), opacity: 0 }, svg);
    const core = o.icon || o.core === false ? null : s('circle', { cx, cy, r: r * 0.34, fill: hot(c, 0.55) }, g);
    const rip = s('circle', { cx, cy, r, fill: 'none', stroke: hex(c), 'stroke-width': 3 }, g);
    if (o.icon) this.icon(o.icon, cx, cy, r * 1.15, { at: at + 0.25, color: c });
    if (o.label) this.label(cx, cy + r + 22, o.label, { at: at + 0.2, color: 'ink', align: 'c', size: o.size ?? 26 });
    if (o.sub) this.label(cx, cy + r + 58, o.sub, { at: at + 0.35, color: 'muted', align: 'c', size: 24 });
    this.tick((lt) => {
      const u = lt - at, out = o.out != null ? 1 - clamp((lt - o.out) / 0.25) : 1;
      g.setAttribute('opacity', f2((u >= 0 ? 1 : 0) * out));
      if (core) core.setAttribute('opacity', f2(flick(u - 0.15, seed)));
      const q = clamp((u - 0.2) / 0.7);
      rip.setAttribute('r', f2(r * (1 + q * 1.1)));
      rip.setAttribute('opacity', f2(q > 0 && o.ripple !== false ? (1 - q) * 0.8 : 0));
    });
    return ring;
  };

  /**
   * link(x1, y1, x2, y2, o): a neon connection between two points that lights up, then carries bright pulses along it —
   * data flowing, money moving, a signal sent. o: { color ('blue'), at, dur (0.5), bend (sideways bow in px; 0 =
   * straight), pulses (number of travelling sparks, 1; 0 = none), every (seconds per trip, 1.4), back (true: pulses run
   * both ways), sw (4), dashed, head (true: arrowhead), out }. Start and end at the rims of the nodes it joins.
   */
  B.link = function (x1, y1, x2, y2, o = {}) {
    const c = o.color || 'blue', at = o.at ?? 0, dur = o.dur ?? 0.5;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, b = o.bend ?? 0;
    const cx = mx - (dy / L) * b, cy = my + (dx / L) * b;
    let d = `M${x1} ${y1}Q${f2(cx)} ${f2(cy)} ${x2} ${y2}`;
    if (o.head) { const ang = Math.atan2(y2 - cy, x2 - cx); for (const s0 of [-1, 1]) { const a2 = ang + Math.PI + s0 * 0.5; d += `M${x2} ${y2}L${f2(x2 + Math.cos(a2) * 24)} ${f2(y2 + Math.sin(a2) * 24)}`; } }
    const hnd = this.tube(d, { color: c, sw: o.sw ?? 4, at, dur, dashed: o.dashed, glow: 0.8, out: o.out });
    const n = o.pulses ?? 1;
    if (n > 0) {
      const svg = stageSvg(this);
      const g = s('g', { filter: glowFilter(svg, 1) }, svg);
      const guide = s('path', { d: `M${x1} ${y1}Q${f2(cx)} ${f2(cy)} ${x2} ${y2}`, fill: 'none', stroke: 'none' }, g);
      const dots = Array.from({ length: n * (o.back ? 2 : 1) }, () => s('circle', { r: (o.sw ?? 4) * 1.6, fill: '#fff', opacity: 0 }, g));
      let len = 0;
      const every = o.every ?? 1.4;
      this.tick((lt) => {
        if (!len) len = guide.getTotalLength();
        const u = lt - at - dur, out = o.out != null && lt > o.out ? 0 : 1;
        dots.forEach((dot, i) => {
          const rev = o.back && i >= n, j = rev ? i - n : i;
          if (u < 0 || !out) { dot.setAttribute('opacity', '0'); return; }
          let p = ((u / every) + j / n + (rev ? 0.5 / n : 0)) % 1;
          if (rev) p = 1 - p;
          const pt = guide.getPointAtLength(p * len);
          dot.setAttribute('cx', f2(pt.x)); dot.setAttribute('cy', f2(pt.y));
          dot.setAttribute('fill', hot(c, 0.8));
          dot.setAttribute('opacity', f2(Math.sin(Math.PI * p) * 0.6 + 0.4));
        });
      });
    }
    return hnd;
  };

  /**
   * meter(x, y, w, items, o): segmented LED bars, one row per item — each bar lights up segment by segment, its value at
   * the end; the highlighted row in magenta, the rest cyan, unlit segments faint. Comparisons, rankings, "before/after".
   * items: [{ label, value, color? }]. o: { max, at, stagger (0.3 s per row), rowH (96), barH (40), segs (28), labelW
   * (320), fmt(v) → string, hi (index of the magenta row), out }.
   */
  B.meter = function (x, y, w, items, o = {}) {
    const rowH = o.rowH ?? 96, barH = o.barH ?? 40, lw = o.labelW ?? 320, at = o.at ?? 0, st = o.stagger ?? 0.3, N = o.segs ?? 28;
    const max = o.max ?? Math.max(...items.map((it) => it.value));
    const fmt = o.fmt || ((v) => String(Math.round(v)));
    const bw = w - lw - 190, gap = 5, segW = (bw - gap * (N - 1)) / N;
    const svg = stageSvg(this);
    const g = s('g', { filter: glowFilter(svg, 0.7) }, svg);
    items.forEach((it, i) => {
      const yy = y + i * rowH, t0 = at + i * st, c = it.color || (o.hi === i ? 'red' : 'blue');
      this.label(x, yy + barH / 2 - 16, it.label, { at: t0, color: o.hi === i ? 'red' : 'ink', size: 28 });
      const cells = Array.from({ length: N }, (_, k) => s('rect', { x: f2(x + lw + k * (segW + gap)), y: yy, width: f2(segW), height: barH, rx: 3, fill: rgba('purple', 0.14) }, g));
      const lit = it.value > 0 ? Math.max(1, Math.round((it.value / max) * N)) : 0;
      const val = h('div', 'tx ne-num', null, this.html);
      Object.assign(val.style, { fontSize: barH * 1.2 + 'px', color: hot(c, 0.5), top: yy - barH * 0.1 + 'px', textShadow: glow(c, 0.5) });
      this.tick((lt) => {
        const e = expo(clamp((lt - t0) / 0.8)), on = lt >= t0 && !(o.out != null && lt > o.out);
        const nOn = on ? Math.round(lit * e) : 0;
        if (cells._n !== nOn) { cells._n = nOn; cells.forEach((r, k) => r.setAttribute('fill', k < nOn ? (k === nOn - 1 && e < 1 ? '#fff' : hex(c)) : rgba('purple', 0.14))); }
        val.style.opacity = on ? '1' : '0';
        val.style.left = f2(x + lw + Math.max(1, nOn) * (segW + gap) + 14) + 'px';
        const t = fmt(it.value * e);
        if (val._t !== t) { val._t = t; val.textContent = t; }
      });
    });
  };

  // ── the world: floor, sun, skyline, rain ──────────────────────────────────────────────────────────────────
  /**
   * horizon(o): the synthwave floor — a perspective grid of neon lines running from a glowing horizon toward the viewer
   * (it keeps scrolling forward), optionally with a striped sun sinking behind the horizon. A backdrop: it sits under
   * everything; put the subject above the horizon or standing on the floor. o: { y (horizon height, 700), color (grid,
   * 'purple'), edge (horizon line colour, 'red'), sun (true or { x, r, color }: a striped sun on the horizon; x default
   * 960, r 230), speed (rows per second, 0.6; 0 = still), at, dur (0.9: the grid unrolls from the horizon), op (1) }.
   */
  B.horizon = function (o = {}) {
    const Y = o.y ?? 700, at = o.at ?? 0, dur = o.dur ?? 0.9, gc = o.color || 'purple', ec = o.edge || 'red', speed = o.speed ?? 0.6;
    const W = STAGE.w, H = STAGE.h, VX = W / 2;
    const svg = stageSvg(this, -1);
    svg.style.opacity = '0';
    const df = defs(svg);
    // the sun: a vertical gradient disc cut by widening horizontal slits toward its base
    let sunG = null;
    if (o.sun) {
      const so = typeof o.sun === 'object' ? o.sun : {};
      const sx = so.x ?? STAGE.w / 2, sr = so.r ?? 230, gid = `ns${++uid}`, mid = `nm${uid}`;
      const lg = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, df);
      s('stop', { offset: '0', 'stop-color': hex('yellow') }, lg);
      s('stop', { offset: '0.55', 'stop-color': hex(so.color || 'orange') }, lg);
      s('stop', { offset: '1', 'stop-color': hex('red') }, lg);
      const mask = s('mask', { id: mid }, df);
      s('rect', { x: sx - sr, y: Y - sr * 2, width: sr * 2, height: sr * 2, fill: '#fff' }, mask);
      for (let k = 0; k < 7; k++) { const yy = Y - sr * 0.9 + k * sr * 0.14, th = 3 + k * 2.6; s('rect', { x: sx - sr, y: yy, width: sr * 2, height: th, fill: '#000' }, mask); }
      sunG = s('g', { filter: glowFilter(svg, 2.2) }, svg);
      s('circle', { cx: sx, cy: Y - sr * 0.15, r: sr, fill: `url(#${gid})`, mask: `url(#${mid})` }, sunG);
      sunG._r = sr;
    }
    // the haze over the horizon
    const hz = `nh${++uid}`;
    const hg = s('linearGradient', { id: hz, x1: 0, y1: 0, x2: 0, y2: 1 }, df);
    s('stop', { offset: '0', 'stop-color': hex(ec), 'stop-opacity': 0 }, hg);
    s('stop', { offset: '0.85', 'stop-color': hex(ec), 'stop-opacity': 0.22 }, hg);
    s('stop', { offset: '1', 'stop-color': hex(ec), 'stop-opacity': 0 }, hg);
    s('rect', { x: 0, y: Y - 160, width: W, height: 190, fill: `url(#${hz})` }, svg);
    // the floor: dark, then the grid clipped to an unrolling rect
    s('rect', { x: 0, y: Y, width: W, height: H - Y, fill: '#08061A' }, svg);
    const cid = `nc${++uid}`;
    const clipR = s('rect', { x: 0, y: Y, width: W, height: 0 }, s('clipPath', { id: cid }, df));
    const fg = s('g', { 'clip-path': `url(#${cid})`, filter: glowFilter(svg, 0.7) }, svg);
    let vd = '';
    for (let i = -14; i <= 14; i++) { const bx = VX + i * 190; vd += `M${f2(VX + i * 8)} ${Y}L${f2(VX + (bx - VX) * 2.6)} ${H + 300}`; }
    s('path', { d: vd, stroke: hex(gc), 'stroke-width': 2.2, fill: 'none', opacity: 0.85 }, fg);
    const hp = s('path', { d: '', stroke: hex(gc), 'stroke-width': 2.2, fill: 'none' }, fg);
    const edge = s('g', { filter: glowFilter(svg, 1.2) }, svg);
    s('line', { x1: 0, y1: Y, x2: W, y2: Y, stroke: hot(ec, 0.4), 'stroke-width': 3 }, edge);
    const R = 14;
    this.tick((lt) => {
      const k = clamp((lt - at) / dur);
      svg.style.opacity = f2(lt >= at ? Math.min(1, k * 2.5) * (o.op ?? 1) : 0);
      clipR.setAttribute('height', f2((H - Y) * expo(k)));
      const ph = speed ? ((Math.max(0, lt - at) * speed) % 1) : 0;
      let d = '';
      for (let j = 0; j < R; j++) { const f = (j + ph) / R, yy = Y + (H - Y + 40) * f * f; d += `M0 ${f2(yy)}H${W}`; }
      hp.setAttribute('d', d);
      if (sunG) { const e = expo(clamp((lt - at - 0.2) / 1.1)); sunG.setAttribute('transform', `translate(0 ${f2((1 - e) * sunG._r * 0.9)})`); }
    });
    return { y: Y };
  };

  /**
   * skyline(o): a city silhouette standing on a line (the horizon), its edges traced in thin neon and its windows
   * switching on one by one — night, a city, an industry, "everyone online". Behind everything. o: { y (base, 700),
   * h (tallest building, 320), x0 (0), x1 (1920), color (edge, 'purple'), windows ('yellow'; false = none), at,
   * seed (another city), op (1) }.
   */
  B.skyline = function (o = {}) {
    const Y = o.y ?? 700, Hm = o.h ?? 320, x0 = o.x0 ?? 0, x1 = o.x1 ?? STAGE.w, at = o.at ?? 0, sd = o.seed ?? 3;
    const svg = stageSvg(this, -1);
    svg.style.opacity = '0';
    let d = `M${x0} ${Y}`, ant = '', x = x0, i = 0;
    const blds = [];
    while (x < x1) {
      const w = 50 + hash(i, sd) * 110, hh = Hm * (0.25 + 0.75 * Math.pow(hash(i, sd + 1), 1.4));
      blds.push({ x, w, h: hh });
      d += `V${f2(Y - hh)}H${f2(Math.min(x1, x + w))}`;
      if (hash(i, sd + 2) > 0.8) { const ax = x + w * 0.5; ant += `M${f2(ax)} ${f2(Y - hh)}V${f2(Y - hh - 46)}`; }
      x += w; i++;
    }
    d += `V${Y}Z`;
    s('path', { d, fill: '#0B0820' }, svg);
    const eg = s('g', { filter: glowFilter(svg, 0.6) }, svg);
    s('path', { d: d + ant, fill: 'none', stroke: hex(o.color || 'purple'), 'stroke-width': 2, opacity: 0.9 }, eg);
    const wins = [];
    if (o.windows !== false) {
      const wg = s('g', null, svg);
      blds.forEach((b, bi) => {
        for (let yy = Y - b.h + 22; yy < Y - 16; yy += 26) for (let xx = b.x + 12; xx < b.x + b.w - 14; xx += 22) {
          const r = hash(bi * 131 + Math.round(xx), Math.round(yy) + sd);
          if (r < 0.32) wins.push({ el: s('rect', { x: f2(xx), y: f2(yy), width: 9, height: 12, fill: r < 0.06 ? hex('blue') : hex(o.windows || 'yellow'), opacity: 0 }, wg), r: r / 0.32 });
        }
      });
    }
    this.tick((lt) => {
      const k = clamp((lt - at) / 0.6);
      svg.style.opacity = f2(lt >= at ? k * (o.op ?? 1) : 0);
      const lit = clamp((lt - at - 0.3) / 2.2);
      for (const w of wins) { const on = w.r < lit ? 0.75 : 0; if (w._o !== on) { w._o = on; w.el.setAttribute('opacity', on); } }
    });
  };

  /**
   * rain(o): thin rain streaks falling through the frame, lit cyan by the signs — mood for a night-city opening or a
   * dark turn. Behind everything, low contrast. o: { n (streaks, 90), color ('blue'), op (0.35), speed (px per second,
   * 1500), slant (px of sideways drift per streak, 90), at, out }.
   */
  B.rain = function (o = {}) {
    const n = o.n ?? 90, sp = o.speed ?? 1500, sl = o.slant ?? 90, at = o.at ?? 0, H = STAGE.h + 200;
    const svg = stageSvg(this, -1);
    const p = s('path', { d: '', stroke: hot(o.color || 'blue', 0.3), 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }, svg);
    this.tick((lt) => {
      const on = lt >= at && !(o.out != null && lt > o.out + 0.3);
      svg.style.opacity = f2(on ? (o.op ?? 0.35) * clamp((lt - at) / 0.5) * (o.out != null ? 1 - clamp((lt - o.out) / 0.3) : 1) : 0);
      if (!on) return;
      let d = '';
      for (let i = 0; i < n; i++) {
        const x = hash(i, 11) * (STAGE.w + 200) - 100, len = 40 + hash(i, 12) * 70, v = sp * (0.7 + hash(i, 13) * 0.6);
        const y = ((hash(i, 14) * H + lt * v) % H) - 100;
        d += `M${f2(x)} ${f2(y)}l${f2(sl * len / 400)} ${f2(len)}`;
      }
      p.setAttribute('d', d);
    });
  };

  /**
   * panel(x, y, w, h, o): a HUD panel — dark glass with a hairline border, glowing corner brackets and a mono tab label;
   * a scan line runs down it once when it opens. RETURNS A LAYER (a Builder): draw the panel's contents on it with
   * the usual calls (L.sign, L.glitch, L.node…) in page coordinates; they fade with the panel. o: { color ('blue'),
   * label (tab text, e.g. 'SIGNAL // 01'), at, dur (0.45), sweep (true), out }.
   */
  B.panel = function (x, y, w, hh, o = {}) {
    const c = o.color || 'blue', at = o.at ?? 0, dur = o.dur ?? 0.45;
    const svg = stageSvg(this);
    svg.style.opacity = '0';
    s('rect', { x, y, width: w, height: hh, rx: 6, fill: 'rgba(16,12,34,0.72)', stroke: rgba(c, 0.32), 'stroke-width': 1.5 }, svg);
    const L = 34, cg = s('g', { filter: glowFilter(svg, 0.8) }, svg);
    const br = `M${x} ${y + L}V${y}H${x + L}M${x + w - L} ${y}H${x + w}V${y + L}M${x + w} ${y + hh - L}V${y + hh}H${x + w - L}M${x + L} ${y + hh}H${x}V${y + hh - L}`;
    s('path', { d: br, fill: 'none', stroke: hot(c, 0.4), 'stroke-width': 4, 'stroke-linecap': 'square' }, cg);
    const sweep = s('rect', { x: x + 2, y, width: w - 4, height: 3, fill: hot(c, 0.6), opacity: 0 }, cg);
    if (o.label) this.label(x + 22, y - 40, o.label, { at: at + 0.1, color: c, size: 24 });
    const layer = this.layer();
    layer.wrap.style.opacity = '0';
    this.tick((lt) => {
      const k = expo(clamp((lt - at) / dur)), out = o.out != null ? 1 - clamp((lt - o.out) / 0.25) : 1;
      const v = (lt >= at ? 1 : 0) * out;
      svg.style.opacity = f2(v * Math.min(1, k * 1.5));
      svg.style.clipPath = `inset(${f2((1 - k) * 50)}% 0 ${f2((1 - k) * 50)}% 0)`;
      layer.wrap.style.opacity = f2(v);
      const q = clamp((lt - at - 0.1) / 0.8);
      sweep.setAttribute('y', f2(y + q * (hh - 3)));
      sweep.setAttribute('opacity', f2(o.sweep !== false && q > 0 && q < 1 ? 0.9 : 0));
    });
    return layer;
  };

  // ── cuts and hits ──────────────────────────────────────────────────────────────────────────────────────────
  /**
   * scan(at, o): a scanline cut between two scenes inside a page — a bright line sweeps down and blacks out the frame
   * behind it (rolling scanlines), then sweeps again revealing the new scene. Swap content at the returned mid: old
   * things .hide(w.mid, 0.01), new things at: w.mid. o: { color ('blue'), dur (0.7) }. Returns { mid }. Once or twice a
   * film, on a change of topic.
   */
  B.scan = function (at, o = {}) {
    const dur = o.dur ?? 0.7, c = o.color || 'blue', half = dur / 2;
    const cover = h('div', null, null, this.html);
    Object.assign(cover.style, { position: 'absolute', left: '-60px', top: '-60px', width: STAGE.w + 120 + 'px', height: STAGE.h + 120 + 'px', zIndex: 40, visibility: 'hidden',
      background: 'repeating-linear-gradient(0deg, rgba(34,229,255,0.07) 0 2px, transparent 2px 5px), #05040B' });
    const bar = h('div', null, null, this.html);
    Object.assign(bar.style, { position: 'absolute', left: '-60px', width: STAGE.w + 120 + 'px', height: '6px', zIndex: 41, visibility: 'hidden', background: hot(c, 0.7), boxShadow: glow(c, 1.4) });
    this.tick((lt) => {
      const p = (lt - at) / half;
      if (p <= 0 || p >= 2) { cover.style.visibility = 'hidden'; bar.style.visibility = 'hidden'; return; }
      const e = p < 1 ? ease.inOut(p) : ease.inOut(p - 1);
      const yy = -60 + e * (STAGE.h + 120);
      cover.style.visibility = 'visible'; bar.style.visibility = 'visible';
      bar.style.top = f2(yy - 3) + 'px';
      cover.style.clipPath = p < 1 ? `inset(0 0 ${f2(100 - e * 100)}% 0)` : `inset(${f2(e * 100)}% 0 0 0)`;
    });
    return { mid: at + half };
  };

  /**
   * flash(at, o): a bloom hit — the whole frame flares with coloured light and settles in 0.4 s, with a brief RGB
   * shudder. For the one moment that must land (the thesis, the reveal), with P.slam. o: { color ('red'), power (0.55) }.
   * At most twice a film.
   */
  B.flash = function (at, o = {}) {
    const el = h('div', null, null, this.html);
    Object.assign(el.style, { position: 'absolute', inset: '-60px', zIndex: 39, pointerEvents: 'none', mixBlendMode: 'screen',
      background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${rgba(o.color || 'red', 0.9)}, ${rgba(o.color || 'red', 0.35)} 60%, transparent)` });
    this.tick((lt) => {
      const u = lt - at;
      el.style.opacity = f2(u < 0 || u > 0.45 ? 0 : (o.power ?? 0.55) * (1 - u / 0.45) * (u < 0.05 ? u / 0.05 : 1));
    });
  };

  // ── defaults: rounded glass boxes with no hatching; the page title as a neon header ────────────────────────
  const box0 = B.box;
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 12, texture: false }, o)); };

  /** title(str, o): the page title as a lit header (top left): a magenta index, the title in white, a gradient neon rule across the frame and a live page counter — o: { accent (index and rule colour, 'red'), at } */
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.05, c = o.accent || 'red', seed = ++uid;
    const idx = this.page.index + 1, tot = (window.SCRIPT?.PAGES || []).length;
    const wrap = h('div', 'tx ne-tt', `<span class="no"></span><span class="t"></span>`, T.html);
    const no = wrap.querySelector('.no'), t = wrap.querySelector('.t');
    no.textContent = String(idx).padStart(2, '0') + ' //';
    no.style.color = hot(c, 0.4); no.style.textShadow = glow(c, 0.5);
    t.textContent = str;
    t.style.textShadow = glow('purple', 0.35);
    const rule = h('div', 'ne-rule', null, T.html);
    rule.style.background = `linear-gradient(90deg, ${hex(c)}, ${hex('purple')} 55%, ${rgba('blue', 0.0)})`;
    rule.style.boxShadow = `0 0 10px ${rgba(c, 0.8)}, 0 0 26px ${rgba('purple', 0.5)}`;
    const pg = h('div', 'ne-pg', `<i></i>${String(idx).padStart(2, '0')} / ${String(tot).padStart(2, '0')}`, T.html);
    const dot = pg.querySelector('i');
    dot.style.background = hex('green'); dot.style.boxShadow = glow('green', 0.4);
    const a = T.act({ at, dur: 1, g: wrap, kind: 'show', pen: false, apply: (k, lt, vis) => {
      const u = lt - at, b = flick(u, seed);
      wrap.style.opacity = f2((u >= 0 ? 1 : 0) * vis * (b < 0.5 && u < 0.5 ? 0.3 : 1));
      t.style.clipPath = `inset(0 ${f2((1 - expo(clamp(u / 0.5))) * 100)}% 0 0)`;
      rule.style.transform = `scaleX(${f4(expo(clamp((u - 0.1) / 0.7)))})`;
      rule.style.opacity = f2(vis * flick(u - 0.1, seed + 3));
      pg.style.opacity = f2(clamp((u - 0.3) * 3) * vis);
    } });
    T.tick((lt) => { dot.style.opacity = Math.floor(lt * 1.6) % 2 ? '0.35' : '1'; });
    return Object.assign(T.handle(a, wrap), { spans: [t], box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 16, w: wrap.offsetWidth, h: 44 }) });
  };
})();
