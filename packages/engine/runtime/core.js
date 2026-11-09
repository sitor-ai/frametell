/* Core: math, palette, and the page Builder — every drawable registers a timed action; update(lt) is pure in time. */
(function () {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  // the easings by name (ease.out, ease.inOut, …); ease itself is callable too, as ease.inOut — pages reach for both
  const ease = Object.assign((x) => ease.inOut(x), {
    out: (x) => 1 - Math.pow(1 - x, 3),
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    back: (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    draw: (x) => { const k = clamp(x); return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; },
    lin: (x) => x,
  });

  const C = {
    ink: '#2B2520', soft: '#5E554C', muted: '#9C9186', faint: '#CFC6B8',
    blue: '#3D6D93', blueF: '#D3E3EE',
    orange: '#C0782E', orangeF: '#F7E2C3',
    red: '#B2452F', redF: '#F5D5CB',
    green: '#4C8759', greenF: '#D6E9D3',
    purple: '#76589F', purpleF: '#E4DAF0',
    yellow: '#F1CF5E', paper: '#FBF8F1',
    inkF: '#E4DED4', softF: '#E9E3D9', mutedF: '#EFEAE2', faintF: '#F4F0E8', // light fills for the ink greys
  };
  // style pack (styles/<id>/style.js, loaded before the runtime): palette overrides keep the same colour names
  const STYLE = window.STYLE || {};
  Object.assign(C, STYLE.palette);
  // A colour by its palette name, or any CSS colour as it is. A name the palette doesn't have was passed on as CSS and
  // drew black (warm-story has no yellowF). Now a light fill `<name>F` of a colour the palette has is that colour mixed
  // toward the paper, as the style's own fills are: the engine's own helpers compose these (a chip's `c + 'F'`), so it
  // is resolved quietly. Any other name the palette lacks is ink, and the page that used it is noted (PV.colorPage, set
  // by the engine while it builds and draws a page) for the page check to report.
  const unknownColors = new Map();
  const resolved = new Map();
  const mixHex = (a, b, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * k + parseInt(b.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
  const HEX = /^#[0-9a-f]{6}$/i;
  function col(c) {
    if (!c) return c;
    const own = C[c];
    if (own) return own;
    if (typeof c !== 'string' || !/^[A-Za-z][\w-]*$/.test(c)) return c;
    let v = resolved.get(c);
    if (v === undefined) {
      const css = c === 'none' || (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', c));
      const base = c.endsWith('F') && C[c.slice(0, -1)];
      v = css ? { as: c } : base && HEX.test(base) && HEX.test(C.paper) ? { as: mixHex(base, C.paper, 0.22) } : { as: C.ink, unknown: true };
      resolved.set(c, v);
    }
    const page = PV.colorPage;
    if (v.unknown && page) { let set = unknownColors.get(page); if (!set) unknownColors.set(page, (set = new Set())); set.add(c); }
    return v.as;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function h(tag, cls, html, parent) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    if (parent) parent.appendChild(el);
    return el;
  }
  const hashStr = (str) => { let x = 2166136261; for (const ch of str) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return (x >>> 0) % 100000; };

  const gen = rough.generator();
  let uid = 0; // unique, build-order-deterministic ids for masks/clipPaths

  /** Rounded-rect path. */
  function rrect(x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2);
    return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + hh - r} Q${x + w} ${y + hh} ${x + w - r} ${y + hh} H${x + r} Q${x} ${y + hh} ${x} ${y + hh - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
  }

  /**
   * Builder: owns one layer (svg + html) inside a page, and shares the page's action list.
   * Times passed to primitives are page-local seconds (use P.c(i) for "when cue i starts").
   */
  class Builder {
    constructor(page, host, shared) {
      this.page = page;
      this.host = host;
      this.svg = s('svg', { class: 'ink', viewBox: `0 0 ${STAGE.w} ${STAGE.h}`, width: STAGE.w, height: STAGE.h }, host);
      this.html = h('div', 'txt', null, host);
      this.sh = shared || { acts: [], ticks: [], seed: hashStr(page.id) * 97, cams: [] };
    }
    // ── time helpers
    c(i, dt = 0) { const q = this.page.cues[Math.min(i, this.page.cues.length - 1)]; return q.start - this.page.start + dt; }
    /** Page-local time when `word` is spoken in cue i (word-level sync: a number lands exactly as it is said). */
    cw(i, word, dt = 0, nth = 0) { const q = this.page.cues[Math.min(i, this.page.cues.length - 1)]; return TIMING.wordTime(q, word, nth) - this.page.start + dt; }
    ce(i, dt = 0) { const q = this.page.cues[Math.min(i, this.page.cues.length - 1)]; return q.end - this.page.start + dt; }
    get endT() { return this.page.speechEnd - this.page.start; }
    seed() { return ++this.sh.seed; }
    act(a) { a.last = -1; this.sh.acts.push(a); return a; }
    tick(fn) { this.sh.ticks.push(fn); }

    /** Sub-layer that can be moved as a unit: returns a Builder with .wrap (div) for transforms. */
    layer(opts = {}) {
      const wrap = h('div', 'layer', null, this.host);
      if (opts.z != null) wrap.style.zIndex = opts.z;
      const b = new Builder(this.page, wrap, this.sh);
      b.wrap = wrap;
      return b;
    }

    // ── rough drawing
    /** items: [{ shape: roughDrawable }], opts: { at, dur, ease, pen, fillAt } */
    draw(items, o = {}) {
      const g = s('g', { class: o.cls || '' }, this.svg);
      const strokes = [], fills = [], hatch = [];
      for (const it of items) {
        const op = it.options;
        for (const set of it.sets) {
          const d = gen.opsToPath(set, 2);
          if (set.type === 'fillPath') {
            const el = s('path', { d, fill: op.fill, stroke: 'none', filter: 'url(#wc)' });
            fills.push(el);
          } else {
            const hatchSet = set.type === 'fillSketch' || it.__hatch;
            const el = s('path', { d, fill: 'none', stroke: hatchSet ? op.fill : op.stroke, 'stroke-width': hatchSet ? op.fillWeight : op.strokeWidth,
              'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
            if (it.__op != null) el.setAttribute('opacity', it.__op);
            (hatchSet ? hatch : strokes).push(el);
          }
        }
      }
      // paint order: fills, hatch, then ink on top
      for (const el of fills) g.appendChild(el);
      for (const el of hatch) g.appendChild(el);
      for (const el of strokes) g.appendChild(el);
      const seq = strokes.map((el) => ({ el, len: 0 }));
      const hs = hatch.map((el) => ({ el, len: 0 }));
      let measured = false;
      const measure = () => {
        if (measured) return; measured = true;
        for (const q of seq.concat(hs)) { q.len = q.el.getTotalLength() + 1; q.el.style.strokeDasharray = `${q.len} ${q.len}`; }
      };
      const total = () => seq.reduce((a, q) => a + q.len, 0) || 1;
      const htotal = () => hs.reduce((a, q) => a + q.len, 0) || 1;
      const at = o.at ?? 0, dur = o.dur ?? 0.9;
      const fillFrom = o.fillAt ?? 0.45;
      const state = { tipEl: null, tipLen: 0 };
      const runSeq = (list, sum, k) => {
        let acc = k * sum, tip = null;
        for (const q of list) {
          const p = clamp(acc / q.len); acc -= q.len;
          q.el.style.strokeDashoffset = (q.len * (1 - p)).toFixed(1);
          q.el.style.visibility = p <= 0 ? 'hidden' : 'visible';
          if (p > 0 && p < 1) tip = { el: q.el, l: q.len * p };
        }
        return tip;
      };
      const a = this.act({
        at, dur, g, pen: o.pen !== false, kind: 'draw',
        apply: (k) => {
          measure();
          const ke = (o.ease || ease.draw)(k);
          const hasFill = fills.length || hs.length;
          const ks = hasFill ? clamp(ke / (fills.length ? 0.8 : 0.62)) : ke;
          const tip = runSeq(seq, total(), ks);
          const kh = clamp((ke - fillFrom) / (1 - fillFrom));
          const htip = hs.length ? runSeq(hs, htotal(), kh) : null;
          for (const f of fills) f.style.opacity = ease.out(kh).toFixed(3);
          state.tip = tip || htip;
        },
        tip: () => {
          if (!state.tip) return null;
          const p = state.tip.el.getPointAtLength(state.tip.l), m = state.tip.el.getScreenCTM();
          return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f, client: true };
        },
        tipEl: () => state.tip && state.tip.el,
      });
      return this.handle(a, g);
    }

    handle(a, el) {
      const self = this;
      return {
        el, a,
        hide(t, d = 0.5) { a.out = t; a.outDur = d; return this; },
        then(fn) { fn(this); return this; },
        get end() { return a.at + a.dur; },
      };
    }

    ro(o = {}, extra = {}) {
      return Object.assign({
        // the style scales roughness and bowing (flat illustration ≈ 0.35, sketchy whiteboard ≈ 1.2) and sets the default line weight
        seed: o.seed ?? this.seed(), roughness: (o.rough ?? 1.05) * (STYLE.roughScale ?? 1), bowing: (o.bow ?? 0.9) * (STYLE.bowScale ?? 1),
        stroke: col(o.color || 'ink'), strokeWidth: o.sw ?? STYLE.sw ?? 2.6, curveStepCount: 14,
        fill: o.fill ? col(o.fill) : undefined, fillStyle: o.fillStyle || 'solid',
        hachureGap: o.gap ?? 9, fillWeight: o.fw ?? 1.6, hachureAngle: o.angle ?? -41,
        disableMultiStroke: o.single ?? STYLE.single ?? false, preserveVertices: true,
      }, extra);
    }
    shapeOf(d, o) {
      const opts = this.ro(o);
      return gen.path(d, opts);
    }

    // ── primitives
    box(x, y, w, hh, o = {}) {
      const d = rrect(x, y, w, hh, o.r ?? 18);
      const items = [this.shapeOf(d, o)];
      if (o.fill && o.texture !== false && o.fill !== 'paper') items.push(this.texture(d, o));
      return this.draw(items, o);
    }
    /** Light pencil hatching laid over a watercolour fill. */
    texture(d, o) {
      const tx = gen.path(d, this.ro(Object.assign({}, o, { rough: 1.4 }), { stroke: 'none', fill: col(o.color || 'ink'), fillStyle: 'hachure', hachureGap: o.tgap ?? 13, fillWeight: 1.1, hachureAngle: o.tangle ?? -38 }));
      tx.__hatch = true; tx.__op = o.top ?? 0.13;
      return tx;
    }
    rect(x, y, w, hh, o = {}) { return this.draw([gen.rectangle(x, y, w, hh, this.ro(o))], o); }
    circle(cx, cy, d, o = {}) { return this.draw([gen.circle(cx, cy, d, this.ro(o))], o); }
    ellipse(cx, cy, w, hh, o = {}) { return this.draw([gen.ellipse(cx, cy, w, hh, this.ro(o))], o); }
    line(x1, y1, x2, y2, o = {}) { return this.draw([gen.line(x1, y1, x2, y2, this.ro(o))], o); }
    path(d, o = {}) { return this.draw([this.shapeOf(d, o)], o); }
    curve(pts, o = {}) { return this.draw([gen.curve(pts, this.ro(o))], o); }

    /** Arrow along a straight/bent line or a custom path d. o: { bend, head, dashed } */
    arrow(x1, y1, x2, y2, o = {}) {
      const bend = o.bend ?? 0;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
      const cx = mx - dy * bend, cy = my + dx * bend;
      const d = o.d || (bend ? `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}` : `M${x1} ${y1} L${x2} ${y2}`);
      const probe = s('path', { d }, this.svg);
      const L = probe.getTotalLength();
      const end = probe.getPointAtLength(L), pre = probe.getPointAtLength(Math.max(0, L - 14));
      probe.remove();
      const ang = Math.atan2(end.y - pre.y, end.x - pre.x), hl = o.head ?? 18, spread = 0.5;
      const hx1 = end.x - hl * Math.cos(ang - spread), hy1 = end.y - hl * Math.sin(ang - spread);
      const hx2 = end.x - hl * Math.cos(ang + spread), hy2 = end.y - hl * Math.sin(ang + spread);
      const ro = this.ro(Object.assign({ single: true }, o));
      const shaft = gen.path(d, ro);
      const head = gen.path(`M${hx1} ${hy1} L${end.x} ${end.y} L${hx2} ${hy2}`, this.ro(Object.assign({ single: true, rough: 0.6 }, o)));
      const hnd = this.draw([shaft, head], o);
      if (o.dashed) hnd.el.querySelectorAll('path')[0].dataset.dashed = '1';
      if (o.dashed) this.dashify(hnd);
      return hnd;
    }
    /** Dashed look that still draws on: mask the visible dashed stroke with the growing solid stroke. */
    dashify(hnd) {
      const p = hnd.el.querySelector('path');
      const id = 'm' + (++uid);
      const defs = s('defs', {}, this.svg);
      const mask = s('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: STAGE.w, height: STAGE.h }, defs);
      const mp = p.cloneNode();
      mp.setAttribute('stroke', '#fff'); mp.setAttribute('stroke-width', '12'); mp.removeAttribute('filter');
      mask.appendChild(mp);
      const vis = p.cloneNode();
      vis.style.strokeDasharray = '14 11';
      vis.setAttribute('mask', `url(#${id})`);
      p.parentNode.insertBefore(vis, p);
      p.style.opacity = '0';
      this.tick(() => { mp.style.strokeDasharray = p.style.strokeDasharray; mp.style.strokeDashoffset = p.style.strokeDashoffset; vis.style.visibility = p.style.visibility; });
      return hnd;
    }

    /** Hand-drawn loop around something (slight overshoot). */
    ring(cx, cy, w, hh, o = {}) {
      const r = PV.rng(this.seed());
      const pts = [];
      const turns = 1.12, n = 36, a0 = o.start ?? -2.2;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 * turns;
        const j = 1 + (r() - 0.5) * 0.05 + (i / n) * 0.05;
        pts.push([cx + Math.cos(a) * (w / 2) * j, cy + Math.sin(a) * (hh / 2) * j]);
      }
      return this.draw([gen.curve(pts, this.ro(Object.assign({ single: true, rough: 0.5, sw: 3 }, o)))], Object.assign({ dur: 0.7 }, o));
    }
    underline(x, y, w, o = {}) {
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) pts.push([x + (w * i) / n, y + Math.sin(i * 1.1) * (o.wave ?? 2.2) + (i / n) * 3]);
      return this.draw([gen.curve(pts, this.ro(Object.assign({ single: true, rough: 0.4, sw: 3.2 }, o)))], Object.assign({ dur: 0.5 }, o));
    }
    /** Highlighter swipe behind text. */
    mark(x, y, w, hh, o = {}) {
      const g = s('g', { class: 'mark' }, this.svg);
      const d = `M${x} ${y + hh * 0.18} L${x + w} ${y} L${x + w + 4} ${y + hh * 0.86} L${x - 3} ${y + hh} Z`;
      const el = s('path', { d, fill: col(o.color || 'yellow'), opacity: o.opacity ?? 0.5, filter: 'url(#wc)' }, g);
      const cid = 'c' + (++uid);
      const clip = s('clipPath', { id: cid }, s('defs', {}, this.svg));
      const cr = s('rect', { x: x - 10, y: y - 10, width: 0, height: hh + 20 }, clip);
      el.setAttribute('clip-path', `url(#${cid})`);
      const a = this.act({ at: o.at ?? 0, dur: o.dur ?? 0.45, g, kind: 'mark', pen: false,
        apply: (k) => { cr.setAttribute('width', ((w + 24) * ease.out(k)).toFixed(1)); } });
      return this.handle(a, g);
    }
    // the options may come third (P.check(x, y, { at })): the size is left as it is. A page that wrote that crashed deep
    // in the shape code (an object times a number), and its fix round could not see why (2026-10-27)
    check(x, y, sz = 40, o = {}) {
      if (sz && typeof sz === 'object') { o = sz; sz = 40; }
      return this.path(`M${x - sz * 0.45} ${y} L${x - sz * 0.1} ${y + sz * 0.38} L${x + sz * 0.5} ${y - sz * 0.45}`, Object.assign({ color: 'green', sw: 4, single: true, rough: 0.6, dur: 0.35 }, o));
    }
    cross(x, y, sz = 36, o = {}) {
      if (sz && typeof sz === 'object') { o = sz; sz = 36; }
      const r = sz / 2;
      return this.draw([
        gen.line(x - r, y - r, x + r, y + r, this.ro(Object.assign({ color: 'red', sw: 4, single: true, rough: 0.6 }, o))),
        gen.line(x + r, y - r, x - r, y + r, this.ro(Object.assign({ color: 'red', sw: 4, single: true, rough: 0.6 }, o))),
      ], Object.assign({ dur: 0.35 }, o));
    }

    /** Fade/slide a plain element in (for things that are not strokes). */
    show(el, o = {}) {
      const at = o.at ?? 0, dur = o.dur ?? 0.5, dy = o.dy ?? 10, sc = o.scale;
      const a = this.act({ at, dur, g: el, kind: 'show', pen: false,
        apply: (k, lt, vis) => {
          const e = (o.ease || ease.out)(k);
          el.style.opacity = (e * vis).toFixed(3);
          el.style.transform = `translate(${((1 - e) * (o.dx || 0)).toFixed(1)}px, ${((1 - e) * dy).toFixed(1)}px)` + (sc != null ? ` scale(${lerp(sc, 1, e).toFixed(4)})` : '');
        } });
      return this.handle(a, el);
    }

    /** Camera keyframes for the whole page: [{ at, x, y, s, dur }]. */
    cam(keys) { this.sh.cams = keys; }
    // pulse camera presets (stop, move fast, stop): each returns a key for P.cam([...]). Numbers from
    // huashu-art-motion's camera table: push 0.28s to 1.18–1.32×, pan 0.30s at the same zoom, slam 0.17s, ≤ 2 shakes per film.
    push(at, x, y, s = 1.25) { return { at, x, y, s, dur: 0.28, ease: 'out' }; }
    pan(at, x, y, s) { return s == null ? { at, x, y, keepScale: true, dur: 0.3, ease: 'out' } : { at, x, y, s, dur: 0.3, ease: 'out' }; }
    slam(at, x, y, s = 1.2) { return { at, x, y, s, dur: 0.17 * 2.2, ease: 'slam' }; }
    shake(at, amp = 10, dur = 0.25) { return { at, shake: { amp, dur } }; }
    back(at, dur = 0.5) { return { at, x: STAGE.w / 2, y: STAGE.h / 2, s: 1, rx: 0, ry: 0, dur, ease: 'out' }; }
    // 2.5D: the whole page laid into space, seen from the side (rotated about the stage's centre, in perspective), and
    // set level again. A key without rx/ry keeps the current tilt, so a push or pan while tilted stays tilted; back() and
    // level() set it straight. Text on a tilted page is for looking at, not reading: level it before a line is read.
    tilt(at, x = STAGE.w / 2, y = STAGE.h / 2, o = {}) { return { at, x, y, s: o.s ?? 0.9, rx: o.rx ?? 9, ry: o.ry ?? -15, dur: o.dur ?? 0.9, ease: 'inOut' }; }
    level(at, dur = 0.7) { return { at, x: STAGE.w / 2, y: STAGE.h / 2, s: 1, rx: 0, ry: 0, dur, ease: 'inOut' }; }
    /** Times for a batch that arrives faster and faster, like cards dealt from a deck: n times from t0 over span seconds,
     *  each gap `k` times the one before (k < 1 accelerates). Leave the batch still for about 0.5s after the last. */
    deal(n, t0, span, k = 0.72) { return deal(n, t0, span, k); }
    /**
     * A spotlight on one thing: the rest of the picture dims toward the ground, so the eye has one place to go. It sits in
     * the camera layer (it moves with a push), above everything the page draws. r is the lit radius; `o.ry` makes it an
     * ellipse r wide and ry tall (fit it to the thing: a card 220×300 takes r 125, ry 165). `o.to: [{ at, x, y, r, ry }]`
     * moves it to other things (0.5s each), `o.until` lifts it, `o.dim` (0–1, default 0.6) is how far the rest dims.
     */
    spot(at, x, y, r, o = {}) {
      const W = STAGE.w, H = STAGE.h;
      const el = h('div', 'spot', null, this.host);
      el.style.cssText = `position:absolute;left:${-W}px;top:${-H}px;width:${3 * W}px;height:${3 * H}px;pointer-events:none;opacity:0`;
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.getElementById('frame') || document.body).backgroundColor || '');
      const rgb = m ? m[1].split(',').slice(0, 3).map((v) => v.trim()).join(',') : '244,238,226';
      const dim = clamp(o.dim ?? 0.6), dur = o.dur ?? 0.45, keys = [{ at, x, y, r, ry: o.ry ?? r }, ...(o.to || [])];
      let last = '';
      this.tick((lt) => {
        let p = keys[0];
        for (const k of keys.slice(1)) {
          if (lt <= k.at) break;
          const e = ease.inOut(clamp((lt - k.at) / 0.5));
          p = { x: lerp(p.x, k.x, e), y: lerp(p.y, k.y, e), r: lerp(p.r, k.r ?? p.r, e), ry: lerp(p.ry, k.ry ?? k.r ?? p.ry, e) };
        }
        const on = smooth(at, at + dur, lt) * (o.until == null ? 1 : 1 - smooth(o.until, o.until + dur, lt));
        const key = `${p.x.toFixed(1)}|${p.y.toFixed(1)}|${p.r.toFixed(1)}|${p.ry.toFixed(1)}|${on.toFixed(3)}`;
        if (key === last) return;
        last = key;
        el.style.opacity = on.toFixed(3);
        // the gradient's own ellipse is the lit one grown by a soft edge of ~18% + 24px; inside, clear up to the lit edge
        const f = 1.18, pad = 24, ex = p.r * f + pad, ey = p.ry * f + pad, inner = (100 * p.r / ex).toFixed(1);
        el.style.background = `radial-gradient(${ex.toFixed(1)}px ${ey.toFixed(1)}px at ${(p.x + W).toFixed(1)}px ${(p.y + H).toFixed(1)}px, rgba(${rgb},0) ${inner}%, rgba(${rgb},${dim}) 100%)`;
      });
      return el;
    }
  }

  /** n times from t0 over span, each gap k times the last (see Builder.deal) */
  function deal(n, t0, span, k = 0.72) {
    if (n <= 1) return n === 1 ? [t0] : [];
    const q = Math.abs(1 - k) < 1e-6 ? 1 : k, sum = q === 1 ? n - 1 : (1 - q ** (n - 1)) / (1 - q);
    const out = [t0];
    let g = span / sum, t = t0;
    for (let i = 1; i < n; i++) { t += g; out.push(t); g *= q; }
    return out;
  }

  function applyAct(a, lt) {
    const k = clamp((lt - a.at) / a.dur);
    let o = 1;
    if (a.out != null) o = 1 - smooth(a.out, a.out + (a.outDur || 0.5), lt);
    const key = k.toFixed(4) + '|' + o.toFixed(3);
    if (key === a.last) return;
    a.last = key;
    a.apply(k, lt, o);
    if (a.g && a.kind !== 'show' && a.kind !== 'text') a.g.style.opacity = o.toFixed(3);
  }

  window.PV = Object.assign(window.PV || {}, { clamp, lerp, smooth, ease, C, col, unknownColors, s, h, gen, rrect, Builder, applyAct, hashStr, deal,
    rng(seed) { let x = seed >>> 0; return () => { x = (x + 0x6d2b79f5) >>> 0; let r = Math.imul(x ^ (x >>> 15), 1 | x); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; },
  });
})();
