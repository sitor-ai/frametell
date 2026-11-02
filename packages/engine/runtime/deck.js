/* The film as a slide deck (?deck, or window.DECK_MODE): each spoken line is one step. A click, → or Space plays the
 * picture from where the last step stopped to just before the next line begins, and holds there; the animations of a
 * line are drawn at its start, so a step is exactly one "build" of the slide. ← goes back a step (straight to its held
 * picture, not played backwards); ↑ ↓ jump a page; Home / End; F full screen; P a presenter window (the line to say,
 * the next one, a clock) that follows and drives this one. The step is kept in the address (#12), so a reload stays on
 * it. Silent and without subtitles: the presenter speaks. */
(function () {
  const q = new URLSearchParams(location.search);
  const presenter = q.has('presenter');
  // the presenter window draws the picture in its left part: main.js places the frame in this box
  if (presenter) window.DECK_BOX = () => ({ x: 24, y: 24, w: Math.max(200, innerWidth * 0.62 - 36), h: Math.max(120, innerHeight - 48) });

  window.DECK = function ({ render }) {
    const L = ENGINE.layout;
    const meta = (window.SCRIPT && SCRIPT.META) || {};
    const ui = q.get('lang');
    const en = ui === 'en' || ui === 'zh' ? ui === 'en' : meta.lang ? !/^zh/.test(meta.lang) : !/[㐀-鿿]/.test(meta.title || '');
    const say = (zh, english) => (en ? english : zh);
    const EPS = 0.05;
    const F = Math.min(TIMING.FADE, L.gap), D = meta.fadeDelay ?? 0.3, FO = meta.fadeOut ?? TIMING.FADE_OUT;

    // ── the steps: one per line, held just before the next line starts; a page's last line holds until its picture
    // starts to turn (the next page fades in from end - F + D), the film's last until its closing fade ──
    const steps = [];
    L.pages.forEach((pg, pi) => {
      const last = pi === L.pages.length - 1;
      const pageHold = Math.max(pg.speechEnd, last ? pg.end - (FO > 0 ? FO : 0) - EPS : pg.end - F + D - EPS);
      const cues = pg.cues.length ? pg.cues : [null];
      cues.forEach((c, ci) => {
        const next = pg.cues[ci + 1];
        steps.push({ page: pi, cue: ci, text: c ? c.text : '', hold: next ? Math.max(next.start - EPS, (c ? c.start : pg.start) + EPS) : pageHold });
      });
    });
    const N = steps.length;
    const from = (i) => (i <= 0 ? 0 : steps[i - 1].hold);

    // ── the shared state: which step, and whether it is being played ──
    let i = 0, t = 0, playing = false, wall = 0, t0 = 0;
    const chan = 'BroadcastChannel' in window ? new BroadcastChannel(`deck:${location.pathname}`) : null;
    const tell = () => chan?.postMessage({ type: 'at', i });

    const css = document.createElement('style');
    css.textContent = `
body { background: #111; }
#dk-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99; display: flex; align-items: center; gap: 6px; padding: 10px 16px 14px;
  color: #fff; font: 600 14px -apple-system, "PingFang SC", sans-serif; background: linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0)); transition: opacity .3s; }
#dk-bar.idle { opacity: 0; }
#dk-bar button { background: none; border: 0; color: #fff; font: inherit; font-size: 18px; cursor: pointer; min-width: 36px; height: 34px; border-radius: 8px; padding: 0 8px; }
#dk-bar button:hover { background: rgba(255,255,255,0.15); }
#dk-n { font-variant-numeric: tabular-nums; min-width: 72px; text-align: center; }
#dk-gap { flex: 1; }
#dk-line { position: fixed; left: 0; bottom: 0; height: 3px; background: #FF9A3C; z-index: 100; transition: width .25s; }
#dk-hint { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 98; pointer-events: none; background: rgba(0,0,0,0.6); color: #fff;
  font: 600 18px -apple-system, "PingFang SC", sans-serif; padding: 14px 24px; border-radius: 40px; transition: opacity .6s; white-space: nowrap; }
body.dk-quiet, body.dk-quiet #viewport { cursor: none; }
#dk-notes { position: fixed; top: 24px; right: 24px; bottom: 24px; width: calc(38vw - 36px); display: flex; flex-direction: column; gap: 18px; color: #eee;
  font: 400 15px -apple-system, "PingFang SC", sans-serif; overflow: auto; }
#dk-notes .k { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #999; margin-bottom: 6px; }
#dk-notes .now { font-size: 26px; line-height: 1.5; color: #fff; }
#dk-notes .next { font-size: 18px; line-height: 1.5; color: #aaa; }
#dk-notes .row { display: flex; gap: 18px; align-items: baseline; font-variant-numeric: tabular-nums; }
#dk-notes .clock { font-size: 30px; font-weight: 600; color: #fff; }
#dk-notes button { background: #333; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font: 600 15px -apple-system, "PingFang SC", sans-serif; cursor: pointer; }
#dk-notes button:hover { background: #444; }`;
    document.head.appendChild(css);

    const $ = (id) => document.getElementById(id);
    const bar = document.createElement('div');
    bar.id = 'dk-bar';
    bar.innerHTML = `<button id="dk-prev" title="${say('上一步（←）', 'Back (←)')}">‹</button><span id="dk-n"></span><button id="dk-next" title="${say('下一步（→ / 空格）', 'Next (→ / Space)')}">›</button>`
      + `<span id="dk-gap"></span>`
      + (presenter ? '' : `<button id="dk-presenter" title="${say('演讲者视图（P）', 'Presenter view (P)')}">▤</button>`)
      + `<button id="dk-fs" title="${say('全屏（F）', 'Full screen (F)')}">⛶</button>`;
    document.body.appendChild(bar);
    const line = document.createElement('div');
    line.id = 'dk-line';
    document.body.appendChild(line);

    let notes = null, opened = Date.now();
    if (presenter) {
      notes = document.createElement('div');
      notes.id = 'dk-notes';
      document.body.appendChild(notes);
      document.title = `${say('演讲者', 'Presenter')} · ${document.title}`;
    }
    const clock = () => { const s = Math.floor((Date.now() - opened) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
    const drawNotes = () => {
      if (!notes) return;
      const s = steps[i], n = steps[i + 1], pg = L.pages[s.page];
      notes.innerHTML = `<div class="row"><span class="clock">${clock()}</span><span>${i + 1} / ${N}</span><span>${say('第', 'Page ')}${s.page + 1}${say(' 页', '')} · ${esc(pg.section || pg.title || '')}</span></div>`
        + `<div><div class="k">${say('这一步', 'Now')}</div><div class="now">${esc(s.text) || '—'}</div></div>`
        + `<div><div class="k">${say('下一步', 'Next')}</div><div class="next">${n ? esc(n.text) || '—' : say('（结束）', '(end)')}</div></div>`
        + `<div class="row"><button data-go="-1">‹ ${say('上一步', 'Back')}</button><button data-go="1">${say('下一步', 'Next')} ›</button><button data-go="0">${say('计时清零', 'Reset clock')}</button></div>`;
    };
    if (notes) {
      notes.addEventListener('click', (e) => {
        const go = e.target.closest?.('[data-go]')?.dataset.go;
        if (go === '1') next(); else if (go === '-1') back(); else if (go === '0') { opened = Date.now(); drawNotes(); }
      });
      setInterval(() => { const c = notes.querySelector('.clock'); if (c) c.textContent = clock(); }, 1000);
    }

    const show = () => {
      render(t);
      $('dk-n').textContent = `${i + 1} / ${N}`;
      line.style.width = `${((i + 1) / N) * (presenter ? 62 : 100)}%`;
      drawNotes();
    };
    const mark = () => { try { history.replaceState(null, '', `#${i + 1}`); } catch { /* a sandboxed frame */ } };

    const loop = (now) => {
      if (!playing) return;
      const to = steps[i].hold;
      t = Math.min(to, wall + (now - t0) / 1000);
      if (t >= to) playing = false;
      show();
      if (playing) requestAnimationFrame(loop);
    };
    /** play step k from the held picture before it */
    const play = (k) => {
      i = k; t = from(k); wall = t; t0 = performance.now(); playing = true;
      mark(); tell();
      requestAnimationFrame(loop);
    };
    /** show step k's held picture at once */
    const land = (k) => {
      playing = false;
      i = Math.max(0, Math.min(N - 1, k)); t = steps[i].hold;
      mark(); tell(); show();
    };
    // a step still playing is finished at once by the next press; else the next step plays
    function next() { hideHint(); if (playing) land(i); else if (i < N - 1) play(i + 1); }
    function back() { hideHint(); if (i > 0) land(i - 1); else land(0); }
    /** the next page's first step, played (its page turn too); the previous page's last, held */
    const nextPage = () => { hideHint(); const k = steps.findIndex((s) => s.page > steps[i].page); if (k > 0) play(k); };
    const prevPage = () => { hideHint(); const p = steps[i].page; land(p > 0 ? steps.findLastIndex((s) => s.page === p - 1) : 0); };
    const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    const openPresenter = () => {
      const u = new URL(location.href); u.searchParams.set('presenter', ''); u.hash = String(i + 1);
      window.open(u.href, `deck-presenter`, 'width=1280,height=760');
    };

    // the presenter window and the deck follow each other (both ways: either can be the one clicked)
    chan?.addEventListener('message', (e) => {
      const m = e.data;
      if (m?.type === 'at' && typeof m.i === 'number' && m.i !== i) {
        // one step on is played, as it is here; anything else lands
        if (m.i === i + 1 && !playing) { i = m.i; t = from(i); wall = t; t0 = performance.now(); playing = true; mark(); requestAnimationFrame(loop); }
        else { playing = false; i = Math.max(0, Math.min(N - 1, m.i)); t = steps[i].hold; mark(); show(); }
      } else if (m?.type === 'hello') tell();
    });

    // ── input ──
    const hintEl = document.createElement('div');
    hintEl.id = 'dk-hint';
    hintEl.textContent = say('点击画面或按 → 进入下一步', 'Click or press → for the next step');
    document.body.appendChild(hintEl);
    hintEl.style.opacity = '0';
    let hinted = false;
    const showHint = () => { if (!hinted) hintEl.style.opacity = '1'; };
    function hideHint() { hinted = true; hintEl.style.opacity = '0'; }

    $('dk-prev').addEventListener('click', (e) => { e.stopPropagation(); back(); });
    $('dk-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
    $('dk-fs').addEventListener('click', (e) => { e.stopPropagation(); fullscreen(); });
    $('dk-presenter')?.addEventListener('click', (e) => { e.stopPropagation(); openPresenter(); });
    // a click on the picture's left fifth goes back (a phone's tap), anywhere else on
    document.getElementById('viewport').addEventListener('click', (e) => { if (e.clientX < innerWidth * 0.2) back(); else next(); });
    let touch = null;
    addEventListener('touchstart', (e) => { touch = e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    addEventListener('touchend', (e) => {
      const p = e.changedTouches[0]; if (!touch || !p) return;
      const dx = p.clientX - touch.x, dy = p.clientY - touch.y; touch = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); if (dx < 0) next(); else back(); }
    });
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === ' ' || k === 'Enter' || k === 'PageDown') { e.preventDefault(); next(); }
      else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); back(); }
      else if (k === 'ArrowDown') { e.preventDefault(); nextPage(); }
      else if (k === 'ArrowUp') { e.preventDefault(); prevPage(); }
      else if (k === 'Home') { e.preventDefault(); land(0); }
      else if (k === 'End') { e.preventDefault(); land(N - 1); }
      else if (k === 'f' || k === 'F') fullscreen();
      else if ((k === 'p' || k === 'P') && !presenter) openPresenter();
    });
    // the controls and the pointer hide after 2 s without movement
    let idle;
    const wake = () => { bar.classList.remove('idle'); document.body.classList.remove('dk-quiet'); clearTimeout(idle); if (!presenter) idle = setTimeout(() => { bar.classList.add('idle'); document.body.classList.add('dk-quiet'); }, 2000); };
    addEventListener('mousemove', wake);
    wake();

    // ── start: at the step in the address, else the cover drawn in as the first step ──
    const at = parseInt(location.hash.slice(1), 10);
    if (at >= 1 && at <= N) land(at - 1);
    else { show(); play(0); setTimeout(showHint, 1200); setTimeout(hideHint, 5200); }
    if (presenter) chan?.postMessage({ type: 'hello' });
    return { steps, get step() { return i; } };
  };
})();
