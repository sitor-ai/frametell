/* Product Tutorial · kit: a lesson told on real screenshots of the Frametell studio. A browser window holds the 2× shot
 * (1600×900 CSS px); the pointer glides to a recorded box and clicks, a spotlight dims all but that box, the camera pushes in,
 * text types itself into an input, the after-shot cross-fades in. Boxes are [x, y, w, h] in the shot's CSS px, copied from
 * materials/steps.md. Every component is a pure function of page-local time lt. Internal style, not sold. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fin = (lt, at, dur = 0.3) => ease.out(clamp((lt - at) / dur));
  const outK = (lt, out, dur = 0.35) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));
  const set = (el, k, v) => { const c = el._c || (el._c = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // a transparent box that tells the page check this DOM element is content
  const marker = (parent, w, hh) => { const sv = PV.s('svg', { width: w, height: hh, style: 'position:absolute;left:0;top:0' }, parent); PV.s('rect', { x: 0, y: 0, width: w, height: hh, fill: 'transparent' }, sv); return sv; };
  const SHOT_W = 1600, SHOT_H = 900;
  // What a window holds is recorded on win.tt (times in page-local s, with their elements), so a swap can end what was drawn
  // on the old screenshot whatever order the page calls things in: { swaps: [{ at, el }], spots: [{ at, out, el }],
  // ripples: [{ at, el }], typings: [{ at, els }], base }. Resolved at tick time, never at call time. The page check
  // (tutorials/check-ghosts.mjs) reads it from the window frame's element (.tt-win, el._tt).
  // the first swap on win that lands after `start` (something drawn at start belongs to the screenshot that swap replaces)
  const swapAfter = (win, start) => { let s = null; for (const w of win.tt.swaps) if (w.at > start && (!s || w.at < s.at)) s = w; return s; };
  // 1 until that swap lands, 0 from its frame on: a swap is a cut, nothing of the old screenshot fades across it
  const swapK = (win, start, lt) => { const s = swapAfter(win, start); return s && lt >= s.at ? 0 : 1; };
  // the screenshot layers of win (the shot, then each swap) each show from their own time until the next swap lands, and
  // are hidden outside it: exactly one layer at opacity 1 in every frame, never two
  const coveredAt = (win, at) => { let t = Infinity; for (const w of win.tt.swaps) if (w.at > at) t = Math.min(t, w.at); return t; };
  const ARROW = '<svg viewBox="0 0 28 34" width="34" height="41"><path d="M2 2 L2 28 L9 21 L14 32 L19 30 L14 19 L24 19 Z" fill="#F5F5F4" stroke="#0C0A09" stroke-width="2.4" stroke-linejoin="round"/></svg>';

  // ── the camera: kit pushes merge with the page's own P.cam keys (as in the chat kit) ──
  const cam0 = B.cam;
  const mergeCams = (sh) => { sh.cams = [...(sh.userCams || []), ...(sh.kitCams || [])].sort((a, b) => a.at - b.at); };
  B.cam = function (keys) { cam0.call(this, keys); this.sh.userCams = this.sh.cams; mergeCams(this.sh); };
  function addCams(self, keys) { const sh = self.sh; if (!sh.userCams) sh.userCams = sh.cams.slice(); sh.kitCams = (sh.kitCams || []).concat(keys); mergeCams(sh); }
  // a push-in on a box in win: the view's top edge stays below the window's address bar (so the bar never sits half cut at
  // the frame's edge) as long as the box still shows whole
  const camKey = (at, x, y, s, win, by) => {
    const hx = W / 2 / s, hy = H / 2 / s;
    if (win && by != null && by > win.top) y = Math.max(y, Math.min(win.top + hy, by + hy - 20));
    return { at, x: clamp(x, hx, W - hx), y: clamp(y, hy, H - hy), s, dur: 0.5, ease: 'out' };
  };

  /** shot(src, { at, x=320, y=135, w=1280, url }): a real 2× screenshot of the studio (1600×900 CSS px, e.g.
   *  'materials/02-before.jpg') in a browser window. Returns the window: pass it to swap / cursor / spot / zoom / typing. */
  B.shot = function (src, o = {}) {
    const w0 = Math.min(1280, STAGE.area.x1 - STAGE.area.x0);   // 1280 in landscape, the content width in portrait
    const x = num(o.x, (W - w0) / 2), y = num(o.y, STAGE.area.y0 - 45), w = num(o.w, w0);
    const k = (w - 8) / SHOT_W, hh = 54 + SHOT_H * k + 6;
    const at = num(o.at, 0);
    // B.browser draws its frame, divider, lights and the address pill as rough strokes (draw-on, sketchy). A UI style wants
    // them clean: collect those acts, drop them (display none), and draw the same parts as divs that fade in together.
    const rough = [], act0 = B.act;
    this.act = function (a) { rough.push(a); return act0.call(this, a); };
    let win;
    const kids = new Set(this.html.children);
    try { win = this.browser(x, y, w, hh, { src, crop: [0, 0, SHOT_W, SHOT_H], dpr: 2, at }); } finally { delete this.act; }
    for (const a of rough) { if (a.g) a.g.style.display = 'none'; a.dur = 0.01; }
    const part = (cls, css, html) => { const d = h('div', cls, html || '', this.html); Object.assign(d.style, css); return d; };
    const px = (v) => v + 'px';
    const frame = part('tt-win', { left: px(x), top: px(y), width: px(w), height: px(hh) });
    marker(frame, w, hh);
    const rule = part('tt-rule', { left: px(x + 4), top: px(y + 54), width: px(w - 8) });
    const dots = ['#EF4444', '#F59E0B', '#22C55E'].map((c, i) => part('tt-dot', { left: px(x + 23 + i * 26), top: px(y + 20), background: c }));
    const pill = part('tt-pill', { left: px(x + 118), top: px(y + 11), width: px(w - 150) });
    this.tick((lt) => {
      const k = (0.4 + 0.6 * fin(lt, at, 0.45)).toFixed(3), kp = fin(lt, at + 0.3, 0.4).toFixed(3);
      set(frame, 'opacity', k); set(rule, 'opacity', kp); set(pill, 'opacity', kp);
      dots.forEach((d) => set(d, 'opacity', kp));
    });
    const url = h('div', 'tt-url', esc(o.url ?? 'frametell.ai/studio'), this.html);
    Object.assign(url.style, { left: x + 138 + 'px', top: y + 11 + 'px', width: w - 190 + 'px' });
    this.tick((lt) => set(url, 'opacity', fin(lt, at + 0.55, 0.4).toFixed(3)));
    // the shot's own view (B.browser's div.media): hidden from the first swap's frame on
    const base = [...this.html.children].find((c) => !kids.has(c) && c.classList.contains('media'));
    win.tt = { swaps: [], spots: [], ripples: [], typings: [], base, at };
    frame._tt = win.tt;
    if (base) this.tick((lt) => set(base, 'opacity', lt >= coveredAt(win, -Infinity) ? '0' : '1'));
    win.rect = [x, y, w, hh];   // the window's rectangle, in stage px
    win.top = y + 54;   // the bottom of the address bar, in stage px
    win.center = (box) => { const [sx, sy, sw, sh] = win.toStage(box); return [sx + sw / 2, sy + sh / 2]; };
    return win;
  };

  /** swap(win, src, { at }): a cut to the after-shot at `at` (when the click lands): from that frame the after-shot shows
   *  and the image under it (the shot, or an earlier swap) is hidden, with no cross-fade, so two screenshots never share a
   *  frame. In the same frame the swap ends what was drawn on the old screenshot: every spot, click ripple and typing on win
   *  that started before `at` is gone, whatever their own `out`. What starts after `at` is drawn on the after-shot and
   *  stays. The pointer itself stays. */
  B.swap = function (win, src, o = {}) {
    const at = num(o.at, 1), [x, y, w, hh] = win.toStage([0, 0, SHOT_W, SHOT_H]);
    const im = MEDIA.need(src).cloneNode();
    im.className = 'tt-swap';
    Object.assign(im.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    // stacked by time, not by call order: a later swap always lies over an earlier one
    const above = win.tt.swaps.filter((s) => s.at > at).sort((a, b) => a.at - b.at)[0];
    if (above) this.html.insertBefore(im, above.el); else this.html.appendChild(im);
    win.tt.swaps.push({ at, el: im });
    this.tick((lt) => set(im, 'opacity', lt >= at && lt < coveredAt(win, at) ? '1' : '0'));
    return { el: im };
  };

  /** cursor(win, box, { at, from: [x, y], click=true, out }): the pointer glides in (0.7 s) and its tip lands inside box at
   *  `at` (the word that names the control), a little right of and below the centre so the arrow never hides the control's
   *  label, then a click ripple there. click: false only points. A swap on win after the click ends the ripple in its frame;
   *  the pointer stays. */
  B.cursor = function (win, box, o = {}) {
    const at = num(o.at, 0.9), travel = 0.7;
    const [bx, by, bw, bh] = win.toStage(box);
    const tx = bx + bw * (bw > 240 ? 0.5 : 0.7), ty = by + bh * 0.62;
    const [fx, fy] = o.from || [tx + 260, ty + 180];
    const el = h('div', 'tt-cursor', ARROW, this.html);
    const ring = h('div', 'tt-ripple', null, this.html);
    marker(el, 34, 41);
    if (o.click !== false) win.tt.ripples.push({ at, el: ring });
    this.tick((lt) => {
      const k = ease.inOut(clamp((lt - (at - travel)) / travel));
      set(el, 'opacity', (fin(lt, at - travel - 0.25, 0.25) * outK(lt, o.out)).toFixed(3));
      const press = o.click !== false && lt >= at && lt < at + 0.16 ? 0.86 : 1;
      set(el, 'transform', `translate(${lerp(fx, tx, k).toFixed(1)}px, ${lerp(fy, ty, k).toFixed(1)}px) scale(${press})`);
      const r = o.click === false ? 0 : clamp((lt - at) / 0.6);
      set(ring, 'opacity', (r > 0 && r < 1 ? (1 - r) * swapK(win, at, lt) : 0).toFixed(3));
      set(ring, 'transform', `translate(${(tx - 36).toFixed(1)}px, ${(ty - 36).toFixed(1)}px) scale(${(0.3 + r * 1.2).toFixed(3)})`);
    });
    return { el, at: [tx, ty] };
  };

  /** spot(win, box, { at, out, pad=5 }): everything but box dims and an amber outline rings it. One spot at a time. The pad
   *  is small: studio controls sit a few px apart, and a zoom doubles it. It belongs to the screenshot it was drawn on: a
   *  swap on win after `at` ends it in the swap's frame, even if `out` is later or missing. */
  B.spot = function (win, box, o = {}) {
    const at = num(o.at, 0.5), pad = num(o.pad, 5), r = 10;
    const [x, y, w, hh] = win.toStage(box);
    const X = x - pad, Y = y - pad, Wd = w + pad * 2, Hd = hh + pad * 2;
    const svg = PV.s('svg', { class: 'tt-spot', width: W, height: H, viewBox: `0 0 ${W} ${H}` }, this.html);
    const hole = `M${X + r} ${Y}H${X + Wd - r}Q${X + Wd} ${Y} ${X + Wd} ${Y + r}V${Y + Hd - r}Q${X + Wd} ${Y + Hd} ${X + Wd - r} ${Y + Hd}H${X + r}Q${X} ${Y + Hd} ${X} ${Y + Hd - r}V${Y + r}Q${X} ${Y} ${X + r} ${Y}Z`;
    PV.s('path', { d: `M-600 -600H${W + 600}V${H + 600}H-600Z ${hole}`, 'fill-rule': 'evenodd', fill: 'rgba(12,10,9,0.62)' }, svg);
    PV.s('path', { d: hole, fill: 'none', stroke: col('orange'), 'stroke-width': 3 }, svg);
    win.tt.spots.push({ at, out: o.out ?? null, el: svg });
    this.tick((lt) => set(svg, 'opacity', (fin(lt, at, 0.4) * outK(lt, o.out) * swapK(win, at, lt)).toFixed(3)));
    return { el: svg };
  };

  // keeps a push-in's view inside the shot window (and the stage); a view larger than the window on an axis centres on it
  const inWindow = (key, win) => {
    const [rx, ry, rw, rh] = win.rect, vx = W / 2 / key.s, vy = H / 2 / key.s;
    key.x = clamp(rw >= 2 * vx ? clamp(key.x, rx + vx, rx + rw - vx) : rx + rw / 2, vx, W - vx);
    key.y = clamp(rh >= 2 * vy ? clamp(key.y, ry + vy, ry + rh - vy) : ry + rh / 2, vy, H - vy);
    return key;
  };

  /** zoom(win, box, { at, until, s }): the camera pushes in on box at `at` and eases back out at `until` (default at + 2.4);
   *  s defaults to what makes box a third of the frame wide (1.3–2.0). The camera's view stays inside the shot window (and the
   *  stage), so no window edge or dark ground shows; if the view is larger than the window on an axis it centres on the window. */
  B.zoom = function (win, box, o = {}) {
    const at = num(o.at, 0.6), [x, y, w, hh] = win.toStage(box);
    const s = clamp(num(o.s, W / 3 / Math.max(w, 1)), 1.3, 2.0);
    const key = inWindow(camKey(at, x + w / 2, y + hh / 2, s, win, y), win);
    addCams(this, [key, { at: num(o.until, at + 2.4), x: W / 2, y: H / 2, s: 1, dur: 0.5, ease: 'out' }]);
    return { s };
  };

  /** typing(win, box, text, { at, cps=12, size=16, pad=[2, 1], bg='#191512', zoom=true, until }): the text types itself into the input at
   *  box, at the studio's own size and place (size and pad, the text's inset in the box, in shot CSS px; the defaults are the
   *  studio's prompt input), so it matches the after-shot exactly. A patch of the
   *  input's ground (bg) covers the placeholder from the first character. Studio text is too small to read at 1080p, so the
   *  camera pushes in on the input while it types (zoom: false keeps it still; a number sets the scale) and eases back at
   *  `until` (default end + 1). Once a swap on win that lands after the typing starts has cut in, the after-shot holds the
   *  text and this hides. Use the before-shot, whose input is empty. Returns { end }: when the last character lands. */
  B.typing = function (win, box, text, o = {}) {
    const at = num(o.at, 0.6), cps = num(o.cps, 12), chars = [...String(text)];
    const [x, y, w, hh] = win.toStage(box), k = win.k;
    const size = num(o.size, 16) * k, line = size * 1.6, [px, py] = o.pad || [2, 1];
    const cover = h('div', 'tt-type', '', this.html);
    Object.assign(cover.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: Math.min(hh, line + 2 * k) + 'px', background: o.bg || '#191512' });
    const el = h('div', 'tt-type', '', this.html);
    Object.assign(el.style, { left: x + px * k + 'px', top: y + py * k + 'px', width: w - px * k + 'px', fontSize: size.toFixed(2) + 'px', lineHeight: line.toFixed(2) + 'px' });
    marker(el, w, line);
    const end = at + chars.length / cps;
    win.tt.typings.push({ at: at - 0.1, els: [el, cover] });
    if (o.zoom !== false) {
      const s = typeof o.zoom === 'number' ? o.zoom : clamp(26 / size, 1.3, 2.2);
      const cx = x + Math.min(w / 2, W / s / 2 - 40), cy = y + hh / 2;
      addCams(this, [inWindow(camKey(at - 0.45, cx, cy, s, win, y), win), { at: num(o.until, end + 1), x: W / 2, y: H / 2, s: 1, dur: 0.5, ease: 'out' }]);
    }
    this.tick((lt) => {
      const n = clamp(Math.floor((lt - at) * cps), 0, chars.length);
      const s = swapAfter(win, at - 0.1), gone = s != null && lt >= s.at;
      const v = esc(chars.slice(0, n).join('')) + `<i class="${lt >= at && Math.floor(lt * 2.4) % 2 === 0 ? '' : 'off'}"></i>`;
      if (el._h !== v) { el._h = v; el.innerHTML = v; }
      set(el, 'opacity', !gone && lt >= at - 0.1 ? '1' : '0');
      set(cover, 'opacity', !gone && n > 0 ? '1' : '0');
    });
    return { el, end };
  };

  /** step(n, label, { at, total }): the step badge top left on the hud: an amber disc with n and the action in a few words
   *  ('点「开始」' / 'Press Start'); total adds '/ 8'. It is the page title of every step page. */
  B.step = function (n, label, o = {}) {
    const T = this.hud || this, at = num(o.at, 0.1);
    const el = h('div', 'tt-step', `<b>${esc(n ?? '')}</b><span>${esc(label)}</span>${o.total ? `<em>/ ${esc(o.total)}</em>` : ''}`, T.html);
    T.tick((lt) => { const k = fin(lt, at, 0.4); set(el, 'opacity', k.toFixed(3)); set(el, 'transform', `translateY(${((1 - k) * 10).toFixed(1)}px)`); });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // the page title is a step badge without a number (opening and closing pages)
  B.title = function (str, o = {}) { return this.step(o.n ?? '', String(str), o); };

  /** note(text, { at, out, x=1500, y=780, kicker }): a short card on the hud (not moved by the camera), ≤ 20 汉字 / 12 words;
   *  **bold** takes the accent. kicker: a small label above ('提示' / 'Tip'). */
  B.note = function (text, o = {}) {
    const T = this.hud || this, at = num(o.at, 0.8);
    const el = h('div', 'tt-note', `${o.kicker ? `<span class="k">${esc(o.kicker)}</span>` : ''}${rich(text)}`, T.html);
    const w = el.offsetWidth || 380, hh = el.offsetHeight || 90;
    Object.assign(el.style, { left: clamp(num(o.x, W - 420) - w / 2, 60, W - 60 - w) + 'px', top: clamp(num(o.y, STAGE.area.y1 - 100) - hh / 2, STAGE.area.y0 - 30, STAGE.area.y1 + 5 - hh) + 'px' });
    marker(el, w, hh);
    T.tick((lt) => { const k = fin(lt, at, 0.4) * outK(lt, o.out); set(el, 'opacity', k.toFixed(3)); set(el, 'transform', `translateY(${((1 - k) * 12).toFixed(1)}px)`); });
    return { el };
  };

  /** card(text, { at, sub }): one big centred line on the ground for the opening or closing page (≤ 16 汉字 / 8 words);
   *  sub: a smaller line under it. */
  B.card = function (text, o = {}) {
    const at = num(o.at, 0.3);
    const el = h('div', 'tt-card', `${rich(text)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}`, this.html);
    marker(el, W - (STAGE.portrait ? 140 : 320), 300);   // the card's width (style.css: left/right 160, 70 in portrait)
    this.tick((lt) => { const k = fin(lt, at, 0.5); set(el, 'opacity', k.toFixed(3)); set(el, 'transform', `translateY(${((1 - k) * 16).toFixed(1)}px)`); });
    return { el };
  };

  // plain text fades in as a block (no handwriting pen)
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.4 }, o, { pen: false })); };
})();
