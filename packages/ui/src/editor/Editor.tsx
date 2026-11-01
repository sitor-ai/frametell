// The film editor: over the whole window, while the workbench stays mounted behind it. Top bar: the layers' switch,
// the title, undo / redo, the draft's state, Versions, Discard changes, Save as new version, Preview | Edit. Then the
// layers on the picture at this moment (Layers), the picture, where everything is done by hand (Canvas: select, drag,
// resize, delete, double-click words to type over them where they are), and under them the film on a timeline as a
// video editor has it (the pages' frames, the voice, the selected element's clip). Every change goes into the draft
// (useDraft); the preview runs the page again at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from './copy';
import { useShellCopy } from './copy';
import type { ProjectView } from '../lib/client';
import { edit } from './api';
import { Canvas, type Asking, type Delta, type Thing } from './Canvas';
import { Dialog } from './Dialog';
import { Layers } from './Layers';
import { Timeline, Transport } from './Timeline';
import type { EditInfo, Element, FilmPageTimes, FromFrame, ItemEdit, Moved, Op, Version } from './types';
import { useDraft, type Step } from './useDraft';
import { useClock, useFrame } from './useFrame';
import { Versions } from './Versions';
import './editor.css';

type Ask = { kind: 'save'; leave?: boolean } | { kind: 'discard'; leave?: boolean } | { kind: 'restore'; v: Version } | { kind: 'leave' };
const FALLBACK_STAGE = { w: 1920, h: 1080 };
const zero: Moved = { dx: 0, dy: 0, scale: 1 };

const pageAt = (pages: FilmPageTimes[] | undefined, t: number) => {
  if (!pages?.length) return undefined;
  return (pages.find((p) => t >= p.start && t < p.end) ?? (t >= pages[pages.length - 1].end ? pages[pages.length - 1] : pages[0])).id;
};
const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** a page as it stands once its lines are said: everything on it drawn, before it fades into the next */
const settled = (p: { start: number; end: number; cues?: { end: number }[] }) =>
  Math.max(p.start + 0.6, Math.min(p.end - 0.4, (p.cues?.length ? p.cues[p.cues.length - 1].end : p.end) + 0.2));

