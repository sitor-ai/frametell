/* Shadow puppetry kit (皮影戏): an oil lamp behind a cotton screen inside a lacquered theatre frame, and translucent
 * dyed-leather pieces pressed against the cloth — jointed puppets on rods, carved creatures, carved scenery, plaques
 * with cut-out letters. Every piece is pre-cut once into a sprite (dye, pierced patterns, carved outline, hide texture)
 * and composited every frame; every component is a pure function of page time lt. Pieces arrive pressed onto the
 * cloth (large and blurred, snapping sharp) and leave lifted toward the lamp (their shadow grows huge and soft).
 * Any option marked "fn" may be a value, a function of lt, or a keyframe list [[t0, v0], [t1, v1], …].
 * The carving method (dye sprites cut with destination-out, a tileable hide texture multiplied in and its alpha
 * restored, crescent / lattice / coin / cloud-scroll / meander / strata cuts, flame tongues, rivets) and the lamp model
 * are adapted from lemo-opuscar's shadow-puppet style (MIT, © 2026 LemoLab), see NOTICE.md. */
(function () {
  const { col, clamp, lerp, ease, h, Builder } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const CLOTH = { x0: 56, y0: 112, x1: W - 56, y1: STAGE.subs + 8 };
  const DEG = Math.PI / 180;
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]);
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const [t, x] of v) if (lt >= t) r = x; return r; }
    return v ?? d;
  };
  const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, seed = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i + seed * 101.3), hash(i + 1 + seed * 101.3), u) * 2 - 1; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const EXTRA = { hide: '#E2BD80', hide2: '#C99A5A', skin: '#EFCF98', white: '#F4EAD2', brown: '#6B3A1C', gold: '#C98A26', jade: '#2F8A5C', crim: '#8E1813' };
  const dye = (n) => EXTRA[n] || col(n) || n;
  const INK = '#1A100A';

  // ───────────────────────── the carving toolkit ─────────────────────────
  const canvas = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(hh)); return [c, c.getContext('2d')]; };
  /** a smooth closed (or open) path through the midpoints of pts */
  function smooth(q, pts, closed = true) {
    const n = pts.length; if (n < 2) return;
    if (!closed) {
      q.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n - 1; i++) q.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      q.lineTo(pts[n - 1][0], pts[n - 1][1]); return;
    }
    const m = (i) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
    const s0 = m(0); q.moveTo(s0[0], s0[1]);
    for (let i = 1; i <= n; i++) { const p = pts[i % n], e = m(i); q.quadraticCurveTo(p[0], p[1], e[0], e[1]); }
    q.closePath();
  }
  const poly = (q, pts, closed = true) => { q.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) q.lineTo(pts[i][0], pts[i][1]); if (closed) q.closePath(); };
  const S = (pts) => (q) => smooth(q, pts);
  const Pl = (pts) => (q) => poly(q, pts);
  const Ci = (x, y, r) => (q) => { q.moveTo(x + r, y); q.arc(x, y, r, 0, Math.PI * 2); };
  const El = (x, y, rx, ry, a = 0) => (q) => { q.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); };

  // the hide: mottled density, fibres and specks, tileable; multiplied into every piece, its alpha restored after
  let HIDE = null;
  function hideTile() {
    if (HIDE) return HIDE;
    const N = 256, [c, g] = canvas(N, N), id = g.createImageData(N, N), d = id.data;
    const hh = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
    const v2 = (x, y, P) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const w = (a, b) => hh(((a % P) + P) % P, ((b % P) + P) % P);
      return (w(i, j) * (1 - u) + w(i + 1, j) * u) * (1 - v) + (w(i, j + 1) * (1 - u) + w(i + 1, j + 1) * u) * v; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const f = v2(x / 32, y / 32, 8) * 0.5 + v2(x / 16, y / 16, 16) * 0.3 + v2(x / 4, y / 4, 64) * 0.2;
      const sp = hh(x, y) > 0.986 ? 0.82 : 1, v = (0.8 + 0.24 * f) * sp, i = (y * N + x) * 4;
      d[i] = Math.min(255, v * 255); d[i + 1] = Math.min(255, v * 248); d[i + 2] = Math.min(255, v * 232); d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    g.globalAlpha = 0.12; g.strokeStyle = '#6a4a2a'; g.lineWidth = 0.7;
    for (let k = 0; k < 420; k++) { const x = hh(k, 1) * N, y = hh(k, 2) * N, a = hh(k, 3) * 6.28, l = 5 + hh(k, 4) * 14; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    return (HIDE = c);
  }
  function hideTexture(c, g, seed) {
    const [m, mg] = canvas(c.width, c.height); mg.drawImage(c, 0, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const pat = g.createPattern(hideTile(), 'repeat'); pat.setTransform(new DOMMatrix([1, 0, 0, 1, (seed * 137) % 256, (seed * 71) % 256]));
    g.globalCompositeOperation = 'multiply'; g.fillStyle = pat; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
    g.restore();
  }
  /** one leather piece: box [x0,y0,x1,y1] in units around its pivot, K pixels per unit; draw(g) cuts it */
  function piece(box, K, draw, seed = 1) {
    const [x0, y0, x1, y1] = box, w = x1 - x0, hh = y1 - y0;
    const [c, g] = canvas(w * K, hh * K);
    g.setTransform(K, 0, 0, K, -x0 * K, -y0 * K); g.lineJoin = 'round'; g.lineCap = 'round';
    draw(g);
    hideTexture(c, g, seed);
    return { c, x0, y0, w, h: hh };
  }
  const put = (g, p) => g.drawImage(p.c, p.x0, p.y0, p.w, p.h);
  const P2 = (g, path) => { g.beginPath(); if (path instanceof Path2D) return path; path(g); return null; };
  const fill = (g, color, path, rule = 'evenodd') => { const p = P2(g, path); g.fillStyle = dye(color); p ? g.fill(p, rule) : g.fill(rule); };
  const cut = (g, path, rule = 'evenodd') => { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; const p = P2(g, path); p ? g.fill(p, rule) : g.fill(rule); g.restore(); };
  const cutLine = (g, w, path) => { g.save(); g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); path(g); g.stroke(); g.restore(); };
  const ink = (g, w, path, color = INK) => { const p = P2(g, path); g.strokeStyle = dye(color); g.lineWidth = w; p ? g.stroke(p) : g.stroke(); };
  const within = (g, path, fn) => { g.save(); const p = P2(g, path); p ? g.clip(p, 'evenodd') : g.clip('evenodd'); fn(); g.restore(); };
  /** a region of the piece: dye, carved pattern inside, carved outline */
  const region = (g, color, path, pattern, lw = 1.6) => { fill(g, color, path); if (pattern) within(g, path, pattern); ink(g, lw, path); };

  // patterns (used inside a clip)
  function scaleCuts(g, x0, y0, x1, y1, r = 6) {   // open fish-scale: a thick crescent hole per scale
    cut(g, (q) => { let row = 0;
      for (let y = y0; y < y1 + r; y += r * 0.95, row++) for (let x = x0 - r + (row % 2) * r; x < x1 + r; x += r * 2) {
        q.moveTo(x + Math.cos(0.08 * Math.PI) * r * 0.86, y + Math.sin(0.08 * Math.PI) * r * 0.86);
        q.arc(x, y, r * 0.86, 0.08 * Math.PI, 0.92 * Math.PI); q.arc(x, y - r * 0.2, r * 0.5, 0.88 * Math.PI, 0.12 * Math.PI, true); q.closePath();
      } }, 'nonzero');
  }
  function lattice(g, x0, y0, x1, y1, s = 10, w = 2) {   // diamond brocade
    cut(g, (q) => { let row = 0;
      for (let y = y0; y < y1 + s; y += s / 2, row++) for (let x = x0 + (row % 2) * s / 2; x < x1 + s; x += s) { const k = s / 2 - w; q.moveTo(x, y - k * 0.9); q.lineTo(x + k, y); q.lineTo(x, y + k * 0.9); q.lineTo(x - k, y); q.closePath(); } }, 'nonzero');
  }
  function grid(g, x0, y0, x1, y1, s = 12, w = 2.4) {   // window lattice: square holes
    cut(g, (q) => { for (let y = y0 + w; y < y1 - w; y += s) for (let x = x0 + w; x < x1 - w; x += s) q.rect(x, y, Math.min(s - w, x1 - w - x), Math.min(s - w, y1 - w - y)); }, 'nonzero');
  }
  const coin = (g, x, y, r) => cut(g, (q) => { q.arc(x, y, r, 0, Math.PI * 2); q.rect(x - r * 0.38, y - r * 0.38, r * 0.76, r * 0.76); }, 'evenodd');
  function scroll(g, x, y, r, rot = 0, w = 1.3, flip = 1) {   // cloud scroll: a spiral slit and a teardrop hole
    cutLine(g, w, (q) => { for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2.2, rr = r * (1 - i / 36 * 0.78); const px = x + Math.cos(rot + a * flip) * rr, py = y + Math.sin(rot + a * flip) * rr; i ? q.lineTo(px, py) : q.moveTo(px, py); } });
    cut(g, Ci(x + Math.cos(rot + Math.PI * 2.2 * flip) * r * 0.2, y + Math.sin(rot + Math.PI * 2.2 * flip) * r * 0.2, r * 0.17));
  }
  const beads = (g, pts, r) => cut(g, (q) => { for (const [x, y] of pts) { q.moveTo(x + r, y); q.arc(x, y, r, 0, Math.PI * 2); } });
  function beadLine(g, x0, y0, x1, y1, r, gap) { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(L / gap)), pts = []; for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); beads(g, pts, r); }
  function plum(g, x, y, r) { const pts = []; for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } beads(g, pts, r * 0.6); cut(g, Ci(x, y, r * 0.3)); }
  function waveCuts(g, x0, y0, x1, y1, r = 8, w = 1.4) { for (let y = y0, row = 0; y < y1; y += r * 0.9, row++) for (let x = x0 + (row % 2) * r; x < x1 + r; x += r * 2) cutLine(g, w, (q) => { q.moveTo(x + Math.cos(1.1 * Math.PI) * r, y + Math.sin(1.1 * Math.PI) * r); q.arc(x, y, r, 1.1 * Math.PI, 1.9 * Math.PI); }); }
  function meander(g, x0, y, x1, s = 6, w = 1.2) {
    cutLine(g, w, (q) => { q.moveTo(x0, y); for (let x = x0; x < x1 - s * 2; x += s * 2) { q.lineTo(x, y - s); q.lineTo(x + s * 1.4, y - s); q.lineTo(x + s * 1.4, y - s * 0.3); q.lineTo(x + s * 0.7, y - s * 0.3); q.lineTo(x + s * 0.7, y); q.lineTo(x + s * 2, y); } });
  }
  function strata(g, x0, x1, fn, n, gap, w) { for (let k = 1; k <= n; k++) cutLine(g, w, (q) => { for (let x = x0; x <= x1; x += 6) { const y = fn(x) + k * gap; x === x0 ? q.moveTo(x, y) : q.lineTo(x, y); } }); }
  /** a traditional flame tongue: fat base, swelling belly, hooked tip. root (0,0), grows to -y */
  function tongue(q, hgt, w, d = 1) {
    q.moveTo(-w / 2, 0);
    q.bezierCurveTo(-w * 0.75, -hgt * 0.3, -w * 0.25 * d - w * 0.1, -hgt * 0.55, w * 0.15 * d, -hgt * 0.82);
    q.bezierCurveTo(w * 0.3 * d, -hgt * 0.95, w * 0.55 * d, -hgt * 1.02, w * 0.62 * d, -hgt * 0.9);
    q.bezierCurveTo(w * 0.52 * d, -hgt * 0.93, w * 0.38 * d, -hgt * 0.88, w * 0.36 * d, -hgt * 0.76);
    q.bezierCurveTo(w * 0.55, -hgt * 0.5, w * 0.62, -hgt * 0.22, w / 2, 0);
    q.closePath();
  }
  function taper(g, pts, w) {   // a slit wide in the middle, pointed at both ends
    const L = [], R = [], n = pts.length;
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, k = (Math.sin(Math.PI * i / (n - 1)) * 0.9 + 0.1) * w / 2; L.push([pts[i][0] - dy / l * k, pts[i][1] + dx / l * k]); R.push([pts[i][0] + dy / l * k, pts[i][1] - dx / l * k]); }
    cut(g, (q) => { q.moveTo(...L[0]); for (const p of L) q.lineTo(...p); for (let i = n - 1; i >= 0; i--) q.lineTo(...R[i]); q.closePath(); }, 'nonzero');
  }
  function rivet(g, x, y, r = 3.6) {
    g.beginPath(); g.arc(x, y, r * 0.74, 0, Math.PI * 2); g.strokeStyle = '#2e1c10'; g.lineWidth = r * 0.5; g.stroke();
    g.beginPath(); g.arc(x, y, r * 0.44, 0, Math.PI * 2); g.fillStyle = '#c49a68'; g.fill();
  }
  /** a path made of flame tongues set along a list of [x, y, angle(deg), height, width, curl] */
  const tongues = (list) => { const all = new Path2D(); for (const [x, y, a, hh, w, d] of list) { const p = new Path2D(); tongue(p, hh, w, d); all.addPath(p, new DOMMatrix().translate(x, y).rotate(a)); } return all; };

  // ───────────────────────── the lamp, the frame, the act board ─────────────────────────
  // Every frame: the lamp's light (one warm lobe, flickering) multiplied over the cloth and every piece on it, then the
  // lacquered frame on top. Pages set their lamp with P.lamp; titles are carved into the lintel (P.title).
  const REG = { layout: null, lamps: new Map(), titles: [] };
  const fresh = () => { if (REG.layout !== ENGINE.layout) { REG.layout = ENGINE.layout; REG.lamps.clear(); for (const t of REG.titles) t.el.remove(); REG.titles.length = 0; } };
  PV.SP = { REG, CLOTH };
  (function theatre() {
    const frame = document.getElementById('frame');
    if (!frame) return;
    const R = 0.5;
    const lampCv = document.createElement('canvas'); lampCv.width = W * R; lampCv.height = H * R; lampCv.className = 'sp-lamp';
    Object.assign(lampCv.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 33, pointerEvents: 'none', mixBlendMode: 'multiply' });
    frame.appendChild(lampCv);
    const lg = lampCv.getContext('2d');
    // the frame: drawn once
    const fr = document.createElement('canvas'); fr.width = W; fr.height = H; fr.className = 'sp-frame';
    Object.assign(fr.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 34, pointerEvents: 'none' });
    frame.appendChild(fr);
    const g = fr.getContext('2d'), { x0, y0, x1, y1 } = CLOTH;
    const lac = (x, y, w, hh, a, b) => { const gr = g.createLinearGradient(x, y, x, y + hh); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(x, y, w, hh); };
    g.save(); g.beginPath(); g.rect(0, 0, W, H); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip('evenodd');
    lac(0, 0, W, H, '#2A1209', '#160A04');
    // lintel: lacquer, a vermilion rail with gold lines, gold cloud scrolls at the ends
    lac(0, 0, W, y0 - 16, '#3A170A', '#22100A');
    lac(0, y0 - 16, W, 16, '#8A2414', '#5E170C');
    g.strokeStyle = 'rgba(214,160,80,0.85)'; g.lineWidth = 2; [y0 - 17, y0 - 2].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
    g.strokeStyle = 'rgba(214,160,80,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 10); g.lineTo(W, 10); g.stroke();
    const curl = (x, y, r, d) => { g.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2.4, rr = r * (1 - i / 40 * 0.8); const px = x + Math.cos(a * d) * rr, py = y + Math.sin(a * d) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); };
    g.strokeStyle = 'rgba(214,160,80,0.7)'; g.lineWidth = 3;
    [[150, 1], [W - 150, -1]].forEach(([x, d]) => { curl(x, 52, 22, d); curl(x + 52 * d, 56, 14, -d); curl(x - 40 * d, 58, 11, d); });
    // pillars: lacquer with a vermilion inner strip; warm spill on the inner edge
    [[0, 1], [x1, -1]].forEach(([x, d]) => {
      lac(x, y0, x0, y1 - y0, '#2C130A', '#1C0C06');
      const ix = d > 0 ? x0 - 12 : x1; g.fillStyle = '#6E1C0F'; g.fillRect(ix, y0, 12, y1 - y0);
      g.strokeStyle = 'rgba(214,160,80,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(d > 0 ? x0 - 13 : x1 + 13, y0); g.lineTo(d > 0 ? x0 - 13 : x1 + 13, y1); g.stroke();
      const sp = g.createLinearGradient(d > 0 ? x0 : x1, 0, d > 0 ? x0 - 40 : x1 + 40, 0); sp.addColorStop(0, 'rgba(255,170,80,0.28)'); sp.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = sp; g.fillRect(d > 0 ? x0 - 40 : x1, y0, 40, y1 - y0);
    });
    // the ledge below the screen: a vermilion rail, dark boards, the heads of a small audience
    lac(0, y1, W, 16, '#8A2414', '#5E170C');
    g.strokeStyle = 'rgba(214,160,80,0.85)'; g.lineWidth = 2; [y1 + 1, y1 + 16].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
    lac(0, y1 + 17, W, H - y1 - 17, '#24100A', '#100703');
    const sp2 = g.createLinearGradient(0, y1 + 17, 0, y1 + 60); sp2.addColorStop(0, 'rgba(255,170,80,0.16)'); sp2.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = sp2; g.fillRect(0, y1 + 17, W, 43);
    g.filter = 'blur(14px)'; g.fillStyle = 'rgba(8,4,2,0.85)';
    [[150, 1.0], [430, 0.85], [760, 1.1], [1180, 0.9], [1500, 1.05], [1780, 0.8]].forEach(([x, s], i) => { const hy = H - 70 + (i % 2) * 14; g.beginPath(); g.ellipse(x * W / 1920, hy, 62 * s, 76 * s, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(x * W / 1920, H + 40, 150 * s, 70, 0, 0, Math.PI * 2); g.fill(); });
    g.filter = 'none';
    g.restore();
    // the cloth's own edge: a soft brown shadow where it meets the frame
    const edge = 26;
    [[x0, y0, x1 - x0, edge, 0, 1], [x0, y1 - edge, x1 - x0, edge, 0, -1], [x0, y0, edge, y1 - y0, 1, 0], [x1 - edge, y0, edge, y1 - y0, -1, 0]].forEach(([x, y, w, hh, dx, dy]) => {
      const gr = dx ? g.createLinearGradient(dx > 0 ? x : x + w, 0, dx > 0 ? x + w : x, 0) : g.createLinearGradient(0, dy > 0 ? y : y + hh, 0, dy > 0 ? y + hh : y);
      gr.addColorStop(0, 'rgba(70,36,12,0.45)'); gr.addColorStop(1, 'rgba(70,36,12,0)'); g.fillStyle = gr; g.fillRect(x, y, w, hh);
    });
    const mix = (a, b, k) => `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`;
    const DARK = [24, 13, 7], HOT = [255, 251, 240], MID = [252, 230, 186], EDGE = [204, 140, 76], FAR = [128, 74, 34];
    (window.FRAME_HOOKS = window.FRAME_HOOKS || []).push((t) => {
      if (!window.ENGINE || !ENGINE.layout) return;
      fresh();
      let wsum = 0, lev = 0, lx = 0, ly = 0;
      for (const p of ENGINE.pages) {
        if (p.vis <= 0.001 || p.root.style.display === 'none') continue;
        const L = REG.lamps.get(p.pg.id), lt = t - p.pg.start;
        const l = L ? L.level(lt) : 1, px = L ? val(L.x, lt, W / 2) : W / 2, py = L ? val(L.y, lt, H * 0.4) : H * 0.4;
        wsum += p.vis; lev += l * p.vis; lx += px * p.vis; ly += py * p.vis;
      }
      if (wsum > 0) { lev /= wsum; lx /= wsum; ly /= wsum; } else { lev = 1; lx = W / 2; ly = H * 0.4; }
      const fl = 1 + 0.03 * vn(t * 7, 3) + 0.012 * Math.sin(t * Math.PI * 2 * 11.3);   // the oil lamp breathes
      const k = clamp(lev * fl, 0, 1);
      lg.setTransform(R, 0, 0, R, 0, 0);
      const gr = lg.createRadialGradient(lx, ly, 0, lx, ly, Math.hypot(W, H) * 0.62);
      gr.addColorStop(0, mix(DARK, HOT, k)); gr.addColorStop(0.3, mix(DARK, MID, k)); gr.addColorStop(0.72, mix(DARK, EDGE, k)); gr.addColorStop(1, mix(DARK, FAR, k));
      lg.fillStyle = gr; lg.fillRect(0, 0, W, H);
      // the act board follows its page
      for (const tt of REG.titles) {
        const p = ENGINE.pages.find((x) => x.pg.id === tt.id);
        const vis = p && p.root.style.display !== 'none' ? p.vis : 0;
        const op = vis * tt.k(t - (p ? p.pg.start : 0));
        tt.el.style.opacity = op.toFixed(3); tt.el.style.display = op > 0.003 ? '' : 'none';
      }
    });
  })();

  /** lamp(o): the oil lamp behind the screen for this page. The signature opening: the screen starts dark and the lamp
   *  comes up (from 0 to 1 over dur), so the first puppet steps into fresh light. o: { at (0), dur (1.4), from (0 —
   *  give 1 for a page that starts lit), to (1), keys (a keyframe list [[t, level], …] instead of from/to: dim the lamp
   *  to 0.35 for night, sorrow or a secret; 0 is a dark screen), x, y (where the light comes from, default 960, 430; fn) } */
  B.lamp = function (o = {}) {
    fresh();
    const at = o.at ?? 0, dur = o.dur ?? 1.4, from = o.from ?? 0, to = o.to ?? 1;
    let level;
    if (isKeys(o.keys)) {
      const K = o.keys;
      level = (lt) => { let v = K[0][1]; for (let i = 1; i < K.length; i++) { const [t, x] = K[i]; if (lt < t) break; v = lerp(v, x, ss(t, t + 0.8, lt)); } return v; };
    } else level = (lt) => { const k = clamp((lt - at) / dur); return lerp(from, to, ease.inOut(k)) + (to > from ? Math.sin(Math.PI * k) * 0.12 * (1 - k) : 0); };
    REG.lamps.set(this.page.id, { level, x: o.x ?? W / 2, y: o.y ?? H / 2 - 110 });
  };
  const lampAt = (page, lt) => { const L = REG.lamps.get(page.id); return { x: L ? val(L.x, lt, W / 2) : W / 2, y: L ? val(L.y, lt, H / 2 - 110) : H / 2 - 110 }; };

  // ───────────────────────── mounting a piece on the cloth ─────────────────────────
  // A canvas (or a wrapper) placed on the stage. Life: pressed on at `at` (large, blurred → sharp), optionally lifted
  // toward the lamp (o.lift fn 0..1: the shadow grows about the lamp point, softens and pales), lifted off at `out`.
  const PRESS = 0.55, EXIT = 0.9;
  function lifeAt(o, lt) {
    const at = o.at ?? 0;
    if (lt < at) return null;
    let l = 0, op = 1;
    if (o.enter !== 'cut') l = Math.max(l, 0.85 * (1 - ease.out(clamp((lt - at) / PRESS))));
    if (o.enter !== 'cut') op *= ss(at, at + 0.2, lt);
    l = Math.max(l, clamp(val(o.lift, lt, 0)));
    const out = val(o.out, lt, null);
    if (out != null && lt >= out) { const k = clamp((lt - out) / EXIT); l = Math.max(l, ease.inOut(k)); op *= 1 - ss(0.35, 1, k); if (k >= 1) return null; }
    return { l, op };
  }
  function applyLife(el, life, lamp, left, top) {
    const l = life.l, s = 1 + 2.3 * l, b = l * 20;
    el.style.transformOrigin = `${(lamp.x - left).toFixed(1)}px ${(lamp.y - top).toFixed(1)}px`;
    el.style.transform = l > 0.002 ? `scale(${s.toFixed(4)})` : '';
    el.style.filter = l > 0.002 ? `blur(${b.toFixed(2)}px) saturate(${(1 - 0.7 * l).toFixed(3)}) brightness(${(1 - 0.5 * l).toFixed(3)})` : '';
    el.style.opacity = (life.op * (1 - 0.3 * l)).toFixed(3);
  }
  /** mount(self, w, h, place(lt) → {x, y} (top-left in stage px) | null, draw(g, lt), o, R, key(lt)) */
  function mount(self, w, hh, place, draw, o, R = 1.25, key) {
    const c = h('canvas', 'sp-cv', null, self.html);
    c.width = Math.ceil(w * R); c.height = Math.ceil(hh * R);
    Object.assign(c.style, { position: 'absolute', width: w + 'px', height: hh + 'px', left: '0px', top: '0px', mixBlendMode: 'multiply', pointerEvents: 'none' });
    const g = c.getContext('2d');
    let last = null;
    const page = self.page;
    self.tick((lt) => {
      const life = lifeAt(o, lt), p = life && place(lt);
      if (!life || !p) { c.style.display = 'none'; return; }
      c.style.display = '';
      c.style.left = p.x.toFixed(1) + 'px'; c.style.top = p.y.toFixed(1) + 'px';
      applyLife(c, life, lampAt(page, lt), p.x, p.y);
      const k = key ? key(lt) : lt;
      if (k === last) return;
      last = k;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      g.setTransform(R, 0, 0, R, 0, 0); g.lineJoin = 'round'; g.lineCap = 'round';
      draw(g, lt);
    });
    return c;
  }
  /** the handle every component returns: hide(t) lifts the piece off the cloth at t */
  const handle = (el, o) => ({ el, hide(t) { o.out = t; return this; }, lift(fn) { o.lift = fn; return this; } });
  const ghost = (self, str, cls = '') => { const e = h('span', 'sp-cut ' + cls, esc(str), self.html); Object.assign(e.style, { left: '-4000px', top: '0px', opacity: '0' }); return e; };
  /** a rod: a thin dark line from (x, y) toward the operator below the screen, fading as it leaves the cloth */
  function rod(g, x, y, dx, len, w = 2.4) {
    const gr = g.createLinearGradient(x, y, x + dx * len, y + len); gr.addColorStop(0, 'rgba(26,16,10,0.85)'); gr.addColorStop(1, 'rgba(26,16,10,0.25)');
    g.strokeStyle = gr; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * len, y + len); g.stroke();
  }

  // ───────────────────────── the jointed puppet ─────────────────────────
  // Units: 1 unit = 1 px at size 470. Facing right; the origin is the waist; the soles stand on y = FOOT.
  const FOOT = 212, UA = 56, FA = 50, HK = 1.25;
  const NECK = [6, -124], SHF = [14, -112], SHB = [-2, -114], HIPF = [9, 46], HIPB = [-8, 44];
  const ROLES = {
    general: { body: 'armour', hat: 'helmet', face: 'open', color: 'red', trim: 'green' },
    emperor: { body: 'robe', hat: 'crown', face: 'open', color: 'yellow', trim: 'red', beard: 'ink' },
    official: { body: 'robe', hat: 'gauze', face: 'open', color: 'red', trim: 'green', beard: 'ink' },
    scholar: { body: 'robe', hat: 'scarf', face: 'open', color: 'blue', trim: 'green' },
    lady: { body: 'gown', hat: 'phoenix', face: 'open', color: 'red', trim: 'green' },
    monk: { body: 'robe', hat: 'bald', face: 'open', color: 'yellow', trim: 'red' },
    peasant: { body: 'short', hat: 'bun', face: 'open', color: 'blue', trim: 'yellow' },
    elder: { body: 'robe', hat: 'bun', face: 'open', color: 'green', trim: 'yellow', beard: 'white' },
    demon: { body: 'armour', hat: 'horns', face: 'black', color: 'purple', trim: 'green' },
    soldier: { body: 'short', hat: 'helmet', face: 'open', color: 'red', trim: 'yellow', plumes: false },
  };
  const POSES = {
    stand: { f: [16, 24], b: [-10, 16] },
    walk: { f: [14, 20], b: [-6, 14], walk: 1, tilt: 2 },
    run: { f: [62, 70], b: [-46, 40], walk: 1.9, tilt: 10, head: -4 },
    point: { f: [92, 4], b: [-16, 22], tilt: -3, head: -4 },
    raise: { f: [166, 8], b: [150, 14], tilt: -6, head: -14 },
    bow: { f: [46, 80], b: [40, 86], tilt: 16, head: 12 },
    kneel: { f: [46, 70], b: [36, 76], tilt: 8, head: 8, crouch: 1 },
    fight: { f: [150, -24], b: [-58, 36], tilt: -6, head: -8, legs: 1 },
    think: { f: [-4, 168], b: [8, 50], tilt: 3, head: 9 },
    cry: { f: [48, 128], b: [4, 12], tilt: 9, head: 18 },
    present: { f: [70, 22], b: [62, 26], tilt: 6, head: 4 },
    halt: { f: [104, -30], b: [-14, 22], tilt: -4, head: -6, legs: 0.5 },
    angry: { f: [124, 34], b: [-52, 28], tilt: -8, head: -12, shake: 2.6, legs: 0.7 },
    proud: { f: [24, 100], b: [-30, 60], tilt: -7, head: -10 },
    sad: { f: [6, 10], b: [-4, 8], tilt: 10, head: 22 },
    fall: { f: [120, 20], b: [100, 30], tilt: -70, head: -20, crouch: 0.6 },
  };
  const NUM = ['tilt', 'head', 'crouch', 'shake', 'legs', 'walk'];

  // ── the pieces of one puppet, cut once ──
  function sleevePieces(sp, K, seed) {
    const c1 = sp.color, c2 = sp.trim, b = sp.body, P = {};
    if (b === 'armour') {
      P.ua = piece([-22, -22, 22, UA + 12], K, (g) => {
        region(g, c1, S([[-11, 0], [11, 0], [11, UA], [-10, UA]]), () => scaleCuts(g, -14, 10, 14, UA, 5));
        region(g, c1, Ci(0, UA + 4, 9));
        region(g, c2, S([[-20, -10], [-8, -20], [12, -19], [21, -6], [16, 12], [0, 17], [-18, 8]]), () => { scroll(g, -6, -4, 6, 0.5, 1.2, 1); scroll(g, 9, -2, 5, 2, 1.1, -1); });
      }, seed);
      P.fa = piece([-14, -6, 14, FA + 6], K, (g) => region(g, c2, S([[-10, -4], [10, -4], [9, FA + 2], [-9, FA + 2]]), () => lattice(g, -12, 4, 12, FA, 8, 1.5)), seed + 1);
      P.wrist = FA;
    } else if (b === 'short') {
      P.ua = piece([-14, -12, 14, UA + 12], K, (g) => { region(g, c1, S([[-10, -4], [10, -4], [10, UA], [-9, UA]]), () => coin(g, 0, UA * 0.5, 4)); region(g, c1, Ci(0, UA + 3, 8)); }, seed);
      P.fa = piece([-12, -6, 12, FA + 6], K, (g) => { region(g, 'skin', S([[-7, -2], [7, -2], [6, FA], [-6, FA]])); region(g, c2, Pl([[-9, -4], [9, -4], [9, 10], [-9, 10]]), () => beadLine(g, -6, 3, 6, 3, 1.4, 4)); }, seed + 1);
      P.wrist = FA;
    } else {   // robe / gown: a wide bell sleeve, the hand comes out of the cuff
      const wide = b === 'gown' ? 18 : 26;
      P.ua = piece([-16, -14, 16, UA + 14], K, (g) => { region(g, c1, S([[-12, -6], [12, -6], [12, UA], [-11, UA]]), () => taper(g, [[2, 6], [3, 26], [1, 46]], 3)); region(g, c1, Ci(0, UA + 2, 10)); }, seed);
      P.fa = piece([-wide - 6, -8, wide + 6, FA + 18], K, (g) => {
        const sl = S([[-11, -6], [11, -6], [wide, FA - 6], [wide + 2, FA + 14], [-wide + 2, FA + 14], [-wide + 4, FA - 6]]);
        region(g, c1, sl, () => { scroll(g, 2, FA * 0.55, 8, 0.3, 1.4, 1); taper(g, [[-6, 4], [-12, 20], [-16, FA - 6]], 3); });
        region(g, c2, Pl([[-wide + 2, FA + 2], [wide + 1, FA + 2], [wide + 2, FA + 14], [-wide + 2, FA + 14]]), () => meander(g, -wide + 4, FA + 11, wide, 3.4, 1.1));
      }, seed + 1);
      P.wrist = FA + 12;
      if (b === 'gown') P.water = piece([-22, -4, 26, 112], K, (g) => region(g, 'white', S([[-15, 0], [15, 0], [21, 50], [16, 92], [6, 108], [-8, 100], [-18, 56]]), () => waveCuts(g, -18, 20, 22, 100, 7, 1.1), 1.4), seed + 2);
    }
    P.hand = piece([-12, -4, 12, 24], K, (g) => { const hd = S([[-6, 0], [6, 0], [9, 8], [8, 16], [2, 20], [-5, 17], [-8, 8]]); region(g, 'skin', hd, null, 1.4); ink(g, 0.9, (q) => { q.moveTo(-2, 9); q.lineTo(5, 9); q.moveTo(-2, 13); q.lineTo(5, 13); }); }, seed + 3);
    return P;
  }
  function torsoPiece(sp, K, seed) {
    const c1 = sp.color, c2 = sp.trim, b = sp.body;
    if (b === 'armour') return piece([-42, -140, 50, 12], K, (g) => {
      region(g, c1, S([[-26, 2], [-30, -40], [-31, -84], [-25, -108], [-12, -122], [4, -128], [18, -124], [30, -110], [38, -88], [40, -62], [34, -30], [28, 2]]), () => { scaleCuts(g, -36, -96, 46, -18, 6.2); }, 2.2);
      ink(g, 2.6, (q) => { q.moveTo(-30, -54); q.quadraticCurveTo(6, -46, 40, -56); });
      region(g, 'yellow', Ci(20, -74, 12), () => { cut(g, (q) => { q.arc(20, -74, 9, 0, 7); q.arc(20, -74, 6, 0, 7, true); }, 'nonzero'); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; cut(g, El(20 + Math.cos(a) * 3.5, -74 + Math.sin(a) * 3.5, 1.6, 0.8, a)); } }, 1.4);
      region(g, c2, S([[-26, -106], [-30, -96], [-20, -90], [-12, -97], [-2, -88], [8, -97], [18, -90], [28, -99], [36, -96], [32, -110], [20, -124], [2, -130], [-14, -126]]), () => { [[-19, -99, 1], [-1, -98, -1], [17, -99, 1], [28, -104, -1]].forEach(([x, y, f]) => scroll(g, x, y, 5, 1.2, 1.3, f)); }, 1.5);
      region(g, 'yellow', Pl([[-28, -14], [31, -14], [29, 4], [-26, 4]]), () => { for (let x = -22; x < 24; x += 9) coin(g, x, -5, 3.5); }, 1.5);
    }, seed);
    if (b === 'gown') return piece([-30, -136, 34, 10], K, (g) => {
      region(g, c1, S([[-18, 2], [-21, -50], [-22, -94], [-16, -114], [-4, -124], [8, -127], [18, -118], [24, -98], [22, -60], [18, -20], [19, 2]]), () => { [[-8, -70], [8, -50], [-6, -34], [10, -86]].forEach(([x, y]) => plum(g, x, y, 4)); }, 2);
      region(g, c2, S([[-18, -108], [-20, -98], [-10, -94], [-2, -100], [8, -94], [18, -100], [20, -110], [8, -124], [-6, -124]]), () => { scroll(g, -9, -104, 4.5, 1, 1.2, 1); scroll(g, 9, -104, 4.5, 2, 1.2, -1); }, 1.4);
      region(g, 'yellow', Pl([[-20, -14], [21, -14], [20, 2], [-19, 2]]), () => beadLine(g, -15, -6, 16, -6, 1.6, 5), 1.4);
    }, seed);
    if (b === 'short') return piece([-36, -136, 42, 64], K, (g) => {
      region(g, c1, S([[-26, 58], [-28, 0], [-29, -84], [-23, -108], [-10, -122], [6, -127], [20, -122], [30, -106], [33, -78], [31, -20], [30, 58]]), () => { lattice(g, -30, -96, 34, -40, 10, 2); }, 2);
      region(g, c2, Pl([[-27, 40], [31, 40], [31, 58], [-26, 58]]), () => { for (let x = -20; x < 28; x += 10) coin(g, x, 49, 3.6); }, 1.4);
      region(g, c2, Pl([[-4, -126], [8, -127], [30, -40], [22, -36]]), () => beadLine(g, 2, -120, 25, -42, 1.3, 6), 1.3);
      ink(g, 3.2, (q) => { q.moveTo(-28, 2); q.quadraticCurveTo(2, 8, 32, 0); }, 'brown');
    }, seed);
    return piece([-40, -140, 46, 12], K, (g) => {   // robe
      region(g, c1, S([[-26, 2], [-30, -40], [-31, -86], [-24, -110], [-10, -124], [6, -129], [20, -124], [31, -108], [35, -80], [32, -40], [28, 2]]), () => {
        cut(g, (q) => { q.arc(2, -66, 17, 0, 7); q.arc(2, -66, 13.5, 0, 7, true); }, 'nonzero'); scroll(g, 2, -66, 9, 0.4, 1.6, 1); scroll(g, 2, -66, 4, 3.4, 1.2, -1);
        taper(g, [[-20, -100], [-22, -64], [-18, -24]], 3.2);
      }, 2.2);
      region(g, sp.trim, Pl([[-8, -128], [6, -129], [32, -46], [22, -40]]), () => beadLine(g, 0, -122, 26, -46, 1.4, 6), 1.4);
      const belt = sp.hat === 'gauze' || sp.hat === 'crown' ? 'yellow' : sp.trim;
      region(g, belt, Pl([[-28, -12], [31, -12], [30, 4], [-27, 4]]), () => { for (let x = -22; x < 26; x += 10) cut(g, (q) => q.rect(x - 3, -8, 6, 8)); }, 1.5);
    }, seed);
  }
  function lowerPiece(sp, K, seed) {
    const c1 = sp.color, c2 = sp.trim, b = sp.body;
    if (b === 'armour') return piece([-50, -8, 56, 124], K, (g) => {
      const back = S([[-32, -4], [0, -3], [-4, 70], [-14, 118], [-44, 114], [-40, 56]]), front = S([[2, -3], [30, -4], [42, 58], [48, 112], [22, 118], [8, 74]]);
      for (const f of [back, front]) { fill(g, c1, f); within(g, f, () => { scaleCuts(g, -50, 8, 52, 110, 6); ink(g, 7, f, c2); }); ink(g, 1.8, f); }
      region(g, c2, S([[-7, -3], [7, -3], [9, 64], [0, 92], [-8, 64]]), () => { scroll(g, 0, 18, 5.5, 0, 1.3); coin(g, 0, 40, 5); plum(g, 0, 62, 3); }, 1.5);
    }, seed);
    if (b === 'gown') return piece([-44, -8, 50, 210], K, (g) => {
      const sk = S([[-20, -4], [20, -4], [30, 80], [40, 170], [46, 206], [-38, 206], [-30, 170], [-26, 80]]);
      region(g, c1, sk, () => { for (let k = -3; k <= 3; k++) cutLine(g, 1.7, (q) => { q.moveTo(k * 5, 14); q.lineTo(k * 9.5, 176); }); fill(g, c2, Pl([[-50, 178], [60, 178], [60, 212], [-50, 212]])); waveCuts(g, -44, 186, 50, 206, 6, 1.2); }, 1.8);
    }, seed);
    if (b === 'short') return null;
    return piece([-50, -8, 54, 200], K, (g) => {   // robe
      const robe = S([[-28, -4], [28, -4], [34, 60], [42, 150], [48, 194], [-40, 194], [-36, 150], [-34, 60]]);
      region(g, c1, robe, () => {
        fill(g, c2, Pl([[-50, 170], [60, 170], [60, 200], [-50, 200]])); waveCuts(g, -44, 178, 50, 196, 6, 1.3);
        taper(g, [[-16, 20], [-22, 90], [-28, 160]], 3.4); taper(g, [[22, 30], [28, 100], [34, 160]], 3);
      }, 2.2);
      region(g, c2, S([[4, 6], [20, 6], [22, 140], [12, 158], [2, 140]]), () => { scroll(g, 12, 40, 6, 0.6, 1.3, 1); coin(g, 12, 76, 5); scroll(g, 12, 110, 5, 2.2, 1.2, -1); }, 1.5);
    }, seed);
  }
  function legPiece(sp, K, seed) {
    const c2 = sp.trim;
    if (sp.body === 'armour') return piece([-22, -10, 50, 172], K, (g) => {
      region(g, c2, S([[-13, -6], [13, -6], [15, 50], [14, 84], [-12, 86], [-14, 50]]), () => lattice(g, -16, 8, 18, 86, 9, 1.7), 1.7);
      region(g, 'ink', S([[-13, 76], [13, 74], [14, 108], [15, 134], [26, 142], [38, 146], [43, 140], [45, 148], [40, 158], [-15, 158], [-15, 116]]), () => { scroll(g, 0, 96, 7, 0.3, 1.6); scroll(g, -2, 124, 5.5, 2.4, 1.4, -1); }, 1.2);
      region(g, 'white', Pl([[-17, 157], [44, 155], [43, 162], [41, 170], [-15, 171], [-17, 164]]), () => { for (let x = -11; x < 40; x += 6.5) cut(g, El(x, 163.5, 2, 3)); }, 1.6);
    }, seed);
    return piece([-20, -10, 40, 172], K, (g) => {   // short: trousers and cloth shoes
      region(g, c2, S([[-13, -6], [13, -6], [14, 60], [13, 140], [-11, 142], [-13, 60]]), () => { for (let y = 20; y < 140; y += 22) coin(g, 0, y, 4.2); }, 1.7);
      region(g, 'ink', S([[-12, 138], [12, 136], [26, 150], [30, 160], [-13, 162]]), () => scroll(g, 2, 150, 4, 0.3, 1.2), 1.2);
      region(g, 'white', Pl([[-14, 160], [32, 158], [31, 170], [-13, 171]]), null, 1.4);
    }, seed);
  }
  const footPiece = (sp, K, seed) => piece([-16, -16, 34, 12], K, (g) => {
    if (sp.body === 'gown') { region(g, sp.color, S([[-6, -4], [8, -8], [22, -2], [30, 2], [-6, 4]]), null, 1.3); return; }
    region(g, 'ink', S([[-12, -14], [10, -14], [20, -4], [30, -6], [28, 2], [-12, 2]]), () => scroll(g, 2, -6, 4, 0.2, 1.1), 1.1);
    region(g, 'white', Pl([[-13, 1], [30, 0], [29, 8], [-12, 9]]), null, 1.3);
  }, seed);

  // the head, in head units (scaled by HK): origin at the base of the neck, facing right
  const FACE = [[8, -68], [13, -62], [15, -52], [14, -46], [17, -40], [21, -33], [20, -30], [15, -28], [16, -24], [13, -21], [15, -19], [16, -14], [12, -9], [6, -3]];
  const SIDE = [[6, -3], [0, -8], [-3, -22], [-4, -38], [-2, -56], [2, -66], [8, -68]];
  function headPiece(sp, K, seed) {
    const hat = sp.hat, face = sp.face, fem = sp.body === 'gown';
    return piece([-60 * HK, -150 * HK, 66 * HK, 8 * HK], K, (g) => {
      g.scale(HK, HK);
      const faceP = (q) => smooth(q, FACE.concat(SIDE.slice(1, -1)), true);
      // hair behind and above the face
      const hair = S([[8, -68], [2, -77], [-12, -81], [-25, -71], [-29, -52], [-27, -32], [-19, -14], [-8, -6], [-2, -12], [-4, -26], [-5, -40], [-3, -56]]);
      if (hat === 'bald') {
        region(g, 'skin', S([[8, -68], [0, -78], [-14, -80], [-26, -70], [-29, -50], [-26, -30], [-18, -14], [-8, -6], [-2, -12], [-4, -26], [-5, -40], [-3, -56]]), () => { for (let k = 0; k < 6; k++) cut(g, Ci(-16 + (k % 3) * 7, -70 + Math.floor(k / 3) * 7, 1.4)); }, 1.8);
      } else {
        fill(g, 'ink', hair);
        within(g, hair, () => { for (let k = 0; k < 6; k++) cutLine(g, 0.7, (q) => { q.moveTo(-2 - k * 3.4, -74); q.quadraticCurveTo(-22 - k, -46 + k * 2, -14 - k * 1.5, -10 + k); }); });
      }
      // the face: open (carved hollow, only its lines left: heroes, ladies, the good) or solid painted (red loyal,
      // black stern, white hide for the sly)
      if (face === 'open') {
        ink(g, 2.3, (q) => smooth(q, FACE, false));
        ink(g, 1.6, (q) => smooth(q, SIDE, false));
      } else {
        fill(g, face === 'red' ? 'red' : face === 'black' ? 'ink' : face === 'green' ? 'green' : 'hide', faceP);
        cut(g, (q) => { q.moveTo(1, -46); q.quadraticCurveTo(8, -50, 14, -45.5); q.quadraticCurveTo(8, -43, 1, -46); });
        cutLine(g, 1.4, (q) => { q.moveTo(-1, -53); q.quadraticCurveTo(7, -56, 15, -51); });
        cutLine(g, 1, (q) => { q.moveTo(15, -22); q.lineTo(9, -21.5); });
        if (face === 'black') cut(g, (q) => { q.arc(8, -60, 4, Math.PI * 0.15, Math.PI * 0.85); q.arc(8, -62, 3, Math.PI * 0.8, Math.PI * 0.2, true); q.closePath(); });
        ink(g, 1.6, faceP);
      }
      if (face === 'open') {   // eye, brow, nostril, mouth as thin strips of hide
        ink(g, 1.5, (q) => { q.moveTo(-1, -47.5); q.quadraticCurveTo(6, -50, 14, -45.5); q.quadraticCurveTo(7, -43.4, 1, -45.6); });
        g.beginPath(); g.arc(9.5, -46, 1.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
        fill(g, 'ink', S(fem ? [[15, -51.5], [8, -54], [-1, -55], [-1, -54], [8, -52.5], [15, -50.4]] : [[15.5, -51], [8, -54.5], [-2, -57.5], [-2, -55.5], [8, -52.6], [15, -49.6]]));
        ink(g, 1.1, (q) => { q.moveTo(19, -30); q.quadraticCurveTo(16, -31, 16.5, -28.5); });
        ink(g, fem ? 1.8 : 1.2, (q) => { q.moveTo(15, -21.5); q.lineTo(10.5, -21); }, fem ? 'red' : INK);
      }
      if (hat !== 'bald' && hat !== 'helmet') ink(g, 1.3, (q) => { q.moveTo(-3, -42); q.bezierCurveTo(-9, -43, -10, -32, -4.5, -32.5); });
      // headwear
      if (hat === 'helmet') {
        region(g, sp.trim, S([[-24, -62], [-32, -58], [-38, -30], [-40, -4], [-33, -2], [-28, -30], [-24, -50]]), () => scaleCuts(g, -42, -60, -22, -4, 4.4), 1.4);
        region(g, 'red', S([[18, -66], [14, -86], [2, -100], [-14, -100], [-26, -86], [-28, -62]]), () => { scroll(g, -8, -84, 8, 0, 1.3); scroll(g, 6, -82, 5.5, 2, 1.1, -1); beadLine(g, -22, -72, 12, -73, 1.3, 5); }, 1.7);
        region(g, 'yellow', Pl([[20, -58], [20, -68], [-28, -66], [-29, -56]]), () => meander(g, -26, -59.5, 18, 3.4, 1), 1.6);
        region(g, 'yellow', S([[-18, -68], [-30, -78], [-42, -74], [-44, -64], [-36, -60], [-30, -66], [-22, -62]]), () => scroll(g, -37, -69, 4.4, 0, 1, -1), 1.3);
        region(g, 'yellow', S([[14, -68], [22, -80], [16, -98], [8, -88], [4, -72]]), () => cut(g, Ci(14, -84, 3.6)), 1.4);
        ink(g, 2.6, (q) => { q.moveTo(-3, -99); q.lineTo(-3, -108); }, 'brown');
        region(g, 'orange', Ci(-3, -116, 9), () => { for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; cutLine(g, 1, (q) => { q.moveTo(-3 + Math.cos(a) * 3, -116 + Math.sin(a) * 3); q.lineTo(-3 + Math.cos(a) * 8, -116 + Math.sin(a) * 8); }); } }, 1.4);
      } else if (hat === 'gauze') {
        region(g, 'ink', S([[18, -62], [16, -80], [6, -90], [-8, -91], [-12, -100], [-24, -99], [-31, -86], [-31, -60]]), () => { scroll(g, -18, -88, 5, 0.2, 1.2); scroll(g, 4, -78, 6, 1.4, 1.3, -1); }, 1.2);
        region(g, 'yellow', Pl([[19, -59], [19, -66], [-32, -64], [-32, -58]]), () => beadLine(g, -28, -61.5, 16, -62, 1.1, 4.5), 1.3);
        for (const [x0, x1] of [[-28, -66], [14, 50]]) {
          ink(g, 3, (q) => { q.moveTo(x0, -80); q.lineTo(x1, -84); });
          const ex = x1 + Math.sign(x1 - x0) * 9; region(g, 'ink', El(ex, -85, 12, 7.5, -0.05), () => cut(g, El(ex, -85, 7, 3.2, -0.05)), 1.2);
        }
      } else if (hat === 'scarf') {
        region(g, sp.trim, S([[18, -62], [14, -82], [0, -96], [-18, -102], [-31, -92], [-31, -62]]), () => { lattice(g, -32, -100, 18, -64, 8, 1.6); }, 1.6);
        region(g, 'yellow', Ci(12, -70, 5), () => cut(g, Ci(12, -70, 2.2)), 1.2);
      } else if (hat === 'crown') {
        region(g, 'yellow', S([[18, -62], [14, -84], [-6, -94], [-26, -86], [-30, -62]]), () => { scroll(g, -6, -78, 7, 0.4, 1.3); beadLine(g, -24, -68, 12, -68, 1.3, 5); }, 1.6);
        ink(g, 3, (q) => { q.moveTo(-6, -93); q.lineTo(-6, -101); });
        region(g, 'ink', Pl([[-48, -106], [38, -100], [38, -94], [-48, -100]]), () => meander(g, -44, -98, 34, 2.6, 0.9), 1);
        for (const x of [-46, -42, -38, 30, 34, 38]) { ink(g, 0.9, (q) => { q.moveTo(x, -98); q.lineTo(x, -66); }); for (let y = -92; y < -66; y += 6) { g.beginPath(); g.arc(x, y, 1.9, 0, 7); g.fillStyle = dye(y % 12 ? 'red' : 'yellow'); g.fill(); } }
      } else if (hat === 'phoenix') {
        region(g, 'ink', S([[-4, -74], [-10, -94], [-26, -102], [-40, -92], [-36, -74], [-24, -68]]), () => { for (let k = 0; k < 4; k++) cutLine(g, 0.7, (q) => { q.moveTo(-8 - k * 6, -96); q.quadraticCurveTo(-24 - k * 3, -88, -26 - k * 2, -72); }); }, 1);
        region(g, 'yellow', Ci(2, -80, 9), () => plum(g, 2, -80, 4.6), 1.3);
        region(g, sp.trim, S([[-28, -98], [-40, -110], [-50, -102], [-40, -94]]), () => scroll(g, -40, -102, 3.6, 0, 1, 1), 1.2);
        ink(g, 2.2, (q) => { q.moveTo(-20, -90); q.lineTo(22, -104); }, 'yellow');
        for (const [x, y] of [[22, -104], [10, -100]]) { ink(g, 0.8, (q) => { q.moveTo(x, y); q.lineTo(x + 1, y + 20); }); for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + k * 0.25, y + 5 + k * 5, 1.8, 0, 7); g.fillStyle = dye(k % 2 ? 'yellow' : 'red'); g.fill(); } }
      } else if (hat === 'bun') {
        region(g, 'ink', Ci(-8, -84, 10), () => cutLine(g, 0.8, (q) => { q.arc(-8, -84, 6, 3.6, 5.6); }), 1);
        ink(g, 2.2, (q) => { q.moveTo(-24, -88); q.lineTo(8, -82); }, 'yellow');
        if (sp.body === 'short') region(g, sp.trim, Pl([[9, -70], [10, -64], [-28, -60], [-28, -66]]), null, 1.2);
      } else if (hat === 'horns') {
        fill(g, 'ink', tongues([[-26, -68, -60, 34, 14, 1], [-16, -76, -30, 30, 13, -1], [-4, -76, 0, 26, 12, 1], [-30, -50, -95, 30, 13, 1]]));
        region(g, 'hide2', S([[2, -74], [10, -96], [22, -112], [16, -96], [8, -74]]), () => strata(g, 0, 20, (x) => -104 + (x - 4) * 0.4, 3, 7, 1.4), 1.3);
        region(g, 'hide2', S([[-14, -78], [-16, -100], [-8, -118], [-8, -100], [-6, -78]]), null, 1.3);
      }
    }, seed);
  }
  /** pheasant plumes: a long feather of alternating bars, from (0,0) sweeping back and up */
  function plumePiece(K, seed) {
    return piece([-200, -210, 30, 20], K, (g) => {
      for (const [sx, k] of [[0, 1], [6, 0.86]]) {
        const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([sx - 190 * k * t + 30 * Math.sin(t * Math.PI) * k, -40 * k * t - 160 * k * Math.sin(t * Math.PI * 0.62)]); }
        for (let i = 0; i < 40; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], w = 6.5 * (1 - i / 40 * 0.6); const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
          g.beginPath(); g.moveTo(ax + nx, ay + ny); g.lineTo(bx + nx, by + ny); g.lineTo(bx - nx, by - ny); g.lineTo(ax - nx, ay - ny); g.closePath(); g.fillStyle = dye(i % 3 === 0 ? 'ink' : 'hide'); g.fill(); }
        ink(g, 0.9, (q) => smooth(q, pts, false));
      }
    }, seed);
  }
  function tailPiece(sp, K, seed) {   // what hangs down the back of the head and swings: ribbons, long hair
    if (sp.hat === 'scarf') return piece([-30, -6, 14, 110], K, (g) => { for (const dx of [0, -9]) region(g, sp.trim, S([[dx - 4, 0], [dx + 4, 0], [dx - 4, 60], [dx - 10, 104], [dx - 18, 100], [dx - 10, 58]]), () => cut(g, Ci(dx - 6, 40, 2.2)), 1.2); }, seed);
    if (sp.hat === 'phoenix') return piece([-26, -6, 16, 130], K, (g) => region(g, 'ink', S([[-6, 0], [6, 0], [4, 60], [-2, 126], [-12, 120], [-14, 60]]), () => { for (let k = 0; k < 3; k++) cutLine(g, 0.7, (q) => { q.moveTo(-3 + k * 3, 6); q.lineTo(-8 + k * 3, 116); }); }, 1), seed);
    return null;
  }
  function beardPiece(sp, K, seed) {
    if (!sp.beard) return null;
    const white = sp.beard === 'white';
    return piece([-16, -4, 16, 104], K, (g) => region(g, white ? 'white' : 'ink', S([[-10, 0], [9, 0], [11, 40], [6, 82], [-1, 100], [-8, 82], [-12, 40]]), () => { for (let k = -2; k <= 2; k++) cutLine(g, 0.8, (q) => { q.moveTo(k * 3, 8); q.quadraticCurveTo(k * 4, 50, k * 2.5, 90); }); }, white ? 1.2 : 0.8), seed);
  }
  const PCACHE = new Map();
  function parts(sp, K) {
    const key = [sp.body, sp.hat, sp.face, sp.color, sp.trim, sp.beard, sp.plumes, K.toFixed(3)].join('|');
    if (PCACHE.has(key)) return PCACHE.get(key);
    let seed = 1; for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
    const P = { arm: sleevePieces(sp, K, seed), torso: torsoPiece(sp, K, seed + 5), lower: lowerPiece(sp, K, seed + 6), head: headPiece(sp, K, seed + 7), foot: footPiece(sp, K, seed + 8),
      leg: sp.body === 'armour' || sp.body === 'short' ? legPiece(sp, K, seed + 9) : null, tail: tailPiece(sp, K, seed + 10), beard: beardPiece(sp, K, seed + 11),
      plume: sp.hat === 'helmet' && sp.plumes !== false ? plumePiece(K, seed + 12) : null };
    PCACHE.set(key, P);
    return P;
  }
  function spec(o, lt) {
    const r = ROLES[val(o.role, lt, 'scholar')] || ROLES.scholar;
    return { body: o.body || r.body, hat: o.hat || r.hat, face: o.mask || r.face, color: val(o.color, lt, r.color), trim: o.trim || r.trim, beard: o.beard ?? r.beard ?? null, plumes: o.plumes ?? r.plumes ?? true };
  }
  /** the pose at lt: keyframes blend over 0.42 s; loose parts wobble after each change */
  function poseAt(o, lt, seed) {
    const keys = isKeys(o.pose) ? o.pose : [[0, val(o.pose, lt, 'stand')]];
    let i = 0; for (let j = 0; j < keys.length; j++) if (lt >= keys[j][0]) i = j;
    const cur = POSES[keys[i][1]] || POSES.stand, prev = i > 0 ? (POSES[keys[i - 1][1]] || POSES.stand) : cur;
    const since = i > 0 ? lt - keys[i][0] : 99, k = ease.inOut(clamp(since / 0.42));
    const st = { f: [lerp(prev.f[0], cur.f[0], k), lerp(prev.f[1], cur.f[1], k)], b: [lerp(prev.b[0], cur.b[0], k), lerp(prev.b[1], cur.b[1], k)] };
    for (const n of NUM) st[n] = lerp(prev[n] || 0, cur[n] || 0, k);
    st.wob = since < 3 ? Math.exp(-2.6 * since) * Math.sin(since * 11) : 0;
    const walking = Math.max(st.walk, val(o.walk, lt, false) ? 1 : 0);
    const ph = lt * Math.PI * 2 * 0.9 * Math.max(1, walking) + seed;
    const sw = walking > 0.01 ? Math.sin(ph) : 0;
    st.legF = 22 * sw * Math.min(1, walking) + 12 * st.legs; st.legB = -22 * sw * Math.min(1, walking) - 10 * st.legs;
    st.f[0] += 16 * sw * Math.min(1, walking); st.b[0] -= 16 * sw * Math.min(1, walking);
    st.bob = walking > 0.01 ? -Math.abs(Math.cos(ph)) * 5 * Math.min(1.6, walking) : 0;
    st.sway = sw * Math.min(1, walking);
    const tr = 1 + (st.shake || 0);
    st.tx = 2.2 * tr * vn(lt * 1.7, seed); st.ty = 1.4 * tr * vn(lt * 1.3, seed + 3); st.rot = 0.011 * tr * vn(lt * 1.1, seed + 7);
    st.hold = val(o.holds, lt, null); st.holdB = val(o.holdsBack, lt, null);
    return st;
  }
  const PROPMODE = { sword: 'arm', tablet: 'arm', arrow: 'arm', brush: 'arm' };
  /** draws one puppet with g at its feet point, already scaled to puppet units. Returns device points for the rods. */
  function drawPuppet(g, sp, P, st, K, mounted) {
    const pt = () => g.getTransform().transformPoint(new DOMPoint(0, 0));
    const A = P.arm, out = {};
    g.save();
    g.translate(st.tx, st.ty + (mounted ? 0 : -FOOT + st.bob + st.crouch * 96)); g.rotate(st.rot);
    const swing = st.wob * 0.12 - st.sway * 0.05;
    const inHead = (fn) => { g.save(); g.rotate(st.tilt * DEG); g.translate(NECK[0], NECK[1]); g.rotate(st.head * DEG); fn(); g.restore(); };
    const arm = (sh, a, back) => {
      g.save(); g.rotate(st.tilt * DEG); g.translate(sh[0], sh[1]); g.rotate(-a[0] * DEG); put(g, A.ua);
      g.translate(0, UA); g.rotate(-a[1] * DEG); put(g, A.fa);
      if (!back) rivet(g, 0, 0, 3.4);
      g.save(); g.translate(0, A.wrist - 4); put(g, A.hand); const hp = pt();
      const kind = back ? st.holdB : st.hold;
      if (kind) { const pc = propPiece(kind, K); if (PROPMODE[kind] !== 'arm') g.rotate((a[0] + a[1] - st.tilt) * DEG); g.translate(0, 10); put(g, pc); }
      g.restore();
      if (A.water) { g.translate(0, A.wrist - 8); g.rotate(-(a[0] + a[1]) * DEG * 0.6 + swing * 2); put(g, A.water); }
      g.restore(); return hp;
    };
    // behind the body
    if (P.plume) inHead(() => { g.save(); g.translate(-3 * HK, -100 * HK); g.rotate(swing * 1.5 + st.sway * 0.04); put(g, P.plume); g.restore(); });
    if (P.tail) inHead(() => { g.save(); g.translate((P.tail && sp.hat === 'scarf' ? -26 : -24) * HK, (sp.hat === 'scarf' ? -74 : -40) * HK); g.rotate(swing * 1.6 - st.sway * 0.08 - st.head * DEG * 0.8); put(g, P.tail); g.restore(); });
    out.hb = arm(SHB, st.b, true);
    const legs = (front) => {
      if (P.leg) { if (mounted && !front) return; const hip = front ? HIPF : HIPB, a = mounted ? 28 : front ? st.legF : st.legB; g.save(); g.translate(hip[0], hip[1]); g.rotate(-a * DEG); g.scale(1, 1 - 0.49 * st.crouch); put(g, P.leg); g.restore(); }
      else if (!mounted) { const dx = (front ? 8 : -12) + (front ? 1 : -1) * st.sway * 12; g.save(); g.translate(dx, FOOT - 12 - st.crouch * 96); put(g, P.foot); g.restore(); }
    };
    legs(false);
    if (P.lower && !mounted) { g.save(); g.transform(1, 0, -st.sway * 0.06 - st.tilt * DEG * 0.3, 1, 0, 0); g.scale(1, 1 - 0.49 * st.crouch); put(g, P.lower); g.restore(); }
    else if (P.lower && mounted && sp.body === 'armour') { g.save(); g.scale(1, 0.7); put(g, P.lower); g.restore(); }
    legs(true);
    g.save(); g.rotate(st.tilt * DEG); put(g, P.torso); out.neck = (g.translate(8, -112), pt()); g.restore();
    inHead(() => { put(g, P.head); if (P.beard) { g.save(); g.translate(13 * HK, -18 * HK); g.rotate(-st.head * DEG * 0.7 + swing * 1.2); put(g, P.beard); g.restore(); } });
    g.save(); g.rotate(st.tilt * DEG); rivet(g, SHF[0], SHF[1] + 2, 3.6); if (P.leg) rivet(g, HIPF[0], HIPF[1], 3.4); g.restore();
    out.hf = arm(SHF, st.f, false);
    g.restore();
    return out;
  }

  /** puppet(x, y, o): a jointed leather puppet standing with its soles on (x, y), about o.size px tall (default 520: give
   *  480–580 so it carries the page; a crowd or a distant figure 260–340). Pierced dyed hide, profile face, riveted
   *  joints, two dark rods (neck and front hand) running down off the screen. It trembles slightly in the hand and its
   *  loose parts (plumes, ribbons, beard, water sleeves) swing after every move. o: { role: 'general' (armour, helmet,
   *  pheasant plumes) | 'emperor' (crown with bead strings, beard) | 'official' (black gauze hat with wings, beard) |
   *  'scholar' (soft cap with ribbons) | 'lady' (phoenix coronet, gown, long white water sleeves) | 'monk' (shaven
   *  head) | 'peasant' (topknot, short tunic, trousers) | 'elder' (white beard) | 'demon' (horns, wild hair, black
   *  face) | 'soldier' (small helmet, tunic); color (main dye: 'red' 'yellow' 'green' 'blue' 'purple' 'orange'), trim
   *  (second dye), mask (face: 'open' hollow-carved — the default, the good; 'red' painted loyal; 'black' stern and
   *  upright, with a crescent; 'white' raw hide, the sly one; 'green' wild), beard ('ink' | 'white' | false), face
   *  ('r' | 'l', which way it looks; fn), pose (fn or keyframes): 'stand' 'walk' 'run' 'point' 'raise' 'bow' 'kneel'
   *  'fight' 'think' 'cry' 'present' 'halt' 'angry' 'proud' 'sad' 'fall' — poses blend over 0.4 s; walk (fn: true makes
   *  any pose step in place; move x with a function of lt), holds (prop in the front hand, fn: 'sword' 'spear' 'glaive'
   *  'fan' (feather fan) 'scroll' 'jade' 'cup' 'tablet' 'bow' 'flag' 'whisk' 'staff' 'lantern' 'slips' 'arrow' 'brush'),
   *  holdsBack, rods (false hides them), at (pressed onto the cloth), out (lifted off), lift (fn 0..1: lifted toward the
   *  lamp — the shadow grows huge and soft; the signature turn), enter: 'cut' (no press-on) }. x and y may be functions. */
  B.puppet = function (x, y, o = {}) {
    const size = o.size ?? 520, s = size / 470, R = 1.25, K = s * R, seed = 7 + (this.seed() % 50);
    const cw = 760 * s, ch = 560 * s + 280;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - cw / 2, y: val(y, lt) - 560 * s }), (g, lt) => {
      const sp = spec(o, lt), P = parts(sp, K), st = poseAt(o, lt, seed);
      g.save(); g.translate(cw / 2, 560 * s); g.scale(s, s);
      const left = val(o.face, lt, 'r') === 'l'; if (left) g.scale(-1, 1);
      g.globalAlpha = 0.94;
      const rp = drawPuppet(g, sp, P, st, K, false);
      g.restore();
      if (o.rods !== false) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); const d = left ? 1 : -1; rod(g, rp.neck.x, rp.neck.y, d * 0.16, ch * R, 2.6 * R * Math.max(0.8, s)); rod(g, rp.hf.x, rp.hf.y, -d * 0.1, ch * R, 2.2 * R * Math.max(0.8, s)); g.restore(); }
    }, o, R), o);
  };

  /** troupe(role, n, x0, x1, y, o): a row of n identical small puppets between x0 and x1, soles on y — an army, a
   *  crowd, a procession, the common people. Each steps a little out of phase. o: { size (300), color, trim, mask,
   *  face, pose (fn), walk, holds ('spear' or 'flag' makes an army), march (fn: px the whole row has moved), at, out, lift } */
  B.troupe = function (role, n, x0, x1, y, o = {}) {
    const size = o.size ?? 300, s = size / 470, R = 1.1, K = s * R, pad = 400 * s;
    const cw = x1 - x0 + pad * 2, ch = 560 * s + 60;
    return handle(mount(this, cw, ch, (lt) => ({ x: x0 - pad + val(o.march, lt, 0), y: y - 560 * s }), (g, lt) => {
      const sp = spec({ ...o, role }, lt), P = parts(sp, K), left = val(o.face, lt, 'r') === 'l';
      for (let i = 0; i < n; i++) {
        const st = poseAt({ ...o, role }, lt + i * 0.37, 11 + i * 5);
        g.save(); g.translate(pad + (n > 1 ? (x1 - x0) * i / (n - 1) : (x1 - x0) / 2), 560 * s); g.scale(s, s); if (left) g.scale(-1, 1);
        g.globalAlpha = 0.94; drawPuppet(g, sp, P, st, K, false); g.restore();
      }
    }, o, R), o);
  };
  // ───────────────────────── props: carved objects in a hand or on the cloth ─────────────────────────
  const PROPS = {
    sword: [[-12, -22, 12, 118], (g) => { region(g, 'brown', Pl([[-3, -18], [3, -18], [3, 0], [-3, 0]]), null, 1.2); region(g, 'yellow', S([[-11, 0], [0, -5], [11, 0], [0, 6]]), null, 1.2); region(g, 'hide2', Pl([[-4, 4], [4, 4], [3, 104], [0, 116], [-3, 104]]), () => cutLine(g, 1, (q) => { q.moveTo(0, 12); q.lineTo(0, 100); }), 1.3); fill(g, 'red', tongues([[0, -18, 180, 16, 8, 1]])); }],
    spear: [[-16, -290, 16, 124], (g) => { region(g, 'brown', Pl([[-2.5, -240], [2.5, -240], [2.5, 120], [-2.5, 120]]), null, 1); fill(g, 'red', tongues([[-4, -236, 170, 30, 12, 1], [5, -236, 190, 26, 11, -1]])); region(g, 'hide2', S([[0, -286], [9, -262], [4, -240], [-4, -240], [-9, -262]]), () => cut(g, El(0, -260, 2, 8)), 1.3); }],
    glaive: [[-14, -280, 52, 116], (g) => { region(g, 'brown', Pl([[-2.5, -206], [2.5, -206], [2.5, 112], [-2.5, 112]]), null, 1); region(g, 'hide2', S([[2, -200], [26, -226], [46, -270], [36, -262], [14, -232], [4, -222], [2, -270], [-6, -228], [-4, -204]]), () => { scroll(g, 14, -220, 6, 0.6, 1.3); cutLine(g, 1, (q) => { q.moveTo(8, -214); q.quadraticCurveTo(30, -236, 40, -262); }); }, 1.4); fill(g, 'red', tongues([[-2, -200, 160, 30, 12, 1]])); region(g, 'yellow', Ci(0, -204, 6), null, 1); }],
    fan: [[-38, -132, 38, 6], (g) => { region(g, 'brown', Pl([[-3, -46], [3, -46], [3, 2], [-3, 2]]), null, 1); const f = S([[0, -40], [24, -54], [34, -88], [24, -122], [0, -130], [-24, -122], [-34, -88], [-24, -54]]); region(g, 'white', f, () => { for (let k = -5; k <= 5; k++) cutLine(g, 1.1, (q) => { q.moveTo(0, -44); q.lineTo(k * 6.2, -124 + Math.abs(k) * 4); }); }, 1.4); region(g, 'ink', Pl([[-8, -40], [8, -40], [6, -50], [-6, -50]]), null, 1); }],
    scroll: [[-42, -22, 42, 10], (g) => { region(g, 'yellow', Pl([[-32, -14], [32, -14], [32, 2], [-32, 2]]), () => meander(g, -28, -3, 28, 3, 1), 1.3); for (const x of [-36, 36]) region(g, 'ink', Pl([[x - 4, -18], [x + 4, -18], [x + 4, 6], [x - 4, 6]]), null, 1); fill(g, 'red', Pl([[-3, -15], [3, -15], [3, 3], [-3, 3]])); }],
    jade: [[-30, -60, 30, 34], (g) => { region(g, 'jade', Ci(0, -30, 26), () => { cut(g, Ci(0, -30, 8)); const pts = []; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; pts.push([Math.cos(a) * 17, -30 + Math.sin(a) * 17]); } beads(g, pts, 2.2); }, 1.6); ink(g, 1.2, Ci(0, -30, 8)); fill(g, 'red', tongues([[0, -4, 180, 34, 10, 1]])); }],
    cup: [[-26, -50, 26, 6], (g) => { region(g, 'yellow', S([[-20, -46], [22, -42], [14, -22], [4, -16], [-6, -16], [-14, -24]]), () => meander(g, -14, -30, 14, 3, 1), 1.4); for (const x of [-10, 0, 10]) ink(g, 2.4, (q) => { q.moveTo(x * 0.6, -18); q.lineTo(x, 2); }); }],
    tablet: [[-8, -4, 8, 76], (g) => region(g, 'white', Pl([[-5, 0], [5, 0], [4, 72], [-4, 72]]), () => cutLine(g, 0.9, (q) => { q.moveTo(0, 8); q.lineTo(0, 64); }), 1.3)],
    bow: [[-8, -108, 40, 108], (g) => { ink(g, 5, (q) => { q.moveTo(0, -102); q.quadraticCurveTo(52, 0, 0, 102); }, 'brown'); ink(g, 1, (q) => { q.moveTo(0, -102); q.lineTo(0, 102); }); region(g, 'red', Pl([[20, -12], [28, -12], [28, 12], [20, 12]]), null, 1); }],
    flag: [[-8, -178, 86, 26], (g) => { region(g, 'brown', Pl([[-2.5, -176], [2.5, -176], [2.5, 22], [-2.5, 22]]), null, 1); const fl = Pl([[3, -170], [80, -130], [3, -90]]); region(g, 'red', fl, () => { scroll(g, 26, -130, 9, 0.2, 1.4); }, 1.4); fill(g, 'yellow', tongues([[10, -88, 180, 12, 7, 1], [26, -100, 160, 12, 7, -1], [44, -112, 150, 12, 7, 1], [62, -122, 140, 12, 7, -1]])); region(g, 'yellow', Ci(0, -178, 5), null, 1); }],
    whisk: [[-10, -60, 40, 46], (g) => { region(g, 'brown', Pl([[-2.5, -50], [2.5, -50], [2.5, 4], [-2.5, 4]]), null, 1); region(g, 'yellow', Ci(0, -52, 4), null, 1); for (let k = 0; k < 9; k++) ink(g, 1.1, (q) => { q.moveTo(0, -50); q.quadraticCurveTo(20 + k, -60 + k * 2, 14 + k * 2.4, 40 - k); }, 'white'); for (let k = 0; k < 9; k += 2) ink(g, 0.7, (q) => { q.moveTo(0, -50); q.quadraticCurveTo(20 + k, -60 + k * 2, 14 + k * 2.4, 40 - k); }); }],
    staff: [[-24, -310, 24, 66], (g) => { region(g, 'brown', Pl([[-2.5, -270], [2.5, -270], [2.5, 62], [-2.5, 62]]), null, 1); region(g, 'yellow', S([[0, -306], [16, -290], [12, -270], [0, -264], [-12, -270], [-16, -290]]), () => { cut(g, El(0, -286, 8, 12)); }, 1.4); for (const [x, y] of [[-14, -272], [14, -272], [-16, -284], [16, -284]]) { ink(g, 1.4, Ci(x, y, 4), 'yellow'); } }],
    lantern: [[-8, -96, 84, 18], (g) => { ink(g, 3, (q) => { q.moveTo(0, 6); q.lineTo(0, -60); q.quadraticCurveTo(10, -84, 50, -86); }, 'brown'); ink(g, 1, (q) => { q.moveTo(50, -86); q.lineTo(50, -66); }); region(g, 'red', El(50, -40, 26, 24), () => { for (let k = -2; k <= 2; k++) cutLine(g, 1.6, (q) => { q.ellipse(50, -40, Math.abs(k) * 6 + 1, 22, 0, -Math.PI / 2, Math.PI / 2, k < 0); }); }, 1.4); for (const y of [-64, -16]) region(g, 'yellow', Pl([[38, y - 3], [62, y - 3], [62, y + 3], [38, y + 3]]), null, 1); fill(g, 'yellow', tongues([[50, -14, 180, 20, 8, 1]])); }],
    slips: [[-34, -56, 34, 6], (g) => { region(g, 'hide2', Pl([[-30, -52], [30, -52], [30, 2], [-30, 2]]), () => { for (let x = -24; x < 30; x += 6) cutLine(g, 1, (q) => { q.moveTo(x, -50); q.lineTo(x, 0); }); }, 1.3); for (const y of [-40, -12]) ink(g, 1.6, (q) => { q.moveTo(-32, y); q.lineTo(32, y); }, 'brown'); }],
    arrow: [[-10, -34, 10, 130], (g) => { region(g, 'brown', Pl([[-1.8, -28], [1.8, -28], [1.8, 112], [-1.8, 112]]), null, 0.8); region(g, 'ink', Pl([[0, 128], [6, 110], [-6, 110]]), null, 0.8); for (const d of [-1, 1]) fill(g, 'red', Pl([[0, -30], [d * 8, -34], [d * 8, -14], [0, -8]])); }],
    brush: [[-6, -4, 6, 86], (g) => { region(g, 'brown', Pl([[-2.5, 0], [2.5, 0], [2.5, 62], [-2.5, 62]]), null, 1); fill(g, 'ink', S([[-4, 62], [4, 62], [3, 74], [0, 84], [-3, 74]])); }],
  };
  const PRCACHE = new Map();
  function propPiece(kind, K) {
    const key = kind + '|' + K.toFixed(3);
    if (!PRCACHE.has(key)) { const d = PROPS[kind] || PROPS.scroll; PRCACHE.set(key, piece(d[0], K, d[1], 41)); }
    return PRCACHE.get(key);
  }
  /** prop(kind, x, y, o): a carved object on its own rod, centred on (x, y) — the thing a page is about held up big
   *  (a jade disc, an imperial edict, a sword), or a flying piece (arrows in a volley: move x/y/rot as functions).
   *  kind: as puppet's holds. o: { size (scale, default 2), rot (degrees, fn), rod (true), at, out, lift } */
  B.prop = function (kind, x, y, o = {}) {
    const d = PROPS[kind] || PROPS.scroll, [bx0, by0, bx1, by1] = d[0], sc = o.size ?? 2, R = 1.25;
    const ext = Math.hypot(bx1 - bx0, by1 - by0) * sc + 40, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    return handle(mount(this, ext, ext + (o.rod === false ? 0 : 300), (lt) => ({ x: val(x, lt) - ext / 2, y: val(y, lt) - ext / 2 }), (g, lt) => {
      const pc = propPiece(kind, sc * R);
      g.save(); g.translate(ext / 2, ext / 2); g.rotate(val(o.rot, lt, 0) * DEG + 0.01 * vn(lt * 1.3, 5)); g.scale(sc, sc); g.translate(-cx, -cy); g.globalAlpha = 0.95; put(g, pc); g.restore();
      if (o.rod !== false) rod(g, ext / 2, ext / 2 + 4, -0.08, 300, 2.4);
    }, o, R), o);
  };

  // ───────────────────────── creatures ─────────────────────────
  const CCACHE = new Map();
  const cached = (key, fn) => { if (!CCACHE.has(key)) CCACHE.set(key, fn()); return CCACHE.get(key); };
  function horseParts(c, trim, K) {
    return cached(`horse|${c}|${trim}|${K.toFixed(3)}`, () => ({
      body: piece([-130, -236, 118, -100], K, (g) => {
        region(g, c, S([[-104, -196], [-76, -214], [0, -208], [62, -214], [98, -200], [108, -168], [94, -138], [58, -126], [-40, -124], [-92, -134], [-112, -160]]), () => { scroll(g, -78, -164, 13, 0.3, 1.8); scroll(g, 74, -164, 11, 2.1, 1.6, -1); strata(g, -60, 50, (x) => -136 + Math.abs(x) * 0.05, 1, 6, 1.6); }, 2.2);
        region(g, trim, S([[-46, -212], [32, -212], [38, -168], [-4, -156], [-50, -168]]), () => { meander(g, -44, -176, 32, 3.6, 1.1); for (let x = -36; x < 30; x += 12) coin(g, x, -196, 4.2); }, 1.6);
        region(g, 'brown', S([[-34, -226], [-22, -214], [16, -214], [28, -226], [30, -212], [-38, -210]]), null, 1.4);
        ink(g, 2, (q) => { q.moveTo(-2, -212); q.lineTo(-2, -150); }); region(g, 'yellow', S([[-12, -150], [8, -150], [10, -142], [-14, -142]]), null, 1.2);
        fill(g, 'red', tongues([[92, -150, 180, 26, 12, 1], [100, -168, 175, 22, 10, -1]])); ink(g, 2.4, (q) => { q.moveTo(-104, -186); q.quadraticCurveTo(-20, -150, 100, -176); }, 'red');
      }, 51),
      neck: piece([-24, -140, 140, 36], K, (g) => {   // pivot at the withers (70,-196) → local (0,0)
        fill(g, 'ink', tongues([[-6, -24, -105, 30, 13, 1], [6, -52, -95, 30, 13, -1], [20, -78, -85, 30, 13, 1], [36, -100, -70, 28, 12, -1], [52, -114, -40, 22, 11, 1]]));
        region(g, c, S([[-14, -6], [0, -50], [20, -88], [44, -112], [62, -122], [84, -114], [110, -84], [126, -64], [128, -48], [114, -42], [92, -58], [72, -62], [54, -40], [36, 10], [0, 26]]), () => { cut(g, El(84, -94, 5, 3, 0.5)); cutLine(g, 1.3, (q) => { q.moveTo(118, -54); q.quadraticCurveTo(122, -50, 120, -46); }); strata(g, 4, 50, (x) => -30 - x * 1.1, 3, 10, 1.8); }, 2);
        region(g, c, tongues([[62, -118, -15, 20, 9, 1]]), null, 1.2);
        ink(g, 2.4, (q) => { q.moveTo(70, -112); q.lineTo(120, -56); q.moveTo(80, -80); q.lineTo(40, -40); }, 'red');
        fill(g, 'red', tongues([[86, -78, 160, 16, 8, 1]]));
      }, 52),
      upper: piece([-16, -8, 16, 64], K, (g) => region(g, c, S([[-14, -6], [14, -6], [8, 58], [-6, 58]]), () => scroll(g, 0, 16, 5.5, 0.5, 1.3), 1.7), 53),
      lower: piece([-12, -6, 16, 74], K, (g) => { region(g, c, S([[-5, -2], [5, -2], [4, 52], [-4, 52]]), null, 1.4); region(g, 'ink', S([[-7, 50], [7, 50], [11, 70], [-8, 70]]), null, 1); }, 54),
      tail: piece([-120, -30, 10, 120], K, (g) => { const t = S([[0, -6], [-30, -2], [-66, 30], [-96, 100], [-110, 112], [-80, 100], [-56, 70], [-36, 44], [-14, 16]]); region(g, 'ink', t, () => { for (let k = 0; k < 5; k++) cutLine(g, 0.9, (q) => { q.moveTo(-6, 2 + k * 3); q.quadraticCurveTo(-50, 30 + k * 6, -96 + k * 3, 100); }); }, 1); }, 55),
    }));
  }
  /** horse(x, y, o): a carved horse with its hooves on (x, y), about o.size px tall (default 300), legs jointed on
   *  rivets. A general rides it with o.rider (the puppet options: { role: 'general', holds: 'spear', … }). o: { color
   *  ('white' hide, 'red', 'ink' black, 'yellow'), trim (saddle cloth), gait (fn: 'stand' | 'walk' | 'gallop'), face
   *  ('r' | 'l'), rider, at, out, lift }. Move x with a function of lt to ride it across. */
  B.horse = function (x, y, o = {}) {
    const size = o.size ?? 300, s = size / 300, R = 1.2, K = s * R, cw = 560 * s, ch = 600 * s;
    const seed = this.seed() % 40;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - cw / 2, y: val(y, lt) - ch + 40 * s }), (g, lt) => {
      const P = horseParts(o.color || 'white', o.trim || 'red', K), gait = val(o.gait, lt, 'stand');
      const amp = gait === 'gallop' ? 34 : gait === 'walk' ? 18 : 0, fq = gait === 'gallop' ? 2.2 : 1.1, ph = lt * Math.PI * 2 * fq;
      const bob = gait === 'gallop' ? Math.sin(ph * 2) * 6 : gait === 'walk' ? Math.abs(Math.sin(ph)) * 2 : 0;
      g.save(); g.translate(cw / 2, ch - 40 * s); g.scale(s, s); if (val(o.face, lt, 'r') === 'l') g.scale(-1, 1);
      g.translate(1.5 * vn(lt * 1.5, seed), -bob); g.rotate(gait === 'gallop' ? Math.sin(ph) * 0.04 : 0); g.globalAlpha = 0.94;
      const leg = (hx, hy, off, far) => { const a = amp * Math.sin(ph + off), b = Math.max(0, amp * 0.9 * Math.sin(ph + off + 1.2)); g.save(); g.translate(hx, hy); g.rotate(-a * DEG); put(g, P.upper); g.translate(0, 56); g.rotate((far ? 0.6 : 1) * b * DEG * (hx > 0 ? -1 : 1)); put(g, P.lower); g.restore(); if (!far) rivet(g, hx, hy, 3.6); };
      leg(50, -132, Math.PI, true); leg(-62, -136, 0, true);
      g.save(); g.translate(-106, -184); g.rotate(0.15 * Math.sin(ph * 0.5) + (gait === 'gallop' ? -0.3 : 0)); put(g, P.tail); g.restore();
      put(g, P.body);
      g.save(); g.translate(72, -196); g.rotate((gait === 'gallop' ? Math.sin(ph) * 0.08 : Math.sin(lt * 1.2) * 0.03) - (gait === 'gallop' ? 0.12 : 0)); put(g, P.neck); g.restore(); rivet(g, 72, -196, 3.8);
      leg(62, -130, 0.4, false); leg(-74, -134, Math.PI + 0.4, false);
      if (o.rider) {
        const rs = (o.rider.size ?? 400) / 470 / s, sp = spec(o.rider, lt), st = poseAt(o.rider, lt, seed + 3);
        g.save(); g.translate(-4, -222); g.scale(rs, rs); drawPuppet(g, sp, parts(sp, K * rs), st, K * rs, true); g.restore();
      }
      g.restore();
    }, o, R), o);
  };
  function tigerParts(c, K) {
    return cached(`tiger|${c}|${K.toFixed(3)}`, () => ({
      body: piece([-124, -160, 108, -50], K, (g) => region(g, c, S([[-112, -118], [-80, -142], [20, -146], [80, -132], [100, -102], [86, -70], [40, -60], [-60, -62], [-106, -80]]), () => { for (let k = 0; k < 9; k++) { const x = -92 + k * 20; taper(g, [[x, -144], [x + 6, -118], [x - 2, -92], [x + 4, -68]], 7); } }, 2.2), 61),
      head: piece([-30, -70, 90, 50], K, (g) => {   // pivot at the neck (90,-110)
        region(g, c, S([[-20, -30], [0, -56], [30, -62], [62, -50], [84, -24], [82, 6], [62, 24], [26, 30], [-8, 20], [-24, 0]]), () => { cut(g, El(40, -30, 7, 3.6, 0.2)); cutLine(g, 2, (q) => { q.moveTo(12, -50); q.lineTo(30, -50); q.moveTo(10, -42); q.lineTo(32, -42); q.moveTo(12, -34); q.lineTo(30, -34); q.moveTo(21, -50); q.lineTo(21, -34); }); for (let k = 0; k < 3; k++) taper(g, [[-10 + k * 8, -40], [-6 + k * 8, -10], [-12 + k * 8, 14]], 5); }, 2);
        region(g, 'ink', S([[4, -54], [-2, -74], [16, -66]]), null, 1);
        region(g, 'white', S([[56, 8], [84, 4], [80, 22], [60, 22]]), () => { for (let x = 62; x < 82; x += 5) cutLine(g, 1, (q) => { q.moveTo(x, 6); q.lineTo(x, 14); }); }, 1.3);
        ink(g, 1, (q) => { for (let k = 0; k < 3; k++) { q.moveTo(76, -6 + k * 4); q.lineTo(100, -12 + k * 7); } });
      }, 62),
      leg: piece([-16, -8, 30, 84], K, (g) => { region(g, c, S([[-13, -4], [13, -4], [10, 64], [-9, 66]]), () => taper(g, [[-6, 10], [4, 20], [-4, 34]], 5), 1.8); region(g, c, S([[-10, 60], [14, 60], [26, 70], [24, 80], [-10, 80]]), () => { for (const x of [4, 12, 20]) cutLine(g, 1, (q) => { q.moveTo(x, 72); q.lineTo(x + 2, 80); }); }, 1.5); }, 63),
      tail: piece([-120, -110, 10, 20], K, (g) => region(g, c, S([[0, 0], [-40, -10], [-80, -40], [-100, -90], [-90, -100], [-70, -60], [-36, -26], [0, 12]]), () => { for (let k = 0; k < 4; k++) taper(g, [[-20 - k * 20, -10 - k * 18], [-14 - k * 20, -4 - k * 22]], 5); }, 1.6), 64),
    }));
  }
  /** tiger(x, y, o): a striped carved tiger on its paws at (x, y), ~o.size px long (default 330): danger, the wild,
   *  a fierce official ("苛政猛于虎"). o: { color ('yellow' | 'orange' | 'white'), gait (fn: 'stand' | 'walk' |
   *  'pounce'), roar (fn: true opens the jaw upward), face, at, out, lift } */
  B.tiger = function (x, y, o = {}) {
    const size = o.size ?? 330, s = size / 330, R = 1.2, K = s * R, cw = 480 * s, ch = 340 * s, seed = this.seed() % 40;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - cw / 2, y: val(y, lt) - ch + 30 * s }), (g, lt) => {
      const P = tigerParts(o.color || 'yellow', K), gait = val(o.gait, lt, 'stand'), ph = lt * Math.PI * 2 * 1.1, amp = gait === 'walk' ? 20 : 0;
      g.save(); g.translate(cw / 2, ch - 30 * s); g.scale(s, s); if (val(o.face, lt, 'r') === 'l') g.scale(-1, 1);
      g.translate(1.5 * vn(lt * 1.4, seed), 0); if (gait === 'pounce') { g.translate(0, -30); g.rotate(-0.22); } g.globalAlpha = 0.94;
      const leg = (hx, off, far) => { g.save(); g.translate(hx, -86); g.rotate((gait === 'pounce' ? (hx > 0 ? -50 : 30) : -amp * Math.sin(ph + off)) * DEG); if (far) g.globalAlpha = 0.85; put(g, P.leg); g.restore(); };
      leg(64, Math.PI, true); leg(-78, 0, true);
      g.save(); g.translate(-106, -110); g.rotate(0.12 * Math.sin(lt * 1.6)); put(g, P.tail); g.restore();
      put(g, P.body);
      g.save(); g.translate(90, -110); g.rotate(val(o.roar, lt, false) ? -0.3 : Math.sin(lt * 1.1) * 0.03); put(g, P.head); g.restore(); rivet(g, 90, -110, 3.6);
      leg(74, 0.4, false); leg(-66, Math.PI + 0.4, false);
      g.restore();
    }, o, R), o);
  };
  function craneParts(K) {
    return cached(`crane|${K.toFixed(3)}`, () => ({
      body: piece([-110, -190, 70, -110], K, (g) => { fill(g, 'ink', tongues([[-60, -140, -110, 50, 22, 1], [-56, -132, -130, 44, 20, -1]])); region(g, 'white', S([[-66, -150], [-24, -174], [30, -168], [52, -150], [32, -128], [-30, -122], [-72, -132]]), () => scaleCuts(g, -60, -168, 40, -128, 6), 1.8); }, 71),
      neck: piece([-10, -120, 60, 10], K, (g) => { ink(g, 9, (q) => { q.moveTo(0, 0); q.bezierCurveTo(30, -10, 10, -70, 36, -98); }); ink(g, 5, (q) => { q.moveTo(0, 0); q.bezierCurveTo(30, -10, 10, -70, 36, -98); }, 'white'); ink(g, 9, (q) => { q.moveTo(22, -50); q.bezierCurveTo(12, -70, 20, -88, 36, -98); }); region(g, 'white', El(40, -102, 11, 8), () => cut(g, Ci(44, -104, 1.8)), 1.4); region(g, 'red', Ci(36, -110, 4.5), null, 1); region(g, 'hide2', Pl([[48, -104], [80, -100], [48, -98]]), null, 1.1); }, 72),
      wing: piece([-160, -210, 70, 20], K, (g) => { const wg = S([[0, 0], [40, -40], [56, -120], [20, -186], [-40, -200], [-120, -180], [-80, -120], [-60, -60]]); region(g, 'white', wg, () => { for (let k = 0; k < 7; k++) taper(g, [[-10 - k * 12, -40 - k * 6], [-30 - k * 14, -120 - k * 6], [-36 - k * 14, -170]], 4); }, 1.8); fill(g, 'ink', tongues([[-60, -192, -100, 40, 18, 1], [-30, -192, -80, 34, 16, -1], [-90, -176, -110, 36, 16, 1]])); }, 73),
    }));
  }
  /** crane(x, y, o): a red-crowned crane — long life, immortals, a soul flying off. Standing with its feet on (x, y)
   *  or flying (o.fly) with (x, y) its body. ~o.size px tall (default 280). o: { fly (fn), face, at, out, lift } */
  B.crane = function (x, y, o = {}) {
    const size = o.size ?? 280, s = size / 280, R = 1.2, K = s * R, cw = 520 * s, ch = 520 * s;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - cw / 2, y: val(y, lt) - ch * 0.75 }), (g, lt) => {
      const P = craneParts(K), fly = val(o.fly, lt, false), ph = lt * Math.PI * 2 * 1.4;
      g.save(); g.translate(cw / 2, ch * 0.75); g.scale(s, s); if (val(o.face, lt, 'r') === 'l') g.scale(-1, 1); g.globalAlpha = 0.95;
      if (fly) { g.translate(0, 150); g.rotate(-0.12); }
      const wing = (far) => { g.save(); g.translate(-6, -156); g.rotate(fly ? (far ? -0.2 : 0) + Math.sin(ph) * 0.55 : 1.9); if (!fly) g.scale(0.6, 0.7); if (far) g.globalAlpha = 0.8; put(g, P.wing); g.restore(); };
      if (fly) wing(true);
      if (fly) ink(g, 2.4, (q) => { q.moveTo(-40, -128); q.lineTo(-150, -120); q.moveTo(-40, -126); q.lineTo(-150, -112); });
      else { const k = Math.sin(lt * 0.7) * 3; ink(g, 3, (q) => { q.moveTo(-8, -126); q.lineTo(-2, -60); q.lineTo(-10, 0); q.moveTo(6, -126); q.lineTo(14, -62); q.lineTo(10 + k, 0); }); ink(g, 2.2, (q) => { q.moveTo(-22, 0); q.lineTo(2, 0); q.moveTo(0 + k, 0); q.lineTo(26 + k, 0); }); }
      put(g, P.body);
      g.save(); g.translate(44, -150); if (fly) g.rotate(0.9); else g.rotate(Math.sin(lt * 0.9) * 0.05); put(g, P.neck); g.restore();
      wing(false);
      g.restore();
    }, o, R), o);
  };
  function dragonParts(c, trim, K) {
    return cached(`dragon|${c}|${trim}|${K.toFixed(3)}`, () => ({
      seg: piece([-30, -46, 30, 40], K, (g) => { fill(g, trim, tongues([[-14, -24, -10, 22, 13, 1], [10, -26, 10, 20, 12, -1]])); ink(g, 1.2, tongues([[-14, -24, -10, 22, 13, 1], [10, -26, 10, 20, 12, -1]])); region(g, c, S([[-28, -24], [28, -26], [30, 22], [-28, 24]]), () => scaleCuts(g, -30, -22, 30, 12, 6), 1.8); region(g, 'yellow', Pl([[-28, 14], [30, 12], [30, 24], [-28, 26]]), () => { for (let x = -24; x < 28; x += 8) cutLine(g, 1.4, (q) => { q.moveTo(x, 15); q.lineTo(x, 24); }); }, 1.2); }, 81),
      head: piece([-40, -100, 130, 60], K, (g) => {
        fill(g, trim, tongues([[-20, -10, -120, 40, 18, 1], [-16, -30, -80, 46, 18, -1], [-8, -40, -50, 40, 16, 1], [-24, 10, -150, 36, 16, -1]]));
        region(g, 'hide2', S([[20, -40], [10, -70], [-6, -96], [6, -90], [18, -70], [30, -84], [32, -66], [28, -44]]), null, 1.3);
        region(g, c, S([[-24, -30], [10, -44], [50, -40], [92, -30], [118, -18], [112, -4], [80, -2], [60, 6], [20, 22], [-20, 20]]), () => { cut(g, El(46, -24, 8, 4.4, 0.1)); scroll(g, 6, -12, 10, 0.3, 1.6); strata(g, 60, 110, (x) => -26 + (x - 60) * 0.14, 2, 6, 1.4); }, 2);
        region(g, c, S([[50, 10], [90, 6], [118, 18], [104, 28], [60, 26], [30, 24]]), () => cutLine(g, 1.3, (q) => { q.moveTo(60, 16); q.lineTo(104, 18); }), 1.6);
        region(g, 'white', Pl([[80, 0], [112, -4], [108, 8], [82, 8]]), () => { for (let x = 86; x < 110; x += 6) cutLine(g, 1, (q) => { q.moveTo(x, 0); q.lineTo(x, 6); }); }, 1);
        ink(g, 1.4, (q) => { q.moveTo(112, -14); q.bezierCurveTo(140, -40, 120, -70, 150, -84); q.moveTo(106, 22); q.bezierCurveTo(130, 40, 110, 60, 136, 76); });
      }, 82),
      leg: piece([-16, -10, 40, 70], K, (g) => { region(g, c, S([[-12, -6], [12, -6], [14, 40], [4, 52], [-10, 40]]), () => scaleCuts(g, -14, 0, 14, 40, 5), 1.5); fill(g, trim, tongues([[-8, 20, -120, 18, 9, 1]])); region(g, 'hide2', tongues([[4, 50, 150, 18, 7, 1], [8, 50, 120, 18, 7, 1], [10, 48, 90, 16, 7, 1]]), null, 1); }, 83),
      tail: piece([-80, -40, 10, 40], K, (g) => region(g, trim, tongues([[0, 0, -100, 60, 22, 1], [0, 0, -80, 56, 22, -1], [0, 0, -120, 50, 18, 1]]), null, 1.3), 84),
      pearl: piece([-40, -40, 40, 40], K, (g) => { fill(g, 'orange', tongues([[0, -8, 0, 30, 18, 1], [8, 0, 70, 26, 16, -1], [-8, 0, -70, 26, 16, 1]])); region(g, 'yellow', Ci(0, 4, 14), () => scroll(g, 0, 4, 8, 0, 1.3), 1.4); }, 85),
    }));
  }
  /** dragon(x, y, o): a long jointed dragon of riveted segments swimming in waves through the sky, its head at (x, y)
   *  facing right (o.face 'l' for left), ~o.length px long (default 900): emperors, rain and rivers, power, the
   *  heavens. o: { color ('green' | 'yellow' | 'red' | 'blue'), trim (fins and mane), wave (amplitude px, 60), pearl
   *  (true: the flaming pearl it chases), at, out, lift }. Move x/y with functions of lt to fly it across. */
  B.dragon = function (x, y, o = {}) {
    const len = o.length ?? 900, s = len / 900, R = 1.1, K = s * R, N = 18, cw = 1200 * s, ch = 520 * s, amp = o.wave ?? 60;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - (val(o.face, lt, 'r') === 'l' ? 260 * s : cw - 260 * s), y: val(y, lt) - ch / 2 }), (g, lt) => {
      const P = dragonParts(o.color || 'green', o.trim || 'red', K);
      g.save(); if (val(o.face, lt, 'r') === 'l') { g.translate(cw, 0); g.scale(-1, 1); } g.translate(cw - 260 * s, ch / 2); g.scale(s, s);
      g.globalAlpha = 0.94;
      const ptAt = (u) => [-u, (amp / s) * Math.sin(u * 0.009 - lt * 2.6) * Math.min(1, u / 120 + 0.25)];
      const segs = []; for (let i = 0; i < N; i++) { const u = 40 + i * 44, [px, py] = ptAt(u), [qx, qy] = ptAt(u + 10); segs.push([px, py, Math.atan2(py - qy, px - qx), 1 - i / N * 0.45]); }
      { const [tx, ty, ta] = segs[N - 1]; g.save(); g.translate(tx - 20, ty); g.rotate(ta); put(g, P.tail); g.restore(); }
      for (let i = N - 1; i >= 0; i--) {
        const [px, py, a, sc] = segs[i];
        if (i === 4 || i === 12) { g.save(); g.translate(px, py + 10); g.rotate(0.3 * Math.sin(lt * 2.6 + i)); put(g, P.leg); g.restore(); }
        g.save(); g.translate(px, py); g.rotate(a); g.scale(1, sc); put(g, P.seg); g.restore();
      }
      const [hx, hy, ha] = ptAt(0).concat([Math.atan2(ptAt(0)[1] - ptAt(12)[1], 12)]);
      g.save(); g.translate(hx, hy); g.rotate(ha * 0.8); put(g, P.head); g.restore();
      if (o.pearl) { g.save(); g.translate(230, Math.sin(lt * 2) * 20 - 20); g.rotate(lt * 0.8); put(g, P.pearl); g.restore(); }
      g.restore();
    }, o, R), o);
  };
  // ───────────────────────── scenery: carved set pieces ─────────────────────────
  // each: [box (units, origin at the foot centre unless noted), draw(g, o), anim?] — 1 unit = 1 px at the default size
  const roofPath = (x0, x1, y, hgt, flare) => S([[x0 - flare, y + 4], [x0 - flare * 0.6, y - 10], [x0 + 20, y - hgt * 0.7], [x0 + 60, y - hgt], [x1 - 60, y - hgt], [x1 - 20, y - hgt * 0.7], [x1 + flare * 0.6, y - 10], [x1 + flare, y + 4], [x1 + flare * 0.4, y + 2], [x1 - 10, y - 8], [x0 + 10, y - 8], [x0 - flare * 0.4, y + 2]]);
  function roof(g, x0, x1, y, hgt, flare, c) {
    const rp = roofPath(x0, x1, y, hgt, flare);
    region(g, c, rp, () => { scaleCuts(g, x0 - flare, y - hgt, x1 + flare, y - 8, 7); }, 2);
    region(g, 'ink', Pl([[x0 + 54, y - hgt - 10], [x1 - 54, y - hgt - 10], [x1 - 54, y - hgt + 2], [x0 + 54, y - hgt + 2]]), () => beadLine(g, x0 + 62, y - hgt - 4, x1 - 62, y - hgt - 4, 1.4, 8), 1.2);
    for (const [ex, d] of [[x0 + 54, -1], [x1 - 54, 1]]) fill(g, 'ink', tongues([[ex, y - hgt - 6, d * 20, 26, 14, d]]));
  }
  function hall(g, x0, x1, y0, y1, colC, wallC, n) {
    region(g, wallC, Pl([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), () => { const w = (x1 - x0) / n; for (let i = 0; i < n; i++) grid(g, x0 + i * w + 12, y1 + 16, x0 + (i + 1) * w - 12, y0 - 16, 11, 2.6); }, 1.6);
    for (let i = 0; i <= n; i++) { const cx = x0 + (x1 - x0) * i / n; region(g, colC, Pl([[cx - 8, y0], [cx + 8, y0], [cx + 8, y1], [cx - 8, y1]]), () => beadLine(g, cx, y1 + 10, cx, y0 - 10, 1.4, 14), 1.4); }
    region(g, 'green', Pl([[x0 - 14, y1 - 20], [x1 + 14, y1 - 20], [x1 + 14, y1], [x0 - 14, y1]]), () => meander(g, x0 - 8, y1 - 6, x1 + 8, 5, 1.2), 1.4);
  }
  const SCENES = {
    palace: [[-370, -470, 370, 6], (g, o) => {
      const rc = o.color || 'yellow';
      region(g, 'hide2', Pl([[-300, 0], [300, 0], [288, -40], [-288, -40]]), () => { meander(g, -280, -22, 280, 6, 1.4); for (let k = 0; k < 4; k++) cutLine(g, 2, (q) => { q.moveTo(-44, -8 - k * 9); q.lineTo(44, -8 - k * 9); }); }, 1.8);
      hall(g, -240, 240, -40, -236, 'red', 'yellow', 5);
      roof(g, -300, 300, -238, 66, 50, rc);
      hall(g, -150, 150, -300, -366, 'red', 'yellow', 3);
      roof(g, -200, 200, -366, 84, 46, rc);
    }],
    gate: [[-300, -430, 300, 6], (g, o) => {
      const wall = Pl([[-280, 0], [280, 0], [262, -210], [-262, -210]]), arch = S([[-56, 2], [-56, -110], [-40, -146], [0, -160], [40, -146], [56, -110], [56, 2]]);
      region(g, 'hide2', wall, () => { for (let r = 0; r < 9; r++) for (let x = -270 + (r % 2) * 22; x < 270; x += 44) cut(g, (q) => q.rect(x, -16 - r * 22, 36, 3.4)); }, 2);
      cut(g, arch); ink(g, 2, arch); ink(g, 4, (q) => { q.moveTo(-50, -118); q.quadraticCurveTo(0, -176, 50, -118); }, 'brown');
      for (let x = -262; x < 262; x += 36) region(g, 'hide2', Pl([[x, -210], [x + 22, -210], [x + 22, -228], [x, -228]]), null, 1.4);
      hall(g, -170, 170, -228, -320, 'red', 'yellow', 4);
      roof(g, -210, 210, -320, 90, 50, o.color || 'green');
      region(g, 'yellow', Pl([[-44, -264], [44, -264], [44, -232], [-44, -232]]), null, 1.6);
    }, null, (o) => o.name ? [o.name, 0, -248, 22] : null],
    wall: [[-480, -220, 480, 6], (g, o) => {
      region(g, 'hide2', Pl([[-470, 0], [470, 0], [470, -170], [-470, -170]]), () => { for (let r = 0; r < 7; r++) for (let x = -470 + (r % 2) * 24; x < 470; x += 48) cut(g, (q) => q.rect(x, -16 - r * 22, 40, 3.4)); }, 2);
      for (let x = -470; x < 470; x += 40) region(g, 'hide2', Pl([[x, -170], [x + 26, -170], [x + 26, -196], [x, -196]]), () => cut(g, (q) => q.rect(x + 10, -190, 6, 12)), 1.4);
    }],
    pavilion: [[-200, -400, 200, 6], (g, o) => {
      region(g, 'hide2', Pl([[-150, 0], [150, 0], [140, -30], [-140, -30]]), () => meander(g, -136, -14, 136, 5, 1.2), 1.6);
      region(g, 'red', Pl([[-120, -30], [120, -30], [120, -80], [-120, -80]]), () => lattice(g, -116, -76, 116, -34, 12, 2.4), 1.4);
      for (const x of [-100, 100]) region(g, 'red', Pl([[x - 8, -30], [x + 8, -30], [x + 8, -230], [x - 8, -230]]), null, 1.4);
      region(g, 'green', Pl([[-118, -230], [118, -230], [118, -250], [-118, -250]]), () => meander(g, -112, -236, 112, 4, 1), 1.3);
      const rp = S([[-190, -246], [-150, -262], [-60, -310], [0, -372], [60, -310], [150, -262], [190, -246], [140, -250], [0, -270], [-140, -250]]);
      region(g, o.color || 'green', rp, () => scaleCuts(g, -190, -372, 190, -250, 7), 2);
      region(g, 'yellow', S([[0, -372], [8, -384], [0, -398], [-8, -384]]), null, 1.3);
    }],
    house: [[-190, -300, 190, 6], (g, o) => {
      region(g, 'hide2', Pl([[-140, 0], [140, 0], [140, -150], [-140, -150]]), () => { cut(g, (q) => q.rect(-30, -110, 50, 110)); grid(g, 50, -110, 120, -60, 12, 2.6); for (let r = 0; r < 6; r++) cutLine(g, 1.4, (q) => { q.moveTo(-136, -20 - r * 22); q.lineTo(-40, -20 - r * 22); }); }, 2);
      ink(g, 3, (q) => { q.moveTo(-30, -110); q.lineTo(20, -110); q.moveTo(-6, -110); q.lineTo(-6, 0); }, 'brown');
      const rp = S([[-176, -140], [-150, -160], [-60, -250], [60, -250], [150, -160], [176, -140], [120, -146], [-120, -146]]);
      region(g, o.color || 'brown', rp, () => { for (let r = 0; r < 6; r++) strata(g, -170, 170, (x) => -150 - r * 16 + Math.abs(x) * 0.0, 1, 0, 2); scaleCuts(g, -150, -246, 150, -150, 8); }, 2);
    }],
    mountain: [[-380, -460, 380, 6], (g, o) => {
      const w = 360, hh = o.peak ?? 420;
      const ridge = (x) => -hh * Math.max(0.15, Math.exp(-Math.pow((x + 90) / 150, 2)) * 1 + Math.exp(-Math.pow((x - 170) / 110, 2)) * 0.62 + 0.12 * Math.exp(-Math.pow((x - 330) / 60, 2)));
      const pts = []; for (let x = -w; x <= w; x += 12) pts.push([x, ridge(x)]); pts.push([w, 0], [-w, 0]);
      region(g, o.color || 'green', Pl(pts), () => { strata(g, -w, w, (x) => ridge(x) + 6, 9, 30, 3.2); [[-90, -hh * 0.82], [170, -hh * 0.5], [-210, -hh * 0.3]].forEach(([x, y], i) => scroll(g, x, y, 16 - i * 2, i, 2, i % 2 ? -1 : 1)); for (let k = 0; k < 7; k++) coin(g, -300 + k * 100, -18, 6); }, 2.4);
    }],
    tree: [[-200, -460, 200, 6], (g, o) => {
      const type = o.type || 'pine';
      region(g, 'brown', S([[-18, 0], [-10, -120], [-24, -220], [-4, -300], [10, -240], [20, -140], [26, 0]]), () => { for (let k = 0; k < 8; k++) taper(g, [[-6 + (k % 2) * 8, -20 - k * 34], [0 + (k % 2) * 8, -40 - k * 34]], 4); }, 2);
      if (type === 'pine') { [[-90, -250, 110, 46], [60, -320, 120, 50], [-30, -400, 90, 40], [100, -200, 80, 36]].forEach(([cx, cy, rx, ry], i) => region(g, o.color || 'green', S([[cx - rx, cy + 10], [cx - rx * 0.7, cy - ry * 0.6], [cx, cy - ry], [cx + rx * 0.7, cy - ry * 0.6], [cx + rx, cy + 10], [cx, cy + ry * 0.4]]), () => { scaleCuts(g, cx - rx, cy - ry, cx + rx, cy + 8, 7); for (let k = -3; k <= 3; k++) taper(g, [[cx, cy + 6], [cx + k * rx * 0.26, cy - ry * 0.7 + Math.abs(k) * 6]], 3); }, 1.8)); }
      else if (type === 'plum') { ink(g, 7, (q) => { q.moveTo(0, -280); q.quadraticCurveTo(-80, -330, -160, -320); q.moveTo(4, -250); q.quadraticCurveTo(90, -300, 170, -360); q.moveTo(-60, -316); q.lineTo(-90, -400); }, 'ink'); [[-150, -322], [-110, -330], [-90, -396], [60, -296], [120, -334], [170, -360], [-30, -300], [90, -320]].forEach(([x, y], i) => region(g, i % 3 ? 'red' : 'orangeF', Ci(x, y, 14), () => plum(g, x, y, 6), 1.3)); }
      else { region(g, o.color || 'green', S([[-150, -300], [-100, -400], [0, -440], [110, -400], [160, -300], [100, -250], [-100, -250]]), () => { for (let k = 0; k < 14; k++) { const x = -130 + k * 20; taper(g, [[x, -380 + Math.abs(x) * 0.3], [x - 6, -300], [x - 10, -220]], 5); } }, 1.8); }
    }],
    cloud: [[-200, -90, 200, 50], (g, o) => {
      const c = S([[-180, 20], [-196, -10], [-160, -40], [-110, -30], [-90, -70], [-30, -84], [10, -60], [60, -80], [120, -60], [140, -26], [190, -20], [196, 10], [150, 30], [60, 26], [0, 36], [-80, 30]]);
      region(g, o.color || 'blue', c, () => { [[-150, -6, 20, 1], [-60, -40, 26, -1], [40, -36, 24, 1], [130, -10, 20, -1], [-10, 6, 14, 1]].forEach(([x, y, r, f]) => scroll(g, x, y, r, 0.4, 2.4, f)); }, 2);
    }],
    boat: [[-260, -340, 260, 40], (g, o) => {
      if (o.cargo === 'straw') for (let k = 0; k < 9; k++) { const x = -190 + k * 46; region(g, 'yellow', S([[x - 14, -40], [x - 18, -110], [x - 8, -140], [x + 8, -140], [x + 18, -110], [x + 14, -40]]), () => { for (let j = 0; j < 6; j++) taper(g, [[x - 10 + j * 4, -130], [x - 12 + j * 4.6, -44]], 2.4); }, 1.3); }
      ink(g, 6, (q) => { q.moveTo(-30, -40); q.lineTo(-30, -320); }, 'brown');
      region(g, 'hide', S([[-30, -310], [70, -300], [90, -200], [80, -90], [-30, -90]]), () => { for (let k = 1; k < 6; k++) cutLine(g, 2.4, (q) => { q.moveTo(-26, -310 + k * 38); q.lineTo(84 - Math.abs(k - 2) * 4, -300 + k * 40); }); }, 2);
      if (o.cargo !== 'straw') region(g, 'red', Pl([[60, -40], [180, -40], [180, -110], [60, -110]]), () => grid(g, 70, -100, 170, -50, 14, 2.6), 1.6);
      region(g, 'brown', S([[-250, -60], [-220, -40], [220, -40], [256, -70], [240, -20], [200, 20], [-200, 20], [-238, -20]]), () => { for (let r = 0; r < 3; r++) cutLine(g, 2, (q) => { q.moveTo(-214, -24 + r * 14); q.lineTo(214, -24 + r * 14); }); }, 2);
      region(g, 'yellow', Ci(210, -18, 10), () => cut(g, Ci(212, -18, 4)), 1.3);
      fill(g, 'red', Pl([[-30, -320], [30, -330], [-30, -300]]));
    }],
    bridge: [[-300, -170, 300, 6], (g, o) => {
      const b = S([[-290, 0], [-200, -60], [-80, -110], [80, -110], [200, -60], [290, 0], [150, 0], [90, -40], [0, -60], [-90, -40], [-150, 0]]);
      region(g, o.color || 'hide2', b, () => { for (let k = 0; k < 11; k++) { const a = Math.PI + k / 10 * Math.PI; cutLine(g, 2, (q) => { q.moveTo(Math.cos(a) * 150, Math.sin(a) * 60 * 1.0); q.lineTo(Math.cos(a) * 176, Math.sin(a) * 82); }); } }, 2);
      for (let x = -220; x <= 220; x += 55) { const y = -60 - 50 * Math.cos(x / 280 * Math.PI / 2); region(g, 'red', Pl([[x - 5, y], [x + 5, y], [x + 5, y - 40], [x - 5, y - 40]]), null, 1.2); }
      ink(g, 4, (q) => { for (let x = -230; x <= 230; x += 10) { const y = -96 - 50 * Math.cos(x / 280 * Math.PI / 2); x === -230 ? q.moveTo(x, y) : q.lineTo(x, y); } }, 'red');
    }],
    table: [[-200, -260, 200, 6], (g, o) => {
      region(g, 'brown', Pl([[-60, -150], [60, -150], [56, -250], [-56, -250]]), () => lattice(g, -52, -240, 52, -160, 14, 2.6), 1.6);
      region(g, 'brown', Pl([[-180, -130], [180, -130], [180, -146], [-180, -146]]), null, 1.6);
      region(g, o.color || 'red', Pl([[-170, -130], [170, -130], [160, 0], [-160, 0]]), () => { scroll(g, 0, -70, 30, 0.3, 3); scroll(g, -100, -70, 18, 2, 2.4, -1); scroll(g, 100, -70, 18, 1, 2.4, 1); }, 2);
      region(g, 'yellow', Pl([[-162, -26], [162, -26], [160, 0], [-160, 0]]), () => { for (let x = -150; x < 160; x += 22) coin(g, x, -13, 7); }, 1.6);
    }],
    tent: [[-220, -330, 220, 6], (g, o) => {
      const t = Pl([[-190, 0], [-150, -200], [0, -270], [150, -200], [190, 0]]);
      region(g, o.color || 'hide2', t, () => { cut(g, Pl([[-40, 0], [0, -150], [40, 0]])); for (let k = 0; k < 5; k++) cutLine(g, 2, (q) => { q.moveTo(-170 + k * 20, -40 - k * 30); q.lineTo(170 - k * 20, -40 - k * 30); }); }, 2);
      ink(g, 3, (q) => { q.moveTo(-40, 0); q.lineTo(0, -150); q.lineTo(40, 0); }, 'ink');
      ink(g, 4, (q) => { q.moveTo(0, -270); q.lineTo(0, -330); }, 'brown'); fill(g, 'red', Pl([[0, -330], [60, -316], [0, -296]]));
    }],
    drum: [[-140, -300, 140, 6], (g, o) => {
      ink(g, 6, (q) => { q.moveTo(-90, 0); q.lineTo(40, -150); q.moveTo(90, 0); q.lineTo(-40, -150); }, 'brown');
      region(g, o.color || 'red', El(0, -180, 110, 92), () => { cut(g, El(0, -180, 80, 66)); for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; cut(g, Ci(Math.cos(a) * 95, -180 + Math.sin(a) * 79, 3.6)); } }, 2);
      region(g, 'hide', El(0, -180, 80, 66), () => scroll(g, 0, -180, 34, 0, 3), 1.8);
    }],
    sun: [[-150, -150, 150, 150], (g, o) => {
      const n = 16, list = []; for (let k = 0; k < n; k++) list.push([Math.cos(k / n * Math.PI * 2) * 84, Math.sin(k / n * Math.PI * 2) * 84, k / n * 360 + 90, 46, 34, k % 2 ? 1 : -1]);
      region(g, o.color || 'yellow', tongues(list), null, 1.4);
      region(g, 'orange', Ci(0, 0, 90), () => { const pts = []; for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; pts.push([Math.cos(a) * 80, Math.sin(a) * 80]); } beads(g, pts, 3.4); }, 1.8);
      region(g, 'red', Ci(0, 0, 70), () => { scroll(g, -12, -6, 30, 0.2, 3, 1); scroll(g, 24, 22, 14, 2, 2.4, -1); }, 1.6);
    }, 'center'],
    moon: [[-120, -120, 120, 120], (g, o) => {
      const disc = Ci(0, 0, 100), bite = Ci(46, -24, 90), cres = o.phase === 'crescent';
      fill(g, o.color || 'hide', disc);
      within(g, disc, () => { cut(g, S([[-110, 10], [-60, -10], [-20, 6], [30, -14], [110, 0], [110, 30], [40, 18], [-20, 34], [-110, 40]])); scroll(g, -40, -40, 14, 0.3, 2); });
      if (cres) { cut(g, bite); within(g, (q) => { q.rect(-130, -130, 260, 260); q.arc(46, -24, 90, 0, Math.PI * 2); }, () => ink(g, 2, disc)); within(g, disc, () => ink(g, 2, bite)); }
      else ink(g, 2, disc);
    }, 'center'],
  };
  const SCCACHE = new Map();
  /** scenery(kind, x, y, o): a carved set piece pinned flat on the cloth, its foot on (x, y) (sun and moon: centred).
   *  Pierced leather glowing in the lamp: a place in two seconds. kind: 'palace' (two-eaved hall, tiles of crescent
   *  holes; o.color the roof dye, 'yellow' imperial), 'gate' (city gate tower; o.name a 2–4 character plaque),
   *  'wall' (city wall with crenels), 'pavilion', 'house', 'mountain' (strata cut along the ridge; o.peak height),
   *  'tree' (o.type 'pine' | 'willow' | 'plum'), 'cloud' (auspicious cloud — heaven, immortals; it drifts), 'boat'
   *  (o.cargo 'straw' loads straw bundles; it rocks), 'bridge', 'table' (the opera's one table, its cloth embroidered),
   *  'tent' (army camp), 'drum' (war drum), 'sun', 'moon' (o.phase 'full' | 'crescent'). o: { size (width px, default
   *  the kind's own: palace 740, gate 600, wall 960, mountain 760, tree 400, cloud 400, boat 520 …), color, at, out, lift,
   *  rock / drift (fn: px of sway; boats rock and clouds drift by default) } */
  B.scenery = function (kind, x, y, o = {}) {
    const d = SCENES[kind] || SCENES.house, [bx0, by0, bx1, by1] = d[0], nat = bx1 - bx0, sc = (o.size ?? nat) / nat, R = 1.0, centre = d[2] === 'center';
    const w = nat * sc + 20, hh = (by1 - by0) * sc + 20, ckey = `${kind}|${o.color}|${o.type}|${o.cargo}|${o.phase}|${o.peak}|${sc.toFixed(3)}`;
    if (!SCCACHE.has(ckey)) SCCACHE.set(ckey, piece([bx0, by0, bx1, by1], sc * R, (g) => d[1](g, o), 90 + kind.length));
    const pc = SCCACHE.get(ckey);
    const moving = kind === 'boat' || kind === 'cloud' || kind === 'sun' || o.rock != null || o.drift != null;
    const motion = (lt) => kind === 'boat' ? { r: val(o.rock, lt, Math.sin(lt * 1.3) * 0.025), dx: 0, dy: Math.sin(lt * 1.3 + 1) * 4 } : kind === 'cloud' ? { r: 0, dx: val(o.drift, lt, Math.sin(lt * 0.5) * 14), dy: Math.sin(lt * 0.8) * 4 } : kind === 'sun' ? { r: lt * 0.05, dx: 0, dy: 0 } : { r: 0, dx: val(o.drift, lt, 0), dy: 0 };
    const pad = moving ? 40 : 0;
    const el = mount(this, w + pad * 2, hh + pad * 2, (lt) => { const m = moving ? motion(lt) : { dx: 0, dy: 0 }; return { x: val(x, lt) + bx0 * sc - 10 - pad + m.dx + (centre ? 0 : 0), y: val(y, lt) + by0 * sc - 10 - pad + m.dy }; }, (g, lt) => {
      const m = moving ? motion(lt) : { r: 0 };
      g.save(); g.translate(pad + 10 - bx0 * sc, pad + 10 - by0 * sc); if (m.r) g.rotate(m.r); g.globalAlpha = 0.93; g.drawImage(pc.c, bx0 * sc, by0 * sc, nat * sc, (by1 - by0) * sc); g.restore();
    }, o, R, moving ? null : () => 0);
    if (d[3]) { const lab = d[3](o); if (lab) { const [str, lx, ly, sz] = lab; const t = h('div', 'sp-cut', esc(str), this.html); const fs = sz * sc; Object.assign(t.style, { left: '0px', top: '0px', width: 200 * sc + 'px', height: fs * 1.4 + 'px', fontSize: fs + 'px', color: '#3A1A08', textShadow: 'none', letterSpacing: '0.2em' });
      this.tick((lt) => { const life = lifeAt(o, lt); t.style.display = life ? '' : 'none'; if (!life) return; const L = val(x, lt) + lx * sc - 100 * sc, T = val(y, lt) + ly * sc - fs * 0.7; t.style.left = L + 'px'; t.style.top = T + 'px'; applyLife(t, life, lampAt(this.page, lt), L, T); }); } }
    return handle(el, o);
  };

  /** water(x0, x1, y, o): a strip of indigo water carved with rows of wave slits, its surface at y, from x0 to x1,
   *  flowing sideways — a river, the sea, a flood (raise y over time with a function: the water rises). o: { color
   *  ('blue'), depth (px below the surface, 110), speed (px/s, 40; negative flows left), at, out, lift } */
  B.water = function (x0, x1, y, o = {}) {
    const depth = o.depth ?? 110, w = x1 - x0, R = 1, key = `water|${o.color}|${w}|${depth}`;
    if (!SCCACHE.has(key)) SCCACHE.set(key, piece([0, -20, w + 120, depth], R, (g) => {
      const top = []; for (let x = 0; x <= w + 120; x += 10) top.push([x, Math.sin(x / 60 * Math.PI) * 8]); top.push([w + 120, depth], [0, depth]);
      region(g, o.color || 'blue', Pl(top), () => { waveCuts(g, -10, 14, w + 130, depth, 12, 2.2); }, 2);
    }, 97));
    const pc = SCCACHE.get(key), sp = o.speed ?? 40;
    return handle(mount(this, w, depth + 24, (lt) => ({ x: x0, y: val(y, lt) - 20 }), (g, lt) => {
      const off = ((lt * sp) % 120 + 120) % 120;
      g.save(); g.beginPath(); g.rect(0, 0, w, depth + 24); g.clip(); g.globalAlpha = 0.9; g.drawImage(pc.c, off - 120, 0, w + 120, depth + 20); g.restore();
    }, o, R), o);
  };

  /** fire(x, y, o): a carved fire piece on a rod, its base on (x, y): bands of hooked flame tongues (red → flame →
   *  ochre) swapped and shaken twelve times a second — a burning city, a battle, a beacon, the forge. o: { size (width
   *  px, 260), at, out, lift } */
  B.fire = function (x, y, o = {}) {
    const sz = o.size ?? 260, sc = sz / 260, R = 1, w = sz + 60, hh = 320 * sc + 40;
    const variants = [0, 1, 2].map((v) => cached(`fire|${v}|${sc.toFixed(3)}`, () => piece([-150, -320, 150, 10], sc * R, (g) => {
      const r = PV.rng(17 + v * 31), band = (n, hgt, wd, y0, c) => { const L = []; for (let k = 0; k < n; k++) { const x = -110 + (220 * (k + 0.5)) / n + (r() - 0.5) * 16; L.push([x, y0, (r() - 0.5) * 24, hgt * (0.7 + r() * 0.5), wd, k % 2 ? 1 : -1]); } region(g, c, tongues(L), null, 1.3); };
      band(5, 260, 80, 4, 'red'); band(6, 190, 60, 4, 'orange'); band(5, 110, 42, 4, 'yellow');
    }, 120 + v)));
    return handle(mount(this, w, hh, (lt) => ({ x: val(x, lt) - w / 2, y: val(y, lt) - hh + 20 }), (g, lt) => {
      const f = Math.floor(lt * 12), pc = variants[f % 3];
      g.save(); g.translate(w / 2 + (hash(f) - 0.5) * 6, hh - 20); g.rotate((hash(f + 9) - 0.5) * 0.05); g.globalAlpha = 0.92; g.drawImage(pc.c, -150 * sc, -320 * sc, 300 * sc, 330 * sc); g.restore();
    }, o, R, (lt) => Math.floor(lt * 12)), o);
  };

  /** ground(o): the narrow carved ground strip along the foot of the screen that every figure stands on (meander band,
   *  coin holes, tufts of grass). Put it first on a page with figures. o: { y (top of the strip, 846), color ('brown'),
   *  x0, x1, at, enter } */
  B.ground = function (o = {}) {
    const y = o.y ?? STAGE.area.y1 - 34, x0 = o.x0 ?? CLOTH.x0 - 20, x1 = o.x1 ?? CLOTH.x1 + 20, w = x1 - x0, key = `ground|${o.color}|${w}`;
    if (!SCCACHE.has(key)) SCCACHE.set(key, piece([0, -24, w, 44], 1, (g) => {
      const top = []; for (let x = 0; x <= w; x += 16) top.push([x, Math.sin(x * 0.013) * 4 + Math.sin(x * 0.047) * 2]); top.push([w, 40], [0, 40]);
      region(g, o.color || 'brown', Pl(top), () => { meander(g, 0, 32, w, 5, 1.6); for (let x = 30; x < w; x += 46) coin(g, x, 14, 4.2); }, 2);
      for (let x = 20; x < w; x += 90 + (x % 37)) fill(g, 'green', tongues([[x, 2, -20, 18, 8, 1], [x + 8, 2, 14, 16, 7, -1]]));
    }, 98));
    const pc = SCCACHE.get(key);
    return handle(mount(this, w, 70, () => ({ x: x0, y: y - 24 }), (g) => { g.globalAlpha = 0.95; g.drawImage(pc.c, 0, 0, w, 68); }, { enter: 'cut', ...o }, 1, () => 0), o);
  };
  // ───────────────────────── words: plaques with cut letters, the act board ─────────────────────────
  const PLCACHE = new Map();
  function plaquePiece(w, hh, c) {
    const key = `${w}|${hh}|${c}`;
    if (PLCACHE.has(key)) return PLCACHE.get(key);
    const r = Math.min(26, hh * 0.25), pc = piece([-8, -8, w + 8, hh + 8], 1.25, (g) => {
      const outer = (q) => { q.roundRect(0, 0, w, hh, r); };
      fill(g, 'soft', outer);
      const bw = Math.min(16, hh * 0.13);
      within(g, outer, () => { fill(g, c, (q) => { q.rect(-10, -10, w + 20, hh + 20); q.roundRect(bw, bw, w - bw * 2, hh - bw * 2, Math.max(4, r - bw)); }); meander(g, 6, bw * 0.78, w - 6, bw * 0.32, 1.2); meander(g, 6, hh - bw * 0.22, w - 6, bw * 0.32, 1.2); });
      fill(g, '#2A1408', (q) => q.roundRect(bw + 3, bw + 3, w - bw * 2 - 6, hh - bw * 2 - 6, Math.max(3, r - bw - 3)));
      for (const [cx, cy] of [[bw * 0.9, bw * 0.9], [w - bw * 0.9, bw * 0.9], [bw * 0.9, hh - bw * 0.9], [w - bw * 0.9, hh - bw * 0.9]]) region(g, 'green', Ci(cx, cy, bw * 1.25), () => scroll(g, cx, cy, bw * 0.8, 0.4, 1.2), 1.2);
      ink(g, 2, outer);
    }, 131);
    PLCACHE.set(key, pc);
    return pc;
  }
  /** plaque(text, x, y, o): a dark leather plaque carried on two rods, centred on (x, y), its words cut out of the hide
   *  so they glow with the lamp — the name of a person or a place, the key term of the page, a date, a number. Short:
   *  2–8 汉字 or 1–4 English words. Pressed onto the cloth at `at`, lifted off at `out`. text may be a function of lt
   *  (a counting number: lt => Math.round(…) + ' 支'). o: { size (letter px, 64), sub (a smaller second line),
   *  vertical (a column of characters, for a name or a line of verse), color (border dye, 'red'), w (plate width px),
   *  rods (true), at, out, lift } */
  B.plaque = function (text, x, y, o = {}) {
    const size = o.size ?? 64, vt = !!o.vertical, sub = o.sub, samples = [val(text, 0, ''), val(text, 1e4, '')].map(String);
    const chars = Math.max(...samples.map((s) => [...s].length));
    const tw = Math.max(...samples.map((s) => PV.tw(s, size)), sub ? PV.tw(sub, size * 0.42) * 1.35 : 0);
    const w = Math.round(vt ? size * 1.9 : o.w ?? tw * 1.1 + size * 1.5), hh = Math.round(vt ? chars * size * 1.16 + size * 1.3 : size * (sub ? 2.15 : 1.55) + size * 0.4);
    const wrap = h('div', 'sp-wrap', null, this.html), RODS = o.rods !== false ? 240 : 0;
    Object.assign(wrap.style, { width: w + 'px', height: hh + RODS + 'px' });
    const cv = h('canvas', null, null, wrap); cv.width = Math.ceil((w + 16) * 1.25); cv.height = Math.ceil((hh + 16 + RODS) * 1.25);
    Object.assign(cv.style, { position: 'absolute', left: '-8px', top: '-8px', width: w + 16 + 'px', height: hh + 16 + RODS + 'px' });
    const g = cv.getContext('2d'), pc = plaquePiece(w, hh, o.color || 'red');
    g.scale(1.25, 1.25); g.translate(8, 8);
    if (RODS) { rod(g, w * 0.26, hh - 6, -0.12, RODS, 2.4); rod(g, w * 0.74, hh - 6, 0.12, RODS, 2.4); }
    g.drawImage(pc.c, pc.x0, pc.y0, pc.w, pc.h);
    const t = h('div', 'sp-cut' + (vt ? ' vt' : ''), null, wrap);
    Object.assign(t.style, { left: '0px', top: '0px', width: w + 'px', height: hh + 'px', fontSize: size + 'px', flexDirection: 'column' });
    const setText = (s) => { t.innerHTML = esc(s) + (sub && !vt ? `<span class="sub">${esc(sub)}</span>` : ''); };
    let lastS = null;
    const page = this.page;
    this.tick((lt) => {
      const life = lifeAt(o, lt);
      if (!life) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      const L = val(x, lt) - w / 2, T = val(y, lt) - hh / 2;
      wrap.style.left = L.toFixed(1) + 'px'; wrap.style.top = T.toFixed(1) + 'px';
      applyLife(wrap, life, lampAt(page, lt), L, T);
      wrap.style.rotate = (0.25 * vn(lt * 1.2, 21)).toFixed(3) + 'deg';
      const s = String(val(text, lt, '')); if (s !== lastS) { lastS = s; setText(s); }
    });
    setText(samples[1]);
    return handle(wrap, o);
  };

  /** hand(x, y, o): the puppeteer's hand far behind the screen — a huge soft dark shadow of a hand gripping a rod whose
   *  tip touches (x, y). Who really moves the figures: the hidden force behind an event (an empress behind a boy
   *  emperor, the market, fate). o: { from ('below' | 'left' | 'right'), size (1), at, out, lift } */
  B.hand = function (x, y, o = {}) {
    const sc = o.size ?? 1, from = o.from || 'below', cw = 900 * sc, ch = 900 * sc;
    const ang = from === 'left' ? -Math.PI / 2 + 0.5 : from === 'right' ? Math.PI / 2 - 0.5 : 0.25;
    return handle(mount(this, cw, ch, (lt) => ({ x: val(x, lt) - cw / 2, y: val(y, lt) - ch / 2 }), (g, lt) => {
      g.save(); g.translate(cw / 2, ch / 2);
      const dx = Math.sin(ang), dy = Math.cos(ang), L = 380 * sc, hx = dx * L + 6 * vn(lt * 0.9, 4), hy = dy * L + 6 * vn(lt * 0.8, 6);
      g.strokeStyle = 'rgba(26,16,10,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(hx, hy); g.stroke();
      g.filter = `blur(${(16 * sc).toFixed(1)}px)`; g.fillStyle = 'rgba(40,22,10,0.62)';
      g.translate(hx, hy); g.rotate(-ang); g.scale(sc, sc);
      g.beginPath(); smooth(g, [[-56, -30], [-30, -62], [10, -66], [44, -48], [60, -16], [58, 30], [40, 60], [46, 200], [60, 460], [-80, 460], [-60, 200], [-58, 60], [-70, 20]]); g.fill();
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(-44 + k * 26, -58 + Math.abs(k - 1.5) * 6, 15, 22, 0, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }, o, 0.6), o);
  };

  // the page title: gold letters carved into the lacquered lintel above the screen (outside the cloth, so pages keep
  // the whole screen for the play). Long English titles shrink to fit.
  B.title = function (str, o = {}) {
    fresh();
    const T = this.hud || this, at = o.at ?? 0.1, frame = document.getElementById('frame'), s = String(str);
    const latin = !/[㐀-鿿]/.test(s);
    const el = h('div', 'sp-lintel' + (latin ? ' latin' : ''), esc(s) + (o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''), frame || T.html);
    const base = o.size ?? (latin ? 46 : 50), need = PV.tw(s, base) * (latin ? 1.12 : 1.25) + (o.sub ? PV.tw(o.sub, base * 0.5) * 1.4 + 28 : 0);
    el.style.fontSize = Math.max(28, Math.min(base, base * (W - 380) / need)).toFixed(1) + 'px';
    el.style.display = 'none';
    ghost(T, s + (o.sub || ''));
    const ent = { el, id: this.page.id, k: (lt) => ss(at, at + 0.7, lt) * (o.out != null ? 1 - ss(o.out, o.out + 0.5, lt) : 1) };
    REG.titles.push(ent);
    return { el, spans: [el], a: { dur: 0.7 }, hide(t) { o.out = t; return this; } };
  };
})();
