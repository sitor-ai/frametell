/* Collage kit · the investigative desk: torn newsprint, halftone prints, index cards, black label strips, red marker,
 * yellow highlighter, red thread and rubber stamps, laid on a paper desk. Every piece is its own layer, so among kit pieces
 * z-order is call order (call highlight/scribble/string AFTER the paper they mark); plain P.* drawings lie above them all.
 * Paper and pen move in 12 fps steps ("on twos") like stop-motion; the camera (P.cam) stays smooth.
 * All coordinates are stage coordinates (1920×1080). Everything is a pure function of time.
 * Techniques adapted from huashu-art-motion's collage library (MIT, © 2026 alchaincyf). */
(function () {
  const { s, h, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const FPS = 12;
  const step = (lt) => Math.floor(lt * FPS + 1e-6) / FPS;
  const f2 = (n) => (+n).toFixed(2);
  const TONES = {
    news: { bg: '#ECE6D8', fiber: [110, 95, 70], amt: 9, ink: 'ink' },
    old: { bg: '#E3D3B4', fiber: [120, 90, 50], amt: 14, ink: 'ink' },
    white: { bg: '#F5F2EA', fiber: [130, 120, 100], amt: 5, ink: 'ink' },
    black: { bg: '#1E1D1B', fiber: [90, 85, 80], amt: 7, ink: '#EFEAE0' },
    kraft: { bg: '#C9A57A', fiber: [90, 60, 30], amt: 14, ink: 'ink' },
    red: { bg: '#B8433F', fiber: [80, 20, 20], amt: 10, ink: '#F6EFE6' },
    yellow: { bg: '#E8D44A', fiber: [120, 100, 20], amt: 8, ink: 'ink' },
  };
  const tiles = {};
  /** a seamless paper tile (static grain + fibres) as a data URL, one per tone */
  function tile(tone) {
    if (tiles[tone]) return tiles[tone];
    const T = TONES[tone] || TONES.news, n = 320, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d'), r = PV.rng(17 + tone.length * 31);
    g.fillStyle = T.bg; g.fillRect(0, 0, n, n);
    const img = g.getImageData(0, 0, n, n), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const k = (r() - 0.5) * T.amt; d[i] += k; d[i + 1] += k; d[i + 2] += k * 0.9; }
    g.putImageData(img, 0, 0);
    g.lineCap = 'round';
    for (let k = 0; k < 220; k++) {
      const x = r() * n, y = r() * n, a = r() * Math.PI, l = 4 + r() * 14;
      g.strokeStyle = `rgba(${T.fiber.join(',')},${(0.05 + r() * 0.09).toFixed(3)})`; g.lineWidth = 0.6 + r() * 0.8;
      for (const ox of [0, -n, n]) for (const oy of [0, -n, n]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a + 1) * l / 2, y + oy + Math.sin(a + 1) * l / 2, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); }
    }
    return (tiles[tone] = c.toDataURL('image/png'));
  }
  /** torn-paper outline of a w×h rect as a CSS polygon; `torn` lists the torn sides (t r b l), the others are scissor-cut */
  function outline(w, hh, seed, torn = 'trbl', amp = 7) {
    const r = PV.rng(seed), pts = [];
    const side = (x0, y0, x1, y1, nx, ny, rough) => {
      const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(L / (rough ? 9 : 60)));
      for (let i = 0; i < n; i++) {
        const q = i / n, k = rough ? (Math.sin(i * 0.37 + seed) * 0.5 + (r() - 0.5)) * amp : (r() - 0.5) * 1.2;
        pts.push([x0 + (x1 - x0) * q + nx * k, y0 + (y1 - y0) * q + ny * k]);
      }
    };
    side(0, 0, w, 0, 0, 1, torn.includes('t')); side(w, 0, w, hh, -1, 0, torn.includes('r'));
    side(w, hh, 0, hh, 0, -1, torn.includes('b')); side(0, hh, 0, 0, 1, 0, torn.includes('l'));
    return 'polygon(' + pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',') + ')';
  }
  let mctx;
  /** measured width of str in the label face (fonts are loaded before the real build) */
  const measure = (str, sz, font = `900 ${sz}px "Archivo Black", "Noto Sans SC Variable", sans-serif`) => {
    mctx = mctx || document.createElement('canvas').getContext('2d');
    mctx.font = font; return mctx.measureText(str).width;
  };
  /** a new layer for a kit piece or mark; the builder's own svg and html move back on top, so anything drawn with plain
   *  P.* calls (P.text, P.liveRough, P.path, P.canvas …) always lies above every kit piece */
  function newLayer(self) {
    const L = self.layer();
    self.host.appendChild(self.svg); self.host.appendChild(self.html);
    return L;
  }
  const FROM = { l: [-520, 40], r: [520, -40], t: [60, -420], b: [-60, 420] };
  /** a layer that lies on the desk: rotated about (cx, cy), entering at `at` (slide | drop | cut), leaving at o.out */
  function lay(self, cx, cy, o) {
    const L = newLayer(self);
    const rot = o.rot ?? 0, at = o.at ?? 0, enter = o.enter || 'slide', from = FROM[o.from || 'r'] || FROM.r;
    const dur = enter === 'drop' ? 0.34 : 0.6;
    L.state = { out: o.out };
    L.wrap.style.opacity = '0';
    self.tick((lt) => {
      const q = clamp((step(lt) - at) / dur);
      let dx = 0, dy = 0, sc = 1, tilt = 0, op = q > 0 ? 1 : 0;
      if (enter === 'slide') { const e = ease.out(q); dx = from[0] * (1 - e); dy = from[1] * (1 - e); tilt = (o.tilt ?? 9) * (1 - Math.min(1, e * 1.15)); }
      if (enter === 'drop') { const e = q < 1 ? ease.out(q) : 1; sc = lerp(1.28, 1, e); tilt = -4 * (1 - e); }
      if (L.state.out != null) op *= 1 - clamp((lt - L.state.out) / 0.35);
      op *= o.dim ?? 1;
      L.wrap.style.opacity = op.toFixed(3);
      L.wrap.style.transform = `translate(${f2(cx + dx)}px,${f2(cy + dy)}px) rotate(${f2(rot + tilt)}deg) scale(${f2(sc)}) translate(${f2(-cx)}px,${f2(-cy)}px)`;
    });
    return L;
  }
  /** the paper body of a piece, under the piece's own drawings and text */
  function sheet(L, x, y, w, hh, o) {
    const tone = o.tone || 'news', T = TONES[tone] || TONES.news;
    const wrap = h('div', null, null);
    Object.assign(wrap.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px',
      filter: o.shadow === false ? 'none' : 'drop-shadow(3px 7px 6px rgba(45,35,20,0.30))' });
    const body = h('div', null, null, wrap);
    Object.assign(body.style, { position: 'absolute', inset: '0', background: `${T.bg} url(${tile(tone)})`, clipPath: outline(w, hh, o.seed ?? (x * 7 + y * 3) | 0, o.torn ?? 'trbl', o.amp ?? 7) });
    L.wrap.insertBefore(wrap, L.svg);
    return { wrap, body, T };
  }
  /** a strip of masking tape across a point (stage coords), angle in degrees */
  function tape(L, x, y, ang, w = 130) {
    const t = h('div', null, null);
    Object.assign(t.style, { position: 'absolute', left: x - w / 2 + 'px', top: y - 17 + 'px', width: w + 'px', height: '34px', rotate: ang + 'deg',
      background: 'rgba(232,226,204,0.82)', clipPath: outline(w, 34, (x + y) | 0, 'lr', 4), mixBlendMode: 'multiply' });
    L.wrap.insertBefore(t, L.svg.nextSibling);
  }
  const piece = (L, x, y, w, hh, rot, extra) => Object.assign({ L, x, y, w, h: hh, rot, cx: x + w / 2, cy: y + hh / 2, hide(t) { L.state.out = t; return this; } }, extra);

  /** paper(x, y, w, h, o): a torn sheet lying on the desk; draw on it with the returned piece's `L` (L.text, L.path,
   *  L.liveRough, L.canvas, L.bars … in stage coordinates; they rotate with the sheet and lie on it under later pieces).
   *  Plain P.* drawings always lie ABOVE every kit piece, so a drawing meant to be printed on a sheet goes through `L`. o: { tone: 'news'|'old'|'white'|'black'|'kraft'|'red'|'yellow', rot (deg,
   *  keep within ±6), at, enter: 'slide'|'drop'|'cut', from: 'l'|'r'|'t'|'b', torn: sides torn e.g. 'tb' (default 'trbl'),
   *  tape: true for two tape strips, out (fade-out time), shadow: false }. A 'black' sheet is the dark board for a big statement:
   *  write on it in color 'paper'. Returns { L, x, y, w, h, cx, cy, rot }. */
  B.paper = function (x, y, w, hh, o = {}) {
    const rot = o.rot ?? 0, L = lay(this, x + w / 2, y + hh / 2, o);
    sheet(L, x, y, w, hh, o);
    if (o.tape) { tape(L, x + w * 0.22, y + 4, -8); tape(L, x + w * 0.8, y + 2, 6); }
    return piece(L, x, y, w, hh, rot);
  };

  /** clipping(x, y, w, o): a torn newspaper cutting — kicker line, serif headline, body lines (you pass the lines; no
   *  auto-wrap: ~(w-80)/(bodySize*0.55) Latin chars or (w-80)/bodySize CJK chars per line). Height fits the content.
   *  o: { kicker: 'TECH · JUNE 2012', head: 'Headline\nsecond line', body: ['line', …], headSize (default 84), bodySize
   *  (default 34), rot, at, enter, from, tone ('news' default, 'old' for yellowed archive), greek: n extra grey filler lines,
   *  out }. Text is set at once (printed), not written. Returns the piece plus line(i) → { x, y, w, h } of body line i and
   *  methods to mark it, which follow the cutting's rotation: hl(i, at, o) yellow highlighter sweep over body line i
   *  (o.from/o.to: fraction of that line's printed text width, e.g. { from: 0.5 } for its second half), ring(i, at, o) red marker loop around line i (or 'head'), under(i, at, o)
   *  red marker underline. Call those marks after placing everything that lies above the cutting. */
  B.clipping = function (x, y, w, o = {}) {
    const hs = o.headSize ?? 84, bs = o.bodySize ?? 34, pad = 44;
    const headLines = (o.head || '').split('\n').filter(Boolean), body = o.body || [], greek = o.greek ?? 2;
    const lh = bs * 1.62, ky = y + 34, hy = ky + (o.kicker ? 52 : 4), by = hy + headLines.length * hs * 1.12 + 26;
    const hh = by - y + (body.length + greek) * lh + 36;
    const rot = o.rot ?? 0, L = lay(this, x + w / 2, y + hh / 2, o), sh = sheet(L, x, y, w, hh, o);
    const ink = sh.T.ink;
    const tAt = (o.at ?? 0) + 0.01;
    if (o.kicker) {
      L.text(o.kicker, { x: x + pad, y: ky, size: 25, font: 'mono', color: ink === 'ink' ? 'soft' : ink, at: tAt, mode: 'fade', dur: 0.01, raw: true });
      L.line(x + pad, ky + 38, x + w - pad, ky + 38, { color: ink, sw: 1.6, rough: 0, at: tAt, dur: 0.01 });
    }
    // one text element per block (not per line): on a tilted cutting, per-line boxes would overlap their neighbours
    if (headLines.length) L.text(headLines.join('\n'), { x: x + pad, y: hy, size: hs, weight: 800, lh: 1.12, color: ink, at: tAt, mode: 'fade', dur: 0.01, cls: 'head', raw: false });
    if (body.length) L.text(body.join('\n'), { x: x + pad, y: by, size: bs, lh: 1.62, color: ink, at: tAt, mode: 'fade', dur: 0.01 });
    const bodyW = body.map((t) => measure(t, bs, `400 ${bs}px "Fraunces Variable", "Noto Serif SC Variable", serif`));
    const r = PV.rng((x + y) | 0);
    for (let i = 0; i < greek; i++) {
      const gy = by + (body.length + i) * lh + bs * 0.55, gw = (w - pad * 2) * (i === greek - 1 ? 0.55 + r() * 0.2 : 0.9 + r() * 0.1);
      L.rect(x + pad, gy, gw, bs * 0.42, { fill: 'faint', color: 'faint', sw: 0.1, rough: 0, at: tAt, dur: 0.01, texture: false });
    }
    const self = this, cx = x + w / 2, cy = y + hh / 2;
    const line = (i) => (i === 'head' ? { x: x + pad, y: hy, w: w - pad * 2, h: headLines.length * hs * 1.12 } : { x: x + pad, y: by + i * lh, w: Math.min(w - pad * 2, bodyW[i] || w - pad * 2), h: bs * 1.3 });
    return piece(L, x, y, w, hh, rot, {
      line,
      hl(i, at, q = {}) { const b = line(i), a = q.from ?? 0, z = q.to ?? 1; return self.highlight(b.x + b.w * a - 6, b.y - 2, b.w * (z - a) + 12, b.h + 4, { at, dur: q.dur, rot, ox: cx, oy: cy }); },
      ring(i, at, q = {}) { const b = line(i), a = q.from ?? 0, z = q.to ?? 1; return self.scribble(b.x + b.w * (a + z) / 2, b.y + b.h / 2, b.w * (z - a) + 40, b.h + 30, { at, dur: q.dur, rot, ox: cx, oy: cy }); },
      under(i, at, q = {}) { const b = line(i), a = q.from ?? 0, z = q.to ?? 1; return self.redline(b.x + b.w * a, b.y + b.h + 4, b.x + b.w * z, b.y + b.h + 2, { at, dur: q.dur, rot, ox: cx, oy: cy }); },
    });
  };

  /** photo(x, y, w, h, draw, o): a halftone print with a white border (an "archival photo") — draw(ctx, w, h) paints the
   *  picture in plain shapes and greys on a w×h canvas (silhouettes of people, machines, buildings; dark = ink), the kit turns it
   *  into a 45° dot screen. o: { caption (typewriter line under the print), cell (dot size, default 7), duo: a palette colour
   *  name to print the dots in instead of ink (e.g. 'red', 'blue'), rot, at, enter, from, tape (default true), out }.
   *  Returns the piece; the picture area is { x, y, w, h } as passed. */
  B.photo = function (x, y, w, hh, draw, o = {}) {
    w = Math.round(w); hh = Math.round(hh);
    const bd = 16, capH = o.caption ? 54 : 0;
    const rot = o.rot ?? 0, L = lay(this, x + w / 2, y + hh / 2, o);
    sheet(L, x - bd, y - bd, w + bd * 2, hh + bd * 2 + capH, Object.assign({ tone: 'white', torn: '', amp: 2 }, o, { tone: 'white' }));
    const src = document.createElement('canvas'); src.width = w; src.height = hh;
    const sg = src.getContext('2d'); sg.fillStyle = '#d9d4ca'; sg.fillRect(0, 0, w, hh); draw(sg, w, hh);
    const out = document.createElement('canvas'); out.width = w; out.height = hh;
    const g = out.getContext('2d'), sd = sg.getImageData(0, 0, w, hh).data, cell = o.cell ?? 7;
    g.fillStyle = '#E6E1D6'; g.fillRect(0, 0, w, hh); g.fillStyle = col(o.duo || '#1C1B19');
    const ca = Math.cos(Math.PI / 4), sa = Math.sin(Math.PI / 4), R = Math.hypot(w, hh);
    g.beginPath();
    for (let v = -R; v < R; v += cell) for (let u = -R; u < R; u += cell) {
      const px = w / 2 + u * ca - v * sa, py = hh / 2 + u * sa + v * ca;
      if (px < -cell || py < -cell || px > w + cell || py > hh + cell) continue;
      const i = ((clamp(py | 0, 0, hh - 1)) * w + clamp(px | 0, 0, w - 1)) * 4;
      let Lm = (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255; Lm = clamp((Lm - 0.5) * 1.3 + 0.5);
      const rr = cell * 0.64 * Math.sqrt(1 - Lm); if (rr < 0.4) continue;
      g.moveTo(px + rr, py); g.arc(px, py, rr, 0, Math.PI * 2);
    }
    g.fill();
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(214,200,170,0.28)'; g.fillRect(0, 0, w, hh);
    Object.assign(out.style, { position: 'absolute', left: x + 'px', top: y + 'px' });
    L.wrap.insertBefore(out, L.svg);
    if (o.tape !== false) { tape(L, x + w * 0.5, y - bd + 2, -4 + (rot * 0.5)); }
    if (o.caption) L.text(o.caption, { x: x, y: y + hh + 8, size: 26, font: 'mono', color: 'soft', at: (o.at ?? 0) + 0.01, mode: 'fade', dur: 0.01, raw: true });
    return piece(L, x, y, w, hh, rot);
  };

  /** note(x, y, w, lines, o): a lined index card; the lines are typed on in typewriter face (13 chars/s) from o.at + 0.4.
   *  o: { size (default 34), rot, at, enter, from, cps, color (text colour), title: a red heading line, out }.
   *  Returns the piece plus text handles `texts`. */
  B.note = function (x, y, w, lines, o = {}) {
    const sz = o.size ?? 34, lh = sz * 1.7, top = o.title ? lh + 20 : 30;
    const hh = top + lines.length * lh + 40;
    const rot = o.rot ?? 0, L = lay(this, x + w / 2, y + hh / 2, o);
    sheet(L, x, y, w, hh, Object.assign({ torn: '', amp: 1.5 }, o, { tone: 'white' }));
    const at = (o.at ?? 0) + 0.01;
    if (o.title) L.line(x + 20, y + top - 14, x + w - 20, y + top - 14, { color: 'red', sw: 2, rough: 0, at, dur: 0.01 });
    for (let i = 0; i <= lines.length; i++) L.line(x + 20, y + top + (i + 1) * lh - 10, x + w - 20, y + top + (i + 1) * lh - 10, { color: '#A9C1D6', sw: 1.4, rough: 0, at, dur: 0.01 });
    let t0 = at + 0.4;
    const texts = [];
    if (o.title) { texts.push(L.text(o.title, { x: x + 34, y: y + 22, size: sz, font: 'mono', weight: 600, color: 'red', at: t0, cps: o.cps ?? 13, pen: false, raw: true })); t0 += o.title.length / (o.cps ?? 13); }
    lines.forEach((t, i) => { texts.push(L.text(t, { x: x + 34, y: y + top + i * lh + (lh - sz * 1.3) - 12, size: sz, font: 'mono', color: o.color || 'ink', at: t0, cps: o.cps ?? 13, pen: false, raw: true })); t0 += t.length / (o.cps ?? 13) + 0.15; });
    return piece(L, x, y, w, hh, rot, { texts });
  };

  /** label(x, y, text, o): a black torn label strip with bold white type, typed on at 13 chars/s (the Vox name/date tag).
   *  o: { size (default 40), tone: 'black'|'red'|'yellow'|'white', rot, at, cps, out }. Width fits the text.
   *  Returns the piece plus `text` and `w`. */
  B.label = function (x, y, str, o = {}) {
    const sz = o.size ?? 40, w = Math.round(measure(str, sz) + sz * 1.3), hh = Math.round(sz * 1.75);
    const rot = o.rot ?? 0, L = lay(this, x + w / 2, y + hh / 2, Object.assign({ enter: 'cut' }, o));
    const tone = o.tone || 'black';
    sheet(L, x, y, w, hh, Object.assign({ torn: 'lr', amp: 6, shadow: true }, o, { tone }));
    const text = L.text(str, { x: x + sz * 0.6, y: y + (hh - sz * 1.3) / 2, size: sz, weight: 900, cls: 'lbl', color: tone === 'yellow' || tone === 'white' ? 'ink' : '#F4F0E8', at: (o.at ?? 0) + 0.08, cps: o.cps ?? 13, pen: false });
    return piece(L, x, y, w, hh, rot, { text, w });
  };

  /** highlight(x, y, w, h, o): a yellow highlighter swipe (multiplied onto what is under it), sweeping left→right in 12 fps
   *  steps. o: { at, dur (default 0.8), color (default 'yellow'), rot/ox/oy (rotate about ox, oy to match a rotated sheet) }. */
  B.highlight = function (x, y, w, hh, o = {}) {
    const L = newLayer(this), at = o.at ?? 0, dur = o.dur ?? 0.8;
    L.wrap.style.mixBlendMode = 'multiply';
    if (o.rot) L.wrap.style.transform = `translate(${o.ox}px,${o.oy}px) rotate(${o.rot}deg) translate(${-o.ox}px,${-o.oy}px)`;
    const r = PV.rng((x + y * 3) | 0), top = [], bot = [];
    for (let i = 0; i <= 24; i++) { top.push([x + w * i / 24, y + (r() - 0.5) * 4]); bot.push([x + w * (24 - i) / 24, y + hh + (r() - 0.5) * 4]); }
    const d = 'M' + top.concat([[x + w + 7, y + hh / 2]], bot).map((p) => p.map(f2).join(' ')).join(' L') + ' Z';
    const cid = 'hlc' + (++PV.__hl || (PV.__hl = 1));
    const defs = s('defs', {}, L.svg), clip = s('clipPath', { id: cid }, defs);
    const cr = s('rect', { x: x - 10, y: y - 10, width: 0, height: hh + 20 }, clip);
    s('path', { d, fill: col(o.color || 'yellow'), opacity: 0.88, 'clip-path': `url(#${cid})` }, L.svg);
    this.tick((lt) => { cr.setAttribute('width', f2((w + 24) * ease.out(clamp((step(lt) - at) / dur)))); });
    return { L, end: at + dur };
  };

  function markerPath(L, d, at, dur, o, width = 7) {
    const g = s('g', {}, L.svg);
    if (o.rot) L.wrap.style.transform = `translate(${o.ox}px,${o.oy}px) rotate(${o.rot}deg) translate(${-o.ox}px,${-o.oy}px)`;
    const p = s('path', { d, fill: 'none', stroke: col(o.color || 'red'), 'stroke-width': o.sw ?? width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.92 }, g);
    let len = 0;
    return (lt) => {
      if (!len) { len = p.getTotalLength() + 2; p.style.strokeDasharray = `${len} ${len}`; }
      const k = ease.draw(clamp((step(lt) - at) / dur));
      p.style.strokeDashoffset = f2(len * (1 - k));
      p.style.visibility = k <= 0 ? 'hidden' : 'visible';
    };
  }
  /** scribble(cx, cy, w, h, o): a red marker loop drawn in one stroke around something (open, overshooting, slightly
   *  tilted, like a reporter circling a word). o: { at, dur (default 0.65), color, sw (default 7), rot/ox/oy }. */
  B.scribble = function (cx, cy, w, hh, o = {}) {
    const L = newLayer(this), r = PV.rng((cx * 3 + cy) | 0), pts = [], a0 = -2.4;
    for (let i = 0; i <= 40; i++) { const a = a0 + (i / 40) * Math.PI * 2.18, j = 1 + (r() - 0.5) * 0.06 + (i / 40) * 0.07; pts.push([cx + Math.cos(a) * w / 2 * j, cy + Math.sin(a) * hh / 2 * j - (i / 40) * 6]); }
    const d = 'M' + pts.map((p) => p.map(f2).join(' ')).join(' L');
    this.tick(markerPath(L, d, o.at ?? 0, o.dur ?? 0.65, o));
    return { L, end: (o.at ?? 0) + (o.dur ?? 0.65) };
  };
  /** redline(x1, y1, x2, y2, o): a red marker stroke (underline, strike, pointer). o: { at, dur (default 0.45), bend
   *  (curvature, e.g. 0.2), arrow: true for an arrowhead at the end, color, sw, rot/ox/oy }. */
  B.redline = function (x1, y1, x2, y2, o = {}) {
    const L = newLayer(this), bend = o.bend ?? 0.03, mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    let d = `M${x1} ${y1} Q${f2(mx)} ${f2(my)} ${x2} ${y2}`;
    if (o.arrow) { const a = Math.atan2(y2 - my, x2 - mx), hl = 30; d += ` M${f2(x2 - hl * Math.cos(a - 0.5))} ${f2(y2 - hl * Math.sin(a - 0.5))} L${x2} ${y2} L${f2(x2 - hl * Math.cos(a + 0.5))} ${f2(y2 - hl * Math.sin(a + 0.5))}`; }
    this.tick(markerPath(L, d, o.at ?? 0, o.dur ?? 0.45, o));
    return { L, end: (o.at ?? 0) + (o.dur ?? 0.45) };
  };
  /** string(x1, y1, x2, y2, o): red thread pinned at both ends, sagging under its weight, pulled from the first pin to the
   *  second (the investigation-wall connection between two pieces of evidence). o: { at, dur (default 0.6), sag (default
   *  0.08), color, pins (default true) }. */
  B.string = function (x1, y1, x2, y2, o = {}) {
    const L = newLayer(this), at = o.at ?? 0, dur = o.dur ?? 0.6, sag = o.sag ?? 0.08;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + Math.hypot(x2 - x1, y2 - y1) * sag;
    const d = `M${x1} ${y1} Q${f2(mx)} ${f2(my)} ${x2} ${y2}`;
    const sh = s('path', { d, fill: 'none', stroke: 'rgba(40,25,15,0.2)', 'stroke-width': 4, transform: 'translate(3 6)' }, L.svg);
    const p = s('path', { d, fill: 'none', stroke: col(o.color || 'red'), 'stroke-width': 4, 'stroke-linecap': 'round' }, L.svg);
    const pin = (x, y) => { const g = s('g', { opacity: 0 }, L.svg); s('circle', { cx: x + 3, cy: y + 5, r: 12, fill: 'rgba(0,0,0,0.25)' }, g); s('circle', { cx: x, cy: y, r: 12, fill: col(o.color || 'red') }, g); s('circle', { cx: x - 4, cy: y - 4, r: 4, fill: 'rgba(255,255,255,0.55)' }, g); return g; };
    const p1 = o.pins === false ? null : pin(x1, y1), p2 = o.pins === false ? null : pin(x2, y2);
    let len = 0;
    this.tick((lt) => {
      if (!len) { len = p.getTotalLength() + 2; for (const e of [p, sh]) e.style.strokeDasharray = `${len} ${len}`; }
      const k = ease.out(clamp((step(lt) - at) / dur));
      for (const e of [p, sh]) { e.style.strokeDashoffset = f2(len * (1 - k)); e.style.visibility = k <= 0 ? 'hidden' : 'visible'; }
      if (p1) p1.setAttribute('opacity', step(lt) >= at ? 1 : 0);
      if (p2) p2.setAttribute('opacity', k >= 1 ? 1 : 0);
    });
    return { L, end: at + dur };
  };
  /** rubber(cx, cy, text, o): a red rubber stamp slammed onto the paper (double border, distressed ink, tilted).
   *  o: { at, size (default 54), rot (default -8), color (default 'red') }. */
  B.rubber = function (cx, cy, str, o = {}) {
    const sz = o.size ?? 54, w = Math.round(measure(str.toUpperCase(), sz) * 1.12 + sz * 1.4), hh = Math.round(sz * 1.9), c = col(o.color || 'red');
    const L = lay(this, cx, cy, { at: o.at, rot: o.rot ?? -8, enter: 'drop', out: o.out });
    const box = h('div', 'rubber', null, null);
    box.textContent = str;
    Object.assign(box.style, { left: cx - w / 2 + 'px', top: cy - hh / 2 + 'px', width: w + 'px', height: hh + 'px', fontSize: sz + 'px', lineHeight: hh - 16 + 'px', color: c, border: `5px solid ${c}`, outline: `2px solid ${c}`, outlineOffset: '5px' });
    L.html.appendChild(box);
    return { L, end: (o.at ?? 0) + 0.34 };
  };

  /** desk(o): the bed of the collage — faded scraps of newsprint columns, an old map corner, graph paper and kraft half
   *  off the frame edges, so evidence never floats on an empty table. Call it FIRST on a page (it lies under everything),
   *  then place the real evidence over the middle. o: { seed (change per page so desks differ), dim (default 0.62),
   *  dark: true for a darker desk on a black board page }. Static: already there when the page cuts in. */
  B.desk = function (o = {}) {
    const r = PV.rng(o.seed ?? 7), dim = o.dim ?? 0.62;
    const W = STAGE.w, H = STAGE.h, spots = [[-120, -60], [W - 420, -90], [-160, H - 440], [W - 360, H - 380], [W / 2 - 260, H - 220], [W / 2 - 440, -140], [W / 2 + 160, H - 180]];
    const tones = ['news', 'old', 'news', 'white', 'kraft', 'news', 'old'];
    spots.forEach(([sx, sy], i) => {
      if (r() < 0.25) return;
      const w = 420 + r() * 260, hh = 300 + r() * 220, x = sx + (r() - 0.5) * 120, y = sy + (r() - 0.5) * 80, tone = tones[(i + (o.seed ?? 0)) % tones.length];
      const kind = (i + Math.floor(r() * 4)) % 4, rot = (r() - 0.5) * 22;
      if (kind === 3) {
        const q = r();
        this.photo(x + 30, y + 30, w * 0.7, hh * 0.7, (g, pw, ph) => {
          const gr = g.createLinearGradient(0, 0, pw, ph); gr.addColorStop(0, '#eee'); gr.addColorStop(1, '#555'); g.fillStyle = gr; g.fillRect(0, 0, pw, ph);
          g.fillStyle = '#222'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(pw * (0.2 + 0.2 * k), ph * (0.55 + 0.1 * Math.sin(k + q * 6)), pw * 0.08, ph * 0.32, 0, 0, 7); g.fill(); }
        }, { rot, enter: 'cut', at: 0, dim: dim * 0.9, tape: r() < 0.5, cell: 6 });
        return;
      }
      const pc = this.paper(x, y, w, hh, { tone, rot, enter: 'cut', at: 0, dim, seed: (i * 131 + (o.seed ?? 7)) | 0 });
      if (kind === 0) for (let c = 0; c < 3; c++) for (let k = 0; k < 9; k++) pc.L.rect(x + 30 + c * (w - 60) / 3, y + 40 + k * 30, (w - 60) / 3 - 22, 9, { fill: 'faint', color: 'faint', sw: 0.1, rough: 0, at: 0, dur: 0.01, texture: false });
      else if (kind === 1) for (let k = 0; k < 6; k++) pc.L.path(`M${x} ${y + 60 + k * 50} C ${x + w * 0.3} ${y + 30 + k * 55}, ${x + w * 0.6} ${y + 90 + k * 40}, ${x + w} ${y + 50 + k * 52}`, { color: tone === 'kraft' ? 'soft' : 'faint', sw: 2, rough: 0.4, at: 0, dur: 0.01 });
      else for (let k = 0; k * 34 < w; k++) { pc.L.line(x + k * 34, y, x + k * 34, y + hh, { color: 'blueF', sw: 1.2, rough: 0, at: 0, dur: 0.01 }); if (k * 34 < hh) pc.L.line(x, y + k * 34, x + w, y + k * 34, { color: 'blueF', sw: 1.2, rough: 0, at: 0, dur: 0.01 }); }
    });
  };

  // the page title becomes a black label strip pinned top left, typed on
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15;
    return T.label(STAGE.title.x, STAGE.title.y - 14, str, { at, size: o.size ?? 44, rot: -1.2, tone: o.accent === 'red' ? 'red' : 'black' });
  };
})();
