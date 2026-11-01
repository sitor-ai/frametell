// The editor's runtime, inside the edit-mode preview (served as __edit.js before the engine boots). The editor sends it
// each page marked (packages/ui editor/editSource.ts, in the browser: the core never parses a film) and it runs them in
// place of the film's: before each top-level statement `__ED.at(P, i)`. What the editor picks, moves and types into is
// a thing: one call the page's code makes to the builder, numbered by the engine (data-item, runtime/engine.js), whose
// hand edits are the page's ENGINE.edits; a statement (what the DOM gains and the acts the builder takes between two
// marks) groups its things. It tells the editor what is where at a moment, runs a page again when its source changed,
// and shows a drag before it is saved. It never changes a film's files.
/* eslint-disable @typescript-eslint/no-explicit-any */

// the browser's, where the runtime runs (this package is built for node: its own globals stay node's)
declare const window: any, document: any, location: any, parent: any, getComputedStyle: any, requestAnimationFrame: any, addEventListener: any, removeEventListener: any;
declare const MutationObserver: any;
type Element = any;
type MutationObserver = any;

/** the runtime as it runs in the page: this function's own source, called at once */
export function editRuntime() {
  const W = window as any;
  interface Rec { i: number; nodes: Element[]; acts0: number; acts: any[] }
  /** a text the engine set (Builder.text, which every title, label and kit's words go through): its element, its
   *  statement, and once the page is built the thing it is part of (the engine's data-item), which of that thing's
   *  words it is (j, from 0: what an edit names) and the words it showed then (words that change as the film plays,
   *  a counter, are not typed over) */
  interface Tx { el: Element; i: number; n: number | null; j: number; built: string }
  interface PageState { P: any; obs: MutationObserver; recs: Map<number, Rec>; cur?: Rec; tx: Tx[] }
  const pages = new Map<string, PageState>();
  let building: PageState | undefined;
  const q = new URLSearchParams(location.search);

  const flush = (st: PageState) => {
    const cur = st.cur;
    if (!cur) return;
    for (const r of st.obs.takeRecords() as any[]) r.addedNodes.forEach((n: any) => { if (n.nodeType === 1) cur.nodes.push(n as Element); });
    cur.acts = st.P.sh.acts.slice(cur.acts0);
  };
  W.__ED = {
    at(P: any, i: number) {
      const id = P.page.id;
      let st = pages.get(id);
      // a new build of the page (the engine builds every page again on each init): its statements start over
      if (!st || st.P !== P) {
        st?.obs.disconnect();
        const root = P.host.parentElement as Element;
        const obs = new MutationObserver(() => {});
        obs.observe(root, { childList: true, subtree: true });
        st = { P, obs, recs: new Map(), tx: [] };
        pages.set(id, st);
      }
      hook();
      flush(st);
      st.cur = { i, nodes: [], acts0: P.sh.acts.length, acts: [] };
      st.recs.set(i, st.cur);
      building = st;
    },
    end(P: any) {
      const st = pages.get(P.page.id);
      if (!st) return;
      flush(st);
      st.cur = undefined;
      st.obs.disconnect();
      building = undefined;
      // each text's thing and its place among the thing's words, in the order they were set
      const count = new Map<number, number>();
      for (const t of st.tx) {
        const n = Number(t.el.closest('[data-item]')?.getAttribute('data-item'));
        t.n = Number.isInteger(n) && n > 0 ? n : null;
        if (t.n != null) { t.j = count.get(t.n) ?? 0; count.set(t.n, t.j + 1); }
        t.built = t.el.textContent ?? '';
      }
    },
    s(_k: number, v: string) { return v; },
  };

  // every text the engine sets, by the statement being built (the engine's PV is there once a page is built)
  let hooked = false;
  function hook() {
    if (hooked || !W.PV?.Builder) return;
    hooked = true;
    const text = W.PV.Builder.prototype.text;
    W.PV.Builder.prototype.text = function (this: any, ...args: unknown[]) {
      const out = text.apply(this, args);
      // the handle the engine gives back holds the element it made (a moved thing's is inside its group by now)
      const el = out?.el;
      if (building?.cur && el) building.tx.push({ el, i: building.cur.i, n: null, j: 0, built: '' });
      return out;
    };
  }

  // the editor draws its own controls: the player's bar and hint are hidden, the picture takes no clicks
  const css = document.createElement('style');
  // while words are typed, only the copy takes the pointer: the page's layers (each the stage's size, stacked over it)
  // would take a click meant to put the caret, and the words would close
  css.textContent = '#pv-bar, #pv-hint { display: none !important; } #viewport { cursor: default !important; }'
    // what is drawn is found by the browser where it is (edit:pick): the engine's layers of words take no pointer
    // in the film, here they do (nothing in the preview acts on a click; the overlay above takes them all)
    + ' #stage, #stage * { pointer-events: auto !important; }'
    + ' html.ed-typing #stage * { pointer-events: none !important; } html.ed-typing #stage .ed-copy { pointer-events: auto !important; cursor: text !important; }';
  document.head.appendChild(css);

  // the player's own controls are the editor's: a click on the picture (in a text being typed into, to put the caret)
  // or a key typed must not play, seek or go full screen. Caught on the way down, before the player's listeners; the
  // caret, the space and the letter still go where they would
  addEventListener('click', (e: any) => { if (e.target?.closest?.('#viewport')) e.stopPropagation(); }, true);
  // the player's keys (space: play, ←/→: five seconds, F: full screen) are the editor's too: in words being typed, the
  // arrows move the caret, never the film
  addEventListener('keydown', (e: any) => { if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyF'].includes(e.code)) e.stopPropagation(); }, true);

  const post = (m: Record<string, unknown>) => parent.postMessage(m, '*');
  const tNow = () => parseFloat(document.getElementById('pv-seek')?.value ?? '0') || 0;

  /** a page's things (the engine numbers what its code draws: data-item), each by its outermost elements: a moved
   *  thing's group, else what it drew; a thing deleted by hand (display: none) is not one any more */
  function itemsOf(id: string): Map<number, Element[]> {
    const out = new Map<number, Element[]>();
    const root = document.querySelector(`#stage > .page[data-page="${id}"]`);
    if (!root) return out;
    for (const e of root.querySelectorAll('[data-item]') as Element[]) {
      const n = Number(e.getAttribute('data-item'));
      if (e.parentElement?.closest(`[data-item="${n}"]`)) continue;
      if (!out.has(n)) out.set(n, []);
      out.get(n)!.push(e);
    }
    for (const [n, xs] of out) if (xs.every((e) => getComputedStyle(e).display === 'none')) out.delete(n);
    return out;
  }
  /** the statement whose run made a node (what the instrumented page marked), walking out from it */
  function stmtOf(st: PageState, e: Element): number {
    for (let x: Element | null = e; x; x = x.parentElement) for (const [i, r] of st.recs) if (r.nodes.includes(x)) return i;
    return -1;
  }
  /** what is drawn: a layer (a moved statement's, P.layer) and the stage-sized drawing surfaces in it are opened up */
  const drawn = (nodes: Element[], edited = true): Element[] => nodes.flatMap((n) => (n.classList?.contains('layer') || n.classList?.contains('ink') || n.classList?.contains('txt') || (edited && n.classList?.contains('edited')) ? drawn([...n.children], edited) : [n]));
  function stageBox(nodes: Element[]) {
    const frame = document.getElementById('frame');
    if (!frame) return undefined;
    const f = frame.getBoundingClientRect(), k = f.width / W.STAGE.w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (!Number.isFinite(x0)) return undefined;
    return { x: (x0 - f.left) / k, y: (y0 - f.top) / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
  }
  /** drawn at this moment, not only there: words with at least one letter written (the engine writes them letter by
   *  letter, each from nothing), lines with at least one stroke showing (a stroke not yet begun is hidden) */
  const SHAPES = 'path, line, rect, circle, ellipse, polygon, polyline, image, text, use';
  function inked(n: Element): boolean {
    if (!shown(n)) return false;
    const tx = n.classList?.contains('tx') ? [n] : [...(n.querySelectorAll?.('.tx') ?? [])];
    if (tx.length) return tx.some((t: Element) => { const sp = [...t.querySelectorAll('span')].filter((x: Element) => !x.querySelector('span')); return !sp.length || sp.some((x: Element) => parseFloat(getComputedStyle(x).opacity) > 0.02); });
    if (n.ownerSVGElement || n.tagName === 'svg') {
      const sh = n.matches(SHAPES) ? [n] : [...n.querySelectorAll(SHAPES)];
      return !sh.length || sh.some((x: Element) => getComputedStyle(x).visibility !== 'hidden');
    }
    return true;
  }
  const shown = (n: Element) => { for (let e: Element | null = n; e && e.id !== 'stage'; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 0.02) return false; return true; };

  function elements(t: number) {
    const pg = W.ENGINE?.layout?.pages?.find((p: any) => t >= p.start - 0.01 && t < p.end - 0.01) ?? W.ENGINE?.layout?.pages?.at(-1);
    if (!pg) return { page: null, elements: [] };
    const st = pages.get(pg.id);
    if (!st) return { page: pg.id, elements: [] };
    const list: any[] = [];
    scenes.clear();
    for (const [n, nodes] of [...itemsOf(pg.id)].sort((a, b) => a[0] - b[0])) {
      const box = stageBox(drawn(nodes));
      if (!box) continue;
      const i = stmtOf(st, nodes[0]), r = st.recs.get(i);
      // its time: the acts the engine says are its own (act.item), else its statement's
      const mine = (st.P.sh?.acts ?? []).filter((a: any) => a.item === n);
      const acts = mine.length ? mine : r?.acts ?? [];
      // its words, each with its own box: the one double-clicked is the one typed into; words that changed since the
      // page was built change as it plays (a counter): those are not typed over
      const texts = st.tx.map((x, id) => ({ x, id })).filter(({ x }) => x.n === n && x.el.isConnected && inked(x.el))
        .map(({ x, id }) => ({ id, j: x.j, value: x.el.textContent ?? '', live: (x.el.textContent ?? '') !== x.built, box: stageBox([x.el]) })).filter((x) => x.box);
      const ats = acts.map((a: any) => +a.at).filter(Number.isFinite);
      const ends = acts.map((a: any) => +a.at + (+a.dur || 0)).filter(Number.isFinite);
      const pic = nodes.some((x) => x.matches('img, image') || !!x.querySelector('img, image'));
      const kind = pic ? (box.w * box.h > 0.8 * W.STAGE.w * W.STAGE.h ? 'scene' : 'picture') : texts.length ? 'text' : 'shape';
      const visible = drawn(nodes).some(inked);
      if (kind === 'scene') scenes.add(n);
      list.push({
        page: pg.id, i: n, stmt: i, call: nodes[0].getAttribute('data-call'), fp: nodes[0].getAttribute('data-fp'), kind, box,
        start: pg.start + (ats.length ? Math.min(...ats) : 0), end: pg.start + (ends.length ? Math.max(...ends) : pg.end - pg.start),
        texts, visible, thumb: visible || peeked.has(n) ? thumbOf(nodes) : null,
        // words shown that are not the engine's P.text (a widget writing its own each frame): not typed over
        wordy: texts.length > 0 || nodes.some((x) => (x.textContent ?? '').trim() !== ''),
      });
    }
    const frame = document.getElementById('frame');
    // hand edits whose thing the page no longer draws (it was changed after them)
    const orphans = W.ENGINE?.orphans?.(pg.id) ?? [];
    return { page: pg.id, elements: list, orphans, paper: frame ? getComputedStyle(frame).backgroundColor : null };
  }

  /** what a statement draws, as a small picture for the layers list: its drawn lines and shapes as they are now (an
   *  SVG of copies, in the stage's units, without the paper's filters), or its picture; null for words alone */
  const scenes = new Set<number>();
  function thumbOf(nodes: Element[]): { svg?: string; img?: string } | null {
    // a moved thing's group kept whole: its copy carries the move
    const parts = drawn(nodes, false);
    const img = parts.map((n) => (n.matches?.('img') ? n : n.querySelector?.('img'))).find(Boolean);
    if (img?.currentSrc || img?.src) return { img: img.currentSrc || img.src };
    const svgs = parts.filter((n) => n.ownerSVGElement && !n.closest?.('.tx'));
    if (!svgs.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const out: string[] = [];
    for (const n of svgs) {
      const r = n.getBoundingClientRect(), o = n.ownerSVGElement.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      const kx = W.STAGE.w / (o.width || 1), ky = W.STAGE.h / (o.height || 1);
      x0 = Math.min(x0, (r.left - o.left) * kx); y0 = Math.min(y0, (r.top - o.top) * ky);
      x1 = Math.max(x1, (r.right - o.left) * kx); y1 = Math.max(y1, (r.bottom - o.top) * ky);
      const c = n.cloneNode(true) as Element;
      for (const e of [c, ...c.querySelectorAll('*')]) { e.removeAttribute('filter'); e.removeAttribute('mask'); e.removeAttribute('clip-path'); e.style?.removeProperty?.('translate'); e.style?.removeProperty?.('scale'); }
      out.push(c.outerHTML);
    }
    if (!out.length || !Number.isFinite(x0)) return null;
    const pad = Math.max(4, (x1 - x0 + y1 - y0) * 0.04);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${(x1 - x0 + 2 * pad).toFixed(1)} ${(y1 - y0 + 2 * pad).toFixed(1)}">${out.join('')}</svg>`;
    return svg.length > 80_000 ? null : { svg };
  }

  /** what is drawn under a point of the picture (stage px), topmost first, by what the browser itself finds there
   *  (a line's ink, a word's box; never the empty stage-sized layers they sit in): words before anything else, then
   *  each statement once; a background picture and what is hidden for a moment are passed through. A thin line is
   *  found a few pixels off it too */
  const CONTAINER = (n: Element) => n.id === 'stage' || n.id === 'frame' || n.id === 'viewport' || n.classList?.contains('layer')
    || n.classList?.contains('cam') || n.classList?.contains('hud') || (n.tagName === 'svg' && n.classList?.contains('ink')) || n.classList?.contains('txt')
    || n.classList?.contains('edited');
  function pick(x: number, y: number) {
    const pg = W.ENGINE?.layout?.pages?.find((p: any) => tNow() >= p.start - 0.01 && tNow() < p.end - 0.01);
    const st = pg && pages.get(pg.id);
    const frame = document.getElementById('frame');
    if (!st || !frame) return [];
    const txOf = new Map<Element, number>(st.tx.map((t: Tx, id: number) => [t.el, id] as [Element, number]));
    const f = frame.getBoundingClientRect(), k = f.width / W.STAGE.w;
    const cx = f.left + x * k, cy = f.top + y * k;
    const words: { i: number; text?: number }[] = [], things: { i: number; text?: number }[] = [];
    const seen = new Set<number>();
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [5, 5], [-5, -5], [5, -5], [-5, 5]]) {
      for (const hit of document.elementsFromPoint(cx + dx, cy + dy) as Element[]) {
        if (CONTAINER(hit) || !shown(hit)) continue;
        let i: number | undefined, text: number | undefined, said: Element | undefined;
        for (let e: Element | null = hit; e && !CONTAINER(e); e = e.parentElement) {
          // words: the engine's P.text, or a widget's own (a counter), which are words to pick first all the same
          if (!said && e.classList?.contains('tx')) { said = e; text = txOf.get(e); }
          if (e.hasAttribute('data-item')) { i = Number(e.getAttribute('data-item')); break; }
        }
        // words not written yet are there, letter by letter from nothing: not a thing to pick
        if (said && !inked(said)) continue;
        if (i == null || seen.has(i) || scenes.has(i) || peeked.has(i)) continue;
        seen.add(i);
        // words only where the pointer is right on them, not a few pixels off
        if (said && dx === 0 && dy === 0) words.push({ i, ...(text != null ? { text } : {}) }); else things.push({ i, ...(text != null ? { text } : {}) });
      }
    }
    return [...words, ...things];
  }

  /** things taken off the picture for a moment (the layers list's eye), on the page shown: nothing saved */
  const peeked = new Set<number>();
  let peekPage = '';
  function peek() {
    const st = pages.get(peekPage);
    if (!st) return;
    for (const [n, xs] of itemsOf(peekPage)) for (const x of xs) if (x.style) x.style.visibility = peeked.has(n) ? 'hidden' : '';
  }
  const report = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = tNow();
    post({ type: 'edit:elements', t, ...elements(t) });
  }));

  // a drag shown before it is saved: from how the statement is drawn now, by CSS's own translate and scale (the engine
  // writes only `transform`, so its animation goes on under them). Its transform-origin is never touched: an icon's
  // `transform` (where it is, its size) and an animation's turn are about it. The scale is taken about the element's
  // own origin, then the translate puts its centre where scaling about the drag's origin would have
  /** where each thing dragged was before its first nudge (its centre, stage px): a page built again has new ones */
  const drawnAt = new WeakMap<Element, { x: number; y: number }>();
  function nudge(m: any) {
    const xs = itemsOf(String(m.page)).get(m.i);
    if (!xs) return;
    const frame = document.getElementById('frame')!, f = frame.getBoundingClientRect(), k = f.width / W.STAGE.w;
    const centre = (n: Element) => { const b = n.getBoundingClientRect(); return { x: (b.left + b.width / 2 - f.left) / k, y: (b.top + b.height / 2 - f.top) / k }; };
    for (const n of xs) {
      const s = n.style;
      let c0 = drawnAt.get(n);
      if (!c0) { s.translate = ''; s.scale = ''; c0 = centre(n); drawnAt.set(n, c0); }
      const want = { x: m.ox + m.scale * (c0.x - m.ox) + m.dx, y: m.oy + m.scale * (c0.y - m.oy) + m.dy };
      s.translate = '';
      s.scale = String(m.scale);
      const c1 = centre(n);
      s.translate = `${want.x - c1.x}px ${want.y - c1.y}px`;
    }
  }

  // words typed where they are: the text's element stays, hidden; a copy of it (its class, its place, its size, its
  // colour) takes the words as plain text and the caret. Enter or leaving it sends them; Esc puts the text back. The
  // copy stays until the page is built again with the new words, so nothing flashes
  let typing: { page: string; n: number; j: number; was: string; el: Element; ed: Element } | undefined;
  function type(m: any) {
    const t = pages.get(m.page)?.tx[m.id];
    if (!t || !t.el.isConnected || t.n == null) return;
    stopTyping(false);
    const was = t.el.textContent ?? '';
    const ed = t.el.cloneNode(false) as Element;
    ed.textContent = was;
    ed.contentEditable = 'plaintext-only';
    ed.classList.add('ed-copy');
    ed.spellcheck = false;
    Object.assign(ed.style, { opacity: '1', transform: '', outline: 'none', caretColor: 'currentColor', minWidth: '0.6em', whiteSpace: t.el.style.whiteSpace === 'nowrap' ? 'pre' : 'pre-wrap' });
    t.el.style.visibility = 'hidden';
    t.el.after(ed);
    typing = { page: m.page, n: t.n, j: t.j, was, el: t.el, ed };
    document.documentElement.classList.add('ed-typing');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    ed.addEventListener('keydown', (e: any) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopTyping(true); }
      else if (e.key === 'Escape') { e.preventDefault(); stopTyping(false); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && ed.textContent === was) e.preventDefault();
    });
    ed.addEventListener('blur', () => stopTyping(true));
    ed.addEventListener('input', () => post({ type: 'edit:typing', box: stageBox([ed]) }));
    post({ type: 'edit:typing', box: stageBox([ed]) });
  }
  function stopTyping(keep: boolean) {
    const x = typing;
    if (!x) return;
    typing = undefined;
    document.documentElement.classList.remove('ed-typing');
    const value = (x.ed.innerText ?? x.ed.textContent ?? '').replace(/\n$/, '');
    const send = keep && value.trim() !== '' && value !== x.was;
    if (send) x.ed.contentEditable = 'false';
    else { x.ed.remove(); x.el.style.visibility = ''; }
    post({ type: 'edit:typed', page: x.page, n: x.n, j: x.j, value: send ? value : null, empty: keep && value.trim() === '' });
  }

  /** pages' code as the editor marked it (it parses and marks them; this only runs them, as the preview runs any page):
   *  each run in place of the page's, the film built again and drawn at `t` */
  function load(code: Record<string, string>, t: number) {
    typing = undefined;   // the page is built again: a copy being typed in goes with the old one
    document.documentElement.classList.remove('ed-typing');
    let failed: { page: string; message: string } | undefined, page = '';
    const onError = (e: any) => { failed ??= { page, message: String(e?.message ?? e) }; };
    addEventListener('error', onError);
    try {
      for (const [p, src] of Object.entries(code)) {
        page = p;
        const el = document.createElement('script');
        el.textContent = src;
        document.head.appendChild(el);   // an inline script runs as it is put in
        el.remove();
      }
    } finally { removeEventListener('error', onError); }
    try {
      W.ENGINE.init({ subs: !q.has('nosubs') });
      // drawn at this moment now (a fresh build shows every page at once until it is), then the player follows
      W.ENGINE.renderAt(t);
      peek();
      window.postMessage({ type: 'studio:seek', t }, '*');
      const err = (W.ENGINE.errors ?? []).find((e: any) => e.page in code);
      if (err) failed ??= { page: err.page, message: String(err.message) };
    } catch (e) { failed ??= { page, message: String((e as Error)?.message ?? e) }; }
    if (failed) post({ type: 'edit:error', ...failed });
    report();
  }

  addEventListener('message', (e: any) => {
    const m = e.data;
    if (e.source !== parent && e.source !== window) return;
    if (m?.type === 'studio:seek' || m?.type === 'studio:pause' || m?.type === 'edit:elements?') report();
    else if (m?.type === 'edit:load' && m.pages && typeof m.pages === 'object' && e.source === parent) load(m.pages, +m.t || 0);
    else if (m?.type === 'edit:nudge') { nudge(m); report(); }
    else if (m?.type === 'edit:pick') post({ type: 'edit:picked', seq: m.seq, x: m.x, y: m.y, stack: pick(+m.x, +m.y) });
    else if (m?.type === 'edit:peek') {
      // the ones shown again first (a page changed: the old page's all come back)
      const before = [...peeked];
      peeked.clear();
      const was = itemsOf(peekPage);
      for (const n of before) for (const x of was.get(n) ?? []) if (x.style) x.style.visibility = '';
      peekPage = String(m.page ?? '');
      for (const i of Array.isArray(m.ids) ? m.ids : []) if (Number.isInteger(i)) peeked.add(i);
      peek();
      report();
    }
    else if (m?.type === 'edit:type' && e.source === parent) type(m);
    else if (m?.type === 'edit:type-end') stopTyping(!!m.keep);
  });

  // once the film is built and drawn: what it is, then what is on screen
  const ready = () => {
    const done = W.__ready as Promise<unknown> | undefined;
    if (!done) { setTimeout(ready, 50); return; }
    done.then(() => {
      // the style's colours by name, without the light fills of its greys (inkF…)
      // what a thing can be drawn in: the style's own colours (its paper and the light fills of its greys left out)
      const palette = W.STYLE?.palette ? Object.keys(W.STYLE.palette).filter((n) => !n.endsWith('F') && n !== 'paper').map((name) => ({ name, hex: String(W.PV?.col?.(name) ?? W.STYLE.palette[name]) })) : [];
      post({
        type: 'edit:ready', stage: { w: W.STAGE.w, h: W.STAGE.h }, palette,
        pages: W.ENGINE.layout.pages.map((p: any) => ({ id: p.id, start: p.start, end: p.end, cues: p.cues.map((c: any, i: number) => ({ i, start: c.start, end: c.end, text: c.text })) })),
      });
      report();
    }).catch(() => {});
  };
  ready();
}

/** __edit.js as served */
export const editRuntimeScript = `(${editRuntime.toString()})();\n`;
