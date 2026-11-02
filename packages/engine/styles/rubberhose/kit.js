/* Rubber-hose cartoon kit (1930s): characters with noodle limbs, pie-cut eyes and white gloves; anthropomorphic props;
 * scenic backdrops; iris transitions; ornate title cards; balloons and bursts; a restrained film gate over every frame.
 * Everything bounces on one beat (STYLE.bpm) and is drawn at 12 drawings a second ("on twos"), which is the look itself.
 * Every component is a pure function of page time lt. Any option marked "fn" may be a value, a function of lt, or a
 * keyframe list [[t0, v0], [t1, v1], …] (the last entry whose time has passed wins).
 * Techniques adapted from huashu-art-motion (MIT, © 2026 alchaincyf): beat bounce with squash and stretch, pie eyes,
 * hose arms, gloves, the film layer. */
(function () {
  const { col, clamp, lerp, ease, h, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const BEAT = () => 60 / ((window.STYLE && STYLE.bpm) || 120);
  /** 12 drawings a second */
  const step = (lt) => Math.floor(lt * 12 + 1e-6) / 12;
  /** 0 on the floor … 1 at the top of the bounce, once per beat; ph shifts the phase (0..1 of a beat) */
  const bnc = (tq, ph = 0) => Math.abs(Math.sin(Math.PI * (tq / BEAT() + ph)));
  PV.bnc = bnc; PV.step12 = step;
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]);
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  const INK = () => col('ink');
  const PAPER = () => col('paper');
  const ell = (x, y, rx, ry, a = 0) => { const p = new Path2D(); p.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), a, 0, Math.PI * 2); return p; };
  const circ = (x, y, r) => ell(x, y, r, r);
  const smoothPath = (pts, closed = true) => {   // Catmull-Rom through the points
    const p = new Path2D(), n = pts.length, g = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    p.moveTo(...pts[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) p.closePath();
    return p;
  };
  const inkS = (c, w) => { c.strokeStyle = INK(); c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; };
  const F = (c, p, fill, w = 5) => { if (fill) { c.fillStyle = col(fill); c.fill(p); } if (w) { inkS(c, w); c.stroke(p); } };
  /** stepped pop-in (overshoot) and shrink-out; returns { k: scale 0..1+, on } */
  const pop = (lt, at = 0, out) => {
    const tq = step(lt);
    let k = tq < at ? 0 : ease.back(clamp((tq - at) / 0.34));
    if (out != null && tq >= out) k *= 1 - ease.inOut(clamp((tq - out) / 0.25));
    return k;
  };
  /** a canvas on this layer, sized in stage pixels, drawn at 1.5× so a camera push stays sharp */
  function mountCanvas(self, w, hh, place, draw) {
    const R = 1.5, c = h('canvas', null, null, self.html);
    c.width = Math.ceil(w * R); c.height = Math.ceil(hh * R);
    Object.assign(c.style, { position: 'absolute', width: w + 'px', height: hh + 'px', left: '0px', top: '0px' });
    const ctx = c.getContext('2d');
    self.tick((lt) => {
      const p = place(lt);
      if (!p) { c.style.display = 'none'; return; }
      c.style.display = '';
      c.style.left = (p.x).toFixed(1) + 'px'; c.style.top = (p.y).toFixed(1) + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(R, 0, 0, R, 0, 0);
      draw(ctx, lt);
    });
    return c;
  }
  /** squash & stretch about a ground point: up by b*amp, squashed on landing, stretched in the air */
  function boing(c, b, amp, k = 1) {
    const sq = (1 - b) * 0.09 * k, st = b * 0.05 * k;
    c.translate(0, -b * amp);
    c.scale(1 + sq - st * 0.6, 1 - sq + st);
  }
  /** the noodle limb: one constant-width curve, no elbow */
  function hose(c, A, Bp, bend, w) {
    const mx = (A[0] + Bp[0]) / 2, my = (A[1] + Bp[1]) / 2, dx = Bp[0] - A[0], dy = Bp[1] - A[1], L = Math.hypot(dx, dy) || 1;
    inkS(c, w); c.beginPath(); c.moveTo(...A); c.quadraticCurveTo(mx - dy / L * bend, my + dx / L * bend, ...Bp); c.stroke();
  }
  /** the white four-finger glove with a flared cuff; ang points the fingers */
  function glove(c, x, y, ang, s = 1, open = false) {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
    F(c, smoothPath([[-30, -14], [-8, -24], [16, -22], [30, -12], [34, 4], [24, 20], [4, 24], [-20, 18], [-32, 4]]), 'paper', 4.5);
    const fingers = open ? [[24, -26, -0.5], [36, -10, -0.15], [38, 8, 0.2], [30, 24, 0.5]] : [[22, -18, 0.2], [30, -6, 0.2], [30, 8, 0.2]];
    fingers.forEach(([fx, fy, a]) => F(c, ell(fx + 6, fy, open ? 14 : 11, 8, a), 'paper', 4.5));
    F(c, ell(-14, -22, 12, 8, -0.9), 'paper', 4.5);   // thumb
    F(c, smoothPath([[-30, -20], [-48, -28], [-52, 0], [-48, 28], [-30, 20], [-26, 0]]), 'paper', 4.5);
    inkS(c, 3); [-6, 4, 14].forEach((xx) => { c.beginPath(); c.moveTo(xx - 8, -6); c.lineTo(xx, -8); c.stroke(); });
    c.restore();
  }
  /** the pie-cut eye: white socket, black pupil with a wedge cut out (the 1930s signature) */
  function pieEye(c, x, y, rx, ry, look, lookY = 0.25) {
    F(c, ell(x, y, rx, ry), 'paper', 4);
    const px = x + look * rx * 0.36, py = y + ry * lookY;
    c.save(); c.clip(ell(x, y, rx, ry)); c.fillStyle = INK(); c.beginPath(); c.ellipse(px, py, rx * 0.64, ry * 0.7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = PAPER(); c.beginPath(); c.moveTo(px + rx * 0.05, py - ry * 0.05); c.arc(px, py, ry * 0.95, -1.45, -0.85); c.closePath(); c.fill(); c.restore();
  }

  // ─────────────────────────── the face ───────────────────────────
  function face(c, mood, hx, hy, R, tq, o) {
    const fx = hx + R * 0.2;   // the face turns a little toward the front (+x)
    const ex1 = fx - R * 0.12, ex2 = fx + R * 0.32, ey = hy - R * 0.14, erx = R * 0.2, ery = R * 0.32;
    const blink = mood !== 'sleepy' && mood !== 'laugh' && (Math.floor(tq * 12) % 46) < 2;
    const lid = (x) => { inkS(c, 4.5); c.beginPath(); c.ellipse(x, ey + ery * 0.15, erx, ery * 0.45, 0, 0.15, Math.PI - 0.15); c.stroke(); };
    // brows
    const brow = (x, dir, lift) => { inkS(c, 5); c.beginPath(); c.moveTo(x - erx * 1.1, ey - ery * 1.25 - lift + dir * 6); c.quadraticCurveTo(x, ey - ery * 1.5 - lift, x + erx * 1.1, ey - ery * 1.25 - lift - dir * 6); c.stroke(); };
    if (mood === 'worried' || mood === 'sad') { brow(ex1, -1, 4); brow(ex2, 1, 4); }
    if (mood === 'angry') { brow(ex1, 1.6, -6); brow(ex2, -1.6, -6); }
    if (mood === 'shock') { brow(ex1, 0, 18); brow(ex2, 0, 18); }
    // eyes
    if (blink || mood === 'sleepy') { lid(ex1); lid(ex2); }
    else if (mood === 'laugh') {
      inkS(c, 5); [ex1, ex2].forEach((x) => { c.beginPath(); c.arc(x, ey + ery * 0.3, erx * 0.9, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); });
    } else if (mood === 'shock') {
      [ex1, ex2].forEach((x) => { F(c, ell(x, ey - 4, erx * 1.2, ery * 1.2), 'paper', 4); c.fillStyle = INK(); c.fill(circ(x + 2, ey - 2, erx * 0.3)); });
    } else {
      const look = o.look ?? 0.5, ly = mood === 'think' ? -0.2 : 0.25;
      if (mood === 'sly') {   // half-lidded, small pupils glancing to the front
        [ex1, ex2].forEach((x) => { const half = new Path2D(); half.ellipse(x, ey, erx, ery, 0, 0.05, Math.PI - 0.05); half.closePath(); F(c, half, 'paper', 4); c.fillStyle = INK(); c.beginPath(); c.ellipse(x + erx * 0.45, ey + ery * 0.42, erx * 0.38, ery * 0.34, 0, 0, 7); c.fill(); inkS(c, 5.5); c.beginPath(); c.moveTo(x - erx * 1.15, ey + ery * 0.02); c.lineTo(x + erx * 1.15, ey - ery * 0.1); c.stroke(); });
      } else { pieEye(c, ex1, ey, erx, ery, look, ly); pieEye(c, ex2, ey, erx, ery, look, ly); }
    }
    if (o.lashes) { inkS(c, 3.5); [ex1, ex2].forEach((x) => { for (let k = 0; k < 3; k++) { const a = -2.3 + k * 0.4; c.beginPath(); c.moveTo(x + Math.cos(a) * erx, ey + Math.sin(a) * ery); c.lineTo(x + Math.cos(a) * (erx + 11), ey + Math.sin(a) * (ery + 11)); c.stroke(); } }); }
    if (o.glasses) { inkS(c, 4); const gr = erx * 1.3; [ex1, ex2].forEach((x) => { c.beginPath(); c.arc(x, ey + 2, gr, 0, Math.PI * 2); c.stroke(); }); c.beginPath(); c.moveTo(ex1 + gr, ey); c.quadraticCurveTo((ex1 + ex2) / 2, ey - 8, ex2 - gr, ey); c.stroke(); }
    // nose: a shiny black button at the front
    c.fillStyle = INK(); c.beginPath(); c.ellipse(fx + R * 0.62, hy + R * 0.12, R * 0.17, R * 0.13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = PAPER(); c.beginPath(); c.ellipse(fx + R * 0.58, hy + R * 0.07, R * 0.05, R * 0.03, -0.4, 0, Math.PI * 2); c.fill();
    // cheek
    c.fillStyle = col('red'); c.globalAlpha = 0.35; c.beginPath(); c.arc(fx - R * 0.36, hy + R * 0.36, R * 0.16, 0, 7); c.fill(); c.globalAlpha = 1;
    // mouth
    const my = hy + R * 0.42, m0 = fx - R * 0.2, m1 = fx + R * 0.56;
    inkS(c, 5);
    if (mood === 'laugh' || mood === 'cheer') {
      const p = new Path2D(); p.moveTo(m0, my - 6); p.quadraticCurveTo((m0 + m1) / 2, my + R * 0.62, m1, my - 8); p.quadraticCurveTo((m0 + m1) / 2, my + 4, m0, my - 6); p.closePath();
      F(c, p, 'ink', 4); c.save(); c.clip(p); c.fillStyle = col('red'); c.beginPath(); c.ellipse((m0 + m1) / 2, my + R * 0.34, R * 0.2, R * 0.12, 0, 0, 7); c.fill(); c.restore();
    } else if (mood === 'shock') { F(c, ell((m0 + m1) / 2 + 6, my + 8, R * 0.13, R * 0.2), 'ink', 3); }
    else if (mood === 'worried' || mood === 'sad') {
      c.beginPath(); c.moveTo(m0 + 6, my + 10); for (let i = 1; i <= 6; i++) c.lineTo(m0 + 6 + (m1 - m0 - 12) * i / 6, my + 10 + (i % 2 ? -6 : 6) + (mood === 'sad' ? -Math.sin(i / 6 * Math.PI) * 10 : 0)); c.stroke();
    } else if (mood === 'angry') { c.beginPath(); c.moveTo(m0 + 8, my + 10); c.lineTo(m1 - 6, my + 6); c.stroke(); }
    else if (mood === 'sleepy') { F(c, ell((m0 + m1) / 2, my + 8, R * 0.08, R * 0.06), 'ink', 0); }
    else if (mood === 'sly' || mood === 'think') { c.beginPath(); c.moveTo(m0 + 10, my + 8); c.quadraticCurveTo((m0 + m1) / 2, my + 14, m1, my - 6); c.stroke(); }
    else { c.beginPath(); c.moveTo(m0, my - 2); c.quadraticCurveTo((m0 + m1) / 2, my + R * 0.36, m1, my - 4); c.stroke(); inkS(c, 4); c.beginPath(); c.arc(m0 - 2, my - 6, 7, 0.4, 2.4); c.stroke(); }
  }

  function hat(c, kind, hx, hy, R, lift, tq, o) {
    const top = hy - R - lift;
    if (kind === 'bowler') { F(c, ell(hx, top + 6, R * 1.0, R * 0.16), 'ink', 0); F(c, smoothPath([[hx - R * 0.66, top + 4], [hx - R * 0.6, top - R * 0.5], [hx, top - R * 0.72], [hx + R * 0.6, top - R * 0.5], [hx + R * 0.66, top + 4]]), 'ink', 0); c.fillStyle = col(o.accent || 'red'); c.fillRect(hx - R * 0.64, top - 10, R * 1.28, 9); }
    else if (kind === 'tophat') { F(c, ell(hx, top + 6, R * 0.95, R * 0.15), 'ink', 0); c.fillStyle = INK(); c.fillRect(hx - R * 0.55, top - R * 1.0, R * 1.1, R * 1.05); c.fillStyle = col(o.accent || 'red'); c.fillRect(hx - R * 0.55, top - R * 0.22, R * 1.1, R * 0.16); }
    else if (kind === 'cap') { F(c, smoothPath([[hx - R * 0.85, top + R * 0.25], [hx - R * 0.6, top - R * 0.35], [hx + R * 0.2, top - R * 0.45], [hx + R * 0.8, top + R * 0.1], [hx + R * 0.3, top + R * 0.32]]), o.accent || 'red', 4.5); F(c, ell(hx + R * 0.88, top + R * 0.22, R * 0.42, R * 0.12, 0.15), 'ink', 0); F(c, circ(hx - R * 0.05, top - R * 0.42, R * 0.1), 'ink', 0); }
    else if (kind === 'bow') { c.save(); c.translate(hx - R * 0.35, top + R * 0.12 - bnc(tq, 0.1) * 6); c.rotate(-0.35); F(c, smoothPath([[0, 0], [-R * 0.62, -R * 0.4], [-R * 0.66, R * 0.26]]), o.accent || 'red', 4); F(c, smoothPath([[0, 0], [R * 0.62, -R * 0.4], [R * 0.66, R * 0.26]]), o.accent || 'red', 4); F(c, circ(0, 0, R * 0.15), o.accent || 'red', 4); c.fillStyle = PAPER(); [[-R * 0.4, -R * 0.08], [R * 0.4, -R * 0.08], [-R * 0.3, R * 0.12], [R * 0.32, R * 0.12]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fill(); }); c.restore(); }
    else if (kind === 'nightcap') { const sw = Math.sin(Math.PI * tq / BEAT()) * 0.4; const tip = [hx - R * 1.2 - sw * 20, top + R * 0.5 + Math.abs(sw) * 10]; F(c, smoothPath([[hx - R * 0.9, top + R * 0.45], [hx - R * 0.4, top - R * 0.3], [hx + R * 0.4, top - R * 0.15], [hx + R * 0.85, top + R * 0.4], [hx - R * 0.6, top + R * 0.1], tip]), o.accent || 'blue', 4.5); F(c, circ(tip[0], tip[1], R * 0.17), 'paper', 4); c.fillStyle = PAPER(); c.fillRect(hx - R * 0.92, top + R * 0.36, R * 1.8, R * 0.16); inkS(c, 4); c.strokeRect(hx - R * 0.92, top + R * 0.36, R * 1.8, R * 0.16); }
    else if (kind === 'propeller') { F(c, smoothPath([[hx - R * 0.78, top + R * 0.28], [hx - R * 0.5, top - R * 0.3], [hx + R * 0.5, top - R * 0.3], [hx + R * 0.78, top + R * 0.28]]), o.accent || 'red', 4.5); inkS(c, 4); c.beginPath(); c.moveTo(hx, top - R * 0.3); c.lineTo(hx, top - R * 0.55); c.stroke(); const a = tq * 14; c.save(); c.translate(hx, top - R * 0.58); c.scale(Math.cos(a), 1); F(c, ell(-R * 0.36, 0, R * 0.36, R * 0.09), 'yellow', 3.5); F(c, ell(R * 0.36, 0, R * 0.36, R * 0.09), 'blue', 3.5); c.restore(); }
    else if (kind === 'tuft' || !kind) { inkS(c, 5); for (let k = 0; k < 3; k++) { const x = hx - R * 0.2 + k * R * 0.22; c.beginPath(); c.moveTo(x, top + 10); c.quadraticCurveTo(x - 14 + k * 4, top - 26 - bnc(tq, 0.15 + k * 0.1) * 8, x + 12, top - 30 - k * 4); c.stroke(); } }
  }

  // ─────────────────────────── poses ───────────────────────────
  // units: the character stands on (0,0), faces +x, about 350 units tall. Each pose returns limb targets.
  function rig(pose, tq, ph) {
    const b = bnc(tq, ph), n = tq / BEAT() + ph, sw = Math.sin(Math.PI * n);
    const r = { lift: b * 10, amp: 1, lean: 0, tilt: sw * 0.04, hL: [-62, -120 + sw * 8], hR: [62, -120 - sw * 8], bL: 26, bR: -26,
      fL: [-30, 0], fR: [30, 0], gL: Math.PI * 0.55, gR: Math.PI * 0.45, open: false, headDy: 0, stretch: 0, extra: null };
    if (pose === 'bounce') { r.lift = b * 34; r.amp = 1.6; r.hL = [-92, -170 - b * 70]; r.hR = [92, -170 - b * 70]; r.gL = -Math.PI * 0.6; r.gR = -Math.PI * 0.4; r.open = true; }
    else if (pose === 'walk' || pose === 'run') {
      const run = pose === 'run', p = Math.PI * n * (run ? 2 : 1), a = run ? 1.5 : 1;
      r.fL = [-6 + Math.sin(p) * 38 * a, -Math.max(0, Math.cos(p)) * 22 * a]; r.fR = [6 - Math.sin(p) * 38 * a, -Math.max(0, -Math.cos(p)) * 22 * a];
      r.hL = [-30 - Math.sin(p) * 52 * a, run ? -150 : -118]; r.hR = [30 + Math.sin(p) * 52 * a, run ? -150 : -118];
      r.bL = run ? 50 : 20; r.bR = run ? -50 : -20; r.lift = Math.abs(Math.sin(p)) * 14 * a; r.lean = run ? 0.16 : 0.04; r.gL = Math.PI * 0.6; r.gR = Math.PI * 0.4;
      if (run) r.extra = 'speed';
    }
    else if (pose === 'point') { r.hR = [168, -262 + sw * 4]; r.bR = -8; r.gR = -0.25; r.hL = [-60, -130]; r.bL = 40; r.lean = -0.05; r.tilt = 0.06; }
    else if (pose === 'shrug') { r.hL = [-118, -222]; r.hR = [118, -222]; r.bL = 40; r.bR = -40; r.gL = Math.PI + 0.35; r.gR = -0.35; r.open = true; r.tilt = 0.14 * Math.sign(sw || 1); r.lift = b * 5; r.headDy = 8; }
    else if (pose === 'jump') { const j = Math.sin(Math.PI * ((n / 2) % 1)); r.lift = j * 130; r.amp = 0.3; r.fL = [-34, -36 * j]; r.fR = [26, -48 * j]; r.hL = [-104, -330]; r.hR = [104, -330]; r.gL = -Math.PI * 0.7; r.gR = -Math.PI * 0.3; r.open = true; r.stretch = j * 0.08; }
    else if (pose === 'surprised') { r.lift = 26 + b * 8; r.stretch = 0.12; r.hL = [-96, -318]; r.hR = [96, -318]; r.bL = -20; r.bR = 20; r.gL = -Math.PI * 0.62; r.gR = -Math.PI * 0.38; r.open = true; r.extra = 'take'; r.fL = [-44, -8]; r.fR = [44, -8]; }
    else if (pose === 'cheer') { r.lift = b * 30; r.amp = 1.4; r.hL = [-112, -350]; r.hR = [112, -350]; r.gL = -Math.PI * 0.7; r.gR = -Math.PI * 0.3; r.open = true; }
    else if (pose === 'think') { r.hR = [56, -248]; r.bR = 50; r.gR = -1.9; r.hL = [-58, -128]; r.bL = 40; r.tilt = -0.08; r.extra = 'think'; r.lift = b * 4; }
    else if (pose === 'wave') { r.hR = [110 + sw * 34, -340]; r.bR = -30; r.gR = -1.4 + sw * 0.4; r.open = true; r.hL = [-58, -128]; r.bL = 40; }
    else if (pose === 'sleepy') { r.lift = 0; r.amp = 0.2; r.hL = [-52, -78 + sw * 4]; r.hR = [52, -78 - sw * 4]; r.bL = 10; r.bR = -10; r.headDy = 26; r.tilt = 0.18 + sw * 0.05; r.extra = 'zzz'; }
    else if (pose === 'sad') { r.lift = b * 3; r.hL = [-46, -84]; r.hR = [46, -84]; r.bL = 10; r.bR = -10; r.headDy = 22; r.tilt = 0.1; r.extra = 'sweat'; }
    else if (pose === 'hold') { r.hL = [70, -178]; r.hR = [96, -172]; r.bL = -30; r.bR = -20; r.gL = 0.1; r.gR = -0.1; }
    else if (pose === 'push') { r.hL = [120, -186]; r.hR = [126, -150]; r.bL = -10; r.bR = -10; r.gL = -0.2; r.gR = 0; r.open = true; r.lean = 0.22; r.fL = [-70 + Math.sin(Math.PI * n) * 10, 0]; r.fR = [0, 0]; r.lift = b * 6; }
    else if (pose === 'sit') { r.fL = [40, 0]; r.fR = [70, 0]; r.lift = -60; r.hL = [-30, -110]; r.hR = [80, -120]; r.amp = 0.4; }
    return r;
  }
  const MOOD_OF = { bounce: 'happy', walk: 'happy', run: 'worried', point: 'happy', shrug: 'sly', jump: 'laugh', surprised: 'shock', cheer: 'laugh', think: 'think', wave: 'happy', sleepy: 'sleepy', sad: 'sad', hold: 'happy', push: 'angry', sit: 'happy' };

  function drawToon(c, o, lt) {
    const tq = step(lt);
    const pose = val(o.pose, lt, 'idle'), mood = val(o.mood, lt, null) || MOOD_OF[pose] || 'happy';
    const R = 64, r = rig(pose, tq, o.ph ?? 0), b = bnc(tq, o.ph ?? 0);
    const body = col(val(o.body, lt, 'red')), pants = val(o.pants, lt, 'ink');
    // ground shadow
    c.fillStyle = 'rgba(27,21,18,0.2)'; c.beginPath(); c.ellipse(0, 4, 80 - Math.min(40, Math.max(0, r.lift) * 0.25), 12, 0, 0, 7); c.fill();
    c.save();
    boing(c, b * (r.amp > 0.5 ? 1 : 0), 0, r.amp);
    c.translate(0, -r.lift);
    if (r.stretch) c.scale(1 - r.stretch * 0.5, 1 + r.stretch);
    c.rotate(r.lean);
    const hip = [0, -108], sh = [0, -196];
    // legs and shoes
    const leg = (hx, f, front) => {
      hose(c, [hx, hip[1] + 10], [f[0], f[1] - 16], front ? -14 : 14, 13);
      F(c, ell(f[0] + 16, f[1] - 14, 32, 17, f[1] < -4 ? -0.15 : 0), 'ink', 0);
      c.fillStyle = 'rgba(251,242,220,0.55)'; c.beginPath(); c.ellipse(f[0] + 24, f[1] - 22, 9, 4, -0.3, 0, 7); c.fill();
    };
    leg(-20, r.fL, false);
    // back arm before the body
    const sL = [-34, sh[1] + 6], sR = [36, sh[1] + 6];
    hose(c, sL, r.hL, r.bL, 12); glove(c, r.hL[0], r.hL[1], r.gL, 0.95, r.open);
    leg(20, r.fR, true);
    // torso: a pear, top narrow, wide at the hips; shorts with two big buttons
    const torso = new Path2D();
    torso.moveTo(0, -218); torso.bezierCurveTo(44, -218, 64, -150, 60, -112); torso.bezierCurveTo(58, -86, -58, -86, -60, -112); torso.bezierCurveTo(-64, -150, -44, -218, 0, -218); torso.closePath();
    c.fillStyle = body; c.fill(torso);
    c.save(); c.clip(torso); c.fillStyle = col(pants); c.fillRect(-80, -142, 160, 80); c.fillStyle = PAPER();
    [[-22, -124], [24, -124]].forEach(([x, y]) => { c.beginPath(); c.ellipse(x, y, 10, 13, 0, 0, 7); c.fill(); });
    if (o.dots) { c.fillStyle = 'rgba(251,242,220,0.85)'; for (let y = -210; y < -146; y += 26) for (let x = -60; x < 60; x += 26) { c.beginPath(); c.arc(x + ((y / 26) & 1) * 13, y, 5, 0, 7); c.fill(); } }
    c.restore();
    inkS(c, 5.5); c.stroke(torso);
    // head (bobs half a beat late: follow-through)
    const hb = bnc(tq, (o.ph ?? 0) + 0.12) * 6 * r.amp;
    c.save(); c.translate(0, r.headDy - hb); c.rotate(r.tilt);
    const hx = 6, hy = -284;
    if (o.ears === 'cat') { F(c, smoothPath([[hx - 50, hy - 30], [hx - 40, hy - 88], [hx - 6, hy - 52]]), o.head || 'paper', 5); F(c, smoothPath([[hx + 22, hy - 54], [hx + 52, hy - 90], [hx + 58, hy - 28]]), o.head || 'paper', 5); }
    F(c, ell(hx - 8, hy + 8, R * 1.0, R * 0.98), o.head || 'paper', 5.5);
    F(c, circ(hx - R * 0.86, hy + 6, R * 0.2), o.head || 'paper', 4.5);   // ear
    face(c, mood, hx, hy, R, tq, o);
    hat(c, o.hat, hx - 6, hy, R, pose === 'surprised' ? 34 + b * 10 : 0, tq, o);
    c.restore();
    // collar and bow tie
    if (o.bowtie !== false) { const bc = col(o.accent || (o.body === 'red' ? 'yellow' : 'red')); c.save(); c.translate(6, -214); F(c, smoothPath([[0, 0], [-24, -14], [-24, 14]]), bc, 4); F(c, smoothPath([[0, 0], [24, -14], [24, 14]]), bc, 4); F(c, circ(0, 0, 7), bc, 4); c.restore(); }
    // front arm, glove, and whatever it holds
    hose(c, sR, r.hR, r.bR, 12);
    if (o.holds) { c.save(); c.translate(r.hR[0] + 10, r.hR[1] - 38); c.scale(0.8, 0.8); drawProp(c, val(o.holds, lt), { face: false }, tq, 0, lt); c.restore(); }
    glove(c, r.hR[0], r.hR[1], r.gR, 1, r.open);
    c.restore();
    // cartoon extras around the figure
    if (r.extra === 'take') { inkS(c, 5); for (let k = 0; k < 7; k++) { const a = -Math.PI + 0.2 + k * 0.45, j = (Math.floor(tq * 12) % 2) * 6; c.beginPath(); c.moveTo(Math.cos(a) * (120 + j), -310 - r.lift + Math.sin(a) * (110 + j)); c.lineTo(Math.cos(a) * (150 + j), -310 - r.lift + Math.sin(a) * (140 + j)); c.stroke(); } }
    if (r.extra === 'think') { for (let k = 0; k < 3; k++) { const on = ((tq / BEAT()) % 3) >= k; if (on) F(c, circ(90 + k * 26, -360 - k * 28 - bnc(tq, k * 0.2) * 8, 8 + k * 5), 'paper', 4); } }
    if (r.extra === 'zzz') { c.fillStyle = INK(); c.font = '900 40px "Fraunces Variable", serif'; for (let k = 0; k < 3; k++) { const q = ((tq / BEAT() / 2) + k / 3) % 1; c.globalAlpha = 1 - q; c.fillText('Z', 70 + q * 70 + Math.sin(q * 6) * 10, -330 - q * 120); } c.globalAlpha = 1; }
    if (r.extra === 'sweat') { const q = ((tq / BEAT()) % 1); F(c, smoothPath([[-70, -330 + q * 40], [-80, -306 + q * 40], [-70, -298 + q * 40], [-60, -306 + q * 40]]), 'blueF', 3.5); }
    if (r.extra === 'speed') { inkS(c, 5); for (let k = 0; k < 4; k++) { const y = -60 - k * 70, j = (Math.floor(tq * 12) % 2) * 20; c.beginPath(); c.moveTo(-110 - j, y); c.lineTo(-210 - j - k * 15, y); c.stroke(); } }
  }

  /** toon(x, y, o): a rubber-hose cartoon character standing with its feet on (x, y), about o.size px tall (default 380). It
   *  bounces on the beat at 12 drawings a second. o: { size, face: 'r'|'l' (which way it looks; fn), pose (fn): 'idle'
   *  'bounce' 'walk' 'run' 'point' 'shrug' 'jump' 'surprised' 'cheer' 'think' 'wave' 'sleepy' 'sad' 'hold' 'push' 'sit',
   *  mood (fn, default follows the pose): 'happy' 'laugh' 'sly' 'think' 'worried' 'sad' 'shock' 'angry' 'sleepy',
   *  body (colour name, fn), pants, head (face colour, default 'paper'), hat: 'bowler' 'tophat' 'cap' 'bow' 'nightcap'
   *  'propeller' 'tuft', accent (hat band / bow / tie colour), glasses, lashes, dots (polka-dot shirt), ears: 'cat',
   *  bowtie: false, holds (fn): a prop kind carried in the front hand ('phone' 'book' 'clock' 'coffee' 'heart' 'bag' …),
   *  ph (beat phase 0..1 — give two characters different phases so they bounce in counterpoint), at, out }. x and y may
   *  be functions of lt (walk it across: x: lt => lerp(300, 900, PV.K(lt, 2, 3))). Returns the canvas. */
  B.toon = function (x, y, o = {}) {
    const size = o.size ?? 380, s = size / 350, cw = 420 * s, chh = 560 * s;
    return mountCanvas(this, cw, chh, (lt) => {
      const k = pop(lt, o.at ?? 0, o.out);
      if (k <= 0) return null;
      return { x: val(x, lt) - cw / 2, y: val(y, lt) - 500 * s };
    }, (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out);
      c.translate(cw / 2, 500 * s); c.scale(s * k, s * (k > 1 ? 2 - k : k));
      if (val(o.face, lt, 'r') === 'l') c.scale(-1, 1);
      drawToon(c, o, lt);
    });
  };

  // ─────────────────────────── props ───────────────────────────
  // drawn in a ~100-unit box centred on (0,0); faces are optional (anthropomorphic props are very 1930s)
  function propFace(c, x, y, s, mood, tq) {
    const blink = (Math.floor(tq * 12) % 40) < 2;
    if (blink) { inkS(c, 3.5); [-1, 1].forEach((d) => { c.beginPath(); c.arc(x + d * 9 * s, y, 6 * s, 0.2, Math.PI - 0.2); c.stroke(); }); }
    else [-1, 1].forEach((d) => pieEye(c, x + d * 9 * s, y, 6 * s, 10 * s, 0.3));
    inkS(c, 3.5); c.beginPath();
    if (mood === 'shock') c.ellipse(x, y + 16 * s, 4 * s, 6 * s, 0, 0, 7); else c.arc(x, y + 9 * s, 9 * s, 0.4, Math.PI - 0.4);
    c.stroke();
  }
  function drawProp(c, kind, o, tq, ph, lt) {
    const a = o.color ? col(o.color) : null, fc = o.face !== false;
    const ring = o.ring != null && val(o.ring, lt);
    if (kind === 'clock') {
      if (ring) c.rotate(((Math.floor(tq * 24) % 2) ? 1 : -1) * 0.12);
      [-1, 1].forEach((d) => { F(c, circ(d * 30, -40, 15), 'orange', 4); inkS(c, 6); c.beginPath(); c.moveTo(d * 30, -40); c.lineTo(d * 18, -28); c.stroke(); });
      inkS(c, 6); c.beginPath(); c.moveTo(-26, 34); c.lineTo(-36, 50); c.moveTo(26, 34); c.lineTo(36, 50); c.stroke();
      F(c, circ(0, 0, 44), a || 'red', 5); F(c, circ(0, 0, 33), 'paper', 4);
      const tm = val(o.time, lt, tq * 0.5);   // hours, the hands follow
      inkS(c, 4); c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(tm * Math.PI / 6) * 16, -Math.cos(tm * Math.PI / 6) * 16); c.moveTo(0, 0); c.lineTo(Math.sin(tm * Math.PI * 2) * 25, -Math.cos(tm * Math.PI * 2) * 25); c.stroke();
      if (fc) propFace(c, 0, -6, 0.9, ring ? 'shock' : 'happy', tq);
      if (ring) { inkS(c, 4.5); for (let k = 0; k < 3; k++) [-1, 1].forEach((d) => { c.beginPath(); c.arc(0, -10, 62 + k * 14 + (Math.floor(tq * 12) % 2) * 6, d > 0 ? -0.9 : Math.PI + 0.3, d > 0 ? -0.3 : Math.PI + 0.9); c.stroke(); }); }
    } else if (kind === 'phone') {
      const buzz = ring ? ((Math.floor(tq * 24) % 2) ? 4 : -4) : 0; c.translate(buzz, 0);
      const p = new Path2D(); p.roundRect(-30, -54, 60, 108, 12); F(c, p, 'ink', 0);
      const sc = new Path2D(); sc.roundRect(-24, -44, 48, 84, 5); F(c, sc, a || 'blueF', 0);
      c.fillStyle = col('red'); c.beginPath(); c.arc(16, -36, 7, 0, 7); c.fill();
      c.fillStyle = 'rgba(27,21,18,0.35)'; for (let k = 0; k < 4; k++) c.fillRect(-18, -28 + k * 18, 36 - (k % 2) * 12, 9);
      if (fc) propFace(c, 0, 4, 0.9, ring ? 'shock' : 'happy', tq);
      if (ring) { inkS(c, 4); [-1, 1].forEach((d) => { for (let k = 0; k < 2; k++) { c.beginPath(); c.arc(0, 0, 50 + k * 14, d > 0 ? -0.5 : Math.PI - 0.5, d > 0 ? 0.5 : Math.PI + 0.5); c.stroke(); } }); }
    } else if (kind === 'book') {
      const flap = Math.sin(Math.PI * tq / BEAT()) * 0.5;
      F(c, smoothPath([[-50, -24], [-4, -34], [0, 30], [-46, 38]]), a || 'blue', 4.5);
      F(c, smoothPath([[50, -24], [4, -34], [0, 30], [46, 38]]), a || 'blue', 4.5);
      F(c, smoothPath([[-44, -28], [-2, -36], [-2, 24], [-40, 30]]), 'paper', 3.5);
      c.save(); c.scale(Math.cos(flap), 1); F(c, smoothPath([[2, -36], [42, -30], [40, 28], [2, 24]]), 'paper', 3.5); c.restore();
      inkS(c, 2.5); for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(-36, -16 + k * 11); c.lineTo(-10, -20 + k * 11); c.stroke(); }
      if (fc) propFace(c, -22, 10, 0.7, 'happy', tq);
    } else if (kind === 'bed') {
      F(c, smoothPath([[-60, 20], [-60, -40], [-50, -52], [-40, -40], [-40, 20]]), 'soft', 4.5);
      const m = new Path2D(); m.roundRect(-60, 0, 130, 26, 8); F(c, m, 'paper', 4.5);
      F(c, smoothPath([[-30, 4], [-4, -14], [60, -8], [72, 8], [60, 26], [-30, 26]]), a || 'blue', 4.5);
      F(c, ell(-42, -6, 16, 10), 'paper', 4);
      inkS(c, 6); c.beginPath(); c.moveTo(-56, 26); c.lineTo(-56, 44); c.moveTo(64, 26); c.lineTo(64, 44); c.stroke();
    } else if (kind === 'coffee') {
      F(c, smoothPath([[-30, -20], [-26, 30], [0, 40], [26, 30], [30, -20]]), a || 'paper', 4.5); inkS(c, 5); c.beginPath(); c.arc(34, 2, 13, -1.3, 1.5); c.stroke();
      F(c, ell(0, -20, 30, 7), 'soft', 4);
      for (let k = 0; k < 3; k++) { const q = ((tq / BEAT()) + k / 3) % 1; c.globalAlpha = 1 - q; inkS(c, 3.5); c.beginPath(); c.ellipse(Math.sin(q * 6) * 6, -34 - q * 60, 8 + q * 8, 5 + q * 4, 0, 0, 7); c.stroke(); } c.globalAlpha = 1;
      if (fc) propFace(c, 0, 8, 0.8, 'happy', tq);
    } else if (kind === 'bulb') {
      const on = o.on == null ? true : val(o.on, lt);
      if (on) { c.save(); c.rotate(tq * 1.5); c.fillStyle = col('yellow'); for (let k = 0; k < 10; k++) { c.rotate(Math.PI / 5); c.beginPath(); c.moveTo(-7, -54); c.lineTo(0, -80 - (k % 2) * 12); c.lineTo(7, -54); c.closePath(); c.fill(); inkS(c, 3); c.stroke(); } c.restore(); }
      F(c, smoothPath([[-16, 30], [-32, -6], [-24, -38], [0, -48], [24, -38], [32, -6], [16, 30]]), on ? 'yellow' : 'paper', 4.5);
      const base = new Path2D(); base.roundRect(-16, 28, 32, 22, 4); F(c, base, 'muted', 4);
      if (fc) propFace(c, 0, -12, 0.9, 'happy', tq);
    } else if (kind === 'heart') {
      const k = 1 + bnc(tq, ph) * 0.12; c.scale(k, k);
      F(c, smoothPath([[0, 40], [-40, 6], [-44, -22], [-24, -38], [0, -22], [24, -38], [44, -22], [40, 6]]), a || 'red', 5);
      c.fillStyle = 'rgba(251,242,220,0.7)'; c.beginPath(); c.ellipse(-24, -18, 8, 5, -0.7, 0, 7); c.fill();
      if (fc) propFace(c, 0, -4, 0.85, 'happy', tq);
    } else if (kind === 'bag') {
      F(c, smoothPath([[-40, 36], [-46, 0], [-20, -26], [-12, -40], [12, -40], [20, -26], [46, 0], [40, 36]]), a || 'green', 5);
      inkS(c, 5); c.beginPath(); c.moveTo(-20, -28); c.lineTo(20, -28); c.stroke();
      c.fillStyle = PAPER(); c.font = '900 40px "Fraunces Variable", serif'; c.textAlign = 'center'; c.fillText(o.text || '$', 0, 22);
    } else if (kind === 'bomb') {
      F(c, circ(0, 8, 40), 'ink', 0); c.fillStyle = 'rgba(251,242,220,0.4)'; c.beginPath(); c.ellipse(-14, -6, 10, 6, -0.6, 0, 7); c.fill();
      const cap = new Path2D(); cap.rect(-10, -40, 20, 14); F(c, cap, 'soft', 4);
      inkS(c, 4); c.beginPath(); c.moveTo(0, -40); c.quadraticCurveTo(10, -62, 26, -60); c.stroke();
      const f = Math.floor(tq * 12) % 3; c.fillStyle = col(f ? 'yellow' : 'orange'); c.beginPath(); for (let k = 0; k < 8; k++) { const r = k % 2 ? 6 : 15 + f * 2, an = k / 8 * Math.PI * 2; c.lineTo(26 + Math.cos(an) * r, -60 + Math.sin(an) * r); } c.closePath(); c.fill();
      if (fc) propFace(c, 0, 6, 0.95, 'shock', tq);
    } else if (kind === 'calendar') {
      const p = new Path2D(); p.roundRect(-44, -44, 88, 92, 6); F(c, p, 'paper', 5);
      const t = new Path2D(); t.roundRect(-44, -44, 88, 24, 6); F(c, t, a || 'red', 5);
      inkS(c, 5); [-20, 20].forEach((x) => { c.beginPath(); c.moveTo(x, -54); c.lineTo(x, -36); c.stroke(); });
      c.fillStyle = INK(); c.font = '900 40px "Fraunces Variable", "Noto Serif SC Variable", serif'; c.textAlign = 'center'; c.fillText(String(val(o.text, lt, '1')), 0, 30);
    } else if (kind === 'tv') {
      const p = new Path2D(); p.roundRect(-52, -38, 104, 80, 12); F(c, p, a || 'orange', 5);
      const sc = new Path2D(); sc.roundRect(-40, -28, 66, 58, 10); F(c, sc, 'blueF', 4);
      c.fillStyle = 'rgba(27,21,18,0.15)'; for (let y = -26 + (Math.floor(tq * 12) % 4) * 3; y < 28; y += 6) c.fillRect(-38, y, 62, 2);
      F(c, circ(40, -14, 6), 'ink', 0); F(c, circ(40, 6, 6), 'ink', 0);
      inkS(c, 4); c.beginPath(); c.moveTo(-10, -38); c.lineTo(-30, -66); c.moveTo(6, -38); c.lineTo(26, -66); c.stroke();
      if (fc) propFace(c, -7, -2, 0.85, 'happy', tq);
    } else if (kind === 'trophy') {
      F(c, smoothPath([[-34, -40], [34, -40], [26, 0], [0, 14], [-26, 0]]), 'yellow', 5);
      inkS(c, 5); [-1, 1].forEach((d) => { c.beginPath(); c.arc(d * 36, -24, 13, d > 0 ? -1.6 : 1.6, d > 0 ? 1.6 : 4.7, d < 0); c.stroke(); });
      const st = new Path2D(); st.rect(-8, 12, 16, 16); F(c, st, 'yellow', 4); const bs = new Path2D(); bs.roundRect(-26, 28, 52, 14, 3); F(c, bs, 'ink', 0);
      if (fc) propFace(c, 0, -22, 0.8, 'happy', tq);
    } else if (kind === 'hourglass') {
      const sand = clamp(val(o.level, lt, (lt % 6) / 6));
      inkS(c, 0); F(c, smoothPath([[-30, -44], [30, -44], [4, 0], [30, 44], [-30, 44], [-4, 0]]), 'paper', 5);
      c.fillStyle = col('orange'); c.beginPath(); c.moveTo(-26 * (1 - sand), -40 + 38 * sand); c.lineTo(26 * (1 - sand), -40 + 38 * sand); c.lineTo(2, -2); c.lineTo(-2, -2); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-28, 42); c.lineTo(28, 42); c.lineTo(28 - 26 * (1 - sand), 42 - 36 * sand); c.lineTo(-28 + 26 * (1 - sand), 42 - 36 * sand); c.closePath(); c.fill();
      [-50, 50].forEach((y) => { const p = new Path2D(); p.roundRect(-40, y - 6, 80, 12, 4); F(c, p, 'soft', 4); });
    } else if (kind === 'star') {
      c.rotate(Math.sin(Math.PI * tq / BEAT()) * 0.2);
      const pts = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 20 : 46, an = -Math.PI / 2 + k * Math.PI / 5; pts.push([Math.cos(an) * r, Math.sin(an) * r]); }
      const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(...q) : p.moveTo(...q))); p.closePath(); F(c, p, a || 'yellow', 5);
      if (fc) propFace(c, 0, 2, 0.75, 'happy', tq);
    }
  }

  /** prop(kind, x, y, o): a 1930s prop centred on (x, y), o.size px across (default 160), bouncing on the beat. kind:
   *  'clock' (alarm clock; o.ring true/fn makes it shake and ring, o.time: hours shown by the hands, fn), 'phone' (o.ring
   *  buzzes it), 'book' (pages flap), 'bed', 'coffee' (steam rings), 'bulb' (o.on), 'heart', 'bag' (money bag, o.text:
   *  '$' or '¥'), 'bomb' (lit fuse — a deadline), 'calendar' (o.text: the day, fn), 'tv', 'trophy', 'hourglass' (o.level
   *  0..1 sand fallen, fn), 'star'. o: { size, color (main colour name), face: false (no eyes; on by default), ph (beat
   *  phase), bounce: false, rot (degrees), at, out }. x and y may be functions of lt. */
  B.prop = function (kind, x, y, o = {}) {
    const size = o.size ?? 160, s = size / 100, box = size * 2.2;
    return mountCanvas(this, box, box, (lt) => {
      const k = pop(lt, o.at ?? 0, o.out);
      return k <= 0 ? null : { x: val(x, lt) - box / 2, y: val(y, lt) - box / 2 };
    }, (c, lt) => {
      const tq = step(lt), k = pop(lt, o.at ?? 0, o.out), ph = o.ph ?? 0.5;
      c.translate(box / 2, box / 2 + 50 * s);
      if (o.bounce !== false) boing(c, bnc(tq, ph), 14, 1.2);
      c.translate(0, -50 * s);
      c.scale(s * k, s * k);
      if (o.rot) c.rotate(val(o.rot, lt) * Math.PI / 180);
      drawProp(c, kind, o, tq, ph, lt);
    });
  };

  // ─────────────────────────── backdrops ───────────────────────────
  const cache = {};
  function cached(key, w, hh, paint) {
    if (cache[key]) return cache[key];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh; paint(cv.getContext('2d'));
    return (cache[key] = cv);
  }
  function sunFace(c, x, y, r, tq) {
    c.save(); c.translate(x, y); c.rotate(tq * 0.8); c.fillStyle = col('yellow');
    for (let k = 0; k < 12; k++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(-r * 0.2, -r * 1.08); c.lineTo(0, -r * (1.7 + (k % 2) * 0.25)); c.lineTo(r * 0.2, -r * 1.08); c.closePath(); c.fill(); inkS(c, 4); c.stroke(); }
    c.restore();
    c.save(); c.translate(x, y + r); boing(c, bnc(tq, 0), 8); c.translate(0, -r);
    F(c, circ(0, 0, r), 'yellow', 5); propFace(c, 0, -r * 0.1, r / 34, 'happy', tq);
    c.fillStyle = col('orange'); c.globalAlpha = 0.6; c.beginPath(); c.arc(-r * 0.55, r * 0.25, r * 0.15, 0, 7); c.arc(r * 0.55, r * 0.25, r * 0.15, 0, 7); c.fill(); c.globalAlpha = 1;
    c.restore();
  }
  function cloud(c, x, y, s, tq, ph) {
    c.save(); c.translate(x, y + 30 * s); boing(c, bnc(tq, ph), 8); c.translate(0, -30 * s);
    F(c, smoothPath([[-70 * s, 26 * s], [-80 * s, 0], [-46 * s, -22 * s], [-10 * s, -38 * s], [30 * s, -28 * s], [70 * s, -6 * s], [76 * s, 24 * s]]), 'paper', 5);
    c.restore();
  }
  function tree(c, x, ground, s, tq, ph) {
    const sway = Math.sin(Math.PI * (tq / BEAT() + ph)) * 0.12;
    c.save(); c.translate(x, ground); boing(c, bnc(tq, ph), 10); c.rotate(sway);
    F(c, smoothPath([[-12 * s, 0], [-10 * s, -90 * s], [10 * s, -90 * s], [12 * s, 0]]), 'soft', 4.5);
    F(c, smoothPath([[-70 * s, -100 * s], [-56 * s, -170 * s], [0, -200 * s], [56 * s, -170 * s], [70 * s, -100 * s], [30 * s, -76 * s], [-30 * s, -76 * s]]), 'green', 5);
    propFace(c, 0, -140 * s, s * 1.3, 'happy', tq);
    c.restore();
  }
  /** scene(kind, o): a full-frame backdrop, drawn first on the page so everything sits on it; it reaches past the frame
   *  edges, so camera moves never show a border. kind: 'hills' (rolling hills, a grinning sun with turning rays,
   *  bouncing clouds and dancing trees), 'room' (striped wallpaper, floorboards, a window with the sun outside, a
   *  wall clock), 'stage' (theatre: swagged red curtains, footlights, a spotlight on the boards), 'night' (rooftops, a
   *  sleepy moon, twinkling stars), 'mind' (inside the head: a pink brain-fold wallpaper and a control desk with levers
   *  — for "the voices in your head"), 'sunburst' (rotating rays behind a centre — for big moments). o: { floor (y of
   *  the ground line, default 860), tint (the dominant colour name), at (it cuts in at this moment), out (cuts away) }. */
  B.scene = function (kind, o = {}) {
    const PADX = 260, PADY = 160, w = W + PADX * 2, hh = H + PADY * 2, floor = (o.floor ?? STAGE.area.y1 - 20) + PADY;
    return mountCanvas(this, w, hh, (lt) => {
      const tq = step(lt);
      if (o.at != null && tq < o.at) return null;
      if (o.out != null && tq >= o.out) return null;
      return { x: -PADX, y: -PADY };
    }, (c, lt) => {
      const tq = step(lt);
      if (kind === 'hills') {
        c.drawImage(cached('hills' + floor, w, hh, (g) => {
          const sky = g.createLinearGradient(0, 0, 0, floor); sky.addColorStop(0, '#F3E3BE'); sky.addColorStop(1, '#F8EED6'); g.fillStyle = sky; g.fillRect(0, 0, w, hh);
          g.fillStyle = col('greenF'); g.beginPath(); g.moveTo(0, floor - 120); g.bezierCurveTo(w * 0.2, floor - 260, w * 0.4, floor - 60, w * 0.55, floor - 170); g.bezierCurveTo(w * 0.7, floor - 280, w * 0.85, floor - 100, w, floor - 190); g.lineTo(w, hh); g.lineTo(0, hh); g.fill(); inkS(g, 5); g.stroke();
          g.fillStyle = col('green'); g.beginPath(); g.moveTo(0, floor - 10); g.bezierCurveTo(w * 0.3, floor - 70, w * 0.6, floor + 30, w, floor - 30); g.lineTo(w, hh); g.lineTo(0, hh); g.fill(); inkS(g, 5); g.stroke();
          g.fillStyle = 'rgba(27,21,18,0.12)'; for (let k = 0; k < 60; k++) { const r = PV.rng(k + 7), x = r() * w, y = floor + 20 + r() * (hh - floor - 20); g.beginPath(); g.ellipse(x, y, 10, 3, 0, 0, 7); g.fill(); }
        }), 0, 0);
        sunFace(c, PADX + W - 420, PADY + 230, 82, tq);
        cloud(c, PADX + 260 + (tq * 14) % 200, PADY + 150, 1.2, tq, 0.2); cloud(c, PADX + 900 + (tq * 10) % 160, PADY + 90, 0.9, tq, 0.7);
        tree(c, PADX + 190, floor - 40, 1.3, tq, 0.25); tree(c, PADX + W - 160, floor - 70, 1.05, tq, 0.75);
      } else if (kind === 'room') {
        c.drawImage(cached('room' + floor + (o.tint || ''), w, hh, (g) => {
          g.fillStyle = '#F1E2C0'; g.fillRect(0, 0, w, hh);
          for (let x = 0; x < w; x += 72) { g.fillStyle = col(o.tint ? o.tint + 'F' : 'orangeF'); g.fillRect(x, 0, 34, floor - 40); }
          g.fillStyle = 'rgba(27,21,18,0.14)'; for (let y = 40; y < floor - 60; y += 80) for (let x = 53; x < w; x += 72) { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y); g.lineTo(x, y + 8); g.lineTo(x - 7, y); g.fill(); }
          g.fillStyle = col('soft'); g.fillRect(0, floor - 44, w, 30); inkS(g, 5); g.beginPath(); g.moveTo(0, floor - 44); g.lineTo(w, floor - 44); g.moveTo(0, floor - 14); g.lineTo(w, floor - 14); g.stroke();
          g.fillStyle = '#D9C29A'; g.fillRect(0, floor - 14, w, hh); inkS(g, 3); g.strokeStyle = 'rgba(27,21,18,0.5)';
          for (let y = floor + 30; y < hh; y += 56) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
          for (let k = 0; k < 60; k++) { const row = Math.floor(k / 10), y = floor - 14 + row * 56 + (row ? 30 - 56 : 0); const x = (k % 10) * 290 + (row % 2) * 145; g.beginPath(); g.moveTo(x, Math.max(floor - 14, y)); g.lineTo(x, y + 56); g.stroke(); }
          const vg = g.createRadialGradient(w / 2, hh * 0.45, 300, w / 2, hh * 0.5, 1300); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,40,20,0.35)'); g.fillStyle = vg; g.fillRect(0, 0, w, hh);
        }), 0, 0);
        // window with the sun outside
        const wx = PADX + W - 680, wy = PADY + 120, ww = 420, wh = 340;
        c.save(); c.beginPath(); c.rect(wx, wy, ww, wh); c.clip(); c.fillStyle = '#F8EFD8'; c.fillRect(wx, wy, ww, wh);
        c.fillStyle = col('greenF'); c.beginPath(); c.moveTo(wx, wy + wh - 60); c.quadraticCurveTo(wx + ww / 2, wy + wh - 130, wx + ww, wy + wh - 70); c.lineTo(wx + ww, wy + wh); c.lineTo(wx, wy + wh); c.fill(); inkS(c, 4); c.stroke();
        sunFace(c, wx + ww * 0.66, wy + 110, 46, tq); cloud(c, wx + 110 + (tq * 12) % 80, wy + 90, 0.7, tq, 0.4);
        c.restore();
        c.fillStyle = PAPER(); inkS(c, 6);
        [[wx - 14, wy - 14, ww + 28, 18], [wx - 14, wy + wh - 4, ww + 28, 18], [wx - 14, wy - 14, 18, wh + 28], [wx + ww - 4, wy - 14, 18, wh + 28], [wx + ww / 2 - 8, wy, 16, wh], [wx, wy + wh / 2 - 8, ww, 16]].forEach((r) => { c.fillRect(...r); c.strokeRect(...r); });
        [[wx - 40, 1], [wx + ww + 40, -1]].forEach(([x, sg], k) => {
          const swg = (bnc(tq, 0.5 + k * 0.5) - 0.5) * 16 * sg;
          const p = smoothPath([[x, wy - 40], [x + sg * 70, wy - 40], [x + sg * 50, wy + 120], [x + sg * 24, wy + 190], [x + sg * 66 + swg, wy + 330], [x + sg * 30 + swg, wy + 400], [x - sg * 4, wy + 400]]);
          F(c, p, o.tint || 'red', 5); c.save(); c.clip(p); c.fillStyle = 'rgba(251,242,220,0.85)'; for (let yy = wy - 40; yy < wy + 420; yy += 32) for (let xx = x - 90; xx < x + 90; xx += 32) { c.beginPath(); c.arc(xx + ((yy / 32) & 1) * 16, yy, 5, 0, 7); c.fill(); } c.restore(); inkS(c, 5); c.stroke(p);
        });
        inkS(c, 9); c.beginPath(); c.moveTo(wx - 80, wy - 40); c.lineTo(wx + ww + 80, wy - 40); c.stroke();
        // wall clock that ticks on the beat
        c.save(); c.translate(PADX + 420, PADY + 200); c.rotate(Math.sin(Math.PI * tq / BEAT()) * 0.06); c.scale(0.9, 0.9); drawProp(c, 'clock', { face: true, time: Math.floor(tq / BEAT()) / 60 }, tq, 0, lt); c.restore();
      } else if (kind === 'stage') {
        c.drawImage(cached('stage' + floor, w, hh, (g) => {
          g.fillStyle = '#2A1D16'; g.fillRect(0, 0, w, hh);
          const sp = g.createRadialGradient(w / 2, floor - 40, 40, w / 2, floor - 200, 760); sp.addColorStop(0, 'rgba(251,236,196,0.95)'); sp.addColorStop(0.55, 'rgba(240,214,160,0.55)'); sp.addColorStop(1, 'rgba(240,214,160,0)'); g.fillStyle = sp; g.fillRect(0, 0, w, hh);
          g.fillStyle = '#B9874F'; g.fillRect(0, floor, w, hh); inkS(g, 3); g.strokeStyle = 'rgba(27,21,18,0.55)'; for (let x = -400; x < w + 400; x += 120) { g.beginPath(); g.moveTo(w / 2 + (x - w / 2) * 0.55, floor); g.lineTo(x, hh); g.stroke(); }
          inkS(g, 6); g.beginPath(); g.moveTo(0, floor); g.lineTo(w, floor); g.stroke();
          const lt2 = g.createRadialGradient(w / 2, floor + 40, 50, w / 2, floor + 40, 520); lt2.addColorStop(0, 'rgba(255,245,215,0.6)'); lt2.addColorStop(1, 'rgba(255,245,215,0)'); g.fillStyle = lt2; g.beginPath(); g.ellipse(w / 2, floor + 40, 520, 90, 0, 0, 7); g.fill();
        }), 0, 0);
        const sway = Math.sin(Math.PI * tq / BEAT()) * 8;
        [[0, 1], [w, -1]].forEach(([x, sg]) => {
          const p = new Path2D(); p.moveTo(x, -20); p.lineTo(x + sg * 560, -20); p.bezierCurveTo(x + sg * 420, 300, x + sg * 300 + sway * sg, 500, x + sg * 380 + sway * sg, floor + 40); p.lineTo(x, floor + 40); p.closePath();
          F(c, p, o.tint || 'red', 6);
          c.save(); c.clip(p); inkS(c, 3); c.strokeStyle = 'rgba(27,21,18,0.4)'; for (let k = 1; k < 8; k++) { c.beginPath(); c.moveTo(x + sg * k * 70, -20); c.quadraticCurveTo(x + sg * k * 50, 400, x + sg * k * 46 + sway * sg * 0.5, floor + 40); c.stroke(); } c.restore();
          c.fillStyle = col('yellow'); c.beginPath(); c.arc(x + sg * 330, 470, 18, 0, 7); c.fill(); inkS(c, 4); c.stroke();
        });
        const vy = PADY + 40;
        c.fillStyle = col(o.tint || 'red'); c.beginPath(); c.moveTo(0, -20); c.lineTo(w, -20); c.lineTo(w, vy);
        for (let k = 14; k >= 1; k--) { const x0 = (w / 14) * k, x1 = (w / 14) * (k - 1); c.quadraticCurveTo((x0 + x1) / 2, vy + 90, x1, vy); }
        c.closePath(); c.fill(); inkS(c, 6); c.stroke();
        inkS(c, 3); c.strokeStyle = 'rgba(27,21,18,0.4)'; for (let k = 0; k < 14; k++) { const x = (w / 14) * (k + 0.5); c.beginPath(); c.moveTo(x, -20); c.lineTo(x, vy + 50); c.stroke(); }
        c.fillStyle = col('yellow'); for (let k = 0; k <= 14; k++) { c.beginPath(); c.arc((w / 14) * k, vy + 4, 10, 0, 7); c.fill(); inkS(c, 3.5); c.stroke(); }
        for (let k = 0; k < 9; k++) { const x = w / 2 - 640 + k * 160; c.fillStyle = (Math.floor(tq * 12 / 6) + k) % 2 ? '#FFF2C8' : col('yellow'); c.beginPath(); c.arc(x, floor + 14, 13, Math.PI, 0); c.fill(); inkS(c, 4); c.stroke(); }
      } else if (kind === 'night') {
        c.drawImage(cached('night' + floor, w, hh, (g) => {
          const sky = g.createLinearGradient(0, 0, 0, floor); sky.addColorStop(0, '#1F2B33'); sky.addColorStop(1, '#3B4C4E'); g.fillStyle = sky; g.fillRect(0, 0, w, hh);
          for (let k = 0; k < 14; k++) { const r = PV.rng(k * 13 + 3), bw = 140 + r() * 160, bh = 200 + r() * 340, x = k * (w / 13) - 40; g.fillStyle = k % 2 ? '#22262A' : '#2C3236'; g.fillRect(x, floor - bh, bw, bh + 400); inkS(g, 4); g.strokeRect(x, floor - bh, bw, bh + 400);
            for (let wy2 = floor - bh + 30; wy2 < floor - 40; wy2 += 60) for (let wx2 = x + 20; wx2 < x + bw - 30; wx2 += 46) { if (r() < 0.45) { g.fillStyle = col('yellow'); g.fillRect(wx2, wy2, 24, 30); } } }
        }), 0, 0);
        for (let k = 0; k < 40; k++) { const r = PV.rng(k + 99), x = r() * w, y = r() * (floor - 400), tw = (Math.floor(tq * 12 / 3) + k) % 4 === 0; c.fillStyle = '#FBF2DC'; c.save(); c.translate(x, y); c.rotate(Math.PI / 4); const sz = tw ? 9 : 4; c.fillRect(-sz / 2, -sz / 2, sz, sz); c.restore(); }
        c.save(); c.translate(w * 0.74, 250); c.rotate(Math.sin(Math.PI * tq / BEAT() / 2) * 0.08);
        const moon = new Path2D(); moon.arc(0, 0, 90, 0, Math.PI * 2); const bite = new Path2D(); bite.arc(46, -30, 84, 0, Math.PI * 2);
        c.save(); c.clip(moon); c.fillStyle = '#FBF0C8'; c.fill(moon); c.globalCompositeOperation = 'destination-out'; c.fill(bite); c.restore();
        inkS(c, 5); c.beginPath(); c.arc(0, 0, 90, 0.9, 5.0); c.stroke();
        inkS(c, 4.5); c.beginPath(); c.arc(-46, -10, 12, 0.2, Math.PI - 0.2); c.stroke(); c.beginPath(); c.arc(-40, 34, 14, 0.5, Math.PI - 0.6); c.stroke();
        c.restore();
      } else if (kind === 'mind') {
        c.drawImage(cached('mind' + floor, w, hh, (g) => {
          g.fillStyle = '#F2CFC2'; g.fillRect(0, 0, w, hh);
          inkS(g, 4); g.strokeStyle = 'rgba(160,70,70,0.45)';
          for (let k = 0; k < 90; k++) { const r = PV.rng(k * 7 + 1), x = r() * w, y = r() * floor, s = 40 + r() * 70; g.beginPath(); g.moveTo(x - s, y); g.bezierCurveTo(x - s * 0.5, y - s * 0.7, x, y + s * 0.6, x + s * 0.4, y - s * 0.2); g.bezierCurveTo(x + s * 0.7, y - s * 0.6, x + s, y + s * 0.3, x + s * 1.2, y); g.stroke(); }
          g.fillStyle = '#5A3A30'; g.fillRect(0, floor, w, hh); inkS(g, 6); g.beginPath(); g.moveTo(0, floor); g.lineTo(w, floor); g.stroke();
          const vg = g.createRadialGradient(w / 2, hh * 0.45, 360, w / 2, hh * 0.5, 1250); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,20,20,0.5)'); g.fillStyle = vg; g.fillRect(0, 0, w, hh);
        }), 0, 0);
        // the control desk: a long console with dials and two big levers
        const dx = w / 2, dy = floor - 10;
        const desk = new Path2D(); desk.moveTo(dx - 520, dy); desk.lineTo(dx - 470, dy - 150); desk.lineTo(dx + 470, dy - 150); desk.lineTo(dx + 520, dy); desk.closePath(); F(c, desk, 'soft', 6);
        const top = new Path2D(); top.roundRect(dx - 480, dy - 176, 960, 30, 10); F(c, top, 'muted', 5);
        for (let k = 0; k < 6; k++) { const x = dx - 380 + k * 152, on = (Math.floor(tq * 12 / 4) + k) % 3 === 0; F(c, circ(x, dy - 92, 22), on ? (k % 2 ? 'red' : 'yellow') : 'paper', 4.5); }
        [[dx - 300, 'red'], [dx + 300, 'blue']].forEach(([x, cl], k) => { const a = Math.sin(Math.PI * (tq / BEAT() + k * 0.5)) * 0.25; c.save(); c.translate(x, dy - 176); c.rotate(a); inkS(c, 12); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -120); c.stroke(); F(c, circ(0, -130, 24), cl, 5); c.restore(); });
      } else if (kind === 'sunburst') {
        c.fillStyle = col(o.tint ? o.tint : 'orange'); c.fillRect(0, 0, w, hh);
        c.save(); c.translate(w / 2, hh / 2); c.rotate(tq * 0.25); c.fillStyle = col(o.tint ? o.tint + 'F' : 'yellow');
        for (let k = 0; k < 24; k++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 2000, k * Math.PI / 12, k * Math.PI / 12 + Math.PI / 24); c.closePath(); c.fill(); }
        c.restore();
        const vg = c.createRadialGradient(w / 2, hh / 2, 200, w / 2, hh / 2, 1300); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,30,10,0.45)'); c.fillStyle = vg; c.fillRect(0, 0, w, hh);
      }
    });
  };

  // ─────────────────────────── staging pieces ───────────────────────────
  /** boing(L, ax, ay, o): make any layer from P.layer() bounce on the beat around its ground point (ax, ay), with squash
   *  and stretch, stepped at 12 fps — the way to bring hand-drawn P.box / P.text groups into the dance. o: { amp px
   *  (default 16), ph (beat phase), from, to (page seconds it bounces between) } */
  B.boing = function (L, ax, ay, o = {}) {
    const wrap = L.wrap || L;
    wrap.style.transformOrigin = `${ax}px ${ay}px`;
    this.tick((lt) => {
      const on = lt >= (o.from ?? 0) && lt <= (o.to ?? 1e9);
      const b = on ? bnc(step(lt), o.ph ?? 0) : 0, sq = (1 - b) * 0.07, st = b * 0.04;
      wrap.style.transform = on ? `translateY(${(-b * (o.amp ?? 16)).toFixed(1)}px) scale(${(1 + sq - st * 0.6).toFixed(4)}, ${(1 - sq + st).toFixed(4)})` : '';
    });
    return L;
  };

  /** iris(o): the classic iris transition on top of everything (including the title): 'in' opens a circle from black at
   *  the start of a scene, 'out' closes it onto a point to end one (the last page closes on its hero). o: { mode: 'in'
   *  | 'out', at (default 0 for 'in'; for 'out' use P.endT - 0.7), dur (0.6), x, y (centre, default frame centre) } */
  B.iris = function (o = {}) {
    const T = this.hud || this, mode = o.mode || 'in', at = o.at ?? 0, dur = o.dur ?? 0.6, cx = o.x ?? W / 2, cy = o.y ?? H / 2;
    const c = h('canvas', null, null, T.html); c.width = W / 2; c.height = H / 2;
    Object.assign(c.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 30 });
    const ctx = c.getContext('2d'), Rmax = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    T.tick((lt) => {
      const tq = step(lt), k = clamp((tq - at) / dur), r = mode === 'in' ? ease.out(k) * Rmax : (1 - ease.inOut(k)) * Rmax;
      const show = mode === 'in' ? k < 1 : tq >= at;
      c.style.display = show ? '' : 'none';
      if (!show) return;
      ctx.setTransform(0.5, 0, 0, 0.5, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#120D0A';
      ctx.beginPath(); ctx.rect(0, 0, W, H); if (r > 1) ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill('evenodd');
      if (r > 1) { ctx.strokeStyle = '#120D0A'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    });
    return c;
  };

  /** titleCard(text, o): a full-frame 1930s title card for the opening or a chapter: rotating sunburst, an ornate oval
   *  plate with a scalloped rim, the title in heavy lettering and a small line under it. Put it on its own page or the
   *  first beats of one, then hide it (o.out) as the scene appears. o: { sub (small line), at, out, tint (colour name of
   *  the rays), size (title px, default 120) } */
  B.titleCard = function (text, o = {}) {
    const T = this, at = o.at ?? 0;
    T.scene('sunburst', { tint: o.tint || 'red', out: o.out });
    mountCanvas(T, 1300, 760, (lt) => (pop(lt, at, o.out) <= 0 ? null : { x: W / 2 - 650, y: H / 2 - 400 }), (c, lt) => {
      const k = pop(lt, at, o.out), tq = step(lt);
      c.translate(650, 380); c.scale(k, k); c.rotate(Math.sin(Math.PI * tq / BEAT()) * 0.012);
      const N = 40, R1 = 560, R2 = 300; c.beginPath();
      for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, r = 1 + 0.05 * Math.cos(a * N / 2 * 2); c.lineTo(Math.cos(a) * (R1 + 24) * r, Math.sin(a) * (R2 + 24) * r); }
      c.closePath(); c.fillStyle = col('ink'); c.fill();
      F(c, ell(0, 0, R1, R2), 'paper', 6); inkS(c, 3); c.beginPath(); c.ellipse(0, 0, R1 - 22, R2 - 22, 0, 0, 7); c.stroke();
      c.fillStyle = col(o.tint || 'red'); [[-R1 + 50, 0], [R1 - 50, 0]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 14, 0, 7); c.fill(); inkS(c, 4); c.stroke(); });
    });
    const el = h('div', 'rh-card', `<span class="big" style="font-size:${o.size ?? 120}px">${text}</span>${o.sub ? `<span class="small" style="font-size:${Math.round((o.size ?? 120) * 0.3)}px">${o.sub}</span>` : ''}`, T.html);
    Object.assign(el.style, { left: W / 2 - 520 + 'px', width: '1040px', top: H / 2 - 20 + 'px', transform: 'translateY(-50%)' });
    T.tick((lt) => { const k = pop(lt, at + 0.08, o.out); el.style.opacity = k > 0.05 ? '1' : '0'; el.style.transform = `translateY(-50%) scale(${k.toFixed(3)})`; });
    return el;
  };

  /** balloon(x, y, w, h, text, o): a speech balloon centred on (x, y), w × h px, its tail pointing at o.tail [x, y] (a
   *  character's mouth). It pops in on the beat. o: { think (a thought cloud with bubbles instead of a tail), size (text
   *  px, default 44), color (text colour name), fill (balloon colour name, default 'paper'), at, out } */
  B.balloon = function (x, y, w, hh, text, o = {}) {
    const pad = 120, tail = o.tail || [x - w * 0.3, y + hh * 0.9];
    mountCanvas(this, w + pad * 2 + Math.abs(tail[0] - x), hh + pad * 2 + Math.abs(tail[1] - y), (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: Math.min(x - w / 2, tail[0]) - pad, y: Math.min(y - hh / 2, tail[1]) - pad }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out), ox = Math.min(x - w / 2, tail[0]) - pad, oy = Math.min(y - hh / 2, tail[1]) - pad;
      c.translate(x - ox, y - oy); c.scale(k, k);
      const tx = tail[0] - x, ty = tail[1] - y;
      if (o.think) {
        const p = new Path2D(); const N = 11; for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; p.moveTo(Math.cos(a) * w * 0.42 + w * 0.12, Math.sin(a) * hh * 0.42); p.arc(Math.cos(a) * w * 0.42, Math.sin(a) * hh * 0.42, Math.min(w, hh) * 0.16, 0, Math.PI * 2); }
        F(c, p, o.fill || 'paper', 5); F(c, ell(0, 0, w * 0.44, hh * 0.42), o.fill || 'paper', 0);
        [0.55, 0.75, 0.9].forEach((q, i) => F(c, circ(tx * q, ty * q, 16 - i * 4), o.fill || 'paper', 4));
      } else {
        const p = new Path2D(); p.ellipse(0, 0, w / 2, hh / 2, 0, 0, Math.PI * 2);
        const ang = Math.atan2(ty, tx), sp = 0.28;
        const t = new Path2D(); t.moveTo(Math.cos(ang - sp) * w * 0.4, Math.sin(ang - sp) * hh * 0.4); t.quadraticCurveTo(tx * 0.6, ty * 0.6, tx, ty); t.quadraticCurveTo(tx * 0.5, ty * 0.5, Math.cos(ang + sp) * w * 0.4, Math.sin(ang + sp) * hh * 0.4); t.closePath();
        F(c, t, o.fill || 'paper', 5); F(c, p, o.fill || 'paper', 5); c.fillStyle = col(o.fill || 'paper'); c.fill(t); c.save(); c.clip(p); c.restore();
        inkS(c, 5); c.beginPath(); c.ellipse(0, 0, w / 2, hh / 2, 0, ang + sp + 0.08, ang - sp - 0.08 + Math.PI * 2); c.stroke();
      }
    });
    const el = h('div', 'rh-say', text, this.html);
    Object.assign(el.style, { left: x - w * 0.42 + 'px', top: y - hh * 0.4 + 'px', width: w * 0.84 + 'px', height: hh * 0.8 + 'px', fontSize: (o.size ?? 44) + 'px', color: col(o.color || 'ink') });
    this.tick((lt) => { const k = pop(lt, (o.at ?? 0) + 0.08, o.out); el.style.opacity = k > 0.05 ? '1' : '0'; el.style.transform = `scale(${k.toFixed(3)})`; });
    return el;
  };

  /** burst(x, y, text, o): a cartoon impact burst — a jagged star with a word inside ("BANG!", "啊！", "+1"), popping in
   *  and jittering on 12s. For a punchline, a realisation, an alarm. o: { r (radius px, default 150), size (text px), fill
   *  (colour name, default 'yellow'), color (text colour), at, out } */
  B.burst = function (x, y, text, o = {}) {
    const r = o.r ?? 150, box = r * 2.6;
    mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      const tq = step(lt), k = pop(lt, o.at ?? 0, o.out), j = Math.floor(tq * 12) % 2;
      c.translate(box / 2, box / 2); c.scale(k, k); c.rotate(j ? 0.04 : -0.04);
      const pts = []; const N = 14; for (let i = 0; i < N * 2; i++) { const rr = i % 2 ? r * 0.7 : r * (1.05 + (PV.rng(i * 3 + 1)() - 0.5) * 0.3), a = i / (N * 2) * Math.PI * 2; pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]); }
      const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(...q) : p.moveTo(...q))); p.closePath();
      c.save(); c.translate(10, 14); c.fillStyle = col('ink'); c.fill(p); c.restore();
      F(c, p, o.fill || 'yellow', 6);
      c.scale(0.72, 0.72); F(c, p, o.fill2 || 'red', 0);
    });
    const el = h('div', 'rh-say', text, this.html);
    Object.assign(el.style, { left: x - r * 0.8 + 'px', top: y - r * 0.5 + 'px', width: r * 1.6 + 'px', height: r + 'px', fontSize: (o.size ?? Math.round(r * 0.42)) + 'px', color: col(o.color || 'paper'), textShadow: '4px 4px 0 #1B1512' });
    this.tick((lt) => { const k = pop(lt, (o.at ?? 0) + 0.06, o.out); el.style.opacity = k > 0.05 ? '1' : '0'; el.style.transform = `scale(${k.toFixed(3)}) rotate(${(Math.floor(step(lt) * 12) % 2 ? -3 : 3)}deg)`; });
    return el;
  };

  /** sign(x, y, text, o): a wooden placard on a post planted at (x, y) (the post's foot), bouncing on the beat — names a
   *  character ("现在的我"), a place or a number. o: { w (board width, default from the text), size (text px, 44), fill
   *  (board colour name, default 'orange'), color (text colour), post: false (a floating board), ph, at, out } */
  B.sign = function (x, y, text, o = {}) {
    const size = o.size ?? 44, bw = o.w ?? Math.max(220, PV.tw(text, size) + 90), bh = size * 1.9, post = o.post !== false, ph = post ? 200 : 0;
    const L = this.layer();
    mountCanvas(L, bw + 60, bh + ph + 60, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - bw / 2 - 30, y: y - bh - ph - 30 }), (c, lt) => {
      const k = pop(lt, o.at ?? 0, o.out);
      c.translate(bw / 2 + 30, bh + ph + 30); c.scale(k, k);
      if (post) { const p = new Path2D(); p.rect(-12, -ph - 10, 24, ph + 10); F(c, p, 'soft', 5); }
      const b = new Path2D(); b.roundRect(-bw / 2, -ph - bh, bw, bh, 14); c.save(); c.translate(8, 10); c.fillStyle = col('ink'); c.fill(b); c.restore(); F(c, b, o.fill || 'orange', 6);
      inkS(c, 3); c.strokeStyle = 'rgba(27,21,18,0.35)'; for (let k2 = 1; k2 < 3; k2++) { c.beginPath(); c.moveTo(-bw / 2 + 16, -ph - bh + k2 * bh / 3); c.lineTo(bw / 2 - 16, -ph - bh + k2 * bh / 3 + 4); c.stroke(); }
      c.fillStyle = col('ink'); [[-bw / 2 + 18, -ph - bh + 18], [bw / 2 - 18, -ph - bh + 18]].forEach(([nx, ny]) => { c.beginPath(); c.arc(nx, ny, 5, 0, 7); c.fill(); });
    });
    const el = h('div', 'rh-say', text, L.html);
    Object.assign(el.style, { left: x - bw / 2 + 'px', top: y - ph - bh + 'px', width: bw + 'px', height: bh + 'px', fontSize: size + 'px', color: col(o.color || 'ink') });
    this.tick((lt) => { const k = pop(lt, (o.at ?? 0) + 0.06, o.out); el.style.opacity = k > 0.05 ? '1' : '0'; el.style.transform = `scale(${k.toFixed(3)})`; el.style.transformOrigin = `50% ${bh + ph}px`; });
    this.boing(L, x, y, { amp: 10, ph: o.ph ?? 0.3 });
    return L;
  };

  /** fx(kind, x, y, o): small cartoon effects at a point, stepped on 12s: 'stars' (dizzy stars circling a head), 'hearts'
   *  (hearts floating up), 'sweat' (flying sweat drops), 'zzz', 'notes' (music notes rising), 'dust' (a puff where
   *  something lands or runs off), 'sparkle' (twinkles around a reward), 'question' / 'exclaim' (a big ? or ! popping
   *  over a head). o: { size (scale, 1), color, at, out } */
  B.fx = function (kind, x, y, o = {}) {
    const s = o.size ?? 1, box = 360 * s;
    return mountCanvas(this, box, box, (lt) => (pop(lt, o.at ?? 0, o.out) <= 0 ? null : { x: x - box / 2, y: y - box / 2 }), (c, lt) => {
      const tq = step(lt), at = o.at ?? 0, q0 = Math.max(0, tq - at), k = pop(lt, at, o.out);
      c.translate(box / 2, box / 2); c.scale(s, s);
      c.globalAlpha = Math.min(1, k);
      if (kind === 'stars') { for (let i = 0; i < 5; i++) { const a = q0 * 4 + i / 5 * Math.PI * 2; c.save(); c.translate(Math.cos(a) * 90, Math.sin(a) * 26); drawProp(c, 'star', { face: false, color: i % 2 ? 'yellow' : 'orange' }, tq, 0, lt); c.restore(); } }
      else if (kind === 'hearts' || kind === 'notes') { for (let i = 0; i < 4; i++) { const q = (q0 * 0.7 + i / 4) % 1; c.save(); c.globalAlpha = (1 - q) * Math.min(1, k); c.translate(Math.sin(q * 7 + i) * 40 + (i - 1.5) * 30, 60 - q * 220); c.scale(0.5, 0.5);
        if (kind === 'hearts') drawProp(c, 'heart', { face: false }, tq, 0, lt); else { c.fillStyle = col(o.color || 'ink'); c.beginPath(); c.ellipse(0, 30, 22, 16, -0.4, 0, 7); c.fill(); inkS(c, 8); c.beginPath(); c.moveTo(18, 26); c.lineTo(18, -50); c.quadraticCurveTo(40, -36, 46, -14); c.stroke(); } c.restore(); } }
      else if (kind === 'sweat') { for (let i = 0; i < 4; i++) { const q = (q0 * 1.6 + i / 4) % 1, a = -Math.PI / 2 + (i - 1.5) * 0.6; c.save(); c.translate(Math.cos(a) * (40 + q * 110), Math.sin(a) * (40 + q * 110) + q * q * 60); c.rotate(a + Math.PI / 2); F(c, smoothPath([[0, -18], [-10, 4], [0, 12], [10, 4]]), 'blueF', 3.5); c.restore(); } }
      else if (kind === 'zzz') { c.fillStyle = col(o.color || 'ink'); c.font = '900 56px "Fraunces Variable", serif'; for (let i = 0; i < 3; i++) { const q = (q0 * 0.5 + i / 3) % 1; c.globalAlpha = (1 - q) * Math.min(1, k); c.fillText('Z', -20 + q * 90 + Math.sin(q * 6) * 14, 60 - q * 180); } }
      else if (kind === 'dust') { for (let i = 0; i < 6; i++) { const q = clamp(q0 / 0.6), a = Math.PI + i / 5 * Math.PI; c.globalAlpha = 1 - q; F(c, circ(Math.cos(a) * (30 + q * 120), 40 + Math.sin(a) * (10 + q * 40), 26 * (1 - q * 0.5)), 'paper', 4); } }
      else if (kind === 'sparkle') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, on = (Math.floor(tq * 12 / 2) + i) % 3 === 0, r = on ? 22 : 10; c.save(); c.translate(Math.cos(a) * 120, Math.sin(a) * 100); c.fillStyle = col(o.color || 'yellow'); c.beginPath(); for (let j = 0; j < 8; j++) { const rr = j % 2 ? r * 0.25 : r, aa = j / 8 * Math.PI * 2; c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); } c.closePath(); c.fill(); inkS(c, 3); c.stroke(); c.restore(); } }
      else if (kind === 'question' || kind === 'exclaim') { const b = bnc(tq, 0) * 12; c.translate(0, -b); c.font = '900 170px "Fraunces Variable", serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 12; c.strokeStyle = col('ink'); c.lineJoin = 'round'; const ch = kind === 'question' ? '?' : '!'; c.strokeText(ch, 0, 0); c.fillStyle = col(o.color || (kind === 'question' ? 'yellow' : 'red')); c.fillText(ch, 0, 0); }
      c.globalAlpha = 1;
    });
  };

  // ─────────────────────────── the page title: a vintage plate ───────────────────────────
  Builder.prototype.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.15;
    const el = h('div', 'rh-title', String(str).replace(/</g, '&lt;') + (o.sub ? `<span class="sub">${o.sub}</span>` : ''), T.html);
    if (o.size) el.style.fontSize = o.size + 'px';
    T.tick((lt) => {
      const k = pop(lt, at, o.out);
      el.style.opacity = k > 0.02 ? '1' : '0';
      el.style.transform = `translateY(${((1 - Math.min(1, k)) * -60).toFixed(1)}px) rotate(${((1 - Math.min(1, k)) * -6 + Math.sin(Math.PI * step(lt) / BEAT() / 2) * 0.6).toFixed(2)}deg) scale(${Math.max(0.01, k).toFixed(3)})`;
    });
    const hnd = { el, spans: [el], a: { dur: 0.34 }, hide: (t) => { o.out = t; return hnd; } };
    return hnd;
  };

  // ─────────────────────────── the film gate (every frame of the film) ───────────────────────────
  // restrained on purpose: the motion must come from the characters, not the noise
  (function filmGate() {
    const frame = document.getElementById('frame');
    if (!frame) return;
    const cv = document.createElement('canvas'); cv.width = W / 2; cv.height = H / 2; cv.className = 'rh-film';
    Object.assign(cv.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 34, pointerEvents: 'none' });
    frame.appendChild(cv);
    const g = cv.getContext('2d');
    const grain = document.createElement('canvas'); grain.width = 512; grain.height = 512;
    { const gg = grain.getContext('2d'), img = gg.createImageData(512, 512), r = PV.rng(4242); for (let i = 0; i < img.data.length; i += 4) { const v = r() < 0.5 ? 20 : 250, a = r() < 0.12 ? 22 : 0; img.data[i] = v; img.data[i + 1] = v * 0.92; img.data[i + 2] = v * 0.8; img.data[i + 3] = a; } gg.putImageData(img, 0, 0); }
    const gate = document.createElement('canvas'); gate.width = W / 2; gate.height = H / 2;
    { const gg = gate.getContext('2d'); gg.scale(0.5, 0.5); const vg = gg.createRadialGradient(W / 2, H / 2, 520, W / 2, H / 2, 1180); vg.addColorStop(0, 'rgba(20,12,6,0)'); vg.addColorStop(0.75, 'rgba(20,12,6,0.12)'); vg.addColorStop(1, 'rgba(20,12,6,0.55)'); gg.fillStyle = vg; gg.fillRect(0, 0, W, H);
      gg.fillStyle = '#120D0A'; gg.beginPath(); gg.rect(0, 0, W, H); gg.roundRect(10, 8, W - 20, H - 16, 54); gg.fill('evenodd'); }
    const stage = () => document.getElementById('stage');
    (window.FRAME_HOOKS = window.FRAME_HOOKS || []).push((t) => {
      const fq = Math.floor(t * 24), r = PV.rng(fq * 7919 + 11);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = `rgba(255,248,226,${(0.01 + r() * 0.035).toFixed(3)})`; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = `rgba(40,24,10,${(r() * 0.035).toFixed(3)})`; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(grain, -(r() * 256) | 0, -(r() * 256) | 0, 1024, 1024);
      const r6 = PV.rng(Math.floor(t * 5) * 131 + 5);
      for (let k = 0; k < 2; k++) { if (r6() < 0.45) continue; const x = r6() * cv.width + (r() - 0.5) * 3; g.strokeStyle = r6() < 0.5 ? 'rgba(255,250,235,0.35)' : 'rgba(30,20,10,0.3)'; g.lineWidth = 0.6 + r6(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, cv.height); g.stroke(); }
      for (let k = 0; k < 6; k++) { g.fillStyle = r() < 0.6 ? 'rgba(30,20,10,0.5)' : 'rgba(255,250,235,0.6)'; g.beginPath(); g.arc(r() * cv.width, r() * cv.height, 0.5 + r() * 1.6, 0, 7); g.fill(); }
      g.drawImage(gate, 0, 0);
      const st = stage(); if (st) st.style.transform = `translate(${((r() - 0.5) * 2.4).toFixed(2)}px, ${((r() - 0.5) * 2.4).toFixed(2)}px)`;   // gate weave
    });
  })();
})();
