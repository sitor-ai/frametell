/* Text + code primitives: handwritten text revealed char by char, and sketch-framed code cards. */
(function () {
  const { h, clamp, ease, col, Builder } = PV;

  const COLORS = { r: 'red', b: 'blue', g: 'green', o: 'orange', p: 'purple', m: 'muted', s: 'soft', k: 'ink' };

  /** Tiny markup: {r:colored}, `mono`, **bold**, \n. Returns [{text, color, mono, bold}]. */
  function parse(str, base = {}) {
    const out = [];
    let i = 0, buf = '';
    const flush = () => { if (buf) out.push(Object.assign({}, base, { text: buf })); buf = ''; };
    while (i < str.length) {
      const ch = str[i];
      if (ch === '{' && /^[a-z]:/.test(str.slice(i + 1, i + 3))) {
        let depth = 1, j = i + 3;
        while (j < str.length && depth) { if (str[j] === '{') depth++; else if (str[j] === '}') depth--; j++; }
        flush();
        out.push(...parse(str.slice(i + 3, j - 1), Object.assign({}, base, { color: COLORS[str[i + 1]] })));
        i = j; continue;
      }
      if (ch === '`' && str.indexOf('`', i + 1) > i) {
        const j = str.indexOf('`', i + 1);
        flush();
        out.push(Object.assign({}, base, { text: str.slice(i + 1, j), mono: true }));
        i = j + 1; continue;
      }
      if (str.startsWith('**', i) && str.indexOf('**', i + 2) > i) {
        const j = str.indexOf('**', i + 2);
        flush();
        out.push(...parse(str.slice(i + 2, j), Object.assign({}, base, { bold: true })));
        i = j + 2; continue;
      }
      buf += ch; i++;
    }
    flush();
    return out;
  }

  const CLOSE = /[，。、；：！？）》」』”’,.;:!?)\]…—%]/, OPEN = /[（《「『“‘(\[]/;
  function spansFor(el, segs) {
    const spans = [];
    for (const sg of segs) {
      let wrap = el;
      if (sg.color || sg.mono || sg.bold) {
        wrap = h('span', (sg.mono ? 'mono ' : '') + (sg.bold ? 'b' : ''), null, el);
        if (sg.color) wrap.style.color = col(sg.color);
      }
      // lines break only between units: a latin word with the spaces after it, a CJK character with the closing marks
      // after it (，。」…), an opening mark (「（“) with what follows — so English never splits inside a word, no line
      // starts with a space or a comma, and none ends on an opening quote
      let unit = null, open = false, word = false;
      for (const c of sg.text) {
        if (c === '\n') { h('br', '', null, wrap); unit = null; continue; }
        const latin = /[A-Za-z0-9'’.%$€£¥_-]/.test(c);
        const join = c === ' ' || CLOSE.test(c) || open || (latin && word);
        if (!unit || !join) unit = h('span', 'w', null, wrap);
        spans.push(h('span', 'ch', c === ' ' ? '&nbsp;' : c.replace('<', '&lt;'), unit));
        open = OPEN.test(c);
        word = latin;
      }
    }
    return spans;
  }

  /** Client-space point at the right edge of a span (pencil tip for text). */
  function spanTip(sp, k) {
    const r = sp.getBoundingClientRect();
    return { x: r.left + r.width * k, y: r.bottom - r.height * 0.18, client: true };
  }

  /**
   * text(str, { x, y, size, color, w, align, font, weight, at, cps, mode, lh, pen, rot })
   * mode: 'write' (char by char), 'fade' (whole block), 'words' (fast write, no pen)
   */
  Builder.prototype.text = function (str, o = {}) {
    const el = h('div', 'tx ' + (o.font || 'hand') + (o.cls ? ' ' + o.cls : ''), null, this.html);
    const size = o.size ?? 38;
    el.style.fontSize = size + 'px';
    el.style.lineHeight = String(o.lh ?? 1.45);
    if (o.color) el.style.color = col(o.color);
    if (o.weight) el.style.fontWeight = o.weight;
    const align = o.align || 'l';
    const w = o.w ?? (align === 'l' ? null : 1200);
    if (w) el.style.width = w + 'px';
    el.style.textAlign = { l: 'left', c: 'center', r: 'right' }[align];
    el.style.left = (align === 'c' ? o.x - w / 2 : align === 'r' ? o.x - w : o.x) + 'px';
    el.style.top = o.y + 'px';
    if (o.nowrap !== false && !o.w) el.style.whiteSpace = 'nowrap';
    if (o.rot) el.style.rotate = o.rot + 'deg';
    const spans = spansFor(el, o.raw ? [{ text: str }] : parse(str));
    const mode = o.mode || 'write';
    if (mode === 'fade') for (const sp of spans) sp.style.opacity = '1';
    const at = o.at ?? 0;
    const cps = o.cps ?? (mode === 'words' ? 34 : 15);
    const dur = mode === 'fade' ? (o.dur ?? 0.6) : Math.max(0.2, spans.length / cps);
    const state = { cur: null, k: 0 };
    const a = this.act({
      at, dur, g: el, kind: 'text', pen: mode === 'write' && o.pen !== false,
      apply: (k, lt, vis) => {
        el.style.opacity = vis.toFixed(3);
        if (mode === 'fade') {
          const e = ease.out(k);
          el.style.opacity = (e * vis).toFixed(3);
          el.style.transform = `translateY(${((1 - e) * 10).toFixed(1)}px)`;
          return;
        }
        const n = spans.length, pos = k * (n + 1.6);
        state.cur = null;
        for (let i = 0; i < n; i++) {
          const kk = clamp((pos - i) / 1.6);
          const sp = spans[i];
          const v = kk.toFixed(3);
          if (sp._v !== v) {
            sp._v = v;
            sp.style.opacity = v;
            sp.style.transform = kk >= 1 ? '' : `translateY(${((1 - kk) * 4).toFixed(1)}px)`;
          }
          if (!state.cur && kk < 1 && kk > 0) { state.cur = sp; state.k = kk; }
        }
      },
      tip: () => (state.cur ? spanTip(state.cur, state.k) : null),
    });
    const hnd = this.handle(a, el);
    hnd.spans = spans;
    hnd.box = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    return hnd;
  };

  /** Page title (top-left) with an accent squiggle underneath. */
  Builder.prototype.title = function (str, o = {}) {
    const at = o.at ?? 0.15;
    const T = this.hud || this;   // the page title lives on the hud: camera moves never cut it
    const { x, y } = STAGE.title || { x: 140, y: 78 };
    const t = T.text(str, { x, y, size: o.size ?? 56, weight: 700, at, cps: o.cps ?? 11, color: 'ink', ...(STAGE.portrait ? { w: STAGE.w - 2 * x } : {}) });
    const w = o.uw ?? Math.min(STAGE.portrait ? STAGE.w - 2 * x : 760, t.spans.length * (o.size ?? 56) * 0.78);
    T.underline(x + 2, y + 82, w, { color: o.accent || 'orange', at: at + t.a.dur * 0.8, dur: 0.6, sw: 3.4 });
    return t;
  };

  // ── code card ────────────────────────────────────────────
  const KW = /\b(const|let|await|async|function|while|if|for|of|break|return|import|from|true|new|yield)\b/g;
  function highlight(line) {
    // returns segments [{text, cls}]
    const cIdx = line.indexOf('//');
    const code = cIdx >= 0 ? line.slice(0, cIdx) : line;
    const comment = cIdx >= 0 ? line.slice(cIdx) : '';
    const segs = [];
    const re = /('[^']*'|`[^`]*`)|\b(const|let|await|async|function|while|if|for|of|break|return|import|from|true|new|yield)\b|(\b\d+\b)|([A-Za-z_]\w*)(?=\()/g;
    let last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) segs.push({ text: code.slice(last, m.index) });
      segs.push({ text: m[0], cls: m[1] ? 'str' : m[2] ? 'kw' : m[3] ? 'num' : 'fn' });
      last = m.index + m[0].length;
    }
    if (last < code.length) segs.push({ text: code.slice(last) });
    if (comment) segs.push({ text: comment, cls: 'cm' });
    return segs;
  }

  /**
   * code(lines, { x, y, w, size, at, cps, pad, lh, label })
   * Returns handle with .lineY(i), .lineX, .hl(i, at, color) and .lines (row elements).
   */
  Builder.prototype.code = function (lines, o = {}) {
    const size = o.size ?? 26, lh = o.lh ?? 1.55, pad = o.pad ?? 34;
    const rowH = size * lh;
    const hgt = lines.length * rowH + pad * 2;
    const w = o.w ?? 1100;
    const at = o.at ?? 0;
    this.box(o.x, o.y, w, hgt, { fill: 'paper', color: 'soft', sw: 2.2, r: 16, at, dur: 0.8, rough: 0.9 });
    const el = h('div', 'code', null, this.html);
    Object.assign(el.style, { left: o.x + pad + 'px', top: o.y + pad + 'px', fontSize: size + 'px', lineHeight: rowH + 'px', width: w - pad * 2 + 'px' });
    const rows = [], spans = [];
    for (const ln of lines) {
      const row = h('div', 'row', null, el);
      for (const sg of highlight(ln)) {
        const wrap = sg.cls ? h('span', sg.cls, null, row) : row;
        for (const c of sg.text) spans.push(h('span', 'ch', c === ' ' ? '&nbsp;' : c.replace('<', '&lt;'), wrap));
      }
      if (!ln) row.innerHTML = '&nbsp;';
      rows.push(row);
    }
    const cps = o.cps ?? 70;
    const tstart = at + 0.5;
    const dur = Math.max(0.3, spans.length / cps);
    const state = { cur: null };
    const a = this.act({
      at: tstart, dur, g: el, kind: 'text', pen: false,
      apply: (k, lt, vis) => {
        el.style.opacity = vis.toFixed(3);
        const pos = k * spans.length;
        state.cur = null;
        for (let i = 0; i < spans.length; i++) {
          const kk = clamp(pos - i);
          const v = kk > 0.5 ? '1' : '0';
          if (spans[i]._v !== v) { spans[i]._v = v; spans[i].style.opacity = v; }
          if (!state.cur && kk < 1 && kk > 0) state.cur = spans[i];
        }
      },
      tip: () => (state.cur ? spanTip(state.cur, 1) : null),
    });
    const self = this;
    const hnd = this.handle(a, el);
    Object.assign(hnd, {
      rows, rowH,
      lineY: (i) => o.y + pad + i * rowH,
      lineX: o.x + pad,
      /** Marker highlight across line i (optionally partial: from char c0 for n chars). */
      hl(i, t, opt = {}) {
        const cw = size * 0.6;
        const x0 = o.x + pad - 8 + (opt.c0 || 0) * cw;
        const ww = opt.n ? opt.n * cw + 16 : Math.max(120, lines[i].length * cw + 16);
        return self.mark(x0, o.y + pad + i * rowH + 3, ww, rowH - 6, { at: t, color: opt.color || 'yellow', opacity: opt.opacity ?? 0.42 });
      },
    });
    return hnd;
  };

  /** Page-space bounding box of spans [i0, i1] of a text handle (measured after fonts load). */
  Builder.prototype.span = function (hnd, i0 = 0, i1 = null, pad = 0) {
    const sp = hnd.spans;
    i1 = i1 == null ? sp.length - 1 : Math.min(i1, sp.length - 1);
    const base = this.host.getBoundingClientRect(), sc = base.width / STAGE.w;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = i0; i <= i1; i++) {
      const r = sp[i].getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    return { x: (x0 - base.left) / sc - pad, y: (y0 - base.top) / sc - pad, w: (x1 - x0) / sc + pad * 2, h: (y1 - y0) / sc + pad * 2,
      get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
  };
  /** Highlighter behind spans / ring around spans / underline under spans. */
  Builder.prototype.markSpan = function (hnd, i0, i1, o = {}) {
    const b = this.span(hnd, i0, i1);
    return this.mark(b.x - 6, b.y + b.h * 0.12, b.w + 12, b.h * 0.82, o);
  };
  Builder.prototype.ringSpan = function (hnd, i0, i1, o = {}) {
    const b = this.span(hnd, i0, i1);
    return this.ring(b.cx, b.cy, b.w + (o.px ?? 60), b.h + (o.py ?? 34), o);
  };
  Builder.prototype.underSpan = function (hnd, i0, i1, o = {}) {
    const b = this.span(hnd, i0, i1);
    return this.underline(b.x, b.y + b.h + (o.dy ?? 2), b.w, o);
  };
  PV.parse = parse;
})();
