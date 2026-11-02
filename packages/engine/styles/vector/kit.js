/* Flat vector science · kit: the renderers that make this style. Flat shapes with no outlines, a two-tone shade (a darker
 * crescent away from the light, a thin rim light toward it, light from the top left), soft glows only on things that
 * emit light, a twinkling sky, tiny birds for scale, and the scale journey: a log zoom through orders of magnitude.
 * Every property that changes takes a number or a function of page-local time lt; everything is a pure function of time.
 * Canvas helpers are also exposed as PV.V for your own P.canvas drawings: V.orb, V.flat, V.blob, V.glow, V.bird, V.pill, V.mix.
 * Adapted in part from huashu-art-motion (MIT, © 2026 alchaincyf): the two-tone flat fill and the bird. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const val = (v, lt, d) => (typeof v === 'function' ? v(lt) : v ?? d);
  const TAU = Math.PI * 2;
  const FONT = '"Inter Tight Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif';

  // ── colour ────────────────────────────────────────────
  const hex = (c) => { c = col(c) || '#ffffff'; if (c[0] !== '#') return [255, 255, 255]; const x = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const rgba = (a, al = 1) => `rgba(${a.map((v) => Math.round(v)).join(',')},${al})`;
  /** mix(a, b, k): colour a → b by k (0..1), any palette name or hex; returns rgb() */
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return rgba(x.map((v, i) => v + (y[i] - v) * k)); };
  const NIGHT = '#0B0526';
  const shadeOf = (c, k = 0.38) => mix(c, '#1A0B4A', k);
  const hiOf = (c, k = 0.45) => mix(c, '#FFFFFF', k);
  const pop = (lt, at, dur = 0.5) => (lt < at ? 0 : ease.back(clamp((lt - at) / dur)));
  const fadeK = (lt, at, dur = 0.4) => ease.out(clamp((lt - at) / dur));
  const outK = (lt, out, dur = 0.35) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));

  // ── canvas primitives (V) ─────────────────────────────
  const circle = (x, y, r) => { const p = new Path2D(); p.arc(x, y, Math.max(0.01, r), 0, TAU); return p; };
  /** V.flat(c, path, base, shade?, hi?, v=[10,12], w=[4,5]): two-tone flat fill of a Path2D — a shade band away from the light, a thin rim light toward it */
  function flat(c, path, base, sh, hi, v = [10, 12], w = [4, 5]) {
    base = col(base);
    c.save(); c.clip(path);
    c.fillStyle = sh || shadeOf(base); c.fill(path);
    c.save(); c.translate(-v[0], -v[1]); c.fillStyle = hi || hiOf(base); c.fill(path); c.restore();
    c.save(); c.translate(-v[0] + w[0], -v[1] + w[1]); c.fillStyle = base; c.fill(path); c.restore();
    c.restore();
  }
  /** V.glow(c, x, y, r, color, alpha=1): a soft radial light (only for things that emit light: stars, eyes, signals) */
  function glow(c, x, y, r, color, a = 1) {
    if (r <= 0 || a <= 0) return;
    const k = hex(color), g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(k, a)); g.addColorStop(0.4, rgba(k, a * 0.35)); g.addColorStop(1, rgba(k, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  /** a smooth closed blob through points (Catmull-Rom) */
  function smoothPath(pts) {
    const p = new Path2D(), n = pts.length;
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    p.closePath();
    return p;
  }
  /** V.blob(c, cx, cy, r, color, { seed, lumps=7, wobble=0.22, shade=true }): an organic flat blob (continent, cell, cloud, rock) */
  function blob(c, cx, cy, r, color, o = {}) {
    const rnd = PV.rng(o.seed ?? 7), n = o.lumps ?? 7, wob = o.wobble ?? 0.22, pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rnd() * 0.5, rr = r * (1 - wob + rnd() * wob * 2); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (o.squash ?? 1)]); }
    const p = smoothPath(pts);
    if (o.shade === false) { c.fillStyle = col(color); c.fill(p); } else flat(c, p, color, null, null, [r * 0.12, r * 0.14], [r * 0.05, r * 0.06]);
    return p;
  }

  /** V.orb(c, x, y, r, { kind, color, color2, spin, ring, seed, glow }): a flat shaded sphere.
   *  kind: 'plain' | 'earth' | 'gas' (banded giant) | 'rock' (cratered moon) | 'sun' | 'star' | 'cell' | 'atom' | 'virus' | 'drop' (water drop) */
  function orb(c, x, y, r, o = {}) {
    if (r < 0.3) return;
    const kind = o.kind || 'plain', spin = o.spin ?? 0, rnd = PV.rng(o.seed ?? 3);
    const base = col(o.color || { earth: '#2F7FE0', gas: '#E8A25C', rock: '#B8B0D8', sun: '#FFD23F', star: '#FFF4C2', cell: '#FF8FB1', atom: '#32BAEE', virus: '#FF5D73', drop: '#5FD3FF', plain: '#32BAEE' }[kind]);
    const body = circle(x, y, r);
    if (kind === 'sun' || kind === 'star' || o.glow) glow(c, x, y, r * (kind === 'sun' ? 2.6 : 2.0), o.glowColor || base, kind === 'sun' ? 0.75 : 0.55);
    if (kind === 'sun') {   // a corona: soft rings and slowly turning rays
      c.fillStyle = rgba(hex(base), 0.16); c.fill(circle(x, y, r * 1.18)); c.fillStyle = rgba(hex(base), 0.1); c.fill(circle(x, y, r * 1.38));
      c.save(); c.translate(x, y); c.rotate(spin * 0.15);
      for (let i = 0; i < 16; i++) { c.rotate(TAU / 16); c.fillStyle = rgba(hex(hiOf(base, 0.3)), i % 2 ? 0.12 : 0.2); c.beginPath(); c.moveTo(-r * 0.08, r * 1.05); c.lineTo(0, r * (i % 2 ? 1.6 : 1.95)); c.lineTo(r * 0.08, r * 1.05); c.fill(); }
      c.restore();
    }
    if (o.ring) {   // back half of the ring
      c.save(); c.strokeStyle = mix(o.ringColor || base, NIGHT, 0.35); c.lineWidth = r * 0.16;
      c.beginPath(); c.ellipse(x, y, r * 1.85, r * 0.42, -0.22, Math.PI, TAU); c.stroke(); c.restore();
    }
    if (kind === 'atom') {
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3 + 0.3;
        c.save(); c.translate(x, y); c.rotate(a);
        c.strokeStyle = rgba(hex(base), 0.55); c.lineWidth = Math.max(1, r * 0.05);
        c.beginPath(); c.ellipse(0, 0, r * 2.4, r * 0.8, 0, 0, TAU); c.stroke();
        const e = spin * (1.6 + i * 0.4) + i * 2.1;
        glow(c, Math.cos(e) * r * 2.4, Math.sin(e) * r * 0.8, r * 0.5, '#9FF3FF', 0.9);
        c.fillStyle = '#E8FDFF'; c.fill(circle(Math.cos(e) * r * 2.4, Math.sin(e) * r * 0.8, r * 0.16));
        c.restore();
      }
      const nuc = [[0, 0, '#FF5D73'], [-0.42, -0.3, '#32BAEE'], [0.45, -0.25, '#FF5D73'], [-0.2, 0.45, '#32BAEE'], [0.38, 0.4, '#FF5D73'], [0, -0.55, '#32BAEE']];
      for (const [dx, dy, cc] of nuc.slice().reverse()) flat(c, circle(x + dx * r, y + dy * r, r * 0.46), cc, null, null, [r * 0.1, r * 0.12], [r * 0.04, r * 0.05]);
      return;
    }
    c.save(); c.clip(body);
    c.fillStyle = base; c.fill(body);
    if (kind === 'earth') {
      for (let i = 0; i < 6; i++) {
        const lon = ((rnd() * 2.6 + spin * 0.18) % 2.6) - 1.3, lat = (rnd() - 0.5) * 1.3, rr = r * (0.22 + rnd() * 0.28);
        blob(c, x + lon * r, y + lat * r, rr, i % 3 === 2 ? '#E8C36A' : '#4CC27A', { seed: 11 + i, wobble: 0.3, shade: false });
      }
      c.globalAlpha = 0.85;
      for (let i = 0; i < 5; i++) { const lon = ((rnd() * 2.8 + spin * 0.3) % 2.8) - 1.4; blob(c, x + lon * r, y + (rnd() - 0.5) * 1.5 * r, r * (0.12 + rnd() * 0.12), '#FFFFFF', { seed: 40 + i, squash: 0.45, shade: false }); }
      c.globalAlpha = 1;
    } else if (kind === 'gas') {
      const c2 = col(o.color2 || '#F7D9A8');
      for (let i = -6; i <= 6; i++) {
        const yy = y + i * r * 0.17 + Math.sin(i * 1.7) * r * 0.03;
        c.fillStyle = i % 2 ? c2 : mix(base, '#7A3A2A', 0.18 + 0.1 * Math.sin(i));
        c.beginPath(); c.moveTo(x - r * 1.2, yy);
        for (let k = 0; k <= 12; k++) { const xx = x - r * 1.2 + (k / 12) * r * 2.4; c.lineTo(xx, yy + Math.sin(k * 0.9 + spin + i) * r * 0.025); }
        c.lineTo(x + r * 1.2, yy + r * 0.09); c.lineTo(x - r * 1.2, yy + r * 0.09); c.fill();
      }
      const sx = x + (((spin * 0.25 + 0.3) % 2) - 1) * r * 1.1;
      c.fillStyle = '#D9583A'; c.beginPath(); c.ellipse(sx, y + r * 0.32, r * 0.2, r * 0.11, 0, 0, TAU); c.fill();
    } else if (kind === 'rock') {
      for (let i = 0; i < 9; i++) {
        const cx = x + (rnd() - 0.5) * 1.7 * r, cy = y + (rnd() - 0.5) * 1.7 * r, rr = r * (0.08 + rnd() * 0.16);
        c.fillStyle = mix(base, '#2A1F6A', 0.3); c.fill(circle(cx, cy, rr));
        c.fillStyle = mix(base, '#FFFFFF', 0.25); c.fill(circle(cx - rr * 0.18, cy - rr * 0.18, rr * 0.82));
        c.fillStyle = mix(base, '#2A1F6A', 0.18); c.fill(circle(cx + rr * 0.06, cy + rr * 0.06, rr * 0.78));
      }
    } else if (kind === 'sun' || kind === 'star') {
      c.fillStyle = hiOf(base, 0.55); c.fill(circle(x - r * 0.12, y - r * 0.12, r * 0.78));
      for (let i = 0; i < 10; i++) { const a = rnd() * TAU + spin * 0.2, d = r * rnd() * 0.8; c.fillStyle = rgba(hex(mix(base, '#FF7A00', 0.35)), 0.5); c.fill(circle(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.06 + rnd() * 0.08))); }
    } else if (kind === 'cell') {
      c.fillStyle = mix(base, '#FFFFFF', 0.35); c.fill(circle(x, y, r * 0.86));
      for (let i = 0; i < 8; i++) { const a = rnd() * TAU + spin * 0.15 * (i % 2 ? 1 : -1), d = r * (0.35 + rnd() * 0.35); blob(c, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.07 + rnd() * 0.06), i % 2 ? '#7EE0A8' : '#FFC24B', { seed: 60 + i, shade: false, squash: 0.6 }); }
      flat(c, circle(x + r * 0.08, y + r * 0.04, r * 0.32), '#8C5BFF', null, null, [r * 0.05, r * 0.06], [r * 0.02, r * 0.02]);
    } else if (kind === 'virus') {
      c.fillStyle = mix(base, '#FFFFFF', 0.2);
      for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = r * rnd() * 0.7; c.fill(circle(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.12)); }
    } else if (kind === 'drop') {
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.12, -0.6, 0, TAU); c.fill();
    }
    // two-tone shade: a crescent away from the light and a thin rim light toward it
    const d = r * 0.3;
    c.fillStyle = rgba(hex('#14063E'), kind === 'sun' || kind === 'star' ? 0.12 : 0.42);
    const cres = new Path2D(); cres.addPath(circle(x, y, r * 1.02)); cres.addPath(circle(x - d * 0.55, y - d * 0.65, r * 1.0)); c.fill(cres, 'evenodd');
    c.fillStyle = 'rgba(255,255,255,0.32)';
    const rim = new Path2D(); rim.addPath(circle(x, y, r * 1.02)); rim.addPath(circle(x + r * 0.07, y + r * 0.08, r * 1.0)); c.fill(rim, 'evenodd');
    c.restore();
    if (kind === 'virus') {   // spikes outside the body
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + spin * 0.1, x1 = x + Math.cos(a) * r, y1 = y + Math.sin(a) * r, x2 = x + Math.cos(a) * r * 1.32, y2 = y + Math.sin(a) * r * 1.32;
        c.strokeStyle = shadeOf(base, 0.2); c.lineWidth = r * 0.08; c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.fillStyle = '#FFD23F'; c.fill(circle(x2, y2, r * 0.1));
      }
    }
    if (o.ring) {   // front half of the ring
      c.save(); c.strokeStyle = col(o.ringColor || hiOf(base, 0.3)); c.lineWidth = r * 0.16;
      c.beginPath(); c.ellipse(x, y, r * 1.85, r * 0.42, -0.22, 0, Math.PI); c.stroke(); c.restore();
    }
  }

  /** V.bird(c, x, y, s=1, { color, face=1 (1 right, -1 left), t, phase }): the round little bird with big eyes — the scale reference */
  function bird(c, x, y, s = 1, o = {}) {
    const base = col(o.color || '#FF5D8F'), sh = shadeOf(base, 0.3), t = o.t ?? 0;
    c.save(); c.translate(x, y); c.scale((o.face ?? 1) * s, s);
    const fl = Math.sin((t + (o.phase ?? 0)) * TAU / 0.36);
    c.fillStyle = sh; c.beginPath(); c.moveTo(-6, -6); c.lineTo(-30, -6 - 34 * fl); c.lineTo(-44, -2 - 30 * fl); c.lineTo(-14, 8); c.closePath(); c.fill();
    flat(c, (() => { const p = new Path2D(); p.ellipse(0, 0, 30, 24, 0, 0, TAU); return p; })(), base, sh, hiOf(base, 0.4), [5, 5], [2, 2]);
    c.fillStyle = '#FFF1F5'; c.beginPath(); c.ellipse(6, 8, 18, 12, 0, 0, TAU); c.fill();
    c.fillStyle = '#FFB02E'; c.beginPath(); c.moveTo(26, -4); c.lineTo(44, 2); c.lineTo(26, 8); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.fill(circle(12, -6, 9)); c.fillStyle = '#1D1640'; c.fill(circle(15, -5, 5)); c.fillStyle = '#fff'; c.fill(circle(13.5, -7, 1.8));
    c.fillStyle = base; c.beginPath(); c.moveTo(-26, -4); c.lineTo(-44, -12); c.lineTo(-40, 6); c.closePath(); c.fill();
    c.restore();
  }

  /** V.pill(c, x, y, text, { size=30, color='ink' (fill), ink='#170B44' (text), align='c' }): a rounded label drawn on canvas */
  function pill(c, x, y, text, o = {}) {
    const size = o.size ?? 30;
    c.save(); c.font = `800 ${size}px ${FONT}`;
    const w = c.measureText(text).width + size * 1.1, hh = size * 1.6;
    const x0 = o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2;
    c.fillStyle = col(o.color || 'ink'); c.beginPath(); c.roundRect(x0, y - hh / 2, w, hh, hh / 2); c.fill();
    c.fillStyle = col(o.ink || '#170B44'); c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(text, x0 + w / 2, y + size * 0.04);
    c.restore();
  }

  /** V.rect(c, x, y, w, h, color, r=8): a flat rounded block with the two-tone shade (buildings, bars, cards, machines) */
  function rect(c, x, y, w, hh, color, r = 8) {
    const p = new Path2D(); p.roundRect(x, y, w, hh, Math.min(r, w / 2, hh / 2));
    const m = Math.min(w, hh);
    flat(c, p, color, null, null, [m * 0.14, m * 0.1], [m * 0.06, m * 0.04]);
    return p;
  }
  /** V.tree(c, x, y, s=1, { color, seed }): a flat round tree standing on (x, y) — canopy of three shaded lumps, a short trunk */
  function tree(c, x, y, s = 1, o = {}) {
    const cc = col(o.color || '#2FA35A');
    c.fillStyle = '#7A4A3A'; c.beginPath(); c.roundRect(x - 9 * s, y - 70 * s, 18 * s, 70 * s, 6 * s); c.fill();
    const rnd = PV.rng(o.seed ?? 1);
    for (const [dx, dy, r] of [[-30, -100, 44], [28, -104, 46], [0, -140, 52]]) flat(c, circle(x + dx * s * (0.9 + rnd() * 0.2), y + dy * s, r * s), cc, null, null, [10 * s, 12 * s], [4 * s, 5 * s]);
  }
  /** V.cloud(c, x, y, s=1, { color='#FFFFFF', alpha=1 }): a flat puffy cloud centred on (x, y) */
  function cloud(c, x, y, s = 1, o = {}) {
    c.save(); c.globalAlpha *= o.alpha ?? 1;
    const cc = col(o.color || '#FFFFFF'), p = new Path2D();
    for (const [dx, dy, r] of [[-70, 10, 42], [-20, -18, 58], [40, -6, 50], [86, 14, 36]]) p.addPath(circle(x + dx * s, y + dy * s, r * s));
    p.rect(x - 70 * s, y + 10 * s, 156 * s, 40 * s);
    c.fillStyle = mix(cc, '#7FA8E0', 0.22); c.fill(p);
    c.save(); c.translate(-6 * s, -10 * s); c.fillStyle = cc; c.fill(p); c.restore();
    c.restore();
  }

  PV.V = { orb, flat, blob, glow, bird, pill, mix, circle, smoothPath, rect, tree, cloud };

  // a canvas that stays put in the page (covers past the frame so camera pans never show an edge)
  function stageCanvas(self, draw, o = {}) {
    const pad = o.pad ?? 0, w = W + pad * 2, hh = H + pad * 2;
    const c = h('canvas', null, null, self.html);
    c.width = w; c.height = hh;
    Object.assign(c.style, { position: 'absolute', left: -pad + 'px', top: -pad + 'px', pointerEvents: 'none' });
    const ctx = c.getContext('2d');
    self.tick((lt) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, hh); ctx.translate(pad, pad); draw(ctx, lt); });
    return c;
  }

  // a canvas that follows one object: box(lt) → [cx, cy, half] or null (hidden); draw paints in page coordinates. Sized to the
  // object so the page check counts it as content (a full-frame canvas reads as a background)
  function objCanvas(self, box, draw) {
    const c = h('canvas', null, null, self.html);
    Object.assign(c.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
    const ctx = c.getContext('2d');
    let size = 0;
    self.tick((lt) => {
      const b = box(lt);
      if (!b) { c.style.display = 'none'; return; }
      const [x, y, half] = b, need = Math.ceil(half * 2 / 64) * 64 + 64;
      if (need > size) { size = need; c.width = c.height = size; }
      c.style.display = 'block';
      const x0 = Math.round(x - size / 2), y0 = Math.round(y - size / 2);
      c.style.left = x0 + 'px'; c.style.top = y0 + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, size, size); ctx.translate(-x0, -y0);
      draw(ctx, lt);
    });
    return c;
  }

  // ── sky ───────────────────────────────────────────────
  const MOODS = {
    space: ['#05020F', '#0E0631', '#22125E'],
    night: ['#0B0526', '#1A0F5C', '#3A1F86'],
    dawn: ['#1A0B4A', '#7A2A86', '#FF8A5B'],
    day: ['#2C9BEF', '#79CCFF', '#D6F3FF'],
    ocean: ['#032240', '#06457A', '#0D78A8'],
    cell: ['#3A0A3E', '#7A1E5E', '#C2457A'],
    forest: ['#0A2A2A', '#145C4A', '#3A9A6A'],
    ember: ['#1A0610', '#5C1630', '#C2452F'],
  };
  /** vsky({ mood, stars=true, horizon, hills, at=0, nebula }): the page's full-bleed backdrop, behind everything (call it first).
   *  mood: 'space' | 'night' | 'dawn' | 'day' | 'ocean' | 'cell' | 'forest' | 'ember' (each a whole palette; change mood when the scene changes).
   *  stars: twinkling star field (default on for space/night/dawn). nebula: soft coloured clouds (space). horizon: a planet's curved limb rising
   *  from the bottom, { color, y=860 } (y = top of the curve at centre). hills: three layers of rolling flat hills, { color, y=760, trees: true,
   *  treeColor } (day / forest / night / dawn). clouds: true or a count — drifting flat clouds (bright by day, faint at night). */
  B.vsky = function (o = {}) {
    const mood = o.mood || 'space', g = MOODS[mood] || MOODS.space;
    const starry = o.stars ?? ['space', 'night', 'dawn'].includes(mood);
    const rnd = PV.rng(o.seed ?? 99), stars = [];
    for (let i = 0; i < 260; i++) stars.push([rnd() * (W + 600) - 300, rnd() * (H + 400) - 200, 0.6 + rnd() * rnd() * 2.6, rnd() * TAU, 0.6 + rnd() * 2.2]);
    const motes = [];
    for (let i = 0; i < 60; i++) motes.push([rnd() * (W + 600) - 300, rnd() * (H + 400) - 200, 1 + rnd() * 3, rnd() * TAU]);
    return stageCanvas(this, (c, lt) => {
      const k = fadeK(lt, o.at ?? 0, 0.5);
      c.globalAlpha = k;
      const gr = c.createLinearGradient(0, -300, 0, H + 300);
      gr.addColorStop(0, g[0]); gr.addColorStop(0.55, g[1]); gr.addColorStop(1, g[2]);
      c.fillStyle = gr; c.fillRect(-300, -300, W + 600, H + 600);
      if (o.nebula ?? mood === 'space') {
        glow(c, W - 520, 260, 760, '#6B2FD6', 0.4); glow(c, 380, H - 300, 620, '#D6338C', 0.28); glow(c, W / 2 - 60 + Math.sin(lt * 0.2) * 30, H / 2 - 20, 500, '#2A6BE0', 0.16);
      }
      if (starry) for (const [x, y, r, ph, sp] of stars) {
        const tw = 0.55 + 0.45 * Math.sin(lt * sp + ph);
        c.fillStyle = `rgba(255,255,255,${(0.25 + 0.6 * tw).toFixed(3)})`; c.fill(circle(x, y, r));
        if (r > 2.4) { c.strokeStyle = `rgba(255,255,255,${(0.35 * tw).toFixed(3)})`; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - r * 3, y); c.lineTo(x + r * 3, y); c.moveTo(x, y - r * 3); c.lineTo(x, y + r * 3); c.stroke(); }
      } else for (const [x, y, r, ph] of motes) {   // underwater / inside a body: drifting motes
        const yy = ((y - lt * 18 + ph * 40) % (H + 400) + H + 400) % (H + 400) - 200;
        c.fillStyle = 'rgba(255,255,255,0.14)'; c.fill(circle(x + Math.sin(lt * 0.6 + ph) * 12, yy, r));
      }
      if (o.hills) {
        const hc = col(o.hills.color || (mood === 'day' ? '#4EA83F' : mood === 'forest' ? '#1E7A4E' : '#2B1F86')), hy = o.hills.y ?? STAGE.area.y1 - 120;
        const ridge = (x, j) => hy - (2 - j) * 70 + Math.sin(x * (0.0026 + j * 0.0011) + j * 2.1) * (52 - j * 8) + Math.sin(x * 0.009 + j) * 16;
        for (let j = 0; j < 3; j++) {
          const cc = j === 2 ? hc : mix(hc, g[1], 0.62 - j * 0.28);
          c.fillStyle = cc; c.beginPath(); c.moveTo(-300, ridge(-300, j));
          for (let x = -300; x <= W + 300; x += 30) c.lineTo(x, ridge(x, j));
          c.lineTo(W + 300, H + 300); c.lineTo(-300, H + 300); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.10)'; c.beginPath(); c.moveTo(-300, ridge(-300, j));
          for (let x = -300; x <= W + 300; x += 30) c.lineTo(x, ridge(x, j));
          for (let x = W + 300; x >= -300; x -= 30) c.lineTo(x, ridge(x, j) + 9);
          c.fill();
          if (o.hills.trees && j > 0) { const rr = PV.rng(31 + j); for (let i = 0; i < (j === 1 ? 14 : 7); i++) { const x = -200 + rr() * (W + 400); tree(c, x, ridge(x, j) + 18, j === 1 ? 0.45 : 0.9, { color: mix(o.hills.treeColor || (mood === 'day' ? '#2F8F3C' : '#3A2C9E'), g[1], j === 1 ? 0.35 : 0), seed: i }); } }
        }
      }
      if (o.clouds) { const rr = PV.rng(77); for (let i = 0; i < (o.clouds === true ? 5 : o.clouds); i++) { const x = ((rr() * (W + 600) + lt * (10 + rr() * 14)) % (W + 600)) - 300; cloud(c, x, 120 + rr() * 300, 0.6 + rr() * 0.9, { alpha: mood === 'day' ? 1 : 0.25 }); } }
      if (o.horizon) {
        const hc = col(o.horizon.color || '#2F7FE0'), top = o.horizon.y ?? STAGE.area.y1 - 20, R = 2600;
        glow(c, W / 2, top + R, R + 140, o.horizon.glow || '#7FD7FF', 0.0);
        c.fillStyle = rgba(hex(o.horizon.glow || '#7FD7FF'), 0.35); c.fill(circle(W / 2, top + R, R + 26));
        c.fillStyle = rgba(hex(o.horizon.glow || '#7FD7FF'), 0.25); c.fill(circle(W / 2, top + R, R + 60));
        flat(c, circle(W / 2, top + R, R), hc, null, null, [0, -40], [0, -14]);
      }
      c.globalAlpha = 1;
    }, { pad: 300 });
  };

  // ── objects ───────────────────────────────────────────
  /** vorb(cx, cy, r, { kind, color, color2, ring, glow, at, dur=0.55, out, spin, seed }): a flat shaded sphere that pops in at `at`
   *  (overshoot, no outline). cx, cy, r and spin may be functions of lt (spin defaults to slow rotation for earth/gas/cell/atom).
   *  kind: 'plain' | 'earth' | 'gas' | 'rock' | 'sun' | 'star' | 'cell' | 'atom' | 'virus' | 'drop'. Use it for planets, moons, stars,
   *  cells, atoms, viruses, drops, and as the round body of anything (a coin, a ball, a head). */
  B.vorb = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0, kind = o.kind || 'plain';
    const m = kind === 'sun' ? 2.7 : kind === 'atom' ? 2.6 : o.ring ? 1.95 : kind === 'star' || o.glow ? 2.1 : kind === 'virus' ? 1.45 : 1.08;
    const k = (lt) => pop(lt, at, o.dur ?? 0.55) * outK(lt, o.out);
    return objCanvas(this, (lt) => (k(lt) > 0 ? [val(cx, lt), val(cy, lt), val(r, lt) * Math.max(1, k(lt)) * m] : null), (c, lt) => {
      const spin = o.spin != null ? val(o.spin, lt) : lt * 0.6;
      orb(c, val(cx, lt), val(cy, lt), val(r, lt) * k(lt), { ...o, spin });
    });
  };

  /** vblob(cx, cy, r, { color, seed, lumps, wobble, squash, at, out, float }): an organic flat shape with two-tone shading (a rock, a cloud,
   *  a continent, an organ, a puddle) that pops in at `at`. cx, cy, r may be functions of lt; float: px of slow bobbing. */
  B.vblob = function (cx, cy, r, o = {}) {
    const at = o.at ?? 0;
    const k = (lt) => pop(lt, at, o.dur ?? 0.5) * outK(lt, o.out);
    const fy = (lt) => (o.float ? Math.sin(lt * 1.3 + (o.seed ?? 0)) * o.float : 0);
    return objCanvas(this, (lt) => (k(lt) > 0 ? [val(cx, lt), val(cy, lt) + fy(lt), val(r, lt) * Math.max(1, k(lt)) * (1 + (o.wobble ?? 0.22)) * 1.1] : null), (c, lt) => {
      blob(c, val(cx, lt), val(cy, lt) + fy(lt), val(r, lt) * k(lt), o.color || 'blue', o);
    });
  };

  /** vbird(x, y, s=1, { color, face=1, at, out, path }): a flapping little bird (the style's mascot and scale reference). x, y may be functions
   *  of lt, or path: lt => [x, y, face]. It hops in at `at`. Put one beside any big thing to show how big it is. */
  B.vbird = function (x, y, s = 1, o = {}) {
    const at = o.at ?? 0;
    const k = (lt) => pop(lt, at, 0.45) * outK(lt, o.out);
    const pos = (lt) => { let px = val(x, lt), py = val(y, lt), face = o.face ?? 1; if (o.path) { const q = o.path(lt); px = q[0]; py = q[1]; if (q[2] != null) face = q[2]; } return [px, py + Math.sin(lt * 4 + (o.phase ?? 0)) * 6 * s, face]; };
    return objCanvas(this, (lt) => { if (k(lt) <= 0) return null; const [px, py] = pos(lt); return [px, py, 60 * s * Math.max(1, k(lt))]; }, (c, lt) => {
      const [px, py, face] = pos(lt);
      bird(c, px, py, s * k(lt), { color: o.color, face, t: lt, phase: o.phase });
    });
  };

  /** vtree(x, y, s=1, { color, at, sway=true }): a flat round tree standing on (x, y) that pops up from the ground; s=1 is ~190 px tall. */
  B.vtree = function (x, y, s = 1, o = {}) {
    const at = o.at ?? 0, k = (lt) => pop(lt, at, 0.5) * outK(lt, o.out);
    return objCanvas(this, (lt) => (k(lt) > 0 ? [x, y - 100 * s, 130 * s * Math.max(1, k(lt))] : null), (c, lt) => {
      c.save(); c.translate(x, y); c.rotate(o.sway === false ? 0 : Math.sin(lt * 1.1 + x) * 0.02); c.scale(1, k(lt)); tree(c, 0, 0, s, o); c.restore();
    });
  };

  /** vcity(x, y, w, { h=260, n=12, colors, windows=true, at, seed }): a flat skyline standing on the line y from x to x+w — buildings rise
   *  one after another from `at`, lit windows flicker. Good for "people", "society", "a city of a million". */
  B.vcity = function (x, y, w, o = {}) {
    const at = o.at ?? 0, n = o.n ?? 12, hh = o.h ?? 260, rnd = PV.rng(o.seed ?? 9), cols = (o.colors || ['#5B46D6', '#3A2C9E', '#7A5CF0', '#32BAEE']).map(col);
    const bs = []; let cx = x;
    for (let i = 0; i < n; i++) { const bw = (w / n) * (0.7 + rnd() * 0.5), bh = hh * (0.35 + rnd() * 0.65); bs.push([cx, bw * 0.92, bh, cols[i % cols.length], rnd()]); cx += w / n; }
    const mk = PV.s('svg', { width: w, height: hh, style: `position:absolute;left:${x}px;top:${y - hh}px;pointer-events:none` }, this.html);
    PV.s('rect', { x: 0, y: 0, width: w, height: hh, fill: 'transparent' }, mk);
    return stageCanvas(this, (c, lt) => {
      bs.forEach(([bx, bw, bh, cc, r], i) => {
        const k = ease.out(clamp((lt - at - i * 0.06) / 0.5)) * outK(lt, o.out);
        if (k <= 0) return;
        const h1 = bh * k;
        rect(c, bx, y - h1, bw, h1, cc, 6);
        if (o.windows !== false && k >= 1) for (let wy = y - h1 + 18; wy < y - 16; wy += 26) for (let wx = bx + 10; wx < bx + bw - 14; wx += 20) {
          const on = Math.sin(wx * 12.9 + wy * 78.2 + Math.floor(lt * 0.7 + r * 5)) > 0.2;
          if (on) { c.fillStyle = 'rgba(255,214,120,0.85)'; c.fillRect(wx, wy, 8, 12); }
        }
      });
    });
  };

  /** vfore({ kind, color, at }): a big foreground layer cut by the frame edges, in front of everything else on the page (call it last) — the
   *  depth that makes a frame cinematic. kind: 'rocks' (huge rounded boulders in both bottom corners) | 'crater' (a curved moon surface along
   *  the bottom with craters) | 'plants' (dark fronds and leaves reaching in from the corners) | 'reef' (coral and kelp, underwater) |
   *  'dunes' (sand dunes) | 'clouds' (thick clouds across the bottom, seen from above). It slides up into place at `at` and sways gently. */
  B.vfore = function (o = {}) {
    const kind = o.kind || 'rocks', at = o.at ?? 0, base = col(o.color || { rocks: '#2A1F6E', crater: '#4A3F8E', plants: '#123F3A', reef: '#7A2A6E', dunes: '#C27A3A', clouds: '#E8E4FF' }[kind]);
    const mk = PV.s('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;pointer-events:none' }, this.html);
    const yb = H - 1080, xr = W - 1920;   // the foreground hugs the bottom corners of the stage
    PV.s('rect', { x: 0, y: 820 + yb, width: 400, height: 60, fill: 'transparent' }, mk);
    return stageCanvas(this, (c, lt) => {
      const k = ease.out(clamp((lt - at) / 0.7)), dy = (1 - k) * 260;
      if (k <= 0) return;
      c.save(); c.translate(0, dy + yb);
      const sw = Math.sin(lt * 0.9) * 0.025;
      if (kind === 'rocks') {
        blob(c, 120, 1060, 300, base, { seed: 3, lumps: 8, wobble: 0.16, squash: 0.7 });
        blob(c, 1860 + xr, 1100, 360, mix(base, '#000', 0.1), { seed: 8, lumps: 8, wobble: 0.15, squash: 0.62 });
        blob(c, 380, 1110, 160, mix(base, '#fff', 0.08), { seed: 13, lumps: 7, wobble: 0.2, squash: 0.7 });
      } else if (kind === 'crater') {
        const R = 3400, cy0 = 880 + R;
        flat(c, circle(W / 2, cy0, R), base, null, null, [0, -26], [0, -10]);
        const rr = PV.rng(4);
        for (let i = 0; i < 9; i++) { const x = -100 + rr() * (W + 200), y = 915 + rr() * 110, w = 50 + rr() * 110; c.fillStyle = mix(base, '#140A3E', 0.35); c.beginPath(); c.ellipse(x, y, w, w * 0.22, 0, 0, TAU); c.fill(); c.fillStyle = mix(base, '#fff', 0.15); c.beginPath(); c.ellipse(x, y + w * 0.05, w * 0.9, w * 0.16, 0, 0, Math.PI); c.fill(); }
      } else if (kind === 'plants' || kind === 'reef') {
        const leaf = (x, y, len, a, cc) => { c.save(); c.translate(x, y); c.rotate(a + sw * (1 + len / 400)); const p = new Path2D(); p.moveTo(0, 0); p.quadraticCurveTo(len * 0.35, -len * 0.22, len, 0); p.quadraticCurveTo(len * 0.35, len * 0.22, 0, 0); flat(c, p, cc, null, null, [0, 10], [0, 4]); c.restore(); };
        const c1 = base, c2 = mix(base, kind === 'reef' ? '#FF8A5B' : '#2FA35A', 0.35);
        for (const [x, y, len, a, cc] of [[-40, 1120, 520, -1.0, c1], [40, 1140, 460, -0.6, c2], [-60, 980, 380, -0.25, c1], [1960 + xr, 1120, 540, -2.2, c1], [1880 + xr, 1160, 440, -2.6, c2], [1980 + xr, 960, 360, -2.95, c1]]) leaf(x, y, len, a, cc);
        if (kind === 'reef') for (let i = 0; i < 5; i++) blob(c, 200 + i * 360 + (i % 2) * 120, 1080, 70 + (i % 3) * 30, ['#FF5D73', '#FFA62B', '#A07CFF'][i % 3], { seed: 20 + i, lumps: 9, wobble: 0.35 });
      } else if (kind === 'dunes') {
        for (let j = 0; j < 2; j++) { c.fillStyle = mix(base, '#000', j * 0.12); c.beginPath(); c.moveTo(-50, 1100); for (let x = -50; x <= W + 50; x += 30) c.lineTo(x, 930 + j * 60 + Math.sin(x * 0.003 + j * 2) * 50); c.lineTo(W + 50, 1100); c.fill(); }
      } else if (kind === 'clouds') {
        for (let i = 0; i < 9; i++) cloud(c, -120 + i * 260 + (i % 2) * 60 + Math.sin(lt * 0.3 + i) * 12, 1010 + (i % 3) * 30, 1.6 + (i % 2) * 0.5, { color: base });
      }
      c.restore();
    }, { pad: 0 });
  };

  /** vlabel(x, y, text, { to:[x,y], color='ink', ink, size=30, at, out, align='c' }): a rounded pill label that pops in; with `to` it draws a
   *  thin leader line and a dot from the pill to the thing it names. The way to name things in this style (never a boxed caption). */
  B.vlabel = function (x, y, text, o = {}) {
    const at = o.at ?? 0, size = o.size ?? 30;
    const el = h('div', 'vpill', null, this.html);
    el.textContent = text;
    const bg = col(o.color || 'ink');
    Object.assign(el.style, { fontSize: size + 'px', padding: `${size * 0.32}px ${size * 0.62}px ${size * 0.36}px`, background: bg, color: col(o.ink || (hex(bg).reduce((a, b) => a + b) > 450 ? '#170B44' : '#FFFFFF')) });
    const place = () => {
      const w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = (o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2) + 'px';
      el.style.top = y - hh / 2 + 'px';
    };
    let line = null;
    if (o.to) {
      line = h('canvas', null, null, this.html);
      line.width = W; line.height = H;
      Object.assign(line.style, { position: 'absolute', left: '0px', top: '0px', pointerEvents: 'none' });
      this.html.insertBefore(line, el);
    }
    this.tick((lt) => {
      if (!el._placed) { place(); el._placed = el.offsetWidth > 0; }
      const k = pop(lt, at, 0.45) * outK(lt, o.out);
      el.style.opacity = clamp(k * 1.5).toFixed(3);
      const m0 = Math.min(1, 25 / size);   // never smaller than a readable size, even mid-entrance
      el.style.transform = `scale(${(m0 + (1 - m0) * Math.max(0, k)).toFixed(3)})`;
      if (line) {
        const c = line.getContext('2d'); c.clearRect(0, 0, W, H);
        const lk = clamp((lt - at) / 0.35);
        if (lk <= 0) return;
        const [tx, ty] = o.to, ex = lerp(x, tx, ease.out(lk)), ey = lerp(y, ty, ease.out(lk));
        c.globalAlpha = outK(lt, o.out); c.strokeStyle = rgba(hex(bg), 0.85); c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
        c.fillStyle = bg; c.fill(circle(tx, ty, 8 * lk)); c.fillStyle = rgba(hex(bg), 0.25); c.fill(circle(tx, ty, 18 * lk));
      }
    });
    return el;
  };

  /** vfield({ kind='motes'|'sparks'|'snow'|'bubbles', color, n=70, at }): an ambient layer that never stops moving (drifting motes, rising
   *  sparks, bubbles). Keep it subtle; it is what makes a held frame feel alive. */
  B.vfield = function (o = {}) {
    const rnd = PV.rng(o.seed ?? 5), n = o.n ?? 70, kind = o.kind || 'motes', parts = [];
    for (let i = 0; i < n; i++) parts.push([rnd() * (W + 200) - 100, rnd() * (H + 200) - 100, 1.5 + rnd() * 4, rnd() * TAU, 0.4 + rnd()]);
    const cc = col(o.color || (kind === 'sparks' ? 'orange' : 'ink'));
    return stageCanvas(this, (c, lt) => {
      const k = fadeK(lt, o.at ?? 0, 0.8);
      for (const [x, y, r, ph, sp] of parts) {
        const dy = kind === 'snow' ? lt * 40 * sp : kind === 'motes' ? Math.sin(lt * 0.5 * sp + ph) * 20 : -lt * 60 * sp;
        const yy = ((y + dy) % (H + 200) + H + 200) % (H + 200) - 100, xx = x + Math.sin(lt * sp + ph) * 16;
        const a = (kind === 'sparks' ? 0.5 + 0.5 * Math.sin(lt * 6 * sp + ph) : 0.35) * k;
        if (kind === 'sparks') glow(c, xx, yy, r * 4, cc, a * 0.6);
        if (kind === 'bubbles') { c.strokeStyle = rgba(hex(cc), a); c.lineWidth = 2; c.beginPath(); c.arc(xx, yy, r * 2, 0, TAU); c.stroke(); }
        else { c.fillStyle = rgba(hex(cc), a); c.fill(circle(xx, yy, r * (kind === 'motes' ? 0.7 : 1))); }
      }
    }, { pad: 200 });
  };

  /** vjourney(levels, { keys, factor=10, sky=true, counter=true, at }): THE signature shot — a continuous log zoom through orders of magnitude,
   *  every level drawn crisp at any scale, the previous level shrinking to a dot at the centre of the next.
   *  levels: [{ size: '1 mm', name: 'grain of sand', mood: 'day', draw: (V, lt) => {...}, anchor: [x, y] }, …] from smallest to biggest.
   *    draw paints that level in local units centred on (0, 0): the hero fills radius ~300 and neighbours may spread to x ±620, y ±300
   *    (shown 1.25× when the camera is on it, so a level is a whole composition, not an icon); V is PV.V with V.c = the 2d context already transformed (so V.orb(V.c, 0, 0, 260, { kind: 'earth' })). anchor: where, in this
   *    level's units, the previous (smaller) level sits (default [0, 0]: dead centre). mood: sky palette for this level (blended between levels).
   *  keys: [[lt, level], …] — the camera's level over time (fractional = in between), e.g. [[P.c(0), 0], [P.c(1), 1], [P.c(2), 1], [P.c(3), 3]];
   *    moves ease in and out, every second multiplies the scale by the same factor. counter: a pill at the top right showing the current size.
   *  Each level's `name` shows under its object while the camera is near it. Zoom out (level rising) = getting bigger; reverse keys to dive in. */
  B.vjourney = function (levels, o = {}) {
    const f = o.factor ?? 10, keys = o.keys || [[0, 0], [2, levels.length - 1]];
    const origin = [[0, 0]];
    for (let i = 1; i < levels.length; i++) { const a = levels[i].anchor || [0, 0], s = Math.pow(f, i); origin.push([origin[i - 1][0] - a[0] * s, origin[i - 1][1] - a[1] * s]); }
    const levelAt = (lt) => {
      if (lt <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) if (lt < keys[i][0]) { const [t0, u0] = keys[i - 1], [t1, u1] = keys[i]; return lerp(u0, u1, ease.inOut(clamp((lt - t0) / (t1 - t0)))); }
      return keys[keys.length - 1][1];
    };
    const cx = W / 2, cy = (o.cy ?? H / 2 - 40), fill = o.fill ?? 1.25;
    const V = Object.assign({}, PV.V);
    // the journey fills the frame: a transparent marker tells the page check it is content, not a backdrop
    const mark = PV.s('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;pointer-events:none' }, this.html);
    const A = STAGE.area;
    PV.s('rect', { x: A.x0 + 80, y: A.y0 + 20, width: A.x1 - A.x0 - 160, height: A.y1 - A.y0 - 40, fill: 'transparent' }, mark);
    return stageCanvas(this, (c, lt) => {
      const k0 = fadeK(lt, o.at ?? 0, 0.4);
      const u = clamp(levelAt(lt), 0, levels.length - 1), Z = Math.pow(f, u);
      const i0 = Math.floor(u), i1 = Math.min(levels.length - 1, i0 + 1), fr = u - i0;
      const cam = [lerp(origin[i0][0], origin[i1][0], fr), lerp(origin[i0][1], origin[i1][1], fr)];
      c.globalAlpha = k0;
      if (o.sky !== false) {
        const ga = MOODS[levels[i0].mood || 'space'] || MOODS.space, gb = MOODS[levels[i1].mood || levels[i0].mood || 'space'] || MOODS.space;
        const gr = c.createLinearGradient(0, -200, 0, H + 200);
        gr.addColorStop(0, mix(ga[0], gb[0], fr)); gr.addColorStop(0.55, mix(ga[1], gb[1], fr)); gr.addColorStop(1, mix(ga[2], gb[2], fr));
        c.fillStyle = gr; c.fillRect(-200, -200, W + 400, H + 400);
        const rnd = PV.rng(17);
        for (let i = 0; i < 200; i++) {   // stars at infinity drift slowly with the zoom, so the zoom reads as motion
          const a = rnd() * TAU, d0 = rnd(), sp = 0.5 + rnd(), ph = rnd() * TAU;
          const d = ((d0 + u * 0.35 * sp) % 1); const rr = d * 1300;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          c.fillStyle = `rgba(255,255,255,${(0.15 + 0.55 * d * (0.6 + 0.4 * Math.sin(lt * 2 * sp + ph))).toFixed(3)})`; c.fill(circle(x, y, 0.6 + d * 2.2 * (rnd() * 0.6 + 0.4)));
        }
      }
      for (let i = levels.length - 1; i >= 0; i--) {
        const sc = Math.pow(f, i) / Z;
        if (sc > 14 || sc < 0.0025) continue;
        const a = sc > 3 ? clamp(1 - (sc - 3) / 6) : 1;
        if (a <= 0) continue;
        c.save(); c.globalAlpha = k0 * a;
        c.translate(cx + (origin[i][0] - cam[0]) / Z * fill, cy + (origin[i][1] - cam[1]) / Z * fill); c.scale(sc * fill, sc * fill);
        V.c = c;
        if (sc < 0.04) { const q = sc * fill; c.fillStyle = '#FFFFFF'; c.fill(circle(0, 0, 3 / q)); glow(c, 0, 0, 14 / q, '#9FE8FF', 0.6); }
        else levels[i].draw(V, lt, sc);
        c.restore();
        const near = clamp(1 - Math.abs(Math.log10(sc)) * 2.2);
        if (levels[i].name && near > 0.02) {
          c.globalAlpha = k0 * near;
          pill(c, cx + (origin[i][0] - cam[0]) / Z * fill, Math.min(A.y1 - 22, cy + (origin[i][1] - cam[1]) / Z * fill + 330 * fill * Math.min(1, sc) + 24), levels[i].name, { size: 32, color: '#F6F3FF' });
        }
      }
      c.globalAlpha = k0;
      if (o.counter !== false) {
        const lab = fr < 0.5 ? levels[i0].size : levels[i1].size;
        if (lab) {
          const flip = 1 - Math.abs(fr - 0.5) * 2 > 0.85 ? 0.6 : 1;
          c.globalAlpha = k0 * flip;
          pill(c, A.x1, STAGE.title.y + 42, lab, { size: 40, color: '#FACC12', align: 'r' });
          c.font = `600 26px ${FONT}`; c.fillStyle = 'rgba(246,243,255,0.65)'; c.textAlign = 'right'; c.fillText(o.caption ?? ((window.SCRIPT?.META?.lang === "zh") ? `每一步 × ${f}` : `× ${f} every step`), A.x1, STAGE.title.y + 114);
        }
      }
      c.globalAlpha = 1;
    }, { pad: 200 });
  };

  /** vbeam(x1, y1, x2, y2, { color='blue', w=60, at, dur=0.5, pulse=true }): a glowing beam / signal travelling from (x1,y1) to (x2,y2) —
   *  light, a scan, a message, energy. It grows from the start, then shimmers; pulse adds a bright packet running along it. */
  B.vbeam = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, cc = col(o.color || 'blue'), w = o.w ?? 40;
    return stageCanvas(this, (c, lt) => {
      const k = ease.out(clamp((lt - at) / (o.dur ?? 0.5))) * outK(lt, o.out);
      if (lt < at || outK(lt, o.out) <= 0) return;
      const ex = lerp(x1, x2, k), ey = lerp(y1, y2, k), a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(ex - x1, ey - y1);
      c.save(); c.translate(x1, y1); c.rotate(a);
      const g = c.createLinearGradient(0, -w / 2, 0, w / 2);
      g.addColorStop(0, rgba(hex(cc), 0)); g.addColorStop(0.5, rgba(hex(cc), 0.55 + 0.08 * Math.sin(lt * 9))); g.addColorStop(1, rgba(hex(cc), 0));
      c.fillStyle = g; c.fillRect(0, -w / 2, len, w);
      c.fillStyle = rgba(hex(hiOf(cc, 0.7)), 0.95); c.fillRect(0, -2.5, len, 5);
      glow(c, len, 0, w * 1.6, hiOf(cc, 0.5), 0.9);   // the head of the beam
      if (o.pulse !== false && k >= 1) for (let j = 0; j < 3; j++) { const px = (((lt - at) * 0.6 + j / 3) % 1) * len; glow(c, px, 0, w * 0.8, '#FFFFFF', 0.7); }
      c.restore();
    }, { pad: 0 });
  };

  // ── type ──────────────────────────────────────────────
  // this style's page title: bold sans, a coloured dot instead of the hand-drawn squiggle; it rises in rather than being written
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15, size = o.size ?? 46;
    const el = h('div', 'vtitle', null, T.html);
    el.innerHTML = `<i style="background:${col(o.accent || 'yellow')}"></i><span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
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

  /** vnum(x, y, lt => value, { fmt, size=120, color='yellow', unit, at, align='c' }): a big bold number that counts (land it on the spoken word:
   *  start the count at P.cw(i, 'word') - duration). fmt(v) → string (default: rounded with thousands separators); unit is a smaller suffix. */
  B.vnum = function (x, y, fn, o = {}) {
    const size = o.size ?? 120, at = o.at ?? 0;
    const el = h('div', 'tx latin', null, this.html);
    Object.assign(el.style, { fontSize: size + 'px', color: col(o.color || 'yellow'), fontWeight: 800, whiteSpace: 'nowrap', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' });
    const fmt = o.fmt || ((v) => Math.round(v).toLocaleString('en-US'));
    this.tick((lt) => {
      const k = pop(lt, at, 0.4) * outK(lt, o.out);
      const txt = fmt(fn(lt)) + (o.unit ? `<span style="font-size:0.42em;margin-left:0.18em;color:${col('soft')}">${o.unit}</span>` : '');
      if (el._t !== txt) { el._t = txt; el.innerHTML = txt; }
      const w = el.offsetWidth;
      el.style.left = (o.align === 'l' ? x : o.align === 'r' ? x - w : x - w / 2) + 'px';
      el.style.top = y - size / 2 + 'px';
      const m0 = Math.min(1, 25 / size); el.style.opacity = clamp(k * 1.4).toFixed(3); el.style.transform = `scale(${(m0 + (1 - m0) * Math.max(0, k)).toFixed(3)})`;
    });
    return el;
  };
})();
