/* Isometric · kit: a tiny 30° world on a hidden grid. P.iso(...) opens a scene (a floating plate with its own grid) and
 * returns S, whose methods add things to it: blocks that extrude up from the ground with three-tone faces (top light,
 * left mid, right dark), flat tiles, paths and conveyor belts drawn along the grid, items flowing between stations,
 * tanks, trees, capsule people, isometric bar charts and floating labels on leader lines. The scene sorts its things by
 * depth every frame, so call order doesn't matter. Grid units: x runs to the lower right, y to the lower left, z up.
 * Everything is a pure function of page-local time lt. Canvas helpers for your own P.canvas drawings: PV.ISO. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const TAU = Math.PI * 2, C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);

  // ── colour ────────────────────────────────────────────
  const hex = (c) => { c = col(c) || '#ffffff'; if (c[0] !== '#') return [255, 255, 255]; const x = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const rgba = (a, al = 1) => `rgba(${a.map((v) => Math.round(v)).join(',')},${al})`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return rgba(x.map((v, i) => v + (y[i] - v) * k)); };
  /** soft tints for things (any palette name or hex also works) */
  const TINT = { white: '#FFFFFF', cloud: '#F6F7FD', sky: '#C7D5FF', mint: '#C2EEDD', lilac: '#D9D1FB', peach: '#FFD8C6', butter: '#FCE9AC', rose: '#FBD0DC', slate: '#BCC1DC', steel: '#8F95BE', night: '#3A3E73', grass: '#BFE7B5' };
  const tint = (c) => TINT[c] || col(c) || c;
  const SHADE = '#3B3F8C';
  /** the three faces of a solid of colour c: top (lit), left (mid), right (shade) */
  const faces = (c) => { c = tint(c); return { top: mix(c, '#FFFFFF', 0.18), left: mix(c, SHADE, 0.12), right: mix(c, SHADE, 0.28), edge: mix(c, '#FFFFFF', 0.65) }; };
  const pop = (lt, at, dur = 0.55) => (lt < at ? 0 : ease.back(clamp((lt - at) / dur)));
  const inK = (lt, at, dur = 0.45) => ease.out(clamp((lt - at) / dur));
  const outK = (lt, out, dur = 0.35) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));

  // ── drawing in a projected space ──────────────────────
  const poly = (c, pts, fill, stroke, lw) => {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.lineJoin = 'round'; c.stroke(); }
  };
  /** a box from (x, y, z) of size w × d × hh in grid units, with three-tone faces, a crisp light edge and optional decals */
  function box(c, pt, x, y, z, w, d, hh, color, o = {}) {
    if (hh <= 0.001 || w <= 0 || d <= 0) return;
    const f = faces(color), z1 = z + hh;
    const top = [pt(x, y, z1), pt(x + w, y, z1), pt(x + w, y + d, z1), pt(x, y + d, z1)];
    const left = [pt(x, y + d, z), pt(x + w, y + d, z), pt(x + w, y + d, z1), pt(x, y + d, z1)];
    const right = [pt(x + w, y, z), pt(x + w, y + d, z), pt(x + w, y + d, z1), pt(x + w, y, z1)];
    poly(c, left, f.left); poly(c, right, f.right); poly(c, top, o.top ? tint(o.top) : f.top);
    // decals on the side faces: windows, a door, a band of colour, a screen
    const onL = (u0, v0, u1, v1) => [pt(x + u0 * w, y + d, z + v0 * hh), pt(x + u1 * w, y + d, z + v0 * hh), pt(x + u1 * w, y + d, z + v1 * hh), pt(x + u0 * w, y + d, z + v1 * hh)];
    const onR = (u0, v0, u1, v1) => [pt(x + w, y + u0 * d, z + v0 * hh), pt(x + w, y + u1 * d, z + v0 * hh), pt(x + w, y + u1 * d, z + v1 * hh), pt(x + w, y + u0 * d, z + v1 * hh)];
    if (o.stripe) { const sc = tint(o.stripe); poly(c, onL(0, 0.78, 1, 0.92), mix(sc, SHADE, 0.05)); poly(c, onR(0, 0.78, 1, 0.92), mix(sc, SHADE, 0.22)); }
    if (o.windows) {
      const rows = o.windows.rows ?? Math.max(1, Math.round(hh * 1.6)), cl = o.windows.cols ?? Math.max(1, Math.round(w * 1.6)), cr = o.windows.cols ?? Math.max(1, Math.round(d * 1.6));
      const glass = o.windows.color ? tint(o.windows.color) : '#B9C8FF', lit = o.windows.lit ?? 0.25, rnd = PV.rng(o.seed ?? Math.round(x * 31 + y * 17));
      const top0 = o.stripe ? 0.74 : 0.9;
      for (let r = 0; r < rows; r++) {
        const v0 = 0.1 + (r / rows) * (top0 - 0.1), v1 = v0 + ((top0 - 0.1) / rows) * 0.62;
        for (let i = 0; i < cl; i++) { const u0 = 0.12 + (i / cl) * 0.76, u1 = u0 + (0.76 / cl) * 0.6; poly(c, onL(u0, v0, u1, v1), rnd() < lit ? '#FFE7A3' : mix(glass, SHADE, 0.12)); }
        for (let i = 0; i < cr; i++) { const u0 = 0.12 + (i / cr) * 0.76, u1 = u0 + (0.76 / cr) * 0.6; poly(c, onR(u0, v0, u1, v1), rnd() < lit ? '#F6D27E' : mix(glass, SHADE, 0.3)); }
      }
    }
    if (o.door) { const dw = Math.min(0.45 / w, 0.4); poly(c, onL(0.5 - dw / 2, 0, 0.5 + dw / 2, Math.min(0.55, 0.75 / hh)), mix(tint(o.door === true ? 'night' : o.door), SHADE, 0.1)); }
    if (o.screen) { poly(c, onR(0.12, 0.25, 0.88, 0.8), mix(tint(o.screen === true ? 'night' : o.screen), SHADE, 0.2)); poly(c, onR(0.2, 0.35, 0.6, 0.45), 'rgba(255,255,255,0.55)'); poly(c, onR(0.2, 0.52, 0.8, 0.6), 'rgba(255,255,255,0.35)'); }
    // a crisp light edge along the top's front rim
    c.strokeStyle = f.edge; c.lineWidth = 1.6; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(top[3][0], top[3][1]); c.lineTo(top[2][0], top[2][1]); c.lineTo(top[1][0], top[1][1]); c.stroke();
  }
  /** a vertical cylinder at (x, y) of radius r and height hh: a tank, a silo, a coin stack, a pillar */
  function cyl(c, pt, x, y, z, r, hh, color, o = {}) {
    if (hh <= 0.001 || r <= 0) return;
    const u = pt(1, 0, 0)[0] - pt(0, 0, 0)[0];   // px per unit along x, = unit × cos30
    const rx = r * u * Math.SQRT2, ry = rx * Math.tan(Math.PI / 6);
    const [bx, by] = pt(x, y, z), [tx, ty] = pt(x, y, z + hh), f = faces(color);
    const g = c.createLinearGradient(bx - rx, 0, bx + rx, 0);
    g.addColorStop(0, f.left); g.addColorStop(0.45, mix(tint(color), SHADE, 0.08)); g.addColorStop(1, f.right);
    c.fillStyle = g; c.beginPath(); c.moveTo(bx - rx, by); c.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true); c.lineTo(tx + rx, ty); c.ellipse(tx, ty, rx, ry, 0, 0, Math.PI, true); c.closePath(); c.fill();
    if (o.bands) for (let i = 1; i <= o.bands; i++) { const yy = by - (by - ty) * (i / (o.bands + 1)); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(bx, yy, rx, ry, 0, 0, Math.PI); c.stroke(); }
    c.fillStyle = o.top ? tint(o.top) : f.top; c.beginPath(); c.ellipse(tx, ty, rx, ry, 0, 0, TAU); c.fill();
    c.strokeStyle = f.edge; c.lineWidth = 1.6; c.beginPath(); c.ellipse(tx, ty, rx, ry, 0, 0, Math.PI); c.stroke();
  }
  /** a ball (a head, a canopy, a coin seen edge-on) at (x, y, z) with radius r: flat, two-tone, lit from the top left */
  function ball(c, pt, x, y, z, r, color) {
    const u = pt(1, 0, 0)[0] - pt(0, 0, 0)[0], R = r * u * 1.15, [px, py] = pt(x, y, z);
    const f = faces(color);
    c.fillStyle = f.right; c.beginPath(); c.arc(px, py, R, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(px, py, R, 0, TAU); c.clip();
    c.fillStyle = f.top; c.beginPath(); c.arc(px - R * 0.22, py - R * 0.22, R * 0.98, 0, TAU); c.fill();
    c.restore();
  }
  PV.ISO = { mix, faces, tint, box, cyl, ball, poly };

  // ── the scene ─────────────────────────────────────────
  /** iso({ x=960, y=570, unit=72, grid=[12, 9], plate=true, plateColor='white', lines=true, at=0 }) → S: a 30° isometric scene centred
   *  on (x, y) in page px. `grid` = [columns along x, rows along y]; `unit` = px per grid unit (the plate is grid × unit wide). `plate`: the
   *  floating slab the world stands on (false for a scene with no ground). Add things with S.block / S.tile / S.path / S.belt / S.flow /
   *  S.move / S.cyl / S.tree / S.person / S.bars / S.pipe / S.label; S.pt(x, y, z) → [px, py] page coordinates of a grid point (for your own
   *  labels and numbers). Things are depth-sorted every frame. Typical: unit 70–76 with grid 12×9 (the plate's front tip may dip under the subtitles; its back corner sits near the title); fill the plate densely (most cells hold something). */
  B.iso = function (o = {}) {
    const self = this, u = o.unit ?? 72, cx = o.x ?? W / 2, cy = o.y ?? (STAGE.area.y0 + STAGE.area.y1) / 2 + 40, grid = o.grid ?? [12, 9];
    const gx0 = grid[0] / 2, gy0 = grid[1] / 2, at0 = o.at ?? 0;
    const pt = (x, y, z = 0) => [cx + ((x - gx0) - (y - gy0)) * u * C30, cy + ((x - gx0) + (y - gy0)) * u * S30 - z * u];
    const items = [];   // { layer: 0 ground | 1 objects | 2 overhead, depth(lt), draw(c, lt), pts() }
    const add = (it) => { items.push(it); return it; };
    const canvas = h('canvas', null, null, self.html);
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none' });
    const ctx = canvas.getContext('2d');
    let ox = 0, oy = 0, sized = false;
    const size = () => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const it of items) for (const [px, py] of it.pts()) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      if (x0 > x1) { x0 = cx - 10; x1 = cx + 10; y0 = cy - 10; y1 = cy + 10; }
      const pad = 40;
      ox = Math.floor(x0 - pad); oy = Math.floor(y0 - pad - 60);
      canvas.width = Math.ceil(x1 + pad) - ox; canvas.height = Math.ceil(y1 + pad + 40) - oy;
      canvas.style.left = ox + 'px'; canvas.style.top = oy + 'px';
      sized = true;
    };
    self.tick((lt) => {
      if (!sized) size();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.translate(-ox, -oy);
      const list = items.map((it, i) => [it, it.layer, it.depth ? it.depth(lt) : 0, i]);
      list.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
      for (const [it] of list) { ctx.save(); it.draw(ctx, lt); ctx.restore(); }
    });

    const S = { pt, unit: u, grid, canvas };
    // the plate: a floating white slab with the grid faintly printed on it and a soft shadow beneath
    if (o.plate !== false) {
      const th = o.plateThick ?? 0.45, pc = o.plateColor ?? 'white', P0 = -0.3, P1x = grid[0] + 0.3, P1y = grid[1] + 0.3;
      add({ layer: 0, depth: () => -1e6, pts: () => [pt(P0, P0, 0), pt(P1x, P0, 0), pt(P1x, P1y, -th), pt(P0, P1y, -th), pt(P1x, P1y, -th - 1.2)],
        draw: (c, lt) => {
          const k = inK(lt, at0, 0.6); if (k <= 0) return;
          c.globalAlpha = k; c.translate(0, (1 - k) * 30);
          // shadow on the "air" below
          c.fillStyle = 'rgba(59,63,140,0.10)'; c.filter = 'blur(18px)';
          poly(c, [pt(P0 + 0.6, P0 + 0.6, -th - 1.1), pt(P1x + 0.6, P0 + 0.6, -th - 1.1), pt(P1x + 0.6, P1y + 0.6, -th - 1.1), pt(P0 + 0.6, P1y + 0.6, -th - 1.1)], 'rgba(59,63,140,0.12)');
          c.filter = 'none';
          box(c, pt, P0, P0, -th, P1x - P0, P1y - P0, th, pc);
          if (o.lines !== false) {
            c.strokeStyle = 'rgba(59,63,140,0.07)'; c.lineWidth = 1.2; c.beginPath();
            for (let i = 0; i <= grid[0]; i++) { const a = pt(i, 0, 0), b = pt(i, grid[1], 0); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
            for (let j = 0; j <= grid[1]; j++) { const a = pt(0, j, 0), b = pt(grid[0], j, 0); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
            c.stroke();
          }
        } });
    }

    /** S.block(x, y, w=1, d=1, h=1, { color='white', at, dur=0.6, out, enter='grow'|'drop', z=0, windows, door, screen, stripe, top, shadow=true }):
     *  a box standing on grid cell (x, y), w along x, d along y, h tall, extruding up from the ground at `at` (enter 'drop': falls into place).
     *  h may be a function of lt (a growing tower, a rising bar). windows: true | { rows, cols, lit, color }; door / screen: true or a colour;
     *  stripe: a colour band near the top (a brand, a shop sign). A building, a factory, a warehouse, a server, a shop, a step of a process. */
    S.block = (x, y, w = 1, d = 1, hh = 1, b = {}) => add({ layer: 1, depth: () => x + w / 2 + y + d / 2 + (b.z ?? 0) * 0.01,
      pts: () => { const H1 = typeof hh === 'function' ? 4 : hh, z = b.z ?? 0; return [pt(x, y, z + H1), pt(x + w, y, z + H1), pt(x + w, y + d, z), pt(x, y + d, z), pt(x + w + 0.8, y + d + 0.3, 0)]; },
      draw: (c, lt) => {
        const at = b.at ?? at0, k = (b.enter === 'drop' ? inK(lt, at, b.dur ?? 0.5) : pop(lt, at, b.dur ?? 0.6)) * outK(lt, b.out);
        if (k <= 0) return;
        const full = val(hh, lt), z = b.z ?? 0;
        const hk = b.enter === 'drop' ? full : full * k, zz = b.enter === 'drop' ? z + (1 - k) * 5 : z;
        if (b.enter === 'drop' || b.out != null) c.globalAlpha = clamp(k * 1.5);
        if (b.shadow !== false && z === 0) poly(c, [pt(x + 0.15, y + d, 0), pt(x + w, y + d, 0), pt(x + w + Math.min(0.9, hk * 0.45), y + d + Math.min(0.35, hk * 0.18), 0), pt(x + w + Math.min(0.9, hk * 0.45), y + Math.min(0.35, hk * 0.18) + 0.15, 0), pt(x + w, y + 0.15, 0)], 'rgba(59,63,140,0.14)');
        box(c, pt, x, y, zz, w, d, hk, b.color ?? 'white', b);
      } });

    /** S.tile(x, y, w=1, d=1, { color='lilac', at, out, z=0.02 }): a flat floor tile (a zone, a parking lot, a pad under a machine, a field).
     *  Fades and grows from its centre at `at`. */
    S.tile = (x, y, w = 1, d = 1, b = {}) => add({ layer: 0, depth: () => (b.z ?? 0.02),
      pts: () => [pt(x, y), pt(x + w, y), pt(x + w, y + d), pt(x, y + d)],
      draw: (c, lt) => {
        const k = inK(lt, b.at ?? at0, 0.45) * outK(lt, b.out); if (k <= 0) return;
        const mx = x + w / 2, my = y + d / 2, s = 0.6 + 0.4 * k, z = b.z ?? 0.02;
        c.globalAlpha = k;
        poly(c, [pt(mx - w / 2 * s, my - d / 2 * s, z), pt(mx + w / 2 * s, my - d / 2 * s, z), pt(mx + w / 2 * s, my + d / 2 * s, z), pt(mx - w / 2 * s, my + d / 2 * s, z)], tint(b.color ?? 'lilac'));
      } });

    // a polyline in grid space: its length and a point at distance s along it
    const line = (pts) => { const seg = []; let L = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; } return { L, at: (s) => { s = clamp(s, 0, L); for (let i = 0; i < seg.length; i++) { if (s <= seg[i] || i === seg.length - 1) { const k = seg[i] ? s / seg[i] : 0, a = pts[i], b = pts[i + 1]; return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), Math.atan2(b[1] - a[1], b[0] - a[0])]; } s -= seg[i]; } return [pts[0][0], pts[0][1], 0]; } }; };
    const strokeAlong = (c, pts, upto, z, width, color, dash, offset) => {
      const Ln = line(pts); if (upto <= 0) return Ln;
      c.beginPath(); let s = 0; const p0 = pt(pts[0][0], pts[0][1], z); c.moveTo(p0[0], p0[1]);
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (s + l <= upto) { const p = pt(pts[i][0], pts[i][1], z); c.lineTo(p[0], p[1]); s += l; } else { const [qx, qy] = Ln.at(upto), p = pt(qx, qy, z); c.lineTo(p[0], p[1]); break; } }
      c.strokeStyle = color; c.lineWidth = width; c.lineCap = dash ? 'butt' : 'round'; c.lineJoin = 'round';
      if (dash) { c.setLineDash(dash); c.lineDashOffset = offset || 0; }
      c.stroke(); c.setLineDash([]);
      return Ln;
    };
    /** S.path([[x, y], …], { color='muted', width=0.14, at, dur=0.9, dash, arrow=true, z=0.03, out, flow }): a route drawn along the ground,
     *  growing from its first point at `at` over `dur` s, with an arrowhead at the end. dash: true for a dotted route (a plan, a possibility).
     *  flow: true runs light dashes along it (something moving). Roads, cables, the steps of a process, money changing hands. */
    S.path = (pts, b = {}) => add({ layer: 0, depth: () => (b.z ?? 0.03) + 0.001,
      pts: () => pts.map(([x, y]) => pt(x, y, b.z ?? 0.03)),
      draw: (c, lt) => {
        const at = b.at ?? at0, k = ease.inOut(clamp((lt - at) / (b.dur ?? 0.9))) * outK(lt, b.out); if (k <= 0) return;
        const z = b.z ?? 0.03, wpx = (b.width ?? 0.14) * u, colr = col(b.color ?? 'muted');
        const Ln = line(pts), upto = Ln.L * k;
        strokeAlong(c, pts, upto, z, wpx, colr, b.dash ? [wpx * 0.3, wpx * 1.6] : null);
        if (b.flow) strokeAlong(c, pts, upto, z, wpx * 0.45, 'rgba(255,255,255,0.85)', [wpx * 0.6, wpx * 2.2], -lt * u * 1.4);
        if (b.arrow !== false && k > 0.02) {
          const [ax, ay, ang] = Ln.at(upto), s = (b.width ?? 0.14) * 2.6;
          const tip = pt(ax + Math.cos(ang) * s * 0.6, ay + Math.sin(ang) * s * 0.6, z), l = pt(ax + Math.cos(ang + 2.4) * s, ay + Math.sin(ang + 2.4) * s, z), r = pt(ax + Math.cos(ang - 2.4) * s, ay + Math.sin(ang - 2.4) * s, z);
          poly(c, [tip, l, r], colr);
        }
      } });
    /** S.belt([[x, y], …], { at, dur=0.8, speed=1, color='slate', width=0.7 }): a conveyor belt along the grid (raised a little, with rollers
     *  ticking past). Pair it with S.flow on the same points for goods riding it. */
    S.belt = (pts, b = {}) => add({ layer: 0, depth: () => 0.2,
      pts: () => pts.map(([x, y]) => pt(x, y, 0.25)),
      draw: (c, lt) => {
        const at = b.at ?? at0, k = ease.inOut(clamp((lt - at) / (b.dur ?? 0.8))); if (k <= 0) return;
        const wpx = (b.width ?? 0.7) * u, base = tint(b.color ?? 'slate'), Ln = line(pts), upto = Ln.L * k;
        strokeAlong(c, pts, upto, 0.0, wpx + 6, 'rgba(59,63,140,0.10)');
        strokeAlong(c, pts, upto, 0.18, wpx, mix(base, SHADE, 0.3));
        strokeAlong(c, pts, upto, 0.25, wpx, faces(base).top);
        strokeAlong(c, pts, upto, 0.25, wpx * 0.86, mix(base, SHADE, 0.12), [3, u * 0.32], -lt * u * 0.8 * (b.speed ?? 1));
      } });
    /** S.flow([[x, y], …], { at, count=4, speed=1.4, kind='box', color='orange', size=0.36, z=0, out, once, dur }): goods travelling a
     *  route: `count` items spaced along it, looping, `speed` grid units per second. kind: 'box' (a parcel) | 'coin' | 'doc' (a flat sheet) |
     *  'ball' (data, a customer) | 'person' | 'truck' (turns to face its route; size is ignored). once: true sends a single item from the first point to the last in `dur` s, where it stays. On a
     *  belt, set z=0.25. The style's signature move: something always flows from station to station. */
    S.flow = (pts, b = {}) => {
      const Ln = line(pts), n = b.once ? 1 : b.count ?? 4, at = b.at ?? at0, sz = b.size ?? 0.36, z0 = b.z ?? 0;
      const pos = (i, lt) => {
        if (b.once) { const k = ease.inOut(clamp((lt - at) / (b.dur ?? 2))); return Ln.at(Ln.L * k); }
        const s = ((lt - at) * (b.speed ?? 1.4) + (i * Ln.L) / n) % Ln.L;
        return Ln.at(s);
      };
      for (let i = 0; i < n; i++) add({ layer: 1, depth: (lt) => { const [x, y] = pos(i, lt); return x + y + 0.02; },
        pts: () => [],
        draw: (c, lt) => {
          if (lt < at) return;
          const [x, y, ang] = pos(i, lt);
          let a = Math.min(inK(lt, at, 0.3), outK(lt, b.out));
          if (!b.once) { const s = ((lt - at) * (b.speed ?? 1.4) + (i * Ln.L) / n) % Ln.L; a *= clamp(s / 0.35) * clamp((Ln.L - s) / 0.35); }
          if (a <= 0) return;
          c.globalAlpha = a;
          const kind = b.kind || 'box', colr = b.color ?? 'orange';
          if (kind === 'box') box(c, pt, x - sz / 2, y - sz / 2, z0, sz, sz, sz * 0.85, colr);
          else if (kind === 'doc') box(c, pt, x - sz / 2, y - sz * 0.35, z0, sz, sz * 0.7, 0.05, colr, { top: 'white' });
          else if (kind === 'coin') cyl(c, pt, x, y, z0, sz * 0.5, 0.1, colr === 'orange' ? 'yellow' : colr);
          else if (kind === 'ball') ball(c, pt, x, y, z0 + sz * 0.5, sz * 0.5, colr);
          else if (kind === 'person') person(c, x, y, colr, lt * 6 + i);
          else if (kind === 'truck') truck(c, x, y, colr, ang);
        } });
      return S;
    };
    // a little truck centred on (x, y), facing +x/-x/+y/-y (ang: travel direction in grid space)
    const truck = (c, x, y, colr, ang = 0) => {
      const ax = Math.abs(Math.cos(ang)) >= Math.abs(Math.sin(ang)), sg = ax ? Math.sign(Math.cos(ang)) || 1 : Math.sign(Math.sin(ang)) || 1;
      const L = 1.5, Wd = 0.72, cab = 0.5;
      const part = (u0, u1, z, hh, cc, o2) => { const a = Math.min(u0, u1), b2 = Math.max(u0, u1); if (ax) box(c, pt, x + a, y - Wd / 2, z, b2 - a, Wd, hh, cc, o2); else box(c, pt, x - Wd / 2, y + a, z, Wd, b2 - a, hh, cc, o2); };
      poly(c, ax ? [pt(x - L / 2, y + Wd / 2, 0), pt(x + L / 2, y + Wd / 2, 0), pt(x + L / 2 + 0.3, y + Wd / 2 + 0.15, 0), pt(x - L / 2 + 0.3, y + Wd / 2 + 0.15, 0)] : [pt(x + Wd / 2, y - L / 2, 0), pt(x + Wd / 2, y + L / 2, 0), pt(x + Wd / 2 + 0.3, y + L / 2 + 0.15, 0), pt(x + Wd / 2 + 0.3, y - L / 2 + 0.15, 0)], 'rgba(59,63,140,0.14)');
      part(-L / 2, L / 2, 0.08, 0.14, 'night');
      const back = [-sg * L / 2, sg * (L / 2 - cab - 0.06)], front = [sg * (L / 2 - cab), sg * L / 2];
      if (sg > 0) { part(back[0], back[1], 0.22, 0.72, 'white', { stripe: colr }); part(front[0], front[1], 0.22, 0.52, colr, { top: mix(tint(colr), '#FFFFFF', 0.3) }); }
      else { part(front[0], front[1], 0.22, 0.52, colr, { top: mix(tint(colr), '#FFFFFF', 0.3) }); part(back[0], back[1], 0.22, 0.72, 'white', { stripe: colr }); }
    };
    /** S.truck(x, y, { dir='x' | '-x' | 'y' | '-y', color='orange', at, out }): a parked delivery truck centred on (x, y). To drive, use
     *  S.flow with kind 'truck'. */
    S.truck = (x, y, b = {}) => add({ layer: 1, depth: () => x + y + 0.05, pts: () => [pt(x - 1, y - 1, 1), pt(x + 1, y + 1, 0)],
      draw: (c, lt) => { const k = pop(lt, b.at ?? at0, 0.45) * outK(lt, b.out); if (k <= 0) return; c.globalAlpha = clamp(k * 1.4); c.translate(0, (1 - k) * 16); truck(c, x, y, b.color ?? 'orange', { x: 0, '-x': Math.PI, y: Math.PI / 2, '-y': -Math.PI / 2 }[b.dir ?? 'x']); } });
    const person = (c, x, y, colr, ph = 0) => {
      const bob = Math.abs(Math.sin(ph)) * 0.04;
      poly(c, [pt(x - 0.16, y + 0.16, 0), pt(x + 0.3, y + 0.16, 0), pt(x + 0.44, y + 0.32, 0), pt(x - 0.02, y + 0.32, 0)], 'rgba(59,63,140,0.13)');
      cyl(c, pt, x, y, bob, 0.22, 0.52, colr);
      ball(c, pt, x, y, 0.8 + bob, 0.2, '#FFD7BE');
      const [hx, hy] = pt(x, y, 0.8 + bob), R = 0.2 * (pt(1, 0, 0)[0] - pt(0, 0, 0)[0]) * 1.15;
      c.fillStyle = mix(tint(colr), SHADE, 0.35); c.beginPath(); c.arc(hx, hy, R, Math.PI * 1.05, Math.PI * 1.95); c.fill();   // hair
    };
    /** S.person(x, y, { color='blue', at, out }): a capsule figure standing on the grid (a customer, a worker, a user). Many small ones read
     *  as a crowd. To walk, use S.flow with kind 'person'. */
    S.person = (x, y, b = {}) => add({ layer: 1, depth: () => x + y + 0.01, pts: () => [pt(x, y, 1.1), pt(x, y, 0)],
      draw: (c, lt) => { const k = pop(lt, b.at ?? at0, 0.45) * outK(lt, b.out); if (k <= 0) return; c.globalAlpha = clamp(k * 1.4); c.translate(0, (1 - k) * 18); person(c, x, y, b.color ?? 'blue', lt * 1.4 + x); } });
    /** S.cyl(x, y, r=0.5, h=1, { color='sky', at, out, bands, top }): a vertical cylinder centred on grid point (x, y): a tank, a silo, a
     *  database, a stack of coins (bands: n rings), a pillar. h may be a function of lt. */
    S.cyl = (x, y, r = 0.5, hh = 1, b = {}) => add({ layer: 1, depth: () => x + y,
      pts: () => { const H1 = typeof hh === 'function' ? 3 : hh; return [pt(x - r, y + r, H1 + r), pt(x + r, y - r, 0), pt(x + r, y + r, 0), pt(x - r, y - r, H1)]; },
      draw: (c, lt) => { const k = pop(lt, b.at ?? at0, b.dur ?? 0.6) * outK(lt, b.out); if (k <= 0) return; if (b.out != null) c.globalAlpha = clamp(k * 1.5); cyl(c, pt, x, y, b.z ?? 0, r, val(hh, lt) * k, b.color ?? 'sky', b); } });
    /** S.tree(x, y, { s=1, at, color='green' }): a lollipop tree (trunk and a round canopy). Scatter a few around a scene's edges. */
    S.tree = (x, y, b = {}) => add({ layer: 1, depth: () => x + y, pts: () => [pt(x, y, 1.3 * (b.s ?? 1)), pt(x, y, 0)],
      draw: (c, lt) => { const k = pop(lt, b.at ?? at0, 0.5); if (k <= 0) return; const s = (b.s ?? 1) * k; cyl(c, pt, x, y, 0, 0.06 * s, 0.45 * s, '#B48A6A'); ball(c, pt, x, y, 0.75 * s, 0.32 * s, b.color ?? '#7FD3A0'); } });
    /** S.bars(x, y, values, { max, w=0.8, gap=0.45, along='x', color='lilac', hi, hiColor='orange', at, stagger=0.25, unitH=4 }): an
     *  isometric bar chart: one block per value standing in a row from (x, y), the tallest `unitH` units high. hi: the index (or indices) in the
     *  accent colour. Returns the top-centre page point of each bar ([px, py]) for its label or number. */
    S.bars = (x, y, values, b = {}) => {
      const max = b.max ?? Math.max(...values), w = b.w ?? 0.8, gap = b.gap ?? 0.45, H1 = b.unitH ?? 4, hi = [].concat(b.hi ?? []);
      return values.map((v, i) => {
        const bx = b.along === 'y' ? x : x + i * (w + gap), by = b.along === 'y' ? y + i * (w + gap) : y, hh = Math.max(0.05, (v / max) * H1);
        S.block(bx, by, w, w, hh, { color: hi.includes(i) ? (b.hiColor ?? 'orange') : (b.color ?? 'lilac'), at: (b.at ?? at0) + i * (b.stagger ?? 0.25), dur: 0.7 });
        return pt(bx + w / 2, by + w / 2, hh);
      });
    };
    /** S.pipe([[x, y], …], { z=1.6, color='steel', width=0.22, at, dur=1, flow=true }): an overhead pipe or cable at height z, drawn above
     *  everything (water, power, data between buildings); flow runs bright dashes along it. */
    S.pipe = (pts, b = {}) => add({ layer: 2, depth: () => 0,
      pts: () => pts.map(([x, y]) => pt(x, y, b.z ?? 1.6)),
      draw: (c, lt) => {
        const at = b.at ?? at0, k = ease.inOut(clamp((lt - at) / (b.dur ?? 1))); if (k <= 0) return;
        const z = b.z ?? 1.6, wpx = (b.width ?? 0.22) * u, base = tint(b.color ?? 'steel'), Ln = line(pts), upto = Ln.L * k;
        strokeAlong(c, pts, upto, z, wpx, mix(base, SHADE, 0.2));
        strokeAlong(c, pts, upto, z + 0.04, wpx * 0.45, mix(base, '#FFFFFF', 0.35));
        if (b.flow !== false) strokeAlong(c, pts, upto, z + 0.02, wpx * 0.35, col(b.flowColor ?? 'orange'), [wpx * 0.5, wpx * 2.5], -lt * u * 1.6);
      } });
    /** S.label(x, y, z, text, { at, dx=0, dy=-80, color='orange', size=34, sub, out }): a floating white label card above grid point
     *  (x, y, z), joined to it by a leader line with a dot. color: the small diamond on the card; sub: a small mono line after the text
     *  (a number, a unit). Put z at the top of the thing it names (a block's h). */
    S.label = (x, y, z, text, b = {}) => { const [px, py] = pt(x, y, z); return self.isolabel(px + (b.dx ?? 0), py + (b.dy ?? -80), text, { ...b, at: b.at ?? at0, to: [px, py] }); };
    return S;
  };

  // ── labels, numbers, title ────────────────────────────
  /** isolabel(x, y, text, { to: [x, y], at, out, size=34, color='orange', sub, align='c' }): a floating white card centred on (x, y) (its
   *  bottom edge at y), with a coloured diamond and an optional small mono `sub`; `to` draws a leader down to the thing it names. */
  B.isolabel = function (x, y, text, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 34;
    let line = null, lx0 = 0, ly0 = 0;
    if (o.to) {
      line = h('canvas', null, null, this.html);
      const [tx, ty] = o.to;
      lx0 = Math.floor(Math.min(x, tx) - 16); ly0 = Math.floor(Math.min(y, ty) - 16);
      line.width = Math.ceil(Math.abs(tx - x) + 32); line.height = Math.ceil(Math.abs(ty - y) + 32);
      Object.assign(line.style, { position: 'absolute', left: lx0 + 'px', top: ly0 + 'px', pointerEvents: 'none' });
    }
    const el = h('div', 'isocard', null, this.html);
    el.innerHTML = `<i style="background:${col(o.color || 'orange')}"></i><span>${text}</span>${o.sub ? `<small>${o.sub}</small>` : ''}`;
    Object.assign(el.style, { fontSize: size + 'px', padding: `${size * 0.42}px ${size * 0.62}px ${size * 0.44}px ${size * 0.5}px` });
    const place = () => { const w = el.offsetWidth, hh = el.offsetHeight; el.style.left = (o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2) + 'px'; el.style.top = y - hh + 'px'; };
    this.tick((lt) => {
      if (!el._placed) { place(); el._placed = el.offsetWidth > 0; }
      const k = pop(lt, at + 0.15, 0.45) * outK(lt, o.out);
      el.style.opacity = clamp(k * 1.5).toFixed(3);
      const m0 = Math.min(1, 25 / size);
      el.style.transform = `translateY(${((1 - clamp(k)) * 10).toFixed(1)}px) scale(${(m0 + (1 - m0) * Math.max(0, k)).toFixed(3)})`;
      if (line) {
        const c = line.getContext('2d'); c.clearRect(0, 0, line.width, line.height);
        const lk = ease.out(clamp((lt - at) / 0.35)) * outK(lt, o.out); if (lk <= 0) return;
        const [tx, ty] = o.to, ex = lerp(tx, x, lk), ey = lerp(ty, y, lk);
        c.translate(-lx0, -ly0);
        c.strokeStyle = 'rgba(35,38,79,0.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(tx, ty); c.lineTo(ex, ey); c.stroke();
        c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(tx, ty, 9 * lk, 0, TAU); c.fill();
        c.fillStyle = col(o.color || 'orange'); c.beginPath(); c.arc(tx, ty, 5 * lk, 0, TAU); c.fill();
      }
    });
    return el;
  };
  /** isonum(x, y, lt => value, { fmt, size=120, color='ink', unit, unitColor='orange', at, out, align='c' }): a big bold number that counts
   *  (land it on the spoken word: start the count at P.cw(i, 'word') - duration). fmt(v) → string; unit is a smaller suffix in the accent. */
  B.isonum = function (x, y, fn, o = {}) {
    const size = o.size ?? 120, at = o.at ?? 0;
    const el = h('div', 'tx latin', null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', color: col(o.color || 'ink'), fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.035em' });
    const fmt = o.fmt || ((v) => Math.round(v).toLocaleString('en-US'));
    this.tick((lt) => {
      const k = pop(lt, at, 0.4) * outK(lt, o.out);
      const txt = fmt(fn(lt)) + (o.unit ? `<span style="font-size:0.4em;margin-left:0.16em;color:${col(o.unitColor || 'orange')}">${o.unit}</span>` : '');
      if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      const w = el.offsetWidth;
      el.style.left = (o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2) + 'px';
      el.style.top = y - size / 2 + 'px';
      const m0 = Math.min(1, 25 / size); el.style.opacity = clamp(k * 1.4).toFixed(3); el.style.transform = `scale(${(m0 + (1 - m0) * Math.max(0, k)).toFixed(3)})`;
    });
    return el;
  };
  // this style's page title: bold grotesk with a small isometric cube in the accent; it rises in rather than being written
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15, size = o.size ?? 44, c = col(o.accent || 'orange');
    const el = h('div', 'isotitle', null, T.html);
    const cube = `<svg width="${size * 0.7}" height="${size * 0.78}" viewBox="0 0 28 31"><path d="M14 1 L27 8.5 L14 16 L1 8.5 Z" fill="${mix(c, '#FFFFFF', 0.25)}"/><path d="M1 8.5 L14 16 L14 30 L1 22.5 Z" fill="${mix(c, SHADE, 0.08)}"/><path d="M27 8.5 L14 16 L14 30 L27 22.5 Z" fill="${mix(c, SHADE, 0.3)}"/></svg>`;
    el.innerHTML = `${cube}<span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
    el.style.fontSize = size + 'px';
    T.tick((lt) => { const k = ease.out(clamp((lt - at) / 0.5)); el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 14).toFixed(1)}px)`; });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // shapes are flat: a filled box or circle takes its fill as its outline unless a page asks for a colour
  for (const name of ['box', 'circle', 'ellipse']) {
    const f0 = B[name];
    if (f0) B[name] = function (...a) { const o = a[a.length - 1]; if (o && typeof o === 'object' && o.fill && !o.color) a[a.length - 1] = { ...o, color: o.fill }; return f0.apply(this, a); };
  }
  // text rises in as a block (no handwriting pen) unless a page asks for another mode
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.45 }, o, { pen: false })); };
})();
