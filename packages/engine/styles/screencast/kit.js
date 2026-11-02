/* Screencast · kit: the film is a polished product demo of an invented desktop app. A calm desk, one large app window (title
 * bar with traffic lights, sidebar, unified toolbar with tabs, search and buttons), and inside it the parts of real software:
 * labels, buttons, fields that type with a caret, switches, dropdown menus, tables and a spreadsheet (selection, fill,
 * formulas, highlights, frozen rows), cards, an AI assistant panel that streams its answer, dialogs and toasts. Over it the
 * demo layer: an arrow cursor that glides on curves and clicks with a ripple, auto-zooming the camera onto the click; keycaps
 * for shortcuts; numbered step badges; a spotlight; a before/after wipe.
 * Every component is a pure function of page-local time lt. Generic UI only: no real product's name, logo or layout.
 * Written for Frametell Cloud. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h;
  const BOT = STAGE.area.y1 + 16;   // the lowest a box reaches: just above the subtitles (896 in landscape)
  const isZh = () => { const l = window.SCRIPT?.META?.lang; return l ? /^zh/.test(l) : !/^en/.test(document.documentElement.lang || 'zh'); };
  const L = (zh, en) => (isZh() ? zh : en);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const fin = (lt, at, dur = 0.3) => ease.out(clamp((lt - at) / dur));
  const outK = (lt, out, dur = 0.25) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));
  const bump = (d, len = 0.18) => (d < 0 || d > len ? 0 : Math.sin(Math.PI * d / len));
  const set = (el, k, v) => { const c = el._c || (el._c = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } };
  const html = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
  const cls = (el, name, on) => { if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on); };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // light markup in UI text: **bold**, `mono`, {g:chip} (g r o b p m = green red orange blue purple grey), \n
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\{([grobpm]):([^}]*)\}/g, '<span class="sc-chip $1">$2</span>').replace(/\n/g, '<br>');
  const plain = (s) => String(s ?? '').replace(/\*\*|`/g, '').replace(/\{[grobpm]:([^}]*)\}/g, '$1');
  const chars = (s) => Array.from(String(s ?? ''));
  const marker = (parent, w, hh) => { const sv = PV.s('svg', { class: 'sc-mk', width: w, height: hh }, parent); PV.s('rect', { x: 0, y: 0, width: w, height: hh, fill: 'transparent' }, sv); return sv; };
  const offIn = (el, anc) => { let x = 0, y = 0; for (let n = el; n && n !== anc; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return [x, y]; };
  const ACC = '#4F55F1';

  // ── icons: 24-unit line icons, drawn in currentColor ──
  const IC = {
    home: '<path d="M4 11 L12 4 L20 11 V20 H14.5 V14.5 H9.5 V20 H4 Z"/>',
    inbox: '<path d="M4 13 L7 5 H17 L20 13 V19 H4 Z M4 13 H9 L10 15.5 H14 L15 13 H20"/>',
    file: '<path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 13 H16 M9 17 H14"/>',
    doc: '<path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 13 H16 M9 17 H14"/>',
    folder: '<path d="M3 7 Q3 5 5 5 H9.5 L11.5 7 H19 Q21 7 21 9 V18 Q21 20 19 20 H5 Q3 20 3 18 Z"/>',
    chart: '<path d="M4 20 V4 M4 20 H20 M8.5 16 V11 M12.5 16 V7 M16.5 16 V13"/>',
    settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7 7 M17 17 L18.7 18.7 M5.3 18.7 L7 17 M17 7 L18.7 5.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20 Q5 14 12 14 Q19 14 19.5 20"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5 Q3 14 9 14 Q15 14 15.5 19.5 M15.5 5.2 Q19 5.5 19 9 Q19 12 16 12.5 M17 14.3 Q21 15 21.5 19.5"/>',
    star: '<path d="M12 3.5 L14.6 9 L20.5 9.6 L16 13.6 L17.3 19.5 L12 16.5 L6.7 19.5 L8 13.6 L3.5 9.6 L9.4 9 Z"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10 H20 M8.5 3.5 V7.5 M15.5 3.5 V7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L20.5 20.5"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10 H20.5 M3.5 14.5 H20.5 M9.5 10 V19"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M5 18 L10.5 13 L14 16 L16.5 13.5 L20 17"/>',
    sparkle: '<path d="M12 3 Q13 10 21 12 Q13 14 12 21 Q11 14 3 12 Q11 10 12 3 Z"/>',
    bell: '<path d="M6 16.5 V11 Q6 5.5 12 5.5 Q18 5.5 18 11 V16.5 L19.5 18 H4.5 Z M10 20.5 H14"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5 V8 Q8 4 12 4 Q16 4 16 8 V10.5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    play: '<path d="M8 5.5 L18.5 12 L8 18.5 Z" fill="currentColor"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7 L12 13 L20 7"/>',
    plus: '<path d="M12 5 V19 M5 12 H19"/>',
    trash: '<path d="M5 7 H19 M10 7 V4.5 H14 V7 M7 7 L8 20 H16 L17 7"/>',
    download: '<path d="M12 4 V15 M7.5 10.5 L12 15 L16.5 10.5 M5 19.5 H19"/>',
    upload: '<path d="M12 15 V4 M7.5 8.5 L12 4 L16.5 8.5 M5 19.5 H19"/>',
    share: '<path d="M12 3.8 V14 M8 7.5 L12 3.8 L16 7.5 M6 11 V19.5 H18 V11"/>',
    filter: '<path d="M4 5 H20 L14 12.5 V19 L10 17 V12.5 Z"/>',
    sort: '<path d="M7 4 V20 M3.5 16.5 L7 20 L10.5 16.5 M17 20 V4 M13.5 7.5 L17 4 L20.5 7.5"/>',
    bold: '<path d="M7 4.5 H13 Q17 4.5 17 8.2 Q17 11.5 13 11.5 H7 Z M7 11.5 H14 Q18 11.5 18 15.5 Q18 19.5 14 19.5 H7 Z" stroke-width="2.4"/>',
    italic: '<path d="M10 4.5 H18 M6 19.5 H14 M14 4.5 L10 19.5"/>',
    link: '<path d="M10 14 L14 10 M8.5 11.5 L6.5 13.5 Q4 16 6.5 18.5 Q9 21 11.5 18.5 L13.5 16.5 M10.5 7.5 L12.5 5.5 Q15 3 17.5 5.5 Q20 8 17.5 10.5 L15.5 12.5"/>',
    check: '<path d="M5 12.5 L10 17.5 L19 7"/>',
    x: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
    chevron: '<path d="M6 9.5 L12 15.5 L18 9.5"/>',
    right: '<path d="M9.5 6 L15.5 12 L9.5 18"/>',
    left: '<path d="M14.5 6 L8.5 12 L14.5 18"/>',
    more: '<circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5 V12 L15 14"/>',
    tag: '<path d="M3.5 12 V4.5 H11 L20 13.5 L13.5 20 Z"/><circle cx="8" cy="8.5" r="1.4"/>',
    moon: '<path d="M19 14.5 Q17 15.5 15 15.5 Q8.5 15.5 8.5 9 Q8.5 6.5 9.5 4.5 Q4.5 6 4.5 12 Q4.5 19.5 12 19.5 Q17 19.5 19 14.5 Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5 V4.5 M12 19.5 V21.5 M2.5 12 H4.5 M19.5 12 H21.5 M5.3 5.3 L6.7 6.7 M17.3 17.3 L18.7 18.7 M5.3 18.7 L6.7 17.3 M17.3 6.7 L18.7 5.3"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12 H20.5"/>',
    eye: '<path d="M2.5 12 Q12 3 21.5 12 Q12 21 2.5 12 Z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M5 19 L5.5 15.5 L15.5 5.5 L18.5 8.5 L8.5 18.5 Z M13.5 7.5 L16.5 10.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V5.5 Q16 4 14.5 4 H5.5 Q4 4 4 5.5 V14.5 Q4 16 5.5 16 H8"/>',
    layers: '<path d="M12 4 L21 9 L12 14 L3 9 Z M3 13.5 L12 18.5 L21 13.5"/>',
    send: '<path d="M4 12 L20 4.5 L15 20 L11.5 13 Z M11.5 13 L20 4.5"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5 Q5.5 18 12 18 Q18.5 18 18.5 11.5 M12 18 V21"/>',
    bolt: '<path d="M13 3 L5.5 13.5 H11.5 L10.5 21 L18.5 10 H12.5 Z"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10 H21 M6.5 15 H10"/>',
    shield: '<path d="M12 3 L19.5 6 V11.5 Q19.5 17.5 12 21 Q4.5 17.5 4.5 11.5 V6 Z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12 L19.5 3.5 M16 7 L18.5 9.5"/>',
    list: '<path d="M9 6 H20 M9 12 H20 M9 18 H20"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
    kanban: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="10" rx="1.5"/><rect x="15.5" y="4" width="5" height="13" rx="1.5"/>',
    code: '<path d="M8.5 7 L3.5 12 L8.5 17 M15.5 7 L20.5 12 L15.5 17"/>',
    cloud: '<path d="M7 18.5 Q3 18.5 3 14.8 Q3 11.5 6.5 11.2 Q7 6 12 6 Q16.5 6 17.5 10.5 Q21 11 21 14.6 Q21 18.5 17 18.5 Z"/>',
    refresh: '<path d="M19.5 12 A7.5 7.5 0 1 1 17 6.5 M19.5 4 V8.5 H15"/>',
    undo: '<path d="M9 7 L4.5 11 L9 15 M4.5 11 H14.5 Q19.5 11 19.5 15.5 Q19.5 20 14.5 20 H11"/>',
    text: '<path d="M5 6 V4.5 H19 V6 M12 4.5 V19.5 M9 19.5 H15"/>',
    align: '<path d="M4 6 H20 M4 10.5 H14 M4 15 H20 M4 19.5 H14"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11 V16.5 M12 7.6 V7.8"/>',
    alert: '<path d="M12 3.5 L21 19.5 H3 Z M12 10 V14 M12 16.8 V17"/>',
    pin: '<path d="M9 3.5 H15 L14 9 L17.5 12.5 H6.5 L10 9 Z M12 12.5 V20.5"/>',
    snow: '<path d="M12 3 V21 M4.2 7.5 L19.8 16.5 M4.2 16.5 L19.8 7.5 M9.5 4.5 L12 6.5 L14.5 4.5 M9.5 19.5 L12 17.5 L14.5 19.5"/>',
    wand: '<path d="M4 20 L15 9 M13 7 L17 11 M17 3 V6 M15.5 4.5 H18.5 M20 9 V11 M19 10 H21"/>',
    dot: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  };
  const icon = (name, size = 26, sw = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${IC[name] || IC.dot}</svg>`;
  const appGlyph = (app, s) => `<span class="sc-glyph" style="width:${s}px;height:${s}px;background:${app.color}">${icon(app.icon, Math.round(s * 0.6), 2.4)}</span>`;

  // ── the registry: every control registers its stage rect under an id, so the cursor, steps and the camera can find it ──
  const reg = (self) => self.sh.scReg || (self.sh.scReg = {});
  const put = (self, id, r) => { if (id != null && id !== '') reg(self)[String(id)] = r; };
  function rectOf(self, t) {
    if (Array.isArray(t) && typeof t[0] === 'number') return { x: t[0] - 1, y: t[1] - 1, w: 2, h: 2 };
    if (t && typeof t === 'object' && typeof t.x === 'number') return t.w ? t : { x: t.x - 1, y: t.y - 1, w: 2, h: 2 };
    const r = reg(self)[String(t)];
    if (!r) throw new Error(`screencast: no control with id '${t}' on this page (ids: ${Object.keys(reg(self)).slice(0, 40).join(', ')})`);
    return r;
  }
  const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  // body-local rect → stage rect entry
  const bodyRect = (win, x, y, w, hh, kind) => ({ x: win.body.x + x, y: win.body.y + y, w, h: hh, kind, win });
  // fade + slide in at `at` (instant when at ≤ 0), out at `out`; returns the entrance progress
  function vis(el, lt, at, out, dy = 8, extra = '') {
    const k = at <= 0 ? 1 : fin(lt, at, 0.3), v = k * outK(lt, out);
    set(el, 'display', v <= 0.001 ? 'none' : '');
    set(el, 'opacity', v.toFixed(3));
    set(el, 'transform', `translateY(${((1 - k) * dy).toFixed(1)}px)${extra}`);
    return v;
  }

  // ── the camera: kit components add zooms that merge with the page's own P.cam keys ──
  const cam0 = B.cam;
  const mergeCams = (sh) => { sh.cams = [...(sh.userCams || []), ...(sh.kitCams || [])].sort((a, b) => a.at - b.at); };
  B.cam = function (keys) { cam0.call(this, keys); this.sh.userCams = this.sh.cams; mergeCams(this.sh); };
  function addCams(self, keys) { const sh = self.sh; if (!sh.userCams) sh.userCams = sh.cams.slice(); sh.kitCams = (sh.kitCams || []).concat(keys); mergeCams(sh); }
  const camIn = (at, x, y, s, dur = 0.8) => { s = clamp(s, 1.1, 2.2); const hx = W / 2 / s, hy = H / 2 / s; return { at, x: clamp(x, hx, W - hx), y: clamp(y, hy, H - hy), s, dur, ease: 'inOut' }; };
  // a zoom frames the control's frame (the control with its label or row), at most scale z, never cutting the frame
  const fit = (r, z) => { const f = r.frame || { x: r.x - 60, y: r.y - 40, w: r.w + 120, h: r.h + 80 }; return { p: mid(f), s: Math.max(1.15, Math.min(z, (W * 0.92) / f.w, (H * 0.8) / f.h)) }; };
  const camBack = (at, dur = 0.8) => ({ at, x: W / 2, y: H / 2, s: 1, dur, ease: 'inOut' });

  // ── P.app: the film's one app, declared identically on every page ──
  const appDefaults = (self) => { const a = self.sh.scApp; if (!a) return {}; const d = { app: { name: a.name, icon: a.icon, color: a.color } }; for (const k of ['sidebar', 'toolbar', 'title', 'crumb', 'active', 'bg']) if (a[k] != null) d[k] = a[k]; return d; };
  /** app({ name, icon, color, tint, sidebar, toolbar, title, crumb, doc, date, people, … }): declares THE film's app, once, as the FIRST
   *  line of every page — copy the storyboard's app line exactly, the same on every page. P.desk and P.window then take their
   *  defaults from it (tint; app name/icon/color, sidebar, toolbar, title, crumb), so identical pages give the identical window;
   *  a page passes only what differs (active, title of the view it shows). Extra fields (doc, date, people, …) are the film's fixed
   *  facts: returned as is, so a page writes A.date, A.people[0] instead of inventing new ones. Returns the spec. */
  B.app = function (spec = {}) { this.sh.scApp = Object.assign({}, spec); return this.sh.scApp; };

  // ── P.desk ────────────────────────────────────────────
  const DESK = {
    mist: ['#EEF1F6', '#D9DFEA', '#FFFFFF', '#C7D0E1', '234, 237, 243', false],
    sand: ['#F6F1E9', '#E6DCCC', '#FFFDF8', '#D8C9B2', '242, 236, 226', false],
    sage: ['#EDF3EF', '#D3E2D8', '#FFFFFF', '#BCD3C4', '230, 238, 233', false],
    lilac: ['#F1EFF8', '#DCD8EE', '#FFFFFF', '#C8C0E6', '236, 233, 245', false],
    sky: ['#ECF3FA', '#D2E1F1', '#FFFFFF', '#B9CFE8', '230, 238, 247', false],
    slate: ['#3B4253', '#232834', '#566078', '#171B24', '44, 50, 64', true],
  };
  /** desk({ tint }): the calm desk the app window floats on; call it right after P.app on every page (tint defaults to the app's). tint: 'mist' (cool grey,
   *  default) | 'sand' (warm) | 'sage' | 'lilac' | 'sky' | 'slate' (dark, for a night-mode or pro-tool film). Keep one tint for
   *  the whole film unless the film moves to a different app. */
  B.desk = function (o = {}) {
    if (typeof o === 'string') o = { tint: o };
    const d = DESK[o.tint ?? this.sh.scApp?.tint] || DESK.mist;
    const el = h('div', 'sc-desk', null, null);
    this.host.insertBefore(el, this.host.firstChild);
    el.style.background = `radial-gradient(1000px 760px at 22% 18%, ${d[2]}${d[5] ? '66' : 'cc'}, transparent 70%), radial-gradient(1200px 900px at 88% 96%, ${d[3]}, transparent 70%), linear-gradient(160deg, ${d[0]} 0%, ${d[1]} 100%)`;
    if (this.hud) this.hud.host.style.setProperty('--scb', d[4]);
    this.sh.scDark = d[5];
    return { el };
  };

  // ── P.window ──────────────────────────────────────────
  /** window({ app: { name, icon, color }, title, crumb, sidebar: [...], active, toolbar: [...], bg, x=80, y=92, w=1760, h=804, at, rise, out, id }):
   *  THE frame of the film (defaults from P.app) — one invented app's window floating on the desk with a soft shadow; every page has one, at the
   *  same place, so the film reads as one continuous screen recording. app: an invented app (name like '账本' / 'Ledger', icon
   *  from the icon list, color: a palette colour for its glyph). With `sidebar` (items: 'Label' or { label, icon, badge, id },
   *  { sep: true } for a gap) the window has a full-height sidebar (320 px) with the traffic lights and the app's name, and a
   *  92 px header holding `title` (the open document or view; crumb: a muted parent before it) and the toolbar. Without a sidebar
   *  it has a 64 px title bar (lights, glyph, title) and, if `toolbar`, an 80 px tool row. toolbar items: 'iconName' (icon button),
   *  { icon, label } (button), { label, primary: true }, { search: 'placeholder', w }, { items: ['Board', 'List'], active } (tabs,
   *  shown after the title), { avatars: 3 }, { sep: true }. Every sidebar item, tool and tab registers its id (id ?? label ??
   *  icon) for the cursor. active: the selected sidebar item (index or label). bg: 'grey' for a dashboard body.
   *  The BODY is where everything else goes, in body-local coordinates (0,0 = its top-left): 1440 × 712 with a sidebar, 1760 ×
   *  740 without (1760 × 660 with a tool row); the window fills the stage, so a wide shot reads. Returns win { body: { x, y, w, h } (stage), select(target, at) — switch the
   *  active sidebar item or tab at time `at` }. */
  B.window = function (o = {}) {
    const self = this;
    o = Object.assign({}, appDefaults(self), o);
    const side = Array.isArray(o.sidebar) ? o.sidebar : null;
    const x = clamp(num(o.x, 80), 20, W - 640), y = clamp(num(o.y, STAGE.title.y + 14), 20, BOT - 296);
    const w = clamp(num(o.w, W - 160), 620, W - x - 20), hh = clamp(num(o.h, BOT - STAGE.title.y - 14), 360, BOT - y);
    const app = Object.assign({ name: L('工作台', 'Workspace'), icon: 'grid', color: 'ink' }, typeof o.app === 'string' ? { name: o.app } : (o.app || {}));
    app.color = col(app.color);
    const root = h('div', 'sc-win', null, self.html);
    Object.assign(root.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    // the window is content, but it nearly fills the stage: the page check skips full-bleed boxes as backgrounds, so the
    // marker is inset from the sides
    { const mk = marker(root, Math.max(100, w - 260), hh); mk.style.left = Math.min(130, (w - 100) / 2) + 'px'; }
    const clip = h('div', 'sc-clip', null, root);
    const SW = side ? clamp(num(o.sideW, 320), 220, 400) : 0;
    const tools = Array.isArray(o.toolbar) ? o.toolbar : [];
    const lights = '<div class="sc-lights"><i class="r"></i><i class="y"></i><i class="g"></i></div>';
    const win = { x, y, w, h: hh, root, side: [], tabs: [], sel: [], id: o.id || 'window' };
    let headTop, headH;
    if (side) {
      const sb = h('div', 'sc-side', lights + `<div class="sc-app">${appGlyph(app, 46)}<span>${esc(app.name)}</span></div>`, clip);
      sb.style.width = SW + 'px';
      let top = 160;
      side.forEach((it) => {
        const t = typeof it === 'string' ? { label: it } : (it || {});
        if (t.sep) { const s = h('div', 'sc-ssep', null, sb); s.style.top = (top + 10) + 'px'; top += 22; return; }
        const el = h('div', 'sc-si', `<span class="ic">${icon(t.icon || 'dot', 28)}</span><span class="t">${esc(t.label)}</span>${t.badge != null ? `<span class="bd">${esc(t.badge)}</span>` : ''}`, sb);
        el.style.top = top + 'px';
        const id = t.id ?? t.label;
        win.side.push({ el, id, label: t.label });
        put(self, id, { x: x + 12, y: y + top, w: SW - 24, h: 62, kind: 'side', win });
        top += 70;
      });
      headTop = 0; headH = 92;
    } else {
      h('div', 'sc-bar', lights + `<div class="t">${appGlyph(app, 34)}<span>${esc(o.title ?? app.name)}</span></div>`, clip);
      headTop = 64; headH = tools.length ? 80 : 0;
    }
    if (headH) {
      const head = h('div', 'sc-head' + (side ? '' : ' slim'), null, clip);
      Object.assign(head.style, { left: SW + 'px', top: headTop + 'px', height: headH + 'px' });
      if (side && (o.title || o.crumb)) h('div', 't', (o.crumb ? `<span class="crumb">${esc(o.crumb)} / </span>` : '') + esc(o.title ?? ''), head);
      const left = h('div', 'sc-hl', null, head), right = h('div', 'sc-tools', null, head);
      const built = [];
      for (let t of tools) {
        if (typeof t === 'string') t = { icon: t };
        if (!t) continue;
        let el, id = t.id ?? t.label ?? t.icon;
        if (t.sep) { h('div', 'sc-sep', null, right); continue; }
        if (Array.isArray(t.items)) {
          el = h('div', 'sc-tabs', t.items.map((s) => `<span>${esc(s)}</span>`).join(''), left);
          const spans = [...el.children];
          const a0 = typeof t.active === 'number' ? t.active : Math.max(0, t.items.indexOf(t.active));
          const group = { spans, items: t.items, a0 };
          win.tabs.push(group);
          spans.forEach((sp, i) => built.push([sp, t.items[i], 'tab']));
          continue;
        }
        if (t.search != null) { el = h('div', 'sc-search', `${icon('search', 24)}<span>${esc(t.search || L('搜索', 'Search'))}</span>`, right); el.style.width = num(t.w, 300) + 'px'; id = t.id ?? 'search'; }
        else if (t.avatars) {
          const n = clamp(Math.round(num(t.avatars, 3)), 1, 5), AV = ['#E8890C', '#1E9E5A', '#8B5CF6', '#E0453B', '#4A5163'], NM = t.names || ['A', 'M', 'K', 'J', 'S'];
          el = h('div', 'sc-avs', Array.from({ length: n }, (_, i) => `<b style="background:${AV[i]}">${esc(NM[i] ?? '')}</b>`).join(''), right);
          id = t.id ?? 'avatars';
        } else if (t.label) el = h('div', 'sc-tb' + (t.primary ? ' primary' : ''), (t.icon ? icon(t.icon, 24) : '') + `<span>${esc(t.label)}</span>`, right);
        else el = h('div', 'sc-ib' + (t.active ? ' on' : ''), icon(t.icon, 26), right);
        built.push([el, id, 'tool']);
      }
      for (const [el, id, kind] of built) { const [ox, oy] = offIn(el, root); put(self, id, { x: x + ox, y: y + oy, w: el.offsetWidth, h: el.offsetHeight, kind, win }); }
    }
    const bodyTop = headTop + headH;
    const body = h('div', 'sc-body' + (o.bg === 'grey' ? ' grey' : ''), null, clip);
    Object.assign(body.style, { left: SW + 'px', top: bodyTop + 'px' });
    win.el = body;
    win.body = { x: x + SW, y: y + bodyTop, w: w - SW, h: hh - bodyTop };
    win.top = h('div', 'sc-top', null, clip);
    win.over = h('div', 'sc-over', null, root);
    put(self, win.id, { x, y, w, h: hh, kind: 'window', win });
    const a0 = typeof o.active === 'number' ? o.active : Math.max(0, win.side.findIndex((s) => s.id === o.active || s.label === o.active));
    win.select = (target, at) => {
      const si = typeof target === 'number' ? target : win.side.findIndex((s) => s.id === target || s.label === target);
      if (si >= 0 && (typeof target !== 'number' || win.side.length)) { win.sel.push({ at: num(at, 0), kind: 'side', i: si }); return win; }
      win.tabs.forEach((g, gi) => { const ti = g.items.indexOf(target); if (ti >= 0) win.sel.push({ at: num(at, 0), kind: 'tab', g: gi, i: ti }); });
      return win;
    };
    const at = num(o.at, 0), rise = !!o.rise;
    self.tick((lt) => {
      const k = rise ? fin(lt, at, 0.7) : (lt >= at ? 1 : 0), v = k * outK(lt, o.out, 0.3);
      set(root, 'display', v <= 0.001 ? 'none' : 'block');
      set(root, 'opacity', (rise ? clamp(k * 1.5) : 1) * outK(lt, o.out, 0.3) + '');
      set(root, 'transform', `translateY(${((1 - k) * 60).toFixed(1)}px) scale(${(1 - (1 - k) * 0.03).toFixed(4)})`);
      let si = a0; const ti = win.tabs.map((g) => g.a0);
      for (const s of win.sel) if (lt >= s.at) { if (s.kind === 'side') si = s.i; else ti[s.g] = s.i; }
      win.side.forEach((s, i) => cls(s.el, 'on', i === si));
      win.tabs.forEach((g, gi) => g.spans.forEach((sp, i) => cls(sp, 'on', i === ti[gi])));
    });
    return win;
  };

  // ── body components ───────────────────────────────────
  /** label(win, x, y, text, { kind='h2', w, color, at, out, id }): plain UI text in the window body — kind 'h1' (44 px, the
   *  view's big heading), 'h2' (34 px, a section heading), 'body' (28 px paragraph), 'meta' (26 px muted), 'stat' (64 px, a
   *  dashboard number). Markup: **bold**, `mono`, {g:chip}. Text is UI copy, never the narration. */
  B.label = function (win, x, y, text, o = {}) {
    const el = h('div', 'sc-lbl ' + (o.kind || 'h2'), rich(text), win.el);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', maxWidth: num(o.w, win.body.w - x - 40) + 'px' });
    if (o.color) el.style.color = col(o.color);
    if (o.id) put(this, o.id, bodyRect(win, x, y, el.offsetWidth, el.offsetHeight, 'label'));
    const at = num(o.at, 0);
    this.tick((lt) => vis(el, lt, at, o.out));
    return { el };
  };

  /** button(win, x, y, label, { variant='secondary'|'primary'|'ghost'|'danger', icon, size: 'l', align: 'r', press, then: { at, label,
   *  icon, variant: 'done' }, at, out, id }): a real button at body-local (x, y) (align 'r': x is its right edge). press: t (or
   *  [t, …]) — it dips as the cursor clicks; then: it changes at `at` (e.g. 'Saved' with icon 'check', variant 'done'). Registers id
   *  (default: label). */
  B.button = function (win, x, y, label, o = {}) {
    const v0 = o.variant || (o.primary ? 'primary' : 'secondary');
    const face = (lb, ic, v) => [`sc-btn ${v}${o.size === 'l' ? ' l' : ''}`, `${ic ? icon(ic, 26, 2.2) : ''}<span>${esc(lb)}</span><i class="pr"></i>`];
    const [c0, f0] = face(label, o.icon, v0);
    const el = h('div', c0, f0, win.el);
    const bw = el.offsetWidth, bh = el.offsetHeight;
    const lx = o.align === 'r' ? x - bw : x;
    Object.assign(el.style, { left: lx + 'px', top: y + 'px' });
    put(this, o.id ?? label, bodyRect(win, lx, y, bw, bh, 'button'));
    const presses = [].concat(o.press ?? []).map(Number), thens = [].concat(o.then || []);
    const at = num(o.at, 0);
    this.tick((lt) => {
      let b = 0; for (const p of presses) b = Math.max(b, bump(lt - p, 0.2));
      vis(el, lt, at, o.out, 8, ` scale(${(1 - 0.05 * b).toFixed(4)})`);
      let f = [c0, f0]; for (const t of thens) if (lt >= num(t.at, 1e9)) f = face(t.label ?? label, t.icon ?? o.icon, t.variant || v0);
      if (el.className !== f[0]) el.className = f[0];
      html(el, f[1]);
      set(el.lastChild, 'opacity', (b * 0.14).toFixed(3));
    });
    return { el };
  };

  /** field(win, x, y, w, { label, value, placeholder, type, typeAt, cps, focus, blur, rows, icon, select, change: { at, value },
   *  error: { at, text }, mono, at, out, id }): a text field at body-local (x, y), w wide (74 px tall; rows: n for a multi-line box,
   *  e.g. an AI prompt). label sits above it. type: text typed in from typeAt at cps characters a second (default 8 汉字 / 14
   *  letters) with an accent caret; the focus ring comes on 0.35 s before typing (or at focus) and goes at blur. select: true —
   *  a dropdown field with a chevron; change swaps its value. error: a red ring and message. The cursor turns into an I-beam
   *  over a field. Registers id (default: label) on the box itself. */
  B.field = function (win, x, y, w, o = {}) {
    if (w && typeof w === 'object') { o = w; w = o.w; }
    w = clamp(num(w, 640), 160, win.body.w - x);
    const rows = Math.max(1, Math.round(num(o.rows, 1))), multi = rows > 1;
    const el = h('div', 'sc-fl', null, win.el);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px' });
    if (o.label) h('div', 'lb', esc(o.label), el);
    const box = h('div', 'sc-in' + (multi ? ' multi' : '') + (o.mono ? ' mono' : ''), null, el);
    if (multi) box.style.height = (rows * 46 + 36) + 'px';
    if (o.icon) h('span', 'ld', icon(o.icon, 26), box);
    const v = h('div', 'v', null, box);
    if (o.select) h('span', 'ch', icon('chevron', 26), box);
    const er = o.error ? h('div', 'er', esc(o.error.text || ''), el) : null;
    const value = String(o.value ?? ''), typed = chars(plain(o.type ?? ''));
    const typeAt = num(o.typeAt, num(o.at, 0) + 1), cps = num(o.cps, isZh() ? 8 : 14), doneAt = typeAt + typed.length / cps;
    const focusAt = o.focus != null ? num(o.focus, 0) : (typed.length ? typeAt - 0.35 : null), blurAt = o.blur != null ? num(o.blur, 1e9) : null;
    const changes = [].concat(o.change || []);
    const boxTop = o.label ? 48 : 0, bxH = box.offsetHeight || 74;
    put(this, o.id ?? o.label ?? 'field', Object.assign(bodyRect(win, x, y + boxTop, w, bxH, 'field'), { frame: bodyRect(win, x - 20, y - 16, w + 40, boxTop + bxH + 32) }));
    const at = num(o.at, 0);
    this.tick((lt) => {
      vis(el, lt, at, o.out);
      let txt = value; for (const c of changes) if (lt >= num(c.at, 1e9)) txt = String(c.value);
      if (typed.length && lt >= typeAt) txt += typed.slice(0, Math.min(typed.length, Math.floor((lt - typeAt) * cps + 1e-6) + 1)).join('');
      const focused = focusAt != null && lt >= focusAt && (blurAt == null || lt < blurAt);
      const caret = focused && (lt < doneAt + 0.3 || ((lt - doneAt - 0.3) % 1.0) < 0.55);
      const errOn = o.error && lt >= num(o.error.at, 1e9);
      cls(box, 'focus', focused && !errOn); cls(box, 'err', errOn);
      if (er) set(er, 'display', errOn ? 'block' : 'none');
      const c = caret ? '<i class="sc-caret"></i>' : '';
      html(v, txt ? `<span class="vt">${esc(txt)}</span>${c}` : `${c}<span class="ph">${esc(o.placeholder || '')}</span>`);
      if (!multi) { const sp = v.firstChild; set(v, 'justifyContent', txt && sp.offsetWidth + 8 > v.clientWidth ? 'flex-end' : 'flex-start'); }
    });
    return { el };
  };

  /** toggle(win, x, y, label, { sub, w=760, on=false, flip: t | [t, …], icon, line=true, at, out, id }): a settings row at body-local
   *  (x, y): optional icon tile, the label (28 px) and a muted sub line, and a switch on the right that slides on (accent) or off
   *  at each flip time. Rows stack every 108 px (128 with sub). Registers id (default: label) on the switch. */
  B.toggle = function (win, x, y, label, o = {}) {
    const w = clamp(num(o.w, 760), 300, win.body.w - x), rh = o.sub ? 128 : 108;
    const el = h('div', 'sc-tg' + (o.line === false ? ' noline' : ''), `${o.icon ? `<span class="ic">${icon(o.icon, 28)}</span>` : ''}<div class="tt"><div class="l">${esc(label)}</div>${o.sub ? `<div class="s">${esc(o.sub)}</div>` : ''}</div><div class="sc-sw"><i></i></div>`, win.el);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: rh + 'px' });
    const sw = el.querySelector('.sc-sw'), knob = sw.firstChild;
    const [ox, oy] = offIn(sw, win.el);
    put(this, o.id ?? label, Object.assign(bodyRect(win, ox, oy, 88, 50, 'switch'), { frame: bodyRect(win, x - 16, y, w + 32, rh) }));
    const flips = [].concat(o.flip ?? []).map(Number).sort((a, b) => a - b), on0 = !!o.on;
    const at = num(o.at, 0);
    const offC = [213, 217, 225], onC = [79, 85, 241];
    this.tick((lt) => {
      vis(el, lt, at, o.out);
      let st = on0 ? 1 : 0, last = -1e9;
      for (const f of flips) if (lt >= f) { st = 1 - st; last = f; }
      const k = ease.out(clamp((lt - last) / 0.26)), p = st ? k : 1 - k;   // p: 0 off → 1 on
      const pos = flips.length && last > -1e9 ? p : st;
      set(knob, 'transform', `translateX(${(pos * 38).toFixed(1)}px)`);
      const c = offC.map((a, i) => Math.round(lerp(a, onC[i], pos)));
      set(sw, 'background', `rgb(${c.join(',')})`);
    });
    return { el };
  };

  /** menu(win, anchor, items, { at, pick, pickAt, out, w=400, place: 'below'|'above'|'right'|'at', title, id='menu' }): a dropdown or
   *  context menu that opens at `at` under the anchor (a control id or [x, y]; 'at' opens it right at that point, for a right-click).
   *  items: 'Label', '-' (separator), or { label, key: '⌘C' (shortcut, mono), icon, check: true|false, more: true (submenu arrow),
   *  danger, id }. pick: the item (index among non-separator items, or its label) the cursor chooses: it is hovered from pickAt − 0.5
   *  and flashes accent at pickAt; the menu closes at out (default pickAt + 0.45). Returns { item(i) → [x, y] } for the cursor; item i
   *  is also registered as '<id>.<i>'. */
  B.menu = function (win, anchor, items, o = {}) {
    const self = this, ar = rectOf(self, anchor), id = o.id || 'menu';
    const mw = clamp(num(o.w, 400), 220, 720);
    const list = (items || []).map((it) => (typeof it === 'string' ? (it === '-' ? { sep: true } : { label: it }) : it || { sep: true }));
    const el = h('div', 'sc-menu', o.title ? `<div class="mt">${esc(o.title)}</div>` : '', win.over);
    el.style.width = mw + 'px';
    const rows = [];
    for (const it of list) {
      if (it.sep) { h('div', 'sc-msep', null, el); continue; }
      const r = h('div', 'sc-mi' + (it.danger ? ' danger' : ''), `${it.check != null ? `<span class="ck">${it.check ? icon('check', 24, 2.6) : ''}</span>` : ''}${it.icon ? `<span class="ic">${icon(it.icon, 26)}</span>` : ''}<span class="l">${esc(it.label)}</span>${it.key ? `<span class="k">${shortcut(it.key)}</span>` : ''}${it.more ? `<span class="mr">${icon('right', 24)}</span>` : ''}`, el);
      rows.push({ el: r, it });
    }
    const mh = el.offsetHeight;
    let lx = ar.x - win.x, ly = ar.y + ar.h + 8 - win.y;
    if (o.place === 'right') { lx = ar.x + ar.w + 10 - win.x; ly = ar.y - 8 - win.y; }
    else if (o.place === 'at') { lx = ar.x + ar.w / 2 + 6 - win.x; ly = ar.y + ar.h / 2 + 6 - win.y; }
    if (o.place === 'above' || (o.place !== 'right' && o.place !== 'at' && ly + mh > win.h - 12)) ly = ar.y - 8 - mh - win.y;
    lx = clamp(lx, 12, win.w - mw - 12); ly = clamp(ly, 12, win.h - mh - 12);
    Object.assign(el.style, { left: lx + 'px', top: ly + 'px' });
    const mFrame = { x: win.x + lx - 30, y: win.y + ly - 30, w: mw + 60, h: mh + 60 };
    const pts = rows.map((r) => { const [ox, oy] = offIn(r.el, win.root); return { x: win.x + ox, y: win.y + oy, w: r.el.offsetWidth, h: r.el.offsetHeight, kind: 'item', win, frame: mFrame }; });
    pts.forEach((p, i) => { put(self, `${id}.${i}`, p); if (rows[i].it.id) put(self, rows[i].it.id, p); });
    put(self, id, { x: win.x + lx, y: win.y + ly, w: mw, h: mh, kind: 'menu', win });
    const at = num(o.at, 1), pickAt = o.pickAt != null ? num(o.pickAt, null) : null;
    const pk = typeof o.pick === 'number' ? o.pick : rows.findIndex((r) => r.it.label === o.pick || r.it.id === o.pick);
    const out = o.out != null ? num(o.out, null) : (pickAt != null ? pickAt + 0.45 : null);
    self.tick((lt) => {
      const k = fin(lt, at, 0.2), v = (lt >= at ? 1 : 0) * outK(lt, out, 0.18);
      set(el, 'display', v <= 0.001 ? 'none' : 'block');
      set(el, 'opacity', (clamp(k * 1.6) * v).toFixed(3));
      set(el, 'transform', `translateY(${((1 - k) * -10).toFixed(1)}px) scale(${(0.97 + 0.03 * k).toFixed(4)})`);
      rows.forEach((r, i) => {
        const st = i === pk && pickAt != null ? (lt >= pickAt ? 2 : lt >= pickAt - 0.5 ? 1 : 0) : 0;
        set(r.el, 'background', st === 2 ? ACC : st === 1 ? '#EFF0F4' : 'transparent');
        cls(r.el, 'pk', st === 2);
      });
    });
    return { el, item: (i) => mid(pts[clamp(i, 0, pts.length - 1)]) };
  };

  // a shortcut in a menu: modifier glyphs drawn as SVG (fonts may lack them), letters as mono text
  const SG = { '⌘': 'cmd', '⇧': 'shift', '⌥': 'opt', '⌃': 'ctrl', '↵': 'enter', '⌫': 'del' };
  const shortcut = (k) => chars(k).map((c) => (SG[c] ? `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-4px">${KG[SG[c]]}</svg>` : esc(c))).join('');

  // ── the table and the spreadsheet ─────────────────────
  const letter = (i) => String.fromCharCode(65 + i);
  const parseRef = (s) => { const m = /^([A-Z])(\d+)$/.exec(String(s).trim().toUpperCase()); return m ? [m[1].charCodeAt(0) - 65, +m[2] - 1] : null; };
  const parseRange = (s) => { const [a, b] = String(s).split(':'); const p = parseRef(a), q = parseRef(b || a); if (!p || !q) return null; return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
  const isNum = (s) => /^[\s$¥€£+\-−]*[\d.,]+\s*[%万亿kKmM]?$/.test(plain(s)) && /\d/.test(s);
  /** table(win, x, y, { cols, rows, w, sheet, head, rowH, rowsAt, hl, check, checked, select, reveal, edit, mark, freeze, formula, at, out, id='table' }):
   *  rows of data at body-local (x, y), w wide (default: to the body's right edge − 40). rows: arrays of cell strings (markup
   *  **bold**, `mono`, {g:Paid} status chips). Numbers right-align by themselves.
   *  A data table (default): cols: ['Name', { label: 'Amount', w: 220 }, …] header; row height 74; check: true adds checkboxes
   *  (checked: [{ row, at }]); hl: [{ row, at, out, color='blue' }] highlights a row (selected = blue, a problem = red); rowsAt:
   *  [t, …] makes rows arrive one by one (a new record). Ids: '<id>:<row>' (0-based data row) and '<id>:<row>.<col>'.
   *  sheet: true — a SPREADSHEET: column letters A B C…, row numbers, gridlines, 62 px rows; rows[0] is row 1 (bold when head
   *  ≠ false). formula: { cell, text, typeAt, cps } adds the formula bar (name box + fx) above, mirroring the cell being edited.
   *  select: [{ range: 'B2:B7', at }] — the accent selection box (with fill handle) jumps between ranges and lights their
   *  headers. reveal: [{ range, at, dur=0.6 }] — those cells fill in one after another (fill-down, paste). edit: [{ cell, at, text,
   *  cps }] — text (e.g. '=SUM(B2:B7)') is typed into the cell, then it shows its value from rows. mark: [{ range, at, color }]
   *  tints cells (conditional format, highlight). freeze: { row: 1, col, at } draws the frozen-pane line. Ids: '<id>:B3'.
   *  Returns { cell(ref | row, col) → [x, y], range(ref) → rect }. Keep it to ≤ 7 rows and ≤ 5 columns: fewer rows, bigger. */
  B.table = function (win, x, y, o = {}) {
    const self = this, sheet = !!o.sheet, id = o.id || 'table';
    const rows = (o.rows || []).map((r) => (r || []).map((c) => (c == null ? '' : String(c))));
    const colsArr = Array.isArray(o.cols) ? o.cols.map((c) => (c && typeof c === 'object' ? c : { label: c })) : [];
    const nC = Math.max(colsArr.length, ...rows.map((r) => r.length), 1);
    const tw = clamp(num(o.w, win.body.w - x - 40), 300, win.body.w - x);
    const rn = sheet ? 70 : (o.check ? 70 : 0);
    let ws = Array.from({ length: nC }, (_, i) => colsArr[i]?.w ?? (o.widths || [])[i] ?? null);
    const fixed = ws.reduce((a, b) => a + (b || 0), 0), nFree = ws.filter((v) => v == null).length;
    ws = ws.map((v) => v ?? Math.max(60, (tw - rn - fixed) / Math.max(1, nFree)));
    const cx = [rn]; for (let i = 0; i < nC; i++) cx.push(cx[i] + ws[i]);
    const fbH = sheet && o.formula ? 66 : 0;
    const headH = sheet ? 50 : (colsArr.some((c) => c.label) ? 64 : 0), rH = num(o.rowH, sheet ? 62 : 74);
    const y0 = fbH + headH;
    const el = h('div', 'sc-tbl' + (sheet ? ' sheet' : ''), null, win.el);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: cx[nC] + 'px', height: (y0 + rows.length * rH) + 'px' });
    const stage = (lx, ly, w, hh, kind) => bodyRect(win, x + lx, y + ly, w, hh, kind);
    // what a zoom on a cell frames: the row's label column through the cell (and one more column), the rows either side and,
    // near the top, the header — never a lone cell in an empty grid
    const cellFrame = (ci, ri) => { const r0 = Math.max(0, ri - 1), r1 = Math.min(rows.length - 1, ri + 1), c1 = Math.min(nC, ci + 2); const top = r0 <= 1 ? fbH : y0 + r0 * rH; return stage(0, top, cx[c1], y0 + (r1 + 1) * rH - top); };
    // formula bar
    let fb = null;
    if (fbH) {
      const f = h('div', 'sc-fx', `<div class="nb"></div><div class="fx">fx</div><div class="ft"></div>`, el);
      fb = { nb: f.children[0], ft: f.children[2] };
      put(self, `${id}:fx`, stage(0, 0, cx[nC], fbH, 'field'));
    }
    // header
    const hcs = [];
    if (headH) {
      const hd = h('div', 'hdr', null, el);
      Object.assign(hd.style, { top: fbH + 'px', height: headH + 'px' });
      if (rn && sheet) { const c = h('div', 'corner', null, hd); c.style.width = rn + 'px'; }
      for (let i = 0; i < nC; i++) {
        const c = h('div', 'hc' + (!sheet && rows.length && isNum(rows[rows.length - 1][i] || '') ? ' r' : ''), esc(sheet ? letter(i) : (colsArr[i]?.label ?? '')), hd);
        Object.assign(c.style, { left: cx[i] + 'px', width: ws[i] + 'px' });
        hcs.push(c);
        put(self, sheet ? `${id}:${letter(i)}` : `${id}:h${i}`, stage(cx[i], fbH, ws[i], headH, 'header'));
      }
    }
    // rows and cells
    const head1 = sheet && o.head !== false;
    const cells = [], trs = [], rns = [];
    const rowsAt = o.rowsAt || [];
    rows.forEach((r, ri) => {
      const tr = h('div', 'sc-tr', '<i class="rbg"></i>', el);
      Object.assign(tr.style, { top: (y0 + ri * rH) + 'px', height: rH + 'px' });
      if (sheet) { const n = h('div', 'rn', String(ri + 1), tr); n.style.width = rn + 'px'; rns.push(n); }
      let cb = null;
      if (!sheet && o.check) cb = h('div', 'sc-cb', icon('check', 22, 3), tr);
      const row = [];
      for (let ci = 0; ci < nC; ci++) {
        const txt = r[ci] ?? '';
        const td = h('div', 'sc-td' + (isNum(txt) ? ' r' : '') + (head1 && ri === 0 ? ' hd' : ''), `<i class="bg"></i><span class="tv">${rich(txt)}</span>`, tr);
        Object.assign(td.style, { left: cx[ci] + 'px', width: ws[ci] + 'px' });
        row.push({ td, bg: td.firstChild, tv: td.lastChild, txt, ri, ci });
        put(self, sheet ? `${id}:${letter(ci)}${ri + 1}` : `${id}:${ri}.${ci}`, Object.assign(stage(cx[ci], y0 + ri * rH, ws[ci], rH, 'cell'), { frame: cellFrame(ci, ri) }));
      }
      cells.push(row);
      trs.push({ tr, rbg: tr.firstChild, cb, at: rowsAt[ri] });
      put(self, sheet ? `${id}:${ri + 1}` : `${id}:${ri}`, Object.assign(stage(0, y0 + ri * rH, cx[nC], rH, 'row'), { frame: stage(0, Math.max(0, y0 + (ri - 1) * rH) - headH * (ri < 2 ? 1 : 0), cx[nC], rH * 3) }));
    });
    put(self, id, stage(0, 0, cx[nC], y0 + rows.length * rH, 'table'));
    const cellAt = (c, r) => cells[r]?.[c];
    const rangeRect = (rg) => { const [c0, r0, c1, r1] = rg; return [cx[c0], y0 + r0 * rH, cx[c1 + 1] - cx[c0], (r1 - r0 + 1) * rH]; };
    // timed effects, per cell
    const fx = new Map(); const fxOf = (c) => { if (!fx.has(c)) fx.set(c, {}); return fx.get(c); };
    for (const rv of [].concat(o.reveal || [])) {
      const rg = parseRange(rv.range); if (!rg) continue;
      const list = []; for (let c = rg[0]; c <= rg[2]; c++) for (let r = rg[1]; r <= rg[3]; r++) { const cl = cellAt(c, r); if (cl) list.push(cl); }
      const at = num(rv.at, 1), dur = num(rv.dur, 0.6);
      list.forEach((cl, k) => { fxOf(cl).reveal = at + (list.length > 1 ? (dur * k) / (list.length - 1) : 0); });
    }
    const edits = [];
    for (const ed of [].concat(o.edit || [])) {
      const p = parseRef(ed.cell); const cl = p && cellAt(p[0], p[1]); if (!cl) continue;
      const t = chars(ed.text ?? ''), at = num(ed.at, 1), cps = num(ed.cps, 12), done = at + t.length / cps + 0.35;
      const e = { cl, t, at, cps, done }; fxOf(cl).edit = e; edits.push(e);
    }
    for (const mk of [].concat(o.mark || [])) {
      const rg = parseRange(mk.range); if (!rg) continue;
      const c0 = mk.color || 'yellow';
      for (let c = rg[0]; c <= rg[2]; c++) for (let r = rg[1]; r <= rg[3]; r++) { const cl = cellAt(c, r); if (!cl) continue; const f = fxOf(cl); f.mark = { at: num(mk.at, 1), color: c0 }; cl.bg.style.background = c0 === 'yellow' ? '#FFF3C4' : col(c0 + 'F'); }
    }
    const MARKT = { green: '#157A45', red: '#C2342B', orange: '#A65F00', blue: '#3C42D4', purple: '#6D3FE0', yellow: '#151823' };
    for (const [cl, f] of fx) if (f.reveal != null && !f.mark) cl.bg.style.background = '#E8E9FE';
    // selection
    const sels = [].concat(o.select || []).map((s) => ({ at: num(s.at, 0), rg: s.range ? parseRange(s.range) : null })).sort((a, b) => a.at - b.at);
    const selEl = sels.length ? h('div', 'sc-sel', '<i></i>', el) : null;
    // freeze
    const frz = o.freeze ? h('div', 'sc-frz', null, el) : null;
    if (frz) { const fr = num(o.freeze.row, 0), fc = num(o.freeze.col, 0); if (fr) Object.assign(frz.style, { left: '0', width: cx[nC] + 'px', top: (y0 + fr * rH - 3) + 'px', height: '5px', transformOrigin: '0 50%' }); else Object.assign(frz.style, { top: '0', height: (y0 + rows.length * rH) + 'px', left: (cx[fc] - 2) + 'px', width: '4px', transformOrigin: '50% 0' }); }
    // non-sheet row highlights and checks
    const hls = [].concat(o.hl || []), checks = [].concat(o.checked || []);
    hls.forEach((hl) => { const t = trs[num(hl.row, -1)]; if (t) t.rbg.style.background = col((hl.color || 'blue') + 'F'); });
    const at = num(o.at, 0);
    self.tick((lt) => {
      vis(el, lt, at, o.out);
      trs.forEach((t, ri) => {
        if (t.at != null) { const k = fin(lt, num(t.at, 0), 0.35); set(t.tr, 'opacity', k.toFixed(3)); set(t.tr, 'transform', `translateY(${((1 - k) * -14).toFixed(1)}px)`); }
        let hv = 0; for (const hl of hls) if (num(hl.row, -1) === ri) hv = Math.max(hv, fin(lt, num(hl.at, 0), 0.25) * outK(lt, hl.out));
        set(t.rbg, 'opacity', hv.toFixed(3));
        if (t.cb) { let on = false; for (const c of checks) if (num(c.row, -1) === ri && lt >= num(c.at, 1e9)) on = true; set(t.cb, 'background', on ? ACC : '#fff'); set(t.cb, 'boxShadow', on ? 'none' : 'inset 0 0 0 2px #C9CED8'); }
      });
      for (const [cl, f] of fx) {
        let txt = rich(cl.txt), op = 1, bgOp = 0, color = '';
        if (f.reveal != null) { op = fin(lt, f.reveal, 0.2); bgOp = lt >= f.reveal ? 1 - ease.out(clamp((lt - f.reveal) / 0.7)) : 0; }
        const e = f.edit;
        if (e && lt >= e.at && lt < e.done) { const n = Math.min(e.t.length, Math.floor((lt - e.at) * e.cps) + 1); txt = `<span class="mono">${esc(e.t.slice(0, n).join(''))}</span><i class="sc-caret" style="height:28px"></i>`; op = 1; }
        else if (e && lt < e.at) txt = '';
        if (f.mark) { const k = fin(lt, f.mark.at, 0.35); bgOp = Math.max(bgOp, k); if (k > 0.5) color = MARKT[f.mark.color] || col(f.mark.color); }
        html(cl.tv, txt);
        set(cl.tv, 'opacity', op.toFixed(3));
        set(cl.bg, 'opacity', bgOp.toFixed(3));
        set(cl.tv, 'color', color);
        set(cl.tv, 'fontWeight', f.mark && color ? '600' : '');
      }
      // selection box: glides 0.15 s between ranges
      let cur = null, prev = null, t0 = 0;
      for (const s of sels) if (lt >= s.at) { prev = cur; cur = s.rg; t0 = s.at; }
      if (selEl) {
        set(selEl, 'display', cur ? 'block' : 'none');
        if (cur) {
          let [lx, ly, w, hh] = rangeRect(cur);
          if (prev) { const k = ease.out(clamp((lt - t0) / 0.15)), q = rangeRect(prev); lx = lerp(q[0], lx, k); ly = lerp(q[1], ly, k); w = lerp(q[2], w, k); hh = lerp(q[3], hh, k); }
          set(selEl, 'left', lx.toFixed(1) + 'px'); set(selEl, 'top', ly.toFixed(1) + 'px'); set(selEl, 'width', w.toFixed(1) + 'px'); set(selEl, 'height', hh.toFixed(1) + 'px');
        }
        if (sheet) {
          hcs.forEach((c, i) => { const on = cur && i >= cur[0] && i <= cur[2]; set(c, 'background', on ? '#E3E5FD' : ''); set(c, 'color', on ? ACC : ''); });
          rns.forEach((c, i) => { const on = cur && i >= cur[1] && i <= cur[3]; set(c, 'background', on ? '#E3E5FD' : ''); set(c, 'color', on ? ACC : ''); });
        }
      }
      if (frz) { const k = fin(lt, num(o.freeze.at, 0), 0.45); set(frz, 'opacity', k > 0 ? '1' : '0'); set(frz, 'transform', o.freeze.row ? `scaleX(${k.toFixed(3)})` : `scaleY(${k.toFixed(3)})`); }
      if (fb) {
        const F = o.formula === true ? {} : o.formula;
        let ref = F.cell || (cur ? letter(cur[0]) + (cur[1] + 1) : 'A1'), ft = esc(F.before ?? '');
        if (F.text != null) { const t = chars(F.text), ta = num(F.typeAt, -1), cps = num(F.cps, 12); const n = ta < 0 ? t.length : lt < ta ? 0 : Math.min(t.length, Math.floor((lt - ta) * cps) + 1); if (ta < 0 || lt >= ta) ft = esc(t.slice(0, n).join('')); }
        for (const e of edits) if (lt >= e.at) { ref = letter(e.cl.ci) + (e.cl.ri + 1); ft = esc(e.t.slice(0, Math.min(e.t.length, Math.floor((lt - e.at) * e.cps) + 1)).join('')); }
        html(fb.nb, esc(ref)); html(fb.ft, ft);
      }
    });
    return {
      el,
      cell: (a, b) => { if (typeof a === 'string') { const p = parseRef(a) || [0, 0]; return mid(stage(cx[p[0]], y0 + p[1] * rH, ws[p[0]], rH)); } return mid(stage(cx[clamp(b, 0, nC - 1)], y0 + a * rH, ws[clamp(b, 0, nC - 1)], rH)); },
      range: (ref) => { const rg = parseRange(ref) || [0, 0, 0, 0]; const [lx, ly, w, hh] = rangeRect(rg); return stage(lx, ly, w, hh, 'range'); },
    };
  };

  /** panel(win, x, y, w, h, { kind='card'|'ai'|'doc', title, icon, chip, text, stream, streamAt, cps, lines, hl: { at, out }, at, out, id }):
   *  a block of content in the body. 'card': a white card (title 28 px, text 26 px, chip like '{g:Done}' on the right) — a
   *  dashboard tile, a kanban card, a file. 'ai': the AI assistant's answer (purple sparkle header; text streams in from streamAt
   *  at cps with a purple block caret; lines: n grey placeholder bars while it "thinks"). 'doc': a page of a document editor
   *  (40 px title, 28 px text). Purple belongs to AI only. hl: an accent ring when the cursor points at it. */
  B.panel = function (win, x, y, w, hh, o = {}) {
    const kind = o.kind || 'card';
    w = clamp(num(w, 600), 200, win.body.w - x); hh = clamp(num(hh, 300), 80, win.body.h - y);
    const el = h('div', 'sc-pn ' + kind, null, win.el);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    if (kind === 'ai') h('div', 'ph', `${icon('sparkle', 26)}<span>${esc(o.title ?? L('AI 助手', 'Assistant'))}</span>`, el);
    else if (kind === 'doc') { if (o.title) h('div', 'dt', esc(o.title), el); }
    else if (o.title) h('div', 'pt', `${o.icon ? `<span class="ic">${icon(o.icon, 26)}</span>` : ''}<span>${esc(o.title)}</span>${o.chip ? rich(o.chip) : ''}`, el);
    const nl = Math.round(num(o.lines, 0));
    let sk = null;
    if (nl) { const r = PV.rng(PV.hashStr(String(o.title || '') + nl) + 3); sk = h('div', 'sk', Array.from({ length: nl }, (_, i) => `<i style="width:${i === nl - 1 ? 45 : 70 + Math.round(r() * 28)}%"></i>`).join(''), el); }
    const pb = h('div', 'pb', null, el);
    const text = String(o.text ?? ''), t = chars(plain(text));
    const at = num(o.at, 0), stream = o.stream ?? kind === 'ai';
    const sAt = num(o.streamAt, at + (nl ? 1.2 : 0.3)), cps = num(o.cps, isZh() ? 14 : 30), done = sAt + t.length / cps;
    put(this, o.id ?? o.title ?? 'panel', bodyRect(win, x, y, w, hh, 'panel'));
    this.tick((lt) => {
      vis(el, lt, at, o.out);
      if (sk) set(sk, 'display', stream && lt < sAt ? 'flex' : 'none');
      if (stream && lt < done) { const n = lt < sAt ? 0 : Math.min(t.length, Math.floor((lt - sAt) * cps) + 1); html(pb, lt < sAt ? '' : esc(t.slice(0, n).join('')) + (kind === 'ai' ? '<i class="blk"></i>' : '')); }
      else html(pb, rich(text));
      cls(el, 'hl', o.hl && lt >= num(o.hl.at, 1e9) && (o.hl.out == null || lt < o.hl.out));
    });
    return { el };
  };

  // ── overlays ──────────────────────────────────────────
  const TONES = { warn: ['#FCE3E0', '#E0453B', 'alert'], trash: ['#FCE3E0', '#E0453B', 'trash'], check: ['#DDF3E6', '#1E9E5A', 'check'], info: ['#E8E9FE', ACC, 'info'], ai: ['#EEE7FE', '#8B5CF6', 'sparkle'], lock: ['#EEF0F3', '#4A5163', 'lock'], share: ['#E8E9FE', ACC, 'share'] };
  /** dialog(win, { title, text, icon: 'warn'|'trash'|'check'|'info'|'ai'|'lock'|'share', field: { label, value, type, typeAt }, buttons:
   *  ['Cancel', 'Delete'] or [{ label, variant, press, id }], w=760, at, out, id='dialog' }): a modal over the whole window — the
   *  window dims and the dialog rises at `at`, closes at `out`. The last button is primary (danger with 'warn' / 'trash').
   *  Buttons register by label (or id) for the cursor; press: t makes one dip. Returns { button(i) → [x, y] }. */
  B.dialog = function (win, o = {}) {
    const self = this, id = o.id || 'dialog';
    const dim = h('div', 'sc-dim', null, win.top);
    const dw = clamp(num(o.w, 760), 420, win.w - 80);
    const d = h('div', 'sc-dlg', null, win.top);
    d.style.width = dw + 'px';
    const tone = TONES[o.icon];
    h('div', 'hd', `${tone ? `<div class="di" style="background:${tone[0]};color:${tone[1]}">${icon(tone[2], 30, 2.2)}</div>` : ''}<div><div class="tt">${esc(o.title || '')}</div>${o.text ? `<div class="tx2">${rich(o.text)}</div>` : ''}</div>`, d);
    let fv = null;
    const F = o.field;
    if (F) { const b = h('div', 'sc-in', null, d); fv = h('div', 'v', null, b); fv.box = b; }
    const bt = h('div', 'bt', null, d);
    const bl = (o.buttons || [L('取消', 'Cancel'), L('确定', 'OK')]).map((b, i, a) => {
      const t = typeof b === 'string' ? { label: b } : b;
      const v = t.variant || (i === a.length - 1 ? (o.icon === 'warn' || o.icon === 'trash' ? 'danger' : 'primary') : 'secondary');
      const el = h('div', `sc-btn ${v}`, `<span>${esc(t.label)}</span><i class="pr"></i>`, bt);
      return { el, t };
    });
    const dh = d.offsetHeight;
    const lx = (win.w - dw) / 2, ly = Math.max(20, (win.h - dh) / 2 - 10);
    Object.assign(d.style, { left: lx + 'px', top: ly + 'px' });
    const dFrame = { x: win.x + lx - 30, y: win.y + ly - 30, w: dw + 60, h: dh + 60 };
    const pts = bl.map(({ el, t }) => { const [ox, oy] = offIn(el, win.root); const r = { x: win.x + ox, y: win.y + oy, w: el.offsetWidth, h: el.offsetHeight, kind: 'button', win, frame: dFrame }; put(self, t.id ?? t.label, r); return r; });
    pts.forEach((p, i) => put(self, `${id}.${i}`, p));
    if (fv) { const [ox, oy] = offIn(fv.box, win.root); put(self, F.id ?? F.label ?? `${id}.field`, { x: win.x + ox, y: win.y + oy, w: fv.box.offsetWidth, h: fv.box.offsetHeight, kind: 'field', win }); }
    put(self, id, { x: win.x + lx, y: win.y + ly, w: dw, h: dh, kind: 'dialog', win });
    const at = num(o.at, 1), out = o.out != null ? num(o.out, null) : null;
    const ft = F ? chars(F.type ?? '') : [], fta = F ? num(F.typeAt, at + 0.8) : 0, fcps = F ? num(F.cps, isZh() ? 8 : 14) : 1;
    self.tick((lt) => {
      const k = fin(lt, at, 0.3), v = (lt >= at ? 1 : 0) * outK(lt, out, 0.2);
      set(dim, 'display', v <= 0.001 ? 'none' : 'block'); set(dim, 'opacity', (k * v).toFixed(3));
      set(d, 'display', v <= 0.001 ? 'none' : 'block'); set(d, 'opacity', (clamp(k * 1.5) * v).toFixed(3));
      set(d, 'transform', `translateY(${((1 - k) * 22).toFixed(1)}px) scale(${(0.965 + 0.035 * k).toFixed(4)})`);
      bl.forEach(({ el, t }) => { let b = 0; for (const p of [].concat(t.press ?? [])) b = Math.max(b, bump(lt - p, 0.2)); set(el, 'transform', `scale(${(1 - 0.05 * b).toFixed(4)})`); set(el.lastChild, 'opacity', (b * 0.14).toFixed(3)); });
      if (fv) {
        const n = lt < fta ? 0 : Math.min(ft.length, Math.floor((lt - fta) * fcps) + 1), txt = String(F.value ?? '') + ft.slice(0, n).join('');
        const foc = lt >= fta - 0.35, done = fta + ft.length / fcps;
        cls(fv.box, 'focus', foc);
        html(fv, `<span class="vt">${esc(txt)}</span>${foc && (lt < done + 0.3 || ((lt - done - 0.3) % 1) < 0.55) ? '<i class="sc-caret"></i>' : ''}`);
      }
    });
    return { el: d, button: (i) => mid(pts[clamp(i, 0, pts.length - 1)]) };
  };

  /** toast(win, text, { icon='check'|'x'|'info'|'sparkle'|'undo', action: 'Undo', at, out (default at + 3), place: 'bottom'|'top', id='toast' }):
   *  the app's confirmation, a dark pill that slides up at the bottom of the window ("Saved", "3 rows sorted", "Link copied").
   *  The result of a step, held ≥ 1.5 s. */
  B.toast = function (win, text, o = {}) {
    const ic = o.icon || 'check';
    const TI = { check: ['#1E9E5A', 'check'], x: ['#E0453B', 'x'], info: ['#4F55F1', 'info'], sparkle: ['#8B5CF6', 'sparkle'], undo: ['#4A5163', 'undo'], link: ['#4F55F1', 'link'] }[ic] || ['#1E9E5A', 'check'];
    const el = h('div', 'sc-toast', `<span class="ti" style="background:${TI[0]}">${icon(TI[1], 22, 3)}</span><span>${esc(text)}</span>${o.action ? `<span class="ac">${esc(o.action)}</span>` : ''}`, win.top);
    const tw = el.offsetWidth, th = el.offsetHeight;
    const lx = (win.w - tw) / 2, ly = o.place === 'top' ? 100 : win.h - th - 40;
    Object.assign(el.style, { left: lx + 'px', top: ly + 'px' });
    const id = o.id || 'toast';
    put(this, id, { x: win.x + lx, y: win.y + ly, w: tw, h: th, kind: 'toast', win });
    if (o.action) { const a = el.lastChild, [ox, oy] = offIn(a, win.root); put(this, `${id}.action`, { x: win.x + ox, y: win.y + oy, w: a.offsetWidth, h: a.offsetHeight, kind: 'button', win }); }
    const at = num(o.at, 1), out = num(o.out, at + 3);
    this.tick((lt) => {
      const k = fin(lt, at, 0.4), v = (lt >= at ? 1 : 0) * outK(lt, out, 0.3);
      set(el, 'display', v <= 0.001 ? 'none' : 'flex'); set(el, 'opacity', (clamp(k * 1.6) * v).toFixed(3));
      set(el, 'transform', `translateY(${((1 - k) * (o.place === 'top' ? -26 : 26)).toFixed(1)}px)`);
    });
    return { el };
  };

  // ── the demo layer ────────────────────────────────────
  const ARROW = '<svg width="44" height="58" viewBox="-3 -3 44 58" style="left:-3px;top:-3px"><path d="M0 0 L0 38.5 L9.3 29.6 L15.2 43.2 L21.6 40.4 L15.8 27.2 L28 27.2 Z" fill="#111318" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/></svg>';
  const BEAM = '<svg width="26" height="48" viewBox="0 0 26 48" style="left:-13px;top:-24px"><path d="M5 4 H10 Q13 4 13 7 Q13 4 16 4 H21 M13 7 V41 M5 44 H10 Q13 44 13 41 Q13 44 16 44 H21 M9 24 H17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M5 4 H10 Q13 4 13 7 Q13 4 16 4 H21 M13 7 V41 M5 44 H10 Q13 44 13 41 Q13 44 16 44 H21 M9 24 H17" fill="none" stroke="#111318" stroke-width="2.6" stroke-linecap="round"/></svg>';
  /** cursor(steps, { at, from, out, size=1 }): THE demo cursor, call it LAST on the page (after every control it visits). A real
   *  arrow that glides on a gentle curve and ARRIVES at each step's `at` (time `at` on the word that names the action; it sets
   *  off up to 1 s before). Each step: { to: a control id | [x, y] | menu.item(i) | table.cell('B3'), at, click: true | 2 (double),
   *  zoom: true (1.5×) | scale (≤ 2), look: id | [x, y] (aim the camera at something else, e.g. the menu the click opens), back: t, dx, dy }.
   *  The zoom frames the control WITH its label or row (a cell with its row's first column and neighbours, a menu item with the whole menu), easing the scale down if needed. A click dips the arrow and rings an accent ripple; over a field it becomes an I-beam. zoom: the camera eases in on the click
   *  (arriving with the cursor), holds while the UI responds, and pulls back to the whole window when the cursor sets off for a
   *  step without zoom, or at `back` (default +1.8 s after the last step). Consecutive zoomed steps pan from one to the next. */
  B.cursor = function (steps = [], o = {}) {
    const self = this, at0 = num(o.at, 0), size = clamp(num(o.size, 1), 0.7, 1.5);
    const start = o.from != null ? mid(rectOf(self, o.from)) : [W * 0.66, H * 0.8];
    const segs = [], clicks = [];
    let prev = { p: start, t: at0 }, free = at0;
    steps.forEach((s, i) => {
      const r = rectOf(self, s.to);
      const p = [mid(r)[0] + num(s.dx, 0), mid(r)[1] + num(s.dy, 0)];
      const arrive = num(s.at, prev.t + 1.4);
      const dist = Math.hypot(p[0] - prev.p[0], p[1] - prev.p[1]);
      const travel = clamp(0.4 + dist / 2200, 0.45, 1.05);
      let t0 = Math.max(arrive - travel, free);
      if (arrive - t0 < 0.22) t0 = arrive - 0.22;
      const bend = (i % 2 ? 1 : -1) * Math.min(110, dist * 0.13), nx = -(p[1] - prev.p[1]) / (dist || 1), ny = (p[0] - prev.p[0]) / (dist || 1);
      const c = [(prev.p[0] + p[0]) / 2 + nx * bend, (prev.p[1] + p[1]) / 2 + ny * bend];
      segs.push({ r, a: prev.p, b: p, c, t0, t1: arrive, shape: s.shape || (r.kind === 'field' ? 'beam' : 'arrow'), s });
      const n = s.click === true ? 1 : Math.round(num(s.click, 0));
      for (let k = 0; k < n; k++) clicks.push({ t: arrive + 0.04 + k * 0.2, p });
      free = arrive + (n ? 0.14 + (n - 1) * 0.2 : 0.05);
      prev = { p, t: arrive };
    });
    // ripples, then the cursor on top
    const rips = clicks.map(() => h('div', 'sc-rip', null, self.html));
    const el = h('div', 'sc-cur', ARROW + BEAM, self.html);
    const [aSvg, bSvg] = el.children;
    // zooms: a zoomed step holds the camera; following steps without zoom whose target sits inside that view keep it (the
    // menu item the click opened), and the camera pulls back when the cursor sets off for one outside it, or at `back`
    const keys = [];
    let view = null;   // { x0, y0, x1, y1 } of the current zoomed view
    const inView = (p) => view && p[0] > view.x0 + 40 && p[0] < view.x1 - 40 && p[1] > view.y0 + 40 && p[1] < view.y1 - 40;
    segs.forEach((g, i) => {
      const s = g.s;
      if (!s.zoom) {
        if (view && !inView(g.b)) { keys.push(camBack(Math.max(g.t0, view.tin + 1.4), 0.85)); view = null; }
        if (view) view.t1 = g.t1;
        if (view && (i === segs.length - 1 || s.back != null)) { keys.push(camBack(Math.max(s.back != null ? num(s.back, 0) : g.t1 + 1.6, view.tin + 1.4), 0.85)); view = null; }
        return;
      }
      const z = s.zoom === true ? 1.5 : clamp(num(s.zoom, 1.5), 1.15, 2.0);
      const fr = fit(s.look != null ? rectOf(self, s.look) : g.r, z);
      const look = fr.p;
      const tin = Math.max(g.t0 - 0.05, g.t1 - 0.55);
      if (view && g.t0 - view.t1 > 2.6) keys.push(camBack(Math.max(view.t1 + 2.0, view.tin + 1.4), 0.85));
      const k = camIn(tin, look[0], look[1], fr.s, 0.8);
      keys.push(k);
      const hx = W / 2 / k.s, hy = H / 2 / k.s;
      view = { x0: k.x - hx, x1: k.x + hx, y0: k.y - hy, y1: k.y + hy, tin, t1: g.t1 };
      if (s.back != null || i === segs.length - 1) { keys.push(camBack(Math.max(s.back != null ? num(s.back, 0) : g.t1 + 1.8, tin + 1.4), 0.85)); view = null; }
    });
    if (keys.length) addCams(self, keys);
    const posAt = (lt) => {
      let p = start, shape = 'arrow';
      for (const g of segs) {
        if (lt < g.t0) break;
        if (lt < g.t1) { const e = ease.inOut(clamp((lt - g.t0) / (g.t1 - g.t0))), u = 1 - e; p = [u * u * g.a[0] + 2 * u * e * g.c[0] + e * e * g.b[0], u * u * g.a[1] + 2 * u * e * g.c[1] + e * e * g.b[1]]; shape = 'arrow'; break; }
        p = g.b; shape = g.shape;
      }
      return [p, shape];
    };
    self.tick((lt) => {
      const [p, shape] = posAt(lt);
      const v = fin(lt, at0, 0.3) * outK(lt, o.out, 0.3);
      let b = 0; for (const c of clicks) b = Math.max(b, bump(lt - c.t, 0.16));
      set(el, 'display', v <= 0.001 ? 'none' : 'block'); set(el, 'opacity', v.toFixed(3));
      set(el, 'transform', `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) scale(${(size * (1 - 0.16 * b)).toFixed(4)})`);
      set(aSvg, 'display', shape === 'beam' ? 'none' : 'block'); set(bSvg, 'display', shape === 'beam' ? 'block' : 'none');
      clicks.forEach((c, i) => {
        const q = (lt - c.t) / 0.55, r = rips[i];
        set(r, 'display', q >= 0 && q < 1 ? 'block' : 'none');
        if (q >= 0 && q < 1) { set(r, 'transform', `translate(${c.p[0].toFixed(1)}px, ${c.p[1].toFixed(1)}px) scale(${(0.3 + 0.9 * ease.out(q)).toFixed(3)})`); set(r, 'opacity', (1 - q * q).toFixed(3)); }
      });
    });
    return { el, at: (lt) => posAt(lt)[0] };
  };

  /** zoom(target, { at, s=1.5, back, dur=0.8 }): the camera eases in on a control, a table range or a panel (id | [x, y] | rect) at
   *  `at` and pulls back at `back` (default at + 2.2) — to read a result when no click leads there. Not together with a cursor
   *  step's zoom at the same moment. */
  B.zoom = function (target, o = {}) {
    const r = rectOf(this, target), f = fit(r, num(o.s, 1.5)), p = f.p, at = num(o.at, 1);
    addCams(this, [camIn(at, p[0], p[1], f.s, num(o.dur, 0.8)), camBack(Math.max(num(o.back, at + 2.2), at + 1.2), 0.85)]);
    return {};
  };

  // keycap faces: modifier glyphs as SVG (always render), words and letters as text
  const KG = {
    cmd: '<path d="M9 9 H15 V15 H9 Z M9 9 V6.5 A2.5 2.5 0 1 0 6.5 9 H9 M15 9 V6.5 A2.5 2.5 0 1 1 17.5 9 H15 M15 15 V17.5 A2.5 2.5 0 1 0 17.5 15 H15 M9 15 V17.5 A2.5 2.5 0 1 1 6.5 15 H9"/>',
    shift: '<path d="M12 4 L20 12.5 H15.5 V19.5 H8.5 V12.5 H4 Z"/>', opt: '<path d="M4 7 H9 L15 17 H20 M14 7 H20"/>', ctrl: '<path d="M6 14 L12 8 L18 14"/>',
    enter: '<path d="M19 6 V13 H6 M10 9 L6 13 L10 17"/>', del: '<path d="M9 6 H20 V18 H9 L3.5 12 Z M12 9.5 L17 14.5 M17 9.5 L12 14.5"/>',
    left: '<path d="M19 12 H5 M11 6 L5 12 L11 18"/>', right: '<path d="M5 12 H19 M13 6 L19 12 L13 18"/>', up: '<path d="M12 19 V5 M6 11 L12 5 L18 11"/>', down: '<path d="M12 5 V19 M6 13 L12 19 L18 13"/>',
  };
  const KMAP = { '⌘': 'cmd', cmd: 'cmd', command: 'cmd', '⇧': 'shift', '⌥': 'opt', option: 'opt', '⌃': 'ctrl', '↵': 'enter', '⏎': 'enter', return: 'enter', '⌫': 'del', '←': 'left', '→': 'right', '↑': 'up', '↓': 'down' };
  const keyFace = (k) => { const g = KMAP[String(k).toLowerCase()] || KMAP[k]; return g ? `<svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${KG[g]}</svg>` : esc(k); };
  /** keys(keys, { at, out (default at + 1.8), say, x=960, y=790 }): the shortcut, shown as keycaps in a dark pill over the bottom
   *  of the window (fixed on screen, not moved by the camera). keys: ['⌘', 'Shift', 'K'] or 'Ctrl+C'; modifier glyphs ⌘ ⇧ ⌥ ⌃ ↵ ⌫
   *  ← → ↑ ↓ draw as symbols, words (Ctrl, Alt, Shift, Tab, Esc, Enter) as text. The keys go down one after another from `at`
   *  (land the last one on the spoken shortcut), stay down 0.45 s, release together; say: what the shortcut does, after the keys. */
  B.keys = function (keys, o = {}) {
    const T = this.hud || this;
    if (typeof keys === 'string') keys = keys.split(/\s*\+\s*/).filter(Boolean);
    keys = (keys || []).map(String);
    const at = num(o.at, 1), gap = 0.12, rel = at + (keys.length - 1) * gap + 0.45, out = num(o.out, at + 1.8);
    const el = h('div', 'sc-keys', keys.map((k) => `<div class="sc-key${k.length === 1 && /[A-Za-z0-9]/.test(k) ? '' : ''}">${keyFace(k)}</div>`).join('') + (o.say ? `<div class="say">${esc(o.say)}</div>` : ''), T.html);
    const ew = el.offsetWidth, eh = el.offsetHeight;
    const cx = clamp(num(o.x, W / 2), ew / 2 + 40, W - ew / 2 - 40), cy = clamp(num(o.y, STAGE.area.y1 - 90), eh / 2 + 30, BOT - eh / 2);
    el.style.left = (cx - ew / 2) + 'px'; el.style.top = (cy - eh / 2) + 'px';
    const ks = [...el.querySelectorAll('.sc-key')];
    T.tick((lt) => {
      const k = fin(lt, at - 0.3, 0.3), v = (lt >= at - 0.3 ? 1 : 0) * outK(lt, out, 0.3);
      set(el, 'display', v <= 0.001 ? 'none' : 'flex'); set(el, 'opacity', (clamp(k * 1.5) * v).toFixed(3));
      set(el, 'transform', `translateY(${((1 - k) * 18).toFixed(1)}px)`);
      ks.forEach((ke, i) => {
        const tp = at + i * gap;
        const d = lt < tp ? 0 : lt < rel ? ease.out(clamp((lt - tp) / 0.08)) : 1 - ease.out(clamp((lt - rel) / 0.12));
        set(ke, 'transform', `translateY(${(d * 5).toFixed(2)}px)`);
        set(ke, 'boxShadow', `0 ${(6 - 5 * d).toFixed(2)}px 0 #A9AFBC, 0 ${(9 - 6 * d).toFixed(2)}px 12px rgba(0,0,0,0.35)`);
        set(ke, 'background', d > 0.5 ? 'linear-gradient(#F1F2F6, #E1E4EA)' : 'linear-gradient(#FFFFFF, #ECEEF3)');
      });
    });
    return { el };
  };

  /** step(n, text, { to, at, out, side: 'right'|'left'|'top'|'bottom' (auto) }): the tutorial's numbered step badge — an ink circle
   *  with the number, pinned beside the control `to`, with a dark callout naming the action (≤ 12 汉字 / 6 words, **bold** = the
   *  control's name in light accent). It zooms with the window. One step badge per step, the number in order across the film. */
  B.step = function (n, text, o = {}) {
    const r = rectOf(this, o.to), at = num(o.at, 1);
    const el = h('div', 'sc-step', `<div class="n">${esc(n)}</div>${text ? `<div class="c">${rich(text)}</div>` : ''}`, this.html);
    const ew = el.offsetWidth, eh = el.offsetHeight;
    let side = o.side;
    if (!side) side = r.w > 520 ? 'top' : r.x + r.w + 22 + ew < W - 60 ? 'right' : r.x - 22 - ew > 60 ? 'left' : 'bottom';
    if (side === 'left') el.classList.add('flip');
    const [mx, my] = mid(r);
    let lx, ly;
    if (side === 'right') { lx = r.x + r.w + 18; ly = my - eh / 2; }
    else if (side === 'left') { lx = r.x - 18 - ew; ly = my - eh / 2; }
    else if (side === 'top') { lx = r.w > 520 ? r.x + 40 : mx - 28; ly = r.y - 14 - eh; }
    else { lx = r.w > 520 ? r.x + 40 : mx - 28; ly = r.y + r.h + 16; }
    lx = clamp(lx, 40, W - ew - 40); ly = clamp(ly, 30, BOT - eh);
    Object.assign(el.style, { left: lx + 'px', top: ly + 'px' });
    const nEl = el.firstChild, cEl = el.children[1];
    const dx = side === 'left' ? 14 : side === 'right' ? -14 : 0;
    this.tick((lt) => {
      const v = (lt >= at ? 1 : 0) * outK(lt, o.out, 0.25), k = fin(lt, at, 0.3), k2 = fin(lt, at + 0.12, 0.3);
      set(el, 'display', v <= 0.001 ? 'none' : 'flex'); set(el, 'opacity', v.toFixed(3));
      set(nEl, 'transform', `scale(${(0.6 + 0.4 * k).toFixed(4)})`); set(nEl, 'opacity', clamp(k * 1.6).toFixed(3));
      if (cEl) { set(cEl, 'opacity', k2.toFixed(3)); set(cEl, 'transform', `translateX(${((1 - k2) * dx).toFixed(1)}px)`); }
    });
    return { el };
  };

  /** spotlight(target, { at, out, pad=12, dim=0.42 }): dims the whole window except one control (an accent outline around it) — "this
   *  is the one". The target stays bright; use it on the control the narration names before the cursor goes there, or on the result. */
  B.spotlight = function (target, o = {}) {
    const r = rectOf(this, target), win = r.win, pad = num(o.pad, 12), at = num(o.at, 1);
    const host = win ? win.top : this.html, ox = win ? win.x : 0, oy = win ? win.y : 0;
    const el = h('div', 'sc-spot', '<i></i>', host);
    Object.assign(el.style, { left: (r.x - pad - ox) + 'px', top: (r.y - pad - oy) + 'px', width: (r.w + pad * 2) + 'px', height: (r.h + pad * 2) + 'px', boxShadow: `0 0 0 4000px rgba(14, 17, 28, ${clamp(num(o.dim, 0.42), 0.2, 0.75)})` });
    this.tick((lt) => { const v = fin(lt, at, 0.4) * outK(lt, o.out, 0.35); set(el, 'display', v <= 0.001 ? 'none' : 'block'); set(el, 'opacity', v.toFixed(3)); });
    return { el };
  };

  /** compare(after, { at, to=0.5, dur=1.1, labels: ['Before', 'After'] }): a before/after wipe. Draw the BEFORE window first, then
   *  the AFTER window with the same options (same place and size); compare(afterWin) hides the after window and, from `at`, a
   *  divider with a handle slides in from the right edge to `to` (0.5 = half and half, 0 = all after), revealing it. */
  B.compare = function (win, o = {}) {
    const at = num(o.at, 1), dur = num(o.dur, 1.1), to = clamp(num(o.to, 0.5), 0, 1);
    const lb = o.labels || [L('之前', 'Before'), L('之后', 'After')];
    const el = h('div', 'sc-cmp', `<i class="ln"></i><i class="hd">${icon('left', 22, 2.6)}${icon('right', 22, 2.6)}</i><span class="a">${esc(lb[0])}</span><span class="b">${esc(lb[1])}</span>`, this.html);
    Object.assign(el.style, { top: win.y + 'px', height: win.h + 'px' });
    this.tick((lt) => {
      const p = lt < at ? 1 : 1 - (1 - to) * ease.inOut(clamp((lt - at) / dur)), X = win.w * p;
      set(win.root, 'clipPath', `inset(-120px -120px -120px ${X.toFixed(1)}px)`);
      set(win.root, 'visibility', p >= 0.999 ? 'hidden' : 'visible');
      set(el, 'display', p >= 0.999 ? 'none' : 'block');
      set(el, 'left', (win.x + X).toFixed(1) + 'px');
      set(el, 'opacity', fin(lt, at, 0.25).toFixed(3));
    });
    return { el };
  };

  // the page title: a small window mark and bold UI type, top left (on the hud, never moved by the camera)
  const WMARK = '<svg viewBox="0 0 40 32" width="40" height="32"><rect x="1.5" y="1.5" width="37" height="29" rx="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M1.5 10.5 H38.5" stroke="currentColor" stroke-width="3"/><circle cx="7.5" cy="6" r="1.7" fill="currentColor"/><circle cx="12.5" cy="6" r="1.7" fill="currentColor"/></svg>';
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = num(o.at, 0.1);
    const el = h('div', 'sc-title' + (this.sh.scDark ? ' dark' : ''), `${WMARK}<span>${esc(String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, ''))}</span>`, T.html);
    T.tick((lt) => { const k = fin(lt, at, 0.4); set(el, 'opacity', k.toFixed(3)); set(el, 'transform', `translateY(${((1 - k) * 10).toFixed(1)}px)`); });
    return { el, a: { dur: 0.4 }, spans: [el] };
  };
  // plain text fades in as a block (no handwriting pen)
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.4 }, o, { pen: false })); };
})();
