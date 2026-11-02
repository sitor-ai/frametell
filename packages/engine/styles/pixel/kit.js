/* Pixel game · kit: an 8-bit console world for explainers. One call, P.pixel((g, lt) => …), gives the page a 320×180
 * logical-pixel canvas (1 logical pixel = 6 screen pixels, nearest-neighbour, so every pixel stays a crisp square), and
 * `g` paints on it: dithered skies, parallax hills and clouds, tile levels, outlined sprites (a robot hero, bugs, coins,
 * gems, hearts, stars, chests, ? blocks, chips), pipes, flags, doors, pixel type, a HUD, console text boxes, bursts, score
 * pops and screen wipes. Everything is a pure function of lt; sprites animate on stepped time (g.step) like real
 * console frames. Sprite and tile ideas adapted from huashu-art-motion's 8-bit recipe (MIT, see NOTICE.md). */
(function () {
  const { col, clamp, lerp, ease, h, Builder } = PV;
  const B = Builder.prototype;
  const U = 6, W = STAGE.w / U, H = STAGE.h / U;   // one logical pixel = 6 screen pixels; the stage is 320×180 logical pixels (180×320 in portrait)

  // ── palette: sprite characters → colours (a 25-colour console set)
  const PAL = {
    k: '#0F0F1B', w: '#FCFCFC', e: '#BCBCBC', E: '#7C7C7C', D: '#3C3C3C',
    r: '#F83800', R: '#A81000', o: '#FCA044', y: '#F8D878', Y: '#F8B800',
    g: '#58D854', G: '#00A800', h: '#005800', c: '#3CBCFC', b: '#0078F8', B: '#0000BC',
    p: '#F878F8', P: '#6844FC', s: '#FCBCB0', S: '#E45C10', n: '#AC7C00', N: '#503000',
    t: '#00E8D8', T: '#008888', v: '#B87CFC', V: '#4428BC',
  };
  /** a colour: a sprite character (k w e E D r R o y Y g G h c b B p P s S n N t T v V), a palette name (ink, blue, redF…) or a hex */
  const cc = (c) => (c == null ? PAL.k : PAL[c] || col(c));

  const off = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; };
  const R = Math.round;

  // ── sprites (string art; '.' is transparent). Characters and items are drawn anchored bottom-centre.
  const HEAD = ['.....kk.....', '....krrk....', '.....kk.....', '..kkkkkkkk..', '.kwwwwwwwwk.', '.kwkkkkkkek.', '.kwkckkckek.', '.kwkckkckek.', '.kwkkkkkkek.', '.kweeeeeeek.', '..kkkkkkkk..'];
  const BLINK = ['.....kk.....', '....krrk....', '.....kk.....', '..kkkkkkkk..', '.kwwwwwwwwk.', '.kwkkkkkkek.', '.kwkkkkkkek.', '.kwkckkckek.', '.kwkkkkkkek.', '.kweeeeeeek.', '..kkkkkkkk..'];
  const BODY = ['.kkttttttkk.', 'kektwrrwtkek', 'kektttttTkek'];
  const SPR = {
    'hero.idle': HEAD.concat(BODY, ['...kDkkDk...', '..kkkkkkkk..']),
    'hero.blink': BLINK.concat(BODY, ['...kDkkDk...', '..kkkkkkkk..']),
    'hero.walk1': HEAD.concat(BODY, ['..kDk..kDk..', '.kkk....kkk.']),
    'hero.walk2': HEAD.concat(BODY, ['....kDDk....', '...kkkkkk...']),
    'hero.jump': HEAD.concat(['kek.kttk.kek', '.kktwrrwtkk.', '..ktttttTk..', '..kDk..kDk..', '..kk....kk..']),
    'hero.win': ['ke...kk...ek', 'kek.krrk.kek', '.kk..kk..kk.', '.kkkkkkkkkk.', '.kwwwwwwwwk.', '.kwkkkkkkek.', '.kwkckkckek.', '.kwkkkkkkek.', '.kwkcccckek.', '.kweeeeeeek.', '..kkkkkkkk..', '..kttttttk..', '..ktwrrwtk..', '..kttttttk..', '...kDkkDk...', '..kkkkkkkk..'],
    'hero.hurt': HEAD.slice(0, 5).concat(['.kwkkkkkkek.', '.kwkrkkrkek.', '.kwkkrrkkek.', '.kwkrkkrkek.', '.kweeeeeeek.', '..kkkkkkkk..'], BODY, ['...kDkkDk...', '..kkkkkkkk..']),
    'bug.1': ['..k......k..', '...k....k...', '..kkkkkkkk..', '.krrwrrrwrk.', 'krrrrrrrrrrk', 'krwkrrrrkwrk', 'krkkrrrrkkrk', '.kkkkkkkkkk.', '.k.k.kk.k.k.', 'k.k......k.k'],
    'bug.2': ['...k....k...', '...k....k...', '..kkkkkkkk..', '.krrwrrrwrk.', 'krrrrrrrrrrk', 'krwkrrrrkwrk', 'krkkrrrrkkrk', '.kkkkkkkkkk.', '..k.k..k.k..', '.k.k....k.k.'],
    'coin.1': ['..kkkk..', '.kyyyYk.', 'kyywyyYk', 'kyywyyYk', 'kyywyyYk', 'kyyyyyYk', '.kyyyYk.', '..kkkk..'],
    'coin.2': ['...kk...', '..kyYk..', '.kywyYk.', '.kywyYk.', '.kywyYk.', '.kyyyYk.', '..kyYk..', '...kk...'],
    'coin.3': ['...kk...', '...kYk..', '...kYk..', '...kYk..', '...kYk..', '...kYk..', '...kYk..', '...kk...'],
    'heart': ['.kk.kk.', 'krwkrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'],
    'heart.empty': ['.kk.kk.', 'kDDkDDk', 'kDDDDDk', '.kDDDk.', '..kDk..', '...k...'],
    'star': ['....k....', '...kyk...', 'kkkyyykkk', '.kyyyyyk.', '..kykyk..', '..kyyyk..', '.kyykyyk.', '.kyk.kyk.', '.kk...kk.'],
    'gem': ['..kkkkk..', '.kwccbbk.', 'kwccccbbk', 'kkkkkkkkk', '.kccccbk.', '..kccbk..', '...kbk...', '....k....'],
    'chest': ['.kkkkkkkkkkkk.', 'knnnnnnnnnnnnk', 'knNNNNNNNNNNnk', 'kkkkkkkkkkkkkk', 'knnnnkYYknnnnk', 'knnnnkYYknnnnk', 'knNNNNkkNNNNnk', 'knnnnnnnnnnnnk', 'knNNNNNNNNNNnk', 'kkkkkkkkkkkkkk'],
    'key': ['.kkk.......', 'kYyYk......', 'kY.Ykkkkkkk', 'kYyYYYYYYYk', '.kkk.kYk.Yk', '.....kk..k.'],
    'ghost': ['...kkkk...', '..kwwwwk..', '.kwwwwwwk.', '.kwkwwkwk.', 'kwwkwwkwwk', 'kwwwwwwwwk', 'kwwwppwwwk', 'kwwwwwwwwk', 'kwkwwkwwkk', 'kk.kk.kk..'],
    'arrow': ['...k....', '...kk...', 'kkkkwk..', 'kwwwwwk.', 'kwwwwwwk', 'kwwwwwk.', 'kkkkwk..', '...kk...', '...k....'],
    'qblock': ['kkkkkkkkkkkkkkkk', 'kyyyyyyyyyyyyynk', 'kyNYYYYYYYYYYNnk', 'kyYYYYwwwwYYYYnk', 'kyYYYwwnnwwYYYnk', 'kyYYYwwnYwwnYYnk', 'kyYYYYnnYwwnYYnk', 'kyYYYYYYwwnnYYnk', 'kyYYYYYwwnnYYYnk', 'kyYYYYYwwnYYYYnk', 'kyYYYYYYnnYYYYnk', 'kyYYYYYwwYYYYYnk', 'kyYYYYYwwnYYYYnk', 'kyNYYYYYnnYYYNnk', 'knnnnnnnnnnnnnnk', 'kkkkkkkkkkkkkkkk'],
    'used': ['kkkkkkkkkkkkkkkk', 'kSnnnnnnnnnnnnNk', 'knkNNNNNNNNNNkNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knNNNNNNNNNNNNNk', 'knkNNNNNNNNNNkNk', 'kNNNNNNNNNNNNNNk', 'kkkkkkkkkkkkkkkk'],
  };
  const sprCache = new Map();
  /** compile a string-art map to a canvas (optionally recoloured: { r: 'b' } swaps red for blue) */
  function compile(map, swap) {
    const key = map.join('|') + JSON.stringify(swap || {});
    let c = sprCache.get(key);
    if (c) return c;
    const hh = map.length, w = Math.max(...map.map((r) => r.length));
    c = off(w, hh);
    const x = c.getContext('2d');
    map.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '.' || ch === ' ') return; const k = swap && swap[ch] ? swap[ch] : ch; x.fillStyle = cc(k); x.fillRect(i, j, 1, 1); }));
    sprCache.set(key, c);
    return c;
  }

  // ── pixel type: the console font rasterised at its native size and thresholded, so letters are solid pixel blocks
  const txtCache = new Map();
  function glyphs(str, size) {
    const font = size >= 16 ? `${size}px "DotGothic16", "Press Start 2P", sans-serif` : `${size}px "Press Start 2P", "DotGothic16", monospace`;
    const key = font + '|' + str;
    let c = txtCache.get(key);
    if (c) return c;
    const m = off(1, 1).getContext('2d');
    m.font = font;
    const w = Math.max(1, Math.ceil(m.measureText(str).width)), hh = Math.ceil(size * 1.25);
    c = off(w, hh);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = font; x.textBaseline = 'top'; x.fillStyle = '#fff';
    x.fillText(str, 0, Math.round(size * 0.1));
    const img = x.getImageData(0, 0, w, hh), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    x.putImageData(img, 0, 0);
    const ok = document.fonts ? document.fonts.check(font, str) : true;
    if (ok) txtCache.set(key, c);   // a fallback face is drawn but not kept: the real one replaces it once loaded
    return c;
  }
  const tintCache = new Map();
  function tinted(src, color) {
    const key = color;
    let byColor = tintCache.get(src);
    if (!byColor) { byColor = new Map(); tintCache.set(src, byColor); }
    let c = byColor.get(key);
    if (c) return c;
    c = off(src.width, src.height);
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    byColor.set(key, c);
    return c;
  }

  // ── skies (cached per kind): stepped bands with checkerboard dither between them, the way an 8-bit console blends
  const SKIES = {
    day: ['#3C7CFC', '#5C94FC', '#7CB4FC', '#A4E4FC'],
    dusk: ['#24186C', '#6844FC', '#D85898', '#FC7460', '#FCA044'],
    night: ['#0C0C2C', '#16124A', '#24186C', '#3A1E7C'],
    sunset: ['#3A1E7C', '#A81000', '#F83800', '#FCA044', '#F8D878'],
    cave: ['#140C08', '#201410', '#2C1C14'],
    sea: ['#0C2C5C', '#0058A8', '#0078F8', '#3CBCFC'],
  };
  const skyCache = new Map();
  function skyCanvas(kind, m) {
    const key = kind + m;
    let c = skyCache.get(key);
    if (c) return c;
    const w = W + 2 * m, hh = H + 2 * m;
    c = off(w, hh);
    const x = c.getContext('2d');
    if (kind === 'circuit') {
      x.fillStyle = '#06301A'; x.fillRect(0, 0, w, hh);
      x.fillStyle = '#0A3C22';
      for (let j = 0; j < hh; j += 8) for (let i = (j / 8) % 2 ? 4 : 0; i < w; i += 8) x.fillRect(i, j, 1, 1);
      const rnd = PV.rng(4242);
      for (let n = 0; n < 46; n++) {   // copper traces: right-angle walks ending in pads
        let px = R(rnd() * w), py = R(rnd() * hh);
        x.fillStyle = rnd() < 0.5 ? '#1F6B3A' : '#2E7D45';
        for (let s = 0; s < 5; s++) {
          const horiz = s % 2 === 0, len = R(8 + rnd() * 34) * (rnd() < 0.5 ? -1 : 1);
          if (horiz) { x.fillRect(Math.min(px, px + len), py, Math.abs(len) + 1, 1); px += len; } else { x.fillRect(px, Math.min(py, py + len), 1, Math.abs(len) + 1); py += len; }
        }
        x.fillStyle = '#B88A3C'; x.fillRect(px - 1, py - 1, 3, 3); x.fillStyle = '#06301A'; x.fillRect(px, py, 1, 1);
      }
    } else {
      const bands = SKIES[kind] || SKIES.night;
      const bh = hh / bands.length;
      for (let j = 0; j < hh; j++) {
        const f = j / bh, i = Math.min(bands.length - 1, Math.floor(f)), frac = f - i;
        for (let ii = 0; ii < w; ii++) {
          // the last 18% of each band dithers into the next one: 50% checkerboard, then 25%
          let k = i;
          if (i < bands.length - 1 && frac > 0.82) k = (ii + j) % 2 === 0 ? i + 1 : i;
          else if (i < bands.length - 1 && frac > 0.7) k = (ii % 2 === 0 && j % 2 === 0) ? i + 1 : i;
          x.fillStyle = bands[k]; x.fillRect(ii, j, 1, 1);
        }
      }
      if (kind === 'night' || kind === 'dusk') {
        const rnd = PV.rng(77);
        for (let n = 0; n < (kind === 'night' ? 60 : 24); n++) { x.fillStyle = rnd() < 0.2 ? '#FCFCFC' : '#8C8CD4'; x.fillRect(R(rnd() * w), R(rnd() * hh * 0.6), 1, 1); }
      }
      if (kind === 'cave') {
        const rnd = PV.rng(31);
        for (let n = 0; n < 140; n++) { x.fillStyle = rnd() < 0.5 ? '#3A2618' : '#0A0604'; x.fillRect(R(rnd() * w), R(rnd() * hh), 2, 1); }
      }
    }
    skyCache.set(key, c);
    return c;
  }

  // integer disc, for clouds, bushes and hills
  function disc(x, cx, cy, r, color) {
    x.fillStyle = color;
    for (let j = -r; j <= r; j++) { const hw = Math.floor(Math.sqrt(r * r - j * j + r * 0.8)); x.fillRect(R(cx - hw), R(cy + j), hw * 2 + 1, 1); }
  }
  /** a lumpy shape from discs [[dx, dy, r]…], outlined 1px: body colour + a lower shade + a top-left highlight */
  function blob(x, ox, oy, parts, fill, shade, hi, outline = PAL.k) {
    for (const [dx, dy, r] of parts) disc(x, ox + dx, oy + dy, r + 1, outline);
    for (const [dx, dy, r] of parts) disc(x, ox + dx, oy + dy, r, fill);
    if (shade) for (const [dx, dy, r] of parts) { x.save(); x.beginPath(); x.rect(ox + dx - r - 1, oy + dy + Math.ceil(r * 0.35), 2 * r + 3, r + 2); x.clip(); disc(x, ox + dx, oy + dy, r, shade); x.restore(); }
    if (shade) for (const [dx, dy, r] of parts) disc(x, ox + dx, oy + dy - 1, Math.max(1, r - 2), fill);
    if (hi) for (const [dx, dy, r] of parts) if (r > 3) { x.fillStyle = hi; x.fillRect(ox + dx - Math.floor(r * 0.5), oy + dy - Math.floor(r * 0.55), 2, 1); }
  }

  // ── the painter handed to the page
  function painter(ctx, m) {
    const g = { ctx, cx: 0, lt: 0, W, H };
    const base = () => ctx.setTransform(1, 0, 0, 1, m - R(g.cx), m);
    const fixed = (fn) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, m, m); fn(); ctx.restore(); };
    const par = (p, fn) => { ctx.save(); ctx.translate(R(g.cx * (1 - p)), 0); fn(); ctx.restore(); };

    /** step(lt, fps = 12): time snapped to console frames — feed sprite poses and bobbing through it */
    g.step = (lt, fps = 12) => Math.floor(lt * fps) / fps;
    /** view(x): scroll the level so world x sits at the left edge (tiles, sprites and text follow; sky, hud, wipes stay) */
    g.view = (x) => { g.cx = x; base(); };
    /** rect(x, y, w, h, color) / px(x, y, color): raw pixels, in logical units */
    g.rect = (x, y, w, hh, color) => { ctx.fillStyle = cc(color); ctx.fillRect(R(x), R(y), R(w), R(hh)); };
    g.px = (x, y, color) => g.rect(x, y, 1, 1, color);
    /** line(x0, y0, x1, y1, color, w = 1): a Bresenham line of square pixels */
    g.line = (x0, y0, x1, y1, color, w = 1) => {
      x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy; ctx.fillStyle = cc(color);
      for (let n = 0; n < 2000; n++) { ctx.fillRect(x0 - (w >> 1), y0 - (w >> 1), w, w); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    };
    /** path(points, color, { k = 1, w = 1, dash }) → [x, y] of the head: a right-angle or free polyline drawn up to fraction k (a signal running along a wire) */
    g.path = (pts, color, o = {}) => {
      const segs = []; let total = 0;
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
      let left = clamp(o.k ?? 1) * total, head = pts[0];
      for (let i = 1; i < pts.length && left > 0; i++) {
        const k = Math.min(1, left / segs[i - 1]), a = pts[i - 1], b = pts[i];
        head = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
        g.line(a[0], a[1], head[0], head[1], color, o.w || 1);
        left -= segs[i - 1];
      }
      return head;
    };

    /** sky(kind = 'night'): fill the frame — 'day' | 'dusk' | 'night' | 'sunset' | 'cave' | 'sea' | 'circuit' (a green circuit board with copper traces: inside a computer) */
    g.sky = (kind = 'night') => fixed(() => ctx.drawImage(skyCanvas(kind, m), -m, -m));
    /** clouds(y, { par = 0.3, n = 5, color = 'w', shade = 'e', drift = 0 }): a row of pixel clouds; drift = logical px/s of wind (use g.step time) */
    g.clouds = (y, o = {}) => {
      const p = o.par ?? 0.3;
      par(p, () => {
        const n = o.n ?? 5, span = W + 120, drift = (o.drift ?? 0) * g.step(g.lt, 6);
        for (let i = 0; i < n; i++) {
          const sx = ((((i * span) / n + drift - g.cx * p) % span) + span) % span - 60;   // screen x, wrapping
          blob(ctx, R(sx + g.cx * p), R(y + ((i * 7) % 3) * 6), [[-8, 2, 5], [0, -1, 7], [9, 2, 5]], cc(o.color || 'w'), cc(o.shade || 'e'), null, cc('k'));
        }
      });
    };
    /** hills(y, { par = 0.5, color = 'G', shade = 'h', big = 34 }): rolling pixel hills along the horizon (repeat across the level) */
    g.hills = (y, o = {}) => par(o.par ?? 0.5, () => {
      const r = o.big ?? 34, step = r * 3.2, start = Math.floor((g.cx * (o.par ?? 0.5) - 2 * r) / step) * step;
      for (let x = start; x < g.cx * (o.par ?? 0.5) + W + 2 * r; x += step) {
        const sx = x;
        blob(ctx, R(sx), R(y + r * 0.35), [[0, 0, r]], cc(o.color || 'G'), cc(o.shade || 'h'), null, cc('k'));
        blob(ctx, R(sx + step * 0.5), R(y + r * 0.6), [[0, 0, R(r * 0.62)]], cc(o.color || 'G'), cc(o.shade || 'h'), null, cc('k'));
      }
    });
    /** mountains(y, { par = 0.2, color = 'V', snow = 'w' }): far stepped mountains (pixel triangles) behind the hills */
    g.mountains = (y, o = {}) => par(o.par ?? 0.2, () => {
      const p = o.par ?? 0.2, step = 70, start = Math.floor((g.cx * p - 80) / step) * step;
      for (let x = start; x < g.cx * p + W + 80; x += step) {
        const sx = x, hgt = 40 + ((Math.abs(x) / step) % 3) * 12;
        for (let j = 0; j < hgt; j++) { ctx.fillStyle = cc(j < 6 && o.snow !== null ? (o.snow || 'w') : o.color || 'V'); ctx.fillRect(R(sx - j), R(y - hgt + j), j * 2 + 1, 1); }
      }
    });
    /** bush(x, y, w = 1): a green bush sitting on y (w = 1..3 lumps) */
    g.bush = (x, y, w = 1) => { const parts = []; for (let i = 0; i < w; i++) parts.push([i * 10 - (w - 1) * 5, -5, 6]); blob(ctx, R(x), R(y), parts, cc('g'), cc('G'), cc('w')); };

    /** ground(y, kind = 'grass', { from, to }): fill the floor from y to the bottom with 16px tiles — 'grass' | 'brick' | 'stone' | 'circuit' | 'cloud'. Default spans the whole view */
    g.ground = (y, kind = 'grass', o = {}) => {
      const from = o.from ?? Math.floor((g.cx - m) / 16) * 16, to = o.to ?? g.cx + W + m;
      for (let x = from; x < to; x += 16) for (let yy = y; yy < H + m; yy += 16) g.tile(x, yy, kind, yy === y);
    };
    /** tile(x, y, kind, top): one 16×16 tile (see ground); top=true draws the surface row */
    g.tile = (x, y, kind = 'grass', top = true) => {
      x = R(x); y = R(y);
      const f = (dx, dy, w, hh, c) => { ctx.fillStyle = cc(c); ctx.fillRect(x + dx, y + dy, w, hh); };
      if (kind === 'brick' || kind === 'block') {
        f(0, 0, 16, 16, 'S'); f(0, 0, 16, 1, 'o'); f(0, 7, 16, 1, 'k'); f(0, 15, 16, 1, 'k');
        f(7, 0, 1, 7, 'k'); f(3, 8, 1, 7, 'k'); f(11, 8, 1, 7, 'k'); f(0, 8, 16, 1, 'o'); f(8, 1, 1, 6, 'o'); f(4, 9, 1, 6, 'o'); f(12, 9, 1, 6, 'o');
      } else if (kind === 'stone') {
        f(0, 0, 16, 16, 'E'); f(0, 0, 16, 1, 'e'); f(0, 0, 1, 16, 'e'); f(15, 0, 1, 16, 'D'); f(0, 15, 16, 1, 'D'); f(5, 5, 2, 1, 'D'); f(10, 10, 2, 1, 'D');
      } else if (kind === 'circuit') {
        f(0, 0, 16, 16, '#0B4A2A'); f(0, 0, 16, 1, '#2E9A55'); f(0, 15, 16, 1, '#052814'); f(3, 6, 10, 1, '#B88A3C'); f(12, 6, 1, 6, '#B88A3C'); f(2, 5, 3, 3, '#E8C060'); f(3, 6, 1, 1, '#0B4A2A');
        if (top) { f(0, 0, 16, 2, '#2E9A55'); f(0, 0, 16, 1, '#7CE89C'); }
      } else if (kind === 'cloud') {
        f(0, 0, 16, 16, 'w'); f(0, 12, 16, 4, 'e'); if (top) f(0, 0, 16, 1, 'k');
      } else {   // grass over dirt
        f(0, 0, 16, 16, 'S'); f(0, 0, 16, 16, '#C84C0C');
        const hsh = (a) => ((Math.imul(a ^ (x * 31 + y * 17), 2654435761) >>> 0) % 16);
        for (let i = 0; i < 6; i++) f(hsh(i), 3 + (hsh(i + 9) % 12), 2, 1, '#7C2C00');
        if (top) { f(0, 0, 16, 4, 'g'); f(0, 0, 16, 1, '#B8F818'); f(0, 4, 16, 1, 'G'); f(2, 4, 2, 1, 'g'); f(9, 4, 3, 1, 'g'); f(0, 5, 16, 1, 'k'); }
      }
    };
    /** platform(x, y, n, kind = 'brick'): a floating row of n tiles at (x, y) */
    g.platform = (x, y, n, kind = 'brick') => { for (let i = 0; i < n; i++) g.tile(x + i * 16, y, kind, true); };
    /** block(x, y, { kind = 'q', bump = 0, label }): a 16×16 block, top-left at (x, y) — 'q' (? block) | 'used' | 'brick' | 'chip'; bump 0..1 pops it up 5px (when hit); label: up to 3 pixel letters on it */
    g.block = (x, y, o = {}) => {
      const kind = o.kind || 'q', dy = -R(Math.sin(clamp(o.bump ?? 0) * Math.PI) * 5);
      if (kind === 'q' || kind === 'used') ctx.drawImage(compile(SPR[kind === 'q' ? 'qblock' : 'used']), R(x), R(y + dy));
      else if (kind === 'chip') g.chip(x, y + dy, 16, 16);
      else g.tile(x, y + dy, 'brick');
      if (o.label) g.text(o.label, x + 8, y + dy + 4, { align: 'c', color: o.labelColor || 'w' });
    };
    /** chip(x, y, w, h, { label, color = 'D', pins = 'e', glow }): a microchip (CPU, ALU, RAM…) with pins on all sides; label in pixel type centred; glow 0..1 lights its edge */
    g.chip = (x, y, w, hh, o = {}) => {
      x = R(x); y = R(y); w = R(w); hh = R(hh);
      ctx.fillStyle = cc(o.pins || 'e');
      for (let i = 3; i < w - 2; i += 3) { ctx.fillRect(x + i, y - 2, 1, 2); ctx.fillRect(x + i, y + hh, 1, 2); }
      for (let j = 3; j < hh - 2; j += 3) { ctx.fillRect(x - 2, y + j, 2, 1); ctx.fillRect(x + w, y + j, 2, 1); }
      g.rect(x - 1, y - 1, w + 2, hh + 2, 'k'); g.rect(x, y, w, hh, o.color || 'D'); g.rect(x, y, w, 1, 'E'); g.rect(x, y, 1, hh, 'E');
      g.rect(x + 2, y + 2, 2, 2, 'E');
      if (o.glow) { const c = o.glowColor || 'c'; if ((o.glow ?? 0) > 0.01) { g.rect(x - 1, y - 1, w + 2, 1, c); g.rect(x - 1, y + hh, w + 2, 1, c); g.rect(x - 1, y - 1, 1, hh + 2, c); g.rect(x + w, y - 1, 1, hh + 2, c); } }
      if (o.label) g.text(o.label, x + w / 2, y + hh / 2 - (o.scale ?? 1) * 4, { align: 'c', color: o.labelColor || 'w', scale: o.scale });
    };
    /** pipe(x, y, h, { color = 'g' }): a pipe whose 32px-wide lip sits at (x, y), body running h px down (or set up:true to hang from the top) */
    g.pipe = (x, y, hh, o = {}) => {
      x = R(x); y = R(y);
      const c = cc(o.color || 'g'), d = cc(o.shade || 'G'), hi = cc('w');
      const body = (bx, by, w, bh) => { g.rect(bx - 1, by, w + 2, bh, 'k'); ctx.fillStyle = c; ctx.fillRect(bx, by, w, bh); ctx.fillStyle = d; ctx.fillRect(bx + w - 7, by, 5, bh); ctx.fillRect(bx + 2, by, 1, bh); ctx.fillStyle = hi; ctx.fillRect(bx + 4, by, 2, bh); };
      if (o.up) { body(x + 2, y - hh, 28, hh); body(x, y, 32, 10); g.rect(x - 1, y + 10, 34, 1, 'k'); }
      else { body(x + 2, y + 10, 28, hh); g.rect(x - 1, y - 1, 34, 1, 'k'); body(x, y, 32, 10); g.rect(x - 1, y + 10, 34, 1, 'k'); }
    };
    /** flag(x, groundY, k = 1, { color = 'g' }): the end-of-level flagpole at x; k 0..1 slides the flag from the top to the bottom */
    g.flag = (x, gy, k = 1, o = {}) => {
      x = R(x); const top = gy - 96;
      g.rect(x - 1, top, 3, gy - top, 'k'); g.rect(x, top, 1, gy - top, 'e'); disc(ctx, x, top - 2, 3, cc('k')); disc(ctx, x, top - 2, 2, cc('g'));
      const fy = R(lerp(top + 4, gy - 22, clamp(k)));
      for (let j = 0; j < 14; j++) { const w = 14 - Math.abs(7 - j) * 2; g.rect(x - w - 1, fy + j, w, 1, j % 13 === 0 ? 'k' : o.color || 'g'); }
      g.rect(x - 9, gy - 8, 19, 8, 'k'); g.rect(x - 8, gy - 7, 17, 7, 'E');
    };
    /** door(x, groundY, { open = 0, color = 'N' }): a castle door (24×32) standing on the ground; open 0..1 */
    g.door = (x, gy, o = {}) => {
      x = R(x); const y = gy - 32;
      g.rect(x - 2, y - 2, 28, 34, 'k'); g.rect(x, y, 24, 32, 'D');
      const w = R(24 * (1 - clamp(o.open ?? 0)));
      if (w > 0) { g.rect(x, y, w, 32, o.color || 'N'); for (let j = 4; j < 32; j += 6) g.rect(x, y + j, w, 1, 'k'); if (w > 18) g.rect(x + w - 5, y + 16, 2, 2, 'Y'); }
      else { g.rect(x + 2, y + 2, 20, 30, '#000'); }
    };

    /** sprite(name, x, y, { frame, flip, scale = 1, swap, anchor = 'bc' }): draw a library sprite — hero.idle hero.blink hero.walk1 hero.walk2 hero.jump hero.win hero.hurt bug.1 bug.2 coin.1-3 heart heart.empty star gem chest key ghost arrow qblock used — or your own string-art array (rows of palette characters, '.' transparent). anchor 'bc' = (x, y) is the bottom centre, 'tl' = top left. swap recolours, e.g. { t: 'p', T: 'P' } */
    g.sprite = (name, x, y, o = {}) => {
      const map = Array.isArray(name) ? name : SPR[name];
      if (!map) throw new Error(`pixel sprite "${name}" not found`);
      const c = compile(map, o.swap), s = Math.max(1, R(o.scale ?? 1)), w = c.width * s, hh = c.height * s;
      const ax = o.anchor === 'tl' ? 0 : w / 2, ay = o.anchor === 'tl' ? 0 : hh;
      ctx.save();
      ctx.translate(R(x - (o.flip ? -ax : ax)), R(y - ay));
      if (o.flip) ctx.scale(-1, 1);
      ctx.drawImage(c, 0, 0, w, hh);
      ctx.restore();
      return { x: R(x - ax), y: R(y - ay), w, h: hh };
    };
    /** hero(x, y, { pose = 'idle' | 'walk' | 'jump' | 'win' | 'hurt', t, flip, scale = 2, swap }): the robot hero (24×32 at the default scale 2), feet at (x, y). walk cycles 3 frames on t (pass lt; stepped at 10 fps); idle blinks now and then */
    g.hero = (x, y, o = {}) => {
      const t = o.t ?? g.lt, f = Math.floor(t * 10);
      let name = 'hero.idle';
      if (o.pose === 'walk') name = ['hero.walk1', 'hero.idle', 'hero.walk2', 'hero.idle'][f % 4];
      else if (o.pose === 'jump') name = 'hero.jump';
      else if (o.pose === 'win') name = f % 6 < 3 ? 'hero.win' : 'hero.idle';
      else if (o.pose === 'hurt') name = 'hero.hurt';
      else if (f % 31 === 0) name = 'hero.blink';
      return g.sprite(name, x, y, { flip: o.flip, scale: o.scale ?? 2, swap: o.swap });
    };
    /** bug(x, y, { t, flip, scale, squash }): the enemy beetle (a bug in the code), feet at (x, y); squash 0..1 flattens it when stomped */
    g.bug = (x, y, o = {}) => {
      const t = o.t ?? g.lt, sq = clamp(o.squash ?? 0);
      if (sq > 0) { const c = compile(SPR['bug.1'], o.swap), s = o.scale ?? 1, hh = Math.max(2, R(c.height * s * (1 - sq * 0.75))); ctx.drawImage(c, R(x - (c.width * s) / 2), R(y - hh), c.width * s, hh); return; }
      g.sprite(Math.floor(t * 6) % 2 ? 'bug.2' : 'bug.1', x, y, { flip: o.flip, scale: o.scale, swap: o.swap });
    };
    /** coin(x, y, { t, scale }): a spinning coin, bottom centre at (x, y) (4-frame spin at 8 fps) */
    g.coin = (x, y, o = {}) => { const f = Math.floor((o.t ?? g.lt) * 8) % 4; g.sprite(['coin.1', 'coin.2', 'coin.3', 'coin.2'][f], x, y, { scale: o.scale, flip: f === 3 }); };
    /** coinPop(x, y, k): a coin shooting out of a block at (x, y) (block top centre) — k 0..1 over ~0.6 s; it rises 28px, spins and vanishes into a "+1" */
    g.coinPop = (x, y, k, o = {}) => {
      k = clamp(k); if (k <= 0 || k >= 1) return;
      const up = Math.sin(Math.min(1, k * 1.15) * Math.PI) * 30;
      if (k < 0.8) g.coin(x, y - up, { t: k * 3 });
      else g.text(o.text || '+1', x, y - 34 - (k - 0.8) * 20, { align: 'c', color: 'w' });
    };
    /** chestOpen(x, y, k, { scale }): a treasure chest at (x, y) (bottom centre); k 0..1 lifts the lid and lets gold light rise out */
    g.chestOpen = (x, y, k = 0, o = {}) => {
      k = clamp(k);
      const s = Math.max(1, R(o.scale ?? 1)), c = compile(SPR.chest), w = c.width * s, hh = c.height * s;
      const X = R(x - w / 2), Y = R(y - hh), lift = R(k * 7) * s;
      if (k > 0.1) {   // a fan of gold light rising out of the open chest, stepped rays and sparkles
        const rise = R(ease.out(clamp((k - 0.1) / 0.6)) * 12) * s;
        for (let i = -2; i <= 2; i++) { const top = Y - rise + Math.abs(i) * 3 * s; if (top < Y + 3 * s) g.rect(R(x + i * 3 * s), top, s, Y + 3 * s - top, i % 2 ? 'y' : 'Y'); }
        g.sparkle(R(x - 7 * s), Y - rise + 4 * s, g.lt); g.sparkle(R(x + 8 * s), Y - rise + 9 * s, g.lt + 0.2);
        g.rect(X + 2 * s, Y + 3 * s, w - 4 * s, s, 'y');
      }
      ctx.drawImage(c, 0, 3, c.width, c.height - 3, X, Y + 3 * s, w, hh - 3 * s);   // the body
      ctx.drawImage(c, 0, 0, c.width, 4, X, Y - lift, w, 4 * s);                    // the lid, lifted
    };
    /** text(str, x, y, { color = 'w', scale = 1, align = 'l' | 'c' | 'r', shadow = 'k', outline, fixed, k }): pixel type — Latin and digits in an 8px console face (scale 2–4 for headlines), CJK in a 16px pixel face (set size: 16). (x, y) is the top. k 0..1 types it out letter by letter. fixed: ignore view scrolling */
    g.text = (str, x, y, o = {}) => {
      str = String(str);
      if (o.k != null) str = [...str].slice(0, Math.floor(clamp(o.k) * [...str].length + 1e-6)).join('');
      const size = o.size ?? (/[　-鿿＀-￯]/.test(str) ? 16 : 8);
      const lines = str.split('\n'), s = Math.max(1, R(o.scale ?? 1)), lh = (o.lh ?? size + 3) * s;
      const draw = () => lines.forEach((line, i) => {
        if (!line) return;
        const m0 = glyphs(line, size), w = m0.width * s, hh = m0.height * s;
        const X = R(o.align === 'c' ? x - w / 2 : o.align === 'r' ? x - w : x), Y = R(y + i * lh);
        if (o.outline) { const t = tinted(m0, cc(o.outline)); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) ctx.drawImage(t, X + dx * s, Y + dy * s, w, hh); }
        if (o.shadow !== null) ctx.drawImage(tinted(m0, cc(o.shadow || 'k')), X + s, Y + s, w, hh);
        ctx.drawImage(tinted(m0, cc(o.color || 'w')), X, Y, w, hh);
      });
      if (o.fixed) fixed(draw); else draw();
      return { w: Math.max(...lines.map((l) => glyphs(l, size).width)) * s, h: lines.length * lh };
    };
    /** box(x, y, w, h, { fill = 'k', border = 'w', fixed }): a console window — black panel, double pixel frame, cut corners */
    g.box = (x, y, w, hh, o = {}) => {
      const d = () => {
        x = R(x); y = R(y); w = R(w); hh = R(hh);
        g.rect(x + 1, y, w - 2, hh, 'k'); g.rect(x, y + 1, w, hh - 2, 'k');
        g.rect(x + 2, y + 2, w - 4, hh - 4, o.border || 'w'); g.rect(x + 3, y + 3, w - 6, hh - 6, 'k');
        g.rect(x + 4, y + 4, w - 8, hh - 8, o.fill || 'k');
      };
      if (o.fixed) fixed(d); else d();
    };
    /** dialog(x, y, w, h, str, k, { title, color, fixed }): an RPG text box that types str out as k goes 0→1, a blinking ▼ when done; title sits on the frame (e.g. a speaker name) */
    g.dialog = (x, y, w, hh, str, k = 1, o = {}) => {
      g.box(x, y, w, hh, { fixed: o.fixed });
      if (o.title) { const t = glyphs(o.title, 8); g.rect(x + 8, y - 1, t.width + 6, 5, 'k'); g.text(o.title, x + 11, y - 3, { color: 'y', fixed: o.fixed }); }
      g.text(str, x + 9, y + 9, { k, color: o.color || 'w', fixed: o.fixed, lh: o.lh });
      if (k >= 1 && Math.floor(g.lt * 3) % 2 === 0) g.text('▼', x + w - 14, y + hh - 13, { color: 'w', fixed: o.fixed });
    };
    /** hud({ score, coins, lives, time, label }): the console HUD along the top right (score as 6 digits, a coin ×count, hearts for lives out of 3, a TIME countdown, a gold label) — fixed on screen */
    g.hud = (o = {}) => fixed(() => {
      let x = W - 8;   // laid out right to left
      const put = (str, color = 'w', gap = 10) => { x -= glyphs(str, 8).width; g.text(str, x, 8, { color }); x -= gap; };
      const icon = (name, w, gap = 4) => { x -= w; ctx.drawImage(compile(SPR[name]), x, 8); x -= gap; };
      if (o.time != null) { put(String(Math.max(0, Math.floor(o.time))).padStart(3, '0'), 'w', 4); put('TIME', 'y', 14); }
      if (o.lives != null) { for (let i = 2; i >= 0; i--) icon(i < o.lives ? 'heart' : 'heart.empty', 7, 2); x -= 12; }
      if (o.coins != null) { put('x' + String(Math.floor(o.coins)).padStart(2, '0'), 'w', 2); icon('coin.1', 8, 14); }
      if (o.score != null) put(String(Math.floor(o.score)).padStart(6, '0'), 'w', 12);
      if (o.label) put(o.label, 'y');
    });
    /** burst(x, y, k, { color = 'y', n = 10, r = 26, seed }): a pixel explosion / sparkle ring flying out from (x, y) as k goes 0→1 (bricks breaking, a correct answer, a bug destroyed) */
    g.burst = (x, y, k, o = {}) => {
      k = clamp(k); if (k <= 0 || k >= 1) return;
      const n = o.n ?? 10, r = o.r ?? 26, rnd = PV.rng(o.seed ?? 9), cols = [].concat(o.color || ['y', 'w', 'o']);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.5, d = ease.out(k) * r * (0.6 + rnd() * 0.5), sz = k < 0.7 ? 2 : 1;
        g.rect(x + Math.cos(a) * d, y + Math.sin(a) * d + k * k * 10, sz, sz, cols[i % cols.length]);
      }
      if (k < 0.25) { g.rect(x - 3, y - 1, 7, 3, 'w'); g.rect(x - 1, y - 3, 3, 7, 'w'); }
    };
    /** sparkle(x, y, t, { color = 'w' }): a 4-point twinkle that blinks on stepped time (on a gem, a correct answer, a powered-up chip) */
    g.sparkle = (x, y, t = g.lt, o = {}) => {
      const f = Math.floor(t * 8) % 4, c = o.color || 'w', r = [1, 3, 2, 0][f];
      g.rect(x, y - r, 1, 2 * r + 1, c); g.rect(x - r, y, 2 * r + 1, 1, c);
    };
    /** pop(x, y, str, k, { color = 'w' }): a score popup ("+100", "OK!", "1 CYCLE") floating up 16px as k goes 0→1, then gone */
    g.pop = (x, y, str, k, o = {}) => { k = clamp(k); if (k <= 0 || k >= 1) return; g.text(str, x, y - ease.out(k) * 16, { align: 'c', color: o.color || 'w', scale: o.scale }); };
    /** bar(x, y, w, v, { color = 'g', back = 'D', label, segs }): a segmented console meter (HP / progress / a register filling), v 0..1 */
    g.bar = (x, y, w, v, o = {}) => {
      g.rect(x - 1, y - 1, w + 2, 8, 'k'); g.rect(x, y, w, 6, o.back || 'D');
      const segs = o.segs ?? Math.floor(w / 6), sw = w / segs, on = Math.floor(clamp(v) * segs + 1e-6);
      for (let i = 0; i < on; i++) { g.rect(x + i * sw + 1, y + 1, sw - 1, 4, o.color || 'g'); g.rect(x + i * sw + 1, y + 1, sw - 1, 1, 'w'); }
      if (o.label) g.text(o.label, x, y - 11, { color: o.labelColor || 'y' });
    };
    /** bits(x, y, value, n = 8, { on = 'g', off = 'D', k, size = 8, digits = true }): a row of n bit lamps showing value in binary (a register, a byte on a bus); k 0..1 lights them left to right */
    g.bits = (x, y, value, n = 8, o = {}) => {
      const sz = o.size ?? 8, gap = o.digits === false ? 2 : Math.max(2, 10 - sz), lit = o.k == null ? n : Math.floor(clamp(o.k) * n + 1e-6);
      for (let i = 0; i < n; i++) {
        const b = (value >> (n - 1 - i)) & 1, X = x + i * (sz + gap);
        g.rect(X - 1, y - 1, sz + 2, sz + 2, 'k'); g.rect(X, y, sz, sz, i < lit && b ? o.on || 'g' : o.off || 'D');
        if (i < lit && b) g.rect(X, y, sz, 1, 'w');
        if (o.digits !== false) g.text(i < lit ? String(b) : '', X + sz / 2, y + sz + 3, { align: 'c', color: 'e' });
      }
    };
    /** wipe(k, kind = 'iris', { x, y, color = '#000' }): a screen transition covering the frame as k goes 0→1 — 'iris' (a closing circle on x, y), 'blocks' (a staircase of 16px blocks), 'bars' (horizontal shutters). Use 1-k to open */
    g.wipe = (k, kind = 'iris', o = {}) => fixed(() => {
      k = clamp(k); if (k <= 0) return;
      ctx.fillStyle = cc(o.color || '#000');
      if (kind === 'blocks') { for (let j = 0; j < H; j += 16) for (let i = 0; i < W; i += 16) { const t = clamp(k * 2.2 - (i + j) / (W + H) * 1.2); const s = R(16 * t); if (s > 0) ctx.fillRect(i + (16 - s) / 2 | 0, j + (16 - s) / 2 | 0, s, s); } return; }
      if (kind === 'bars') { for (let j = 0; j < H; j += 12) ctx.fillRect(-m, j, W + 2 * m, R(12 * k)); return; }
      const cx = o.x ?? W / 2, cy = o.y ?? H / 2, r = (1 - k) * Math.hypot(W, H) * 0.6;
      for (let j = -m; j < H + m; j++) { const dy = j - cy, hw = r * r - dy * dy; if (hw <= 0) { ctx.fillRect(-m, j, W + 2 * m, 1); continue; } const s = Math.sqrt(hw); ctx.fillRect(-m, j, R(cx - s) + m, 1); ctx.fillRect(R(cx + s), j, W + m - R(cx + s), 1); }
    });
    /** fixed(fn): draw fn() in screen space even while the level scrolls (labels, a pinned panel) */
    g.fixed = fixed;
    /** par(p, fn): draw fn() with parallax factor p (0 = stays with the screen, 1 = moves with the level) */
    g.par = par;
    return g;
  }

  /** pixel(draw, { at, margin = 12 }): THE stage of this style — a full-frame 320×180 pixel canvas (1 px = 6 screen px, crisp squares). draw(g, lt) is called every frame and paints the whole scene with g (see the g.* helpers: sky, hills, clouds, ground, block, chip, pipe, hero, bug, coin, text, dialog, hud, burst, wipe…). Coordinates are logical pixels: x 0–320, y 0–180; the subtitle band is y > 150, the page title sits at y < 28. The canvas overhangs the frame by `margin` so camera moves never show an edge. Before `at` (default 0) nothing is drawn */
  B.pixel = function (draw, o = {}) {
    const m = o.margin ?? 12, at = o.at ?? 0;
    const c = h('canvas', 'px', null, this.html);
    c.width = W + 2 * m; c.height = H + 2 * m;
    Object.assign(c.style, { position: 'absolute', left: -m * U + 'px', top: -m * U + 'px', width: (W + 2 * m) * U + 'px', height: (H + 2 * m) * U + 'px', imageRendering: 'pixelated' });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const g = painter(ctx, m);
    // the pixel stage is a whole world, edge to edge, so the layout check's "sparse page" measure (which skips full-bleed
    // backgrounds) reads it through an invisible stand-in for the playfield instead
    PV.s('rect', { x: STAGE.area.x0 + 40, y: STAGE.area.y0, width: STAGE.area.x1 - STAGE.area.x0 - 80, height: STAGE.area.y1 - STAGE.area.y0 - 10, fill: 'none', stroke: 'none', 'data-pixel-stage': '' }, this.svg);
    this.tick((lt) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (lt < at) return;
      ctx.setTransform(1, 0, 0, 1, m, m);
      g.cx = 0; g.lt = lt;
      draw(g, lt);
    });
    return { canvas: c, g };
  };

  /** pixelText(str, x, y, { color = 'yellow', size = 48, at, cps = 14 }): a DOM label in the console face (screen pixels, any language), typed out from `at`; for CJK headlines and callouts over the pixel stage */
  B.pixelText = function (str, x, y, o = {}) {
    return this.text(str, { x, y, size: o.size ?? 48, color: o.color || 'yellow', font: 'latin', at: o.at ?? 0, cps: o.cps ?? 14, align: o.align, w: o.w, lh: o.lh ?? 1.35, mode: o.mode });
  };

  // the page title as a console banner: a small "WORLD n-n" tag in gold over the title in the console face, with a
  // stepped block underline (it lives on the hud, so camera moves never cut it)
  B.title = function (str, o = {}) {
    const at = o.at ?? 0.15, T = this.hud || this, size = o.size ?? 40;
    if (o.world !== false) T.text(o.world ? `WORLD ${o.world}` : 'STAGE', { x: STAGE.title.x + 2, y: STAGE.title.y - 44, size: 26, color: 'yellow', font: 'latin', at, mode: 'fade', dur: 0.2 });
    const t = T.text(str, { x: STAGE.title.x, y: STAGE.title.y - 4, size, color: 'ink', font: 'latin', at: at + 0.1, cps: o.cps ?? 18 });
    const n = Math.min(14, Math.max(4, Math.round([...str].length * 0.7))), c = col(o.accent || 'orange');
    for (let i = 0; i < n; i++) {
      const el = h('div', null, null, T.html);
      Object.assign(el.style, { position: 'absolute', left: STAGE.title.x + 2 + i * 30 + 'px', top: STAGE.title.y - 6 + size * 1.35 + 'px', width: '24px', height: '12px', background: c, boxShadow: '6px 6px 0 #000' });
      T.show(el, { at: at + 0.3 + i * 0.035, dur: 0.01, dy: 0 });
    }
    return t;
  };
})();
