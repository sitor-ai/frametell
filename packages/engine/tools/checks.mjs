// A page's checks on an open stage (lib.mjs openStage), shared by lint.mjs, snap.mjs and check.mjs so one browser can
// run them all: the layout lint, and a contact sheet of stills.
//
// Every lint finding carries a `kind` and a `level`. 'error' is plainly wrong on screen or in the code: a page is not
// done while one is there. 'warn' is advice (a sparse or wordy page, small text, text that touches): some styles mean
// it, and the pictures decide. Callers branch on these fields, never on the wording of `msg`, which is for the reader;
// `data` holds what the message quotes (a share, a piece of text, a size), for whoever words it in another language.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { EP, PORTRAIT, PAGES_DIR, STAGE } from './lib.mjs';
import { FFMPEG } from './bins.mjs';

/** text boxes overlapping by at least this much of the smaller one hide each other: an error, not a touch */
const OVERLAP_ERROR = 0.5;

/**
 * Layout pre-check (no model): samples each page every `step` seconds and reports visible text that runs off the canvas
 * or safe area, sits in the subtitle band, overlaps other text, or renders too small to read. Per page it also checks
 * the settled state (body fills the content area, text doesn't dominate) and, with `determinism`, that a frame renders
 * identically whether reached from the start or from elsewhere on the timeline.
 * → [{ page, t, t1, local, kind, level, msg, data }], repeats of one finding on a page collapsed into a time range.
 */
