/* Chat Screen · kit: the film plays out on phone screens. A generic messaging app (grey and green bubbles, avatars,
 * timestamps, read receipts, typing dots, voice bars, red packets, transfers, link and image cards), a lock screen with
 * notifications, an incoming call, a transfer screen, a social feed, a search box with suggestions, a chat list; and on the
 * soft colour ground around the phones: explainer notes, big numbers, tags, giant floating bubbles.
 * Every component lays itself out (text wraps, the chat scrolls, nothing leaves the phone or the frame) and is a pure
 * function of page-local time lt. Generic UI only: no real app's name, logo or trade dress. Written for Frametell Cloud. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, SA = STAGE.area;
  const isZh = () => { const l = window.SCRIPT?.META?.lang; return l ? /^zh/.test(l) : !/^en/.test(document.documentElement.lang || 'zh'); };
  const L = (zh, en) => (isZh() ? zh : en);
  const fin = (lt, at, dur = 0.3) => ease.out(clamp((lt - at) / dur));
  const popK = (lt, at, dur = 0.38) => (lt < at ? 0 : ease.back(clamp((lt - at) / dur)));
  const outK = (lt, out, dur = 0.35) => (out == null ? 1 : 1 - ease.out(clamp((lt - out) / dur)));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const set = (el, k, v) => { const c = el._c || (el._c = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } };
  const html = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // light markup inside UI text: **bold**, {r:red}, {g:green}, {u:link}
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\{([rgu]):([^}]*)\}/g, '<span class="$1">$2</span>').replace(/\n/g, '<br>');
  const plain = (s) => String(s ?? '').replace(/\*\*|\{[rgu]:|\}/g, '');
  const hashS = (s) => { let x = 7; for (const ch of String(s)) x = (Math.imul(x, 31) + ch.codePointAt(0)) >>> 0; return x; };
  const AVC = ['#5B8DEF', '#F08A3C', '#9A6AF0', '#25B3A2', '#E5677A', '#D9A21F', '#4F6B92', '#3FA166', '#C0569E'];
  const initial = (n) => { const s = String(n ?? '?').trim(); const c = [...s][0] || '?'; return /[a-z]/.test(c) ? c.toUpperCase() : c; };
  const fmtN = (n) => {
    n = Math.round(n);
    if (isZh()) return n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
    return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'K' : n.toLocaleString('en-US');
  };
  // chrome smaller than 24 px (status bar, timestamps, counts, receipts) is drawn on canvas: texture, not text to read
  const UIF = '"Inter Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif';
  function lab(parent, text, o = {}) {
    const c = h('canvas', 'cs-lab', null, parent);
    const size = o.size ?? 15, wt = o.weight ?? 500, R = 2, pad = o.bg ? (o.pad ?? 7) : 0;
    c.put = (t, color) => {
      t = String(t ?? ''); color = col(color || o.color || '#8B95A8');
      const key = t + '|' + color; if (c._k === key) return c; c._k = key;
      const g = c.getContext('2d'), font = `${wt} ${size * R}px ${UIF}`;
      g.font = font;
      let w = g.measureText(t).width / R;
      if (o.maxW && w > o.maxW) { while (t.length > 1 && g.measureText(t + '…').width / R > o.maxW) t = t.slice(0, -1); t += '…'; w = g.measureText(t).width / R; }
      const chh = Math.ceil(size * (o.bg ? 1.5 : 1.32)), cw = Math.max(o.bg ? chh : 1, Math.ceil(w + 2 + pad * 2));
      c.width = cw * R; c.height = chh * R; c.style.width = cw + 'px'; c.style.height = chh + 'px';
      if (o.bg) { g.fillStyle = col(o.bg); g.beginPath(); g.roundRect(0, 0, cw * R, chh * R, (o.radius ?? chh / 2) * R); g.fill(); }
      g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.fillText(t, cw * R / 2, chh * R / 2 + size * R * 0.05);
      return c;
    };
    return c.put(text);
  }
  // an entrance that overshoots but never shows shrunken text: below full size it stays faint (opacity < 0.5)
  const pop2 = (lt, at, dur = 0.36, from = 0.6) => {
    if (lt < at) return [from, 0];
    const k = clamp((lt - at) / dur);
    return [from + (1 - from) * ease.back(k), k < 0.42 ? 0.45 * (k / 0.42) : 1];
  };
  // a transparent box that tells the page check this DOM element is content
  const marker = (parent, w, hh) => { const sv = PV.s('svg', { class: 'cs-mk', width: w, height: hh }, parent); PV.s('rect', { x: 0, y: 0, width: w, height: hh, fill: 'transparent' }, sv); return sv; };
  const range = (v) => (Array.isArray(v) ? [num(v[0], 0), num(v[1], 0)] : [num(v, 0), num(v, 0)]);

  // ── icons (inline SVG) ────────────────────────────────
  const ic = {
    back: (c = '#1B2232') => `<svg viewBox="0 0 30 30" width="30" height="30"><path d="M18 6 L9 15 L18 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    more: (c = '#1B2232') => `<svg viewBox="0 0 30 30" width="30" height="30"><circle cx="7" cy="15" r="2.6" fill="${c}"/><circle cx="15" cy="15" r="2.6" fill="${c}"/><circle cx="23" cy="15" r="2.6" fill="${c}"/></svg>`,
    mic: () => `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="none" stroke="#1B2232" stroke-width="2"/><path d="M12 11 Q17 16 12 21 M16 8.5 Q23 16 16 23.5" fill="none" stroke="#1B2232" stroke-width="2" stroke-linecap="round"/></svg>`,
    smile: () => `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="none" stroke="#1B2232" stroke-width="2"/><circle cx="11.5" cy="13" r="1.8" fill="#1B2232"/><circle cx="20.5" cy="13" r="1.8" fill="#1B2232"/><path d="M10 19 Q16 24.5 22 19" fill="none" stroke="#1B2232" stroke-width="2" stroke-linecap="round"/></svg>`,
    plus: () => `<svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="14" fill="none" stroke="#1B2232" stroke-width="2"/><path d="M16 9 V23 M9 16 H23" stroke="#1B2232" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    status: (c) => `<svg viewBox="0 0 74 14" width="74" height="14"><rect x="0" y="9" width="3.5" height="5" rx="1" fill="${c}"/><rect x="5.5" y="6" width="3.5" height="8" rx="1" fill="${c}"/><rect x="11" y="3" width="3.5" height="11" rx="1" fill="${c}"/><rect x="16.5" y="0" width="3.5" height="14" rx="1" fill="${c}"/><path d="M27 5.2 Q34 -0.8 41 5.2 L39 7.4 Q34 3.2 29 7.4 Z M30.6 8.6 Q34 5.8 37.4 8.6 L34 12.4 Z" fill="${c}"/><rect x="47" y="1" width="23" height="12" rx="3.5" fill="none" stroke="${c}" stroke-width="1.4" opacity="0.6"/><rect x="49" y="3" width="17" height="8" rx="2" fill="${c}"/><rect x="71" y="4.5" width="2" height="5" rx="1" fill="${c}" opacity="0.6"/></svg>`,
    warn: (c = '#E5484D', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 2.5 L22.5 21 H1.5 Z" fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><rect x="10.9" y="8.5" width="2.2" height="7" rx="1.1" fill="#fff"/><circle cx="12" cy="18" r="1.3" fill="#fff"/></svg>`,
    bang: (c = '#E5484D', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><rect x="10.4" y="4" width="3.2" height="11" rx="1.6" fill="${c}"/><circle cx="12" cy="19.2" r="1.9" fill="${c}"/></svg>`,
    check: (c = '#1FB25A', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M4.5 12.5 L10 18 L19.5 6.5" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    cross: (c = '#E5484D', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M6 6 L18 18 M18 6 L6 18" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/></svg>`,
    shield: (c = '#1FB25A', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 2 L20.5 5.5 V11.5 Q20.5 18.5 12 22 Q3.5 18.5 3.5 11.5 V5.5 Z" fill="${c}"/><path d="M8 12 L11 15 L16.5 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    lock: (c = '#1B2232', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><rect x="4.5" y="10.5" width="15" height="11" rx="2.5" fill="${c}"/><path d="M8 10.5 V7.5 Q8 3.5 12 3.5 Q16 3.5 16 7.5 V10.5" fill="none" stroke="${c}" stroke-width="2.4"/></svg>`,
    clock: (c = '#1B2232', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="12" r="9.5" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M12 6.5 V12 L15.5 14.5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    eye: (c = '#1B2232', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M1.5 12 Q12 2 22.5 12 Q12 22 1.5 12 Z" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="12" cy="12" r="3.6" fill="${c}"/></svg>`,
    heart: (c = '#E5484D', s = 22, fill = true) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 20.5 Q3 14.5 3 8.8 Q3 4.5 7.2 4.5 Q10.2 4.5 12 7.4 Q13.8 4.5 16.8 4.5 Q21 4.5 21 8.8 Q21 14.5 12 20.5 Z" fill="${fill ? c : 'none'}" stroke="${c}" stroke-width="2"/></svg>`,
    comment: (c = '#6B7487', s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M4 5 H20 Q21 5 21 6 V16 Q21 17 20 17 H10 L5.5 20.5 V17 H4 Q3 17 3 16 V6 Q3 5 4 5 Z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`,
    share: (c = '#6B7487', s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M13 4 L21 11 L13 18 V14 Q6 14 3 20 Q4 9 13 8 Z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`,
    search: (c = '#8B95A8', s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M15.5 15.5 L21 21" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    phone: (c = '#fff', s = 34, rot = 0) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" style="transform:rotate(${rot}deg)"><path d="M6.6 2.8 L9.3 2.5 L11 7.2 L8.8 8.8 Q10.3 12.6 15.2 15.2 L16.8 13 L21.5 14.7 L21.2 17.4 Q20.6 21 17 21 Q4 19.5 3 7 Q3 3.4 6.6 2.8 Z" fill="${c}"/></svg>`,
    bubble: (c = '#1FB25A', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 3 Q22 3 22 11 Q22 19 12 19 Q10 19 8.2 18.5 L3.5 21 L4.8 16.6 Q2 14.3 2 11 Q2 3 12 3 Z" fill="${c}"/><circle cx="8" cy="11" r="1.5" fill="#fff"/><circle cx="12" cy="11" r="1.5" fill="#fff"/><circle cx="16" cy="11" r="1.5" fill="#fff"/></svg>`,
    flag: (c = '#E5484D', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M5 21 V3.5 M5 4 H18 L15.5 8.5 L18 13 H5" fill="${c}" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
    bell: (c = '#1B2232', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><path d="M12 3 Q18 3 18 10 V15 L20 18 H4 L6 15 V10 Q6 3 12 3 Z" fill="${c}"/><circle cx="12" cy="20.3" r="2" fill="${c}"/></svg>`,
    wave: (c = '#1B2232', s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="5" cy="12" r="2.2" fill="${c}"/><path d="M9.5 6.5 Q13.5 12 9.5 17.5 M14 3 Q20.5 12 14 21" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    doc: (c = '#2F7CF6', s = 40) => `<svg viewBox="0 0 40 48" width="${s}" height="${s * 1.2}"><path d="M4 2 H26 L36 12 V46 H4 Z" fill="${c}"/><path d="M26 2 V12 H36" fill="rgba(255,255,255,0.45)"/><rect x="10" y="22" width="20" height="3" rx="1.5" fill="#fff"/><rect x="10" y="29" width="20" height="3" rx="1.5" fill="#fff"/><rect x="10" y="36" width="13" height="3" rx="1.5" fill="#fff"/></svg>`,
    envelope: () => `<svg viewBox="0 0 44 52" width="44" height="52"><rect x="2" y="2" width="40" height="48" rx="5" fill="#F7C04A"/><path d="M2 14 Q22 26 42 14 V7 Q42 2 37 2 H7 Q2 2 2 7 Z" fill="#E8A92E"/><circle cx="22" cy="21" r="7" fill="#FFE29A" stroke="#D99520" stroke-width="1.5"/></svg>`,
    coin: () => `<svg viewBox="0 0 44 52" width="44" height="52"><circle cx="22" cy="26" r="19" fill="#fff" opacity="0.95"/><path d="M15 16 L22 25 L29 16 M22 25 V37 M16 27 H28 M16 32 H28" fill="none" stroke="#F59A0B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  const ICONS = { warn: ic.warn, bang: ic.bang, check: ic.check, cross: ic.cross, shield: ic.shield, lock: ic.lock, clock: ic.clock, eye: ic.eye, heart: ic.heart, flag: ic.flag, bell: ic.bell, chat: ic.bubble, search: ic.search };

  // app icons for notifications: [background, glyph]
  const APPS = {
    chat: ['#1FB25A', () => ic.bubble('#fff', 24)], sms: ['#34B864', () => ic.bubble('#fff', 24)], bank: ['#2F6FE0', () => `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 9 L12 3.5 L21 9 Z M5 10.5 H8 V17 H5 Z M10.5 10.5 H13.5 V17 H10.5 Z M16 10.5 H19 V17 H16 Z M3 18.5 H21 V20.5 H3 Z" fill="#fff"/></svg>`],
    mail: ['#3B82F6', () => `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="5.5" width="18" height="13" rx="2" fill="#fff"/><path d="M3.5 6.5 L12 13 L20.5 6.5" fill="none" stroke="#3B82F6" stroke-width="1.8"/></svg>`],
    news: ['#E5484D', () => `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="4" y="4" width="16" height="16" rx="2" fill="#fff"/><rect x="6.5" y="7" width="11" height="3" fill="#E5484D"/><rect x="6.5" y="12" width="11" height="1.6" fill="#E5484D"/><rect x="6.5" y="15.5" width="7" height="1.6" fill="#E5484D"/></svg>`],
    social: ['#8A5CF6', () => ic.heart('#fff', 22)], work: ['#4F6B92', () => `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="7.5" width="18" height="12" rx="2.5" fill="#fff"/><path d="M9 7.5 V5 H15 V7.5" fill="none" stroke="#fff" stroke-width="2"/></svg>`],
    shop: ['#F08A1C', () => `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 8 H19 L18 20 H6 Z" fill="#fff"/><path d="M9 10 V6.5 Q9 3.5 12 3.5 Q15 3.5 15 6.5 V10" fill="none" stroke="#fff" stroke-width="2"/></svg>`],
    alert: ['#E5484D', () => ic.bang('#fff', 24)], phone: ['#1FB25A', () => ic.phone('#fff', 22)], calendar: ['#F2F3F6', () => `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="#fff" stroke="#E5484D" stroke-width="1.6"/><rect x="3.5" y="5" width="17" height="4.5" fill="#E5484D"/></svg>`],
    pay: ['#1FB25A', () => `<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="#fff"/><path d="M8.5 7.5 L12 12 L15.5 7.5 M12 12 V17.5 M9 13 H15" fill="none" stroke="#1FB25A" stroke-width="2" stroke-linecap="round"/></svg>`],
  };
  const app = (k) => APPS[k] || APPS.chat;

  // ── picture scenes for image bubbles, feed posts and link thumbnails (inline SVG, deterministic) ──
  function scene(kind, w, hh, seed = 1) {
    const r = PV.rng(seed), S = (b) => `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" style="display:block">${b}</svg>`;
    switch (kind) {
      case 'chart': {   // a profit screenshot: a line that only goes up
        let d = `M 16 ${hh - 24}`; const n = 9;
        for (let i = 1; i <= n; i++) d += ` L ${16 + (w - 40) * i / n} ${hh - 24 - (hh - 64) * Math.pow(i / n, 1.8) + (r() - 0.5) * 10}`;
        return S(`<rect width="${w}" height="${hh}" fill="#fff"/><rect x="12" y="10" width="${w * 0.32}" height="9" rx="4" fill="#D3D9E3"/><text x="${w - 14}" y="30" text-anchor="end" font-size="26" font-weight="800" fill="#E5484D" font-family="Inter Variable, sans-serif">+${Math.round(180 + r() * 300)}%</text>` +
          `<path d="${d} L ${w - 24} ${hh - 24} Z" fill="rgba(229,72,77,0.12)"/><path d="${d}" fill="none" stroke="#E5484D" stroke-width="3.5" stroke-linejoin="round"/><line x1="12" y1="${hh - 22}" x2="${w - 12}" y2="${hh - 22}" stroke="#D3D9E3" stroke-width="2"/>`);
      }
      case 'selfie': return S(`<defs><linearGradient id="sg${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCD9C6"/><stop offset="1" stop-color="#F6B3A8"/></linearGradient></defs><rect width="${w}" height="${hh}" fill="url(#sg${seed})"/><circle cx="${w * 0.78}" cy="${hh * 0.22}" r="${hh * 0.12}" fill="#fff" opacity="0.6"/>` +
        `<path d="M ${w * 0.18} ${hh} Q ${w * 0.2} ${hh * 0.66} ${w * 0.5} ${hh * 0.64} Q ${w * 0.8} ${hh * 0.66} ${w * 0.82} ${hh} Z" fill="#3E5A8A"/><ellipse cx="${w * 0.5}" cy="${hh * 0.42}" rx="${hh * 0.17}" ry="${hh * 0.2}" fill="#F3C9A8"/><path d="M ${w * 0.5 - hh * 0.19} ${hh * 0.42} Q ${w * 0.5 - hh * 0.2} ${hh * 0.14} ${w * 0.5} ${hh * 0.16} Q ${w * 0.5 + hh * 0.22} ${hh * 0.15} ${w * 0.5 + hh * 0.19} ${hh * 0.44} Q ${w * 0.5 + hh * 0.1} ${hh * 0.26} ${w * 0.5 - hh * 0.19} ${hh * 0.42} Z" fill="#2B2230"/>`);
      case 'screenshot': { let b = `<rect width="${w}" height="${hh}" fill="#F3F5F8"/><rect width="${w}" height="${hh * 0.16}" fill="#fff"/>`; for (let i = 0; i < 4; i++) b += `<rect x="12" y="${hh * 0.24 + i * hh * 0.18}" width="${hh * 0.12}" height="${hh * 0.12}" rx="3" fill="${AVC[(seed + i) % AVC.length]}"/><rect x="${18 + hh * 0.12}" y="${hh * 0.26 + i * hh * 0.18}" width="${(w - 50) * (0.5 + r() * 0.4)}" height="${hh * 0.07}" rx="3" fill="#C9D0DB"/>`; return S(b); }
      case 'doc': { let b = `<rect width="${w}" height="${hh}" fill="#F7F3EA"/><rect x="${w * 0.25}" y="12" width="${w * 0.5}" height="${hh * 0.09}" rx="2" fill="#B23A2E"/>`; for (let i = 0; i < 6; i++) b += `<rect x="16" y="${hh * 0.27 + i * hh * 0.1}" width="${(w - 32) * (i === 5 ? 0.5 : 0.9 + r() * 0.1)}" height="${hh * 0.04}" rx="2" fill="#A9A396"/>`; return S(b + `<circle cx="${w * 0.74}" cy="${hh * 0.8}" r="${hh * 0.14}" fill="none" stroke="#D2392C" stroke-width="3"/><path d="M ${w * 0.74} ${hh * 0.71} L ${w * 0.765} ${hh * 0.79} L ${w * 0.8} ${hh * 0.8} L ${w * 0.77} ${hh * 0.84} L ${w * 0.78} ${hh * 0.89} L ${w * 0.74} ${hh * 0.86} L ${w * 0.7} ${hh * 0.89} L ${w * 0.71} ${hh * 0.84} L ${w * 0.68} ${hh * 0.8} L ${w * 0.715} ${hh * 0.79} Z" fill="#D2392C"/>`); }
      case 'qr': { const n = 21, c = Math.min(w, hh) - 24, u = c / n, x0 = (w - c) / 2, y0 = (hh - c) / 2; let b = `<rect width="${w}" height="${hh}" fill="#fff"/>`; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const f = (i < 7 && j < 7) || (i > 13 && j < 7) || (i < 7 && j > 13); if (!f && r() > 0.52) b += `<rect x="${x0 + i * u}" y="${y0 + j * u}" width="${u + 0.3}" height="${u + 0.3}" fill="#1B2232"/>`; } for (const [i, j] of [[0, 0], [14, 0], [0, 14]]) b += `<rect x="${x0 + i * u + u / 2}" y="${y0 + j * u + u / 2}" width="${u * 6}" height="${u * 6}" fill="none" stroke="#1B2232" stroke-width="${u}"/><rect x="${x0 + (i + 2) * u}" y="${y0 + (j + 2) * u}" width="${u * 3}" height="${u * 3}" fill="#1B2232"/>`; return S(b); }
      case 'food': return S(`<rect width="${w}" height="${hh}" fill="#F4E3CF"/><ellipse cx="${w / 2}" cy="${hh * 0.55}" rx="${w * 0.36}" ry="${hh * 0.34}" fill="#fff"/><ellipse cx="${w / 2}" cy="${hh * 0.55}" rx="${w * 0.27}" ry="${hh * 0.25}" fill="#F0B35B"/><circle cx="${w * 0.43}" cy="${hh * 0.5}" r="${hh * 0.07}" fill="#E5484D"/><circle cx="${w * 0.57}" cy="${hh * 0.6}" r="${hh * 0.07}" fill="#3FA166"/><circle cx="${w * 0.55}" cy="${hh * 0.45}" r="${hh * 0.05}" fill="#fff"/>`);
      case 'news': return S(`<rect width="${w}" height="${hh}" fill="#fff"/><rect x="10" y="10" width="${w * 0.2}" height="${hh * 0.1}" rx="3" fill="#E5484D"/><rect x="10" y="${hh * 0.27}" width="${w - 20}" height="${hh * 0.09}" rx="2" fill="#1B2232"/><rect x="10" y="${hh * 0.41}" width="${w * 0.7}" height="${hh * 0.09}" rx="2" fill="#1B2232"/><rect x="10" y="${hh * 0.58}" width="${w - 20}" height="${hh * 0.32}" rx="4" fill="#C9D3E3"/><circle cx="${w * 0.3}" cy="${hh * 0.72}" r="${hh * 0.08}" fill="#F8C81C"/><path d="M 10 ${hh * 0.9} L ${w * 0.45} ${hh * 0.68} L ${w - 10} ${hh * 0.9} Z" fill="#8FA3C2"/>`);
      case 'map': return S(`<rect width="${w}" height="${hh}" fill="#E8EEE4"/><path d="M0 ${hh * 0.3} L${w} ${hh * 0.45} M${w * 0.35} 0 L${w * 0.25} ${hh} M0 ${hh * 0.8} L${w} ${hh * 0.7}" stroke="#fff" stroke-width="9"/><rect x="${w * 0.55}" y="${hh * 0.08}" width="${w * 0.3}" height="${hh * 0.25}" fill="#CFE3C4"/><path d="M${w * 0.6} ${hh * 0.62} Q${w * 0.6} ${hh * 0.34} ${w * 0.6 + 0.001} ${hh * 0.34} M${w * 0.6} ${hh * 0.66} L${w * 0.53} ${hh * 0.47} A ${hh * 0.12} ${hh * 0.12} 0 1 1 ${w * 0.67} ${hh * 0.47} Z" fill="#E5484D"/><circle cx="${w * 0.6}" cy="${hh * 0.44}" r="${hh * 0.05}" fill="#fff"/>`);
      case 'gift': return S(`<rect width="${w}" height="${hh}" fill="#FDE8D7"/><rect x="${w * 0.28}" y="${hh * 0.42}" width="${w * 0.44}" height="${hh * 0.42}" rx="6" fill="#EE5A3A"/><rect x="${w * 0.24}" y="${hh * 0.3}" width="${w * 0.52}" height="${hh * 0.15}" rx="5" fill="#F27657"/><rect x="${w * 0.47}" y="${hh * 0.3}" width="${w * 0.06}" height="${hh * 0.54}" fill="#F8C81C"/><path d="M${w * 0.5} ${hh * 0.3} Q${w * 0.36} ${hh * 0.08} ${w * 0.34} ${hh * 0.26} Z M${w * 0.5} ${hh * 0.3} Q${w * 0.64} ${hh * 0.08} ${w * 0.66} ${hh * 0.26} Z" fill="#F8C81C"/>`);
      default: return S(`<defs><linearGradient id="pg${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8EC5F5"/><stop offset="1" stop-color="#DCEFFC"/></linearGradient></defs><rect width="${w}" height="${hh}" fill="url(#pg${seed})"/><circle cx="${w * 0.72}" cy="${hh * 0.3}" r="${hh * 0.11}" fill="#FFE07A"/>` +
        `<path d="M0 ${hh * 0.72} Q ${w * 0.25} ${hh * 0.48} ${w * 0.5} ${hh * 0.7} T ${w} ${hh * 0.62} V ${hh} H 0 Z" fill="#6FBF73"/><path d="M0 ${hh * 0.86} Q ${w * 0.4} ${hh * 0.68} ${w} ${hh * 0.86} V ${hh} H 0 Z" fill="#3FA166"/>`);
    }
  }

  // ── the camera: kit components add pushes that merge with the page's own P.cam keys ──
  const cam0 = B.cam;
  const mergeCams = (sh) => { sh.cams = [...(sh.userCams || []), ...(sh.kitCams || [])].sort((a, b) => a.at - b.at); };
  B.cam = function (keys) { cam0.call(this, keys); this.sh.userCams = this.sh.cams; mergeCams(this.sh); };
  function addCams(self, keys) { const sh = self.sh; if (!sh.userCams) sh.userCams = sh.cams.slice(); sh.kitCams = (sh.kitCams || []).concat(keys); mergeCams(sh); }
  const camKey = (at, x, y, s) => { s = clamp(s, 1.1, 2.1); const hx = W / 2 / s, hy = H / 2 / s; return { at, x: clamp(x, hx, W - hx), y: clamp(y + 40 / s, hy, H - hy), s, dur: 0.45, ease: 'out' }; };

  // ── leader lines (one svg per page, under the notes) ──
  function lines(self) {
    if (self.sh.csLines) return self.sh.csLines;
    const svg = PV.s('svg', { class: 'cs-line', width: W, height: H, viewBox: `0 0 ${W} ${H}` }, self.html);
    const L0 = { svg, list: [] };
    self.tick((lt) => { for (const f of L0.list) f(lt); });
    return (self.sh.csLines = L0);
  }
  const where = (to, lt) => (typeof to === 'function' ? to(lt) : to);

  // ── the phone ─────────────────────────────────────────
  const PW = 380, PH = 760, BZ = 11, SW = PW - 2 * BZ, SH = PH - 2 * BZ;
  /* builds a phone (or a frameless free panel) at stage centre (x, y); returns geometry + the screen element */
  function phone(self, x, y, o = {}, kind = 'chat') {
    const free = o.phone === false;
    const at = num(o.at, 0), tilt = clamp(num(o.tilt, 0), -8, 8) * Math.PI / 180;
    let w0 = PW, h0 = PH, s;
    if (free) {
      w0 = clamp(num(o.w, 560), 320, 900); h0 = clamp(num(o.h, 440), 220, 600);
      s = clamp(num(o.size, 1.5), 1, 2);
      s = Math.max(1, Math.min(s, (SA.x1 - SA.x0) / w0, (SA.y1 - SA.y0 + 20) / h0));
    // the phone keeps its size: its text is drawn at the smallest size a viewer can read. On a portrait stage, itself a
    // phone's shape, one phone is the picture: drawn about 1.45× (as tall as the content area allows)
    } else s = STAGE.portrait ? Math.min(1.45, (SA.y1 - SA.y0 + 100) / PH) : 1;
    const hw = (w0 * s) / 2 + Math.abs(Math.sin(tilt)) * h0 * s / 2, hh = (h0 * s) / 2 + Math.abs(Math.sin(tilt)) * w0 * s / 2;
    x = clamp(num(x, W / 2), hw + 40, W - hw - 40);
    y = clamp(num(y, H / 2 - 28), Math.min(SA.y0 - 62 + hh, H / 2), Math.max(SA.y1 + 17 - hh, H / 2 - 28));
    const root = h('div', 'cs-phone' + (free ? ' cs-free' : '') + (o.dark ? ' cs-dark' : ''), null, self.html);
    Object.assign(root.style, { width: w0 + 'px', height: h0 + 'px', left: x - w0 / 2 + 'px', top: y - h0 / 2 + 'px' });
    marker(root, w0, h0);
    if (!free) h('div', 'cs-body', null, root);
    const screen = h('div', 'cs-screen', null, root);
    const sw = free ? w0 : SW, shh = free ? h0 : SH, ox = free ? 0 : BZ, oy = free ? 0 : BZ;
    const content = h('div', null, null, screen);
    Object.assign(content.style, { position: 'absolute', inset: '0' });
    if (!free) {
      const dark = !!o.dark;
      const st = h('div', 'cs-status', null, screen);
      lab(st, o.time || '9:41', { size: 17, weight: 700, color: dark ? '#FFFFFF' : '#1B2232' });
      st.insertAdjacentHTML('beforeend', ic.status(dark ? '#fff' : '#1B2232'));
      h('div', 'cs-home', null, screen);
      h('div', 'cs-island', null, root);
    }
    const seed = hashS(kind + x + ',' + y) % 1000;
    const bob = (lt) => (o.float === false || free ? 0 : Math.sin(lt * 1.25 + seed) * 3.5);
    const P = { root, screen, content, s, x, y, w0, h0, sw, sh: shh, free, at, tilt, bob, shakes: [] };
    /** screen-local point → stage point at time lt */
    P.toStage = (sx, sy, lt = at + 1) => {
      const lx = (sx + ox - w0 / 2) * s, ly = (sy + oy - h0 / 2) * s, c = Math.cos(tilt), sn = Math.sin(tilt);
      return [x + lx * c - ly * sn, y + lx * sn + ly * c + bob(lt)];
    };
    const swap = !!o.swap;
    self.tick((lt) => {
      const k = swap ? (lt >= at ? 1 : 0) : fin(lt, at, 0.55), ko = outK(lt, o.out, 0.35);
      const vis = k * ko;
      set(root, 'display', vis <= 0.001 ? 'none' : 'block');
      if (vis <= 0.001) return;
      let rot = tilt, dx = 0;
      for (const t0 of P.shakes) { const p = (lt - t0) / 0.5; if (p > 0 && p < 1) { rot += Math.sin(p * 30) * 0.035 * (1 - p); dx += Math.sin(p * 37) * 7 * (1 - p); } }
      set(root, 'opacity', (swap ? ko : clamp(k * 1.4) * ko).toFixed(3));
      set(root, 'transform', `translate(${dx.toFixed(1)}px, ${((1 - k) * 90 + (1 - ko) * 30 + bob(lt)).toFixed(1)}px) rotate(${rot.toFixed(4)}rad)${s !== 1 ? ` scale(${s.toFixed(4)})` : ''}`);
      if (swap) { const e = fin(lt, at, 0.4); set(content, 'transform', `translateX(${((1 - e) * sw * 0.6).toFixed(1)}px)`); set(content, 'opacity', clamp(e * 1.6).toFixed(3)); }
    });
    // the turn: a red warning banner drops over the screen, the phone jolts, the screen edge glows red
    const warns = (Array.isArray(o.warn) ? o.warn : o.warn ? [o.warn] : []).filter((w) => w && (w.text || w.title));
    for (const wv of warns) {
      const wat = num(wv.at, at + 2), tone = wv.tone || 'red';
      if (wv.shake !== false && tone === 'red') P.shakes.push(wat);
      const edge = tone === 'red' && !free ? h('div', 'cs-edge', null, screen) : null;
      const ban = h('div', 'cs-warn' + (tone !== 'red' ? ' ' + tone : ''), `<div class="ic">${tone === 'blue' ? ic.check('#2F7CF6', 22) : ic.bang(tone === 'orange' ? '#F2860B' : '#E5484D', 24)}</div><div><div class="t">${rich(wv.text || wv.title)}</div>${wv.sub ? `<div class="s">${rich(wv.sub)}</div>` : ''}</div>`, screen);
      if (free) ban.style.top = '6px';
      self.tick((lt) => {
        const k = lt < wat ? 0 : ease.back(clamp((lt - wat) / 0.45)), ko = outK(lt, wv.out, 0.3);
        set(ban, 'display', k * ko <= 0 ? 'none' : 'flex');
        set(ban, 'transform', `translateY(${((1 - k) * -190).toFixed(1)}px)`);
        set(ban, 'opacity', ko.toFixed(3));
        if (edge) { const e = fin(lt, wat, 0.2) * ko; set(edge, 'opacity', (e * (0.55 + 0.45 * Math.cos((lt - wat) * 4.2))).toFixed(3)); }
      });
    }
    return P;
  }

  function header(P, title, sub, o = {}) {
    const hd = h('div', 'cs-head', `${o.back === false ? '' : `<div class="bk">${ic.back()}</div>`}<div class="t">${esc(title)}</div>${o.more === false ? '' : `<div class="mo">${ic.more()}</div>`}`, P.content);
    const sl = sub == null ? null : lab(hd, sub, { size: 15, weight: 500, maxW: 240 });
    return { el: hd, sub: sl };
  }

  // a vertical list whose rows grow in over time and scroll up when the view is full
  function stacker(self, view, viewH, rows, padTop = 14, padBot = 12) {
    const rowH = (r, lt) => r.hf(lt);
    const layout = (lt) => {
      let y = padTop; const ys = [];
      for (const r of rows) { ys.push(y); y += rowH(r, lt); }
      return { ys, scroll: Math.max(0, y + padBot - viewH) };
    };
    self.tick((lt) => {
      const { ys, scroll } = layout(lt);
      rows.forEach((r, i) => {
        const hh = rowH(r, lt), top = ys[i] - scroll;
        const vis = hh > 0.5 && top < viewH + 10 && top + (r.H || 0) > -40;
        set(r.el, 'visibility', vis ? 'visible' : 'hidden');
        if (vis) set(r.el, 'transform', `translateY(${top.toFixed(1)}px)`);
      });
    });
    return layout;
  }

  // ── P.ground ──────────────────────────────────────────
  const TINTS = {
    mint: ['#E6F5EE', '#CBE9DC', '#B5E0CC', '#FFFFFF'], peach: ['#FCEDE3', '#F7D8C6', '#F2C3A9', '#FFF6EF'],
    lilac: ['#EFEBFA', '#DCD3F4', '#C9BDEE', '#FFFFFF'], sky: ['#E5EFFA', '#CFE0F4', '#B7D0EE', '#FFFFFF'],
    butter: ['#FBF4DC', '#F5E6B6', '#EFD892', '#FFFDF3'], rose: ['#FBE8EC', '#F5D1D9', '#EDB8C4', '#FFF5F7'],
    grey: ['#EEF0F4', '#DDE1E8', '#CBD1DB', '#FFFFFF'], night: ['#1E2436', '#262E45', '#323C5A', '#3A4568'],
    alarm: ['#FBE3E1', '#F5C3BF', '#EE9F99', '#FFF3F2'],
  };
  /** ground({ tint='mint', at }): the soft colour ground the phones lie on; call it first on every page. To change the mood mid-page
   *  call it again with a later `at` (e.g. P.ground({ tint: 'alarm', at: P.cw(2, '骗') })): the new ground fades in over the old one. tint: 'mint' | 'peach' |
   *  'lilac' | 'sky' | 'butter' | 'rose' | 'grey' | 'night' (a late-night chat, the scam's dark hour) | 'alarm' (pale red: the
   *  moment it turns out to be fraud). Large soft shapes drift slowly behind; change the tint when the story changes mood. */
  B.ground = function (o = {}) {
    if (typeof o === 'string') o = { tint: o };
    const g = TINTS[o.tint] || TINTS.mint, dark = o.tint === 'night';
    const el = h('div', 'cs-ground', null, null);
    // a later ground (a mood change mid-page) lies over the earlier ones, under everything else
    const prevG = this.host.querySelectorAll(':scope > .cs-ground');
    this.host.insertBefore(el, prevG.length ? prevG[prevG.length - 1].nextSibling : this.host.firstChild);
    (this.sh.csGrounds = this.sh.csGrounds || []).push([num(o.at, 0), dark, el]);
    el.style.background = `radial-gradient(circle, ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(27,34,50,0.07)'} 1.7px, transparent 2.2px) 0 0 / 40px 40px, radial-gradient(1100px 800px at 34% 30%, ${g[3]}${dark ? '55' : 'aa'}, transparent 70%), linear-gradient(160deg, ${g[0]} 0%, ${g[1]} 100%)`;
    const blobs = [[0.12, 0.2, 520, g[2]], [0.86, 0.78, 640, g[2]], [0.78, 0.12, 300, g[3]], [0.2, 0.9, 380, g[1]]].map(([fx, fy, r, c], i) => {
      const b = h('div', 'cs-blob', null, el);
      Object.assign(b.style, { width: r * 2 + 'px', height: r * 2 + 'px', background: `radial-gradient(circle at 40% 40%, ${c}, ${c}00 70%)`, opacity: dark ? 0.55 : 0.75 });
      return [b, fx * W + 320 - r, fy * H + 320 - r, i];
    });
    const deco = PV.s('svg', { width: W + 640, height: H + 640, style: 'position:absolute;left:0;top:0' }, el);
    const rr = PV.rng(hashS(o.tint || 'mint') + 5), bub = [];
    for (let i = 0; i < 7; i++) {
      const bw = 260 + rr() * 300, bh = bw * (0.42 + rr() * 0.2), side = rr() > 0.5;
      const d = `M${bh / 2} 0 H${bw - bh / 2} A${bh / 2} ${bh / 2} 0 0 1 ${bw - bh / 2} ${bh} H${side ? bh * 0.7 : bh / 2} L${side ? 6 : bh * 0.5} ${bh + 26} L${side ? bh * 0.35 : bh * 0.3} ${bh - 4} A${bh / 2} ${bh / 2} 0 0 1 ${bh / 2} 0 Z`;
      const g = PV.s('g', {}, deco);
      PV.s('path', { d, fill: dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.22)', stroke: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.4)', 'stroke-width': 3 }, g);
      for (let j = 0; j < 3; j++) PV.s('rect', { x: bh * 0.45, y: bh * (0.3 + j * 0.16), width: (bw - bh * 0.9) * (j === 2 ? 0.55 : 0.9), height: bh * 0.07, rx: bh * 0.035, fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(27,34,50,0.045)' }, g);
      const zone = i % 2 ? [1150 + rr() * 1100, 300 + rr() * 1150] : [320 + rr() * 2000, i < 2 ? 330 + rr() * 140 : 1250 + rr() * 250];
      zone[0] *= (W + 640) / 2560; zone[1] *= (H + 640) / 1720;   // spread over this stage's ground
      bub.push([g, zone[0] - bw / 2, zone[1] - bh / 2, rr() * 6, 0.6 + rr() * 0.5]);
    }
    const at = num(o.at, 0);
    this.tick((lt) => {
      for (const [g, bx, by, ph, sp] of bub) g.setAttribute('transform', `translate(${(bx + Math.sin(lt * 0.25 * sp + ph) * 30).toFixed(1)} ${(by - lt * 6 * sp + Math.cos(lt * 0.3 + ph) * 14).toFixed(1)})`);
      set(el, 'opacity', fin(lt, at - 0.3, 0.4).toFixed(3));
      for (const [b, bx, by, i] of blobs) set(b, 'transform', `translate(${(bx + Math.sin(lt * 0.18 + i * 2) * 40).toFixed(1)}px, ${(by + Math.cos(lt * 0.15 + i) * 30).toFixed(1)}px)`);
    });
    return el;
  };

  // ── P.chat ────────────────────────────────────────────
  /** chat(x, y, { title, sub, messages: [{ from, text, at }, …], me, people, group, app, tilt, at, out, swap, warn, phone }):
   *  THE component — a phone at stage centre (x, y) showing one conversation; it lays out the bubbles, wraps Chinese and English
   *  text, scrolls up when full and never overflows the phone. The phone is 380 × 760 px (fixed size, kept inside the frame).
   *  One phone: x ≈ 560 with notes on the right; two phones: x ≈ 520 and 1400. In a portrait film the phone is drawn about
   *  1.45× (550 × 1100) and is the page: one phone at x ≈ 540, notes above or below it over its edge, never two phones.
   *  title: the contact or group name in the header; sub: a small line under it (e.g. '在线', '38 members'). from: 'me' (right,
   *  green) or the sender's name (left, white, avatar = first character); people: { name: { color, avatar } } to fix colours.
   *  A group (names above bubbles) is detected when more than one other person speaks. app: 'sms' for a plain text-message
   *  thread (grey bubbles, no avatars; title = the sender number, e.g. '95588').
   *  Each message: { from, text, at } plus optional
   *    kind: 'text' (default) | 'voice' (sec, play) | 'image' (scene: 'photo'|'selfie'|'chart'|'screenshot'|'doc'|'qr'|'food'|'news'|'map'|'gift')
   *      | 'redpacket' (text, open: t) | 'transfer' (amount: '¥5,000', text, accept: t) | 'link' (title, text, domain, scene)
   *      | 'file' (title, size) | 'time' (a small centred timestamp, e.g. '昨天 23:14') | 'system' (a centred grey line; tone: 'red')
   *    typing: seconds of "typing…" dots before it lands (default ~0.9 s for other people's messages when there is room; 0 = none)
   *    typed: true — my message is typed into the input bar first, then sent at `at`
   *    recall: t — at t the bubble is recalled and replaced by "… unsent a message" (the turn)
   *    hl: true | 'red' — ring the bubble yellow (or red) at hlAt (default at + 0.5); zoom: true | scale — the camera pushes into
   *      this bubble as it lands (1.45×, at most 1.7) and backs out at the next message (or zoomOut: t). read: t — "Read" appears under my bubble.
   *    fail: true — a red ! beside my bubble (not delivered). Text markup: **bold**, {r:red}, {g:green}, {u:link}.
   *    { from, typing: true, at, until } — dots that hang (the reply that never comes).
   *  A bubble holds about 9 汉字 or 16 letters a line: keep a message to ≤ 30 汉字 / 18 words (longer is cut after 7 lines).
   *  warn: { at, text, sub, tone: 'red'|'orange'|'blue' } drops a warning banner over the chat. phone: false → no phone, a big
   *  frameless conversation floating on the ground (w, h, size=1.5). Returns { spot(i) → lt => [x, y] (for P.note's to),
   *  pos(i, t) → [x, y] }. */
  B.chat = function (x, y, o = {}) {
    if (Array.isArray(o)) o = { messages: o };
    if (x && typeof x === 'object' && !Array.isArray(x)) { o = x; x = o.x; y = o.y; }
    const sms = o.app === 'sms';
    const P = phone(this, x, y, o, 'chat');
    const free = P.free;
    const meName = o.me || 'me', isMe = (f) => f === 'me' || f === 'Me' || f === '我' || f === meName || f === 'I';
    const raw = (o.messages || o.msgs || []).filter(Boolean).map((m) => (typeof m === 'string' ? { text: m } : { ...m }));
    let prev = P.at + 0.5;
    const msgs = raw.map((m, i) => {
      const from = m.from ?? m.who ?? m.name ?? (m.me || m.side === 'r' || m.side === 'right' ? 'me' : 'them');
      const at = Math.max(num(m.at ?? m.t, prev + (i ? 1.5 : 0.3)), (i ? prev + 0.12 : P.at + 0.2));
      const gap = at - prev;
      prev = at;
      return { ...m, from, me: isMe(from), at, gap, kind: m.kind || (m.typing === true ? 'hang' : 'text') };
    });
    const others = [...new Set(msgs.filter((m) => !m.me && !['time', 'system'].includes(m.kind)).map((m) => m.from))];
    const group = !sms && (o.group ?? others.length > 1);
    const people = o.people || {};
    const avatarOf = (name) => {
      const p = people[name] || {};
      return `<div class="cs-av" style="background:${col(p.color) || AVC[hashS(name) % AVC.length]}">${esc(p.avatar ?? initial(name))}</div>`;
    };
    const headH = free || o.head === false ? 0 : 116, inH = free || o.input === false ? 0 : 90;
    const viewH = P.sh - headH - inH;
    let hd = null, field = null;
    const baseSub = o.sub ?? (sms ? L('短信', 'Text Message') : group ? L(`${others.length + 1} 人`, `${others.length + 1} people`) : '');
    if (headH) hd = header(P, o.title ?? (sms ? (others[0] || '10086') : others.length === 1 ? others[0] : L('群聊', 'Group chat')), baseSub);
    if (inH) {
      const bar = h('div', 'cs-input', `<div class="ic">${ic.mic()}</div><div class="f"></div><div class="ic">${ic.smile()}</div><div class="ic">${ic.plus()}</div>`, P.content);
      field = bar.querySelector('.f');
    }
    const view = h('div', 'cs-view', null, P.content);
    Object.assign(view.style, { top: headH + 'px', height: viewH + 'px' });
    const G = 15;
    const rows = msgs.map((m, i) => {
      const el = h('div', 'cs-row', null, view);
      const r = { m, el, i, typing: 0 };
      if (m.kind === 'time' || m.kind === 'system') {
        if (m.kind === 'time') { const w0 = h('div', 'cs-sys', null, el); lab(w0, plain(m.text), { size: 15, weight: 500, color: '#8B95A8' }); }
        else el.innerHTML = `<div class="cs-sys${m.tone === 'red' ? ' red' : ''}"><span>${rich(m.text)}</span></div>`;
        r.H = el.offsetHeight || 30; r.t0 = m.at;
        r.hf = (lt) => (lt < m.at ? 0 : (r.H + G) * fin(lt, m.at, 0.25));
        r.draw = (lt) => set(el, 'opacity', fin(lt, m.at, 0.3).toFixed(3));
        return r;
      }
      const k = m.kind;
      const showAv = !sms && !m.me;
      let inner;
      if (k === 'voice') {
        const sec = clamp(Math.round(num(m.sec ?? m.dur, 6)), 1, 60);
        inner = `<div class="cs-b"><div class="cs-voice" style="width:${Math.round(56 + sec * 5.5)}px">${ic.wave('#1B2232', 24)}</div></div>`;
      } else if (k === 'image') {
        const portrait = m.scene === 'selfie' || m.scene === 'qr' || m.portrait;
        const iw = portrait ? 160 : 220, ih = portrait ? 200 : 156;
        inner = `<div class="cs-img">${scene(m.scene || 'photo', iw, ih, hashS(String(m.scene) + i) % 97 + 1)}</div>`;
      } else if (k === 'redpacket') {
        inner = `<div class="cs-card rp"><div class="bd"><div class="ic">${ic.envelope()}</div><div class="tt">${esc(m.text || L('恭喜发财，大吉大利', 'Best wishes!'))}</div></div><div class="ft"></div></div>`;
      } else if (k === 'transfer') {
        inner = `<div class="cs-card tf"><div class="bd"><div class="ic">${ic.coin()}</div><div class="tw"><div class="am">${esc(m.amount || '¥5,000.00')}</div></div></div><div class="ft"></div></div>`;
      } else if (k === 'link') {
        inner = `<div class="cs-link"><div class="tt">${esc(m.title || m.text || '')}</div><div class="rw"><div class="ds" style="flex:1;min-width:0"></div><div class="th">${scene(m.scene || 'news', 54, 54, i + 3)}</div></div><div class="dm"></div></div>`;
      } else if (k === 'file') {
        inner = `<div class="cs-link"><div class="rw" style="margin:0"><div style="flex:1;min-width:0"><div class="tt" style="font-weight:600">${esc(m.title || m.text || 'file')}</div><div class="sz"></div></div>${ic.doc('#2F7CF6', 40)}</div></div>`;
      } else if (k === 'hang') {
        inner = `<div class="cs-typing" style="position:relative${sms ? ';background:#E4E7EC' : ''}"><i></i><i></i><i></i></div>`;
      } else {
        inner = `<div class="cs-b"${sms && !m.me ? ' style="background:#E4E7EC"' : ''}>${rich(m.text)}</div>`;
      }
      el.innerHTML = `<div class="cs-msg${m.me ? ' me' : ''}">${showAv ? avatarOf(m.from) : ''}<div class="cs-col"><div class="cs-bw" style="position:relative">${inner}</div></div></div>`;
      const msgEl = el.firstChild, colEl = el.querySelector('.cs-col'), bw = el.querySelector('.cs-bw'), body = bw.firstChild;
      if (sms) msgEl.style.padding = m.me ? '0 16px 0 50px' : '0 50px 0 16px';
      const nm = group && !m.me ? lab(colEl, m.from, { size: 15, weight: 500, maxW: 220 }) : null;
      if (nm) { nm.classList.add('cs-name'); colEl.insertBefore(nm, bw); }
      // small chrome inside cards
      if (k === 'voice') lab(body.firstChild, `${clamp(Math.round(num(m.sec ?? m.dur, 6)), 1, 60)}″`, { size: 19, weight: 600, color: '#1B2232' });
      if (k === 'redpacket') lab(body.querySelector('.ft'), L('红包', 'Red packet'), { size: 13 });
      if (k === 'transfer') { lab(body.querySelector('.tw'), m.text || L('转账给你', 'Transfer to you'), { size: 15, color: '#FFFFFF', maxW: 150 }); lab(body.querySelector('.ft'), L('转账', 'Transfer'), { size: 13 }); }
      if (k === 'link') { lab(body.querySelector('.ds'), m.title ? m.text || '' : '', { size: 15, maxW: 170 }); lab(body.querySelector('.dm'), m.domain || 'link', { size: 13, color: '#A3ABBB', maxW: 230 }); }
      if (k === 'file') lab(body.querySelector('.sz'), m.size || '1.2 MB', { size: 14 });
      const rd = m.read != null && m.me ? lab(colEl, L('已读', 'Read'), { size: 14 }) : null;
      if (rd) rd.classList.add('cs-read');
      const av = el.querySelector('.cs-av');
      r.H = el.offsetHeight || 60; r.body = body;
      r.bx = bw.offsetLeft + bw.offsetWidth / 2; r.by = bw.offsetTop + bw.offsetHeight / 2;
      if (!bw.offsetWidth) { r.bx = m.me ? P.sw - 120 : 140; r.by = r.H / 2; }
      const typ = k === 'hang' || m.me ? 0 : num(m.typing === true ? 1 : m.typing, m.gap > 1.1 ? Math.min(0.9, m.gap - 0.35) : 0);
      r.typing = typ;
      let tyEl = null;
      if (typ > 0) { tyEl = h('div', 'cs-typing', '<i></i><i></i><i></i>', bw); tyEl.style.left = '0'; tyEl.style.top = '0'; if (sms) tyEl.style.background = '#E4E7EC'; }
      const nameH = nm ? nm.offsetHeight + 4 : 0;
      r.TH = typ > 0 ? nameH + (tyEl.offsetHeight || 46) : 0;
      let rcEl = null;
      if (m.recall != null) {
        rcEl = h('div', 'cs-sys recall', `<span>${m.me ? L('你撤回了一条消息', 'You unsent a message') : group ? L(`“${esc(m.from)}”撤回了一条消息`, `${esc(m.from)} unsent a message`) : L('对方撤回了一条消息', 'They unsent a message')}</span>`, el);
        r.RH = rcEl.offsetHeight || 34;
      }
      const t0 = typ > 0 ? m.at - typ : m.at;
      r.t0 = t0;
      const rec = m.recall != null ? num(m.recall, m.at + 2) : null;
      if (k === 'hang') {
        const until = m.until != null ? num(m.until, 1e9) : 1e9;
        r.hf = (lt) => (lt < m.at ? 0 : (r.H + G) * fin(lt, m.at, 0.25) * (1 - fin(lt, until, 0.25)));
        r.hang = [m.at, until];
      } else {
        r.hf = (lt) => {
          if (lt < t0) return 0;
          if (lt < m.at) return (r.TH + G) * fin(lt, t0, 0.22);
          let hh = lerp(typ > 0 ? r.TH + G : 0, r.H + G, ease.out(clamp((lt - m.at) / 0.28)));
          if (rec != null && lt > rec) hh = lerp(r.H + G, r.RH + G, ease.inOut(clamp((lt - rec - 0.18) / 0.4)));
          return hh;
        };
      }
      const hlAt = m.hl ? num(m.hlAt ?? (typeof m.hl === 'number' ? m.hl : null), m.at + 0.5) : null, hlRed = m.hl === 'red' || m.hlColor === 'red';
      const readAt = rd ? num(m.read === true ? m.at + 1 : m.read, m.at + 1) : null;
      const dots = (k === 'hang' ? body : tyEl)?.querySelectorAll('i');
      let fail = null;
      if (m.fail) { fail = h('div', 'cs-fail', `<svg viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="14" fill="#E5484D"/><rect x="12.4" y="6.5" width="3.2" height="10" rx="1.6" fill="#fff"/><circle cx="14" cy="20.5" r="1.9" fill="#fff"/></svg>`, bw); fail.style.left = '-36px'; }
      const voiceDot = k === 'voice' && !m.me ? h('div', 'cs-dot', null, body) : null;
      r.draw = (lt) => {
        const gone = rec != null && lt > rec ? fin(lt, rec, 0.3) : 0;
        if (av) { const [sc, op] = pop2(lt, t0, 0.35); set(av, 'transform', `scale(${sc.toFixed(3)})`); set(av, 'opacity', (op * (1 - gone)).toFixed(3)); }
        if (nm) set(nm, 'opacity', (fin(lt, t0, 0.25) * (1 - gone)).toFixed(3));
        if (dots) {
          const live = k === 'hang' ? lt >= m.at : lt >= t0 && lt < m.at;
          if (tyEl) set(tyEl, 'opacity', live ? fin(lt, t0, 0.2).toFixed(3) : '0');
          if (live) dots.forEach((d, j) => { const b = Math.max(0, Math.sin(lt * 7.5 - j * 0.9)); set(d, 'transform', `translateY(${(-b * 5).toFixed(1)}px)`); set(d, 'opacity', (0.45 + 0.55 * b).toFixed(2)); });
        }
        if (k === 'hang') { set(body, 'opacity', clamp(r.hf(lt) / (r.H + G)).toFixed(3)); return; }
        let [sc, op] = pop2(lt, m.at, 0.34, 0.7);
        if (gone > 0) { op *= 1 - gone; sc *= 1 - 0.3 * clamp(gone * 2 - 1); }
        set(body, 'transform', `scale(${sc.toFixed(3)})`); set(body, 'opacity', op.toFixed(3));
        if (rcEl) set(rcEl, 'opacity', (rec != null ? fin(lt, rec + 0.25, 0.3) : 0).toFixed(3));
        if (hlAt != null) body.classList.toggle(hlRed ? 'warn' : 'hl', lt >= hlAt && gone === 0);
        if (k === 'redpacket' || k === 'transfer') body.classList.toggle('done', lt >= num(m.open ?? m.accept, 1e9));
        if (k === 'voice' && m.play != null) { const p0 = num(m.play, 1e9), pl = lt >= p0 && lt < p0 + num(m.sec, 6); const wv = body.querySelector('svg'); if (wv) set(wv, 'opacity', pl ? (0.35 + 0.65 * Math.abs(Math.sin(lt * 5))).toFixed(2) : '1'); }
        if (voiceDot) set(voiceDot, 'opacity', lt < num(m.play, 1e9) ? '1' : '0');
        if (fail) set(fail, 'opacity', fin(lt, m.at + 0.5, 0.2).toFixed(3));
        if (rd) set(rd, 'opacity', (lt >= readAt ? fin(lt, readAt, 0.3) : 0).toFixed(3));
      };
      return r;
    });
    const layout = stacker(this, view, viewH, rows);
    const typingSub = L('对方正在输入…', 'typing…');
    this.tick((lt) => {
      for (const r of rows) r.draw(lt);
      if (hd && hd.sub && !group) {
        const typing = rows.some((r) => (r.typing > 0 && lt >= r.t0 && lt < r.m.at) || (r.hang && lt >= r.hang[0] && lt < r.hang[1]));
        hd.sub.put(typing ? typingSub : baseSub, typing ? '#1FB25A' : '#8B95A8');
      }
      if (field) {
        let txt = '';
        for (const r of rows) {
          if (!r.m.me || !r.m.typed || !r.m.text) continue;
          const t = [...plain(r.m.text)], td = clamp(t.length * 0.085, 0.6, 2.2);
          if (lt >= r.m.at - td && lt < r.m.at) txt = t.slice(0, Math.ceil(t.length * clamp((lt - r.m.at + td) / td))).join('');
        }
        html(field, txt ? `<span style="flex:none">${esc(txt)}</span><span class="c"></span>` : '');
      }
    });
    const pos = (i, t) => {
      i = clamp(Math.round(num(i, 0)), 0, rows.length - 1);
      const r = rows[i]; if (!r) return [P.x, P.y];
      t = t ?? r.m.at + 0.35;
      const { ys, scroll } = layout(t);
      return P.toStage(r.bx, headH + clamp(ys[i] - scroll + r.by, 24, viewH - 24), t);
    };
    // the camera pushes into bubbles marked zoom
    const keys = [];
    rows.forEach((r, i) => {
      if (!r.m.zoom) return;
      const s = typeof r.m.zoom === 'number' ? Math.min(r.m.zoom, 1.7) : 1.45;
      const t = r.m.at + 0.12, [zx, zy] = pos(i, r.m.at + 0.4);
      // aim between the bubble and the frame's centre, so what stands beside the phone is cut less
      keys.push(camKey(t, lerp(zx, W / 2, 0.3), zy, s));
      const next = rows.slice(i + 1).find((q) => q.t0 > t + 0.6);
      const back = r.m.zoomOut != null ? num(r.m.zoomOut, t + 3) : next ? (next.m.zoom ? null : next.t0 - 0.05) : t + 3.2;
      if (back != null) keys.push({ at: back, x: W / 2, y: H / 2, s: 1, dur: 0.5, ease: 'out' });
    });
    if (keys.length) addCams(this, keys);
    // a bubble's stage point, or null while it is scrolled out of view or recalled (a leader line to it then fades)
    const spot = (i) => (lt) => {
      i = clamp(Math.round(num(i, 0)), 0, rows.length - 1); const r = rows[i]; if (!r) return null;
      const t = Math.max(lt, r.m.at + 0.35), { ys, scroll } = layout(t), yy = ys[i] - scroll + r.by;
      if (yy < 10 || yy > viewH - 10 || (r.m.recall != null && lt > num(r.m.recall, 1e9))) return null;
      return P.toStage(r.bx, headH + yy, t);
    };
    return { el: P.root, phone: P, spot, pos };
  };

  // ── P.say: one giant floating bubble on the ground ──
  /** say(x, y, text, { from='them', name, at, typing=0.9, recall, hl, out, size=48, w=900, fly }): one giant chat bubble floating on the
   *  ground, centred on (x, y) — a cold open, the line everyone has received, a quote held up for the viewer. from: 'me' (green,
   *  right) or a name (white, avatar). typing: seconds of dots first. recall: t turns it into "… unsent a message".
   *  fly: chat.spot(i) — THE LIFT: the bubble rises out of that message in the phone and flies, growing, to (x, y) at `at`
   *  (no typing dots), so the key line of the chat is held up big beside the phone. Text ≤ 30 汉字 / 18 words. */
  B.say = function (x, y, text, o = {}) {
    if (text && typeof text === 'object') { o = text; text = o.text; }
    const me = o.from === 'me' || o.me === true, at = num(o.at, 0.3), size = clamp(num(o.size, 48), 32, 72);
    const el = h('div', 'cs-say' + (me ? ' me' : ''), null, this.html);
    const nm = o.name ?? o.from ?? '?';
    const c = col(o.color) || (me ? '#3FA166' : AVC[hashS(nm) % AVC.length]);
    el.innerHTML = `${me ? '' : `<div class="cs-av" style="background:${c}">${esc(o.avatar ?? initial(nm))}</div>`}<div class="cs-bw" style="position:relative"><div class="cs-b" style="font-size:${size}px;max-width:${clamp(num(o.w, 900), 360, Math.min(1300, W - 120))}px">${rich(text)}</div></div>`;
    const bw = el.querySelector('.cs-bw'), body = bw.firstChild, av = el.querySelector('.cs-av');
    const typ = o.fly ? 0 : num(o.typing, me ? 0 : 0.9);
    let ty = null;
    if (typ > 0) { ty = h('div', 'cs-typing', '<i></i><i></i><i></i>', bw); Object.assign(ty.style, { left: '0', top: '0' }); }
    let rc = null;
    if (o.recall != null) { rc = h('div', 'cs-sys', `<span>${me ? L('你撤回了一条消息', 'You unsent a message') : L('对方撤回了一条消息', 'They unsent a message')}</span>`, bw); Object.assign(rc.style, { position: 'absolute', left: me ? 'auto' : '0', right: me ? '0' : 'auto', top: '12px' }); }
    const w = el.offsetWidth || 600, hh = el.offsetHeight || 120;
    const left = clamp(num(x, W / 2) - w / 2, 60, W - 60 - w), top = clamp(num(y, 500) - hh / 2, SA.y0 - 30, SA.y1 - hh);
    Object.assign(el.style, { left: left + 'px', top: top + 'px', transformOrigin: '50% 50%' });
    marker(el, w, hh);
    const t0 = at - typ, rec = o.recall != null ? num(o.recall, at + 2) : null, hlAt = o.hl ? num(typeof o.hl === 'number' ? o.hl : o.hlAt, at + 0.5) : null;
    const dots = ty ? ty.querySelectorAll('i') : [];
    const flyDur = 0.6;
    this.tick((lt) => {
      const ko = outK(lt, o.out);
      if (o.fly) {
        const src = where(o.fly, at) || [left + w / 2, top + hh / 2], k = ease.inOut(clamp((lt - at) / flyDur));
        const sk = lerp(0.35, 1, k), dx = (src[0] - (left + w / 2)) * (1 - k), dy = (src[1] - (top + hh / 2)) * (1 - k) - Math.sin(k * Math.PI) * 60;
        set(el, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sk.toFixed(3)})`);
        set(el, 'opacity', (lt < at ? 0 : (k < 0.3 ? 0.45 : 1) * ko).toFixed(3));
        if (av) set(av, 'opacity', '1');
        set(body, 'transform', 'none'); set(body, 'opacity', '1');
        if (hlAt != null) body.classList.toggle(o.hl === 'red' ? 'warn' : 'hl', lt >= hlAt);
        return;
      }
      set(el, 'opacity', (lt < t0 ? 0 : ko).toFixed(3));
      if (av) { const [s1, o1] = pop2(lt, t0); set(av, 'transform', `scale(${s1.toFixed(3)})`); set(av, 'opacity', o1.toFixed(3)); }
      if (ty) { const live = lt >= t0 && lt < at; set(ty, 'opacity', live ? fin(lt, t0, 0.2).toFixed(3) : '0'); if (live) dots.forEach((d, j) => { const b = Math.max(0, Math.sin(lt * 7.5 - j * 0.9)); set(d, 'transform', `translateY(${(-b * 9).toFixed(1)}px)`); }); }
      let [sc, op] = pop2(lt, at, 0.36, 0.7);
      const gone = rec != null && lt > rec ? fin(lt, rec, 0.3) : 0;
      if (gone > 0) { op *= 1 - gone; sc *= 1 - 0.3 * clamp(gone * 2 - 1); }
      if (rc) set(rc, 'opacity', (rec != null && lt > rec ? fin(lt, rec + 0.25, 0.3) : 0).toFixed(3));
      set(body, 'transform', `scale(${sc.toFixed(3)})`); set(body, 'opacity', op.toFixed(3));
      if (hlAt != null) body.classList.toggle(o.hl === 'red' ? 'warn' : 'hl', lt >= hlAt && gone === 0);
    });
    return { el, spot: () => () => [left + w / 2, top + hh / 2] };
  };

  // notification card markup (lock screen and toast); the app line and time are small chrome
  const APPNAME = () => ({ chat: L('聊天', 'Chat'), sms: L('信息', 'Messages'), bank: L('银行', 'Bank'), mail: L('邮件', 'Mail'), news: L('新闻', 'News'), social: L('社交', 'Social'), work: L('工作', 'Work'), shop: L('购物', 'Shop'), alert: L('提醒', 'Alert'), phone: L('电话', 'Phone'), calendar: L('日历', 'Calendar'), pay: L('支付', 'Pay') });
  function noteCard(parent, n) {
    const [bg, g] = app(n.app);
    const el = h('div', 'cs-note', `<div class="ai" style="background:${bg}">${g()}</div><div class="tx2"><div class="hd"></div>${n.title ? `<div class="tt">${esc(n.title)}</div>` : ''}<div class="bd2">${rich(n.text || '')}</div></div>`, parent);
    const hdl = el.querySelector('.hd');
    lab(hdl, n.appName || APPNAME()[n.app] || APPNAME().chat, { size: 14, weight: 600, color: '#6B7487', maxW: 160 });
    lab(hdl, n.time || L('现在', 'now'), { size: 14, color: '#8B95A8' });
    return el;
  }

  // ── P.lock: lock screen with notifications ──
  const WALL = { dusk: 'linear-gradient(170deg, #3B4A8C 0%, #8A5FA8 55%, #E99A8A 100%)', night: 'linear-gradient(170deg, #0F1630 0%, #24305A 60%, #3C3F78 100%)',
    dawn: 'linear-gradient(170deg, #6FA3D8 0%, #B9C9E8 55%, #F4D3B5 100%)', mint: 'linear-gradient(170deg, #2E8C74 0%, #6CC3A2 60%, #CDEBD9 100%)' };
  /** lock(x, y, { time='23:47', date, wall='dusk'|'night'|'dawn'|'mint', notes: [{ app, title, text, at, time }], at, tilt, warn }):
   *  a lock screen at stage centre (x, y): big clock, wallpaper, notifications that drop in one by one, the newest on top, pushing
   *  the others down (about 4 fit). app: 'chat' | 'sms' | 'bank' | 'mail' | 'news' | 'social' | 'work' | 'shop' | 'alert' | 'phone' |
   *  'calendar' | 'pay'. title: the sender (e.g. '95588', '妈妈', 'Team Lead'); text: ≤ 30 汉字 / 18 words (markup {r:…}, **…**).
   *  For a bank SMS, a verification code, notification overload at midnight, the message that arrives while you sleep. */
  B.lock = function (x, y, o = {}) {
    const P = phone(this, x, y, { ...o, dark: true }, 'lock');
    const lk = h('div', 'cs-lock', null, P.content);
    lk.style.background = WALL[o.wall] || WALL.dusk;
    lab(h('div', 'dt', null, lk), o.date || L('10月13日 星期一', 'Monday, October 13'), { size: 19, weight: 600, color: '#FFFFFF' });
    h('div', 'clk', esc(o.time || '23:47'), lk);
    const notes = (o.notes || o.notifications || []).filter(Boolean).map((n, i) => ({ ...n, at: num(n.at, P.at + 0.6 + i * 1.2) }));
    const rows = notes.map((n) => { const el = noteCard(lk, n); return { n, el, H: (el.offsetHeight || 110) + 10 }; });
    const top0 = 200, maxY = P.sh - 40;
    this.tick((lt) => {
      let y0 = top0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i], k = fin(lt, r.n.at, 0.4), ko = outK(lt, r.n.out, 0.3);
        if (k <= 0 || ko <= 0) { set(r.el, 'display', 'none'); continue; }
        set(r.el, 'display', 'flex');
        const yy = y0 - (1 - k) * 50;
        set(r.el, 'top', yy.toFixed(1) + 'px');
        set(r.el, 'opacity', (clamp(k * 1.5) * ko * clamp((maxY - yy - r.H * 0.6) / 50)).toFixed(3));
        y0 += r.H * k * ko;
      }
    });
    return { el: P.root, phone: P, spot: () => () => P.toStage(P.sw / 2, top0 + 50) };
  };

  // ── P.toast: one big notification on the ground ──
  /** toast(x, y, { app, title, text, time, at, out, size=1.3 }): one notification card blown up on the ground, centred on (x, y),
   *  dropping in from above — the bank SMS, the verification code, the "you were mentioned" that starts it all. Same apps as lock. */
  B.toast = function (x, y, o = {}) {
    const at = num(o.at, 0.3), s = clamp(num(o.size, 1.3), 1.15, 1.8);
    const wrap = h('div', 'cs-toast', null, this.html);
    noteCard(wrap, o);
    const w = 420 * s, hh = (wrap.offsetHeight || 110) * s;
    const cx = clamp(num(x, W / 2), w / 2 + 60, W - w / 2 - 60), top = clamp(num(y, 300) - hh / 2, SA.y0 - 40, SA.y1 - hh);
    Object.assign(wrap.style, { left: cx - 210 + 'px', top: top + 'px' });
    marker(wrap, 420, wrap.offsetHeight || 110);
    this.tick((lt) => {
      const [sc, op] = pop2(lt, at, 0.45, 0.85), ko = outK(lt, o.out);
      set(wrap, 'opacity', (op * ko).toFixed(3));
      set(wrap, 'transform', `translateY(${((1 - Math.min(1, sc)) * -300).toFixed(1)}px) scale(${(s * Math.max(0.9, sc)).toFixed(3)})`);
    });
    return { el: wrap, spot: () => () => [cx, top + hh / 2] };
  };

  // ── P.call: incoming call ──
  /** call(x, y, { name, number, tag, tagAt, at, answer, decline, tilt, warn }): an incoming-call screen at stage centre (x, y):
   *  the caller's name (or '未知号码' / 'Unknown caller'), the number, rings pulsing round the avatar, decline and accept buttons.
   *  tag: a red label under the number (e.g. '疑似诈骗' / 'Suspected spam') that appears at tagAt. answer: t → the call connects
   *  and a timer runs; decline: t → "Call ended". */
  B.call = function (x, y, o = {}) {
    const P = phone(this, x, y, { ...o, dark: true }, 'call');
    const sc = h('div', 'cs-call', null, P.content);
    sc.style.background = 'linear-gradient(175deg, #2A3350 0%, #3B2E4F 55%, #1C2133 100%)';
    const nm = o.name || L('未知号码', 'Unknown caller');
    lab(h('div', 'st', null, sc), o.label || L('来电', 'incoming call'), { size: 17, color: 'rgba(255,255,255,0.75)' });
    h('div', 'nm', esc(nm), sc); h('div', 'nb', esc(o.number || '+86 170 0000 0000'), sc);
    const tag = o.tag ? h('div', 'tg', esc(o.tag), sc) : null;
    const avY = 386, ring = [];
    for (let i = 0; i < 3; i++) { const r0 = h('div', null, null, sc); Object.assign(r0.style, { position: 'absolute', left: P.sw / 2 - 56 + 'px', top: avY - 56 + 'px', width: '112px', height: '112px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.5)' }); ring.push(r0); }
    const av = h('div', 'cs-av', esc(o.avatar ?? (o.name ? initial(o.name) : '?')), sc);
    Object.assign(av.style, { position: 'absolute', left: P.sw / 2 - 56 + 'px', top: avY - 56 + 'px', width: '112px', height: '112px', borderRadius: '50%', fontSize: '50px', background: o.name ? AVC[hashS(nm) % AVC.length] : '#6B7487' });
    const dec = h('div', 'btn', ic.phone('#fff', 36, 135), sc); Object.assign(dec.style, { left: '58px', background: '#E5484D' });
    const acc = h('div', 'btn', ic.phone('#fff', 36, 0), sc); Object.assign(acc.style, { right: '58px', background: '#1FB25A' });
    const l1 = h('div', 'bl', null, sc); l1.style.left = '38px'; lab(l1, L('拒绝', 'Decline'), { size: 16, color: '#FFFFFF' });
    const l2 = h('div', 'bl', null, sc); l2.style.right = '38px'; lab(l2, L('接听', 'Accept'), { size: 16, color: '#FFFFFF' });
    const timer = h('div', 'tm', '', sc);
    const ans = o.answer != null ? num(o.answer, 1e9) : 1e9, dcl = o.decline != null ? num(o.decline, 1e9) : 1e9, tagAt = num(o.tagAt, P.at + 1.2);
    this.tick((lt) => {
      const live = lt < ans && lt < dcl;
      ring.forEach((r0, i) => { const p = ((lt * 0.7 + i / 3) % 1); set(r0, 'transform', `scale(${(1 + p * 0.9).toFixed(3)})`); set(r0, 'opacity', live ? ((1 - p) * 0.8).toFixed(3) : '0'); });
      if (tag) { const [s1, o1] = pop2(lt, tagAt, 0.4); set(tag, 'opacity', o1.toFixed(3)); set(tag, 'transform', `translateX(-50%) scale(${s1.toFixed(3)})`); }
      const wig = live ? Math.sin(lt * 9) * 0.12 * (Math.sin(lt * 1.6) > 0 ? 1 : 0) : 0;
      set(acc, 'transform', `rotate(${wig.toFixed(3)}rad)`); set(acc, 'opacity', lt >= ans ? '0' : (1 - (lt >= dcl ? fin(lt, dcl, 0.3) : 0)).toFixed(3));
      set(l2, 'opacity', lt >= ans || lt >= dcl ? '0' : '1');
      if (lt >= ans) { const s0 = Math.floor(lt - ans); html(timer, `${String(Math.floor(s0 / 60)).padStart(2, '0')}:${String(s0 % 60).padStart(2, '0')}`); set(dec, 'left', (P.sw / 2 - 38) + 'px'); set(l1, 'opacity', '0'); }
      else if (lt >= dcl) { html(timer, esc(L('通话已结束', 'Call ended'))); if (tag) set(tag, 'opacity', '0'); set(dec, 'opacity', (1 - fin(lt, dcl, 0.3)).toFixed(3)); set(l1, 'opacity', '0'); }
      else html(timer, '');
    });
    return { el: P.root, phone: P, spot: (k) => () => (k === 'accept' ? P.toStage(P.sw - 96, P.sh - 134) : k === 'decline' ? P.toStage(96, P.sh - 134) : k === 'tag' ? P.toStage(P.sw / 2, 240) : P.toStage(P.sw / 2, avY)) };
  };

  // ── P.pay: a transfer screen ──
  /** pay(x, y, { to, amount, note, at, confirm, done, currency, tilt, warn }): a transfer screen at stage centre (x, y): the payee,
   *  the amount typed digit by digit on the keypad (from at + 0.6), a green confirm button. confirm: t → a finger taps it;
   *  done: t → "Transfer sent" with a green tick. Put the turn on it with warn: { at, text: '对方可能是诈骗账户' }. amount: a number.
   *  spot('go') / spot('amount') give the button and the amount on the stage. */
  B.pay = function (x, y, o = {}) {
    const P = phone(this, x, y, o, 'pay');
    const sc = h('div', 'cs-pay', null, P.content);
    header({ content: sc }, L('转账', 'Transfer'), null, { more: false });
    const cur = o.currency || L('¥', '$'), amt = Math.abs(num(+String(o.amount ?? 50000).replace(/[^\d.]/g, ''), 50000));
    const digits = String(Math.round(amt));
    const toN = o.to || L('李先生', 'Mr. Lee');
    h('div', 'to', `<div class="cs-av" style="width:58px;height:58px;font-size:28px;border-radius:15px;background:${AVC[hashS(toN) % AVC.length]}">${esc(initial(toN))}</div><div>${L('转账给', 'To')} <b style="color:#1B2232">${esc(toN)}</b></div>`, sc);
    const box = h('div', 'box', `<div class="lb"></div><div class="am"></div><div class="nt"></div>`, sc);
    lab(box.querySelector('.lb'), L('转账金额', 'Amount'), { size: 15 });
    lab(box.querySelector('.nt'), o.note || L('添加备注', 'Add a note'), { size: 15, maxW: 300 });
    const am = box.querySelector('.am');
    const go = h('div', 'go', esc(L('确认转账', 'Send')), sc);
    const keys = h('div', 'keys', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<div>${k}</div>`).join(''), sc);
    const kel = [...keys.children];
    const t0 = P.at + 0.6, per = 0.22, conf = o.confirm != null ? num(o.confirm, 1e9) : 1e9, done = o.done != null ? num(o.done, 1e9) : 1e9;
    const tap = h('div', null, null, sc); Object.assign(tap.style, { position: 'absolute', left: P.sw / 2 - 30 + 'px', top: '417px', width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(27,34,50,0.3)', border: '3px solid rgba(255,255,255,0.8)', pointerEvents: 'none' });
    const ok = h('div', 'ok', `${ic.shield('#1FB25A', 88)}<div class="tt">${esc(L('转账成功', 'Transfer sent'))}</div><div class="am">${esc(cur)}${Math.round(amt).toLocaleString('en-US')}</div>`, sc);
    this.tick((lt) => {
      const n = clamp(Math.floor((lt - t0) / per) + 1, 0, digits.length);
      const shown = n ? Number(digits.slice(0, n)).toLocaleString('en-US') : '';
      html(am, `${esc(cur)} ${shown}${n < digits.length && lt >= P.at ? '<span style="display:inline-block;width:3px;height:42px;background:#1FB25A;vertical-align:-6px"></span>' : ''}`);
      const ki = lt >= t0 && n > 0 && lt - (t0 + (n - 1) * per) < 0.12 ? digits[n - 1] : null;
      kel.forEach((k) => k.classList.toggle('on', k.textContent === ki));
      const p = (lt - conf) / 0.6;
      set(tap, 'opacity', p > -0.3 && p < 1 ? (p < 0 ? 1 + p / 0.3 : 1 - p).toFixed(3) : '0'); set(tap, 'transform', `scale(${(p > 0 && p < 0.25 ? 0.85 : 1 + Math.max(0, p - 0.25) * 0.6).toFixed(3)})`);
      set(go, 'background', lt >= conf ? '#178C47' : '#1FB25A');
      set(ok, 'opacity', fin(lt, done, 0.35).toFixed(3)); set(ok, 'display', lt >= done ? 'flex' : 'none');
    });
    return { el: P.root, phone: P, spot: (k) => () => (k === 'amount' ? P.toStage(P.sw / 2, 310) : P.toStage(P.sw / 2, 447)) };
  };

  // ── P.feed: a social feed ──
  /** feed(x, y, { title, posts: [{ name, text, at, image, time, likes, shares, comments, grow, flag }], at, tilt, warn }):
   *  a social feed at stage centre (x, y); posts arrive one by one (the feed scrolls on), each with avatar, name, text (≤ 50 汉字 /
   *  30 words), an optional picture (image: a scene name as in chat), and like / comment / share counts. likes, shares, comments:
   *  a number, or [from, to] to count up over grow: [t0, t1] (default the 4 s after the post lands) — how a post goes viral.
   *  flag: { at, text, tone: 'orange'|'red'|'green'|'blue' } stamps a fact-check line under a post (e.g. '此内容已被辟谣'). */
  B.feed = function (x, y, o = {}) {
    const P = phone(this, x, y, o, 'feed');
    header(P, o.title || L('动态', 'Feed'), null, { back: false });
    const tab = h('div', 'cs-input', ['M5 11 L14 4 L23 11 V23 H5 Z', 'M13 5 A8 8 0 1 0 13.01 5 M19 19 L24 24', 'M14 6 V22 M6 14 H22', 'M14 13 A5 5 0 1 0 14.01 13 M5 25 Q14 15 23 25'].map((d) => `<div style="flex:1;display:flex;justify-content:center"><svg viewBox="0 0 28 28" width="28" height="28"><path d="${d}" fill="none" stroke="#4B566B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`).join(''), P.content);
    tab.style.gap = '0';
    const viewH = P.sh - 116 - 90;
    const view = h('div', 'cs-view', null, P.content); Object.assign(view.style, { top: '116px', height: viewH + 'px', background: '#EEF0F4' });
    const posts = (o.posts || []).filter(Boolean).map((p, i) => ({ ...p, at: num(p.at, P.at + 0.4 + i * 2) }));
    const rows = posts.map((p, i) => {
      const nm = p.name || L('网友', 'user');
      const el = h('div', 'cs-post', `<div class="hd"><div class="cs-av" style="background:${col(p.color) || AVC[hashS(nm) % AVC.length]}">${esc(p.avatar ?? initial(nm))}</div><div class="who"><div class="nm">${esc(nm)}</div></div></div><div class="bd">${rich(p.text)}</div>${p.image ? `<div class="pic">${scene(p.image, 326, 170, i + 11)}</div>` : ''}<div class="ac"><span>${ic.heart('#E5484D', 20)}</span><span>${ic.comment('#6B7487', 20)}</span><span>${ic.share('#6B7487', 20)}</span></div>${p.flag ? `<div class="fl ${p.flag.tone || 'orange'}">${ic.warn(({ red: '#C42A30', green: '#12783C', blue: '#1E5CC8' })[p.flag.tone] || '#A35C00', 22)}<span>${esc(p.flag.text || L('此内容已被辟谣', 'Fact-checked: false'))}</span></div>` : ''}`, view);
      lab(el.querySelector('.who'), p.time || L('刚刚', 'just now'), { size: 14 });
      const spans = el.querySelectorAll('.ac span');
      const cl = [...spans].map((sp) => lab(sp, '0', { size: 16, weight: 600, color: '#4B566B' }));
      const fl = el.querySelector('.fl');
      const flH = fl ? fl.offsetHeight + 9 : 0;
      const H0 = (el.offsetHeight || 200) - flH, flAt = p.flag ? num(p.flag.at, p.at + 3) : 1e9;
      const r = { el, H: H0 + flH, t0: p.at };
      r.hf = (lt) => (lt < p.at ? 0 : (H0 + 10) * fin(lt, p.at, 0.35) + flH * fin(lt, flAt, 0.3));
      const [g0, g1] = Array.isArray(p.grow) ? p.grow.map((v) => num(v, p.at)) : [p.at + 0.4, p.at + 4.4];
      const cnt = [range(p.likes ?? [0, 12]), range(p.comments ?? [0, 3]), range(p.shares ?? [0, 1])];
      r.draw = (lt) => {
        set(el, 'opacity', fin(lt, p.at, 0.3).toFixed(3));
        const k = ease.inOut(clamp((lt - g0) / Math.max(0.1, g1 - g0)));
        cnt.forEach((c, j) => cl[j].put(fmtN(lerp(c[0], c[1], Math.pow(k, 1.6)))));
        if (fl) { const [s1, o1] = pop2(lt, flAt, 0.4, 0.8); set(fl, 'opacity', o1.toFixed(3)); set(fl, 'transform', `scale(${s1.toFixed(3)})`); }
      };
      return r;
    });
    const layout = stacker(this, view, viewH, rows, 0, 0);
    this.tick((lt) => rows.forEach((r) => r.draw(lt)));
    return { el: P.root, phone: P, spot: (i) => (lt) => { const { ys, scroll } = layout(lt); i = clamp(i, 0, rows.length - 1); return P.toStage(P.sw / 2, 116 + ys[i] - scroll + 90, lt); } };
  };

  // ── P.search ──
  /** search(x, y, { query, typeAt, cps=6, suggest: [...], pick, pickAt, hot: [...], rise: { from, at }, at, tilt, warn }):
   *  a search screen at stage centre (x, y). hot: a trending list (up to 8 lines, ≤ 10 汉字 each) shown first; rise: { from: index,
   *  at } makes that line climb to #1 (a rumour going viral). query: typed into the box from typeAt (default at + 0.8) at cps
   *  characters a second; then the hot list gives way to suggest (up to 7 completions, the typed part in bold); pick: index
   *  highlighted at pickAt. */
  B.search = function (x, y, o = {}) {
    const P = phone(this, x, y, o, 'search');
    const sc = h('div', null, null, P.content); Object.assign(sc.style, { position: 'absolute', inset: '0', background: '#fff' });
    const bar = h('div', 'cs-sbar', `${ic.search('#8B95A8', 22)}<div class="q"></div>`, sc);
    const q = bar.querySelector('.q');
    const query = [...String(o.query || '')], typeAt = num(o.typeAt, P.at + 0.8), cps = clamp(num(o.cps, 6), 2, 20);
    const tEnd = typeAt + query.length / cps;
    const hot = (o.hot || []).slice(0, 8), rise = o.rise && hot.length ? { from: clamp(Math.round(num(o.rise.from, hot.length - 1)), 0, hot.length - 1), at: num(o.rise.at, P.at + 2) } : null;
    const hotT = hot.length ? h('div', 'cs-hott', esc(L('热搜榜', 'Trending')), sc) : null;
    const hrows = hot.map((t, i) => {
      const el = h('div', 'cs-hot', `<span class="n"></span><span class="x">${esc(t)}</span>`, sc);
      if (rise && i === rise.from) lab(el, L('爆', 'HOT'), { size: 14, weight: 800, color: '#FFFFFF', bg: '#E5484D', radius: 5, pad: 5 });
      else if (i === 1) lab(el, L('新', 'NEW'), { size: 14, weight: 800, color: '#FFFFFF', bg: '#F59A0B', radius: 5, pad: 5 });
      return { el, n: el.querySelector('.n'), i };
    });
    const qs = query.join('');
    const sug = (o.suggest || o.suggestions || []).slice(0, 7).map((t, i) => {
      const s0 = String(t), bold = qs && s0.startsWith(qs) ? `<b>${esc(qs)}</b>${esc(s0.slice(qs.length))}` : esc(s0);
      const el = h('div', 'cs-sug', `${ic.search('#A3ABBB', 20)}<span>${bold}</span>`, sc);
      el.style.top = 128 + i * 58 + 'px';
      return el;
    });
    const pick = o.pick != null && sug.length ? clamp(Math.round(num(o.pick, 0)), 0, sug.length - 1) : null, pickAt = num(o.pickAt, tEnd + 1.2);
    this.tick((lt) => {
      const n = query.length ? clamp(Math.floor((lt - typeAt) * cps + 1), 0, query.length) : 0;
      const blink = Math.floor(lt * 2.2) % 2 === 0 || (lt >= typeAt && lt < tEnd);
      html(q, (n ? `<span>${esc(query.slice(0, n).join(''))}</span>` : `<span style="color:#A3ABBB">${esc(L('搜索', 'Search'))}</span>`) + (blink ? '<span class="cur"></span>' : ''));
      const hk = sug.length && query.length ? 1 - fin(lt, tEnd, 0.3) : 1;
      if (hotT) set(hotT, 'opacity', hk.toFixed(3));
      const rk = rise ? ease.inOut(clamp((lt - rise.at) / 0.7)) : 0;
      hrows.forEach((r) => {
        let pos = r.i;
        if (rise) { if (r.i === rise.from) pos = lerp(r.i, 0, rk); else if (r.i < rise.from) pos = r.i + rk; }
        const rank = rise ? (r.i === rise.from ? (rk > 0.5 ? 0 : r.i) : r.i < rise.from && rk > 0.5 ? r.i + 1 : r.i) : r.i;
        set(r.el, 'top', (172 + pos * 56).toFixed(1) + 'px');
        set(r.el, 'opacity', (hk * fin(lt, P.at + 0.3 + r.i * 0.08, 0.3)).toFixed(3));
        set(r.el, 'zIndex', rise && r.i === rise.from ? '2' : '1');
        set(r.el, 'background', rise && r.i === rise.from && rk > 0 ? '#FFF1F0' : '#fff');
        html(r.n, String(rank + 1)); r.n.classList.toggle('top', rank < 3);
      });
      sug.forEach((el, i) => {
        const k = fin(lt, tEnd + i * 0.07, 0.25);
        set(el, 'opacity', k.toFixed(3)); set(el, 'transform', `translateY(${((1 - k) * -10).toFixed(1)}px)`);
        el.classList.toggle('pick', pick === i && lt >= pickAt);
      });
    });
    return { el: P.root, phone: P, spot: (i) => () => (i == null ? P.toStage(P.sw / 2, 88) : P.toStage(P.sw / 2, sug.length ? 157 + i * 58 : 200 + i * 56)) };
  };

  // ── P.inbox: the chat list ──
  /** inbox(x, y, { title, chats: [{ name, text, time, unread, at, mute }], at, tilt, warn }): the chat list at stage centre (x, y) —
   *  a row per conversation (avatar, name, last message, time, red unread badge); about 6 rows fit. A chat whose `at` is later than
   *  the phone's arrives on top and pushes the others down; unread: a number, or [from, to] counting up over the 3 s after its at
   *  (99+ cap). For notification overload, the 30 work groups, the friend who went quiet. */
  B.inbox = function (x, y, o = {}) {
    const P = phone(this, x, y, o, 'inbox');
    header(P, o.title || L('消息', 'Chats'), null, { back: false });
    const viewH = P.sh - 116 - 30;
    const view = h('div', 'cs-view', null, P.content); Object.assign(view.style, { top: '116px', height: viewH + 'px', background: '#fff' });
    const chats = (o.chats || []).filter(Boolean).map((c, i) => ({ ...c, at: num(c.at, P.at + 0.2 + i * 0.06) }));
    const rows = chats.map((c) => {
      const nm = c.name || '?';
      const el = h('div', 'cs-ib', `<div class="cs-av" style="background:${col(c.color) || AVC[hashS(nm) % AVC.length]}">${esc(c.avatar ?? initial(nm))}</div><div class="md"><div class="nm">${esc(nm)}</div></div><div class="rt"></div>`, view);
      lab(el.querySelector('.md'), plain(c.text || ''), { size: 16, maxW: 200 });
      const rt = el.querySelector('.rt');
      lab(rt, c.time || '', { size: 13, color: '#A3ABBB' });
      const ur = lab(rt, '', { size: 14, weight: 700, color: '#FFFFFF', bg: c.mute ? '#C3C9D4' : '#E5484D', pad: 6 });
      return { c, el, ur, u: range(c.unread ?? 0) };
    });
    this.tick((lt) => {
      const live = rows.filter((r) => lt >= r.c.at).sort((a, b) => b.c.at - a.c.at);
      let y0 = 0;
      for (const r of rows) if (lt < r.c.at) set(r.el, 'display', 'none');
      for (const r of live) {
        const k = fin(lt, r.c.at, 0.35);
        set(r.el, 'display', 'flex'); set(r.el, 'top', (y0 - (1 - k) * 30).toFixed(1) + 'px'); set(r.el, 'opacity', k.toFixed(3));
        y0 += 92 * k;
        const u = Math.round(lerp(r.u[0], r.u[1], ease.inOut(clamp((lt - r.c.at) / 3))));
        r.ur.put(u > 99 ? '99+' : String(u)); set(r.ur, 'visibility', u > 0 ? 'visible' : 'hidden');
      }
    });
    return { el: P.root, phone: P, spot: (i) => () => P.toStage(P.sw / 2, 162 + clamp(i, 0, 8) * 92) };
  };

  // ── on the ground: notes, numbers, tags, taps ──
  /** note(x, y, text, { to, at, out, color='green', w=440, size=34, kicker }): the explainer's card on the ground beside the phone,
   *  centred on (x, y): white, a coloured edge, one or two short lines (≤ 24 汉字 / 14 words; **bold** takes the colour). to: [x, y]
   *  or a chat's spot(i) — a dotted leader line runs into that bubble. kicker: a small coloured label above ('套路 1', 'STEP 2'). */
  B.note = function (x, y, text, o = {}) {
    if (text && typeof text === 'object' && !Array.isArray(text)) { o = text; text = o.text; }
    const at = num(o.at, 0.5), size = clamp(num(o.size, 34), 26, 60), acc = col(o.color || 'green');
    const el = h('div', 'cs-gnote', `${o.kicker ? `<span class="k" style="font-size:${Math.max(26, Math.round(size * 0.66))}px">${esc(o.kicker)}</span>` : ''}${rich(text)}`, this.html);
    el.style.setProperty('--acc', acc);
    Object.assign(el.style, { fontSize: size + 'px', maxWidth: clamp(num(o.w, 440), 240, 900) + 'px' });
    const w = el.offsetWidth || 400, hh = el.offsetHeight || 90;
    const left = clamp(num(x, 1400) - w / 2, 60, W - 60 - w), top = clamp(num(y, 400) - hh / 2, SA.y0 - 40, SA.y1 + 5 - hh);
    Object.assign(el.style, { left: left + 'px', top: top + 'px' });
    marker(el, w, hh);
    if (o.to) {
      const Ls = lines(this), path = PV.s('path', { fill: 'none', stroke: acc, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '1 10' }, Ls.svg);
      const dot = PV.s('circle', { r: 9, fill: acc, stroke: '#fff', 'stroke-width': 3 }, Ls.svg);
      Ls.list.push((lt) => {
        const tgt = where(o.to, lt);
        const k = fin(lt, at + 0.15, 0.4) * outK(lt, o.out) * (tgt ? 1 : 0);
        if (k <= 0) { path.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); return; }
        const [tx, ty] = tgt;
        const cx = left + w / 2, cy = top + hh / 2;
        const sx = tx < left ? left : tx > left + w ? left + w : cx, sy = tx >= left && tx <= left + w ? (ty < cy ? top : top + hh) : cy;
        const ex = lerp(sx, tx, k), ey = lerp(sy, ty, k);
        path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${((sx + ex) / 2).toFixed(1)} ${(Math.min(sy, ey) - 30).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
        path.setAttribute('opacity', k.toFixed(3)); dot.setAttribute('cx', ex.toFixed(1)); dot.setAttribute('cy', ey.toFixed(1)); dot.setAttribute('opacity', k >= 1 ? '1' : '0');
      });
    }
    this.tick((lt) => {
      const [sc, op] = pop2(lt, at, 0.4, 0.8), ko = outK(lt, o.out);
      set(el, 'opacity', (op * ko).toFixed(3));
      set(el, 'transform', `scale(${sc.toFixed(3)})`);
    });
    return { el, box: [left, top, w, hh] };
  };

  /** big(x, y, text, { at, out, color='ink', size=120, count: [from, to], dur=1.2, fmt, unit, sub, align='c', w=1500 }): a huge bold
   *  line on the ground centred on (x, y): the number that matters ('¥38万', '72%', '3 秒') or a two-to-six-word verdict. count:
   *  counts from → to over dur, landing at at + dur (start it so it lands on the spoken word); unit: a smaller suffix; sub: a
   *  small line under it. Shrinks itself to fit w. */
  B.big = function (x, y, text, o = {}) {
    if (text && typeof text === 'object') { o = text; text = o.text; }
    const at = num(o.at, 0.3), maxW = clamp(num(o.w, 1500), 300, Math.min(1700, W - 120)), cnt = o.count ? range(o.count) : null, dur = num(o.dur, 1.2);
    let size = clamp(num(o.size, 120), 56, 260);
    const el = h('div', 'cs-big', null, this.html);
    Object.assign(el.style, { color: col(o.color || 'ink'), fontSize: size + 'px' });
    const fmt = o.fmt || ((v) => Math.round(v).toLocaleString('en-US'));
    const content = (v) => `${cnt ? esc(fmt(v)) : rich(text)}${o.unit ? `<span class="un">${esc(o.unit)}</span>` : ''}${o.sub ? `<span class="sub" style="font-size:${Math.max(26, Math.round(size * 0.26))}px">${rich(o.sub)}</span>` : ''}`;
    el.innerHTML = content(cnt ? cnt[1] : 0);
    let w = el.offsetWidth || 400;
    if (w > maxW) { size = Math.max(56, Math.floor(size * maxW / w)); el.style.fontSize = size + 'px'; el.innerHTML = content(cnt ? cnt[1] : 0); w = el.offsetWidth || maxW; }
    const hh = el.offsetHeight || size;
    const al = o.align || 'c';
    const left = clamp(al === 'l' ? num(x, 200) : al === 'r' ? num(x, 1700) - w : num(x, W / 2) - w / 2, 60, W - 60 - w), top = clamp(num(y, 500) - hh / 2, SA.y0 - 40, SA.y1 + 5 - hh);
    Object.assign(el.style, { left: left + 'px', top: top + 'px', minWidth: w + 'px', textAlign: al === 'r' ? 'right' : al === 'l' ? 'left' : 'center' });
    const mk = marker(el, w, hh);
    this.tick((lt) => {
      const [sc, op] = pop2(lt, at, 0.42, 0.75), ko = outK(lt, o.out);
      if (cnt) { html(el, content(lerp(cnt[0], cnt[1], ease.out(clamp((lt - at) / dur))))); el.appendChild(mk); }
      set(el, 'opacity', (op * ko).toFixed(3));
      set(el, 'transform', `scale(${sc.toFixed(3)})`);
    });
    return { el };
  };

  /** tag(x, y, text, { at, out, color='red', icon='warn', size=32, light, rot }): a bold pill with an icon, centred on (x, y) — a
   *  verdict or a label on the ground ('诈骗', 'Rumour', '已读不回', 'Safe'), ≤ 8 汉字 / 4 words. icon: 'warn' | 'bang' | 'check' |
   *  'cross' | 'shield' | 'lock' | 'clock' | 'eye' | 'heart' | 'flag' | 'bell' | 'chat' | 'search' | 'none'. light: pale fill. */
  B.tag = function (x, y, text, o = {}) {
    const at = num(o.at, 0.3), size = clamp(num(o.size, 32), 26, 72), c = col(o.color || 'red'), light = !!o.light;
    const iconF = ICONS[o.icon ?? 'warn'];
    const el = h('div', 'cs-tag', `${iconF ? iconF(light ? c : '#fff', Math.round(size * 1.05)) : ''}<span>${esc(text)}</span>`, this.html);
    Object.assign(el.style, { fontSize: size + 'px', padding: `${size * 0.4}px ${size * 0.7}px ${size * 0.42}px ${iconF ? size * 0.5 : size * 0.7}px`, background: light ? PV.C[(o.color || 'red') + 'F'] || '#FFFFFF' : c, color: light ? c : '#fff' });
    const w = el.offsetWidth || 200, hh = el.offsetHeight || 60;
    const left = clamp(num(x, W / 2) - w / 2, 60, W - 60 - w), top = clamp(num(y, 500) - hh / 2, SA.y0 - 50, SA.y1 + 10 - hh);
    Object.assign(el.style, { left: left + 'px', top: top + 'px' });
    marker(el, w, hh);
    this.tick((lt) => {
      const [sc, op] = pop2(lt, at, 0.4, 0.5), ko = outK(lt, o.out);
      set(el, 'opacity', (op * ko).toFixed(3));
      set(el, 'transform', `scale(${sc.toFixed(3)}) rotate(${num(o.rot, 0)}deg)`);
    });
    return { el };
  };

  /** tap(x, y, { at, n=1, to }): a fingertip tap — a grey dot and a ripple at (x, y) (or at a spot: to: chat.spot(i), pay's
   *  spot('go')) at `at`; n taps 0.35 s apart. The link that should not be opened, the button that should not be pressed. */
  B.tap = function (x, y, o = {}) {
    if (x && typeof x === 'object' && !Array.isArray(x)) { o = x; x = null; }
    const at = num(o.at, 1), n = clamp(Math.round(num(o.n, 1)), 1, 4);
    const el = h('div', 'cs-tap', '<i></i><i></i>', this.html);
    const [dot, rip] = el.children;
    Object.assign(dot.style, { width: '56px', height: '56px', left: '-28px', top: '-28px', background: 'rgba(27,34,50,0.32)', border: '3px solid rgba(255,255,255,0.85)' });
    Object.assign(rip.style, { width: '56px', height: '56px', left: '-28px', top: '-28px', border: '3px solid rgba(27,34,50,0.35)' });
    this.tick((lt) => {
      const q = o.to ? where(o.to, lt) : [num(x, W / 2), num(y, H / 2)];
      if (!q) { set(el, 'display', 'none'); return; }
      set(el, 'display', 'block');
      const [px, py] = q;
      set(el, 'left', px.toFixed(1) + 'px'); set(el, 'top', py.toFixed(1) + 'px');
      let a = 0, rp = -1;
      for (let i = 0; i < n; i++) { const p = (lt - at - i * 0.35) / 0.6; if (p > -0.4 && p < 1) { a = Math.max(a, p < 0 ? 1 + p / 0.4 : 1 - p); rp = p; } }
      set(dot, 'opacity', clamp(a).toFixed(3)); set(dot, 'transform', `scale(${(rp >= 0 && rp < 0.25 ? 0.85 : 1).toFixed(2)})`);
      set(rip, 'opacity', rp > 0 ? (1 - rp).toFixed(3) : '0'); set(rip, 'transform', `scale(${(1 + Math.max(0, rp) * 1.6).toFixed(3)})`);
    });
    return { el };
  };

  // the page title: a small chat-bubble mark and bold UI type, top left (on the hud, never moved by the camera)
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = num(o.at, 0.15), size = clamp(num(o.size, 40), 30, 56);
    const el = h('div', 'cs-title', `${ic.bubble(col(o.accent || 'green'), Math.round(size * 1.1))}<span>${esc(String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, ''))}</span>`, T.html);
    el.style.fontSize = size + 'px';
    T.tick((lt) => { const k = fin(lt, at, 0.45); set(el, 'opacity', k.toFixed(3)); let dk = false;
      for (const [ga, gd, ge] of this.sh.csGrounds || []) {   // the topmost ground that is showing (its layer may be faded by the page)
        let op = 1; for (let n = ge; n && !n.classList.contains('page'); n = n.parentElement) { const v = n.style.opacity; if (v !== '') op *= +v; }
        if (lt >= ga - 0.1 && op > 0.5) dk = gd;
      } set(el, 'color', dk ? '#F4F6FA' : '#1B2232'); set(el, 'transform', `translateY(${((1 - k) * 12).toFixed(1)}px)`); });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // plain text fades in as a block (no handwriting pen) unless a page asks for another mode
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.4 }, o, { pen: false })); };
})();
