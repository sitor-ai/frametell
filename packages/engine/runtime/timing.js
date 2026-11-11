/* Speech timing: turns the script into absolute cue / page times. Shared by the browser and node tools. */
(function (root) {
  const CPS = 4.3;       // spoken units per second (calm lecture pace)
  const BREATH = 0.3;    // pause after each cue
  const COMMA = 0.14;    // extra pause per inner comma/dash
  const LEAD = 0.5;      // page appears, then the first sentence starts
  const GAP = 1.5;       // silent hold between pages (speaker's breathing room)
  const FADE = 0.6;      // cross-fade at the end of the gap
  const END = 2.5;       // the last page holds this long after its last line, so the film ends on a settled picture
  const FADE_OUT = 0.8;  // the film fades to its ground over its final seconds, never a hard cut
  const CARD = 1.8;      // a chapter card (pg.chapter): the page opens on its big title alone, then the narration starts
  const TURNS = ['fade', 'carry', 'travel', 'dive', 'cut'];   // how a page comes in (pg.turn); fade unless the page says otherwise

  /** Rough spoken length: a CJK character, kana or Hangul syllable = 1 unit, a word in any other script ~ its syllables,
   *  digits = 1 each. */
  const SYLLABIC = /[一-鿿぀-ヿ가-힯]/;
  function units(text) {
    let u = 0;
    for (const ch of text) if (SYLLABIC.test(ch)) u += 1;
    const words = text.replace(/[一-鿿぀-ヿ가-힯]/g, ' ').match(/[\p{L}\p{M}_]+/gu) || [];
    for (const w of words) u += Math.max(1, w.replace(/_/g, '').length / 3.2);
    u += (text.match(/\d/g) || []).length * 0.9;
    return u;
  }
  const commas = (text) => (text.slice(0, -1).match(/[，、；：——,]/g) || []).length;

  function cueDur(text) {
    return Math.max(1.3, units(text) / CPS + commas(text) * COMMA + BREATH);
  }

  /**
   * When a word inside a cue is spoken (absolute seconds). With real voice, cue.k holds per-character onsets in seconds
   * from the start of the cue's audio (one entry per character of the cue text, Array.from order); without it the onset
   * is estimated from the spoken units before the word. nth picks a later repeat of the word.
   */
  function wordTime(cue, word, nth = 0) {
    const chars = Array.from(cue.text);
    let from = 0, idx = -1;
    for (let n = 0; n <= nth; n++) { idx = cue.text.indexOf(word, from); if (idx < 0) break; from = idx + word.length; }
    if (idx < 0) return cue.start;   // unknown word: fall back to the cue onset rather than failing the page
    const ci = Array.from(cue.text.slice(0, idx)).length;
    if (cue.k && cue.k.length === chars.length) return (cue.audioAt ?? cue.start) + cue.k[ci];
    const total = units(cue.text) || 1;
    const spoken = (cue.dur ?? cue.end - cue.start) * 0.92;
    return cue.start + (units(cue.text.slice(0, idx)) / total) * spoken;
  }

  /** Display form for subtitles: drop trailing soft punctuation. */
  function subText(text) {
    return text.replace(/[，。；：、,.;:]+$/u, '').replace(/——$/u, '');
  }

  // Real voice (voice.js from engine/tools/tts.mjs): cue length = trimmed audio + a natural pause, holds are capped,
  // pages follow each other closely — no long silences.
  const VOICE = { lead: 0.2, comma: 0.18, stop: 0.4, pageEnd: 0.3, maxHold: 0.5, gap: 0.3, tail: END };
  const voiceOf = (voice, pi, ci, text) => { const v = voice && voice.pages[pi] && voice.pages[pi][ci]; return v && v.t === text ? v : null; };

  /** opts.gap overrides GAP (script.js META.gap); opts.voice = SCRIPT.VOICE switches to real audio durations. */
  function layout(pages, opts = {}) {
    const voice = opts.voice || null;
    const V = { ...VOICE, ...(opts.pace || {}) };   // META.pace: { maxHold, gap } loosens a voiced film's pauses (tight by default)
    const gap = voice ? V.gap : opts.gap ?? GAP;
    let t = 0;
    const out = pages.map((pg, idx) => {
      const start = t;
      // a chapter card holds the page's first seconds in silence: everything the page says starts after it
      const card = typeof pg.chapter === 'string' && pg.chapter.trim() && idx > 0 ? CARD : 0;
      let ct = start + card + (voice ? VOICE.lead : LEAD);
      const cues = pg.cues.map((c, ci) => {
        const text = typeof c === 'string' ? c : c.t;
        const hold = typeof c === 'string' ? 0 : c.hold || 0;
        const v = voiceOf(voice, idx, ci, text);
        if (v && v.o != null) {
          // cut from a whole-page utterance: the segment already holds its natural pauses (v.o = speech onset inside it)
          const h = ci === pg.cues.length - 1 || v.join ? 0 : Math.min(hold, V.maxHold);   // join: spoken straight into the next cue
          const cue = { text, sub: subText(text), start: ct + v.o, end: ct + v.d, hold: h, audio: v.f, audioAt: ct, dur: v.d, k: v.k };
          ct += v.d + h;
          return cue;
        }
        if (v) {
          // the page's last cue: no hold, short pause — the page turn itself is the breath
          const lastCue = ci === pg.cues.length - 1;
          const pause = lastCue ? VOICE.pageEnd : /[。？！?!.]$/.test(text) ? VOICE.stop : VOICE.comma, h = lastCue ? 0 : Math.min(hold, V.maxHold);
          const cue = { text, sub: subText(text), start: ct, end: ct + v.d + pause * 0.9, hold: h, audio: v.f, audioAt: ct, dur: v.d, k: v.k };
          ct += v.d + pause + h;
          return cue;
        }
        const d = cueDur(text);
        const cue = { text, sub: subText(text), start: ct, end: ct + d - BREATH * 0.5, hold };
        ct += d + hold;
        return cue;
      });
      const speechEnd = ct;
      const after = pg.after || 0;   // extra seconds after the page's last line before it turns (lets the picture settle and sink in)
      const last = idx === pages.length - 1;
      const end = speechEnd + after + (last ? pg.tail ?? V.tail : gap);   // pg.tail / META.pace.tail: a longer ending hold (a brand's sign-off)
      t = end;
      const turn = TURNS.includes(pg.turn) && idx > 0 ? pg.turn : 'fade';
      return { ...pg, index: idx, start, speechEnd, end, cues, card, turn };
    });
    // META.music: the film's background music, one bed under the whole film (see sfxTimes)
    return { pages: out, duration: t, gap, ...(opts.music && opts.music.f ? { music: opts.music } : {}) };
  }

  /**
   * Sound effects / music beds: page.sfx = [{ f, at, until?, vol?, fin?, fout?, loop?, duck?, rate? }] → absolute
   * [{ f, t0, t1, vol, fin, fout, loop, duck, rate }]. at / until: page seconds, [cueIndex, dt] (cue start + dt), 'end' (page end)
   * or { page: 'p05', at } (another page). Without until a clip plays once to its natural end. vol in dB.
   */
  function sfxTimes(L) {
    const byId = Object.fromEntries(L.pages.map((p) => [p.id, p]));
    const when = (pg, a) => {
      if (a == null) return null;
      if (typeof a === 'number') return pg.start + a;
      if (a === 'end') return pg.end;
      if (Array.isArray(a)) return (pg.cues[a[0]] ? pg.cues[a[0]].start : pg.speechEnd) + (a[1] || 0);
      if (a.page) { const q = byId[a.page]; return a.at === 'end' || a.at == null ? q.end : when(q, a.at); }
      return null;
    };
    const out = L.pages.flatMap((pg) => (pg.sfx || []).map((s) => ({
      f: s.f, t0: when(pg, s.at ?? 0), t1: when(pg, s.until), vol: s.vol ?? 0, fin: s.fin ?? 0, fout: s.fout ?? 0,
      loop: !!s.loop, duck: s.duck ?? 0, rate: s.rate ?? 1, from: s.from ?? 0,
    })));
    // META.music = { f, vol?, duck? }: a bed from the first frame to the last, looped when the film outlasts it, faded in
    // and out, lowered by `duck` dB while someone speaks (default 5: ~14 dB under the voice then, ~9 in its pauses)
    const m = L.music;
    if (m && m.f && L.duration > 0) out.push({ f: m.f, t0: 0, t1: L.duration, vol: m.vol ?? 0, fin: 1, fout: Math.min(3, L.duration / 4), loop: true, duck: m.duck ?? 5, rate: 1, from: 0 });
    return out;
  }

  root.TIMING = { CPS, BREATH, LEAD, GAP, FADE, END, FADE_OUT, CARD, TURNS, VOICE, units, cueDur, subText, wordTime, layout, sfxTimes };
})(typeof window !== 'undefined' ? window : globalThis);