export async function lintPages(page, { L, pages, step = 0.5, minFont = 24, determinism = false }) {
  const issues = [];
  const add = (p, t, kind, level, msg, data = {}) => issues.push({ page: p.id, t: +t.toFixed(1), local: +(t - p.start).toFixed(1), kind, level, msg, data });
  // how much of a page is on screen at time t: visible strokes, text, images (the page's own elements only)
  const inkAt = (id, t) => page.evaluate(({ id, t }) => {
    ENGINE.renderAt(t);
    const root = document.querySelector(`#stage .page[data-page="${id}"]`);
    if (!root) return -1;
    const op = (n) => { let o = 1; for (; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
    let n = 0;
    for (const el of root.querySelectorAll('path, line, rect, circle, ellipse, polyline, polygon, img, canvas, .tx')) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 4 || op(el) < 0.3) continue;
      if (el.classList.contains('tx') && ![...el.querySelectorAll('.ch')].concat(el.querySelector('.ch') ? [] : [el]).some((c) => op(c) >= 0.3 && c.textContent.trim())) continue;
      n++;
    }
    return n;
  }, { id, t });
  // before any frame is drawn: every P.x( / PV.x( a page calls must exist on the live engine, and be a function when it is
  // called — a wrong guess at the API is caught here with the right name, instead of as a crash somewhere mid-page
  const apiIssues = await page.evaluate((ids) => {
    const out = [];
    const inst = ENGINE.pages.find((x) => x.B)?.B;
    const names = (o) => { const n = new Set(); for (let x = o; x && x !== Object.prototype; x = Object.getPrototypeOf(x)) for (const k of Object.getOwnPropertyNames(x)) n.add(k); return [...n]; };
    const pNames = inst ? names(inst) : [], pvNames = Object.keys(window.PV || {});
    const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return d[a.length][b.length]; };
    const near = (n, list) => list.map((k) => [k, dist(n, k)]).filter(([, d]) => d <= Math.max(2, n.length / 3)).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => k);
    for (const id of ids) {
      const src = ENGINE.source(id);
      if (!src || !inst) continue;
      const P = /^\s*(?:function\s*\w*\s*)?\(?\s*(\w+)/.exec(src)?.[1] || 'P';
      const line = (i) => src.slice(0, i).split('\n').length;
      const seen = new Set();
      for (const m of src.matchAll(new RegExp(`\\b(${P}|PV)\\.(\\w+)\\s*(\\()?`, 'g'))) {
        const [, obj, name, call] = m, key = obj + name + !!call;
        if (seen.has(key)) continue; seen.add(key);
        const isP = obj !== 'PV', target = isP ? inst : window.PV, has = name in target;
        const label = `${isP ? 'P' : 'PV'}.${name}`;
        if (!has) {
          const hint = [...near(name, isP ? pNames : pvNames).map((k) => `${isP ? 'P' : 'PV'}.${k}`), ...((isP ? pvNames : pNames).includes(name) ? [`${isP ? 'PV' : 'P'}.${name}`] : [])];
          out.push({ page: id, line: line(m.index), name: label, msg: `unknown API: ${label} does not exist${hint.length ? ` — did you mean ${hint.join(' or ')}?` : ' — use only the components listed for this film'}` });
        } else if (call && typeof target[name] !== 'function') {
          const keys = target[name] && typeof target[name] === 'object' ? Object.keys(target[name]).slice(0, 6) : [];
          out.push({ page: id, line: line(m.index), name: label, msg: `wrong API use: ${label} is not a function${keys.length ? ` — it holds ${keys.map((k) => `${label}.${k}`).join(', ')}` : ''}` });
        }
      }
    }
    return out;
  }, pages.map((p) => p.id));
  // the visual's lines → the file's: the visual starts on the line that registers it
  const fileLine = (id, rel) => { try { const src = fs.readFileSync(path.join(EP, PAGES_DIR, id + '.js'), 'utf8'); const at = src.split('\n').findIndex((l) => /ENGINE\.visual\s*\(/.test(l)); return at >= 0 ? at + rel : rel; } catch { return rel; } };
  for (const a of apiIssues) { const p = pages.find((x) => x.id === a.page); add(p, p.start, 'api', 'error', `${a.msg} — at pages/${a.page}.js:${fileLine(a.page, a.line)}`, { name: a.name, line: fileLine(a.page, a.line) }); }

  for (const p of pages) {
    // page turns cross-fade: the incoming page must already show something, and the outgoing one must not have cleared
    // itself, or the viewer sees empty paper between pages
    const index = L.pages.indexOf(p);
    if (index > 0 && (await inkAt(p.id, p.start + (L.meta?.fadeDelay ?? 0.3) + 0.1)) === 0)
      add(p, p.start + 0.2, 'empty-opening', 'error', 'empty opening: nothing is on screen as the page turns in — draw the first beat\'s object before the first cue');
    if (index < L.pages.length - 1 && (await inkAt(p.id, p.end - 0.2)) === 0)
      add(p, p.end - 0.2, 'empty-ending', 'error', 'empty ending: the page has cleared itself before it turns out — keep the final state on screen');
    // settled state, just before the page turns: how much of the content area the drawing covers, and how much is text
    const settled = await page.evaluate(({ id, t, content, subs }) => {
      ENGINE.renderAt(t);
      const root = document.querySelector(`#stage .page[data-page="${id}"]`);
      const frame = document.getElementById('frame').getBoundingClientRect();
      const op = (n) => { let o = 1; for (; n && n !== root.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
      const A = { x0: content.x0, y0: content.y0 - 10, x1: content.x1, y1: subs };   // content area (below the page title, above the subtitles)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, textArea = 0;
      for (const el of root.querySelectorAll('path, rect, circle, ellipse, polygon, img, canvas, .tx')) {
        if (op(el) < 0.3) continue;
        const r = el.getBoundingClientRect();
        const b = { x0: Math.max(A.x0, r.left - frame.left), y0: Math.max(A.y0, r.top - frame.top), x1: Math.min(A.x1, r.right - frame.left), y1: Math.min(A.y1, r.bottom - frame.top) };
        if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 2) continue;
        if (b.x1 - b.x0 > 0.97 * (A.x1 - A.x0) && b.y1 - b.y0 > 0.97 * (A.y1 - A.y0)) continue;   // full-bleed backgrounds don't count as content
        x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
        if (el.classList.contains('tx')) textArea += (b.x1 - b.x0) * (b.y1 - b.y0);
      }
      const area = (A.x1 - A.x0) * (A.y1 - A.y0);
      return { cover: x1 > x0 ? ((x1 - x0) * (y1 - y0)) / area : 0, text: textArea / area };
    }, { id: p.id, t: p.end - 0.4, content: STAGE.area, subs: STAGE.subs });
    if (settled.cover < 0.45) add(p, p.end - 0.4, 'sparse', 'warn', `sparse page: the drawing spans ${Math.round(settled.cover * 100)}% of the content area (aim for most of x ${STAGE.area.x0}–${STAGE.area.x1}, y ${STAGE.area.y0}–${STAGE.area.y1})`, { percent: Math.round(settled.cover * 100) });
    // the style's own checks: its kit may set PV.lint(pageId) → [{ t (page time), kind, level, msg, data }] (doodle: a
    // drawing that starts away from the word that names it)
    const own = await page.evaluate((id) => { try { return typeof window.PV?.lint === 'function' ? window.PV.lint(id) || [] : []; } catch (e) { return [{ t: 0, kind: 'style', level: 'warn', msg: 'the style check failed: ' + e.message }]; } }, p.id);
    for (const s of own) add(p, p.start + (+s.t || 0), String(s.kind || 'style'), s.level === 'error' ? 'error' : 'warn', String(s.msg || ''), s.data || {});
    if (settled.text > 0.35) add(p, p.end - 0.4, 'text-heavy', 'warn', `text-dominated page: text covers ${Math.round(settled.text * 100)}% of the content area — let an object carry the idea, keep text to labels and numbers`, { percent: Math.round(settled.text * 100) });
    // determinism: the same moment, reached cold (from 0) and warm (from the page end), must be pixel-identical
    if (determinism) {
      const mid = (p.start + p.end) / 2;
      const shot = async (from) => { await page.evaluate(({ from, t }) => { ENGINE.renderAt(from); ENGINE.renderAt(t); }, { from, t: mid }); return page.screenshot({ type: 'png' }); };
      const a = await shot(0), b = await shot(p.end - 0.1);
      // GPU rasterization flips a handful of anti-aliased pixels between identical renders: compare with a tolerance
      const changed = a.equals(b) ? 0 : await page.evaluate(async ([x, y]) => {
        const load = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const [ia, ib] = await Promise.all([load(x), load(y)]);
        const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
        const da = px(ia), db = px(ib);
        let n = 0;
        for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 48) n++;
        return n / (da.length / 4);
      }, [a.toString('base64'), b.toString('base64')]);
      if (changed > 0.0005) add(p, mid, 'nondeterministic', 'error', `not deterministic: ${(changed * 100).toFixed(2)}% of this frame differs depending on where playback came from — something depends on state, Math.random, Date.now or a CSS transition`, { percent: +(changed * 100).toFixed(2) });
    }
    for (let t = p.start + 0.4; t < p.end - 0.15; t += step) {
      const found = await page.evaluate(({ t, minFont, overlapError, W, H, subs }) => {
        ENGINE.renderAt(t);
        const frame = document.getElementById('frame').getBoundingClientRect();
        const op = (n) => { let o = 1; for (; n && n.id !== 'frame'; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
        const out = [];
        const boxes = [];
        // .tx = one text element (P.text, P.follow, P.live…); handwritten text reveals per character (.ch spans)
        for (const el of document.querySelectorAll('#stage .tx')) {
          if (op(el) < 0.5) continue;
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, txt = '';
          const chs = el.querySelectorAll('.ch');
          const parts = chs.length ? [...chs].filter((ch) => op(ch) >= 0.5) : (el.textContent.trim() ? [el] : []);
          for (const ch of parts) {
            const r = ch.getBoundingClientRect(); if (!r.width) continue;
            x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); txt += ch.textContent;
          }
          if (x1 < 0) continue;
          // LaTeX or other markup written into plain text shows as code (\\lambda): characters, or P.tex for a formula
          const raw = el.closest('.katex') ? null : /\\[A-Za-z]{2,}/.exec(el.textContent);
          if (raw) out.push({ kind: 'raw-markup', level: 'error', msg: `raw markup on screen: "${raw[0]}" in "${el.textContent.trim().slice(0, 40)}" — write the character (λ, ≈, ², →) instead, or use P.tex for a formula`, data: { markup: raw[0], text: el.textContent.trim().slice(0, 40) } });
          boxes.push({ x0: x0 - frame.left, y0: y0 - frame.top, x1: x1 - frame.left, y1: y1 - frame.top, txt: txt.replace(/ /g, ' ').slice(0, 24) });
        }
        for (const b of boxes) {
          if (b.x0 < 40 || b.x1 > W - 40 || b.y0 < 30 || b.y1 > H - 20) out.push({ kind: 'off-canvas', level: 'error', msg: `off-canvas/edge: "${b.txt}" box ${b.x0|0},${b.y0|0}–${b.x1|0},${b.y1|0}`, data: { text: b.txt } });
          else if (b.y1 > subs + 5) out.push({ kind: 'subtitle-band', level: 'error', msg: `subtitle band (y>${subs + 5}): "${b.txt}" bottom ${b.y1|0}`, data: { text: b.txt } });
        }
        // Readability: every visible text node, at the size it actually renders (camera zoom and CSS transforms included).
        const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
        const small = new Map();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent.trim();
          const el = n.parentElement;
          if (!text || !el || op(el) < 0.5) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || r.right < frame.left || r.left > frame.right || r.bottom < frame.top || r.top > frame.bottom) continue;
          const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
          const px = parseFloat(getComputedStyle(el).fontSize) * scale;
          if (px < minFont) {
            const k = Math.floor(px);
            const owner = el.closest('.tx') || el;   // report the whole text, not one revealed character
            if (!small.has(k)) small.set(k, owner.textContent.trim().replace(/\s+/g, ' ').slice(0, 20));
          }
        }
        for (const [px, sample] of small) out.push({ kind: 'small-text', level: 'warn', msg: `small text (${px}px < ${minFont}px): "${sample}"`, data: { px, min: minFont, text: sample } });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (w <= 0 || h <= 0) continue;
          const share = w * h / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
          if (share > 0.15) out.push({ kind: 'overlap', level: share >= overlapError ? 'error' : 'warn', msg: `text overlap: "${a.txt}" × "${b.txt}" (${Math.round(100 * share)}% of the smaller)`, data: { a: a.txt, b: b.txt, percent: Math.round(100 * share) } });
        }
        return out;
      }, { t, minFont, overlapError: OVERLAP_ERROR, W: STAGE.w, H: STAGE.h, subs: STAGE.subs });
      for (const f of found) add(p, t, f.kind, f.level, f.msg, f.data);
    }
  }
  // a page whose code threw (loading, building or at some moment): the error first, with where it happened
  const thrown = await page.evaluate(() => ENGINE.errors);
  for (const x of thrown) {
    const p = pages.find((q) => q.id === x.page);
    if (!p) continue;
    issues.unshift({ page: x.page, t: x.t ?? +p.start.toFixed(1), local: x.local ?? 0, kind: 'runtime', level: 'error', msg: `runtime error (${x.phase}): ${x.message}${x.at.length ? ` — at ${x.at.join(', ')}` : ''}`, data: { phase: x.phase, message: x.message } });
  }
  // a colour named that the style's palette doesn't have: drawn as a stand-in (ink, or a mixed fill), never as meant
  const colors = await page.evaluate(() => ({ used: ENGINE.colors, palette: Object.keys(PV.C) }));
  for (const x of colors.used) {
    const p = pages.find((q) => q.id === x.page);
    if (!p) continue;
    for (const name of x.names) issues.unshift({ page: x.page, t: +p.start.toFixed(1), local: 0, kind: 'palette', level: 'error', msg: `unknown colour name "${name}": this style's palette has ${colors.palette.join(', ')}; use one of those names, or a #RRGGBB colour`, data: { name, palette: colors.palette.join(', ') } });
  }
  // collapse repeats of the same message on a page into one line with a time range
  const seen = new Map();
  for (const i of issues) { const k = i.page + '|' + i.msg; const s = seen.get(k); if (s) s.t1 = i.t; else seen.set(k, { ...i, t1: i.t }); }
  return [...seen.values()];
}