export function Editor({ id, title, project, info: first, onExit }: {
  id: string; title?: string; project?: ProjectView; info: EditInfo;
  /** back to 预览; `changed`: the film itself changed (a version saved or gone back to) */
  onExit: (changed: boolean) => void;
}) {
  const c = useShellCopy();
  const e = c.editor;
  const { lang } = useLang();
  const [info] = useState(first);
  // the preview's address: a new one (gen) only after a discard or a restore, which change every page at once
  const [gen, setGen] = useState<{ n: number; from: number }>({ n: 0, from: 0 });
  const src = `${info.previewUrl}index.html?nosubs${gen.n ? `&from=${gen.from.toFixed(2)}&v=${gen.n}` : ''}`;
  const frame = useFrame(src);
  const { clock } = frame;
  const film = frame.film;
  const stage = film?.stage ?? FALLBACK_STAGE;
  const pageIds = useMemo(() => film?.pages.map((p) => p.id) ?? info.pages, [film, info.pages]);
  const current = useClock(clock, (k) => pageAt(film?.pages, k.t)) ?? pageIds[0];
  const playing = useClock(clock, (k) => k.playing);

  // per element, until the page is loaded again: what the runtime is showing on top of the drawn page (a nudge), and
  // where the element's scale origin is (the box centre before any move), worked out once from a consistent state
  const shownNudge = useRef(new Map<string, Delta>());
  const origins = useRef(new Map<string, { ox: number; oy: number }>());
  const changedFilm = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string>();
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), 4500); return () => clearTimeout(t); }, [toast]);

  const onLoad = useCallback((pages: Record<string, string>, page: string, why: 'edit' | 'undo' | 'redo' | 'refetch') => {
    // the page is rebuilt from its new code: whatever was nudged on top of it is gone
    for (const m of [shownNudge.current, origins.current]) for (const k of [...m.keys()]) if (k.startsWith(`${page}:`)) m.delete(k);
    const times = frame.film?.pages.find((p) => p.id === page);
    const t = clock.now.t;
    // an undo or redo on another page: go there, so the change is seen
    if ((why === 'undo' || why === 'redo') && times && (t < times.start || t >= times.end)) frame.seek(settled(times));
    frame.load(pages);
  }, [frame, clock]);
  const draft = useDraft(id, { initialDraft: info.draft?.pages ?? [], onLoad });

  // once the preview says it is ready (again, after a discard or a restore): every page's text, marked, in one load
  useEffect(() => {
    if (!film) return;
    let on = true;
    void draft.loadAll(film.pages.map((p) => p.id)).then((all) => {
      if (!on || !Object.keys(all).length) return;
      frame.load(all);
      // opened at the start: the first page as it stands once drawn (at 0 s nothing is on it yet)
      if (frame.clock.now.t < 0.05 && film.pages[0]) frame.seek(settled(film.pages[0]));
    });
    return () => { on = false; };
  }, [film]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!draft.notice) return;
    setToast(e.notice[draft.notice]);
    draft.clearNotice();
  }, [draft.notice]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selected, setSelected] = useState<number | null>(null);
  // lit on the picture (under the pointer there, or in the layers list), and what is off it for a moment (the eye):
  // the page shown next has all its things again
  const [hovered, setHovered] = useState<number | null>(null);
  const [peeked, setPeeked] = useState<ReadonlySet<number>>(() => new Set());
  // with Shift, several at once: `selected` the last one picked, `also` the others; dragged, nudged and deleted together
  const [also, setAlso] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => { setSelected(null); setAlso(new Set()); setHovered(null); setPeeked(new Set()); }, [current]);
  useEffect(() => { if (current) frame.peek(current, [...peeked]); }, [peeked, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPeek = useCallback((i: number) => {
    setPeeked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
    setSelected((x) => (x === i ? null : x));
    setAlso((s) => { if (!s.has(i)) return s; const n = new Set(s); n.delete(i); return n; });
  }, []);
  const [layersOn, setLayersOn] = useState(() => { try { return localStorage.getItem('cs-ed-layers') !== 'off'; } catch { return true; } });
  const flipLayers = useCallback(() => setLayersOn((v) => { try { localStorage.setItem('cs-ed-layers', v ? 'off' : 'on'); } catch {} return !v; }), []);
  const elements = useMemo(() => (frame.reported?.page === current ? frame.reported.elements : []), [frame.reported, current]);
  const pageInfo = draft.info(current);
  // each thing's hand edit (the page's ENGINE.edits): everything on the picture can be moved, scaled and deleted but a
  // background picture filling the stage
  const edits = useMemo(() => pageInfo?.edits ?? {}, [pageInfo]);
  /** a thing's edit: the one that names what it is (written when the page drew it under another number), else the
   *  one under its number that names nothing */
  const editFor = useCallback((x: Element): ItemEdit | undefined => {
    const byFp = x.fp ? Object.values(edits).find((e) => e.fp === x.fp) : undefined;
    const plain = edits[x.i];
    return byFp ?? (plain && !plain.fp ? plain : undefined);
  }, [edits]);
  const things = useMemo(() => new Map<number, Thing>(elements.map((x) => {
    const ed = editFor(x);
    return [x.i, { movable: x.kind !== 'scene', moved: !!ed && (ed.dx != null || ed.dy != null || ed.scale != null) }];
  })), [elements, editFor]);
  const el = selected == null ? undefined : elements.find((x) => x.i === selected);

  // ── changes: each a thing's whole edit, written in the page's ENGINE.edits ──
  const key = (page: string, i: number) => `${page}:${i}`;
  /** a thing as edited, and the point it is scaled about: its centre as its code draws it (taken once, before any
   *  move of this session is laid over it) */
  const editOf = useCallback((x: Element): ItemEdit => {
    const ed = { ...editFor(x), ...(x.fp ? { fp: x.fp } : {}) };
    const k = key(current, x.i);
    let o = origins.current.get(k);
    if (!o) {
      o = ed.ox != null && ed.oy != null ? { ox: ed.ox, oy: ed.oy }
        : { ox: Math.round(x.box.x + x.box.w / 2 - (ed.dx ?? 0)), oy: Math.round(x.box.y + x.box.h / 2 - (ed.dy ?? 0)) };
      origins.current.set(k, o);
    }
    return { ...ed, ...o };
  }, [editFor, current]);
  /** show the element moved by d on top of what the runtime shows already (relative to how it is drawn now) */
  const nudgeBy = useCallback((x: Element, d: Delta, keep: boolean) => {
    const k = key(current, x.i);
    const was = shownNudge.current.get(k) ?? zero;
    const total = { dx: was.dx + d.dx, dy: was.dy + d.dy, scale: was.scale * d.scale };
    if (keep) shownNudge.current.set(k, total);
    frame.nudge({ type: 'edit:nudge', page: current, i: x.i, ...total, ox: x.box.x + x.box.w / 2, oy: x.box.y + x.box.h / 2 });
  }, [current, frame]);
  const onNudge = useCallback((x: Element, d: Delta) => nudgeBy(x, d, false), [nudgeBy]);
  /** things moved by d together: one step (one undo takes them all back) */
  const onMove = useCallback((xs: Element[], d: Delta, typing = false) => {
    const ops = xs.filter((x) => things.get(x.i)?.movable).map((x): Op => {
      const ed = editOf(x);
      nudgeBy(x, d, true);
      return { kind: 'item', n: x.i, what: 'move', edit: { ...ed, dx: (ed.dx ?? 0) + d.dx, dy: (ed.dy ?? 0) + d.dy, scale: (ed.scale ?? 1) * d.scale } };
    });
    if (ops.length) draft.apply(current, ops, typing && ops.length === 1);
  }, [things, editOf, nudgeBy, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  // picking something on the picture stops the film there (what is picked must stay where it is to be dragged)
  const select = useCallback((i: number | null) => { if (i != null && clock.now.playing) frame.pause(); setSelected(i); setAlso(new Set()); }, [clock, frame]);
  /** several at once (a group's row in the layers list): the first is the one the bar is over */
  const selectAll = useCallback((is: number[]) => {
    if (!is.length) return;
    if (clock.now.playing) frame.pause();
    setSelected(is[0]); setAlso(new Set(is.slice(1)));
  }, [clock, frame]);
  /** Shift: one more, or one less */
  const toggle1 = useCallback((i: number) => {
    if (clock.now.playing) frame.pause();
    if (selected === i) {
      const [next] = [...also];
      setSelected(next ?? null);
      setAlso((s) => { const n = new Set(s); if (next != null) n.delete(next); return n; });
    } else if (also.has(i)) setAlso((s) => { const n = new Set(s); n.delete(i); return n; });
    else {
      if (selected != null) setAlso((s) => new Set(s).add(selected));
      setSelected(i);
    }
  }, [clock, frame, selected, also]);
  const group = useMemo(() => [selected, ...also].map((i) => elements.find((x) => x.i === i)).filter((x): x is Element => !!x && x.visible), [selected, also, elements]);
  // typing stops the film where it is: words can't be typed into a picture that moves on
  const onType = useCallback((x: Element, t: Element['texts'][number]) => {
    if (clock.now.playing) frame.pause();
    setSelected(x.i); setAlso(new Set());
    frame.type(current, t.id);
  }, [frame, clock, current]);
  const onHide = useCallback((x: Element) => {
    const xs = group.some((g) => g.i === x.i) ? group : [x];
    const ops = xs.filter((g) => things.get(g.i)?.movable).map((g): Op => ({ kind: 'item', n: g.i, what: 'hide', edit: { ...editFor(g), ...(g.fp ? { fp: g.fp } : {}), hidden: true } }));
    if (!ops.length) return;
    setSelected(null); setAlso(new Set());
    draft.apply(current, ops);
  }, [group, things, editFor, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const onReset = useCallback((x: Element) => {
    const { dx: _x, dy: _y, scale: _s, ox: _o, oy: _p, ...rest } = editFor(x) ?? {};
    origins.current.delete(key(current, x.i));
    draft.apply(current, { kind: 'item', n: x.i, what: 'move', edit: { ...rest, ...(x.fp ? { fp: x.fp } : {}) } });
  }, [editFor, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  // edits whose thing this page no longer draws (the director changed the page after them): said, and cleared on a click
  const orphans = frame.reported?.page === current ? frame.reported.orphans : [];
  const clearOrphans = useCallback(() => {
    draft.apply(current, orphans.map((n): Op => ({ kind: 'item', n, edit: null, what: 'move' })));
  }, [orphans, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  // what can't be done by hand is offered to the director: words that change as the film plays open 让 AI 改
  const [asking, setAsking] = useState<Asking | null>(null);
  // it closes when what it was opened on is no longer what is selected (not while it is being sent)
  useEffect(() => setAsking((a) => (a && (a.busy || a.for === selected) ? a : null)), [selected, current]);
  const onRefuse = useCallback((why: 'move' | 'text', i?: number) => {
    if (why === 'move') setToast(e.cantMove);
    else setAsking({ hint: e.aiLive, busy: false, for: i ?? null });
  }, [e]);
  // what was typed into the preview: the thing's words in its edit; the keys come back to the editor
  frame.onTyped.current = (m: Extract<FromFrame, { type: 'edit:typed' }>) => {
    const x = elements.find((y) => y.i === m.n);
    if (m.value != null && m.page === current && x) {
      const ed = editFor(x) ?? {};
      draft.apply(current, { kind: 'item', n: m.n, what: 'text', words: m.value, edit: { ...ed, ...(x.fp ? { fp: x.fp } : {}), text: { ...ed.text, [m.j]: m.value } } });
    } else if (m.empty) setToast(e.emptyText);
    root.current?.focus({ preventScroll: true });
  };

  // ── keys: ⌘Z / ⇧⌘Z, Space, arrows, Esc ──
  const [ask, setAsk] = useState<Ask | null>(null);
  const toggle = useCallback(() => { if (clock.now.playing) frame.pause(); else frame.seek(clock.now.t, true); }, [clock, frame]);
  const keys = useRef<(x: KeyboardEvent) => void>(() => {});
  keys.current = (x) => {
    if (ask || x.defaultPrevented || x.isComposing) return;
    const mod = x.metaKey || x.ctrlKey;
    if (mod && (x.key === 'z' || x.key === 'Z')) { if (editable(x.target)) return; x.preventDefault(); void (x.shiftKey ? draft.redo() : draft.undo()); return; }
    if (mod && (x.key === 'y' || x.key === 'Y')) { if (editable(x.target)) return; x.preventDefault(); void draft.redo(); return; }
    if (editable(x.target) || mod || x.altKey) return;
    if (x.code === 'Space') { if (x.target instanceof HTMLButtonElement && !(x.target as HTMLElement).closest('.cs-ed-overlay')) return; x.preventDefault(); toggle(); return; }
    if (x.key === 'Escape') { if (selected != null) { x.preventDefault(); setSelected(null); setAlso(new Set()); } return; }
    if ((x.key === 'Delete' || x.key === 'Backspace') && el && !playing) { x.preventDefault(); onHide(el); return; }
    if (x.key === 'Enter' && el && !playing && !(x.target instanceof HTMLButtonElement)) {
      const t = el.texts.find((y) => !y.live);
      if (t) { x.preventDefault(); onType(el, t); }
      return;
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[x.key];
    if (arrow && el && !playing) {
      if (!group.some((g) => things.get(g.i)?.movable)) return;
      x.preventDefault();
      const step = x.shiftKey ? 10 : 1;
      onMove(group, { dx: arrow[0] * step, dy: arrow[1] * step, scale: 1 }, true);
    }
  };
  useEffect(() => {
    const on = (x: KeyboardEvent) => keys.current(x);
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  // the studio behind is out of reach while editing
  useEffect(() => {
    const page = document.getElementById('root');
    page?.setAttribute('inert', '');
    return () => page?.removeAttribute('inert');
  }, []);

  // ── the draft as a whole ──
  const [busy, setBusy] = useState(false);
  const leave = useCallback(() => { frame.pause(); onExit(changedFilm.current); }, [frame, onExit]);
  const reloadAll = () => { setGen((g) => ({ n: g.n + 1, from: clock.now.t })); shownNudge.current.clear(); origins.current.clear(); };
  const save = async (label: string, then?: boolean) => {
    setBusy(true);
    try {
      await draft.settle();
      const r = await edit.save(id, label.trim() || undefined);
      changedFilm.current = true;
      draft.reset();
      setAsk(null);
      if (then) { leave(); return; }
      setToast(r.version ? e.saved(r.version.n) : e.allSaved);
    } catch { setToast(e.saveFailed); } finally { setBusy(false); }
  };
  const discard = async (then?: boolean) => {
    setBusy(true);
    try {
      await draft.settle();
      await edit.drop(id);
      draft.reset();
      setAsk(null);
      if (then) { leave(); return; }
      reloadAll();
      setToast(e.discarded);
    } catch { setToast(e.discardFailed); } finally { setBusy(false); }
  };
  const restore = async (v: Version) => {
    setBusy(true);
    try {
      await draft.settle();
      await edit.restore(id, v.n);
      changedFilm.current = true;
      draft.reset();
      setAsk(null);
      reloadAll();
      setToast(e.restored(v.n));
    } catch { setToast(e.restoreFailed); } finally { setBusy(false); }
  };
  const back = () => { if (draft.dirty) setAsk({ kind: 'leave' }); else leave(); };

  const status = draft.waiting ? e.sending : draft.count > 0 ? e.unsaved(draft.count) : draft.dirty ? e.unsavedOld : e.allSaved;
  // an element by what it is (the drawing call's own name: 圆, 箭头…); one that shows words goes by its words
  const name = useCallback((x: Element) => {
    const call = x.call;
    // a style's own kit names its calls after the engine's with a letter before (vlabel, vsky): read as the engine's
    const known = call ? e.calls[call] ?? e.calls[call.slice(1)] : undefined;
    return known ?? e.kinds[x.kind] ?? x.kind;
  }, [e]);
  const label = useCallback((x: Element) => x.texts.map((t) => t.value).join(' ').trim() || name(x), [name]);
  const canvasLabels = useMemo(() => ({ stage: e.stage, hint: e.stageHint, frame: e.stage, editText: e.editText, remove: e.remove, removeKey: e.removeKey, resetPlace: e.resetPlace, underHere: e.underHere,
    ai: e.ai, aiPlaceholder: e.aiPlaceholder, aiSend: e.aiSend, aiSending: e.aiSending, aiClose: e.cancel,
    color: e.color, colorOriginal: e.colorOriginal, colorName: (n: string) => e.palette[n] ?? n, element: label }), [e, label]);
  /** the selection drawn in one of the style's colours (null: as its code draws it), all of it as one step */
  const onColor = useCallback((name: string | null) => {
    const xs = group.length ? group : el ? [el] : [];
    const ops = xs.filter((x) => things.get(x.i)?.movable).map((x): Op => {
      const { color: _c, ...ed } = editFor(x) ?? {};
      return { kind: 'item', n: x.i, what: 'color', edit: { ...ed, ...(x.fp ? { fp: x.fp } : {}), ...(name ? { color: name } : {}) } };
    });
    if (ops.length) draft.apply(current, ops);
  }, [group, el, things, editFor, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the selection shown dt seconds later (earlier below 0), all of it as one step */
  const onShift = useCallback((dt: number) => {
    const xs = group.length ? group : el ? [el] : [];
    const ops = xs.filter((x) => things.get(x.i)?.movable).map((x): Op => {
      const ed = editFor(x) ?? {};
      return { kind: 'item', n: x.i, what: 'time', edit: { ...ed, ...(x.fp ? { fp: x.fp } : {}), shift: Math.round(((ed.shift ?? 0) + dt) * 10) / 10 } };
    });
    if (ops.length) draft.apply(current, ops);
  }, [group, el, things, editFor, draft.apply, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const colorOf = useMemo(() => {
    const xs = group.length ? group : el ? [el] : [];
    const cs = new Set(xs.map((x) => editFor(x)?.color ?? null));
    return cs.size === 1 ? [...cs][0] : null;
  }, [group, el, editFor]);
  /** 让 AI 改: the hand edits saved first (as a version: the director changes the film as it is now), then the words go
   *  to the director with each selected thing (where it is, what draws it, the film at this moment) and the editor
   *  closes on the workbench, where the director is seen at work */
  const askAi = useCallback(async (text: string) => {
    const xs = (group.length ? group : el ? [el] : []).slice(0, 12);
    if (!xs.length) return;
    setAsking((a) => ({ for: selected, ...a, busy: true }));
    try {
      await draft.settle();
      if (draft.dirty) { await edit.save(id); changedFilm.current = true; draft.reset(); }
      const t = clock.now.t;
      const { paths } = await edit.frames(id, [t]).catch(() => ({ paths: [] as string[] }));
      const refs = xs.map((x) => ({ kind: 'thing', page: x.page, label: label(x).slice(0, 80), at: Math.round(t * 10) / 10, box: x.box, ...(x.fp ? { fp: x.fp } : {}), ...(paths[0] ? { path: paths[0] } : {}) }));
      await edit.say(id, text, refs);
      setAsking(null);
      leave();
    } catch { setAsking((a) => (a ? { ...a, busy: false } : a)); setToast(e.aiFailed); }
  }, [group, el, selected, draft, id, lang, clock, label, leave, e]); // eslint-disable-line react-hooks/exhaustive-deps
  const onTypeText = useCallback((x: Element, id: number) => { const t = x.texts.find((y) => y.id === id); if (t && !t.live) onType(x, t); }, [onType]);
  const where = useClock(clock, (k) => {
    const n = film?.pages.findIndex((p) => p.id === current) ?? -1;
    const s = Math.max(0, k.t);
    return `${n >= 0 ? e.pageN(n + 1) : ''} · ${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  });
  const seekTo = useCallback((t: number) => frame.seek(t), [frame]);
  const [zoom, setZoom] = useState(0);
  const onZoom = useCallback((z: number | 'fit') => setZoom(z === 'fit' ? 0 : z), []);
  const clip = useMemo(() => (el ? { start: el.start, end: el.end, label: label(el) } : undefined), [el, label]);
  const frameErr = frame.error && frame.error.page === current ? e.frameError(frame.error.message) : undefined;

  return createPortal(
    <div className="cs-ed" role="region" aria-label={`${e.edit} · ${title ?? ''}`} ref={root} tabIndex={-1}>
      {/* laid out as the workbench's own bar: the film's title on the left, the switch between 预览 and 编辑 at the right,
          where it was before the switch */}
      <header className="cs-ed-top">
        <button type="button" className={`cs-ed-icon${layersOn ? ' is-on' : ''}`} onClick={flipLayers} aria-pressed={layersOn} aria-label={e.layers.toggle} title={e.layers.toggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></svg>
        </button>
        <b className="cs-ed-title" title={title}>{title}</b>
        <div className="cs-ed-history">
          <button type="button" className="cs-ed-icon" onClick={() => void draft.undo()} disabled={!draft.canUndo || busy} aria-label={e.undo} title={e.undoKey}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" /></svg>
          </button>
          <button type="button" className="cs-ed-icon" onClick={() => void draft.redo()} disabled={!draft.canRedo || busy} aria-label={e.redo} title={e.redoKey}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7l4.5 4.5L15 16M19 11.5H9.5a5 5 0 0 0 0 10H12" /></svg>
          </button>
        </div>
        <span className={`cs-ed-status${draft.dirty ? ' is-dirty' : ''}`} role="status">{status}</span>
        <span className="cs-sp" />
        <Versions id={id} blocked={draft.dirty} onRestore={(v) => setAsk({ kind: 'restore', v })} />
        <button type="button" className="cs-ed-btn" disabled={!draft.dirty || busy} onClick={() => setAsk({ kind: 'discard' })}>{e.discard}</button>
        <button type="button" className="cs-ed-btn is-go" disabled={!draft.dirty || busy} onClick={() => setAsk({ kind: 'save' })}>{e.save}</button>
        <i className="cs-ed-rule" aria-hidden="true" />
        <div className="cs-filmmode" role="group" aria-label={e.mode}>
          <button type="button" aria-pressed={false} onClick={back}>{e.preview}</button>
          <button type="button" aria-pressed={true} className="is-on">{e.edit}</button>
        </div>
      </header>

      <main className={`cs-ed-body${layersOn ? ' has-layers' : ''}`}>
        {layersOn && (
          <Layers elements={playing ? [] : elements} selected={selected} also={also} onToggle={toggle1} onSelectAll={selectAll} hovered={hovered} peeked={peeked} paper={frame.reported?.paper ?? null}
            where={where} copy={e.layers} name={label} onSelect={select} onHover={setHovered} onPeek={onPeek} onType={onTypeText} />
        )}
        <div className="cs-ed-stage">
          <Canvas stage={stage} frame={frame.frame} src={src} elements={elements} things={things}
            selected={selected} also={also} onToggle={toggle1} hovered={hovered} paper={frame.reported?.paper ?? null} playing={playing} loading={film ? null : e.loading} typing={frame.typing} labels={canvasLabels}
            pick={frame.pick} palette={film?.palette ?? []} colorOf={colorOf} onColor={onColor} asking={asking} onAsk={(t) => void askAi(t)} onAskOpen={() => setAsking({ busy: false, for: selected })} onAskClose={() => setAsking(null)} onPause={frame.pause} onSelect={select} onHover={setHovered} onNudge={onNudge} onMove={onMove} onType={onType} onHide={onHide} onReset={onReset} onRefuse={onRefuse} />
          {(toast || frameErr) && <p className="cs-ed-toast" role="status">{toast ?? frameErr}</p>}
          {orphans.length > 0 && !playing && (
            <p className="cs-ed-orphans" role="status">
              <span>{e.orphans(orphans.length)}</span>
              <button type="button" onClick={clearOrphans}>{e.clearOrphans}</button>
            </p>
          )}
        </div>
      </main>
      <footer className="cs-ed-foot">
        <Transport clock={clock} onToggle={toggle} disabled={!frame.booted} zoom={zoom} onZoom={onZoom} />
        <Timeline pages={film?.pages ?? []} clock={clock} project={project} current={current} touched={draft.touched}
          selected={clip} zoom={zoom} onZoom={onZoom} onSeek={seekTo} onShift={el && things.get(el.i)?.movable ? onShift : undefined} />
      </footer>

      {ask?.kind === 'leave' && (
        <Dialog title={e.leaveTitle} says={e.leaveSays} onClose={() => setAsk(null)} busy={busy}>
          <div className="cs-ed-dialog-acts">
            <button type="button" className="cs-ed-btn" data-first onClick={() => setAsk(null)}>{e.keepEditing}</button>
            <button type="button" className="cs-ed-btn is-danger" onClick={() => setAsk({ kind: 'discard', leave: true })}>{e.discard}</button>
            <button type="button" className="cs-ed-btn is-go" onClick={() => setAsk({ kind: 'save', leave: true })}>{e.save}</button>
          </div>
        </Dialog>
      )}
      {ask?.kind === 'save' && <SaveDialog id={id} busy={busy} onCancel={() => setAsk(null)} onSave={(l) => void save(l, ask.leave)} />}
      {ask?.kind === 'discard' && (
        <Dialog title={e.discardTitle} says={e.discardSays} onClose={() => setAsk(null)} busy={busy}>
          <div className="cs-ed-dialog-acts">
            <button type="button" className="cs-ed-btn" data-first onClick={() => setAsk(null)} disabled={busy}>{e.cancel}</button>
            <button type="button" className="cs-ed-btn is-danger" onClick={() => void discard(ask.leave)} disabled={busy}>{busy ? e.discarding : e.discard}</button>
          </div>
        </Dialog>
      )}
      {ask?.kind === 'restore' && (
        <Dialog title={e.restoreTitle} says={e.restoreSays(e.versionName(ask.v.n, ask.v.label, ask.v.kind))} onClose={() => setAsk(null)} busy={busy}>
          <div className="cs-ed-dialog-acts">
            <button type="button" className="cs-ed-btn" data-first onClick={() => setAsk(null)} disabled={busy}>{e.cancel}</button>
            <button type="button" className="cs-ed-btn is-go" onClick={() => void restore(ask.v)} disabled={busy}>{busy ? e.restoring : e.restore}</button>
          </div>
        </Dialog>
      )}
    </div>,
    document.body,
  );
}

/** a version is named by its number (第 6 版) unless the person names it: the field holds the number it will get */
function SaveDialog({ id, busy, onCancel, onSave }: { id: string; busy: boolean; onCancel: () => void; onSave: (label: string) => void }) {
  const e = useShellCopy().editor;
  const [v, setV] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let gone = false;
    edit.versions(id).then(({ versions }) => {
      if (gone) return;
      const n = versions.reduce((m, x) => Math.max(m, x.n), 0) + 1;
      setV((was) => was || e.versionN(n));
      requestAnimationFrame(() => field.current?.select());
    }).catch(() => {});
    return () => { gone = true; };
  }, [id, e]);
  return (
    <Dialog title={e.saveTitle} onClose={onCancel} busy={busy}>
      <form onSubmit={(x) => { x.preventDefault(); if (!busy) onSave(v); }}>
        <label className="cs-ed-dialog-field">
          <span>{e.saveName}</span>
          <input ref={field} className="cs-ed-in" value={v} maxLength={80} onChange={(x) => setV(x.target.value)} onFocus={(x) => x.target.select()} />
          <small>{e.saveHint}</small>
        </label>
        <div className="cs-ed-dialog-acts">
          <button type="button" className="cs-ed-btn" onClick={onCancel} disabled={busy}>{e.cancel}</button>
          <button type="submit" className="cs-ed-btn is-go" disabled={busy}>{busy ? e.saving : e.saveGo}</button>
        </div>
      </form>
    </Dialog>
  );
}
