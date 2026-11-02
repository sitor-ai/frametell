/* Blueprint · kit: an engineering drawing in motion. Lines are drafted at constant pen speed (no easing, like a drafting
 * pen pulled along a rule), hidden lines are dashed, centre lines dash-dot; dimensions draw both ways from their middle
 * and their measurement counts up; parts slide apart into an exploded view; numbered balloons point at parts; a red
 * pencil corrects and circles. Everything is a pure function of page-local time lt.
 * Shape helpers for P.draft(d): PV.BP.rect, circle, arc, poly, slot, gear, spring, bolt (each returns an SVG path d). */
(function () {
  const { h, s, col, clamp, lerp, ease, Builder } = PV;
  const B = Builder.prototype;
  const f1 = (n) => n.toFixed(1), f2 = (n) => n.toFixed(2);
  const expo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)));
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const DASH = { hidden: '16 10', center: '38 9 7 9', phantom: '38 9 7 9 7 9' };
  let uid = 0;

  // ── shape helpers: SVG path strings, for P.draft ───────────────────────────
  const BP = {
    /** rect(x, y, w, h, r=0): a rectangle (r: corner radius, or a chamfer when r < 0) */
    rect: (x, y, w, hh, r = 0) => {
      if (!r) return `M${x} ${y}H${x + w}V${y + hh}H${x}Z`;
      const c = Math.abs(Math.min(Math.abs(r), w / 2, hh / 2));
      if (r < 0) return `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + hh - c}L${x + w - c} ${y + hh}H${x + c}L${x} ${y + hh - c}V${y + c}Z`;
      return `M${x + c} ${y}H${x + w - c}A${c} ${c} 0 0 1 ${x + w} ${y + c}V${y + hh - c}A${c} ${c} 0 0 1 ${x + w - c} ${y + hh}H${x + c}A${c} ${c} 0 0 1 ${x} ${y + hh - c}V${y + c}A${c} ${c} 0 0 1 ${x + c} ${y}Z`;
    },
    /** circle(cx, cy, r): a full circle, drawn clockwise from the top */
    circle: (cx, cy, r) => `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`,
    /** arc(cx, cy, r, a0, a1): an arc between two angles in degrees (0 = right, 90 = down) */
    arc: (cx, cy, r, a0, a1) => {
      const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${f1(x1)} ${f1(y1)}`;
    },
    /** poly(pts, closed=true): a polyline through [[x, y], …] */
    poly: (pts, closed = true) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L') + (closed ? 'Z' : ''),
    /** slot(x, y, w, h): a rounded slot / pill (a keyway, a piston, a capsule) */
    slot: (x, y, w, hh) => BP.rect(x, y, w, hh, Math.min(w, hh) / 2),
    /** gear(cx, cy, r, teeth=12, depth=r*0.16, hole=r*0.28): a spur gear outline with its bore (two subpaths) */
    gear: (cx, cy, r, n = 12, depth, hole) => {
      depth = depth ?? r * 0.16; hole = hole ?? r * 0.28;
      const pts = [], ro = r, ri = r - depth;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, st = (Math.PI * 2) / n;
        for (const [k, rr] of [[0, ri], [0.12, ro], [0.38, ro], [0.5, ri]]) pts.push([cx + rr * Math.cos(a + k * st), cy + rr * Math.sin(a + k * st)]);
      }
      return BP.poly(pts) + BP.circle(cx, cy, hole);
    },
    /** spring(x1, y1, x2, y2, coils=8, amp=26): a coil spring zig-zag between two points */
    spring: (x1, y1, x2, y2, n = 8, amp = 26) => {
      const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, pts = [[x1, y1]];
      for (let i = 0; i <= n * 2; i++) { const t = (i + 0.5) / (n * 2 + 1), sgn = i % 2 ? -1 : 1; pts.push([x1 + ux * L * t - uy * amp * sgn, y1 + uy * L * t + ux * amp * sgn]); }
      pts.push([x2, y2]);
      return BP.poly(pts, false);
    },
    /** bolt(cx, cy, w, len, dir='down'): a hex-head bolt seen from the side, with thread lines */
    bolt: (cx, cy, w, len) => {
      const hw = w * 0.8, hh = w * 0.55;
      let d = BP.rect(cx - hw, cy, hw * 2, hh) + `M${cx - hw / 3} ${cy}V${cy + hh}M${cx + hw / 3} ${cy}V${cy + hh}` + BP.rect(cx - w / 2, cy + hh, w, len);
      for (let y = cy + hh + len * 0.35; y < cy + hh + len - 4; y += 10) d += `M${cx - w / 2} ${f1(y)}L${cx + w / 2} ${f1(y + 6)}`;
      return d;
    },
  };
  PV.BP = BP;

  // ── the drafting engine: paths drawn one after another at constant pen speed ─
  /** builds the stroke elements of one drafted drawing; returns { g, segs, len } */
  function strokes(P, ds, o) {
    const g = s('g', { class: 'bp' }, P.svg);
    const color = col(o.color || 'ink'), sw = o.sw ?? (o.line === 'center' || o.line === 'phantom' ? 1.6 : o.line === 'hidden' ? 2.2 : 3.2);
    const segs = [];
    for (const d of [].concat(ds)) {
      const p = s('path', { d, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': o.line ? 'butt' : 'round', 'stroke-linejoin': 'round' }, g);
      const len = p.getTotalLength() + 1;
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = String(len);
      let vis = null, mp = null;
      if (o.line && DASH[o.line]) {   // a dashed line still draws on: the dashed copy shows through the growing solid one
        const id = 'bpm' + ++uid;
        const mask = s('mask', { id, maskUnits: 'userSpaceOnUse', x: -400, y: -400, width: STAGE.w + 800, height: STAGE.h + 800 }, s('defs', {}, g));
        mp = p.cloneNode(); mp.setAttribute('stroke', '#fff'); mp.setAttribute('stroke-width', sw + 8); mask.appendChild(mp);
        vis = p.cloneNode(); vis.style.strokeDasharray = DASH[o.line]; vis.style.strokeDashoffset = '0'; vis.setAttribute('mask', `url(#${id})`);
        g.insertBefore(vis, p); p.setAttribute('stroke-opacity', '0.001');
      }
      segs.push({ p, len, vis, mp });
    }
    return { g, segs, len: segs.reduce((a, q) => a + q.len, 0) };
  }
  function runSegs(segs, dist) {
    let acc = dist;
    for (const q of segs) {
      const k = clamp(acc / q.len); acc -= q.len;
      const off = f1(q.len * (1 - k));
      q.p.style.strokeDashoffset = off;
      q.p.style.visibility = k <= 0 ? 'hidden' : 'visible';
      if (q.mp) { q.mp.style.strokeDasharray = q.p.style.strokeDasharray; q.mp.style.strokeDashoffset = off; q.vis.style.visibility = k <= 0 ? 'hidden' : 'visible'; }
    }
  }
  /** section hatching: 45° lines every `gap` px across the closed outline, clipped to it */
  function hatchOf(P, g, ds, o) {
    const id = 'bpc' + ++uid;
    const cp = s('clipPath', { id }, s('defs', {}, g));
    s('path', { d: [].concat(ds).join(' '), 'clip-rule': 'evenodd' }, cp);
    const hp = s('path', { d: '', fill: 'none', stroke: col(o.hatchColor || o.color || 'ink'), 'stroke-width': 1.5, 'stroke-opacity': 0.75, 'clip-path': `url(#${id})` }, g);
    let len = 0, built = false;
    const build = () => {
      if (built) return; built = true;
      const bb = g.getBBox();
      if (!bb.width) { built = false; return; }
      const gap = o.gap ?? 13, ang = o.hatchAngle ?? 45, t = Math.tan((ang * Math.PI) / 180);
      let d = '';
      for (let c = bb.x - bb.height / t; c < bb.x + bb.width; c += gap) d += `M${f1(c)} ${f1(bb.y + bb.height)}L${f1(c + bb.height / t)} ${f1(bb.y)}`;
      hp.setAttribute('d', d);
      len = hp.getTotalLength() + 1;
      hp.style.strokeDasharray = `${len} ${len}`;
    };
    return (k) => { build(); if (!built) return; hp.style.strokeDashoffset = f1(len * (1 - k)); hp.style.visibility = k <= 0 ? 'hidden' : 'visible'; };
  }

  /**
   * draft(d, o): THE line of this style — any outline (an SVG path d, or an array of them, drawn in order) drafted at
   * constant pen speed. Build drawings from PV.BP shapes: P.draft([PV.BP.rect(…), PV.BP.circle(…)], { at }).
   * o: { at, speed (px/s, default 1100), dur (overrides speed), color ('ink'), sw, line 'solid'|'hidden' (dashed: what is
   * behind)|'center' (dash-dot axis)|'phantom', fill (a tint that fades in once the outline is done, e.g. 'inkF', 'redF'),
   * hatch (true: section-cut hatching after the outline), gap (hatch spacing, 13), move (lt => ({ dx, dy, rot, cx, cy, s }):
   * moves/turns the drawing over time — a gear turning, a piston sliding), out }. Returns a handle (.g, .end).
   */
  B.draft = function (d, o = {}) {
    const at = o.at ?? 0, { g, segs, len } = strokes(this, d, o);
    const dl = o.dur ?? clamp(len / (o.speed ?? 1100), 0.25, 3.2);
    let fillEl = null, hatch = null;
    if (o.fill) { fillEl = s('path', { d: [].concat(d).join(' '), fill: col(o.fill), stroke: 'none', 'fill-rule': 'evenodd' }, null); g.insertBefore(fillEl, g.firstChild); fillEl.style.opacity = '0'; }
    if (o.hatch) hatch = hatchOf(this, g, d, o);
    const extra = (fillEl ? 0.3 : 0) + (hatch ? 0.5 : 0);
    const a = this.act({
      at, dur: dl + extra, g, kind: 'draw', pen: o.pen !== false,
      apply: (k, lt, vis) => {
        const t = lt - at;
        runSegs(segs, clamp(t / dl) * len);
        if (fillEl) fillEl.style.opacity = f2(clamp((t - dl) / 0.3) * (o.fillOp ?? 0.85));
        if (hatch) hatch(clamp((t - dl - (fillEl ? 0.15 : 0)) / 0.5));
        g.style.opacity = f2(vis);
      },
    });
    if (o.move) {
      const mv = o.move;
      this.tick((lt) => {
        const m = mv(lt) || {};
        const cx = m.cx ?? 0, cy = m.cy ?? 0;
        g.setAttribute('transform', `translate(${f2(m.dx ?? 0)} ${f2(m.dy ?? 0)})` + (m.rot ? ` rotate(${f2(m.rot)} ${cx} ${cy})` : '') + (m.s && m.s !== 1 ? ` translate(${cx} ${cy}) scale(${f2(m.s)}) translate(${-cx} ${-cy})` : ''));
      });
    }
    return this.handle(a, g);
  };

  /** a filled arrowhead (a drafting arrow: slim, solid) at (x, y) pointing along angle ang */
  const head = (x, y, ang, L = 20, W = 6) => {
    const bx = x - L * Math.cos(ang), by = y - L * Math.sin(ang), nx = -Math.sin(ang) * W, ny = Math.cos(ang) * W;
    return `M${f1(x)} ${f1(y)}L${f1(bx + nx)} ${f1(by + ny)}L${f1(bx - nx)} ${f1(by - ny)}Z`;
  };

  /**
   * dim(x1, y1, x2, y2, o): a dimension — extension lines from the two points, then the dimension line drawn out both ways
   * from its middle to two slim arrowheads, then the measurement in the gap. A number counts up while the line draws.
   * o: { text (a fixed label) | value + unit + decimals (counts from 0 to value), off (offset of the line from the points,
   * perpendicular, default 50; negative = the other side), at, color ('ink'; 'yellow' for THE dimension of the page),
   * size (text px, 30), dur (0.8), out }. Use for sizes, distances, durations on a timeline, gaps, ratios (text '×3').
   */
  B.dim = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.8, off = o.off ?? 50, color = col(o.color || 'ink');
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
    const ax = x1 + nx * off, ay = y1 + ny * off, bx = x2 + nx * off, by = y2 + ny * off, mx = (ax + bx) / 2, my = (ay + by) / 2;
    const sg = Math.sign(off) || 1;
    const g = s('g', { class: 'bp' }, this.svg);
    const line = (d, w) => s('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'butt' }, g);
    const e1 = line(`M${f1(x1 + nx * 8 * sg)} ${f1(y1 + ny * 8 * sg)}L${f1(ax + nx * 14 * sg)} ${f1(ay + ny * 14 * sg)}`, 1.4);
    const e2 = line(`M${f1(x2 + nx * 8 * sg)} ${f1(y2 + ny * 8 * sg)}L${f1(bx + nx * 14 * sg)} ${f1(by + ny * 14 * sg)}`, 1.4);
    const l1 = line(`M${f1(mx)} ${f1(my)}L${f1(ax)} ${f1(ay)}`, 2), l2 = line(`M${f1(mx)} ${f1(my)}L${f1(bx)} ${f1(by)}`, 2);
    const ang = Math.atan2(uy, ux);
    const h1 = s('path', { d: head(ax, ay, ang + Math.PI), fill: color }, g), h2 = s('path', { d: head(bx, by, ang), fill: color }, g);
    for (const p of [e1, e2, l1, l2]) { const n = p.getTotalLength() + 1; p._n = n; p.style.strokeDasharray = `${n} ${n}`; p.style.strokeDashoffset = String(n); }
    const size = o.size ?? 30;
    const el = h('div', 'tx bp-dimt', null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', color, left: mx + 'px', top: my + 'px' });
    // unidirectional dimensioning: the measurement always reads horizontally; on a steep line it sits beside the line
    const steep = Math.abs(uy) > 0.7, side = sg * (nx >= 0 ? 1 : -1);
    el.style.transform = steep ? (side > 0 ? 'translate(6px, -50%)' : 'translate(calc(-100% - 6px), -50%)') : 'translate(-50%, -50%)';
    const fmt = (v) => (o.text != null ? o.text : (o.prefix || '') + v.toFixed(o.decimals ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, o.sep === false ? '' : ',') + (o.unit ? ' ' + o.unit : ''));
    el.textContent = fmt(o.value ?? 0);
    const a = this.act({
      at, dur: dur + 0.25, g, kind: 'draw', pen: false,
      apply: (_, lt, vis) => {
        const t = lt - at, ke = clamp(t / (dur * 0.3)), kl = clamp((t - dur * 0.25) / (dur * 0.75));
        for (const p of [e1, e2]) { p.style.strokeDashoffset = f1(p._n * (1 - ke)); p.style.visibility = t < 0 ? 'hidden' : 'visible'; }
        for (const p of [l1, l2]) { p.style.strokeDashoffset = f1(p._n * (1 - kl)); p.style.visibility = kl <= 0 ? 'hidden' : 'visible'; }
        h1.style.opacity = h2.style.opacity = kl >= 0.98 ? '1' : '0';
        el.style.opacity = f2((kl > 0.15 ? 1 : 0) * vis);
        if (o.text == null) { const v = (o.value ?? 0) * ease.out(clamp(kl / 0.9)); const sv = fmt(v); if (el._s !== sv) { el._s = sv; el.textContent = sv; } }
        g.style.opacity = f2(vis);
      },
    });
    const hnd = this.handle(a, g);
    hnd.mid = { x: mx, y: my };
    return hnd;
  };

  /**
   * callout(x, y, n, o): a numbered balloon — a dot on the part at (x, y), a leader line drafted out to a circle with the
   * number n in it, and an optional note beside it. o: { bx, by (balloon centre; default up-right of the point), at, color,
   * r (balloon radius, 30), text (the note, set in technical lettering), size (note px, 30), side 'r'|'l' (note side), out }.
   * Number the parts of a drawing 1, 2, 3… in the order the narration names them.
   */
  B.callout = function (x, y, n, o = {}) {
    const at = o.at ?? 0, r = o.r ?? 30, color = col(o.color || 'ink');
    const bx = o.bx ?? x + 150, by = o.by ?? y - 120;
    const L = Math.hypot(bx - x, by - y) || 1, ex = bx - ((bx - x) / L) * r, ey = by - ((by - y) / L) * r;
    const g = s('g', { class: 'bp' }, this.svg);
    const dot = s('circle', { cx: x, cy: y, r: 5, fill: color }, g);
    const lead = s('path', { d: `M${x} ${y}L${f1(ex)} ${f1(ey)}`, fill: 'none', stroke: color, 'stroke-width': 1.8 }, g);
    const ring = s('path', { d: BP.circle(bx, by, r), fill: col('paper'), 'fill-opacity': 0.9, stroke: color, 'stroke-width': 2.4 }, g);
    const ln = lead.getTotalLength() + 1, rn = ring.getTotalLength() + 1;
    lead.style.strokeDasharray = `${ln} ${ln}`; ring.style.strokeDasharray = `${rn} ${rn}`;
    const num = h('div', 'tx bp-lab', String(n), this.html);
    Object.assign(num.style, { fontSize: r * 1.05 + 'px', color, left: bx + 'px', top: by + 'px', transform: 'translate(-50%, -48%)', letterSpacing: '0' });
    let note = null;
    if (o.text) {
      note = h('div', 'tx bp-word', null, this.html);
      note.textContent = o.text;
      Object.assign(note.style, { fontSize: (o.size ?? 30) + 'px', color, top: by - (o.size ?? 30) * 0.55 + 'px' });
      const side = o.side || (bx >= x ? 'r' : 'l');
      if (side === 'r') note.style.left = bx + r + 16 + 'px'; else { note.style.left = bx - r - 16 + 'px'; note.style.transform = 'translateX(-100%)'; }
    }
    const a = this.act({
      at, dur: 0.75, g, kind: 'draw', pen: false,
      apply: (_, lt, vis) => {
        const t = lt - at;
        dot.style.opacity = f2((t >= 0 ? 1 : 0) * vis);
        lead.style.strokeDashoffset = f1(ln * (1 - clamp(t / 0.3))); lead.style.visibility = t < 0 ? 'hidden' : 'visible';
        ring.style.strokeDashoffset = f1(rn * (1 - clamp((t - 0.28) / 0.3))); ring.style.visibility = t < 0.28 ? 'hidden' : 'visible';
        ring.setAttribute('fill-opacity', f2(0.9 * clamp((t - 0.4) / 0.2)));
        num.style.opacity = f2(clamp((t - 0.45) / 0.15) * vis);
        if (note) { note.style.opacity = f2((t > 0.55 ? 1 : 0) * vis); note.style.clipPath = `inset(0 ${f1((1 - clamp((t - 0.55) / 0.3)) * 100)}% 0 0)`; }
        g.style.opacity = f2(vis);
      },
    });
    return this.handle(a, g);
  };

  /**
   * explode(parts, o): an exploded view — the parts are drafted assembled, one after another, then on the beat they slide
   * apart along their offsets, a dash-dot centre line appears through them, and each gets its numbered balloon.
   * parts: [{ d (path d or array, built from PV.BP), dx, dy (where it moves to), n (balloon number), text (its name),
   * fill, hatch, bx, by (balloon offset from the dot on the part's top edge; default 0, -95: straight above) }].
   * o: { at (start drafting), apart (time they slide apart; default when drafting ends + 0.4), dur (slide, 0.7), back (time
   * they come together again, optional), axis ([x1, y1, x2, y2] for the centre line; omit for none), color, speed }.
   * Returns { parts: [handle…], end }.
   */
  B.explode = function (parts, o = {}) {
    let t = o.at ?? 0;
    const hs = [], speed = o.speed ?? 1400;
    for (const p of parts) {
      const hd = this.draft(p.d, { at: t, speed, color: p.color || o.color, fill: p.fill, hatch: p.hatch, pen: false });
      hs.push(hd); t = hd.end - (p.hatch ? 0.4 : 0) - (p.fill ? 0.2 : 0) + 0.05;
    }
    const apart = o.apart ?? t + 0.4, dur = o.dur ?? 0.7;
    const k = (lt) => { let e = expo(clamp((lt - apart) / dur)); if (o.back != null) e *= 1 - expo(clamp((lt - o.back) / dur)); return e; };
    parts.forEach((p, i) => {
      const g = hs[i].el;
      this.tick((lt) => { const e = k(lt); g.setAttribute('transform', `translate(${f2((p.dx ?? 0) * e)} ${f2((p.dy ?? 0) * e)})`); });
    });
    if (o.axis) this.draft(`M${o.axis[0]} ${o.axis[1]}L${o.axis[2]} ${o.axis[3]}`, { at: apart + dur * 0.5, line: 'center', color: o.color || 'soft', dur: 0.5, pen: false });
    // each part's balloon, pinned to where the part settles (its box measured now, at build time)
    parts.forEach((p, i) => {
      if (p.n == null) return;
      const b = hs[i].el.getBBox();
      const at = apart + dur + 0.1 + i * 0.25;
      // the dot on the part's top edge, a little right of centre; the balloon straight above it unless told otherwise
      const px = b.x + b.width * 0.62 + (p.dx ?? 0), py = b.y + Math.min(10, b.height / 3) + (p.dy ?? 0);
      this.callout(px, py, p.n, { at, bx: px + (p.bx ?? 0), by: py + (p.by ?? -95), text: p.text, color: o.color, size: o.size ?? 30 });
    });
    return { parts: hs, end: apart + dur + 0.1 + parts.length * 0.25 + 0.75 };
  };

  /**
   * label(x, y, str, o): technical lettering — mono caps that type on with a block cursor: part names, units, "SECTION A–A",
   * "SCALE 1:20", notes on the drawing. o: { size (26; never smaller), color ('ink'), at, align 'l'|'c'|'r', no (an index
   * printed first in yellow), out }.
   */
  B.label = function (x, y, str, o = {}) {
    const el = h('div', 'tx bp-lab', null, this.html);
    el.innerHTML = (o.no ? `<span style="color:${col('yellow')}">${o.no}</span>&nbsp;&nbsp;` : '') + '<span class="t"></span>';
    Object.assign(el.style, { fontSize: (o.size ?? 26) + 'px', color: col(o.color || 'ink'), top: y + 'px' });
    const t = el.querySelector('.t');
    t.textContent = str;
    const place = () => { const w = el.offsetWidth; el.style.left = (o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px'; };
    place();
    const at = o.at ?? 0, chars = [...str], d0 = Math.max(0.2, chars.length / 55);
    let placed = false;
    const a = this.act({ at, dur: d0, g: el, kind: 'text', pen: false, apply: (k, lt, vis) => {
      if (!placed) { place(); placed = true; }
      el.style.opacity = f2((lt >= at ? 1 : 0) * vis);
      const nn = Math.round(k * chars.length);
      if (t._n !== nn) { t._n = nn; t.textContent = chars.slice(0, nn).join('') + (nn < chars.length ? '█' : ''); }
    } });
    const hnd = this.handle(a, el);
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  const MARK = { r: 'red', y: 'yellow', b: 'blue', m: 'muted', s: 'soft', g: 'green', o: 'orange', k: 'ink' };
  const markup = (str) => str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\{(\w):([^}]*)\}/g, (_, k, t) => `<span style="color:${col(MARK[k] || k)}">${t}</span>`).replace(/\n/g, '<br>');

  /**
   * word(x, y, str, o): a heading in technical lettering — two faint lettering guide lines are ruled first, then the words
   * are revealed left to right as if lettered along them. For the one or two key words of a moment, not sentences.
   * o: { size (72), color ('ink'), at, dur (0.5 + 0.04 per character), w (wrap width), align 'l'|'c'|'r', guide (true),
   * weight (700), out }. Markup: {y:word} yellow, {r:word} red, {b:word} cyan, {m:word} muted.
   */
  B.word = function (x, y, str, o = {}) {
    const size = o.size ?? 72, at = o.at ?? 0, n = [...str.replace(/\{\w:|\}/g, '')].length, dur = o.dur ?? Math.min(1.4, 0.45 + 0.04 * n);
    const el = h('div', 'tx bp-word', markup(str), this.html);
    Object.assign(el.style, { fontSize: size + 'px', color: col(o.color || 'ink'), top: y + 'px', fontWeight: o.weight ?? 700 });
    if (o.w) { el.style.whiteSpace = 'normal'; el.style.width = o.w + 'px'; }
    el.style.textAlign = { l: 'left', c: 'center', r: 'right' }[o.align || 'l'];
    const place = () => { const w = el.offsetWidth; el.style.left = (o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x) + 'px'; };
    place();
    let guides = null;
    if (o.guide !== false && !o.w) {
      guides = PV.s('svg', { class: 'bp-svg', width: STAGE.w, height: STAGE.h }, this.html);
      guides.style.zIndex = -1;
    }
    let placed = false, gl = [];
    const a = this.act({ at, dur: dur + 0.25, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
      if (!placed) {
        place(); placed = true;
        if (guides) {
          const L = el.offsetLeft - 24, R = el.offsetLeft + el.offsetWidth + 24, top = el.offsetTop;
          gl = [top + size * 0.2, top + size * 1.0].map((yy) => { const p = PV.s('path', { d: `M${L} ${f1(yy)}H${R}`, stroke: col('soft'), 'stroke-width': 1, 'stroke-opacity': 0.55, fill: 'none' }, guides); const n = R - L; p.style.strokeDasharray = `${n} ${n}`; p._n = n; return p; });
        }
      }
      const t = lt - at;
      for (const p of gl) p.style.strokeDashoffset = f1(p._n * (1 - clamp(t / 0.25)));
      if (guides) guides.style.opacity = f2((t >= 0 ? 1 : 0) * vis);
      const kr = clamp((t - 0.15) / dur);
      el.style.opacity = f2((kr > 0 ? 1 : 0) * vis);
      el.style.clipPath = `inset(-10% ${f1((1 - kr) * 100)}% -20% 0)`;
    } });
    const hnd = this.handle(a, el);
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  /**
   * outline(str, x, y, o): huge outline lettering traced by the pen — a number or a short word drawn as hollow white strokes
   * (like a stencil on a drawing), filled with a tint once traced. The big moment of a page: one per screen.
   * o: { size (300), color ('ink'), fill (tint after tracing, e.g. 'inkF', 'yellow', or false), at, dur (1.2), align
   * 'l'|'c'|'r', font 'grotesk' (default) | 'mono', sw (2.4), out }. Keep it to ≤ 6 characters.
   */
  B.outline = function (str, x, y, o = {}) {
    const size = o.size ?? 300, at = o.at ?? 0, dur = o.dur ?? 1.2;
    const svg = PV.s('svg', { class: 'bp-svg', width: STAGE.w, height: STAGE.h, viewBox: `0 0 ${STAGE.w} ${STAGE.h}` }, this.html);
    const anchor = { l: 'start', c: 'middle', r: 'end' }[o.align || 'l'];
    const fam = o.font === 'mono' ? 'var(--mono)' : 'var(--hand)';
    const mk = (attrs) => { const t = PV.s('text', Object.assign({ x, y: y + size * 0.82, 'font-size': size, 'text-anchor': anchor, style: `font-family:${fam};font-weight:700;letter-spacing:-0.01em` }, attrs), svg); t.textContent = str; return t; };
    const fillT = o.fill === false ? null : mk({ fill: col(o.fill || 'inkF'), 'fill-opacity': 0 });
    const stroke = mk({ fill: 'none', stroke: col(o.color || 'ink'), 'stroke-width': o.sw ?? 2.4, 'stroke-linejoin': 'round' });
    const N = size * [...str].length * 4.2;
    stroke.style.strokeDasharray = `${N} ${N}`;
    const a = this.act({ at, dur: dur + 0.35, g: svg, kind: 'draw', pen: false, apply: (_, lt, vis) => {
      const t = lt - at;
      stroke.style.strokeDashoffset = f1(N * (1 - clamp(t / dur)));
      svg.style.opacity = f2((t >= 0 ? 1 : 0) * vis);
      if (fillT) fillT.setAttribute('fill-opacity', f2(clamp((t - dur * 0.75) / 0.4) * (o.fillOp ?? 0.9)));
    } });
    return this.handle(a, svg);
  };

  // red pencil: a slightly wobbly, quick hand line (the only freehand thing on the sheet)
  const wob = (pts, seed) => { const r = PV.rng(seed); return 'M' + pts.map(([x, y], i) => `${f1(x + (i ? (r() - 0.5) * 3 : 0))} ${f1(y + (i ? (r() - 0.5) * 3 : 0))}`).join('L'); };
  /**
   * pencil(shape, o): a red-pencil correction on the drawing — the checker's mark: circle the problem, strike the wrong
   * value, arrow to the fix, underline the answer — with an optional handwritten note. Use for the failure point, the
   * mistake, the surprising answer; 1–2 per page at most. shape: { ring: [cx, cy, w, h] } | { strike: [x1, y1, x2, y2] } |
   * { arrow: [x1, y1, x2, y2] } | { under: [x, y, w] } | { cross: [cx, cy, size] }.
   * o: { at, dur (0.5), color ('red'), note (text in pencil handwriting), nx, ny (note position), size (note px, 44), out }.
   */
  B.pencil = function (shape, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.5, seed = this.seed();
    let d = '';
    if (shape.ring) {
      const [cx, cy, w, hh] = shape.ring, pts = [];
      for (let i = 0; i <= 44; i++) { const a = -2.4 + (i / 44) * Math.PI * 2 * 1.12; const j = 1 + (i / 44) * 0.06; pts.push([cx + Math.cos(a) * (w / 2) * j, cy + Math.sin(a) * (hh / 2) * j]); }
      d = wob(pts, seed);
    } else if (shape.strike) { const [x1, y1, x2, y2] = shape.strike; d = wob([[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2 + 3], [x2, y2]], seed) + wob([[x1, y1 + 10], [x2, y2 + 6]], seed + 1); }
    else if (shape.under) { const [x, y, w] = shape.under; d = wob([[x, y], [x + w * 0.5, y + 4], [x + w, y - 2]], seed) + wob([[x + w * 0.1, y + 10], [x + w * 0.9, y + 9]], seed + 1); }
    else if (shape.cross) { const [cx, cy, z] = shape.cross; d = wob([[cx - z, cy - z], [cx + z, cy + z]], seed) + wob([[cx + z, cy - z], [cx - z, cy + z]], seed + 1); }
    else if (shape.arrow) {
      const [x1, y1, x2, y2] = shape.arrow, ang = Math.atan2(y2 - y1, x2 - x1), L = 26;
      d = wob([[x1, y1], [(x1 + x2) / 2 - (y2 - y1) * 0.08, (y1 + y2) / 2 + (x2 - x1) * 0.08], [x2, y2]], seed)
        + wob([[x2 - L * Math.cos(ang - 0.5), y2 - L * Math.sin(ang - 0.5)], [x2, y2], [x2 - L * Math.cos(ang + 0.5), y2 - L * Math.sin(ang + 0.5)]], seed + 1);
    }
    const hd = this.draft(d, { at, dur, color: o.color || 'red', sw: o.sw ?? 4, pen: false });
    hd.el.querySelectorAll('path').forEach((p) => { p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-opacity', '0.92'); });
    if (o.note) {
      const el = h('div', 'tx bp-note', null, this.html);
      el.textContent = o.note;
      const size = o.size ?? 44;
      Object.assign(el.style, { fontSize: size + 'px', left: (o.nx ?? 0) + 'px', top: (o.ny ?? 0) + 'px', transform: 'rotate(-3deg)', color: col(o.color || 'red') });
      const n0 = at + dur * 0.8, nd = Math.max(0.35, [...o.note].length * 0.07);
      this.act({ at: n0, dur: nd, g: el, kind: 'text', pen: false, apply: (_, lt, vis) => {
        const k = clamp((lt - n0) / nd);
        el.style.opacity = f2((lt >= n0 ? 1 : 0) * vis);
        el.style.clipPath = `inset(-20% ${f1((1 - k) * 100)}% -30% 0)`;
      } });
    }
    return hd;
  };

  /**
   * flow(d, o): something moving through the drawing along a path — fluid in a pipe, current in a wire, air through a
   * vent, a part on a conveyor, data along a line. Small cyan dashes (or dots) travel along d.
   * o: { at, until (stop time; default the end of the page), speed (px/s, 260), n (how many, 6), color ('blue'), kind
   * 'dash'|'dot' (default 'dash'), size (dash length / dot radius), show (true: also draft the path itself faintly) }.
   */
  B.flow = function (d, o = {}) {
    const at = o.at ?? 0, color = col(o.color || 'blue'), n = o.n ?? 6, speed = o.speed ?? 260, kind = o.kind || 'dash';
    if (o.show) this.draft(d, { at, color: o.color || 'blue', sw: 1.4, line: 'hidden', pen: false, dur: 0.5 });
    const g = s('g', { class: 'bp' }, this.svg);
    const probe = s('path', { d, fill: 'none', stroke: 'none' }, g);
    const L = probe.getTotalLength();
    const sz = o.size ?? (kind === 'dot' ? 6 : 22);
    const els = Array.from({ length: n }, () => (kind === 'dot' ? s('circle', { r: sz, fill: color }, g) : s('path', { d: '', stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round', fill: 'none' }, g)));
    this.tick((lt) => {
      const on = lt >= at && (o.until == null || lt < o.until);
      g.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const fade = clamp((lt - at) / 0.3);
      els.forEach((el, i) => {
        const pos = ((lt - at) * speed + (i * L) / n) % L;
        const p = probe.getPointAtLength(pos);
        el.style.opacity = f2(fade);
        if (kind === 'dot') { el.setAttribute('cx', f1(p.x)); el.setAttribute('cy', f1(p.y)); }
        else { const q = probe.getPointAtLength(Math.max(0, pos - sz)); el.setAttribute('d', `M${f1(q.x)} ${f1(q.y)}L${f1(p.x)} ${f1(p.y)}`); }
      });
    });
    return { el: g };
  };

  // ── square corners, flat fills: P.box defaults to r 0 and no hatching
  const box0 = B.box;
  B.box = function (x, y, w, hh, o = {}) { return box0.call(this, x, y, w, hh, Object.assign({ r: 0, texture: false }, o)); };

  // ── the page title: a drawing's title block, top left — sheet number, title, and a drawing reference in mono
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.05;
    const idx = this.page.index + 1, tot = (window.SCRIPT?.PAGES || []).length;
    const ref = o.ref || (window.SCRIPT?.META?.name ? String(window.SCRIPT.META.name).toUpperCase() : 'DWG');
    const wrap = h('div', 'bp-tb', `<div class="no"><span class="m">${String(idx).padStart(2, '0')}/${String(tot).padStart(2, '0')}</span></div><div><span class="v tx"></span></div>`, T.html);
    wrap.querySelector('.v').textContent = str;
    const v = wrap.querySelector('.v');
    const a = T.act({ at, dur: 0.6, g: wrap, kind: 'show', pen: false, apply: (k, lt, vis) => {
      wrap.style.opacity = f2((lt >= at ? 1 : 0) * vis);
      wrap.style.clipPath = `inset(0 ${f1((1 - expo(clamp(k / 0.5))) * 100)}% 0 0)`;
      v.style.clipPath = `inset(0 ${f1((1 - clamp((k - 0.3) / 0.7)) * 100)}% 0 0)`;
    } });
    void ref;
    return Object.assign(T.handle(a, wrap), { spans: [v], box: () => ({ x: STAGE.title.x, y: STAGE.title.y - 18, w: wrap.offsetWidth, h: 80 }) });
  };
})();
