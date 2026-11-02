/* Mascot Explainer kit: a kawaii flat cartoon on warm cream paper. Thick soft-brown outlines, flat pastel fills, rounded
 * everything, things that pop in with an overshoot, sticker pills, stamps, money pouches, coins, receipts, price tags,
 * calendars, phones and rounded bar charts, and one cute host (a cat, a bear, a bunny or a fox, or the person's own
 * character from a picture) who stays on screen for the whole film, points at the numbers as they land and reacts to them.
 * Every component is a pure function of page time lt. Options marked "fn" take a value, a function of lt, or a keyframe
 * list [[t0, v0], [t1, v1], …] (the last entry whose time has passed wins).
 * Adapted from the author's own series kit (toon / cast / props / host / outro), re-written for this engine. */
(function () {
  const { col, clamp, lerp, h, Builder } = PV;
  const ease = Object.assign({}, PV.ease, { in: (x) => x * x * x });
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, PORTRAIT = !!STAGE.portrait;
  const BOTTOM = PORTRAIT ? 1480 : 890;            // nothing below this line: the subtitle band
  const OUT = 5;                                   // the outline
  const FUN = "Fredoka, 'ZCOOL KuaiLe', 'LXGW WenKai', 'PingFang SC', sans-serif";

  // ── colours: the style palette plus a few fixed ones ──
  const EXTRA = { white: '#FFFFFF', cream: '#FFF1D6', skin: '#FFD8B8', brown: '#C8814A', brownF: '#F3DCC5', gray: '#B9B2AA', grayF: '#ECE6DE', pink: '#FFB3A7', coin: '#FFC93C', coinD: '#E3A51B', coinT: '#8A5E05', shadow: 'rgba(58,46,40,0.16)' };
  const C = (c) => (c == null ? null : EXTRA[c] || col(c) || c);
  const isKeys = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'number' && v[0].length >= 2;
  const val = (v, lt, d) => {
    if (typeof v === 'function') return v(lt);
    if (isKeys(v)) { let r = v[0][1]; for (const k of v) if (lt >= k[0]) r = k[1]; return r; }
    return v ?? d;
  };
  const K = (lt, a, d) => clamp((lt - a) / d);
  const spring = (x) => (x <= 0 ? 0 : 1 - Math.exp(-6 * x) * Math.cos(9 * x));
  const back = (x) => ease.back(clamp(x));
  const wave = (lt, period, amp = 1, phase = 0) => amp * Math.sin((lt / period + phase) * Math.PI * 2);
  const blink = (lt, period = 3.4, offset = 0) => { const x = (((lt + offset) % period) + period) % period; return x < 0.16 ? Math.sin((x / 0.16) * Math.PI) : 0; };
  /** rough text width in px: CJK ≈ 1 em, Latin and digits ≈ 0.56 em */
  const tw = (str, size) => [...String(str).replace(/\{[a-z]+:|\}|\*\*/g, '')].reduce((a, ch) => a + (/[\x00-\xff]/.test(ch) ? 0.56 : 1), 0) * size;
  /** keep a box of w × h centred on (x, y) inside the picture, above the subtitle band */
  const TOP = PORTRAIT ? 260 : 190;                // the title's band
  const fit = (x, y, w, hh, m = 30) => [clamp(x, m + w / 2, W - m - w / 2), clamp(y, TOP + hh / 2, BOTTOM - hh / 2)];
  /** where the host stands on this page: content keeps out of its zone */
  const zoneOf = (T) => {
    if (PORTRAIT) return null;                     // portrait: the host stands under the content, nothing steps aside
    const e = window.MASCOT_HOST && window.MASCOT_HOST[T.page.id], c = e && e.sh === T.sh ? e.conf : null;
    if (c && c.hide) return null;
    if (!c) return 'corner';
    if (c.x != null) return c.x < 700 ? 'left' : c.x > 1220 ? 'right' : null;
    return c.place || 'corner';
  };
  /** fit, and step aside for the host: a big host owns a third of the frame, a corner host its corner */
  function fitT(T, x, y, w, hh) {
    [x, y] = fit(x, y, w, hh);
    if (PORTRAIT) return [x, y];
    const z = zoneOf(T), low = y + hh / 2 > 640;
    if (z === 'left' && 640 + w / 2 <= W - 30 - w / 2) x = Math.max(x, 640 + w / 2);
    else if (z === 'right' && 1280 - w / 2 >= 30 + w / 2) x = Math.min(x, 1280 - w / 2);
    else if (z === 'corner' && low) x = Math.min(x, 1570 - w / 2);
    else if (z === 'cornerL' && low) x = Math.max(x, 350 + w / 2);
    return [x, y];
  }

  // ── SVG strings ──
  const n = (v) => (Math.round(v * 10) / 10).toString();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // only a paint is a colour name (a linecap's 'round' is not: looked up, it was flagged on every page)
  const attrs = (a) => Object.entries(a).filter(([, v]) => v != null).map(([k, v]) => `${k}="${typeof v === 'number' ? n(v) : k === 'fill' || k === 'stroke' ? C(v) : v}"`).join(' ');
  const st = (o = {}) => ({ fill: o.fill ?? 'white', stroke: o.stroke ?? 'ink', 'stroke-width': o.sw ?? OUT, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: o.op });
  const rrect = (x, y, w, hh, r) => {
    r = Math.max(0, Math.min(r, w / 2, hh / 2));
    return `M${n(x + r)} ${n(y)} H${n(x + w - r)} Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)} V${n(y + hh - r)} Q${n(x + w)} ${n(y + hh)} ${n(x + w - r)} ${n(y + hh)} H${n(x + r)} Q${n(x)} ${n(y + hh)} ${n(x)} ${n(y + hh - r)} V${n(y + r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)} Z`;
  };
  const S = {
    rect: (x, y, w, hh, o = {}) => `<path d="${rrect(x, y, w, hh, o.r ?? 18)}" ${attrs(st(o))}/>`,
    circle: (cx, cy, r, o = {}) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(0, r))}" ${attrs(st(o))}/>`,
    ellipse: (cx, cy, rx, ry, o = {}) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(Math.max(0, rx))}" ry="${n(Math.max(0, ry))}" ${attrs(st(o))}/>`,
    path: (d, o = {}) => `<path d="${d}" ${attrs(st(o))}/>`,
    line: (x1, y1, x2, y2, o = {}) => `<path d="M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}" ${attrs({ ...st(o), fill: 'none' })}/>`,
    /** the flat dropped shadow under a sticker: the same shape, 8 px lower, in translucent brown */
    drop: (x, y, w, hh, r, d = 9) => `<path d="${rrect(x, y + d, w, hh, r)}" fill="${EXTRA.shadow}"/>`,
    floor: (cx, cy, rx, ry = rx * 0.18) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="rgba(120,80,40,0.16)"/>`,
    text: (x, y, str, o = {}) => `<text x="${n(x)}" y="${n(y)}" text-anchor="${o.anchor || 'middle'}" dominant-baseline="central" font-family="${FUN.replace(/"/g, "'")}" font-size="${n(o.size ?? 40)}" font-weight="${o.weight ?? 600}" fill="${C(o.fill || 'ink')}"${o.stroke ? ` stroke="${C(o.stroke)}" stroke-width="${o.sw ?? 6}" paint-order="stroke" stroke-linejoin="round"` : ''}${o.strike ? ' text-decoration="line-through"' : ''}>${esc(str)}</text>`,
    g: (tf, inner) => `<g transform="${tf}">${inner}</g>`,
  };
  const MARK = { r: 'red', o: 'orange', y: 'yellow', g: 'green', b: 'blue', p: 'purple', k: 'ink', m: 'muted', s: 'soft', w: 'white' };
  const markup = (str) => esc(str)
    .replace(/\{([a-z]+):([^}]*)\}/g, (_, c, t) => `<span style="color:${C(MARK[c] || c)}">${t}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');

  // ── arrivals and exits: pop (overshoot), drop, rise, fade, slideL, slideR; o.out = when it leaves ──
  function motion(lt, o) {
    const at = o.at ?? 0, dur = o.dur ?? 0.5, mode = o.in || 'pop';
    if (lt < at) return null;
    const k = K(lt, at, dur);
    let op = 1, sc = 1, dx = 0, dy = 0, rot = o.rot || 0;
    if (mode === 'pop') { sc = back(k); op = clamp(k * 4); }
    else if (mode === 'fade') op = ease.out(k);
    else if (mode === 'rise') { op = ease.out(k); dy = (1 - ease.out(k)) * 40; }
    else if (mode === 'drop') { op = clamp(k * 3); dy = -(1 - back(k)) * 140; }
    else if (mode === 'slideL') { op = clamp(k * 3); dx = -(1 - back(k)) * 240; }
    else if (mode === 'slideR') { op = clamp(k * 3); dx = (1 - back(k)) * 240; }
    if (o.anim) {
      const a = o.anim(lt - at, lt) || {};
      dx += a.dx || 0; dy += a.dy || 0; rot += a.rot || 0;
      if (a.s != null) sc *= a.s;
      if (a.op != null) op *= a.op;
    }
    const out = o.out ?? o._out?.t;
    if (out != null && lt > out) {
      const q = ease.inOut(K(lt, out, o._out?.d ?? 0.3));
      op *= 1 - q; sc *= 1 - 0.3 * q;
    }
    return { op, sc, dx, dy, rot };
  }
  const handle = (el, o, extra = {}) => Object.assign({ el, hide(t, d = 0.3) { o._out = { t, d }; return this; } }, extra);

  /** an SVG group anchored at (o.x, o.y); draw is a fixed string or (t, lt) => string, redrawn every frame */
  function svgEl(T, draw, o = {}) {
    const g = PV.s('g', {}, T.svg);
    const inner = PV.s('g', {}, g);
    const fixed = typeof draw === 'string';
    if (fixed) inner.innerHTML = draw;
    let last = null;
    T.tick((lt) => {
      const m = motion(lt, o);
      if (!m || m.op <= 0.001) { g.style.display = 'none'; return; }
      g.style.display = '';
      g.setAttribute('opacity', m.op.toFixed(3));
      g.setAttribute('transform', `translate(${n(o.x + m.dx)} ${n(o.y + m.dy)}) rotate(${n(m.rot)}) scale(${((o.s ?? 1) * m.sc).toFixed(4)})`);
      if (!fixed) { const s = draw(lt - (o.at ?? 0), lt); if (s !== last) { last = s; inner.innerHTML = s; } }
    });
    return handle(g, o);
  }

  /** HTML lettering anchored at (x, y): align c → centre, l → left middle, r → right middle */
  function text(T, str, o = {}) {
    const el = h('div', 'mt ' + (o.cls || ''), null, (o.layer || T).html);
    const set = (s) => { el.innerHTML = markup(s); };
    set(str);
    const size = o.size ?? 56;
    Object.assign(el.style, { left: o.x + 'px', top: o.y + 'px', fontSize: size + 'px', color: C(o.color || 'ink'), textAlign: o.align === 'l' ? 'left' : o.align === 'r' ? 'right' : 'center' });
    if (o.weight) el.style.fontWeight = o.weight;
    if (o.lh) el.style.lineHeight = o.lh;
    if (o.outline) { el.style.webkitTextStroke = `${o.outline}px ${C('ink')}`; el.style.paintOrder = 'stroke fill'; }
    if (o.shadow !== false) el.style.textShadow = `0 ${Math.max(3, Math.round(size / 18))}px 0 rgba(58,46,40,0.16)`;
    const ax = o.align === 'l' ? '0' : o.align === 'r' ? '-100%' : '-50%';
    (o.layer || T).tick((lt) => {
      const m = motion(lt, o);
      if (!m || m.op <= 0.001) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      el.style.opacity = m.op.toFixed(3);
      el.style.transform = `translate(${ax}, -50%) translate(${m.dx.toFixed(1)}px, ${m.dy.toFixed(1)}px) rotate(${m.rot.toFixed(2)}deg) scale(${m.sc.toFixed(4)})`;
    });
    return handle(el, o, { set });
  }
  const fmtNum = (v, o = {}) => {
    const d = o.decimals ?? 0, x = Math.abs(v), s = x.toFixed(d);
    const [i, f] = s.split('.');
    const ii = o.sep === false || (o.sep == null && x < 10000) ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '−' : o.plus && v > 0 ? '+' : '') + ii + (f ? '.' + f : '');
  };

  // ── the host registry: pages tell the film-wide host where to stand and what to do ──
  const REG = (window.MASCOT_HOST = window.MASCOT_HOST || {});
  function entry(T) {
    const id = T.page.id;
    let e = REG[id];
    if (!e || e.sh !== T.sh) e = REG[id] = { sh: T.sh, conf: null, auto: [] };
    return e;
  }
  /** a component asks the host to react at page time t: point at (x, y), nod, cheer or gasp */
  const cue = (T, t, act, target) => { entry(T).auto.push([t, act, target]); };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Characters
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const EYE_INK = '#3A2E28';
  function dotEye(cx, cy, r, s) {
    if (s.mood === 'happy' || s.mood === 'cheer') return S.path(`M${n(cx - r * 1.2)} ${n(cy + r * 0.35)} Q${n(cx)} ${n(cy - r * 1.3)} ${n(cx + r * 1.2)} ${n(cy + r * 0.35)}`, { fill: 'none', sw: 6 });
    if (s.mood === 'shock') return S.circle(cx, cy, r * 1.35, { fill: 'white', sw: 4.5 }) + S.circle(cx, cy, r * 0.5, { fill: 'ink', stroke: 'none' });
    const shut = Math.min(1, s.blink || 0), [lx, ly] = s.look || [0, 0];
    const ry = r * 1.25 * (1 - shut * 0.9), ex = cx + lx * r * 0.45, ey = cy + ly * r * 0.4;
    return `<ellipse cx="${n(ex)}" cy="${n(ey)}" rx="${n(r * 0.92)}" ry="${n(ry)}" fill="${EYE_INK}"/>` +
      (shut < 0.5 ? S.circle(ex - r * 0.3, ey - r * 0.45, r * 0.36, { fill: 'white', stroke: 'none' }) + S.circle(ex + r * 0.32, ey + r * 0.35, r * 0.14, { fill: 'white', stroke: 'none' }) : '');
  }
  function mouthSVG(cx, cy, w, s, kind) {
    const open = s.talk || 0;
    const m = s.mouth || ({ happy: 'grin', cheer: 'grin', shock: 'o', think: 'flat', sad: 'frown', worry: 'wavy' }[s.mood] ?? (kind === 'cat' ? 'w' : 'smile'));
    if (open > 0.08 && m !== 'o') return S.path(`M${n(cx - w * 0.36)} ${n(cy - 3)} Q${n(cx)} ${n(cy + w * (0.25 + open * 0.55))} ${n(cx + w * 0.36)} ${n(cy - 3)} Z`, { fill: '#9C4A3C', sw: 4 });
    if (m === 'o') return S.ellipse(cx, cy + 6, w * 0.2, w * (0.24 + open * 0.1), { fill: '#9C4A3C', sw: 4 });
    if (m === 'grin') return S.path(`M${n(cx - w * 0.42)} ${n(cy - 4)} Q${n(cx)} ${n(cy + w * 0.7)} ${n(cx + w * 0.42)} ${n(cy - 4)} Z`, { fill: '#9C4A3C', sw: 4 });
    if (m === 'flat') return S.line(cx - w * 0.25, cy + 4, cx + w * 0.25, cy + 4, { sw: 4.5 });
    if (m === 'frown') return S.path(`M${n(cx - w * 0.3)} ${n(cy + 10)} Q${n(cx)} ${n(cy - 6)} ${n(cx + w * 0.3)} ${n(cy + 10)}`, { fill: 'none', sw: 4.5 });
    if (m === 'wavy') return S.path(`M${n(cx - w * 0.34)} ${n(cy + 4)} q${n(w * 0.17)} -8 ${n(w * 0.34)} 0 t${n(w * 0.34)} 0`, { fill: 'none', sw: 4.5 });
    if (m === 'w') return S.path(`M${n(cx - w * 0.32)} ${n(cy - 2)} Q${n(cx - w * 0.16)} ${n(cy + 14)} ${n(cx)} ${n(cy - 1)} Q${n(cx + w * 0.16)} ${n(cy + 14)} ${n(cx + w * 0.32)} ${n(cy - 2)}`, { fill: 'none', sw: 4.5 });
    return S.path(`M${n(cx - w * 0.3)} ${n(cy - 3)} Q${n(cx)} ${n(cy + w * 0.36)} ${n(cx + w * 0.3)} ${n(cy - 3)}`, { fill: 'none', sw: 4.5 });
  }

  /** the four hosts: one rig (big head, small body, two arms, feet at the origin, ~300 units tall), four looks */
  const HOSTS = {
    cat: { body: '#AEBCD2', dark: '#8797B2', belly: '#FBF7F1', inner: '#FFC2B6' },
    bear: { body: '#D49460', dark: '#A86B3C', belly: '#F6E2CB', inner: '#F6E2CB' },
    bunny: { body: '#FFF9F5', dark: '#E9D9D2', belly: '#FFFFFF', inner: '#FFC2C8' },
    fox: { body: '#FF9F4A', dark: '#D9772A', belly: '#FFF6EA', inner: '#FFE2C4' },
  };
  function ears(kind, L) {
    if (kind === 'cat') return S.path('M-96 -228 L-86 -318 L-28 -270 Z', { fill: L.body }) + S.path('M96 -228 L86 -318 L28 -270 Z', { fill: L.body }) +
      S.path('M-84 -246 L-80 -294 L-46 -268 Z', { fill: L.inner, stroke: 'none' }) + S.path('M84 -246 L80 -294 L46 -268 Z', { fill: L.inner, stroke: 'none' });
    if (kind === 'bear') return S.circle(-78, -266, 36, { fill: L.body }) + S.circle(78, -266, 36, { fill: L.body }) + S.circle(-78, -264, 19, { fill: L.inner, stroke: 'none' }) + S.circle(78, -264, 19, { fill: L.inner, stroke: 'none' });
    if (kind === 'bunny') return `<g transform="rotate(-10 -44 -270)">${S.ellipse(-44, -326, 28, 76, { fill: L.body })}${S.ellipse(-44, -320, 14, 54, { fill: L.inner, stroke: 'none' })}</g>` +
      `<g transform="rotate(14 44 -270)">${S.ellipse(44, -326, 28, 76, { fill: L.body })}${S.ellipse(44, -320, 14, 54, { fill: L.inner, stroke: 'none' })}</g>`;
    if (kind === 'fox') return S.path('M-104 -214 L-92 -334 L-22 -272 Z', { fill: L.body }) + S.path('M104 -214 L92 -334 L22 -272 Z', { fill: L.body }) +
      S.path('M-96 -300 L-92 -334 L-66 -312 Z', { fill: '#5A3A2A', sw: 3 }) + S.path('M96 -300 L92 -334 L66 -312 Z', { fill: '#5A3A2A', sw: 3 }) +
      S.path('M-88 -240 L-84 -296 L-44 -266 Z', { fill: L.inner, stroke: 'none' }) + S.path('M88 -240 L84 -296 L44 -266 Z', { fill: L.inner, stroke: 'none' });
    return '';
  }
  function tail(kind, L, lt) {
    const sw = wave(lt, 1.8, 6);
    if (kind === 'cat') return S.path(`M58 -40 Q130 -40 128 ${n(-110 + sw)} Q126 ${n(-150 + sw)} 104 ${n(-146 + sw)}`, { fill: 'none', sw: 30, stroke: 'ink' }) +
      S.path(`M58 -40 Q130 -40 128 ${n(-110 + sw)} Q126 ${n(-150 + sw)} 104 ${n(-146 + sw)}`, { fill: 'none', sw: 20, stroke: L.body });
    if (kind === 'fox') return `<g transform="rotate(${n(sw * 0.8)} 50 -40)">` + S.path('M50 -40 Q150 -30 150 -130 Q140 -190 112 -196 Q120 -120 50 -84 Z', { fill: L.body }) + S.path('M150 -130 Q140 -190 112 -196 Q108 -160 128 -142 Z', { fill: 'white', sw: 4 }) + '</g>';
    if (kind === 'bunny') return S.circle(70, -44, 22, { fill: 'white' });
    if (kind === 'bear') return S.circle(66, -48, 16, { fill: L.body });
    return '';
  }
  function face(kind, L, s) {
    let f = '';
    if (kind === 'bear') f += S.ellipse(0, -160, 44, 32, { fill: L.belly, sw: 4 });
    if (kind === 'fox') f += S.path('M-110 -176 Q-60 -186 -6 -148 Q-50 -112 -96 -140 Z', { fill: 'white', stroke: 'none' }) + S.path('M110 -176 Q60 -186 6 -148 Q50 -112 96 -140 Z', { fill: 'white', stroke: 'none' });
    if (kind === 'cat') f += S.path('M-14 -270 l4 22 M0 -274 l0 24 M14 -270 l-4 22', { fill: 'none', sw: 5, stroke: L.dark });
    f += dotEye(-44, -196, 13, s) + dotEye(44, -196, 13, s);
    if (s.mood === 'think' || s.mood === 'shock') {
      const up = s.mood === 'shock' ? -12 : 0;
      f += S.line(-62, -232 + up, -30, -228 + up + (s.mood === 'think' ? 6 : 0), { sw: 5 }) + S.line(30, -228 + up, 62, -232 + up, { sw: 5 });
    }
    f += S.ellipse(-76, -162, 18, 11, { fill: 'pink', stroke: 'none', op: 0.85 }) + S.ellipse(76, -162, 18, 11, { fill: 'pink', stroke: 'none', op: 0.85 });
    const nose = kind === 'bear' || kind === 'fox' ? S.ellipse(0, -172, 11, 8, { fill: 'ink', stroke: 'none' }) : S.path('M-8 -174 L8 -174 L0 -166 Z', { fill: '#F28C8C', sw: 3 });
    f += nose;
    if (kind === 'cat') f += S.path('M-58 -168 l-44 -6 M-58 -158 l-42 6 M58 -168 l44 -6 M58 -158 l42 6', { fill: 'none', sw: 3.5, stroke: 'soft' });
    f += mouthSVG(0, -152, 46, s, kind);
    if (s.glasses) f += S.circle(-44, -196, 30, { fill: 'rgba(255,255,255,0.25)', sw: 5 }) + S.circle(44, -196, 30, { fill: 'rgba(255,255,255,0.25)', sw: 5 }) + S.line(-14, -198, 14, -198, { sw: 5 });
    if (s.sweat) f += S.path('M96 -250 q12 18 0 26 q-12 -8 0 -26 Z', { fill: 'blueF', sw: 3.5, stroke: 'blue' });
    return f;
  }
  /** the notebook and the calculator the host can hold in front of its belly */
  const NOTEBOOK = S.rect(-70, -52, 140, 100, { r: 10, fill: 'greenF' }) + S.line(0, -50, 0, 46, { sw: 4 }) +
    S.path('M-52 -26 H-16 M-52 -6 H-22 M16 -26 H52 M16 -6 H46', { fill: 'none', sw: 4, stroke: 'muted' }) + S.text(34, 22, '¥', { size: 30, fill: 'orange' });
  const CALC = S.rect(-56, -70, 112, 140, { r: 16, fill: 'blue' }) + S.rect(-40, -54, 80, 34, { r: 6, fill: 'white', sw: 4 }) +
    [0, 1, 2].map((r) => [0, 1, 2].map((c) => S.rect(-40 + c * 28, -10 + r * 26, 22, 18, { r: 5, fill: r === 2 && c === 2 ? 'orange' : 'yellowF', sw: 3 })).join('')).join('');

  /** the host drawing. s: { mood, look, blink, talk 0..1, armL / armR (deg: 0 down, 90 out, 160 up), tilt, squash, glasses, hold: 'book'|'calc' } */
  function hostSVG(kind, s = {}, lt = 0) {
    const L = HOSTS[kind] || HOSTS.cat;
    const sq = s.squash ?? 1, sx = 1 + (1 - sq) * 0.6;
    const arm = (side, ang, reach = 1) => {
      const up = ang > 110, a = (ang * Math.PI) / 180, len = 66 * reach * (up ? 1.4 : 1), x0 = side * (up ? 72 : 60), y0 = -116;
      const x1 = x0 + side * Math.sin(a) * len, y1 = y0 + Math.cos(a) * len;
      return S.path(`M${n(x0)} ${n(y0)} L${n(x1)} ${n(y1)}`, { fill: 'none', sw: 38, stroke: 'ink' }) +
        S.path(`M${n(x0)} ${n(y0)} L${n(x1)} ${n(y1)}`, { fill: 'none', sw: 28, stroke: L.body }) +
        S.circle(x1, y1, 6, { fill: L.belly, stroke: 'none', op: 0.9 });
    };
    const hold = s.hold === 'book' ? NOTEBOOK : s.hold === 'calc' ? CALC : '';
    const aL = hold ? 38 : s.armL ?? 10, aR = hold ? 38 : s.armR ?? 10;
    const tilt = s.tilt || 0;
    return S.floor(0, 4, 84) +
      `<g transform="scale(${n(sx)} ${n(sq)})">` +
      tail(kind, L, lt) +
      S.ellipse(-34, -10, 30, 17, { fill: L.body }) + S.ellipse(34, -10, 30, 17, { fill: L.body }) +
      S.ellipse(0, -78, 74, 78, { fill: L.body }) + S.ellipse(0, -66, 46, 50, { fill: L.belly, stroke: 'none' }) +
      (aL <= 110 ? arm(-1, aL, s.reachL ?? 1) : '') + (aR <= 110 ? arm(1, aR, s.reachR ?? 1) : '') +
      `<g transform="rotate(${n(tilt)} 0 -140)">` + ears(kind, L) + S.ellipse(0, -196, 116, 100, { fill: L.body }) + face(kind, L, s) + '</g>' +
      (aL > 110 ? arm(-1, aL, s.reachL ?? 1) : '') + (aR > 110 ? arm(1, aR, s.reachR ?? 1) : '') +
      (hold ? `<g transform="translate(0 ${s.hold === 'calc' ? -62 : -70}) rotate(-4) scale(${s.hold === 'calc' ? 0.78 : 1})">${hold}</g>` : '') +
      '</g>';
  }

  // ── the poses the host knows ──
  const ACTS = {
    idle: {}, happy: { mood: 'happy' },
    pointL: { point: -1 }, pointR: { point: 1 }, point: { point: 0 },
    cheer: { armL: 135, armR: 135, mood: 'cheer', hop: 1 },
    think: { mood: 'think', armR: 118, reachR: 0.62, tilt: 8, look: [0.5, -0.8] },
    shock: { mood: 'shock', armL: 60, armR: 60, hop: 0.6, sweat: true },
    wave: { armR: 130, wave: 1, mood: 'happy' },
    book: { hold: 'book', mood: 'happy' },
    calc: { hold: 'calc', look: [0, 0.6] },
    nod: { nod: 1, mood: 'happy' },
    shrug: { armL: 75, armR: 75, tilt: -9, mood: 'think' },
    glasses: { glasses: true, look: [0.3, -0.2] },
    sad: { mood: 'sad', tilt: -6, look: [0, 0.6] },
  };
  const PLACES = {
    corner: { x: 1740, y: 886, size: 240 }, cornerL: { x: 180, y: 886, size: 240 },
    left: { x: 330, y: 880, size: 400 }, right: { x: 1590, y: 880, size: 400 }, center: { x: 960, y: 880, size: 440 },
  };
  const PLACES_P = { corner: { x: 170, y: 1440, size: 240 }, cornerL: { x: 170, y: 1440, size: 240 }, left: { x: 260, y: 1440, size: 380 }, right: { x: 820, y: 1440, size: 380 }, center: { x: 540, y: 1440, size: 420 } };

  /** mascot(o): the film's one mascot narrator: it stays on screen across pages (hops from where it stood on the last page
   *  to where this page puts it), talks while the voice speaks, blinks and breathes, and acts on cues. Call it once on
   *  every page (P.mascot({ hide: true }) on a page without it). The character is fixed for the whole film by the first page
   *  that names `who`: 'cat' (blue-grey), 'bear' (honey brown), 'bunny' (white), 'fox' (orange). Placement: `place`
   *  'corner' (default: small, bottom right, 240 px), 'cornerL', 'left' / 'right' (big, 400 px, standing on the floor
   *  line, for pages where the host is the picture), 'center'; or x, y (feet), size (px tall). acts: [[t, 'pose'], …]
   *  with poses idle happy point pointL pointR cheer think shock wave book calc nod shrug glasses sad; 'point' aims the
   *  paw at a target: [t, 'point', [x, y]]. say: [[t, '一句话'], [t2, null]] puts a short speech bubble by its head.
   *  P.bignum, P.pouch, P.calc and P.stamp already make it point and nod on their own. o: { who, place, x, y, size,
   *  acts, say, from (page time it pops in), until (page time it leaves), hide }
   *  The person's own character: who: 'custom', src: 'assets/brand/buzz.png' (a PNG with a transparent background, or an
   *  SVG), moods: { happy, shock, think, sad, worry, cheer, point, wave, … : picture path } (optional). The picture fits a
   *  box size tall and 1.2 × size wide, feet on (x, y), never stretched. It enters, hops between pages, breathes, bobs
   *  while talking and hops, nods and leans like the built-in hosts; on 'point' it leans towards the target and a small
   *  drawn glove reaches out (hand: false leaves the glove off, hand: 'yellow' colours it). When an act's name or mood has
   *  a picture in moods (an act may be any mood name: [t, 'worry']), that picture swaps in with a squash-pop; otherwise
   *  src stays. 'book' and 'calc' hold the notebook or the calculator in front of it. Like `who`, the first page sets it
   *  for the film; later pages may only add moods. */
  B.mascot = function (o = {}) {
    const e = entry(this);
    e.conf = { ...o };
    if (PV.preload && typeof o.src === 'string' && o.src) {
      PV.preload(o.src);
      for (const v of Object.values(o.moods || {})) if (typeof v === 'string' && v) PV.preload(v);
    }
  };

  // the host lives on the frame, above every page and outside the camera
  let hostSvg = null;
  const hostLayer = () => {
    if (hostSvg && hostSvg.isConnected) return hostSvg;
    hostSvg = PV.s('svg', { class: 'mascot-host', viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    Object.assign(hostSvg.style, { position: 'absolute', left: 0, top: 0, zIndex: 30, overflow: 'visible', pointerEvents: 'none' });
    document.getElementById('frame').appendChild(hostSvg);
    return hostSvg;
  };
  const isCustom = (c) => !!c && typeof c.src === 'string' && !!c.src && (c.who == null || c.who === 'custom' || !HOSTS[c.who]);
  /** the film's host: the first page that names one decides (a built-in `who`, or a custom picture); later pages may add moods */
  function filmHost(L) {
    let host = null;
    for (const p of L.pages) {
      const c = REG[p.id]?.conf;
      if (!c) continue;
      if (!host) {
        if (isCustom(c)) host = { who: 'custom', src: c.src, moods: {}, hand: c.hand };
        else if (c.who && HOSTS[c.who]) return { who: c.who };
      }
      if (host && c.moods && typeof c.moods === 'object' && (c.who == null || c.who === 'custom' || c.src)) {
        for (const [k, v] of Object.entries(c.moods)) if (typeof v === 'string' && v && !(k in host.moods)) host.moods[k] = v;
      }
    }
    return host || { who: 'cat' };
  }
  function confOf(pg) {
    const e = REG[pg.id], c = e?.conf || {};
    if (c.hide) return null;
    const PL = PORTRAIT ? PLACES_P : PLACES;
    const base = PL[c.place] || PL.corner;
    const size = clamp(c.size ?? base.size, 140, 560);
    const x = clamp(c.x ?? base.x, size * 0.45 + 10, W - size * 0.45 - 10);
    const y = clamp(c.y ?? base.y, size * 0.95, BOTTOM);
    const acts = (c.acts || []).filter((a) => Array.isArray(a) && typeof a[0] === 'number').map((a) => ({ t: a[0], name: a[1], target: a[2], own: true }));
    // reactions asked for by components, unless the page already says what the host does around then
    for (const [t, name, target] of e?.auto || []) {
      if (acts.some((a) => a.own && a.t > t - 0.5 && a.t < t + 0.9)) continue;
      acts.push({ t, name, target }, { t: t + 1.9, name: 'happy', after: true });
    }
    acts.sort((a, b) => a.t - b.t);
    return { x, y, size, acts, say: c.say || [], from: c.from, until: c.until };
  }
  function poseIn(c, lt, hx, hy, sc) {
    let cur = {}, prev = { armL: 10, armR: 10, tilt: 0 }, now = { armL: 10, armR: 10, tilt: 0 }, at = -1e9;
    const resolve = (a) => {
      const p = typeof a.name === 'string' ? (ACTS[a.name] || {}) : (a.name || {});
      const r = { armL: 10, armR: 10, tilt: 0, ...p, act: typeof a.name === 'string' ? a.name : null };
      if (p.point != null) {
        // aim one paw at the target (or towards the middle of the picture)
        const [tx, ty] = Array.isArray(a.target) ? a.target : [p.point === 0 ? W / 2 : hx + p.point * 600, p.point === 0 ? H * 0.45 : hy - sc * 200];
        const side = p.point === 0 || Array.isArray(a.target) ? (tx < hx ? -1 : 1) : p.point;
        const sxw = hx + side * 60 * sc, syw = hy - 116 * sc;
        const ang = clamp((Math.atan2(side * (tx - sxw), ty - syw) * 180) / Math.PI, 40, 170);
        r[side < 0 ? 'armL' : 'armR'] = ang; r[side < 0 ? 'reachL' : 'reachR'] = 1.25;
        r.look = [side * 0.9, clamp((ty - syw) / 400, -1, 1) * 0.6];
        r.tilt = side * 5; r.mood = r.mood || 'happy'; r.aim = [tx, ty]; r.side = side;
      }
      return r;
    };
    for (const a of c.acts) {
      if (Math.max(lt, 0) < a.t) break;
      prev = now; cur = resolve(a); now = cur; at = a.t;
    }
    const d = lt - at, k = spring(d), out = { ...cur };
    for (const f of ['armL', 'armR', 'tilt']) out[f] = lerp(prev[f] ?? (f === 'tilt' ? 0 : 10), now[f] ?? (f === 'tilt' ? 0 : 10), k);
    if (cur.wave) out.armR += 22 * Math.sin(d * 9);
    if (cur.nod) out.tilt = 7 * Math.sin(d * 8) * Math.exp(-d * 1.2);
    out.squash = d < 1.2 ? 1 - 0.08 * Math.exp(-d * 7) * Math.cos(d * 16) : 1;
    out.hop = cur.hop ? -60 * cur.hop * Math.sin(Math.PI * clamp(d / 0.4)) : 0;
    out.since = d; out.before = prev; out.k = k;
    return out;
  }
  function placeAt(pg, c, lt) {
    if (!c) return null;
    let vis = 1, dy = 0;
    if (c.from != null) { const k = clamp((lt - c.from) / 0.45); vis = k <= 0 ? 0 : 1; dy = -(1 - back(k)) * 200; }
    if (c.until != null && lt > c.until) vis *= 1 - clamp((lt - c.until) / 0.3);
    return { x: c.x, y: c.y + dy, size: c.size, vis };
  }
  function bubbleSVG(str, hx, hy, size) {
    const fs = 40, w = Math.min(560, tw(str, fs) + 70), hh = 92;
    const right = hx < W / 2;
    let bx = right ? hx + size * 0.3 : hx - size * 0.3 - w, by = hy - size * 1.05 - hh;
    bx = clamp(bx, 30, W - 30 - w); by = clamp(by, 30, BOTTOM - hh);
    const tx = hx + (right ? size * 0.12 : -size * 0.12), ty = hy - size * 0.85;
    const ax = clamp(tx, bx + 40, bx + w - 40), ay = by + hh;
    return S.drop(bx, by, w, hh, 36, 7) + S.rect(bx, by, w, hh, { r: 36, fill: 'white' }) +
      `<path d="M${n(ax - 22)} ${n(ay - 4)} L${n(tx)} ${n(ty)} L${n(ax + 22)} ${n(ay - 4)}" fill="white" stroke="${C('ink')}" stroke-width="${OUT}" stroke-linejoin="round"/>` +
      `<path d="M${n(ax - 19)} ${n(ay - 5)} H${n(ax + 19)}" stroke="white" stroke-width="7"/>` +
      S.text(bx + w / 2, by + hh / 2 + 2, str, { size: fs });
  }
  // ── the person's own character: a picture (PNG cut-out or SVG) instead of the drawn rig ──
  // The pictures sit in an HTML layer just under the host's SVG layer (the props and the bubble draw over them); the
  // glove's arm is drawn behind the picture, so it reaches out from the character's body.
  let picLayer = null, picShadow = null, picBack = null;
  const pics = new Map();
  const picEl = (src) => {
    if (!picLayer || !picLayer.isConnected) {
      picLayer = document.createElement('div');
      picLayer.className = 'mascot-pic';
      Object.assign(picLayer.style, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: 30, pointerEvents: 'none', overflow: 'visible' });
      hostLayer().before(picLayer);
      picShadow = document.createElement('div');
      Object.assign(picShadow.style, { position: 'absolute', left: 0, top: 0, borderRadius: '50%', background: 'rgba(120,80,40,0.16)' });
      picLayer.appendChild(picShadow);
      picBack = PV.s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, picLayer);
      Object.assign(picBack.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
      pics.clear();
    }
    let im = pics.get(src);
    if (!im) {
      const base = PV.preload ? PV.preload(src) : Object.assign(new Image(), { src });
      im = base.cloneNode();
      im.alt = '';
      Object.assign(im.style, { position: 'absolute', left: 0, top: 0, objectFit: 'contain', objectPosition: '50% 100%', transformOrigin: '50% 100%', display: 'none', maxWidth: 'none' });
      im._base = base;
      picLayer.appendChild(im);
      pics.set(src, im);
    }
    return im;
  };
  /** the picture's drawn box for a host px tall: fits size tall × 1.2 size wide, keeps its aspect */
  const picBox = (im, px) => {
    const b = im._base || im, a = b.naturalWidth > 0 && b.naturalHeight > 0 ? b.naturalWidth / b.naturalHeight : 1;
    const hh = Math.min(px, (px * 1.2) / a);
    return { w: hh * a, h: hh };
  };
  const MOOD_ALIAS = { pointL: 'point', pointR: 'point', nod: 'happy', wave: 'happy', cheer: 'happy', book: 'think', calc: 'think', shrug: 'think', glasses: 'think', shock: 'worry', sad: 'worry' };
  /** which picture an act shows: its own name, its mood, then a near mood; else the main picture */
  const picKey = (host, p) => {
    for (const k of [p && p.act, p && p.mood, p && p.act && MOOD_ALIAS[p.act], p && p.mood && MOOD_ALIAS[p.mood]]) if (k && host.moods[k]) return k;
    return null;
  };
  /** a small cartoon glove on a short arm from (x0, y0), pointing at angle ang (deg, screen), u = px per host unit */
  const glove = (x0, y0, ang, u, len, color) => {
    const a = (ang * Math.PI) / 180, x1 = x0 + Math.cos(a) * len * u, y1 = y0 + Math.sin(a) * len * u;
    const fill = C(color || 'white');
    return S.path(`M${n(x0)} ${n(y0)} L${n(x1)} ${n(y1)}`, { fill: 'none', sw: 30 * u, stroke: 'ink' }) +
      S.path(`M${n(x0)} ${n(y0)} L${n(x1)} ${n(y1)}`, { fill: 'none', sw: 30 * u - 2 * OUT, stroke: fill }) +
      `<g transform="translate(${n(x1)} ${n(y1)}) rotate(${n(ang)}) scale(${n(u)})">` +
      S.path('M-6 -20 Q20 -24 26 -10 L52 -12 Q62 -6 52 0 L26 2 Q22 22 -6 20 Q-20 0 -6 -20 Z', { fill }) +
      S.path('M8 -12 Q4 0 8 12', { fill: 'none', sw: 3.5, stroke: 'soft' }) + '</g>';
  };
  function customHost(host, here, pose, state, s2, bob, t) {
    const px = s2 * 300, u = px / 300;
    const cur = picKey(host, pose), before = picKey(host, pose.before);
    const since = pose.since ?? 9;
    // the picture swap: the old one squashes down, the new one pops up with an overshoot
    let show = cur, sy = state.squash ?? 1, sx = 1 + (1 - sy) * 0.6;
    if (cur !== before && since < 0.45) {
      if (since < 0.07) { const q = since / 0.07; show = before; sy *= 1 - 0.16 * q; sx *= 1 + 0.08 * q; }
      else { const q = back(clamp((since - 0.07) / 0.32)); sy *= 0.84 + 0.16 * q; sx *= 1.08 - 0.08 * q; }
    }
    sy *= 1 + 0.012 * (state.talk || 0);
    const src = show ? host.moods[show] : host.src;
    const im = picEl(src);
    for (const [k, other] of pics) if (k !== src && other.style.display !== 'none') other.style.display = 'none';
    const box = picBox(im, px), full = picBox(im, here.size);
    // lean towards a target, a nod, a slow idle sway; the built-in rig's tilt is gentler, a picture leans further
    const lean = (pose.tilt || 0) * (pose.aim ? 1.6 : 1) + wave(t, 3.3, 1.2);
    const x = clamp(here.x, box.w / 2 + 10, W - box.w / 2 - 10), y = here.y + (pose.hop || 0) * u + bob;
    picLayer.style.display = '';
    Object.assign(im.style, {
      display: 'block', width: n(box.w) + 'px', height: n(box.h) + 'px', opacity: here.vis.toFixed(3),
      transform: `translate(${n(x - box.w / 2)}px, ${n(y - box.h)}px) rotate(${n(lean)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
    });
    const shW = box.w * 0.62 * (1 + (pose.hop || 0) / 600);
    Object.assign(picShadow.style, { width: n(shW) + 'px', height: n(shW * 0.18) + 'px', opacity: here.vis.toFixed(3),
      transform: `translate(${n(here.x - shW / 2)}px, ${n(here.y + 4 * u - shW * 0.09)}px)` });
    // what the picture cannot do itself is drawn beside it: the pointing glove, the wave, the sweat drop, the held prop
    let svg = '', backSvg = '';
    const hand = host.hand === false ? null : typeof host.hand === 'string' ? host.hand : 'white';
    // a point on the picture (dx from its centre line, up from its feet) after the lean
    const rl = (lean * Math.PI) / 180, on = (dx, up) => [x + dx * Math.cos(rl) + up * Math.sin(rl), y + dx * Math.sin(rl) - up * Math.cos(rl)];
    if (hand && pose.aim && !(cur && cur.startsWith('point'))) {
      const side = pose.side || 1, g = back(clamp(since / 0.28));
      const [x0, y0] = on(side * box.w * 0.3, box.h * 0.5 * sy);
      const ang = (Math.atan2(pose.aim[1] - y0, pose.aim[0] - x0) * 180) / Math.PI;
      if (g > 0.02) backSvg += glove(x0, y0, ang, u * Math.min(1, g + 0.2), (box.w * 0.2) / u + 60 * g, hand);
    } else if (hand && pose.act === 'wave' && !host.moods.wave) {
      const side = x < W / 2 ? 1 : -1, [x0, y0] = on(side * box.w * 0.3, box.h * 0.6 * sy);
      backSvg += glove(x0, y0, -90 + side * (35 + 22 * Math.sin(since * 9)), u, (box.w * 0.2) / u + 56, hand);
    }
    const [swx, swy] = on(box.w * 0.4, box.h * 0.88 * sy);
    if (state.sweat && !host.moods[pose.act]) svg += `<g transform="translate(${n(swx)} ${n(swy)}) scale(${n(u * 1.4)})">` + S.path('M0 -14 q12 18 0 26 q-12 -8 0 -26 Z', { fill: 'blueF', sw: 3.5, stroke: 'blue' }) + '</g>';
    if (state.hold && !host.moods[pose.act]) {
      const hold = state.hold === 'calc' ? CALC : NOTEBOOK, sc0 = state.hold === 'calc' ? 0.78 : 1;
      svg += `<g transform="translate(${n(x)} ${n(y - 70 * u)}) rotate(-4) scale(${n(u * sc0)})">${hold}</g>`;
    }
    const behind = backSvg ? `<g opacity="${here.vis.toFixed(3)}">${backSvg}</g>` : '';
    if (picBack._last !== behind) { picBack._last = behind; picBack.innerHTML = behind; }
    return { svg: `<g opacity="${here.vis.toFixed(3)}">${svg}</g>`, h: Math.max(full.h, here.size * 0.5) };
  }

  window.FRAME_HOOKS = (window.FRAME_HOOKS || []).concat([(t, L) => {
    const el = hostLayer(), pages = L.pages;
    const host = filmHost(L), who = host.who;
    if (who !== 'custom' && picLayer && picLayer.isConnected) picLayer.style.display = 'none';
    let i = 0;
    for (const p of pages) if (t >= p.start - 0.35) i = p.index;
    const pg = pages[i], c = confOf(pg), prev = pages[i - 1], pc = prev ? confOf(prev) : null;
    let here = placeAt(pg, c, t - pg.start);
    const k = clamp((t - (pg.start - 0.35)) / 0.8);
    if (pc && c && k < 1 && (c.from == null || c.from <= 0)) {
      const there = placeAt(prev, pc, prev.speechEnd - prev.start);
      if (there && there.vis > 0) {
        const e = ease.inOut(k), far = Math.hypot(here.x - there.x, here.y - there.y) > 20;
        here = { ...here, x: lerp(there.x, here.x, e), y: lerp(there.y, here.y, e) - (far ? 110 * Math.sin(Math.PI * e) : 0), size: lerp(there.size, here.size, e) };
      }
    } else if (pc && !c && k < 1) {
      const there = placeAt(prev, pc, prev.speechEnd - prev.start);
      if (there && there.vis > 0) here = { ...there, vis: there.vis * (1 - clamp(k / 0.5)) };
    } else if (!pc && c && i === 0 && c.from == null) {
      const q = clamp((t - 0.15) / 0.5); here.vis *= q > 0 ? 1 : 0; here.y -= (1 - back(q)) * 200;
    }
    if (!here || here.vis <= 0.001) { if (el.innerHTML) el.innerHTML = ''; if (picLayer) picLayer.style.display = 'none'; return; }
    const sc = here.size / 300, lt = t - pg.start;
    const pose = c ? poseIn(c, lt, here.x, here.y, sc) : {};
    let sp = 0;
    if (c) for (const [j, q] of pg.cues.entries()) if (t >= q.start && t < q.start + (q.dur ?? q.end - q.start)) sp = j + 1;
    const talk = sp ? 0.1 + 0.6 * Math.abs(Math.sin(t * 14 + sp)) * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0;
    const bob = sp ? -3 * Math.abs(Math.sin(t * 7.5)) : 0;
    const state = { blink: blink(t, 3.6, 0.5), ...pose, talk: pose.mood === 'shock' ? 0 : talk, squash: (pose.squash ?? 1) * (1 + wave(t, 2.6, 0.012)) };
    const s2 = sc * (here.vis < 1 ? 0.6 + 0.4 * here.vis : 1);
    let svg, headH = here.size;
    if (who === 'custom') {
      const r = customHost(host, here, pose, state, s2, bob, t);
      svg = r.svg; headH = r.h;
    } else svg = `<g opacity="${here.vis.toFixed(3)}" transform="translate(${n(here.x)} ${n(here.y + (pose.hop || 0) * sc + bob)}) scale(${s2.toFixed(4)})">${hostSVG(who, state, t)}</g>`;
    if (c && c.say.length && here.vis > 0.9) {
      let line = null, at = 0;
      for (const [st0, str] of c.say) if (lt >= st0) { line = str; at = st0; }
      if (line) { const q = back(clamp((lt - at) / 0.35)); const bs = bubbleSVG(String(line), here.x, here.y, headH); svg += `<g transform="translate(${n(here.x)} ${n(here.y - headH)}) scale(${q.toFixed(3)}) translate(${n(-here.x)} ${n(-(here.y - headH))})">${bs}</g>`; }
    }
    if (el._last !== svg) { el._last = svg; el.innerHTML = svg; }
  }]);

  // ── side characters (people in the story) ──
  const LOOK = {
    man: { hair: '#4A3428', shirt: 'blue', pants: '#3E4F6E' },
    woman: { hair: '#5B3A2A', shirt: 'red', pants: '#4B4458', long: true },
    grandma: { hair: '#D8D2CC', shirt: 'purple', pants: '#5E5470', glasses: true },
    grandpa: { hair: '#E4E0DA', shirt: 'green', pants: '#5A5146', glasses: true },
    kid: { hair: '#2F2622', shirt: 'yellow', pants: '#4A9BE0' },
    worker: { hair: '#2F2622', shirt: 'orange', pants: '#3E4F6E', tie: true },
  };
  function hair(kind, L) {
    const c = L.hair;
    if (kind === 'grandma') return S.circle(0, -330, 26, { fill: c }) + S.path('M-64 -250 Q-70 -330 0 -326 Q70 -330 64 -250 Q50 -292 0 -296 Q-50 -292 -64 -250 Z', { fill: c });
    if (kind === 'grandpa') return S.path('M-64 -246 Q-70 -278 -52 -290 Q-48 -268 -60 -240 Z', { fill: c }) + S.path('M64 -246 Q70 -278 52 -290 Q48 -268 60 -240 Z', { fill: c });
    if (kind === 'kid') return S.path('M-62 -258 Q-60 -328 0 -326 Q60 -328 62 -258 Q40 -300 6 -296 Q-30 -306 -62 -258 Z', { fill: c }) + S.path('M-6 -324 q-6 -26 14 -30 q-2 16 2 28 Z', { fill: c });
    if (kind === 'woman') return S.path('M-70 -170 Q-84 -330 0 -330 Q84 -330 70 -170 Q60 -200 58 -250 Q30 -290 -4 -292 Q-40 -280 -58 -250 Q-60 -200 -70 -170 Z', { fill: c });
    return S.path('M-64 -250 Q-70 -326 4 -328 Q72 -326 64 -250 Q58 -286 30 -296 Q4 -282 -30 -298 Q-56 -288 -64 -250 Z', { fill: c });
  }
  function heldProp(name, x, y, ang) {
    const g = (s) => `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(ang)})">${s}</g>`;
    if (name === 'phone') return g(S.rect(-22, -40, 44, 74, { r: 9, fill: '#3F4A5A', sw: 4 }) + S.rect(-16, -32, 32, 54, { r: 5, fill: '#BDE3FF', stroke: 'none' }));
    if (name === 'card') return g(S.rect(-36, -24, 72, 46, { r: 7, fill: 'yellow', sw: 4 }) + S.rect(-36, -12, 72, 9, { r: 0, fill: 'ink', stroke: 'none' }));
    if (name === 'money') return g(S.rect(-40, -24, 80, 48, { r: 6, fill: 'greenF', sw: 4 }) + S.text(0, 0, '¥', { size: 30, fill: 'green' }));
    if (name === 'bag') return g(S.rect(-32, -30, 64, 60, { r: 8, fill: 'orangeF', sw: 4 }) + S.path('M-14 -30 Q0 -56 14 -30', { fill: 'none', sw: 4 }));
    return '';
  }
  function personSVG(kind, s = {}) {
    const L = LOOK[kind] || LOOK.man, small = kind === 'kid';
    const arm = (side, ang) => {
      const a = (ang * Math.PI) / 180, len = 92, x0 = side * 44, y0 = -176;
      const x1 = x0 + side * Math.sin(a) * len, y1 = y0 + Math.cos(a) * len, mx = (x0 + x1) / 2 + side * 10, my = (y0 + y1) / 2;
      return { x1, y1, svg: S.path(`M${n(x0)} ${n(y0)} Q${n(mx)} ${n(my)} ${n(x1)} ${n(y1)}`, { fill: 'none', sw: 26, stroke: 'ink' }) +
        S.path(`M${n(x0)} ${n(y0)} Q${n(mx)} ${n(my)} ${n(x1)} ${n(y1)}`, { fill: 'none', sw: 16, stroke: L.shirt }) + S.circle(x1, y1, 13, { fill: 'skin', sw: 4 }) };
    };
    const aL = arm(-1, s.armL ?? 8), aR = arm(1, s.armR ?? (s.hold ? 50 : 8));
    const eye = (cx) => (s.mood === 'happy' ? S.path(`M${cx - 10} -254 Q${cx} -268 ${cx + 10} -254`, { fill: 'none', sw: 5 })
      : s.mood === 'shock' ? S.circle(cx, -256, 12, { fill: 'white', sw: 4 }) + S.circle(cx, -256, 4.5, { fill: 'ink', stroke: 'none' })
        : S.ellipse(cx + (s.look?.[0] || 0) * 3, -256, 7, 9.5 * (1 - Math.min(1, s.blink || 0) * 0.9), { fill: 'ink', stroke: 'none' }));
    const fc = eye(-24) + eye(24) +
      S.ellipse(-40, -232, 11, 7, { fill: 'pink', stroke: 'none', op: 0.85 }) + S.ellipse(40, -232, 11, 7, { fill: 'pink', stroke: 'none', op: 0.85 }) +
      mouthSVG(0, -224, 34, s, 'person') +
      (L.glasses ? S.circle(-24, -256, 17, { fill: 'none', sw: 4 }) + S.circle(24, -256, 17, { fill: 'none', sw: 4 }) + S.line(-7, -258, 7, -258, { sw: 4 }) : '') +
      (s.mood === 'worry' || s.mood === 'sad' || s.sweat ? S.path('M70 -290 q10 16 0 22 q-10 -6 0 -22 Z', { fill: 'blueF', sw: 3.5, stroke: 'blue' }) : '');
    return S.floor(0, 2, 70) +
      `<g transform="scale(${small ? 0.82 : 1})">` +
      S.rect(-34, -96, 28, 92, { r: 12, fill: L.pants }) + S.rect(6, -96, 28, 92, { r: 12, fill: L.pants }) +
      S.ellipse(-22, -6, 24, 11, { fill: '#5A4636', sw: 4 }) + S.ellipse(22, -6, 24, 11, { fill: '#5A4636', sw: 4 }) +
      `<g transform="translate(0 ${n(s.bob || 0)})">` +
      S.rect(-50, -196, 100, 116, { r: 34, fill: L.shirt }) +
      (L.tie ? S.path('M-8 -190 L8 -190 L12 -130 L0 -116 L-12 -130 Z', { fill: 'blue', sw: 3.5 }) : '') +
      aL.svg + aR.svg + heldProp(s.hold, aR.x1 + 4, aR.y1 - 26, -(s.armR ?? 50) * 0.3) +
      S.rect(-12, -206, 24, 22, { r: 6, fill: 'skin', sw: 4 }) +
      S.circle(0, -250, 64, { fill: 'skin' }) + hair(kind, L) + fc + '</g></g>';
  }

  /** person(kind, x, y, o): a person in the story (not the host): 'man', 'woman', 'worker' (shirt and tie), 'grandma',
   *  'grandpa', 'kid'; round head, dot eyes, rosy cheeks, feet on (x, y), about o.size px tall (default 300). Use them
   *  for "you", your parents, a colleague, a shop assistant. o: { size, at, out, mood (fn: calm happy shock worry sad
   *  think), hold ('phone' | 'card' | 'money' | 'bag'), armL / armR (deg, fn), look, in } */
  B.person = function (kind, x, y, o = {}) {
    const size = o.size ?? 300, seed = (x * 0.013 + y * 0.007) % 3;
    [x, y] = [clamp(x, size * 0.3, W - size * 0.3), clamp(y, size, BOTTOM)];
    return svgEl(this, (t, lt) => personSVG(kind, { bob: wave(lt, 2.4, 2, seed), blink: blink(lt, 3.9, seed * 2.3), mood: val(o.mood, lt), hold: val(o.hold, lt), armL: val(o.armL, lt), armR: val(o.armR, lt), look: val(o.look, lt) }), { ...o, x, y, s: size / 340 });
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Lettering
  // ════════════════════════════════════════════════════════════════════════════════════════════════

  /** title(str, o): the page heading: big rounded lettering centred at the top (y ≈ 110), popping in with a bounce.
   *  Colour one key word with markup: '交房租，也能提{o:公积金}了'. One line, ≤ 16 汉字 / about 8 words. o: { at, sub (a
   *  smaller grey line under it), color, size (default 80), align ('c' default, 'l' to sit top left) } */
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.1;
    const size = Math.min(o.size ?? 80, ((STAGE.area.x1 - STAGE.area.x0) / Math.max(1, tw(str, 1))) | 0);
    const left = o.align === 'l';
    text(T, str, { x: left ? STAGE.title.x - 10 : W / 2, y: STAGE.title.y + (o.sub ? 14 : 30), size, at, color: o.color, align: left ? 'l' : 'c', cls: 'title' });
    if (o.sub) text(T, o.sub, { x: left ? STAGE.title.x - 6 : W / 2, y: STAGE.title.y + 90, size: 38, color: 'soft', at: at + 0.25, align: left ? 'l' : 'c', in: 'rise', shadow: false });
  };

  /** headline(str, x, y, o): a big line of rounded lettering centred on (x, y) that pops in: a key word, a rule, a
   *  question. Markup colours words ({o:…} orange, {r:…} coral, {g:…} mint, {b:…} sky, {p:…} lavender). o: { size
   *  (default 64), color, at, out, align ('c' | 'l' | 'r'), in ('pop' | 'rise' | 'fade' | 'drop') } */
  B.headline = function (str, x, y, o = {}) {
    const size = o.size ?? 64, w = tw(str, size);
    if (o.align !== 'l' && o.align !== 'r') [x, y] = fitT(this, x, y, w, size * 1.3);
    return text(this, str, { ...o, x, y, size });
  };

  /** bignum(x, y, value, o): THE number of the beat: a huge rounded number centred on (x, y) that pops in and counts up
   *  from o.from (default 0) to value, lands with a bump, and the host points its paw at it. Time it so it lands as the
   *  number is spoken: at: P.cw(i, '3600') - 0.6. o: { at, dur (count time, default 0.8), from, unit ('元', '%', '万',
   *  ' a year'), prefix ('¥', '$', '+'), label (small grey line above), color (default 'orange'), size (default 150),
   *  decimals, plus (show +), sep (thousands commas; auto above 9999), out, point (false: the host doesn't point) } */
  B.bignum = function (x, y, value, o = {}) {
    const size = o.size ?? 150, at = o.at ?? 0, dur = o.dur ?? 0.8, from = o.from ?? 0;
    const est = tw(fmtNum(value, o), size) + (o.unit ? tw(o.unit, size * 0.5) : 0) + (o.prefix ? tw(o.prefix, size * 0.62) : 0);
    [x, y] = fitT(this, x, y, est + 20, size * 1.2 + (o.label ? 110 : 0));
    const H = text(this, '', { x, y, size, color: o.color || 'orange', at, out: o.out, cls: 'num', anim: (t) => ({ s: 1 + 0.08 * Math.sin(Math.PI * clamp((t - dur) / 0.25)) }) });
    let last = null;
    this.tick((lt) => {
      const k = ease.out(clamp((lt - at) / dur)), v = from + (value - from) * k;
      const s = `${o.prefix ? `<span class="pre">${esc(o.prefix)}</span>` : ''}${fmtNum(k >= 1 ? value : v, o)}${o.unit ? `<span class="u">${esc(o.unit)}</span>` : ''}`;
      if (s !== last) { last = s; H.el.innerHTML = s; }
    });
    if (o.label) text(this, o.label, { x, y: y - size * 0.62 - 26, size: 44, color: 'soft', at: Math.max(0, at - 0.25), out: o.out, in: 'rise', shadow: false });
    if (o.point !== false) cue(this, at, 'point', [x, y]);
    return H;
  };

  /** calc(x, y, rows, o): the host does the sum with you: lines of a calculation written one under another from (x, y)
   *  (left edge), each popping in on its own time, then a rule and the result counting up in a big number. rows:
   *  ['每月扣 {o:3000}', '× 12 个月', '× 税率 {b:10%}'] or [{ t: '…', at }]. o: { at, gap (s between rows, default 0.8),
   *  size (default 60), result: { value, unit, prefix, label ('少交'), at, color } } */
  B.calc = function (x, y, rows, o = {}) {
    const size = o.size ?? 60, lh = size * 1.45, at0 = o.at ?? 0, gap = o.gap ?? 0.8;
    const wMax = Math.max(...rows.map((r) => tw(typeof r === 'string' ? r : r.t, size)), 300);
    { const z = zoneOf(this); const lo = z === 'left' ? 660 : 60, hi = (z === 'right' ? 1260 : z === 'corner' ? 1560 : W - 60) - Math.max(wMax, 460); x = clamp(x, lo, Math.max(lo, hi)); }
    const tot = rows.length * lh + (o.result ? size * 2.6 : 0);
    y = clamp(y, TOP + 10, Math.max(TOP + 10, BOTTOM - tot));
    let tEnd = at0;
    rows.forEach((r, i) => {
      const str = typeof r === 'string' ? r : r.t, at = typeof r === 'string' ? at0 + i * gap : r.at ?? at0 + i * gap;
      tEnd = Math.max(tEnd, at);
      text(this, str, { x, y: y + i * lh, size, align: 'l', at, in: 'slideL', out: o.out });
    });
    if (o.result) {
      const R = o.result, ry = y + rows.length * lh + 10, rat = R.at ?? tEnd + gap;
      svgEl(this, S.line(0, 0, Math.max(wMax, 420) + 40, 0, { sw: 6 }), { x: x - 20, y: ry - lh * 0.3, at: rat - 0.3, in: 'fade', out: o.out });
      const rs = R.size ?? size * 1.7;
      const lab = R.label ? text(this, R.label, { x, y: ry + rs * 0.45, size: size * 1.05, align: 'l', at: rat, out: o.out }) : null;
      const lx = x + (R.label ? tw(R.label, size * 1.05) + 24 : 0);
      const H = text(this, '', { x: lx, y: ry + rs * 0.45, size: rs, align: 'l', color: R.color || 'orange', at: rat, out: o.out, cls: 'num' });
      let last = null;
      this.tick((lt) => {
        const k = ease.out(clamp((lt - rat) / 0.8)), v = (R.from ?? 0) + (R.value - (R.from ?? 0)) * k;
        const s = `${R.prefix ? `<span class="pre">${esc(R.prefix)}</span>` : ''}${fmtNum(k >= 1 ? R.value : v, R)}${R.unit ? `<span class="u">${esc(R.unit)}</span>` : ''}`;
        if (s !== last) { last = s; H.el.innerHTML = s; }
      });
      cue(this, rat, 'point', [lx + 120, ry + rs * 0.45]);
      return { result: H, label: lab };
    }
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Stickers, tags and stamps
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const DARK = new Set(['red', 'orange', 'green', 'blue', 'purple', 'ink', 'soft', 'brown']);

  /** pill(x, y, str, o): a sticker pill: a rounded capsule with a thick outline and a dropped edge, text inside, centred
   *  on (x, y). For short labels on things ("每年至少 4 笔", "3 天给答复", "Deadline"): ≤ 10 汉字 / 4 words. Strong
   *  colours get white text, light ones (yellow, xxxF, white) ink. o: { color (default 'yellow'), size (default 44),
   *  at, out, tilt (deg), w } */
  B.pill = function (x, y, str, o = {}) {
    const size = o.size ?? 44, c = o.color || 'yellow';
    const w = o.w ?? Math.max(size * 2, tw(str, size) + size * 1.2), hh = size * 1.7;
    [x, y] = fitT(this, x, y, w, hh + 10);
    const svg = S.drop(-w / 2, -hh / 2, w, hh, hh / 2, 8) + S.rect(-w / 2, -hh / 2, w, hh, { r: hh / 2, fill: c }) +
      S.text(0, 2, str, { size, fill: o.tcolor || (DARK.has(c) ? 'white' : 'ink') });
    return svgEl(this, svg, { ...o, x, y, rot: o.tilt || 0 });
  };

  /** pricetag(x, y, top, big, o): a hanging price tag on a string from (x, y): small grey line on top ("月费"), the big
   *  value under it ("¥ 25"); it drops in and swings, then sways. o: { color (fill, default 'yellowF'), w (default 300),
   *  h (default 190), at, out, swing (1 | -1) } */
  B.pricetag = function (x, y, top, big, o = {}) {
    const w = o.w ?? Math.max(300, tw(big, 64) + 70, tw(top, 42) + 70), hh = o.h ?? 190, c = o.color || 'yellowF';
    [x] = fitT(this, x, 600, w, 10); y = clamp(y, TOP - 20, BOTTOM - hh - 60);
    const body = `M${-w / 2} ${-hh / 2 + 34} L${-w / 2 + 34} ${-hh / 2} L${w / 2 - 34} ${-hh / 2} L${w / 2} ${-hh / 2 + 34} L${w / 2} ${hh / 2} L${-w / 2} ${hh / 2} Z`;
    const svg = S.line(0, 0, 0, 46, { sw: 4, stroke: 'soft' }) + `<g transform="translate(0 ${46 + hh / 2})">` +
      `<path d="${body}" transform="translate(0 8)" fill="${EXTRA.shadow}"/>` + S.path(body, { fill: c }) + S.circle(0, -hh / 2 + 22, 9, { fill: 'paper', sw: 4 }) +
      S.text(0, -hh / 2 + 70, top, { size: 42, fill: 'soft' }) + S.text(0, hh / 2 - 46, big, { size: o.bsize ?? 64 }) + '</g>';
    const sw = o.swing ?? 1;
    return svgEl(this, svg, { in: 'drop', ...o, x, y, anim: (t, lt) => ({ rot: sw * 6 * Math.sin(t * 2.4) * Math.exp(-t * 0.6) + sw * 1.4 * Math.sin(lt * 1.3) }) });
  };

  const stampScale = (t) => (t <= 0 ? 0 : t < 0.16 ? 2.3 - 1.4 * ease.out(t / 0.16) : 0.9 + 0.1 * back(clamp((t - 0.16) / 0.3)));
  /** stamp(x, y, str, o): the verdict stamp: a round rubber stamp (double ring, the word inside) that slams down from
   *  big to its size, tilted, and the host nods. The ending of a decision: '划算', '别买', '已退回', 'Worth it', 'Skip'.
   *  ≤ 3 汉字 / 1–2 short words. o: { color ('red' default; 'green' for yes, 'blue' for official), r (radius, default
   *  95), sub (tiny line under the word), at, out, rot (default -12) } */
  B.stamp = function (x, y, str, o = {}) {
    const r = o.r ?? 95, c = o.color || 'red', at = o.at ?? 0;
    [x, y] = fitT(this, x, y, r * 2.2, r * 2.2);
    const lat = /^[\x00-\xff]+$/.test(str), fs = lat ? Math.min(r * 0.62, (r * 1.55) / Math.max(1, tw(str, 1))) : r * (str.length > 2 ? 0.5 : str.length > 1 ? 0.62 : 1.0);
    const svg = S.circle(0, 0, r, { fill: 'rgba(255,255,255,0.6)', stroke: c, sw: 10 }) + S.circle(0, 0, r - 17, { fill: 'none', stroke: c, sw: 4 }) +
      S.text(0, o.sub ? -10 : 3, str, { size: fs, fill: c }) + (o.sub ? S.text(0, r * 0.48, o.sub, { size: r * 0.2, fill: c }) : '');
    cue(this, at + 0.15, c === 'red' ? 'shock' : 'nod');
    return svgEl(this, svg, { in: 'fade', dur: 0.05, ...o, at, x, y, rot: 0, anim: (t) => ({ s: stampScale(t), rot: o.rot ?? -12 }) });
  };

  /** verdict(kind, x, y, o): a round tick or cross sticker that pops on: 'yes' (mint disc, white tick), 'no' (coral
   *  disc, white cross), 'ask' (sky disc, ?), 'warn' (yellow disc, !). o: { size (default 110), at, out } */
  B.verdict = function (kind, x, y, o = {}) {
    const sz = o.size ?? 110;
    const disc = { yes: 'green', no: 'red', ask: 'blue', warn: 'yellow' }[kind] || 'green';
    const glyph = kind === 'no' ? S.path('M-18 -18 L18 18 M18 -18 L-18 18', { fill: 'none', stroke: 'white', sw: 12 })
      : kind === 'ask' ? S.text(0, 3, '?', { size: 64, fill: 'white' }) : kind === 'warn' ? S.text(0, 3, '!', { size: 64, fill: 'ink' })
        : S.path('M-22 2 L-6 18 L24 -16', { fill: 'none', stroke: 'white', sw: 12 });
    return svgEl(this, S.circle(0, 5, 44, { fill: EXTRA.shadow, stroke: 'none' }) + S.circle(0, 0, 44, { fill: disc }) + glyph, { ...o, x, y, s: sz / 100 });
  };

  /** bubble(x, y, str, o): a speech bubble for a person in the story (the host has its own: P.mascot say), centred on
   *  (x, y), its tail pointing at o.tail [x, y] (the speaker's mouth). One short line. o: { tail, size (default 46), at,
   *  out, w, fill } */
  B.bubble = function (x, y, str, o = {}) {
    const size = o.size ?? 46, w = o.w ?? tw(str, size) + 80, hh = size * 2.2;
    [x, y] = fitT(this, x, y, w, hh);
    const [tx, ty] = o.tail || [x - w * 0.25, y + hh / 2 + 60];
    const px = tx - x, py = ty - y, bx = clamp(px, -w / 2 + 40, w / 2 - 40), by = py > 0 ? hh / 2 : -hh / 2, d = py > 0 ? -1 : 1;
    const fill = o.fill || 'white';
    const svg = S.drop(-w / 2, -hh / 2, w, hh, 36, 8) + S.rect(-w / 2, -hh / 2, w, hh, { r: 36, fill }) +
      `<path d="M${n(bx - 22)} ${n(by + d * 4)} L${n(px)} ${n(py)} L${n(bx + 22)} ${n(by + d * 4)}" fill="${C(fill)}" stroke="${C('ink')}" stroke-width="${OUT}" stroke-linejoin="round"/>` +
      `<path d="M${n(bx - 19)} ${n(by + d * 5)} H${n(bx + 19)}" stroke="${C(fill)}" stroke-width="8"/>` + S.text(0, 2, str, { size });
    return svgEl(this, svg, { ...o, x, y });
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Money
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const coinSVG = (r = 40, label = '¥') => S.ellipse(0, r * 0.16, r, r * 0.96, { fill: 'coinD' }) + S.circle(0, 0, r, { fill: 'coin' }) +
    S.circle(0, 0, r * 0.72, { fill: 'none', sw: 3.5, stroke: '#D19A16' }) + S.text(0, 2, label, { size: r * (String(label).length > 2 ? 0.6 : String(label).length > 1 ? 0.78 : 1.05), fill: 'coinT' });

  /** coin(x, y, o): a fat gold coin with a currency mark. With o.from [x, y] it flies there in an arc from that point
   *  (a refund coming back, money leaving). o: { r (default 40), label ('¥' default, '$', '€', '扣', '+1'), at, dur (flight,
   *  default 0.8), from, out } */
  B.coin = function (x, y, o = {}) {
    const from = o.from, dur = o.dur ?? 0.8;
    return svgEl(this, coinSVG(o.r ?? 40, o.label ?? '¥'), { ...o, x, y, in: from ? 'fade' : o.in, dur: from ? 0.1 : o.dur, anim: from ? (t) => {
      const k = ease.inOut(clamp(t / dur));
      return { dx: (from[0] - x) * (1 - k), dy: (from[1] - y) * (1 - k) - 200 * Math.sin(Math.PI * k), rot: 360 * (1 - k) };
    } : undefined });
  };

  function pouchSVG(o) {
    const c = o.color || 'orange', f = o.fill || c + 'F', op = clamp(o.open ?? 0), b = o.bulge ?? 0;
    const w = 140 + 22 * b, neck = 34 + 30 * op;
    let s = S.floor(0, 4, 130);
    s += S.path(`M${n(-neck)} -232 C${n(-neck - 6)} -196 ${n(-w - 30)} -170 ${n(-w)} -76 C${n(-w + 14)} -4 ${n(w - 14)} -4 ${n(w)} -76 C${n(w + 30)} -170 ${n(neck + 6)} -196 ${n(neck)} -232 Z`, { fill: f });
    s += S.path(`M${n(-neck - 18)} -232 Q${n(-neck - 34)} -276 ${n(-neck + 10)} -282 L${n(neck - 10)} -282 Q${n(neck + 34)} -276 ${n(neck + 18)} -232 Z`, { fill: f });
    s += S.path(`M${n(-neck - 6)} -236 Q0 ${n(-222 + 8 * op)} ${n(neck + 6)} -236`, { fill: 'none', stroke: c, sw: 10 });
    s += S.path(`M${n(neck)} -232 q36 6 40 34 M${n(neck)} -232 q20 18 10 44`, { fill: 'none', stroke: c, sw: 7 });
    if (o.label) {
      const ls = tw(o.label, 44) > 220 ? 36 : 44, lw = Math.max(170, tw(o.label, ls) + 44);
      s += S.rect(-lw / 2, -144, lw, 76, { r: 20, fill: 'white', stroke: c, sw: 5 }) + S.text(0, -106, o.label, { size: ls, fill: c });
    } else s += S.text(0, -110, '¥', { size: 90, fill: c });
    return s;
  }
  /** pouch(x, y, o): the money pouch, the signature move: a drawstring pouch standing on (x, y) (about 300 × 300); coins
   *  drop into it one by one from above, it bulges with each, and the running total above it counts up to o.total while
   *  the host points at it. Follow it with P.stamp for the verdict. o: { label ('公积金', 'Savings'), color (default
   *  'orange'; 'blue' 'green' 'purple' 'red' 'yellow'), coins (how many fall, default 6; 0 = an empty pouch), at (pouch
   *  arrives), drop (when the coins start, default at + 0.6), dur (all coins, default 1.8), total, unit, prefix, from (the
   *  total counts from it, default 0), size (scale, default 1; 1.2–1.5 when it is the page's main thing), out } */
  B.pouch = function (x, y, o = {}) {
    const sc = o.size ?? 1, at = o.at ?? 0, N = o.coins ?? 6, t0 = o.drop ?? at + 0.6, dur = o.dur ?? 1.8;
    const ns = o.numSize ?? 110;
    [x] = fitT(this, x, y - 150 * sc, 380 * sc, 300 * sc);
    y = clamp(y, TOP + 300 * sc + (o.total != null ? 30 + ns * 1.2 : 10), BOTTOM - 10);
    const H = svgEl(this, (t, lt) => {
      let got = 0, coins = '';
      for (let i = 0; i < N; i++) {
        const ti = t0 + (N > 1 ? (i * dur) / N : 0), k = clamp((lt - ti) / 0.45);
        if (k <= 0) continue;
        if (k >= 1) { got++; continue; }
        const yy = -340 + (-250 + 340) * ease.in(k), xx = ((i % 3) - 1) * 26;
        coins += `<g transform="translate(${n(xx)} ${n(yy)}) rotate(${n(i * 40 + k * 120)}) scale(0.7)">${coinSVG(40)}</g>`;
      }
      const lastLand = N ? t0 + ((N - 1) * dur) / N + 0.45 : 0, bump = N && got ? 0.06 * Math.exp(-(lt - (t0 + ((got - 1) * dur) / N + 0.45)) * 8) : 0;
      const open = N ? clamp((lt - (t0 - 0.3)) / 0.3) * (1 - clamp((lt - lastLand - 0.2) / 0.3)) : 0;
      return coins + `<g transform="scale(${n(1 + bump)} ${n(1 - bump)})">${pouchSVG({ ...o, open, bulge: N ? got / N : 0.6 })}</g>`;
    }, { in: 'drop', ...o, at, x, y, s: sc });
    if (o.total != null) {
      const ty = y - 290 * sc - 30 - ns * 0.55;
      const tot = this.bignum(x, ty, o.total, { at: t0, dur: dur + 0.4, from: o.from, unit: o.unit, prefix: o.prefix, size: ns, color: o.color || 'orange', out: o.out, sep: o.sep, decimals: o.decimals });
      H.total = tot;
    }
    return H;
  };

  /** receipt(x, y, rows, o): a paper receipt or pay slip centred on (x, y) with a zigzag bottom; rows print one by one:
   *  [['本月工资', '10000'], ['个税', '−290', 'red']]; a bold total line can close it. o: { title, total: ['实发', '9710',
   *  'green'], w (default 680), at, gap (s between rows, default 0.45), out } */
  B.receipt = function (x, y, rows, o = {}) {
    const w = o.w ?? 680, rh = 80, head = o.title ? 104 : 24, hh = head + (rows.length + (o.total ? 1.3 : 0)) * rh + 34;
    [x, y] = fitT(this, x, y, w, hh + 20);
    const at = o.at ?? 0, gap = o.gap ?? 0.45;
    const N = Math.round(w / 30), step = w / N;
    const zig = Array.from({ length: N + 1 }, (_, j) => { const i = N - j; return `L${n(-w / 2 + i * step)} ${n(hh / 2 + (i % 2 ? 12 : 0))}`; }).join(' ');
    const body = `M${n(-w / 2)} ${n(-hh / 2)} H${n(w / 2)} V${n(hh / 2)} ${zig} Z`;
    return svgEl(this, (t) => {
      let s = `<path d="${body}" transform="translate(0 10)" fill="${EXTRA.shadow}"/>` + S.path(body, { fill: 'white' });
      if (o.title) s += S.text(0, -hh / 2 + 54, o.title, { size: 52 }) + S.line(-w / 2 + 30, -hh / 2 + 92, w / 2 - 30, -hh / 2 + 92, { sw: 3, stroke: 'faint' });
      rows.forEach(([l, r, c], i) => {
        const k = clamp((t - 0.3 - i * gap) / 0.25);
        if (k <= 0) return;
        const yy = -hh / 2 + head + rh * (i + 0.5);
        s += `<g opacity="${k.toFixed(2)}" transform="translate(${n((1 - k) * -20)} 0)">` + S.text(-w / 2 + 40, yy, l, { size: 44, anchor: 'start', fill: 'soft' }) + S.text(w / 2 - 40, yy, r, { size: 50, anchor: 'end', fill: c || 'ink' }) + '</g>';
      });
      if (o.total) {
        const k = clamp((t - 0.3 - rows.length * gap) / 0.3), yy = -hh / 2 + head + rh * (rows.length + 0.65);
        if (k > 0) s += `<g opacity="${k.toFixed(2)}">` + S.path(`M${-w / 2 + 30} ${n(yy - rh * 0.6)} H${w / 2 - 30}`, { fill: 'none', sw: 4, stroke: 'ink' }).replace('/>', ' stroke-dasharray="10 10"/>') +
          S.text(-w / 2 + 40, yy, o.total[0], { size: 46, anchor: 'start' }) + S.text(w / 2 - 40, yy, o.total[1], { size: 56, anchor: 'end', fill: o.total[2] || 'orange' }) + '</g>';
      }
      return s;
    }, { in: 'rise', ...o, at, x, y });
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Things
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  /** calendar(x, y, o): a tear-off calendar centred on (x, y): a coloured header with small text, a big date or month
   *  under it. label can change over time and flips with a bounce: [[0, '3月1日'], [P.c(2), '6月30日']]. o: { top
   *  (header text, fn), label (fn), color (header, default 'red'), w (default 280), h (default 280), size (label px,
   *  default 80), at, out } */
  B.calendar = function (x, y, o = {}) {
    const w = o.w ?? 280, hh = o.h ?? 280;
    [x, y] = fitT(this, x, y, w, hh + 20);
    return svgEl(this, (t, lt) => {
      const lab = String(val(o.label, lt, '') ?? ''), top = String(val(o.top, lt, '') ?? '');
      let flip = 0;
      if (isKeys(o.label)) for (const k of o.label) if (lt >= k[0] && k[0] > (o.at ?? 0)) flip = lt - k[0];
      const fs = Math.min(o.size ?? 80, (w - 40) / Math.max(1, tw(lab, 1)));
      const fk = flip > 0 && flip < 0.4 ? 1 + 0.15 * Math.sin(Math.PI * flip / 0.4) : 1;
      return S.drop(-w / 2, -hh / 2, w, hh, 24, 10) + S.rect(-w / 2, -hh / 2, w, hh, { r: 24, fill: 'white' }) +
        `<path d="M${-w / 2 + 2.5} ${-hh / 2 + 62} V${-hh / 2 + 24} Q${-w / 2 + 2.5} ${-hh / 2 + 2.5} ${-w / 2 + 24} ${-hh / 2 + 2.5} H${w / 2 - 24} Q${w / 2 - 2.5} ${-hh / 2 + 2.5} ${w / 2 - 2.5} ${-hh / 2 + 24} V${-hh / 2 + 62} Z" fill="${C(o.color || 'red')}"/>` +
        S.line(-w / 2, -hh / 2 + 62, w / 2, -hh / 2 + 62) + S.text(0, -hh / 2 + 33, top, { size: 32, fill: 'white' }) +
        S.circle(-w / 4, -hh / 2, 9, { fill: 'gray', sw: 4 }) + S.circle(w / 4, -hh / 2, 9, { fill: 'gray', sw: 4 }) +
        `<g transform="translate(0 32) scale(${n(fk)})">${S.text(0, 0, lab, { size: fs })}</g>`;
    }, { ...o, x, y });
  };

  /** phone(x, y, o): a big chunky phone centred on (x, y) (about 280 × 520) with an app on its screen: a coloured top
   *  bar with the app's name, an optional big number in the middle, and up to 4 rows that pop in one by one (each a
   *  string or [text, color]). For apps, notifications, a bill, a form being filled. o: { title, color (bar, default
   *  'blue'), big (fn), bigColor, rows, rowGap (s, default 0.4), h (default 520), at, out, tilt } */
  B.phone = function (x, y, o = {}) {
    const w = 280, hh = o.h ?? 520;
    [x, y] = fitT(this, x, y, w, hh + 20);
    const rows = o.rows || [], at = o.at ?? 0;
    return svgEl(this, (t, lt) => {
      let s = S.drop(-w / 2, -hh / 2, w, hh, 44, 12) + S.rect(-w / 2, -hh / 2, w, hh, { r: 44, fill: '#3F4A5A' }) +
        S.rect(-w / 2 + 16, -hh / 2 + 40, w - 32, hh - 80, { r: 16, fill: '#F4FAFF', stroke: 'none' }) + S.rect(-26, -hh / 2 + 16, 52, 10, { r: 5, fill: '#2A323E', stroke: 'none' });
      const top = -hh / 2 + 40;
      if (o.title) s += `<path d="M${-w / 2 + 16} ${top + 70} V${top + 16} Q${-w / 2 + 16} ${top} ${-w / 2 + 32} ${top} H${w / 2 - 32} Q${w / 2 - 16} ${top} ${w / 2 - 16} ${top + 16} V${top + 70} Z" fill="${C(o.color || 'blue')}"/>` +
        S.text(0, top + 36, o.title, { size: Math.min(36, 220 / Math.max(1, tw(o.title, 1))), fill: 'white' });
      let yy = top + (o.title ? 100 : 30);
      const big = val(o.big, lt);
      if (big != null && big !== '') { s += S.text(0, yy + 50, String(big), { size: Math.min(68, 220 / Math.max(1, tw(String(big), 1))), fill: o.bigColor || 'orange' }); yy += 120; }
      rows.slice(0, 4).forEach((r, i) => {
        const k = back(clamp((t - 0.4 - i * (o.rowGap ?? 0.4)) / 0.35));
        if (k <= 0) return;
        const [str, c] = Array.isArray(r) ? r : [r];
        s += `<g transform="translate(0 ${n(yy + 34 + i * 82)}) scale(${n(k)})">` + S.rect(-108, -32, 216, 64, { r: 18, fill: c ? C(c + 'F') || 'white' : 'white', sw: 4 }) +
          S.text(0, 2, str, { size: Math.min(32, 190 / Math.max(1, tw(str, 1))), fill: c || 'ink' }) + '</g>';
      });
      return s;
    }, { ...o, at, x, y, rot: o.tilt || 0 });
  };

  const THINGS = {
    wallet: (c = 'brown') => S.rect(-90, -60, 180, 120, { r: 22, fill: c }) + S.rect(20, -26, 90, 52, { r: 14, fill: 'brownF' }) + S.circle(66, 0, 10, { fill: 'yellow', sw: 4 }),
    card: (c = 'blue') => S.rect(-95, -60, 190, 120, { r: 16, fill: c }) + S.rect(-70, -32, 42, 32, { r: 7, fill: 'yellow', sw: 4 }) + S.rect(-70, 26, 100, 12, { r: 6, fill: 'white', stroke: 'none', op: 0.8 }) + S.circle(50, 30, 15, { fill: 'red', stroke: 'none', op: 0.85 }) + S.circle(66, 30, 15, { fill: 'yellow', stroke: 'none', op: 0.85 }),
    piggy: (c = 'pink') => S.ellipse(0, 6, 92, 72, { fill: c }) + S.path('M-50 -50 L-40 -86 L-14 -62 Z', { fill: c }) + S.ellipse(78, 10, 22, 26, { fill: c }) + S.circle(72, 4, 4, { fill: 'ink', stroke: 'none' }) + S.circle(84, 14, 4, { fill: 'ink', stroke: 'none' }) + S.circle(36, -16, 6, { fill: 'ink', stroke: 'none' }) + S.rect(-26, -64, 52, 10, { r: 5, fill: 'ink', stroke: 'none' }) + S.rect(-50, 62, 22, 30, { r: 8, fill: c }) + S.rect(28, 62, 22, 30, { r: 8, fill: c }),
    house: (c = 'orange') => S.rect(-80, -20, 160, 110, { r: 8, fill: 'cream' }) + S.path('M-100 -10 L0 -96 L100 -10 Z', { fill: c }) + S.rect(-22, 26, 44, 64, { r: 8, fill: 'brown' }) + S.rect(36, 0, 32, 32, { r: 4, fill: 'blueF' }),
    car: (c = 'red') => S.path('M-100 30 V0 Q-96 -16 -70 -20 L-46 -58 Q-40 -66 -28 -66 H36 Q48 -66 56 -56 L80 -20 Q100 -16 100 4 V30 Z', { fill: c }) + S.path('M-36 -24 L-22 -52 H-2 V-24 Z M12 -24 V-52 H34 L52 -24 Z', { fill: 'blueF', sw: 4 }) + S.circle(-56, 34, 22, { fill: '#555' }) + S.circle(56, 34, 22, { fill: '#555' }),
    cart: (c = 'blue') => S.path('M-96 -66 H-70 L-46 30 H64 L84 -40 H-58', { fill: 'none', sw: 9 }) + S.path('M-54 -34 H76 L62 16 H-42 Z', { fill: C(c + 'F') || 'white', sw: 5 }) + S.circle(-34, 56, 14, { fill: 'gray' }) + S.circle(50, 56, 14, { fill: 'gray' }),
    bag: (c = 'orange') => S.path('M-70 -40 H70 L80 86 H-80 Z', { fill: c }) + S.path('M-34 -40 Q-34 -92 0 -92 Q34 -92 34 -40', { fill: 'none', sw: 7 }),
    gift: (c = 'red') => S.rect(-80, -30, 160, 116, { r: 10, fill: c }) + S.rect(-90, -58, 180, 36, { r: 8, fill: c }) + S.rect(-14, -58, 28, 144, { r: 2, fill: 'yellow', sw: 4 }) + S.path('M0 -58 Q-50 -110 -56 -70 Q-50 -56 0 -58 Q50 -110 56 -70 Q50 -56 0 -58', { fill: 'yellow', sw: 4 }),
    coffee: (c = 'brown') => S.path('M-56 -50 H56 L44 80 H-44 Z', { fill: 'white' }) + S.rect(-62, -70, 124, 26, { r: 8, fill: c }) + S.rect(-50, 0, 100, 40, { r: 4, fill: C(c + 'F') || 'brownF', sw: 4 }),
    bill: (c = 'green') => S.rect(-110, -56, 220, 112, { r: 12, fill: C(c + 'F') || 'greenF' }) + S.circle(0, 0, 32, { fill: 'white', stroke: c, sw: 4 }) + S.text(0, 2, '¥', { size: 40, fill: c }) + S.rect(-96, -42, 192, 84, { r: 8, fill: 'none', stroke: c, sw: 3 }),
    safe: (c = 'gray') => S.rect(-90, -90, 180, 176, { r: 18, fill: c }) + S.rect(-70, -70, 140, 136, { r: 12, fill: 'grayF' }) + S.circle(0, -2, 34, { fill: 'white' }) + S.line(-18, 16, 18, -20, { sw: 7 }) + S.rect(-70, 86, 30, 14, { r: 4, fill: 'ink', stroke: 'none' }) + S.rect(40, 86, 30, 14, { r: 4, fill: 'ink', stroke: 'none' }),
    jar: (c = 'orange') => S.rect(-80, -70, 160, 160, { r: 30, fill: 'rgba(255,255,255,0.75)' }) + [0, 1, 2, 3, 4].map((i) => `<g transform="translate(${-36 + (i % 3) * 36} ${62 - Math.floor(i / 3) * 30})">${coinSVG(20)}</g>`).join('') + S.rect(-64, -96, 128, 34, { r: 12, fill: C(c + 'F') || c }),
    clock: (c = 'blue') => S.circle(0, 0, 86, { fill: 'white', stroke: 'ink', sw: 6 }) + S.circle(0, 0, 86, { fill: 'none', stroke: c, sw: 12 }) + S.path('M0 -50 L0 0 L36 22', { fill: 'none', sw: 9 }),
    bulb: (c = 'yellow') => S.circle(0, -20, 62, { fill: c }) + S.rect(-28, 38, 56, 40, { r: 8, fill: 'gray' }) + S.path('M-16 -20 Q0 6 16 -20', { fill: 'none', sw: 5 }),
    shield: (c = 'green') => S.path('M0 -92 L78 -62 Q78 40 0 92 Q-78 40 -78 -62 Z', { fill: c }) + S.path('M-30 0 L-6 24 L34 -24', { fill: 'none', stroke: 'white', sw: 12 }),
    medicine: (c = 'red') => S.rect(-56, -50, 112, 136, { r: 14, fill: 'white' }) + S.rect(-62, -86, 124, 42, { r: 10, fill: c }) + S.path('M-22 18 H22 M0 -4 V40', { fill: 'none', stroke: c, sw: 12 }),
    medkit: (c = 'red') => S.rect(-96, -60, 192, 140, { r: 18, fill: 'white' }) + S.path('M-30 -60 V-82 H30 V-60', { fill: 'none', sw: 6 }) + S.rect(-16, -34, 32, 92, { r: 6, fill: c, stroke: 'none' }) + S.rect(-46, -4, 92, 32, { r: 6, fill: c, stroke: 'none' }),
    laptop: (c = 'blue') => S.rect(-90, -76, 180, 120, { r: 12, fill: '#3F4A5A' }) + S.rect(-76, -62, 152, 92, { r: 6, fill: C(c + 'F') || 'blueF', stroke: 'none' }) + S.path('M-118 44 H118 L104 70 H-104 Z', { fill: 'gray' }),
    plane: (c = 'blue') => S.path('M-100 10 L60 -14 Q100 -16 100 0 Q100 16 60 14 Z', { fill: 'white' }) + S.path('M-10 -4 L-40 -70 H-14 L34 -6 Z M-10 6 L-40 70 H-14 L34 8 Z', { fill: c }) + S.path('M-92 6 L-104 -36 H-86 L-66 4 Z', { fill: c }),
    bowl: (c = 'orange') => S.path('M-100 -10 H100 Q96 80 0 84 Q-96 80 -100 -10 Z', { fill: c }) + S.ellipse(0, -14, 98, 22, { fill: 'cream' }) + S.path('M-20 -40 Q-30 -70 -10 -90 M14 -40 Q4 -70 24 -90', { fill: 'none', sw: 5, stroke: 'muted' }),
    key: (c = 'yellow') => S.circle(-50, 0, 38, { fill: c }) + S.circle(-50, 0, 12, { fill: 'paper' }) + S.path('M-14 -10 H96 V10 H70 V30 H52 V10 H-14 Z', { fill: c }),
    lock: (c = 'yellow') => S.path('M-46 -20 V-50 Q-46 -96 0 -96 Q46 -96 46 -50 V-20', { fill: 'none', sw: 22, stroke: 'ink' }) + S.path('M-46 -20 V-50 Q-46 -96 0 -96 Q46 -96 46 -50 V-20', { fill: 'none', sw: 12, stroke: 'gray' }) + S.rect(-76, -26, 152, 116, { r: 20, fill: c }) + S.circle(0, 24, 14, { fill: 'ink', stroke: 'none' }),
    heart: (c = 'red') => S.path('M0 80 Q-100 10 -90 -36 Q-80 -86 -30 -80 Q-6 -76 0 -50 Q6 -76 30 -80 Q80 -86 90 -36 Q100 10 0 80 Z', { fill: c }),
    star: (c = 'yellow') => S.path('M0 -88 L26 -28 L88 -24 L40 16 L56 80 L0 44 L-56 80 L-40 16 L-88 -24 L-26 -28 Z', { fill: c }),
    umbrella: (c = 'blue') => S.path('M-100 0 Q-96 -90 0 -96 Q96 -90 100 0 Q84 -16 66 0 Q50 -16 34 0 Q18 -16 0 0 Q-18 -16 -34 0 Q-50 -16 -66 0 Q-84 -16 -100 0 Z', { fill: c }) + S.path('M0 0 V70 Q0 92 -22 88', { fill: 'none', sw: 8 }),
    doc: (c = 'blue') => S.path('M-70 -96 H40 L76 -60 V96 H-70 Z', { fill: 'white' }) + S.path('M40 -96 V-60 H76', { fill: C(c + 'F') || 'white' }) + S.path('M-44 -40 H40 M-44 -6 H48 M-44 28 H26', { fill: 'none', sw: 7, stroke: 'faint' }) + S.circle(36, 62, 22, { fill: c, sw: 4 }),
    bank: (c = 'blue') => S.path('M-104 -40 L0 -100 L104 -40 Z', { fill: c }) + [-70, -24, 24, 70].map((x) => S.rect(x - 12, -34, 24, 100, { r: 4, fill: 'white', sw: 4 })).join('') + S.rect(-110, 66, 220, 24, { r: 6, fill: c }),
    chart: (c = 'green') => S.rect(-96, -86, 192, 172, { r: 16, fill: 'white' }) + S.rect(-64, 10, 30, 50, { r: 6, fill: C(c + 'F') || c, sw: 4 }) + S.rect(-16, -20, 30, 80, { r: 6, fill: C(c + 'F') || c, sw: 4 }) + S.rect(32, -54, 30, 114, { r: 6, fill: c, sw: 4 }),
    phone: (c = 'blue') => S.rect(-52, -92, 104, 184, { r: 20, fill: '#3F4A5A' }) + S.rect(-40, -72, 80, 140, { r: 8, fill: C(c + 'F') || 'blueF', stroke: 'none' }),
    trash: (c = 'gray') => S.path('M-62 -50 H62 L52 92 H-52 Z', { fill: c }) + S.rect(-76, -74, 152, 26, { r: 8, fill: c }) + S.path('M-22 -30 V70 M22 -30 V70', { fill: 'none', sw: 6, stroke: 'white' }),
  };
  /** thing(kind, x, y, o): a flat cartoon object centred on (x, y), about o.size px across (default 260): wallet card
   *  piggy house car cart bag gift coffee bill safe jar clock bulb shield medicine medkit laptop plane bowl key lock
   *  heart star umbrella doc bank chart phone trash. A small label pill can hang under it. o: { size, color (its main
   *  colour), label, at, out, in, wobble (a gentle idle sway) } */
  B.thing = function (kind, x, y, o = {}) {
    const size = o.size ?? 260, sc = size / 200, draw = THINGS[kind] || THINGS.star;
    [x, y] = fitT(this, x, y, size, size + (o.label ? 90 : 0));
    let svg = S.floor(0, 104, 90) + draw(o.color);
    if (o.label) { const ls = 40 / sc, lw = tw(o.label, ls) + ls * 1.2, lh = ls * 1.6; svg += S.drop(-lw / 2, 122, lw, lh, lh / 2, 6) + S.rect(-lw / 2, 122, lw, lh, { r: lh / 2, fill: 'white', sw: OUT / sc }) + S.text(0, 122 + lh / 2 + 1, o.label, { size: ls }); }
    const H = svgEl(this, svg, { ...o, x, y, s: sc, anim: o.wobble ? (t, lt) => ({ rot: wave(lt, 2.2, 3) }) : undefined });
    return H;
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Charts and comparisons
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  /** barchart(items, o): a chart of fat rounded bars on a baseline that grow with an overshoot, one by one, each value
   *  counting up on top and its label under it; negative values hang below the line. items: [{ label, value, color,
   *  at }] (2–6 bars). o: { x (left, default 260), y (baseline, default 760), w (default 1240), h (tallest bar, default
   *  440), at, gap (s between bars, default 0.5), unit, prefix, plus, out } */
  B.barchart = function (items, o = {}) {
    const z = zoneOf(this);
    let x0 = o.x ?? (z === 'left' ? 700 : 240), wIn = o.w ?? (z === 'left' || z === 'right' ? 1000 : 1240);
    if (z === 'left') x0 = Math.max(x0, 660);
    const xMax = z === 'right' ? 1250 : z === 'corner' ? 1540 : W - 60;
    const y0 = Math.min(o.y ?? 760, BOTTOM - 70), w = Math.min(wIn, xMax - x0), Hh = Math.min(o.h ?? 440, y0 - (TOP + 50));
    const nI = items.length, slot = w / nI, bw = Math.min(190, slot * 0.6);
    const max = Math.max(...items.map((it) => Math.abs(it.value)), 1e-9), neg = items.some((it) => it.value < 0);
    const U = (Hh * (neg ? 0.8 : 1)) / max, at0 = o.at ?? 0, gap = o.gap ?? 0.5;
    const tAt = items.map((it, i) => it.at ?? at0 + 0.3 + i * gap);
    const H = svgEl(this, (t, lt) => {
      let s = S.line(-30, 0, w + 30, 0, { sw: 6 });
      items.forEach((it, i) => {
        const x = i * slot + (slot - bw) / 2, cx = x + bw / 2, k = back(clamp((lt - tAt[i]) / 0.6)), kv = ease.out(clamp((lt - tAt[i]) / 0.6));
        if (lt < tAt[i] - 0.25) return;
        s += S.text(cx, it.value < 0 ? -40 : 44, it.label ?? '', { size: Math.max(30, Math.min(40, slot / Math.max(1, tw(it.label ?? '', 1)) * 0.95)), fill: 'soft' });
        if (k <= 0) return;
        const hgt = Math.abs(it.value) * U * k, c = it.color || 'orange';
        const num = (o.prefix || '') + fmtNum(it.value * kv, o) + (o.unit || '');
        if (it.value > 0) s += S.drop(x, -hgt, bw, hgt, 18, 0) + S.rect(x, -hgt, bw, hgt, { r: Math.min(22, hgt / 2), fill: c }) + S.text(cx, -hgt - 40, num, { size: 50, fill: c });
        else if (it.value < 0) s += S.rect(x, 0, bw, hgt, { r: Math.min(18, hgt / 2), fill: c }) + S.text(cx, hgt + 46, num, { size: 50, fill: c });
        else s += S.rect(x, -8, bw, 16, { r: 8, fill: 'gray' }) + S.text(cx, -46, num, { size: 50, fill: 'soft' });
      });
      return s;
    }, { in: 'fade', ...o, at: at0, x: x0, y: y0 });
    return H;
  };

  /** progress(x, y, w, o): a fat rounded bar (left end at x, centred on y) that fills from 0 to o.value of o.max, with
   *  its label inside and an optional limit line ("6 万以内不交税"): how much of a quota, a threshold, a deadline is used.
   *  o: { value, max (default 1), label, color (default 'blue'), limit (a value on the same scale), limitLabel, at, dur
   *  (default 1.2), h (default 64), out } */
  B.progress = function (x, y, w, o = {}) {
    const hh = o.h ?? 64, max = o.max ?? 1, at = o.at ?? 0, dur = o.dur ?? 1.2;
    { const z = zoneOf(this); const lo = z === 'left' ? 660 : 40, hi = (z === 'right' ? 1260 : z === 'corner' && y > 600 ? 1560 : W - 40) - w; x = clamp(x, lo, Math.max(lo, hi)); } y = clamp(y, TOP + 10, BOTTOM - hh);
    return svgEl(this, (t, lt) => {
      const k = ease.out(clamp((lt - at - 0.2) / dur)), f = clamp((o.value ?? 0) / max) * k, c = o.color || 'blue';
      let s = S.rect(0, -hh / 2, w, hh, { r: hh / 2, fill: 'white' });
      if (f > 0.01) s += S.rect(0, -hh / 2, Math.max(hh, w * f), hh, { r: hh / 2, fill: c });
      if (o.label) s += S.text(Math.max(hh, w * f) / 2 + 4, 2, o.label, { size: hh * 0.5, fill: f > 0.25 ? (DARK.has(c) ? 'white' : 'ink') : 'ink' });
      if (o.limit != null) {
        const lx = w * clamp(o.limit / max);
        s += S.line(lx, -hh - 40, lx, hh / 2 + 20, { sw: 6, stroke: 'red' }) + (o.limitLabel ? S.text(lx, -hh - 66, o.limitLabel, { size: 38, fill: 'red' }) : '');
      }
      return s;
    }, { in: 'fade', ...o, at, x, y });
  };

  /** compare(a, b, o): two big sticker cards side by side: a on the left, b on the right, each { title, items (2–4
   *  short lines), kind ('yes' mint card with a tick, 'no' coral card with a cross and its items struck through, or
   *  'plain') }; items appear one by one. For do / don't, worth it / not, before / after. The cards fill the space the
   *  host leaves free. o: { at, gap (s between items, default 0.5), bAt (when b starts), stamp: { text,
   *  color } (lands on b at the end), out } */
  B.compare = function (a, b, o = {}) {
    const z = zoneOf(this), [L0, R0] = z === 'left' ? [650, 1780] : z === 'right' ? [140, 1270] : z === 'cornerL' ? [360, 1780] : PORTRAIT ? [STAGE.area.x0, STAGE.area.x1] : [150, 1560];
    const at = o.at ?? 0, gap = o.gap ?? 0.5, cw = Math.min(660, (R0 - L0 - 50) / 2), chh = 560, top = STAGE.area.y0 + 70;
    const card = (d, cx, t0) => {
      const kind = d.kind || 'plain', fill = kind === 'yes' ? 'greenF' : kind === 'no' ? 'redF' : 'white';
      const items = d.items || [];
      svgEl(this, (t) => {
        let s = S.drop(-cw / 2, 0, cw, chh, 32, 10) + S.rect(-cw / 2, 0, cw, chh, { r: 32, fill });
        if (kind !== 'plain') s += `<g transform="translate(0 70) scale(0.8)">${S.circle(0, 0, 44, { fill: kind === 'yes' ? 'green' : 'red' })}${kind === 'yes' ? S.path('M-22 2 L-6 18 L24 -16', { fill: 'none', stroke: 'white', sw: 12 }) : S.path('M-18 -18 L18 18 M18 -18 L-18 18', { fill: 'none', stroke: 'white', sw: 12 })}</g>`;
        if (d.title) s += S.text(0, kind !== 'plain' ? 150 : 80, d.title, { size: 54, fill: kind === 'yes' ? 'green' : kind === 'no' ? 'red' : 'ink' });
        items.forEach((it, i) => {
          const k = back(clamp((t - 0.5 - i * gap) / 0.35));
          if (k <= 0) return;
          const yy = (d.title ? 250 : 130) + i * 88, fs = Math.min(48, (cw - 80) / Math.max(1, tw(it, 1)));
          s += `<g transform="translate(0 ${n(yy)}) scale(${n(k)})">` + S.text(0, 0, it, { size: fs });
          if (kind === 'no') { const lw = tw(it, fs) / 2 + 14, kk = clamp((t - 0.8 - i * gap) / 0.3); if (kk > 0) s += S.line(-lw, 2, -lw + 2 * lw * kk, 2, { sw: 5, stroke: 'red' }); }
          s += '</g>';
        });
        return s;
      }, { in: 'pop', at: t0, out: o.out, x: cx, y: top });
      return t0 + 0.5 + items.length * gap;
    };
    const tA = card(a, L0 + cw / 2, at);
    const tB = card(b, R0 - cw / 2, o.bAt ?? tA + 0.2);
    if (o.stamp) this.stamp(R0 - cw / 2 + cw * 0.28, top + chh - 90, o.stamp.text, { at: o.stamp.at ?? tB + 0.4, color: o.stamp.color || 'red', r: 80, out: o.out });
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  //  Arrows and sparkle
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  /** arrow(x1, y1, x2, y2, o): a fat rounded cartoon arrow that grows from (x1, y1) to (x2, y2), outlined in brown,
   *  bent with o.bend (−0.4 … 0.4). o: { color (default 'orange'), bend, at, dur (default 0.5), dashed, sw (default 12),
   *  out } */
  B.arrow = function (x1, y1, x2, y2, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 0.5, c = o.color || 'orange', bend = o.bend ?? 0.15, sw = o.sw ?? 12;
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    const qp = (k) => [(1 - k) * (1 - k) * x1 + 2 * (1 - k) * k * mx + k * k * x2, (1 - k) * (1 - k) * y1 + 2 * (1 - k) * k * my + k * k * y2];
    return svgEl(this, (t) => {
      const k = ease.out(clamp(t / dur));
      if (k <= 0) return '';
      const pts = Array.from({ length: 21 }, (_, i) => qp((i / 20) * k));
      const d = 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L');
      const [ex, ey] = pts[20], [px, py] = pts[17], ang = Math.atan2(ey - py, ex - px), hl = sw * 3;
      const hd = `M${n(ex - hl * Math.cos(ang - 0.6))} ${n(ey - hl * Math.sin(ang - 0.6))} L${n(ex)} ${n(ey)} L${n(ex - hl * Math.cos(ang + 0.6))} ${n(ey - hl * Math.sin(ang + 0.6))}`;
      const da = o.dashed ? ' stroke-dasharray="2 30"' : '';
      return `<path d="${d}" fill="none" stroke="${C('ink')}" stroke-width="${sw + 8}" stroke-linecap="round"${da}/><path d="${d}" fill="none" stroke="${C(c)}" stroke-width="${sw}" stroke-linecap="round"${da}/>` +
        `<path d="${hd}" fill="none" stroke="${C('ink')}" stroke-width="${sw + 8}" stroke-linecap="round" stroke-linejoin="round"/><path d="${hd}" fill="none" stroke="${C(c)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }, { in: 'fade', dur: 0.01, at, out: o.out, x: 0, y: 0 });
  };

  /** burst(x, y, o): a little firework of stars and dots that flies out of (x, y) and fades in 0.8 s: a reward, a
   *  number landing, a pouch filling up. o: { at, color (default 'yellow'), n (default 8), r (default 150) } */
  B.burst = function (x, y, o = {}) {
    const N = o.n ?? 8, R = o.r ?? 150, c = o.color || 'yellow';
    const star = S.path('M0 -44 L13 -14 L44 -12 L20 8 L28 40 L0 22 L-28 40 L-20 8 L-44 -12 L-13 -14 Z', { fill: c });
    return svgEl(this, (t) => {
      const k = clamp(t / 0.8);
      if (k >= 1) return '';
      let s = '';
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + 0.3, d = R * ease.out(k), sz = 18 * (1 - k) + 4, px = Math.cos(a) * d, py = Math.sin(a) * d;
        s += i % 2 ? S.circle(px, py, sz * 0.55, { fill: c, sw: 3 }) : `<g transform="translate(${n(px)} ${n(py)}) scale(${n(sz / 44)})">${star}</g>`;
      }
      return s;
    }, { in: 'fade', dur: 0.01, at: o.at ?? 0, x, y });
  };
})();
