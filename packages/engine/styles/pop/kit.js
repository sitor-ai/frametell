/* Pop comic · kit: the pieces that make a frame read as a 1960s comic page — Ben-Day halftone, panels with thick black
 * frames that slide in, speech balloons, caption boxes, sound-effect bursts, speed lines, a Lichtenstein face and a
 * Warhol four-up. Techniques adapted from huashu-art-motion (MIT, scenes/13_pop.js): dots as a pattern tile, a
 * union outline drawn black-then-white, hash-stepped jitter for shouted words.
 * Every component is a pure function of page time: no Math.random, Date or requestAnimationFrame. */
(function () {
  const { s, h, col, clamp, lerp, ease, Builder, hashStr } = PV;
  const B = Builder.prototype;
  const TAU = Math.PI * 2;
  const f2 = (n) => (+n).toFixed(2);
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const hash = (i, j = 0) => { let x = Math.imul(i * 374761393 + j * 668265263, 1274126177) >>> 0; x = Math.imul(x ^ (x >>> 13), 1103515245) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  /** back-out pop: 0 → overshoot → 1 */
  const popK = (lt, at, dur = 0.32) => ease.back(clamp((lt - at) / dur));
  const outK = (lt, out, dur = 0.3) => (out == null ? 1 : 1 - clamp((lt - out) / dur));
  const INK = () => col('ink');
  /** width of a line in the display face (Archivo Black is wide: capitals ~0.8 em; CJK 1 em) */
  const tw = (str, size) => [...String(str)].reduce((a, ch) => a + (/[\u2E80-\uFFEF]/.test(ch) ? 1.02 : /[A-Z0-9#$%&@WM]/.test(ch) ? 0.8 : /[a-z]/.test(ch) ? 0.66 : /\s/.test(ch) ? 0.3 : 0.42), 0) * size;
  let uid = 0;

  /** the <defs> of a builder's svg (one per layer) */
  function defs(svg) { return svg.querySelector(':scope > defs') || s('defs', null, svg); }
  /** a Ben-Day dot tile: 45° grid (four corners + centre), userSpaceOnUse so dots align to the page and never swim */
  function dots(svg, color, bg, pitch = 18, r) {
    const id = `pd${++uid}`;
    r = r ?? pitch * 0.25;
    const p = s('pattern', { id, width: pitch, height: pitch, patternUnits: 'userSpaceOnUse' }, defs(svg));
    if (bg) s('rect', { width: pitch, height: pitch, fill: col(bg) }, p);
    for (const [x, y] of [[0, 0], [pitch, 0], [0, pitch], [pitch, pitch], [pitch / 2, pitch / 2]]) s('circle', { cx: x, cy: y, r, fill: col(color) }, p);
    return `url(#${id})`;
  }
  PV.popDots = dots;
  /** an absolutely placed box in the builder's html layer holding its own svg, so a group can scale/shake as one */
  function box(self, x, y, w, hh, z) {
    const el = h('div', 'pop-node', null, self.html);
    Object.assign(el.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', opacity: 0 });
    if (z != null) el.style.zIndex = z;
    const svg = s('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, style: 'position:absolute;left:0;top:0;overflow:visible' }, el);
    return { el, svg };
  }
  const poly = (pts) => 'M' + pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join(' L') + ' Z';
  /** a star burst outline: n spikes around (cx, cy), radii r0 (valleys) .. r1 (tips), squashed by ry */
  function burstPts(cx, cy, r0, r1, n, seed, ry = 0.78) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU + 0.12, r = i % 2 ? r0 * (0.9 + hash(i, seed) * 0.14) : r1 * (0.82 + hash(i, seed + 1) * 0.34);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * ry]);
    }
    return pts;
  }
  /** lettering: an HTML block (CJK and Latin both render in the style's display faces) */
  function letters(parent, str, o) {
    const el = h('div', 'pop-letters' + (o.cls ? ' ' + o.cls : ''), null, parent);
    el.innerHTML = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    Object.assign(el.style, { position: 'absolute', left: (o.x ?? 0) + 'px', top: (o.y ?? 0) + 'px', width: (o.w ?? 0) + 'px', fontSize: (o.size ?? 40) + 'px',
      color: col(o.color || 'ink'), textAlign: o.align || 'center', lineHeight: String(o.lh ?? 1.12) });
    return el;
  }

  // ── the page title: a yellow caption box with a black frame and a hard shadow, top left ──────────────────────
  /** title(str, o): the page title as a comic caption box (top left, stays put while the camera moves) — o: { accent: box colour (default 'yellow'), at, size } */
  B.title = function (str, o = {}) {
    const T = this.hud || this;
    const at = o.at ?? 0.1, size = o.size ?? 44;
    const w = Math.min(1200, STAGE.w - 240, tw(String(str), size) * 1.08 + 70), hh = size * 1.25 + 34;
    const n = box(T, STAGE.title.x - 20, STAGE.title.y - 26, w + 12, hh + 12, 5);
    s('rect', { x: 9, y: 9, width: w, height: hh, fill: INK() }, n.svg);
    s('rect', { x: 0, y: 0, width: w, height: hh, fill: col(o.accent || 'yellow'), stroke: INK(), 'stroke-width': 5 }, n.svg);
    letters(n.el, str, { x: 0, y: 17, w, size, cls: 'pop-cap', lh: 1.25 });
    T.tick((lt) => {
      const k = ease.out(clamp((lt - at) / 0.3));
      n.el.style.opacity = f2(k);
      n.el.style.transform = `translateX(${f2((1 - k) * -60)}px)`;
    });
    return { el: n.el, a: { dur: 0.3 }, spans: [] };
  };

  // ── halftone ───────────────────────────────────────────────────────────────────────────────────────────────
  /** halftone(x, y, w, h, o): a Ben-Day dot field — o: { color: dot colour ('red'), bg: ground colour or null for transparent, pitch (18), r (dot radius, pitch·0.25), ramp: 'left'|'right'|'up'|'down'|'radial' (dot size fades across the area, drawn as real dots of varying size — the classic shading), d: an SVG path to fill instead of the rect, at, dur (wipe-in time, 0.45), from: 'left'|'top'|'center' (wipe direction), sw: black frame width (0 = none), out } → { g } */
  B.halftone = function (x, y, w, hh, o = {}) {
    const g = s('g', { opacity: 0 }, this.svg);
    const cid = `pc${++uid}`;
    const clip = s('clipPath', { id: cid }, defs(this.svg));
    if (o.d) s('path', { d: o.d }, clip); else s('rect', { x, y, width: w, height: hh }, clip);
    const wipe = s('rect', { x, y, width: w, height: hh }, s('clipPath', { id: cid + 'w' }, defs(this.svg)));
    const inner = s('g', { 'clip-path': `url(#${cid})` }, s('g', { 'clip-path': `url(#${cid}w)` }, g));
    if (o.bg) s('rect', { x: x - 2, y: y - 2, width: w + 4, height: hh + 4, fill: col(o.bg) }, inner);
    const pitch = o.pitch ?? 18, r = o.r ?? pitch * 0.25;
    if (!o.ramp) s('rect', { x, y, width: w, height: hh, fill: dots(this.svg, o.color || 'red', null, pitch, r) }, inner);
    else {
      let d = '';
      const rows = Math.ceil(hh / (pitch / 2)) + 1, cols = Math.ceil(w / pitch) + 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cx = x + i * pitch + (j % 2 ? pitch / 2 : 0), cy = y + j * (pitch / 2);
        const u = (cx - x) / w, v = (cy - y) / hh;
        const k = o.ramp === 'left' ? 1 - u : o.ramp === 'right' ? u : o.ramp === 'up' ? 1 - v : o.ramp === 'down' ? v : 1 - Math.hypot(u - 0.5, v - 0.5) * 1.6;
        const rr = r * 1.5 * clamp(k);
        if (rr > 0.6) d += `M${f2(cx - rr)} ${f2(cy)}a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(rr * 2)} 0a${f2(rr)} ${f2(rr)} 0 1 0 ${f2(-rr * 2)} 0`;
      }
      s('path', { d, fill: col(o.color || 'red') }, inner);
    }
    if (o.sw) { if (o.d) s('path', { d: o.d, fill: 'none', stroke: INK(), 'stroke-width': o.sw, 'stroke-linejoin': 'round' }, g); else s('rect', { x, y, width: w, height: hh, fill: 'none', stroke: INK(), 'stroke-width': o.sw }, g); }
    const at = o.at ?? 0, dur = o.dur ?? 0.45, from = o.from || 'left';
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / dur));
      g.setAttribute('opacity', f2((k > 0 ? 1 : 0) * outK(lt, o.out)));
      if (from === 'top') { wipe.setAttribute('height', f2(hh * k + 1)); }
      else if (from === 'center') { wipe.setAttribute('x', f2(x + w / 2 * (1 - k))); wipe.setAttribute('width', f2(w * k + 1)); wipe.setAttribute('y', f2(y + hh / 2 * (1 - k))); wipe.setAttribute('height', f2(hh * k + 1)); }
      else wipe.setAttribute('width', f2(w * k + 1));
    });
    return { g };
  };

  // ── page grid ──────────────────────────────────────────────────────────────────────────────────────────────
  /** grid(layout, o): the panel rectangles of a comic page that tiles the whole content area (x 120–1800, y 185–885) with 36 px gutters — returns [{ x, y, w, h }, …] in reading order, ready for P.panel(r.x, r.y, r.w, r.h, …). layout: 'full' (one splash panel), '2' (two columns), '3' (three columns), '1+2' (a big panel left, two stacked right), '2+1' (two stacked left, big right), 'top+2' (a wide strip on top, two below), '2x2', 'L' (a big panel + a strip under it + a tall one right). o: { x, y, w, h, gap } to tile another area. Lay the whole grid out at the start of the page and bring the panels in one by one on their cues. */
  B.grid = function (layout = '2', o = {}) {
    const A = STAGE.area, X = o.x ?? A.x0 - 20, Y = o.y ?? A.y0 + 5, W = o.w ?? A.x1 - A.x0 + 40, H = o.h ?? A.y1 - A.y0, g = o.gap ?? 36;
    const r = (x, y, w, hh) => ({ x: Math.round(X + x * (W + g) ), y: Math.round(Y + y * (H + g)), w: Math.round(w * (W + g) - g), h: Math.round(hh * (H + g) - g) });
    const L = {
      full: [r(0, 0, 1, 1)],
      2: [r(0, 0, 0.5, 1), r(0.5, 0, 0.5, 1)],
      3: [r(0, 0, 1 / 3, 1), r(1 / 3, 0, 1 / 3, 1), r(2 / 3, 0, 1 / 3, 1)],
      '1+2': [r(0, 0, 0.58, 1), r(0.58, 0, 0.42, 0.5), r(0.58, 0.5, 0.42, 0.5)],
      '2+1': [r(0, 0, 0.42, 0.5), r(0, 0.5, 0.42, 0.5), r(0.42, 0, 0.58, 1)],
      'top+2': [r(0, 0, 1, 0.45), r(0, 0.45, 0.5, 0.55), r(0.5, 0.45, 0.5, 0.55)],
      '2x2': [r(0, 0, 0.5, 0.5), r(0.5, 0, 0.5, 0.5), r(0, 0.5, 0.5, 0.5), r(0.5, 0.5, 0.5, 0.5)],
      L: [r(0, 0, 0.64, 0.62), r(0, 0.62, 0.64, 0.38), r(0.64, 0, 0.36, 1)],
    };
    return (L[layout] || L[2]).map((q) => ({ ...q }));
  };

  // ── panels ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** panel(x, y, w, h, o): a comic panel — paper (or colour / halftone) ground, thick black frame, hard drop shadow; slides in. RETURNS A LAYER (a Builder): draw the panel's contents on it with the usual API (L.text, L.box, L.face…), and everything is clipped to the panel and moves with it. o: { at, from: 'left'|'right'|'top'|'bottom'|'pop' (entrance, default 'left'), fill: ground colour ('paper'), dots: { color, bg, pitch, ramp } (a halftone ground instead), sw: frame width (8), shadow: true, tilt: degrees (a slight -3..3 makes a page lively), out } */
  B.panel = function (x, y, w, hh, o = {}) {
    const at = o.at ?? 0, sw = o.sw ?? 8, from = o.from || 'left';
    const back = this.layer();
    const L = this.layer();
    const front = this.layer();
    if (o.shadow !== false) s('rect', { x: x + 14, y: y + 14, width: w, height: hh, fill: INK() }, back.svg);
    s('rect', { x, y, width: w, height: hh, fill: col(o.fill || 'paper') }, back.svg);
    if (o.dots) back.halftone(x, y, w, hh, { ...o.dots, at: -1, dur: 0.01 });
    L.wrap.style.clipPath = `polygon(${x}px ${y}px, ${x + w}px ${y}px, ${x + w}px ${y + hh}px, ${x}px ${y + hh}px)`;
    s('rect', { x, y, width: w, height: hh, fill: 'none', stroke: INK(), 'stroke-width': sw, 'stroke-linejoin': 'miter' }, front.svg);
    const wraps = [back.wrap, L.wrap, front.wrap];
    const cx = x + w / 2, cy = y + hh / 2;
    for (const el of wraps) el.style.transformOrigin = `${cx}px ${cy}px`;
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / 0.38)), vis = (lt >= at ? 1 : 0) * outK(lt, o.out);
      const d = (1 - k) * 160;
      const tr = from === 'pop' ? `scale(${f2(lerp(0.6, 1, ease.back(clamp((lt - at) / 0.34))))})`
        : `translate(${f2(from === 'left' ? -d : from === 'right' ? d : 0)}px, ${f2(from === 'top' ? -d : from === 'bottom' ? d : 0)}px)`;
      for (const el of wraps) { el.style.opacity = f2(vis * clamp(k * 2.5)); el.style.transform = tr + (o.tilt ? ` rotate(${o.tilt}deg)` : ''); }
    });
    L.rect = { x, y, w, h: hh };
    return L;
  };

  // ── balloons and captions ──────────────────────────────────────────────────────────────────────────────────
  /** balloon(x, y, w, str, o): a speech balloon whose top-left is (x, y) and width w; the height fits the text. Its tail points at o.tail [tx, ty] (a mouth). o: { tail, at, size (38), shout: true → a spiky burst outline, think: true → a cloud with bubbles, fill ('paper'), color (text, 'ink'), out } Lettering is bold upper-case; keep it to ≤ 12 words (≤ 18 Chinese characters). */
  B.balloon = function (x, y, w, str, o = {}) {
    const size = o.size ?? 38, pad = o.shout ? 0.2 * w : 0.13 * w, innerW = w - pad * 2;
    const lines = String(str).split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil(tw(ln.toUpperCase(), size * 1.04) / innerW)), 0);
    const hh = lines * size * 1.15 + (o.shout ? size * 2.2 : size * 1.5);
    const tail = o.tail || [x + w * 0.3, y + hh + 70];
    const m = 120;
    const n = box(this, x - m, y - m, w + m * 2, hh + m * 2, 3);
    const ox = m, oy = m, cx = ox + w / 2, cy = oy + hh / 2;
    const tx = tail[0] - x + m, ty = tail[1] - y + m;
    const outline = [], fill = [];
    if (o.shout) {
      const d = poly(burstPts(cx, cy, w * 0.5, w * 0.62, 13, hashStr(String(str)) % 97, hh / w * 1.05));
      outline.push(s('path', { d, fill: col(o.fill || 'paper'), stroke: INK(), 'stroke-width': 6, 'stroke-linejoin': 'miter' }, n.svg));
    } else if (o.think) {
      // a cloud: puffs around an ellipse plus a filled core; black union outline first, then the paper fill on top
      const rx = w * 0.46, ry = hh * 0.44, np = Math.max(8, Math.round((w + hh) / 70));
      const pr = Math.max(hh * 0.3, 34);
      const puffs = [];
      for (let i = 0; i < np; i++) { const a = (i / np) * TAU + 0.2; puffs.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, pr * (0.85 + hash(i, 5) * 0.3)]); }
      const core = () => s('ellipse', { cx, cy, rx: rx * 1.02, ry: ry * 1.02 }, n.svg);
      for (const [px, py, r] of puffs) s('circle', { cx: px, cy: py, r, fill: 'none', stroke: INK(), 'stroke-width': 12 }, n.svg);
      const dx = tx - cx, dy = ty - cy, dl = Math.hypot(dx, dy) || 1;
      const edge = Math.min(rx, ry) + pr;
      for (const [q, r] of [[0.35, 18], [0.75, 11]]) { const d = edge + (dl - edge) * q; s('circle', { cx: cx + dx / dl * d, cy: cy + dy / dl * d, r, fill: col(o.fill || 'paper'), stroke: INK(), 'stroke-width': 5 }, n.svg); }
      for (const [px, py, r] of puffs) s('circle', { cx: px, cy: py, r, fill: col(o.fill || 'paper') }, n.svg);
      core().setAttribute('fill', col(o.fill || 'paper'));
    } else {
      // ellipse-ish rounded body + a curved wedge tail: black union outline, then white union fill on top
      const rx = w / 2, ry = hh / 2;
      const a = Math.atan2(ty - cy, tx - cx), sp = 0.16;
      const b1 = [cx + Math.cos(a - sp) * rx * 0.8, cy + Math.sin(a - sp) * ry * 0.8], b2 = [cx + Math.cos(a + sp) * rx * 0.8, cy + Math.sin(a + sp) * ry * 0.8];
      const tailD = `M${f2(b1[0])} ${f2(b1[1])} Q${f2((b1[0] + tx) / 2 + 10)} ${f2((b1[1] + ty) / 2)} ${f2(tx)} ${f2(ty)} Q${f2((b2[0] + tx) / 2 - 10)} ${f2((b2[1] + ty) / 2)} ${f2(b2[0])} ${f2(b2[1])} Z`;
      const bodyD = PV.rrect(ox, oy, w, hh, Math.min(hh / 2, w / 2) * 0.95);
      for (const d of [bodyD, tailD]) s('path', { d, fill: INK(), stroke: INK(), 'stroke-width': 12, 'stroke-linejoin': 'round' }, n.svg);
      for (const d of [bodyD, tailD]) s('path', { d, fill: col(o.fill || 'paper') }, n.svg);
    }
    if (o.shout && o.tail) {
      const a = Math.atan2(ty - cy, tx - cx);
      const b1 = [cx + Math.cos(a - 0.12) * w * 0.4, cy + Math.sin(a - 0.12) * hh * 0.4], b2 = [cx + Math.cos(a + 0.12) * w * 0.4, cy + Math.sin(a + 0.12) * hh * 0.4];
      n.svg.insertBefore(s('path', { d: poly([b1, [tx, ty], b2]), fill: col(o.fill || 'paper'), stroke: INK(), 'stroke-width': 6, 'stroke-linejoin': 'miter' }), n.svg.firstChild);
    }
    letters(n.el, String(str).toUpperCase(), { x: ox + pad, y: oy + (hh - lines * size * 1.15) / 2 - 2, w: innerW, size, color: o.color, cls: 'pop-say', lh: 1.15 });
    const at = o.at ?? 0;
    n.el.style.transformOrigin = `${tx}px ${ty}px`;
    this.tick((lt) => {
      const k = popK(lt, at, 0.3);
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      n.el.style.transform = `scale(${f2(clamp(k, 0, 1.2))})`;
    });
    return { el: n.el, h: hh };
  };

  /** caption(x, y, str, o): a narration box (rectangular, yellow by default, black frame, hard shadow) — "MEANWHILE…", "20 MINUTES LATER", "THE TRUTH:" — o: { w (auto), size (34), color: box colour ('yellow'), text ('ink'), at, rot (degrees), out } */
  B.caption = function (x, y, str, o = {}) {
    const size = o.size ?? 34;
    const w = o.w ?? Math.min(900, tw(String(str).toUpperCase(), size) * 1.1 + 56);
    const lines = Math.max(1, Math.ceil(tw(String(str).toUpperCase(), size) * 1.05 / (w - 48)));
    const hh = lines * size * 1.2 + 28;
    const n = box(this, x, y, w + 10, hh + 10, 3);
    s('rect', { x: 8, y: 8, width: w, height: hh, fill: INK() }, n.svg);
    s('rect', { x: 0, y: 0, width: w, height: hh, fill: col(o.color || 'yellow'), stroke: INK(), 'stroke-width': 5 }, n.svg);
    letters(n.el, String(str).toUpperCase(), { x: 24, y: 14, w: w - 48, size, color: o.text, cls: 'pop-cap', align: 'left', lh: 1.2 });
    if (o.rot) n.el.style.rotate = o.rot + 'deg';
    const at = o.at ?? 0;
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / 0.25));
      n.el.style.opacity = f2(clamp(k * 2) * outK(lt, o.out));
      n.el.style.transform = `translateY(${f2((1 - k) * -24)}px)`;
    });
    return { el: n.el, h: hh, w };
  };

  // ── sound effects ──────────────────────────────────────────────────────────────────────────────────────────
  /** sfx(cx, cy, str, o): a sound-effect word slammed in on a star burst — "POW!", "BOOM!", "DING!", "叮!", "+1" — big outlined letters with a hard shadow, jittering for a beat then settling. o: { size (150), color: letters ('red'), burst: inner burst colour ('yellow', null = letters only), outer: outer burst ('paper'), rot (-8), at, shake: seconds of jitter (0.5; 0 = none), out } Use one per beat, on the action it names. */
  B.sfx = function (cx, cy, str, o = {}) {
    const size = o.size ?? 150, txt = String(str);
    const tww = tw(txt, size) + size * 0.3;
    const W = Math.max(tww * 1.5, size * 2.6), Hh = W * 0.8;
    const n = box(this, cx - W / 2, cy - Hh / 2, W, Hh, 4);
    const seed = hashStr(txt) % 89;
    if (o.burst !== null) {
      if (o.outer !== null) s('path', { d: poly(burstPts(W / 2, Hh / 2, W * 0.36, W * 0.5, 15, seed)), fill: col(o.outer || 'paper'), stroke: INK(), 'stroke-width': 7, 'stroke-linejoin': 'miter' }, n.svg);
      s('path', { d: poly(burstPts(W / 2, Hh / 2, W * 0.3, W * 0.41, 13, seed + 3)), fill: col(o.burst || 'yellow') }, n.svg);
    }
    const t = s('text', { x: W / 2, y: Hh / 2 + size * 0.36, 'text-anchor': 'middle', class: 'pop-sfx', 'font-size': size, transform: `rotate(${o.rot ?? -8} ${W / 2} ${Hh / 2})` }, n.svg);
    t.textContent = txt;
    const t2 = t.cloneNode(true); t2.textContent = txt;
    t.setAttribute('fill', INK()); t.setAttribute('stroke', INK()); t.setAttribute('stroke-width', size * 0.16); t.setAttribute('stroke-linejoin', 'round');
    t.setAttribute('transform', `translate(${size * 0.05} ${size * 0.06}) ` + t.getAttribute('transform'));
    const t1 = t2.cloneNode(true); t1.textContent = txt;
    t1.setAttribute('fill', 'none'); t1.setAttribute('stroke', INK()); t1.setAttribute('stroke-width', size * 0.12); t1.setAttribute('stroke-linejoin', 'round');
    n.svg.appendChild(t1);
    t2.setAttribute('fill', col(o.color || 'red'));
    n.svg.appendChild(t2);
    const at = o.at ?? 0, shake = o.shake ?? 0.5;
    this.tick((lt) => {
      const k = popK(lt, at, 0.24);
      const st = Math.floor(lt * 24), on = lt > at && lt < at + shake;
      const jx = on ? (hash(st, seed) - 0.5) * size * 0.12 : 0, jy = on ? (hash(st, seed + 7) - 0.5) * size * 0.1 : 0, jr = on ? (hash(st, seed + 3) - 0.5) * 6 : 0;
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * outK(lt, o.out));
      n.el.style.transform = `translate(${f2(jx)}px, ${f2(jy)}px) rotate(${f2(jr)}deg) scale(${f2(clamp(k, 0, 1.3))})`;
    });
    return { el: n.el };
  };

  // ── speed lines ────────────────────────────────────────────────────────────────────────────────────────────
  /** speed(cx, cy, o): comic action lines. mode 'radial' (default): black wedges converging on (cx, cy) from the frame edge — the "focus" burst behind a reveal or a shock; mode 'horizontal': streaks behind something moving left→right across a band of height o.h around cy. They flicker (lengths re-drawn 12 times a second). o: { mode, r0: clear radius around the centre (260), n: number of lines (64), color ('ink'), at, dur (how long they stay; default to the page end), h (band height for horizontal, 300), x0, x1 (band extent), out } */
  B.speed = function (cx, cy, o = {}) {
    const g = s('g', { opacity: 0 }, this.svg);
    const n = o.n ?? 64, r0 = o.r0 ?? 260, color = col(o.color || 'ink'), seed = (cx * 7 + cy) | 0;
    const path = s('path', { fill: color }, g);
    const at = o.at ?? 0, end = o.dur != null ? at + o.dur : null;
    this.tick((lt) => {
      const vis = lt >= at && (end == null || lt < end) ? 1 : 0;
      g.setAttribute('opacity', f2(vis * clamp((lt - at) / 0.12) * outK(lt, o.out)));
      if (!vis) return;
      const st = Math.floor(lt * 12);
      let d = '';
      if (o.mode === 'horizontal') {
        const bh = o.h ?? 300, x0 = o.x0 ?? 0, x1 = o.x1 ?? cx;
        for (let i = 0; i < n * 0.4; i++) {
          const y = cy - bh / 2 + hash(i, seed) * bh, len = (x1 - x0) * (0.3 + 0.7 * hash(i, st + seed)), th = 2 + hash(i, seed + 5) * 7;
          const xe = x1 - hash(i, seed + 9) * 60;
          d += `M${f2(xe)} ${f2(y - th / 2)} L${f2(xe - len)} ${f2(y)} L${f2(xe)} ${f2(y + th / 2)} Z`;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + hash(i, seed) * 0.08, w = 0.012 + hash(i, seed + 2) * 0.03;
          const rin = r0 * (1 + hash(i, st + seed) * 0.9), rout = 1500;
          d += `M${f2(cx + Math.cos(a - w) * rout)} ${f2(cy + Math.sin(a - w) * rout)} L${f2(cx + Math.cos(a) * rin)} ${f2(cy + Math.sin(a) * rin)} L${f2(cx + Math.cos(a + w) * rout)} ${f2(cy + Math.sin(a + w) * rout)} Z`;
        }
      }
      path.setAttribute('d', d);
    });
    return { g };
  };

  // ── the Lichtenstein face ──────────────────────────────────────────────────────────────────────────────────
  /** face(cx, cy, size, o): a Lichtenstein comic face (head ~size px tall): red Ben-Day dots on the skin, thick black outline, big glossy eyes with lashes, red lips, sculpted curls. o: { mood: 'calm'|'smile'|'shock'|'cry'|'think'|'smirk' or a function lt → mood (switches instantly, like cutting to the next panel), hair: 'yellow'|'ink'|'red'|'orange' (yellow), look: number or lt → -1..1 (eyes left/right), tear: true, at, from: 'pop'|'fade', flip: true (face left), out }. Put a balloon next to the mouth; frame it in a panel for a close-up. */
  B.face = function (cx, cy, size, o = {}) {
    const k = size / 400, W = 520 * k, Hh = 520 * k;
    const n = box(this, cx - W / 2, cy - Hh / 2, W, Hh, 2);
    const g = s('g', { transform: `scale(${k}) translate(260 260)${o.flip ? ' scale(-1 1)' : ''}` }, n.svg);
    const ink = INK();
    const hairC = col(o.hair || 'yellow'), hairD = o.hair === 'ink' ? '#3A3A3A' : o.hair === 'red' ? '#9E1610' : '#D49A12';
    const skin = dots(n.svg, '#E8553F', '#FBE3CF', 15, 3.6);
    const L = (d, fill, sw = 9, parent = g) => s('path', { d, fill: fill || 'none', stroke: ink, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, parent);
    // hair behind: one mass + curls, black union outline then fill
    const curls = [[-150, -120, 70], [-170, -20, 62], [-160, 80, 60], [-120, 160, 56], [150, -110, 66], [172, -10, 58], [160, 90, 56], [-60, -175, 66], [40, -185, 70], [120, 170, 50]];
    const mass = 'M-175 -60 C-190 -200 -40 -250 40 -240 C170 -225 210 -120 195 0 C190 120 170 190 120 215 L-130 215 C-180 170 -195 60 -175 -60 Z';
    L(mass, ink, 20); for (const [x, y, r] of curls) s('circle', { cx: x, cy: y, r, fill: ink, stroke: ink, 'stroke-width': 20 }, g);
    s('path', { d: mass, fill: hairC }, g); for (const [x, y, r] of curls) s('circle', { cx: x, cy: y, r, fill: hairC }, g);
    for (const [x, y, r] of curls) L(`M${x - r * 0.5} ${y - r * 0.15} A${r * 0.55} ${r * 0.55} 0 0 1 ${x + r * 0.4} ${y + r * 0.3}`, null, 7);
    for (const [x, y, r] of curls.slice(0, 6)) s('path', { d: `M${x - r * 0.2} ${y + r * 0.45} A${r * 0.5} ${r * 0.5} 0 0 0 ${x + r * 0.5} ${y - r * 0.05}`, fill: 'none', stroke: hairD, 'stroke-width': 8, 'stroke-linecap': 'round' }, g);
    // neck + face
    L('M-50 120 L-55 230 L55 230 L50 120 Z', skin);
    L('M-115 -70 C-120 -150 -60 -170 0 -170 C70 -170 120 -140 118 -60 C116 30 95 110 40 148 C15 164 -15 164 -40 148 C-95 110 -112 20 -115 -70 Z', skin);
    // fringe over the forehead
    L('M-130 -80 C-110 -190 60 -215 135 -110 C80 -150 10 -130 -20 -100 C-40 -140 -90 -120 -130 -80 Z', hairC, 9);
    L('M-40 -120 C-20 -150 30 -160 60 -150', null, 6);
    // eyes (white, iris, gloss) and brows, per mood; mouths per mood
    const moods = {};
    const mk = (m) => { const mg = s('g', { style: 'display:none' }, g); moods[m] = mg; return mg; };
    const eye = (pg, x, open = 1, irisG) => {
      s('path', { d: `M${x - 34} -20 Q${x} ${-20 - 30 * open} ${x + 34} -20 Q${x} ${-20 + 22 * open} ${x - 34} -20 Z`, fill: '#FFFFFF', stroke: ink, 'stroke-width': 6, 'stroke-linejoin': 'round' }, pg);
      const ir = s('g', null, pg); irisG.push(ir);
      s('circle', { cx: x, cy: -22, r: 15 * Math.min(1, open + 0.2), fill: col('blue'), stroke: ink, 'stroke-width': 4 }, ir);
      s('circle', { cx: x, cy: -22, r: 7, fill: ink }, ir);
      s('circle', { cx: x + 5, cy: -28, r: 4.5, fill: '#FFFFFF' }, ir);
      const sd = x < 0 ? -1 : 1;   // lashes flick out from the outer corner
      for (let i = 0; i < 3; i++) s('path', { d: `M${x + sd * (14 + i * 9)} ${-20 - (22 - i * 7) * open} l${sd * (10 + i * 3)} ${-14 + i * 4}`, stroke: ink, 'stroke-width': 6, 'stroke-linecap': 'round' }, pg);
    };
    const irises = {};
    const lips = (pg, d, open) => { s('path', { d, fill: col('red'), stroke: ink, 'stroke-width': 6, 'stroke-linejoin': 'round' }, pg); if (open) s('path', { d: open, fill: '#5A0E0B' }, pg); };
    const brow = (pg, ly, ry, tilt = 0) => { L(`M-80 ${ly} Q-50 ${ly - 14 - tilt} -18 ${ly + tilt}`, null, 8, pg); L(`M18 ${ry + tilt} Q50 ${ry - 14 - tilt} 80 ${ry}`, null, 8, pg); };
    for (const m of ['calm', 'smile', 'shock', 'cry', 'think', 'smirk']) {
      const pg = mk(m); irises[m] = [];
      const open = m === 'shock' ? 1.35 : m === 'smile' ? 0.75 : m === 'think' ? 0.85 : 1;
      eye(pg, -50, open, irises[m]); eye(pg, 50, m === 'smirk' ? 0.6 : open, irises[m]);
      brow(pg, m === 'shock' ? -86 : -66, m === 'shock' ? -86 : m === 'smirk' ? -78 : -66, m === 'cry' || m === 'think' ? 10 : 0);
      if (m === 'shock') lips(pg, 'M-30 92 Q0 62 30 92 Q22 132 0 134 Q-22 132 -30 92 Z', 'M-18 96 Q0 82 18 96 Q12 122 0 123 Q-12 122 -18 96 Z');
      else if (m === 'smile') lips(pg, 'M-40 86 Q0 96 40 86 Q22 122 0 122 Q-22 122 -40 86 Z', 'M-28 91 Q0 98 28 91 Q14 108 0 108 Q-14 108 -28 91 Z');
      else if (m === 'smirk') lips(pg, 'M-30 94 Q0 92 36 80 Q22 108 0 108 Q-20 108 -30 94 Z');
      else if (m === 'cry') lips(pg, 'M-30 100 Q0 84 30 100 Q14 112 0 112 Q-14 112 -30 100 Z');
      else lips(pg, 'M-32 92 Q-12 80 0 88 Q12 80 32 92 Q14 110 0 110 Q-14 110 -32 92 Z');
      if (m === 'cry' || o.tear) L('M70 10 Q86 40 80 58 Q66 70 60 52 Q60 34 70 10 Z', '#BFE6FF', 5, pg);
      if (m === 'think') s('path', { d: 'M-10 40 q10 8 22 0', fill: 'none', stroke: ink, 'stroke-width': 5 }, pg);
    }
    L('M-6 30 Q-14 55 2 62', null, 6);   // nose
    s('path', { d: 'M-95 -110 L-70 -150', stroke: '#FFFFFF', 'stroke-width': 10, 'stroke-linecap': 'round' }, g);   // gloss on the hair
    const at = o.at ?? 0;
    let cur = null;
    this.tick((lt) => {
      const m = val(o.mood, lt, 'calm');
      if (m !== cur) { for (const k2 in moods) moods[k2].style.display = k2 === m ? '' : 'none'; cur = m; }
      const look = val(o.look, lt, 0) * 9 * (o.flip ? -1 : 1);
      const blink = (lt % 3.7) > 3.58 ? 0.15 : 1;
      for (const ir of irises[cur] || []) ir.setAttribute('transform', `translate(${f2(look)} 0) translate(0 -22) scale(1 ${blink}) translate(0 22)`);
      const kk = o.from === 'fade' ? ease.out(clamp((lt - at) / 0.4)) : popK(lt, at, 0.34);
      n.el.style.opacity = f2((lt >= at ? 1 : 0) * clamp(kk * 3) * outK(lt, o.out));
      n.el.style.transform = `scale(${f2(o.from === 'fade' ? 1 : clamp(kk, 0, 1.2))})`;
    });
    return { el: n.el, mouth: [cx + (o.flip ? -1 : 1) * 0 * k, cy + 100 * k] };
  };

  // ── Warhol four-up ─────────────────────────────────────────────────────────────────────────────────────────
  /** warhol(x, y, w, h, o): a Warhol silkscreen grid (2×2 by default) of the same motif in clashing colour sets that swap on the beat — repetition, mass production, "everyone has the same one". o: { glyph: an emoji or 1–3 characters ('📱', '$', '赞') — or draw: (svg, fg, bg, cw, ch) => void to draw your own motif in a cell of cw×ch, cols (2), rows (2), rate: swaps per second (2.5; 0 = still), at, stagger (0.12 s between cells), out } */
  B.warhol = function (x, y, w, hh, o = {}) {
    const cols = o.cols ?? 2, rows = o.rows ?? 2, cw = w / cols, ch = hh / rows;
    const SETS = [['#9CCF3A', '#E3221B'], ['#E0359A', '#FFD60A'], ['#2FC0B0', '#F27FB2'], ['#F08A2A', '#1F4FC8'], ['#FFD60A', '#7A3AC8'], ['#1F6FD1', '#F7A21B']];
    const cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const n = box(this, x + i * cw, y + j * ch, cw, ch, 2);
      const bg = s('rect', { x: 0, y: 0, width: cw, height: ch, stroke: INK(), 'stroke-width': 6 }, n.svg);
      const sets = SETS.map(([b, f]) => {
        const sg = s('g', { style: 'display:none' }, n.svg);
        if (o.draw) o.draw(sg, f, b, cw, ch);
        else {
          const fs = Math.min(cw, ch) * 0.62;
          const sh = s('text', { x: cw / 2 + fs * 0.06, y: ch / 2 + fs * 0.4, 'text-anchor': 'middle', 'font-size': fs, class: 'pop-sfx', fill: INK() }, sg); sh.textContent = o.glyph ?? '★';
          const t = s('text', { x: cw / 2, y: ch / 2 + fs * 0.34, 'text-anchor': 'middle', 'font-size': fs, class: 'pop-sfx', fill: f }, sg); t.textContent = o.glyph ?? '★';
          if (/\p{Extended_Pictographic}/u.test(o.glyph || '')) { t.style.filter = 'saturate(1.6) contrast(1.2)'; sh.style.opacity = '0.25'; }
        }
        return { sg, b };
      });
      cells.push({ n, bg, sets, idx: j * cols + i });
    }
    const at = o.at ?? 0, rate = o.rate ?? 2.5, stagger = o.stagger ?? 0.12;
    let last = [];
    this.tick((lt) => {
      for (const c of cells) {
        const ca = at + c.idx * stagger;
        const k = popK(lt, ca, 0.26);
        c.n.el.style.opacity = f2((lt >= ca ? 1 : 0) * outK(lt, o.out));
        c.n.el.style.transform = `scale(${f2(clamp(k, 0, 1.15))})`;
        const step = rate ? Math.floor(Math.max(0, lt - at) * rate) : 0;
        const si = (c.idx * 2 + step) % c.sets.length;
        if (last[c.idx] !== si) { c.sets.forEach((q, qi) => (q.sg.style.display = qi === si ? '' : 'none')); c.bg.setAttribute('fill', c.sets[si].b); last[c.idx] = si; }
      }
    });
    return { cells };
  };

  // ── zap ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** zap(x1, y1, x2, y2, o): a zig-zag lightning bolt from (x1, y1) to (x2, y2) — a sudden idea, a shock, energy jumping between two things. Yellow with a black outline; flickers. o: { color ('yellow'), width (46), at, dur (visible for, default to the page end), out } */
  B.zap = function (x1, y1, x2, y2, o = {}) {
    const g = s('g', { opacity: 0 }, this.svg);
    const segs = 5, wd = o.width ?? 46, len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
    const left = [], right = [];
    for (let i = 0; i <= segs; i++) {
      const q = i / segs, z = (i % 2 ? 1 : -1) * wd * 0.9 * (i === 0 || i === segs ? 0 : 1), taper = 1 - q * 0.85;
      const px = x1 + ux * len * q + nx * z, py = y1 + uy * len * q + ny * z;
      left.push([px + nx * wd * 0.5 * taper, py + ny * wd * 0.5 * taper]); right.unshift([px - nx * wd * 0.5 * taper, py - ny * wd * 0.5 * taper]);
    }
    const d = poly(left.concat(right));
    s('path', { d, fill: col(o.color || 'yellow'), stroke: INK(), 'stroke-width': 7, 'stroke-linejoin': 'miter' }, g);
    const at = o.at ?? 0, end = o.dur != null ? at + o.dur : null;
    this.tick((lt) => {
      const on = lt >= at && (end == null || lt < end);
      const flick = Math.floor(lt * 14) % 5 === 0 && lt < at + 0.8 ? 0.35 : 1;
      g.setAttribute('opacity', f2((on ? 1 : 0) * flick * outK(lt, o.out)));
    });
    return { g };
  };
})();
