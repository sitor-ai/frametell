/* Clay studio kit: a stop-motion claymation set. Every part is a plasticine volume, shaded from one warm key light at the
 * upper left (a broad highlight, a lit rim, a shaded rim, thumb-pressed texture) and standing on a soft contact shadow.
 * Everything is drawn on twos (12 drawings a second) and boils very slightly between drawings, the way a hand-moved
 * puppet does; pops land with squash and stretch. Shaded parts are cached as sprites, so a page stays fast.
 * Every component is a pure function of page time lt. An option marked "fn" may be a value, a function of lt, or a
 * keyframe list [[t0, v0], [t1, v1], …] (the last entry whose time has passed wins). */
(function () {
  const { col, clamp, lerp, ease, h, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, SR = 1.5;
  /** 12 drawings a second ("on twos") */
  const step = (lt) => Math.floor(lt * 12 + 1e-6) / 12;
  const drawing = (lt) => Math.floor(lt * 12 + 1e-6);
  PV.step12 = step;
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]);
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  let SEED = 1;

  // ─────────────────────────── colour ───────────────────────────
  const rgb = (c) => {
    const s = String(col(c) || c), m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) return m[1].split(',').slice(0, 3).map((x) => Math.round(parseFloat(x)));
    const hx = s.replace('#', '');
    const f = hx.length === 3 ? hx.split('').map((x) => x + x).join('') : hx;
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  };
  /** lighter (amt > 0, toward warm white) or darker (amt < 0, toward cocoa) */
  const shade = (c, amt) => {
    const [r, g, b] = rgb(c), t = amt > 0 ? [255, 250, 242] : [50, 24, 18], k = Math.abs(amt);
    return `rgb(${Math.round(r + (t[0] - r) * k)},${Math.round(g + (t[1] - g) * k)},${Math.round(b + (t[2] - b) * k)})`;
  };
  const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };

  // ─────────────────────────── geometry ───────────────────────────
  const ell = (x, y, rx, ry, a = 0) => { const p = new Path2D(); p.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), a, 0, Math.PI * 2); return p; };
  const circ = (x, y, r) => ell(x, y, r, r);
  const rrect = (x, y, w, hh, r) => { const p = new Path2D(); p.roundRect(x, y, w, hh, Math.min(r, w / 2, hh / 2)); return p; };
  const smooth = (pts, closed = true) => {   // Catmull-Rom through the points
    const p = new Path2D(), n = pts.length, g = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    p.moveTo(...pts[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) p.closePath();
    return p;
  };
  const star = (x, y, R, r, n = 5, rot = -Math.PI / 2) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? r : R; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } return pts; };
  const heartPts = (x, y, s) => [[x, y + s * 0.95], [x - s * 0.62, y + s * 0.35], [x - s * 0.92, y - s * 0.18], [x - s * 0.62, y - s * 0.62], [x - s * 0.2, y - s * 0.55], [x, y - s * 0.28], [x + s * 0.2, y - s * 0.55], [x + s * 0.62, y - s * 0.62], [x + s * 0.92, y - s * 0.18], [x + s * 0.62, y + s * 0.35]];

  // ─────────────────────────── the clay shader ───────────────────────────
  const mk = (w, hh) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w * SR)); cv.height = Math.max(1, Math.ceil(hh * SR)); const g = cv.getContext('2d'); g.scale(SR, SR); return { cv, g }; };
  const NOISE = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 192; const g = cv.getContext('2d'), img = g.createImageData(192, 192), r = PV.rng(77);
    for (let i = 0; i < img.data.length; i += 4) { const v = r() < 0.5 ? 255 : 30; img.data[i] = v; img.data[i + 1] = v * 0.95; img.data[i + 2] = v * 0.9; img.data[i + 3] = Math.floor(r() * 26); }
    g.putImageData(img, 0, 0); return cv;
  })();
  const CACHE = new Map();
  /**
   * A shaded clay sprite, cached by key. w × hh is its box in stage px; mask(g) draws the solid silhouette in it (fill
   * and/or stroke, any opaque colour). o: { box: [x, y, w, h] of the shape (for the light), rim (px), prints (thumb
   * prints, default true), gloss (0..1), after(g) (draws on top, e.g. pressed text) }. Returns { cv, w, h }.
   */
  function clay(key, w, hh, color, mask, o = {}) {
    const k = key + '|' + w + 'x' + hh + '|' + color;
    let s = CACHE.get(k);
    if (s) return s;
    const base = col(color) || color;
    const m = mk(w, hh); m.g.fillStyle = '#000'; m.g.strokeStyle = '#000'; m.g.lineJoin = 'round'; m.g.lineCap = 'round'; mask(m.g);
    const out = mk(w, hh), g = out.g;
    g.drawImage(m.cv, 0, 0, w, hh);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = base; g.fillRect(0, 0, w, hh);
    g.globalCompositeOperation = 'source-atop';
    const [bx, by, bw, bh] = o.box || [0, 0, w, hh], R = Math.max(bw, bh);
    const lg = g.createRadialGradient(bx + bw * 0.3, by + bh * 0.24, R * 0.04, bx + bw * 0.46, by + bh * 0.46, R * 0.82);
    lg.addColorStop(0, 'rgba(255,252,244,0.42)'); lg.addColorStop(0.42, 'rgba(255,252,244,0.04)'); lg.addColorStop(0.75, 'rgba(70,30,15,0.10)'); lg.addColorStop(1, 'rgba(60,25,12,0.34)');
    g.fillStyle = lg; g.fillRect(0, 0, w, hh);
    const d = o.rim ?? clamp(R * 0.045, 2.2, 11);
    const band = (dx, dy, fill, blur, alpha) => {   // inside the shape, outside the shape moved by (dx, dy): a rim on the far side
      const t = mk(w, hh); t.g.fillStyle = fill; t.g.fillRect(0, 0, w, hh);
      t.g.globalCompositeOperation = 'destination-out'; t.g.drawImage(m.cv, dx, dy, w, hh);
      g.save(); g.filter = `blur(${(blur * SR).toFixed(1)}px)`; g.globalAlpha = alpha; g.drawImage(t.cv, 0, 0, w, hh); g.restore();
    };
    band(d, d, 'rgb(255,250,240)', d * 0.75, 0.62);          // the lit rim, upper left
    band(-d * 1.3, -d * 1.3, 'rgb(70,28,14)', d * 1.1, 0.32); // the shaded rim, lower right
    if (o.gloss !== 0) {                                     // a soft specular on the top of the volume
      const sg = g.createRadialGradient(bx + bw * 0.3, by + bh * 0.2, 0, bx + bw * 0.3, by + bh * 0.2, R * 0.16);
      sg.addColorStop(0, `rgba(255,255,255,${0.42 * (o.gloss ?? 1)})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sg; g.fillRect(0, 0, w, hh);
    }
    g.globalAlpha = 0.9; g.fillStyle = g.createPattern(NOISE, 'repeat'); g.fillRect(0, 0, w, hh); g.globalAlpha = 1;
    if (o.prints !== false && R > 60) {                      // thumb prints: faint concentric arcs pressed into the surface
      const r = PV.rng(k.length * 131 + (k.charCodeAt(0) || 1) * 7);
      const n = R > 220 ? 3 : R > 120 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const px = bx + bw * (0.25 + r() * 0.5), py = by + bh * (0.3 + r() * 0.45), pr = R * (0.08 + r() * 0.06), a0 = r() * 6;
        for (let j = 0; j < 4; j++) {
          g.lineWidth = 1.2; g.strokeStyle = 'rgba(70,30,15,0.10)'; g.beginPath(); g.ellipse(px, py, pr * (0.35 + j * 0.22), pr * (0.25 + j * 0.16), a0, 0.3, 2.6); g.stroke();
          g.strokeStyle = 'rgba(255,250,240,0.16)'; g.beginPath(); g.ellipse(px - 1, py - 1.2, pr * (0.35 + j * 0.22), pr * (0.25 + j * 0.16), a0, 0.3, 2.6); g.stroke();
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
    if (o.after) o.after(g);
    s = { cv: out.cv, w, h: hh };
    CACHE.set(k, s);
    return s;
  }
  /** draw a sprite with its anchor (ax, ay in sprite px) at (x, y) */
  const put = (c, s, x, y, ax, ay) => c.drawImage(s.cv, x - ax, y - ay, s.w, s.h);
  /** the soft contact shadow on the floor under an object */
  function shadow(c, x, y, rx, a = 0.32, ry) {
    c.save(); c.translate(x, y); c.scale(1, (ry ?? rx * 0.2) / rx);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(95,45,28,${a})`); g.addColorStop(0.55, `rgba(95,45,28,${a * 0.45})`); g.addColorStop(1, 'rgba(95,45,28,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.restore();
  }
  /** a rolled clay tube along whatever path build() traces: shaded side, body, lit top, a glint */
  function tube(c, build, wd, color) {
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const pass = (dx, dy, style, lw, a = 1) => { c.save(); c.translate(dx, dy); c.globalAlpha = a; c.strokeStyle = style; c.lineWidth = lw; c.beginPath(); build(c); c.stroke(); c.restore(); };
    pass(wd * 0.05, wd * 0.12, 'rgba(95,45,28,0.18)', wd * 1.05);   // its shadow on what is behind
    pass(0, 0, shade(color, -0.22), wd);
    pass(-wd * 0.08, -wd * 0.1, col(color), wd * 0.78);
    pass(-wd * 0.17, -wd * 0.2, shade(color, 0.42), wd * 0.26, 0.85);
    pass(-wd * 0.2, -wd * 0.24, 'rgba(255,255,255,0.75)', Math.max(1.5, wd * 0.07), 0.8);
    c.restore();
  }
  /** a small shaded ball drawn directly (eyes, hands, crumbs) */
  function ball(c, x, y, r, color, a = 1) {
    c.save(); c.globalAlpha = a;
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.5, col(color) || color); g.addColorStop(1, shade(color, -0.3));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.beginPath(); c.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ─────────────────────────── timing ───────────────────────────
  /** a stepped pop with overshoot (k past 1 for a moment) and a shrink-out */
  const pop = (lt, at = 0, out) => {
    const tq = step(lt);
    let k = tq < at ? 0 : ease.back(clamp((tq - at) / 0.42));
    if (out != null && tq >= out) k *= 1 - ease.inOut(clamp((tq - out) / 0.3));
    return k;
  };
  /** squash/stretch scale pair for a pop value k: tall on the overshoot, wide as it lands */
  const sqs = (k) => (k > 1 ? [1 - (k - 1) * 0.9, k + (k - 1) * 0.6] : [k * (1 + (1 - k) * 0.25), k]);
  /** this drawing's boil: a tiny offset and turn that changes 12 times a second */
  const boil = (seed, lt, amt = 1) => { const r = PV.rng(seed * 7919 + drawing(lt) * 104729); return [(r() - 0.5) * 1.8 * amt, (r() - 0.5) * 1.8 * amt, (r() - 0.5) * 0.007 * amt]; };

  /** a canvas on this layer, sized in stage px, redrawn only when its drawing (or what key(lt) returns) changes */
  function mount(self, w, hh, place, draw, key) {
    const c = h('canvas', null, null, self.html);
    c.width = Math.ceil(w * SR); c.height = Math.ceil(hh * SR);
    Object.assign(c.style, { position: 'absolute', width: w + 'px', height: hh + 'px', left: '0px', top: '0px' });
    const ctx = c.getContext('2d');
    let last = null;
    self.tick((lt) => {
      const p = place(lt);
      if (!p) { c.style.display = 'none'; last = null; return; }
      c.style.display = '';
      c.style.left = p.x.toFixed(1) + 'px'; c.style.top = p.y.toFixed(1) + 'px';
      const kk = drawing(lt) + '|' + (key ? key(lt) : '');
      if (kk === last) return;
      last = kk;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(SR, 0, 0, SR, 0, 0);
      draw(ctx, lt);
    });
    return c;
  }

  // ─────────────────────────── the set ───────────────────────────
  const SETS = {
    peach: ['#F5D7C6', '#F0C5AE'], mint: ['#CFEBDC', '#B9DFC9'], sky: ['#CFE3F4', '#B7D3EC'], lilac: ['#E3D8F2', '#D1C1EA'],
    butter: ['#F8E9BE', '#F1DBA0'], rose: ['#F7D3DC', '#EFBCCA'], cocoa: ['#4A3631', '#3A2925'],
  };
  /** set(tint, o): the seamless-paper sweep behind a page — the wall curving into the floor, a warm pool of key light
   *  and a soft falloff into the corners. Put it first on a page; change tint to mark a new scene. tint: 'peach' (default)
   *  'mint' 'sky' 'lilac' 'butter' 'rose' 'cocoa' (a dark set for night, space or a dramatic reveal). o: { floor (y where
   *  the floor meets the wall, default 690), light (x of the light pool, default 700), table (true: a clay tabletop edge
   *  across the bottom, objects stand on y ≈ 880) } */
  B.set = function (tint = 'peach', o = {}) {
    const [wall, floor] = SETS[tint] || SETS.peach, fy = o.floor ?? 690, lx = o.light ?? 700, dark = tint === 'cocoa';
    const c = h('canvas', null, null, this.html); c.width = W / 2; c.height = H / 2;
    Object.assign(c.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px' });
    const g = c.getContext('2d'); g.scale(0.5, 0.5);
    const lin = g.createLinearGradient(0, 0, 0, H);
    lin.addColorStop(0, shade(wall, dark ? 0.02 : -0.03)); lin.addColorStop(fy / H - 0.06, wall); lin.addColorStop(fy / H + 0.04, shade(floor, -0.06)); lin.addColorStop(fy / H + 0.12, floor); lin.addColorStop(1, shade(floor, dark ? -0.1 : 0.06));
    g.fillStyle = lin; g.fillRect(0, 0, W, H);
    const cove = g.createLinearGradient(0, fy - 70, 0, fy + 90);   // the paper bending: a soft darker band where wall turns floor
    cove.addColorStop(0, 'rgba(90,40,25,0)'); cove.addColorStop(0.55, `rgba(90,40,25,${dark ? 0.22 : 0.07})`); cove.addColorStop(1, 'rgba(90,40,25,0)');
    g.fillStyle = cove; g.fillRect(0, fy - 70, W, 160);
    const pool = g.createRadialGradient(lx, fy - 120, 30, lx, fy - 60, 980);
    pool.addColorStop(0, `rgba(255,248,232,${dark ? 0.16 : 0.5})`); pool.addColorStop(0.5, `rgba(255,248,232,${dark ? 0.05 : 0.14})`); pool.addColorStop(1, 'rgba(255,248,232,0)');
    g.fillStyle = pool; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H * 0.48, 380, W / 2, H * 0.5, 1250);
    vg.addColorStop(0, 'rgba(60,25,15,0)'); vg.addColorStop(1, `rgba(60,25,15,${dark ? 0.55 : 0.26})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.5; g.fillStyle = g.createPattern(NOISE, 'repeat'); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    if (o.table) {
      const ty = STAGE.area.y1, tg = g.createLinearGradient(0, ty - 30, 0, H);
      tg.addColorStop(0, '#D99A62'); tg.addColorStop(0.18, '#C9844D'); tg.addColorStop(1, '#A9673A');
      g.fillStyle = tg; g.beginPath(); g.roundRect(-40, ty - 26, W + 80, H, 34); g.fill();
      g.fillStyle = 'rgba(255,240,215,0.45)'; g.beginPath(); g.roundRect(-40, ty - 26, W + 80, 10, 6); g.fill();
    }
    return c;
  };

  // ─────────────────────────── the buddy (clay character) ───────────────────────────
  const POSE_MOOD = { idle: 'happy', bounce: 'happy', wave: 'happy', point: 'happy', cheer: 'laugh', think: 'think', surprised: 'shock', sad: 'sad', shrug: 'worried', walk: 'happy', run: 'happy', jump: 'laugh', hold: 'happy', sleepy: 'sleepy', sit: 'happy' };
  function bodySprite(color, bw, bh) {
    const pad = 30, w = bw + pad * 2, hh = bh + pad * 2;
    return clay('body', w, hh, color, (g) => {
      const pts = [];
      for (let i = 0; i < 28; i++) {
        const a = i / 28 * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
        const px = (bw / 2) * Math.sign(sa) * Math.pow(Math.abs(sa), 0.82) * (1 + 0.1 * ca);
        const py = bh / 2 + (bh / 2) * Math.sign(ca) * Math.pow(Math.abs(ca), 0.9);
        pts.push([w / 2 + px, pad + py]);
      }
      g.fill(smooth(pts));
    }, { box: [pad, pad, bw, bh] });
  }
  function eye(c, x, y, r, look, lookY, blink, lid, mood) {
    shadow(c, x + r * 0.15, y + r * 0.85, r * 0.9, 0.22, r * 0.3);
    ball(c, x, y, r, '#FFFDF7');
    if (blink || mood === 'sleepy') { c.save(); c.beginPath(); c.arc(x, y, r * 1.02, 0, Math.PI * 2); c.clip(); c.fillStyle = shade(lid, 0.05); c.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * (blink ? 2.2 : 1.25)); c.restore(); tube(c, (cc) => { cc.moveTo(x - r * 0.9, y + (blink ? r * 0.15 : 0.02 * r)); cc.quadraticCurveTo(x, y + r * (blink ? 0.45 : 0.25), x + r * 0.9, y + (blink ? r * 0.15 : 0.02 * r)); }, r * 0.22, lid); return; }
    const big = mood === 'shock' ? 0.42 : 0.56;
    const px = x + look * r * 0.32, py = y + lookY * r * 0.3;
    c.fillStyle = '#2A1C19'; c.beginPath(); c.ellipse(px, py, r * big, r * big * 1.08, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(px - r * big * 0.38, py - r * big * 0.42, r * big * 0.32, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(px + r * big * 0.32, py + r * big * 0.36, r * big * 0.13, 0, Math.PI * 2); c.fill();
    if (mood === 'sad' || mood === 'worried') { c.save(); c.beginPath(); c.arc(x, y, r * 1.02, 0, Math.PI * 2); c.clip(); c.fillStyle = shade(lid, 0.05); c.beginPath(); c.moveTo(x - r * 1.2, y - r * 1.2); c.lineTo(x + r * 1.2, y - r * 1.2); c.lineTo(x + r * 1.2, y - r * 0.55); c.lineTo(x - r * 1.2, y - r * 0.15); c.closePath(); c.fill(); c.restore(); }
  }
  function mouth(c, mood, x, y, s) {
    const dk = '#5A2A26';
    if (mood === 'laugh' || mood === 'cheer') {
      const p = new Path2D(); p.moveTo(x - 34 * s, y - 6 * s); p.quadraticCurveTo(x, y - 12 * s, x + 34 * s, y - 6 * s); p.quadraticCurveTo(x + 30 * s, y + 40 * s, x, y + 42 * s); p.quadraticCurveTo(x - 30 * s, y + 40 * s, x - 34 * s, y - 6 * s); p.closePath();
      c.fillStyle = dk; c.fill(p); c.save(); c.clip(p); ball(c, x + 4 * s, y + 38 * s, 22 * s, '#F08FB0'); c.fillStyle = '#FFFDF7'; c.fillRect(x - 30 * s, y - 14 * s, 60 * s, 12 * s); c.restore();
    } else if (mood === 'shock') { c.fillStyle = dk; c.beginPath(); c.ellipse(x, y + 10 * s, 15 * s, 21 * s, 0, 0, Math.PI * 2); c.fill(); }
    else if (mood === 'sad') tube(c, (cc) => { cc.moveTo(x - 24 * s, y + 16 * s); cc.quadraticCurveTo(x, y - 4 * s, x + 24 * s, y + 16 * s); }, 9 * s, dk);
    else if (mood === 'worried') tube(c, (cc) => { cc.moveTo(x - 24 * s, y + 8 * s); for (let i = 1; i <= 4; i++) cc.lineTo(x - 24 * s + i * 12 * s, y + 8 * s + (i % 2 ? -6 : 4) * s); }, 8 * s, dk);
    else if (mood === 'sleepy') { c.fillStyle = dk; c.beginPath(); c.ellipse(x, y + 8 * s, 8 * s, 7 * s, 0, 0, Math.PI * 2); c.fill(); }
    else if (mood === 'think' || mood === 'sly') tube(c, (cc) => { cc.moveTo(x - 18 * s, y + 10 * s); cc.quadraticCurveTo(x + 4 * s, y + 14 * s, x + 22 * s, y + 2 * s); }, 8 * s, dk);
    else if (mood === 'angry') tube(c, (cc) => { cc.moveTo(x - 20 * s, y + 12 * s); cc.lineTo(x + 20 * s, y + 8 * s); }, 9 * s, dk);
    else { const p = new Path2D(); p.moveTo(x - 28 * s, y); p.quadraticCurveTo(x, y + 34 * s, x + 28 * s, y); p.quadraticCurveTo(x, y + 12 * s, x - 28 * s, y); c.fillStyle = dk; c.fill(p); }
  }
  function hat(c, kind, color, x, top, bw, s, tq) {
    if (!kind || kind === 'none') return;
    const a = color || 'red';
    if (kind === 'beanie') {
      const sp = clay('beanie', 190 * s, 110 * s, a, (g) => { g.beginPath(); g.ellipse(95 * s, 95 * s, 88 * s, 80 * s, 0, Math.PI, 0); g.fill(); g.fill(rrect(4 * s, 78 * s, 182 * s, 30 * s, 15 * s)); }, { box: [6 * s, 14 * s, 180 * s, 94 * s] });
      put(c, sp, x, top + 26 * s, 95 * s, 100 * s); ball(c, x, top - 72 * s, 22 * s, 'paper');
    } else if (kind === 'cap') {
      const sp = clay('cap', 220 * s, 100 * s, a, (g) => { g.beginPath(); g.ellipse(90 * s, 86 * s, 82 * s, 72 * s, 0, Math.PI, 0); g.fill(); g.fill(ell(150 * s, 84 * s, 66 * s, 13 * s)); }, { box: [8 * s, 14 * s, 204 * s, 84 * s] });
      put(c, sp, x, top + 20 * s, 90 * s, 92 * s);
    } else if (kind === 'bow') {
      const sp = clay('bow', 150 * s, 90 * s, a, (g) => { g.fill(smooth([[75 * s, 45 * s], [20 * s, 12 * s], [8 * s, 50 * s], [24 * s, 80 * s]])); g.fill(smooth([[75 * s, 45 * s], [130 * s, 12 * s], [142 * s, 50 * s], [126 * s, 80 * s]])); g.fill(circ(75 * s, 46 * s, 20 * s)); });
      put(c, sp, x + 40 * s, top + 10 * s, 75 * s, 60 * s);
    } else if (kind === 'leaf') {
      tube(c, (cc) => { cc.moveTo(x, top + 6 * s); cc.quadraticCurveTo(x + 4 * s, top - 26 * s, x - 2 * s, top - 40 * s); }, 10 * s, 'green');
      const sp = clay('leaf', 110 * s, 70 * s, 'green', (g) => { g.fill(smooth([[10 * s, 50 * s], [50 * s, 10 * s], [100 * s, 18 * s], [60 * s, 58 * s]])); });
      put(c, sp, x, top - 40 * s, 12 * s, 52 * s);
    } else if (kind === 'antenna') {
      const w = Math.sin(tq * 9) * 6 * s;
      tube(c, (cc) => { cc.moveTo(x, top + 6 * s); cc.quadraticCurveTo(x + w, top - 40 * s, x + w * 1.6, top - 74 * s); }, 9 * s, 'ink');
      ball(c, x + w * 1.6, top - 80 * s, 17 * s, a);
    } else if (kind === 'tuft') {
      [-22, 0, 22].forEach((dx, i) => tube(c, (cc) => { cc.moveTo(x + dx * s, top + 10 * s); cc.quadraticCurveTo(x + dx * 1.6 * s, top - 30 * s, x + (dx * 2.2 + (i - 1) * 8) * s, top - 30 * s); }, 13 * s, a));
    }
  }
  /** a mitten hand: a soft ball with a thumb nub */
  function mitten(c, x, y, a, r, color) {
    const sp = clay('mitt', r * 3, r * 3, color, (g) => { g.fill(ell(r * 1.5, r * 1.5, r * 1.05, r * 0.92)); g.fill(ell(r * 1.5 - r * 0.2, r * 1.5 - r * 0.85, r * 0.42, r * 0.36, -0.5)); }, { prints: false });
    c.save(); c.translate(x, y); c.rotate(a - Math.PI / 2); put(c, sp, 0, 0, r * 1.5, r * 1.5); c.restore();
  }
  function drawBuddy(c, o, lt, seed) {
    const s = (o.size ?? 420) / 340, tq = step(lt);
    const pose = val(o.pose, lt, 'idle'), mood = val(o.mood, lt, null) || POSE_MOOD[pose] || 'happy';
    const color = val(o.body, lt, 'orange'), bw = 230 * s, bh = 262 * s;
    let lift = 0, sx = 1, sy = 1 + 0.012 * Math.sin(tq * 4.2 + seed), lean = 0;
    const cyc = (f) => (tq * f + seed * 0.37) % 1;
    if (pose === 'bounce' || pose === 'cheer') { const b = Math.abs(Math.sin(Math.PI * cyc(1.6))); lift = b * 34 * s; sy += (b < 0.2 ? -0.07 : 0.04 * b); sx += (b < 0.2 ? 0.06 : -0.02); }
    if (pose === 'jump') { const q = cyc(0.9), air = clamp((q - 0.2) / 0.6); const b = Math.sin(Math.PI * air); lift = b * 120 * s; if (q < 0.2) { sy -= 0.12 * Math.sin(Math.PI * q / 0.2); sx += 0.1 * Math.sin(Math.PI * q / 0.2); } else if (air > 0 && air < 1) { sy += 0.08 * (1 - Math.abs(air - 0.5) * 2); sx -= 0.05; } }
    if (pose === 'walk' || pose === 'run') { const b = Math.abs(Math.sin(Math.PI * cyc(pose === 'run' ? 3.2 : 2))); lift = b * (pose === 'run' ? 22 : 12) * s; lean = pose === 'run' ? 0.1 : 0.03; }
    if (pose === 'surprised') { sy += 0.08; sx -= 0.05; lift = 10 * s; }
    if (pose === 'sad' || pose === 'sleepy') { sy -= 0.05; sx += 0.04; }
    if (pose === 'point') lean = 0.05;
    if (pose === 'sit') { sy -= 0.1; sx += 0.07; }
    // feet
    const fA = pose === 'walk' || pose === 'run' ? Math.sin(Math.PI * 2 * cyc(pose === 'run' ? 1.6 : 1)) : 0;
    shadow(c, 0, 0, 150 * s * (1 - lift / (500 * s)), 0.34 - lift / (900 * s));
    const footS = clay('foot', 110 * s, 64 * s, val(o.shoes, lt, null) || shade(color, -0.12), (g) => g.fill(ell(55 * s, 34 * s, 48 * s, 25 * s)), { prints: false });
    put(c, footS, -54 * s - fA * 14 * s, -Math.max(0, fA) * 22 * s - (pose === 'jump' ? lift * 0.9 : 0), 55 * s, 50 * s);
    put(c, footS, 58 * s + fA * 14 * s, -Math.max(0, -fA) * 22 * s - (pose === 'jump' ? lift * 0.9 : 0), 55 * s, 50 * s);
    c.save(); c.translate(0, -lift - 22 * s); c.rotate(lean); c.scale(sx, sy);
    const top = -bh, shY = -bh * 0.45, shX = bw * 0.42;
    // arms: angle from straight down, outward positive
    const sw = Math.sin(tq * 3 + seed) * 0.05, w2 = Math.sin(Math.PI * 2 * cyc(1.6));
    const A = {
      idle: [0.3 + sw, 0.3 - sw], bounce: [0.5, 0.5], wave: [0.28, 2.5 + 0.35 * Math.sin(tq * 11)], point: [0.25, 1.62], cheer: [2.6 + 0.12 * w2, 2.6 - 0.12 * w2],
      think: [0.3, 2.9], surprised: [2.1, 2.1], sad: [0.08, 0.08], shrug: [1.95, 1.95], walk: [0.35 + 0.45 * fA, 0.35 - 0.45 * fA], run: [0.6 + 0.8 * fA, 0.6 - 0.8 * fA],
      jump: [2.4, 2.4], hold: [0.3, 1.25], sleepy: [0.12, 0.12], sit: [0.6, 0.6],
    }[pose] || [0.3, 0.3];
    const armL = 104 * s, armW = 44 * s;
    const handAt = (side, a) => (pose === 'think' && side > 0 ? [bw * 0.12, -bh * 0.36] : [side * (shX + Math.sin(a) * armL), shY + Math.cos(a) * armL]);
    const arm = (side, a) => { const [hx, hy] = handAt(side, a); tube(c, (cc) => { cc.moveTo(side * shX * 0.96, shY); cc.quadraticCurveTo(side * (shX + 16 * s), (shY + hy) / 2 + 10 * s, hx, hy); }, armW, color); mitten(c, hx, hy, Math.atan2(hy - shY, hx - side * shX), 29 * s, shade(color, 0.06)); return [hx, hy]; };
    arm(-1, A[0]);   // the back arm, behind the body
    put(c, bodySprite(color, bw, bh), 0, 0, bw / 2 + 30, bh + 30);
    const hand = pose === 'think' ? null : arm(1, A[1]);   // the front arm grows out of the body edge, under the face
    // belly patch, cheeks, face
    if (o.belly) { const bp = clay('belly', 130 * s, 120 * s, o.belly, (g) => g.fill(ell(65 * s, 60 * s, 58 * s, 52 * s)), { gloss: 0.4, prints: false }); put(c, bp, 8 * s, -bh * 0.24, 65 * s, 60 * s); }
    const fx = 14 * s, eY = top + bh * 0.33, eR = 30 * s;
    const look = val(o.look, lt, pose === 'point' ? 0.9 : 0.35), lookY = pose === 'think' ? -0.9 : pose === 'sad' ? 0.8 : 0.1;
    const blink = mood !== 'sleepy' && mood !== 'laugh' && ((drawing(lt) + seed * 13) % 47) < 2;
    if (mood === 'laugh' || mood === 'cheer') [fx - 48 * s, fx + 50 * s].forEach((x) => tube(c, (cc) => { cc.moveTo(x - eR * 0.8, eY + 6 * s); cc.quadraticCurveTo(x, eY - eR * 0.9, x + eR * 0.8, eY + 6 * s); }, 10 * s, '#3B2A26'));
    else { eye(c, fx - 48 * s, eY, eR, look, lookY, blink, color, mood); eye(c, fx + 50 * s, eY, eR, look, lookY, blink, color, mood); }
    const brow = (x, dir, up) => tube(c, (cc) => { cc.moveTo(x - 20 * s, eY - eR - 14 * s - up + dir * 7 * s); cc.quadraticCurveTo(x, eY - eR - 22 * s - up, x + 20 * s, eY - eR - 14 * s - up - dir * 7 * s); }, 8 * s, shade(color, -0.45));
    if (mood === 'worried' || mood === 'sad') { brow(fx - 48 * s, -1, 2 * s); brow(fx + 50 * s, 1, 2 * s); }
    if (mood === 'angry') { brow(fx - 48 * s, 1.4, -4 * s); brow(fx + 50 * s, -1.4, -4 * s); }
    if (mood === 'shock' || mood === 'think') { brow(fx - 48 * s, 0, 12 * s); brow(fx + 50 * s, 0, mood === 'think' ? 18 * s : 12 * s); }
    [fx - 78 * s, fx + 84 * s].forEach((x) => { const g = c.createRadialGradient(x, eY + 52 * s, 0, x, eY + 52 * s, 26 * s); g.addColorStop(0, 'rgba(240,120,140,0.55)'); g.addColorStop(1, 'rgba(240,120,140,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, eY + 52 * s, 26 * s, 0, 7); c.fill(); });
    mouth(c, mood, fx + 2 * s, eY + 58 * s, s);
    if (o.glasses) { c.save(); c.lineWidth = 6 * s; c.strokeStyle = '#3B2A26'; [fx - 48 * s, fx + 50 * s].forEach((x) => { c.beginPath(); c.arc(x, eY, eR * 1.32, 0, 7); c.stroke(); }); c.beginPath(); c.moveTo(fx - 48 * s + eR * 1.32, eY - 4 * s); c.lineTo(fx + 50 * s - eR * 1.32, eY - 4 * s); c.stroke(); c.restore(); }
    hat(c, val(o.hat, lt, null), val(o.accent, lt, null), fx * 0.5, top + 8 * s, bw, s, tq);
    // the front arm, and what it carries
    const hnd = hand || arm(1, A[1]);   // a hand on the chin goes over the face
    if (o.holds && (pose === 'hold' || pose === 'point' || pose === 'wave' || pose === 'idle' || pose === 'walk')) { const kind = val(o.holds, lt); if (kind) { c.save(); c.translate(hnd[0] + 6 * s, hnd[1] - 40 * s); drawProp(c, kind, { size: 120 * s, face: false }, lt, seed); c.restore(); } }
    if (pose === 'think') for (let k = 0; k < 3; k++) { if (((tq * 2) % 4) >= k) ball(c, bw * 0.55 + k * 30 * s, top - 20 * s - k * 34 * s, (10 + k * 6) * s, 'paper'); }
    if (pose === 'sleepy') { c.fillStyle = '#3B2A26'; c.font = `400 ${48 * s}px "Archivo Black"`; for (let k = 0; k < 3; k++) { const q = (tq * 0.5 + k / 3) % 1; c.globalAlpha = 1 - q; c.fillText('z', bw * 0.45 + q * 70 * s, top - q * 120 * s); } c.globalAlpha = 1; }
    if (pose === 'surprised') { for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.42, j = (drawing(lt) % 2) * 8 * s; tube(c, (cc) => { cc.moveTo(Math.cos(a) * (bw * 0.72 + j), top + bh * 0.3 + Math.sin(a) * (bh * 0.64 + j)); cc.lineTo(Math.cos(a) * (bw * 0.86 + j), top + bh * 0.3 + Math.sin(a) * (bh * 0.78 + j)); }, 12 * s, 'yellow'); } }
    c.restore();
  }
  /** buddy(x, y, o): a clay character standing with its feet on (x, y) — a soft gumdrop body with big glossy eyes, stubby
   *  rolled arms and two little feet, about o.size px tall (default 420). It moves on twos with a slight boil.
   *  o: { size, body (colour name, fn: the character's one colour — keep it the same all film), face: 'r'|'l' (which way
   *  it faces; fn), pose (fn): 'idle' 'bounce' 'wave' 'point' 'cheer' 'think' 'surprised' 'sad' 'shrug' 'walk' 'run'
   *  'jump' 'hold' 'sleepy' 'sit', mood (fn; default follows the pose): 'happy' 'laugh' 'think' 'worried' 'sad' 'shock'
   *  'angry' 'sleepy' 'sly', hat: 'beanie' 'cap' 'bow' 'leaf' 'antenna' 'tuft', accent (hat colour), glasses, belly
   *  (colour of a tummy patch), shoes (foot colour), holds (fn): a prop kind carried in the front hand, look (-1..1),
   *  at, out }. x and y may be functions of lt (walk it across: x: lt => lerp(300, 900, PV.K(lt, 2, 3))). */
  B.buddy = function (x, y, o = {}) {
    const size = o.size ?? 420, s = size / 340, cw = 560 * s, chh = 640 * s, seed = SEED++;
    return mount(this, cw, chh, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - cw / 2, y: val(y, lt) - 520 * s }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), [kx, ky] = sqs(k), [bx, by, br] = boil(seed, lt);
      c.translate(cw / 2 + bx, 520 * s + by); c.rotate(br); c.scale(kx, ky);
      if (val(o.face, lt, 'r') === 'l') c.scale(-1, 1);
      drawBuddy(c, o, lt, seed);
    }, (lt) => [val(o.pose, lt), val(o.mood, lt), val(o.face, lt), val(o.holds, lt), val(o.body, lt)].join());
  };

  // ─────────────────────────── props ───────────────────────────
  // each drawn in a box of o.size px centred on (0, 0) unless noted; standing props have their base at y = +size/2
  function face(c, x, y, s, mood, lt, seed) {
    const blink = ((drawing(lt) + seed * 11) % 41) < 2;
    [-1, 1].forEach((d) => eye(c, x + d * 18 * s, y, 12 * s, 0.2, 0.1, blink, '#3B2A26', mood === 'shock' ? 'shock' : 'happy'));
    mouth(c, mood || 'happy', x, y + 20 * s, 0.5 * s);
  }
  function drawProp(c, kind, o, lt, seed) {
    const S = o.size ?? 200, u = S / 200, tq = step(lt);
    const color = (d) => val(o.color, lt, null) || d;
    const sp = (name, w, hh, colr, mask, opt) => clay(kind + ':' + name + ':' + S, w, hh, colr, mask, opt);
    let fy = 0, fc = o.face;   // where a face goes
    if (kind === 'ball' || kind === 'planet') {
      if (kind === 'planet') tube(c, (cc) => cc.ellipse(0, 0, 150 * u, 36 * u, -0.25, Math.PI * 1.02, Math.PI * 1.98), 16 * u, color('orange') === 'orange' ? 'yellow' : 'orange');
      put(c, sp('b', 200 * u, 200 * u, color(kind === 'planet' ? 'blue' : 'red'), (g) => g.fill(circ(100 * u, 100 * u, 92 * u))), 0, 0, 100 * u, 100 * u);
      if (kind === 'planet') { c.save(); c.globalAlpha = 0.5; [[-30, -20, 30, 'greenF'], [34, 26, 22, 'greenF']].forEach(([x, y, r, cc]) => ball(c, x * u, y * u, r * u, cc)); c.restore(); tube(c, (cc) => cc.ellipse(0, 0, 150 * u, 36 * u, -0.25, Math.PI * 0.02, Math.PI * 0.98), 16 * u, color('orange') === 'orange' ? 'yellow' : 'orange'); }
    } else if (kind === 'sun') {
      const rot = tq * 0.4;
      for (let i = 0; i < 10; i++) { const a = rot + i / 10 * Math.PI * 2; c.save(); c.translate(Math.cos(a) * 112 * u, Math.sin(a) * 112 * u); c.rotate(a + Math.PI / 2); put(c, sp('ray', 50 * u, 70 * u, color('yellow'), (g) => g.fill(ell(25 * u, 35 * u, 18 * u, 28 * u)), { prints: false }), 0, 0, 25 * u, 35 * u); c.restore(); }
      put(c, sp('core', 190 * u, 190 * u, color('yellow'), (g) => g.fill(circ(95 * u, 95 * u, 82 * u))), 0, 0, 95 * u, 95 * u);
    } else if (kind === 'moon') {
      put(c, sp('m', 200 * u, 200 * u, color('yellowF'), (g) => { g.fill(circ(100 * u, 100 * u, 86 * u)); g.globalCompositeOperation = 'destination-out'; g.fill(circ(140 * u, 76 * u, 70 * u)); }), 0, 0, 100 * u, 100 * u); fy = 10 * u;
    } else if (kind === 'heart') {
      const beat = 1 + 0.06 * Math.max(0, Math.sin(tq * 8));
      c.save(); c.scale(beat, beat); put(c, sp('h', 210 * u, 210 * u, color('red'), (g) => g.fill(smooth(heartPts(105 * u, 100 * u, 92 * u)))), 0, 0, 105 * u, 105 * u); c.restore(); fy = -6 * u;
    } else if (kind === 'brain') {
      put(c, sp('br', 230 * u, 190 * u, color('pink'), (g) => { [[70, 80, 58], [118, 62, 62], [165, 84, 54], [92, 120, 56], [146, 124, 54]].forEach(([x, y, r]) => g.fill(circ(x * u, y * u, r * u))); }, { box: [12 * u, 4 * u, 206 * u, 176 * u] }), 0, 0, 115 * u, 95 * u);
      const dk = shade(color('pink'), -0.3);
      [[[-70, -20], [-40, -40], [-10, -18]], [[10, -50], [30, -20], [60, -40]], [[-60, 30], [-30, 10], [0, 36]], [[20, 20], [50, 40], [76, 14]], [[0, -60], [0, -10], [-4, 50]]].forEach((pts) => {
        c.save(); c.lineCap = 'round'; c.lineWidth = 7 * u; c.strokeStyle = dk; c.globalAlpha = 0.55; c.beginPath(); c.moveTo(pts[0][0] * u, pts[0][1] * u); c.quadraticCurveTo(pts[1][0] * u, pts[1][1] * u, pts[2][0] * u, pts[2][1] * u); c.stroke();
        c.strokeStyle = 'rgba(255,250,240,0.6)'; c.lineWidth = 3 * u; c.translate(-3 * u, -3 * u); c.stroke(); c.restore();
      });
    } else if (kind === 'cloud') {
      put(c, sp('c', 260 * u, 170 * u, color('paper'), (g) => { [[70, 105, 52], [120, 72, 64], [178, 92, 54], [130, 115, 50], [205, 118, 40]].forEach(([x, y, r]) => g.fill(circ(x * u, y * u, r * u))); }, { box: [16 * u, 8 * u, 232 * u, 152 * u] }), 0, 0, 130 * u, 95 * u); fy = 18 * u;
    } else if (kind === 'drop') {
      put(c, sp('d', 170 * u, 220 * u, color('blue'), (g) => g.fill(smooth([[85 * u, 10 * u], [120 * u, 80 * u], [150 * u, 140 * u], [130 * u, 196 * u], [85 * u, 212 * u], [40 * u, 196 * u], [20 * u, 140 * u], [50 * u, 80 * u]]))), 0, 0, 85 * u, 120 * u); fy = 30 * u;
    } else if (kind === 'coin') {
      const spin = Math.abs(Math.cos(tq * (o.spin ? 5 : 0)));
      c.save(); c.scale(Math.max(0.2, spin), 1);
      put(c, sp('edge', 200 * u, 200 * u, shade(color('yellow'), -0.2), (g) => g.fill(circ(100 * u, 100 * u, 90 * u)), { prints: false }), 6 * u, 8 * u, 100 * u, 100 * u);
      put(c, sp('face', 200 * u, 200 * u, color('yellow'), (g) => g.fill(circ(100 * u, 100 * u, 86 * u)), {
        after: (g) => { g.lineWidth = 7 * u; g.strokeStyle = 'rgba(150,95,20,0.35)'; g.beginPath(); g.arc(100 * u, 100 * u, 66 * u, 0, 7); g.stroke(); g.font = `400 ${96 * u}px "Archivo Black"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,250,235,0.7)'; g.fillText(o.mark ?? '$', 102 * u, 106 * u); g.fillStyle = 'rgba(150,95,20,0.6)'; g.fillText(o.mark ?? '$', 99 * u, 102 * u); },
      }), 0, 0, 100 * u, 100 * u);
      c.restore(); fc = false;
    } else if (kind === 'clock') {
      [-1, 1].forEach((d) => ball(c, d * 62 * u, -78 * u, 26 * u, color('red')));
      put(c, sp('rim', 220 * u, 220 * u, color('red'), (g) => g.fill(circ(110 * u, 110 * u, 96 * u))), 0, 0, 110 * u, 110 * u);
      put(c, sp('dial', 170 * u, 170 * u, 'paper', (g) => g.fill(circ(85 * u, 85 * u, 72 * u)), { gloss: 0.3, prints: false }), 0, 0, 85 * u, 85 * u);
      const tm = val(o.time, lt, tq * 0.6);
      tube(c, (cc) => { cc.moveTo(0, 0); cc.lineTo(Math.sin(tm * Math.PI / 6) * 36 * u, -Math.cos(tm * Math.PI / 6) * 36 * u); }, 11 * u, 'ink');
      tube(c, (cc) => { cc.moveTo(0, 0); cc.lineTo(Math.sin(tm * Math.PI * 2) * 56 * u, -Math.cos(tm * Math.PI * 2) * 56 * u); }, 8 * u, 'ink');
      ball(c, 0, 0, 10 * u, 'red'); fc = false;
      if (val(o.ring, lt)) c.rotate(((drawing(lt) % 2) ? 1 : -1) * 0.08);
    } else if (kind === 'bulb') {
      if (val(o.on, lt, true)) { const g = c.createRadialGradient(0, -20 * u, 20 * u, 0, -20 * u, 190 * u); g.addColorStop(0, 'rgba(255,236,150,0.75)'); g.addColorStop(1, 'rgba(255,236,150,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, -20 * u, 190 * u, 0, 7); c.fill(); }
      put(c, sp('base', 90 * u, 70 * u, 'muted', (g) => { for (let i = 0; i < 3; i++) g.fill(rrect(6 * u, (6 + i * 18) * u, 78 * u, 16 * u, 8 * u)); }, { prints: false }), 0, 78 * u, 45 * u, 20 * u);
      put(c, sp('glass', 180 * u, 190 * u, color('yellow'), (g) => g.fill(smooth([[90 * u, 8 * u], [160 * u, 50 * u], [158 * u, 112 * u], [122 * u, 160 * u], [118 * u, 186 * u], [62 * u, 186 * u], [58 * u, 160 * u], [22 * u, 112 * u], [20 * u, 50 * u]])), { gloss: 1.3 }), 0, -24 * u, 90 * u, 95 * u); fy = -30 * u;
    } else if (kind === 'apple') {
      tube(c, (cc) => { cc.moveTo(0, -78 * u); cc.quadraticCurveTo(6 * u, -100 * u, -4 * u, -118 * u); }, 11 * u, 'soft');
      put(c, sp('a', 210 * u, 200 * u, color('red'), (g) => g.fill(smooth([[105 * u, 30 * u], [160 * u, 18 * u], [198 * u, 80 * u], [168 * u, 170 * u], [105 * u, 190 * u], [42 * u, 170 * u], [12 * u, 80 * u], [50 * u, 18 * u]]))), 0, 0, 105 * u, 100 * u);
      put(c, sp('leaf', 90 * u, 60 * u, 'green', (g) => g.fill(smooth([[8 * u, 46 * u], [40 * u, 8 * u], [84 * u, 14 * u], [48 * u, 50 * u]]))), 2 * u, -100 * u, 6 * u, 46 * u);
    } else if (kind === 'cup') {
      for (let k = 0; k < 3; k++) { const q = (tq * 0.7 + k / 3) % 1; c.save(); c.globalAlpha = (1 - q) * 0.7; tube(c, (cc) => { cc.moveTo((k - 1) * 30 * u, -70 * u - q * 70 * u); cc.quadraticCurveTo((k - 1) * 30 * u + 16 * u, -100 * u - q * 70 * u, (k - 1) * 30 * u, -130 * u - q * 70 * u); }, 12 * u, 'paper'); c.restore(); }
      tube(c, (cc) => cc.ellipse(78 * u, 10 * u, 34 * u, 40 * u, 0, -1.4, 1.4), 20 * u, color('blue'));
      put(c, sp('mug', 180 * u, 170 * u, color('blue'), (g) => g.fill(rrect(10 * u, 10 * u, 160 * u, 150 * u, 36 * u))), 0, 10 * u, 90 * u, 85 * u);
      c.fillStyle = '#7A4A30'; c.beginPath(); c.ellipse(0, -62 * u, 66 * u, 12 * u, 0, 0, 7); c.fill();
    } else if (kind === 'phone') {
      const buzz = val(o.ring, lt) ? ((drawing(lt) % 2) ? 4 : -4) : 0; c.translate(buzz, 0);
      put(c, sp('ph', 130 * u, 220 * u, color('ink'), (g) => g.fill(rrect(8 * u, 8 * u, 114 * u, 204 * u, 26 * u)), { gloss: 0.6 }), 0, 0, 65 * u, 110 * u);
      put(c, sp('scr', 100 * u, 160 * u, 'blueF', (g) => g.fill(rrect(4 * u, 4 * u, 92 * u, 150 * u, 14 * u)), { prints: false, gloss: 1.4 }), 0, -6 * u, 50 * u, 80 * u); fy = -6 * u;
    } else if (kind === 'book') {
      put(c, sp('cov', 240 * u, 170 * u, color('green'), (g) => { g.fill(rrect(6 * u, 20 * u, 112 * u, 140 * u, 16 * u)); g.fill(rrect(122 * u, 20 * u, 112 * u, 140 * u, 16 * u)); }), 0, 0, 120 * u, 90 * u);
      put(c, sp('pg', 220 * u, 150 * u, 'paper', (g) => { g.fill(rrect(8 * u, 10 * u, 100 * u, 126 * u, 10 * u)); g.fill(rrect(112 * u, 10 * u, 100 * u, 126 * u, 10 * u)); }, { prints: false }), 0, -8 * u, 110 * u, 80 * u);
      c.save(); c.strokeStyle = 'rgba(120,80,60,0.35)'; c.lineWidth = 5 * u; c.lineCap = 'round'; for (let i = 0; i < 4; i++) [-1, 1].forEach((d) => { c.beginPath(); c.moveTo(d * 20 * u, (-40 + i * 22) * u); c.lineTo(d * 84 * u, (-40 + i * 22) * u); c.stroke(); }); c.restore(); fc = false;
    } else if (kind === 'rocket') {
      if (val(o.fly, lt, true)) { const f = 1 + (drawing(lt) % 2) * 0.18; put(c, sp('fl', 90 * u, 140 * u, 'orange', (g) => g.fill(smooth([[45 * u, 130 * u], [70 * u, 60 * u], [60 * u, 10 * u], [30 * u, 10 * u], [20 * u, 60 * u]])), { prints: false }), 0, 118 * u, 45 * u, 20 * u * f); }
      [-1, 1].forEach((d) => put(c, sp('fin' + d, 90 * u, 110 * u, color('red'), (g) => g.fill(smooth(d < 0 ? [[80 * u, 10 * u], [80 * u, 90 * u], [10 * u, 104 * u], [20 * u, 60 * u]] : [[10 * u, 10 * u], [10 * u, 90 * u], [80 * u, 104 * u], [70 * u, 60 * u]]))), d * 56 * u, 50 * u, 45 * u, 55 * u));
      put(c, sp('body', 150 * u, 270 * u, 'paper', (g) => g.fill(smooth([[75 * u, 6 * u], [128 * u, 80 * u], [132 * u, 200 * u], [110 * u, 262 * u], [40 * u, 262 * u], [18 * u, 200 * u], [22 * u, 80 * u]]))), 0, -10 * u, 75 * u, 140 * u);
      put(c, sp('win', 80 * u, 80 * u, color('blue'), (g) => g.fill(circ(40 * u, 40 * u, 32 * u)), { gloss: 1.5 }), 0, -40 * u, 40 * u, 40 * u); fc = false;
    } else if (kind === 'star') {
      put(c, sp('s', 220 * u, 220 * u, color('yellow'), (g) => { g.lineWidth = 34 * u; const p = new Path2D(); star(110 * u, 116 * u, 82 * u, 38 * u).forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); g.fill(p); g.stroke(p); }), 0, 0, 110 * u, 110 * u); fy = 8 * u;
    } else if (kind === 'gear') {
      c.rotate(tq * (o.spin ?? 0.8));
      put(c, sp('g', 230 * u, 230 * u, color('muted'), (g) => { g.lineWidth = 16 * u; const p = new Path2D(); const n = 9; for (let i = 0; i < n * 4; i++) { const a = i / (n * 4) * Math.PI * 2, r = (i % 4 < 2 ? 100 : 76) * u; const x = 115 * u + Math.cos(a) * r, y = 115 * u + Math.sin(a) * r; i ? p.lineTo(x, y) : p.moveTo(x, y); } p.closePath(); g.fill(p); g.stroke(p); g.globalCompositeOperation = 'destination-out'; g.fill(circ(115 * u, 115 * u, 30 * u)); }), 0, 0, 115 * u, 115 * u); fc = false;
    } else if (kind === 'battery') {
      const lv = clamp(val(o.level, lt, 0.7));
      put(c, sp('cap', 70 * u, 40 * u, 'muted', (g) => g.fill(rrect(8 * u, 6 * u, 54 * u, 30 * u, 10 * u)), { prints: false }), 0, -104 * u, 35 * u, 20 * u);
      put(c, sp('shell', 150 * u, 230 * u, 'paper', (g) => g.fill(rrect(8 * u, 8 * u, 134 * u, 214 * u, 30 * u)), { gloss: 0.8 }), 0, 0, 75 * u, 115 * u);
      const lc = lv > 0.5 ? 'green' : lv > 0.2 ? 'yellow' : 'red', hh = 170 * u * lv;
      if (hh > 4) { c.save(); c.beginPath(); c.roundRect(-52 * u, 85 * u - hh, 104 * u, hh, 18 * u); c.clip(); put(c, sp('lv' + lc, 110 * u, 180 * u, lc, (g) => g.fill(rrect(3 * u, 3 * u, 104 * u, 174 * u, 18 * u)), { prints: false }), 0, -2 * u, 55 * u, 87 * u); c.restore(); } fy = -150 * u; fc = false;
    } else if (kind === 'tree') {
      shadow(c, 0, 100 * u, 90 * u, 0.3);
      tube(c, (cc) => { cc.moveTo(0, 96 * u); cc.quadraticCurveTo(-6 * u, 30 * u, 4 * u, -20 * u); }, 40 * u, '#9A6440');
      put(c, sp('can', 240 * u, 200 * u, color('green'), (g) => { [[70, 110, 62], [120, 70, 72], [176, 108, 60], [122, 130, 62]].forEach(([x, y, r]) => g.fill(circ(x * u, y * u, r * u))); }, { box: [8 * u, 0, 224 * u, 196 * u] }), 0, -64 * u, 120 * u, 100 * u); fy = -70 * u;
    } else if (kind === 'house') {
      shadow(c, 0, 96 * u, 130 * u, 0.3);
      put(c, sp('wall', 200 * u, 150 * u, color('paper'), (g) => g.fill(rrect(10 * u, 8 * u, 180 * u, 136 * u, 18 * u))), 0, 30 * u, 100 * u, 75 * u);
      put(c, sp('roof', 250 * u, 130 * u, 'red', (g) => { g.lineWidth = 30 * u; const p = new Path2D(); p.moveTo(24 * u, 112 * u); p.lineTo(125 * u, 22 * u); p.lineTo(226 * u, 112 * u); p.closePath(); g.fill(p); g.stroke(p); }), 0, -66 * u, 125 * u, 70 * u);
      put(c, sp('door', 60 * u, 90 * u, '#9A6440', (g) => g.fill(rrect(4 * u, 4 * u, 52 * u, 86 * u, 24 * u)), { prints: false }), 30 * u, 60 * u, 30 * u, 45 * u);
      put(c, sp('win', 56 * u, 56 * u, 'yellowF', (g) => g.fill(rrect(4 * u, 4 * u, 48 * u, 48 * u, 12 * u)), { prints: false, gloss: 1.2 }), -44 * u, 26 * u, 28 * u, 28 * u); fc = false;
    } else if (kind === 'cell') {
      c.save(); c.globalAlpha = 0.85; put(c, sp('mem', 240 * u, 200 * u, color('greenF'), (g) => g.fill(smooth([[30 * u, 100 * u], [60 * u, 30 * u], [140 * u, 14 * u], [212 * u, 60 * u], [222 * u, 140 * u], [160 * u, 190 * u], [70 * u, 182 * u]]))), 0, 0, 120 * u, 100 * u); c.restore();
      put(c, sp('nuc', 100 * u, 90 * u, 'purple', (g) => g.fill(ell(50 * u, 45 * u, 40 * u, 34 * u))), -10 * u, -4 * u, 50 * u, 45 * u);
      [[-60, 40, 'orange'], [60, -30, 'pink'], [56, 46, 'yellow']].forEach(([x, y, cc]) => ball(c, x * u, y * u, 14 * u, cc)); fc = false;
    } else if (kind === 'flame') {
      const f = (drawing(lt) % 3) * 0.04;
      c.save(); c.scale(1 - f, 1 + f);
      put(c, sp('o', 170 * u, 230 * u, color('orange'), (g) => g.fill(smooth([[85 * u, 8 * u], [120 * u, 70 * u], [158 * u, 130 * u], [140 * u, 200 * u], [85 * u, 224 * u], [30 * u, 200 * u], [12 * u, 130 * u], [56 * u, 90 * u], [60 * u, 40 * u]])), { prints: false }), 0, -10 * u, 85 * u, 120 * u);
      put(c, sp('i', 100 * u, 140 * u, 'yellow', (g) => g.fill(smooth([[50 * u, 8 * u], [80 * u, 70 * u], [86 * u, 110 * u], [50 * u, 134 * u], [14 * u, 110 * u], [24 * u, 60 * u]])), { prints: false }), 0, 30 * u, 50 * u, 70 * u);
      c.restore(); fy = 50 * u;
    } else if (kind === 'block') {
      const cc = color('blue'), d = 46;   // a toy block: front face, top and right side in one volume
      const front = [[14, 14 + d], [150, 14 + d], [150, 196], [14, 196]], top = [[14, 14 + d], [14 + d, 14], [150 + d, 14], [150, 14 + d]], side = [[150, 14 + d], [150 + d, 14], [150 + d, 150], [150, 196]];
      const poly = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x * u, y * u) : p.moveTo(x * u, y * u))); p.closePath(); return p; };
      put(c, sp('cube', 230 * u, 230 * u, cc, (g) => { g.lineWidth = 26 * u; [front, top, side].forEach((f) => { const p = poly(f); g.fill(p); g.stroke(p); }); }, {
        box: [0, 0, 220 * u, 220 * u], prints: false,
        after: (g) => {
          g.save(); g.globalCompositeOperation = 'source-atop';
          g.fillStyle = 'rgba(255,250,240,0.28)'; g.lineWidth = 26 * u; g.strokeStyle = 'rgba(0,0,0,0)'; g.fill(poly([[0, 0], [14 + d, 0], [230, 0], [230, 6], [150, 14 + d + 4], [0, 14 + d + 4]]));
          g.fillStyle = 'rgba(70,28,14,0.22)'; g.fill(poly([[150 + 4, 14 + d + 4], [230, 0], [230, 230], [150 + 4, 230]]));
          g.restore();
          if (o.label) { g.font = `${/[\u3400-\u9fff]/.test(o.label) ? '900' : '400'} ${(String(o.label).length > 2 ? 54 : 88) * u}px "Archivo Black", "Noto Sans SC Variable"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,250,240,0.6)'; g.fillText(o.label, 84 * u, 134 * u); g.fillStyle = shade(cc, -0.5); g.fillText(o.label, 82 * u, 131 * u); }
        },
      }), 0, 0, 100 * u, 112 * u); fc = false;
    } else if (kind === 'bed') {
      put(c, sp('frame', 300 * u, 150 * u, '#9A6440', (g) => { g.fill(rrect(8 * u, 10 * u, 40 * u, 136 * u, 18 * u)); g.fill(rrect(10 * u, 80 * u, 280 * u, 46 * u, 20 * u)); }), 0, 0, 150 * u, 80 * u);
      put(c, sp('blanket', 230 * u, 90 * u, color('blue'), (g) => g.fill(rrect(6 * u, 10 * u, 218 * u, 74 * u, 34 * u))), 34 * u, -22 * u, 115 * u, 45 * u);
      put(c, sp('pillow', 100 * u, 70 * u, 'paper', (g) => g.fill(ell(50 * u, 35 * u, 44 * u, 26 * u)), { prints: false }), -86 * u, -40 * u, 50 * u, 35 * u); fc = false;
    } else if (kind === 'bag') {
      put(c, sp('bag', 220 * u, 230 * u, color('yellow'), (g) => { g.fill(smooth([[110 * u, 52 * u], [180 * u, 110 * u], [196 * u, 190 * u], [110 * u, 222 * u], [24 * u, 190 * u], [40 * u, 110 * u]])); g.fill(smooth([[80 * u, 60 * u], [70 * u, 20 * u], [110 * u, 34 * u], [150 * u, 20 * u], [140 * u, 60 * u]])); }, {
        after: (g) => { g.font = `400 ${90 * u}px "Archivo Black"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,250,240,0.6)'; g.fillText(o.mark ?? '$', 113 * u, 156 * u); g.fillStyle = 'rgba(140,90,20,0.6)'; g.fillText(o.mark ?? '$', 110 * u, 152 * u); },
      }), 0, 0, 110 * u, 125 * u); tube(c, (cc) => { cc.moveTo(-40 * u, -62 * u); cc.lineTo(40 * u, -62 * u); }, 14 * u, 'red'); fc = false;
    } else if (kind === 'arrow') {
      c.rotate(val(o.dir, lt, 0));
      put(c, sp('ar', 240 * u, 150 * u, color('red'), (g) => { g.lineWidth = 26 * u; const p = new Path2D(); p.moveTo(20 * u, 56 * u); p.lineTo(140 * u, 56 * u); p.lineTo(140 * u, 22 * u); p.lineTo(220 * u, 75 * u); p.lineTo(140 * u, 128 * u); p.lineTo(140 * u, 94 * u); p.lineTo(20 * u, 94 * u); p.closePath(); g.fill(p); g.stroke(p); }), 0, 0, 120 * u, 75 * u); fc = false;
    } else if (kind === 'pill') {
      c.rotate(-0.5);
      put(c, sp('p', 240 * u, 110 * u, color('red'), (g) => g.fill(rrect(10 * u, 10 * u, 220 * u, 90 * u, 45 * u)), { after: (g) => { g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,250,240,0.85)'; g.fillRect(120 * u, 0, 120 * u, 110 * u); g.restore(); } }), 0, 0, 120 * u, 55 * u); fc = false;
    } else {
      put(c, sp('x', 200 * u, 200 * u, color('orange'), (g) => g.fill(circ(100 * u, 100 * u, 90 * u))), 0, 0, 100 * u, 100 * u);
    }
    if (fc) face(c, 0, fy, u * 1.6, val(o.mood, lt, 'happy'), lt, seed);
  }
  /** prop(kind, x, y, o): a clay object centred on (x, y), about o.size px (default 230), with a soft contact shadow on
   *  the floor below it (o.ground: the floor y, default y + size/2; o.float: true hangs it in the air with a fainter
   *  shadow further down and a slow bob). kinds: 'ball' 'planet' 'sun' 'moon' 'heart' 'brain' 'cloud' 'drop' 'coin'
   *  (o.mark: '$' '¥' …, o.spin) 'clock' (o.time hours fn, o.ring fn) 'bulb' (o.on fn) 'apple' 'cup' (steaming) 'phone'
   *  (o.ring fn) 'book' 'rocket' (o.fly) 'star' 'gear' (spins) 'battery' (o.level 0..1 fn) 'tree' 'house' 'cell' 'flame'
   *  'block' (a toy block, o.label: a digit, letter or one 汉字) 'bed' 'bag' (money bag, o.mark) 'arrow' (o.dir radians,
   *  fn) 'pill'. o: { size, color (fn), face (true: a little clay face — props with faces are very claymation), mood
   *  (fn), at, out, x and y may be fns }. */
  B.prop = function (kind, x, y, o = {}) {
    const size = o.size ?? 230, u = size / 200, cw = 460 * u, chh = 520 * u, seed = SEED++;
    return mount(this, cw, chh, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - cw / 2, y: val(y, lt) - 260 * u }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), [kx, ky] = sqs(k), [bx, by, br] = boil(seed, lt), tq = step(lt);
      const bob = o.float ? Math.sin(tq * 2.2 + seed) * 10 * u : 0;
      const gy = o.float ? size * 0.5 + 70 * u : (o.ground != null ? o.ground - val(y, lt) : size * 0.5);
      if (kind !== 'tree' && kind !== 'house') shadow(c, cw / 2, 260 * u + gy, size * 0.48 * (o.float ? 0.8 : 1), o.float ? 0.16 : 0.3);
      c.translate(cw / 2 + bx, 260 * u + by + bob); c.rotate(br);
      c.translate(0, size * 0.5); c.scale(kx, ky); c.translate(0, -size * 0.5);
      drawProp(c, val(kind, lt), o, lt, seed);
    }, (lt) => [val(o.color, lt), val(o.mood, lt), val(o.ring, lt), val(o.on, lt), val(o.level, lt), val(o.time, lt), val(o.dir, lt), val(kind, lt)].join());
  };

  /** lump(shape, x, y, o): any object the prop list lacks, modelled in clay and centred on (x, y) — a popcorn kernel, a
   *  tooth, a seed, a lung, a mountain, a piece of a pie. shape: { circle: r } | { ellipse: [rx, ry] } | { rect: [w, h,
   *  radius] } | { blob: [[x, y], …] } (points around the outline, relative to the centre; the kit rounds them into a soft
   *  shape) | { poly: [[x, y], …] } (a shape with soft corners: triangles, stars, a slice). o: { color (fn), face (true:
   *  a little clay face), mood (fn), rot (radians, fn), float, ground (floor y), label (a word or number pressed into
   *  it), at, out, x and y may be fns }. Combine a few lumps for a compound object (a kernel's halves, a bun and a
   *  sausage); keep each ≥ 80 px. */
  B.lump = function (shape, x, y, o = {}) {
    const pts = shape.blob || shape.poly, b = shape.circle != null ? [shape.circle, shape.circle] : shape.ellipse ? shape.ellipse : shape.rect ? [shape.rect[0] / 2, shape.rect[1] / 2] : [Math.max(...pts.map((p) => Math.abs(p[0]))), Math.max(...pts.map((p) => Math.abs(p[1])))];
    const rx = b[0], ry = b[1], pad = 40, sw = rx * 2 + pad * 2, sh = ry * 2 + pad * 2, seed = SEED++, key = 'lump:' + JSON.stringify(shape) + (o.label || '');
    const R = Math.max(rx, ry), cw = sw + 120, chh = sh + 160;
    return mount(this, cw, chh, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: val(x, lt) - cw / 2, y: val(y, lt) - chh / 2 }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), [kx, ky] = sqs(k), [bx, by, br] = boil(seed, lt), tq = step(lt), colr = val(o.color, lt, 'orange');
      const bob = o.float ? Math.sin(tq * 2.2 + seed) * 10 : 0, gy = o.float ? ry + 70 : (o.ground != null ? o.ground - val(y, lt) : ry);
      shadow(c, cw / 2, chh / 2 + gy, rx * (o.float ? 0.8 : 1), o.float ? 0.16 : 0.3);
      const sp = clay(key, sw, sh, colr, (g) => {
        g.translate(sw / 2, sh / 2);
        if (shape.circle != null) g.fill(circ(0, 0, rx));
        else if (shape.ellipse) g.fill(ell(0, 0, rx, ry));
        else if (shape.rect) g.fill(rrect(-rx, -ry, rx * 2, ry * 2, shape.rect[2] ?? Math.min(rx, ry) * 0.4));
        else if (shape.blob) g.fill(smooth(pts));
        else { g.lineWidth = Math.max(12, R * 0.18); const p = new Path2D(); pts.forEach(([px, py], i) => (i ? p.lineTo(px * 0.9, py * 0.9) : p.moveTo(px * 0.9, py * 0.9))); p.closePath(); g.fill(p); g.stroke(p); }
      }, {
        box: [pad, pad, rx * 2, ry * 2],
        after: o.label ? (g) => { const L = String(o.label), fs = Math.min(ry * 0.9, (rx * 1.6) / Math.max(1, [...L].length) * (/[\u2E80-\u9fff]/.test(L) ? 1 : 1.6)); g.font = /[\u2E80-\u9fff]/.test(L) ? `900 ${fs}px "Noto Sans SC Variable"` : `400 ${fs}px "Archivo Black"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,252,245,0.7)'; g.fillText(L, sw / 2 + 1.5, sh / 2 + 2.5); g.fillStyle = shade(colr, -0.6); g.fillText(L, sw / 2, sh / 2); } : null,
      });
      c.translate(cw / 2 + bx, chh / 2 + by + bob); c.rotate(br + val(o.rot, lt, 0)); c.translate(0, ry); c.scale(kx, ky); c.translate(0, -ry);
      put(c, sp, 0, 0, sw / 2, sh / 2);
      if (o.face) face(c, 0, -ry * 0.1, Math.max(0.7, R / 70), val(o.mood, lt, 'happy'), lt, seed);
    }, (lt) => [val(o.color, lt), val(o.mood, lt), val(o.rot, lt)].join());
  };

  // ─────────────────────────── clay type ───────────────────────────
  const isCJK = (ch) => /[⺀-鿿＀-￯　-〿]/.test(ch);
  const fontFor = (ch, size) => (isCJK(ch) ? `900 ${size}px "Noto Sans SC Variable", "PingFang SC", sans-serif` : `400 ${size}px "Archivo Black", "Noto Sans SC Variable", sans-serif`);
  const measure = (() => { const c = document.createElement('canvas').getContext('2d'); return (ch, size) => { c.font = fontFor(ch, size); return c.measureText(ch).width; }; })();
  function glyph(ch, size, color) {
    const cw = measure(ch, size), w = cw + size * 0.5, hh = size * 1.5, bl = size * 1.12;
    const face = clay('g:' + ch + ':' + size, w, hh, color, (g) => { g.font = fontFor(ch, size); g.lineWidth = size * (isCJK(ch) ? 0.085 : /[!?.,:;]/.test(ch) ? 0.05 : 0.12); g.fillText(ch, size * 0.25, bl); g.strokeText(ch, size * 0.25, bl); }, { box: [size * 0.2, size * 0.25, cw + size * 0.1, size * 0.95], rim: clamp(size * 0.035, 2, 7), prints: size > 150 });
    const side = clay('gs:' + ch + ':' + size, w, hh, shade(color, -0.3), (g) => { g.font = fontFor(ch, size); g.lineWidth = size * (isCJK(ch) ? 0.085 : /[!?.,:;]/.test(ch) ? 0.05 : 0.12); g.fillText(ch, size * 0.25, bl); g.strokeText(ch, size * 0.25, bl); }, { prints: false, gloss: 0, rim: 1.5 });
    return { face, side, adv: cw * (isCJK(ch) ? 1.02 : 1.06), w, hh, bl };
  }
  /** lay out a string as clay glyphs: returns [{ g, x }] and total width */
  function layout(str, size, colorOf) {
    let x = 0; const out = [];
    [...String(str)].forEach((ch, i) => { if (ch === ' ') { x += size * 0.32; return; } const g = glyph(ch, size, colorOf(i, ch)); out.push({ g, x, i }); x += g.adv + size * (isCJK(ch) ? 0.03 : 0.1); });
    return { glyphs: out, width: x };
  }
  function drawGlyphs(c, lay, size, x0, base, lt, at, stagger, seed, o) {
    lay.glyphs.forEach(({ g, x, i }) => {
      const k = pop(lt, at + i * stagger, o.out);
      if (k <= 0) return;
      const [kx, ky] = sqs(k), [bx, by, br] = boil(seed + i * 17, lt, 0.7), cx = x0 + x + g.adv / 2;
      shadow(c, cx, base + size * 0.1, g.adv * 0.58, 0.3 * Math.min(1, k));
      c.save(); c.translate(cx + bx, base + by); c.rotate(br + (o.tilt ? Math.sin(i * 2.3 + seed) * o.tilt : 0)); c.scale(kx, ky);
      put(c, g.side, 0, size * 0.06, g.adv / 2 + size * 0.25 - (g.adv - g.w + size * 0.5) / 2, g.bl);
      put(c, g.face, 0, 0, g.adv / 2 + size * 0.25 - (g.adv - g.w + size * 0.5) / 2, g.bl);
      c.restore();
    });
  }
  const hiColors = (str, o) => {   // {word} marks the accent colour
    const plain = []; const col = []; let inHi = false;
    for (const ch of String(str)) { if (ch === '{') { inHi = true; continue; } if (ch === '}') { inHi = false; continue; } plain.push(ch); col.push(inHi); }
    const cycle = o.colors || null;
    return { text: plain.join(''), colorOf: (i) => (col[i] ? (o.hi || 'red') : cycle ? cycle[i % cycle.length] : (o.color || 'paper')) };
  };
  /** letters(str, x, y, o): big chunky clay letters standing on the baseline y — each glyph a rolled, pressed slab with
   *  depth and a contact shadow, popping in one after another with squash. The signature for a key word, a short title or
   *  a number on screen. {word} paints that word in o.hi. o: { size (default 160; 120–260), color (default 'paper',
   *  white clay), colors (a list cycled per glyph, e.g. ['red','yellow','blue','green'] for a playful word), hi,
   *  align: 'left' | 'center' (x is the centre) | 'right', at, stagger (s between glyphs, default 0.07), tilt (radians of
   *  random lean per glyph, e.g. 0.06), out }. Keep it to 2–8 characters. */
  B.letters = function (str, x, y, o = {}) {
    const size = o.size ?? 160, seed = SEED++, { text, colorOf } = hiColors(str, o);
    const lay = layout(text, size, colorOf), pad = size * 0.6;
    const x0 = o.align === 'center' ? x - lay.width / 2 : o.align === 'right' ? x - lay.width : x;
    const cw = lay.width + pad * 2, chh = size * 1.9;
    return mount(this, cw, chh, (lt) => (lt < (o.at ?? 0) - 0.01 || (o.out != null && lt > o.out + 0.4) ? null : { x: x0 - pad, y: y - size * 1.35 }), (c, lt) => {
      drawGlyphs(c, lay, size, pad, size * 1.35, lt, o.at ?? 0, o.stagger ?? 0.07, seed, o);
    });
  };
  /** count(x, y, o): a clay number that counts up and lands on the spoken word, standing on baseline y (glyphs pop as
   *  digits change). o: { to, from (default 0), at, dur (default 1.2), unit (a short unit after it, smaller), prefix,
   *  decimals, sep (thousands separator, default ','), size (default 220), color (default 'yellow'), unitColor, align
   *  ('left' | 'center' | 'right'), out }. Land it with at: P.cw(i, '80%') - dur. */
  B.count = function (x, y, o = {}) {
    const size = o.size ?? 220, seed = SEED++, at = o.at ?? 0, dur = o.dur ?? 1.2, to = o.to ?? 100, from = o.from ?? 0;
    const fmt = (v) => { const s = Math.abs(v).toFixed(o.decimals ?? 0).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ?? ','); return (v < 0 ? '-' : '') + (o.prefix || '') + s.join('.'); };
    const full = layout(fmt(to), size, () => o.color || 'yellow'), us = size * 0.42;
    const unit = o.unit ? layout(o.unit, us, () => o.unitColor || o.color || 'yellow') : { glyphs: [], width: 0 };
    const total = full.width + (o.unit ? size * 0.08 + unit.width : 0), pad = size * 0.6;
    const x0 = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    const cw = total + pad * 2 + size, chh = size * 1.9;
    return mount(this, cw, chh, (lt) => (lt < at - 0.01 || (o.out != null && lt > o.out + 0.4) ? null : { x: x0 - pad, y: y - size * 1.35 }), (c, lt) => {
      const q = ease.out(clamp((step(lt) - at) / dur)), v = from + (to - from) * q;
      const lay = layout(fmt(q >= 1 ? to : v), size, () => o.color || 'yellow');
      drawGlyphs(c, lay, size, pad, size * 1.35, lt, at, 0, seed, o);
      if (o.unit) drawGlyphs(c, unit, us, pad + lay.width + size * 0.08, size * 1.35, lt, at + dur * 0.8, 0.05, seed + 99, o);
    }, (lt) => step(lt));
  };

  /** plate(x, y, w, h, text, o): a rolled clay slab centred on (x, y) with the words pressed into it — a label, a name, a
   *  short line of dialogue or a caption. It pops in with squash and stands on a contact shadow. o: { color (slab,
   *  default 'paper'), size (text px, default h × 0.42), ink (text colour, default a darker shade of the slab), round
   *  (corner radius, default h/2: a pill), tilt (radians), tail ([x, y]: a speech balloon tail pointing there), at, out }.
   *  Keep it to one short line (≤ 12 汉字 or ~5 words). */
  B.plate = function (x, y, w, hh, text, o = {}) {
    const seed = SEED++, colr = o.color || 'paper', size = o.size ?? Math.round(hh * 0.42), r = o.round ?? hh / 2, pad = 40;
    const tail = o.tail ? [o.tail[0] - x, o.tail[1] - y] : null;
    const ext = tail ? Math.max(Math.abs(tail[0]) - w / 2, Math.abs(tail[1]) - hh / 2, 0) + 30 : 0;
    const sw = w + pad * 2 + ext * 2, sh = hh + pad * 2 + ext * 2, cx = sw / 2, cy = sh / 2;
    const ink = o.ink ? col(o.ink) : shade(colr, colr === 'paper' ? -0.75 : -0.66);
    const sprite = clay('plate:' + text + ':' + w + ':' + hh + ':' + (tail || ''), sw, sh, colr, (g) => {
      g.fill(rrect(cx - w / 2, cy - hh / 2, w, hh, r));
      if (tail) { g.lineWidth = 10; const a = Math.atan2(tail[1], tail[0]), bx = Math.cos(a) * w * 0.28, by = Math.sin(a) * hh * 0.3; g.beginPath(); g.moveTo(cx + bx - Math.sin(a) * 34, cy + by + Math.cos(a) * 34); g.lineTo(cx + tail[0], cy + tail[1]); g.lineTo(cx + bx + Math.sin(a) * 34, cy + by - Math.cos(a) * 34); g.closePath(); g.fill(); g.stroke(); }
    }, {
      box: [cx - w / 2, cy - hh / 2, w, hh], prints: w > 300,
      after: (g) => {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const latin = !/[⺀-鿿]/.test(text);
        g.font = latin ? `400 ${size}px "Archivo Black", "Noto Sans SC Variable"` : `900 ${size}px "Noto Sans SC Variable", "Archivo Black"`;
        g.fillStyle = 'rgba(255,252,245,0.75)'; g.fillText(text, cx + 1.5, cy + 2.5);
        g.fillStyle = ink; g.fillText(text, cx, cy);
      },
    });
    return mount(this, sw, sh + 30, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - cx, y: y - cy }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), [kx, ky] = sqs(k), [bx, by, br] = boil(seed, lt, 0.6);
      shadow(c, cx + 8, cy + hh / 2 + 10, w * 0.5, 0.22, 16);
      c.translate(cx + bx, cy + hh / 2 + by); c.rotate(br + (o.tilt || 0)); c.scale(kx, ky); c.translate(0, -hh / 2);
      put(c, sprite, 0, 0, cx, cy);
    });
  };

  /** coil(pts, o): a rolled clay snake laid along the points [[x, y], …] (a smooth curve through them), unrolling from
   *  the first point — the clay way to connect, point or show a path or a flow. o: { width (default 26), color (default
   *  'ink'), at, dur (default 0.8), end: 'ball' | 'arrow' | null (what sits on the last point), out }. */
  B.coil = function (pts, o = {}) {
    const wd = o.width ?? 26, colr = o.color || 'ink', at = o.at ?? 0, dur = o.dur ?? 0.8, seed = SEED++;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), pad = wd * 3 + 40;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad, cw = Math.max(...xs) - minX + pad, chh = Math.max(...ys) - minY + pad;
    // sample the Catmull-Rom curve
    const samp = []; const n = pts.length, gp = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n - 1; i++) { const p0 = gp(i - 1), p1 = gp(i), p2 = gp(i + 1), p3 = gp(i + 2); for (let k = 0; k < 24; k++) { const t = k / 24, t2 = t * t, t3 = t2 * t; samp.push([0, 1].map((j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); } }
    samp.push(pts[n - 1]);
    return mount(this, cw, chh, (lt) => (lt < at || (o.out != null && lt > o.out + 0.3) ? null : { x: minX, y: minY }), (c, lt) => {
      const q = ease.out(clamp((step(lt) - at) / dur)), m = Math.max(2, Math.round(samp.length * q)), [bx, by] = boil(seed, lt, 0.5);
      const k = o.out != null && lt > o.out ? 1 - clamp((lt - o.out) / 0.3) : 1;
      c.globalAlpha = k; c.translate(-minX + bx, -minY + by);
      tube(c, (cc) => { cc.moveTo(...samp[0]); for (let i = 1; i < m; i++) cc.lineTo(...samp[i]); }, wd, colr);
      if (q >= 0.98 && o.end) {
        const e = samp[samp.length - 1], p = samp[samp.length - 4], a = Math.atan2(e[1] - p[1], e[0] - p[0]);
        if (o.end === 'ball') ball(c, e[0], e[1], wd * 0.85, colr);
        else { c.save(); c.translate(e[0], e[1]); c.rotate(a); const sp = clay('head:' + wd, wd * 4, wd * 4, colr, (g) => { g.lineWidth = wd * 0.7; const p2 = new Path2D(); p2.moveTo(wd * 3.4, wd * 2); p2.lineTo(wd * 0.8, wd * 0.6); p2.lineTo(wd * 0.8, wd * 3.4); p2.closePath(); g.fill(p2); g.stroke(p2); }, { prints: false }); put(c, sp, 0, 0, wd * 1.6, wd * 2); c.restore(); }
      }
    }, (lt) => step(lt));
  };

  /** stack(x, y, items, o): a clay bar chart standing on the floor line y — each item a column of rounded clay blocks
   *  that pile up one by one (each lands with a squash), a pressed label plate under it and its value in clay type on
   *  top. items: [{ v, label, color }]. o: { unit (value per block, default chosen so the tallest column has ≤ 8 blocks),
   *  block (block px, default 70), gap (px between columns, default 70), at, stagger (s between blocks, default 0.08),
   *  hi (index of the column that matters: red unless its item has a colour), valueColor (default 'paper'), out, valueSize (default 72) }. */
  B.stack = function (x, y, items, o = {}) {
    const bs = o.block ?? 70, gap = o.gap ?? 70, max = Math.max(...items.map((i) => i.v)), unit = o.unit ?? Math.max(1e-9, max / 8);
    const at = o.at ?? 0, st = o.stagger ?? 0.08, seed = SEED++, vs = o.valueSize ?? 72;
    const tallest = Math.ceil(max / unit), cw = items.length * (bs + gap) + 200, chh = tallest * bs * 0.92 + vs * 2 + 160;
    const T = this;
    items.forEach((it, i) => { if (it.label) { const pw = Math.min(bs + gap - 10, Math.max(bs + 20, [...it.label].length * (/[\u2E80-\u9fff]/.test(it.label) ? 34 : 22) + 40)); T.plate(x + i * (bs + gap) + bs / 2, y + 46, pw, 62, it.label, { at: at + i * 0.1, color: 'paper', size: Math.min(30, Math.floor((pw - 30) / Math.max(1, [...it.label].length) * (/[\u2E80-\u9fff]/.test(it.label) ? 1 : 1.6))) }); } });
    return mount(this, cw, chh, (lt) => (lt < at || (o.out != null && lt > o.out + 0.3) ? null : { x: x - 100, y: y - chh + 40 }), (c, lt) => {
      const by0 = chh - 40;
      let t0 = at;
      items.forEach((it, i) => {
        const n = Math.max(1, Math.round(it.v / unit)), cx = 100 + i * (bs + gap) + bs / 2, colr = it.color || (o.hi === i ? 'red' : 'blue');
        shadow(c, cx, by0, bs * 0.8, 0.3);
        const sp = clay('blk', bs, bs, colr, (g) => g.fill(rrect(3, 3, bs - 6, bs - 6, bs * 0.26)), { prints: false });
        let landed = 0;
        for (let b = 0; b < n; b++) {
          const k = pop(lt, t0 + b * st, o.out); if (k <= 0) continue; landed = b + 1;
          const [kx, ky] = sqs(k), [jx, jy] = boil(seed + i * 31 + b, lt, 0.5);
          c.save(); c.translate(cx + jx, by0 - b * bs * 0.92 + jy); c.scale(kx, ky); put(c, sp, 0, 0, bs / 2, bs - 3); c.restore();
        }
        if (landed === n && it.vt !== false) {
          const lay = layout(it.text ?? String(it.v), vs, () => o.valueColor || 'paper');
          drawGlyphs(c, lay, vs, cx - lay.width / 2, by0 - n * bs * 0.92 - bs * 0.95, lt, t0 + n * st, 0.04, seed + i, o);
        }
        t0 += n * st + 0.12;
      });
    }, (lt) => step(lt));
  };

  /** squish(L, ax, ay, o): bring any layer from P.layer() into the stop-motion: it breathes and bobs on twos with a
   *  little squash about its ground point (ax, ay). o: { amp (px, default 8), from, to (page seconds) } */
  B.squish = function (L, ax, ay, o = {}) {
    const wrap = L.wrap || L, seed = SEED++;
    wrap.style.transformOrigin = `${ax}px ${ay}px`;
    this.tick((lt) => {
      const on = lt >= (o.from ?? 0) && lt <= (o.to ?? 1e9);
      if (!on) { wrap.style.transform = ''; return; }
      const tq = step(lt), b = Math.abs(Math.sin(tq * 3 + seed)), [bx, by, br] = boil(seed, lt, 0.8);
      wrap.style.transform = `translate(${bx.toFixed(1)}px, ${(by - b * (o.amp ?? 8)).toFixed(1)}px) rotate(${(br * 57).toFixed(2)}deg) scale(${(1 + (1 - b) * 0.03).toFixed(4)}, ${(1 - (1 - b) * 0.03).toFixed(4)})`;
    });
    return L;
  };

  /** fx(kind, x, y, o): a small clay effect at (x, y), landing on a word: 'crumbs' (clay bits burst out), 'puff' (a dust
   *  puff, for a landing or a vanish), 'sparkle', 'sweat', 'hearts', 'question', 'exclaim', 'zzz', 'stars' (dizzy).
   *  o: { at, dur (default 1.2; question/exclaim/zzz/stars stay until out), out, color, size (default 1) } */
  B.fx = function (kind, x, y, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.2, sz = o.size ?? 1, seed = SEED++, stay = ['question', 'exclaim', 'zzz', 'stars'].includes(kind);
    const cw = 520 * sz, chh = 520 * sz;
    return mount(this, cw, chh, (lt) => (lt < at || (!stay && lt > at + dur) || (o.out != null && lt > o.out) ? null : { x: x - cw / 2, y: y - chh / 2 }), (c, lt) => {
      const q = clamp((step(lt) - at) / dur), r = PV.rng(seed * 31), tq = step(lt);
      c.translate(cw / 2, chh / 2); c.scale(sz, sz);
      if (kind === 'crumbs') for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, v = 140 + r() * 120, px = Math.cos(a) * v * q, py = Math.sin(a) * v * q + 260 * q * q; ball(c, px, py, (8 + r() * 10) * (1 - q * 0.4), o.color || ['red', 'yellow', 'blue', 'green', 'orange'][i % 5], 1 - q * q); }
      else if (kind === 'puff') for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI, d = 40 + q * 150; ball(c, Math.cos(a) * d * 1.3, 30 + Math.sin(a) * d * 0.35, (34 - i % 2 * 8) * (1 - q * 0.6), 'paper', (1 - q) * 0.95); }
      else if (kind === 'sparkle') for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3, on = (drawing(lt) + i) % 3 !== 0, rr = on ? 26 : 14; c.save(); c.translate(Math.cos(a) * 130, Math.sin(a) * 110); c.globalAlpha = 1 - q * 0.5; const sp = clay('spk' + rr, rr * 3, rr * 3, o.color || 'yellow', (g) => { g.lineWidth = rr * 0.3; const p = new Path2D(); star(rr * 1.5, rr * 1.5, rr * 1.2, rr * 0.36, 4).forEach(([px, py], j) => (j ? p.lineTo(px, py) : p.moveTo(px, py))); p.closePath(); g.fill(p); g.stroke(p); }, { prints: false }); put(c, sp, 0, 0, rr * 1.5, rr * 1.5); c.restore(); }
      else if (kind === 'sweat') { const d = (tq * 1.4) % 1; c.globalAlpha = 1 - d; const sp = clay('sw', 60, 80, 'blueF', (g) => g.fill(smooth([[30, 6], [48, 44], [44, 70], [30, 76], [16, 70], [12, 44]]))); put(c, sp, 0, d * 60, 30, 40); }
      else if (kind === 'hearts') for (let i = 0; i < 3; i++) { const d = (tq * 0.6 + i / 3) % 1; c.globalAlpha = 1 - d; const sp = clay('hrt', 80, 80, o.color || 'pink', (g) => g.fill(smooth(heartPts(40, 38, 32)))); put(c, sp, (i - 1) * 70 + Math.sin(d * 6 + i) * 14, -d * 180, 40, 40); }
      else if (kind === 'question' || kind === 'exclaim' || kind === 'zzz' || kind === 'stars') {
        const k = pop(lt, at), [kx, ky] = sqs(k);
        if (kind === 'stars') { for (let i = 0; i < 4; i++) { const a = tq * 3 + i / 4 * Math.PI * 2; c.save(); c.translate(Math.cos(a) * 120, Math.sin(a) * 36); const sp = clay('dz', 60, 60, 'yellow', (g) => { g.lineWidth = 10; const p = new Path2D(); star(30, 31, 22, 10).forEach(([px, py], j) => (j ? p.lineTo(px, py) : p.moveTo(px, py))); p.closePath(); g.fill(p); g.stroke(p); }, { prints: false }); put(c, sp, 0, 0, 30, 30); c.restore(); } return; }
        if (kind === 'zzz') { for (let i = 0; i < 3; i++) { const d = (tq * 0.5 + i / 3) % 1; c.save(); c.globalAlpha = 1 - d; c.translate(d * 120, -d * 200); const g = glyph('Z', 80 - i * 10, o.color || 'paper'); put(c, g.face, 0, 0, g.w / 2, g.bl); c.restore(); } return; }
        const ch = kind === 'question' ? '?' : '!', g = glyph(ch, 220, o.color || (kind === 'question' ? 'yellow' : 'red'));
        c.translate(0, Math.abs(Math.sin(tq * 5)) * -14 + 90); c.scale(kx, ky); put(c, g.side, 0, 12, g.w / 2, g.bl); put(c, g.face, 0, 0, g.w / 2, g.bl);
      }
    }, (lt) => step(lt));
  };

  // ─────────────────────────── the page title: a clay slab ───────────────────────────
  Builder.prototype.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15;
    const latin = !/[⺀-鿿]/.test(str);
    const el = h('div', 'cl-title' + (latin ? ' latin' : ''), String(str).replace(/</g, '&lt;') + (o.sub ? `<span class="sub">${o.sub}</span>` : ''), T.html);
    if (o.size) el.style.fontSize = o.size + 'px';
    T.tick((lt) => {
      const k = pop(lt, at, o.out), [kx, ky] = sqs(k), [bx, by, br] = boil(7, lt, 0.5);
      el.style.opacity = k > 0.02 ? '1' : '0';
      el.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) rotate(${(br * 57 - 0.6).toFixed(2)}deg) scale(${Math.max(0.01, kx).toFixed(3)}, ${Math.max(0.01, ky).toFixed(3)})`;
    });
    const hnd = { el, spans: [el], a: { dur: 0.42 }, hide: (t) => { o.out = t; return hnd; } };
    return hnd;
  };

  // ─────────────────────────── the studio (every frame of the film) ───────────────────────────
  // a camera on a tripod, a hand moving the puppets between exposures: the light breathes a little from frame to frame
  (function studio() {
    const frame = document.getElementById('frame');
    if (!frame) return;
    const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; cv.className = 'cl-studio';
    Object.assign(cv.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 34, pointerEvents: 'none' });
    frame.appendChild(cv);
    const g = cv.getContext('2d');
    const stage = () => document.getElementById('stage');
    (window.FRAME_HOOKS = window.FRAME_HOOKS || []).push((t) => {
      const n = Math.floor(t * 12), r = PV.rng(n * 7919 + 3);
      g.clearRect(0, 0, 8, 8);
      g.fillStyle = r() < 0.5 ? `rgba(255,246,228,${(r() * 0.035).toFixed(3)})` : `rgba(60,30,20,${(r() * 0.03).toFixed(3)})`; g.fillRect(0, 0, 8, 8);
      const st = stage(); if (st) st.style.transform = `translate(${((r() - 0.5) * 1.2).toFixed(2)}px, ${((r() - 0.5) * 1.2).toFixed(2)}px)`;
    });
  })();
})();