/**
 * Stills at `times` tiled into one contact sheet `file` (jpg, `cols` per row), each frame labelled with its time unless
 * `label` is false. `tile` is a frame's width in the sheet.
 */
export async function contactSheet(page, times, file, { tile = 640, label = true, cols = 3 } = {}) {
  const dir = path.dirname(file), name = path.basename(file, path.extname(file));
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const t of times) {
    await page.evaluate(async (x) => { ENGINE.renderAt(x); if (window.__frameReady) await window.__frameReady(x); }, t);
    if (label) await page.evaluate((x) => {
      const tag = document.getElementById('__t') || Object.assign(document.createElement('div'), { id: '__t' });
      Object.assign(tag.style, { position: 'absolute', left: '16px', bottom: '12px', zIndex: 99, font: '700 44px monospace', color: '#B2452F', background: '#fffc', padding: '2px 12px' });
      tag.textContent = x.toFixed(1) + 's';
      document.getElementById('frame').appendChild(tag);
    }, t);
    const f = path.join(dir, `.${name}-${String(shots.length).padStart(3, '0')}.png`);
    await page.screenshot({ path: f });
    shots.push(f);
  }
  // the time tag belongs to the sheet, not to whatever this stage draws next
  if (label) await page.evaluate(() => document.getElementById('__t')?.remove());
  try {
    const c = Math.min(cols, shots.length);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(dir, `.${name}-%03d.png`), '-vf', `scale=${PORTRAIT ? 270 : tile}:-1,tile=${c}x${Math.ceil(shots.length / c)}:padding=6:color=white`, '-frames:v', '1', file]);
  } finally {
    for (const f of shots) fs.rmSync(f, { force: true });
  }
  return file;
}

/** findings as a person reads them in a terminal */
export function printIssues(issues) {
  if (!issues.length) return console.log('lint: OK — no layout issues found');
  console.log(`lint: ${issues.length} issue(s)`);
  for (const s of issues) console.log(`  ${s.page} @ ${s.t}s${s.t1 !== s.t ? `–${s.t1}s` : ''} (local ${s.local}s) [${s.level}]: ${s.msg}`);
}
