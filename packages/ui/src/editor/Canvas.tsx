// The middle of the editor: the edit-mode preview (an iframe that takes no pointer events), scaled to fit with the
// stage's ratio, and an overlay above it that takes every pointer. What a press lands on is what the preview itself
// finds drawn there (edit:pick): a word's box, a line's ink, never the empty layers they sit in, words before anything
// else. Pressing the selection drags it (Shift locks an axis; a corner scales around its centre; edges snap to the
// stage's centre lines and the other things' edges within 6 px); a click that does not move picks what is there, and
// a click again on the same spot picks the next thing down. A right click lists everything there. Double-clicking words
// types into them where they are (the runtime makes them editable in their own hand and size).
// The drag is shown live by the runtime (onNudge, relative to how it is drawn now); the release is one change (onMove).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { Thumb } from './Layers';
import type { Box, Element, Picked, Swatch } from './types';

export interface Delta { dx: number; dy: number; scale: number }
/** what can be done to a thing on the picture: moved (and scaled, deleted); moved before (it can be put back) */
export interface Thing { movable: boolean; moved: boolean }
type Text = Element['texts'][number];
const SNAP_PX = 6;
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
type Corner = typeof CORNERS[number];

/** the box moved by d, snapped: what to add to d, and where the guides are (stage px) */
export function snap(b: Box, others: Box[], stage: { w: number; h: number }, tol: number, axes: { x: boolean; y: boolean }) {
  const one = (moving: number[], targets: number[]) => {
    let best: { by: number; at: number } | undefined;
    for (const m of moving) for (const t of targets) {
      const by = t - m;
      if (Math.abs(by) <= tol && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, at: t };
    }
    return best;
  };
  const gx = axes.x ? one([b.x, b.x + b.w / 2, b.x + b.w], [stage.w / 2, ...others.flatMap((o) => [o.x, o.x + o.w])]) : undefined;
  const gy = axes.y ? one([b.y, b.y + b.h / 2, b.y + b.h], [stage.h / 2, ...others.flatMap((o) => [o.y, o.y + o.h])]) : undefined;
  return { ax: gx?.by ?? 0, ay: gy?.by ?? 0, gx: gx?.at, gy: gy?.at };
}

/** the text of an element under a point (stage px): the one whose box holds it, else the nearest, else none */
export function textAt(el: Element, x: number, y: number): Text | undefined {
  const inside = el.texts.filter((t) => x >= t.box.x - 4 && x <= t.box.x + t.box.w + 4 && y >= t.box.y - 4 && y <= t.box.y + t.box.h + 4);
  const pool = inside.length ? inside : el.texts;
  const d = (t: Text) => Math.hypot(t.box.x + t.box.w / 2 - x, t.box.y + t.box.h / 2 - y);
  return [...pool].sort((a, b) => d(a) - d(b))[0];
}

interface Drag {
  /** the one pressed, and every thing moved with it (itself among them) */
  el: Element; els: Element[]; corner?: Corner; x0: number; y0: number; start: Box; others: Box[];
  delta: Delta; box: Box; guides: { gx?: number; gy?: number }; moved: boolean;
}

export interface CanvasLabels {
  stage: string; hint: string; frame: string; editText: string; remove: string; removeKey: string; resetPlace: string; underHere: string;
  ai: string; aiPlaceholder: string; aiSend: string; aiSending: string; aiClose: string;
  color: string; colorOriginal: string; colorName: (name: string) => string;
  element: (e: Element) => string;
}
/** 让 AI 改 open on the selection: `hint` is what the box asks (words that change as the film plays say so) */
export interface Asking { hint?: string; busy: boolean; /** the thing it was opened on */ for: number | null }
/** the same spot, for "click again picks the next thing down" (screen px) */
const SAME_SPOT = 4;

export function Canvas({ stage, frame, src, elements, things, selected, also, onToggle, hovered, paper, playing, loading, typing, labels, pick, asking, onAsk, onAskOpen, onAskClose, palette, colorOf, onColor, onPause, onSelect, onHover, onNudge, onMove, onType, onHide, onReset, onRefuse }: {
  stage: { w: number; h: number }; frame: RefObject<HTMLIFrameElement | null>; src: string;
  elements: Element[]; things: Map<number, Thing>; selected: number | null; playing: boolean; loading: string | null;
  /** picked along with `selected` (Shift-click adds or takes away one): all of them are dragged together */
  also: ReadonlySet<number>; onToggle: (i: number) => void;
  /** lit on the picture: under the pointer here, or under it in the layers list */
  hovered: number | null; paper: string | null;
  /** what is drawn under a point (stage px), topmost first */
  pick: (x: number, y: number) => Promise<Picked[]>;
  onHover: (i: number | null) => void;
  /** the text being typed into, where it is now (stage px), or null */
  typing: Box | null;
  labels: CanvasLabels;
  /** a press on the picture while it plays stops it there, to pick what is on it */
  onPause: () => void;
  onSelect: (i: number | null) => void; onNudge: (el: Element, d: Delta) => void; onMove: (els: Element[], d: Delta) => void;
  onType: (el: Element, text: Text) => void; onHide: (el: Element) => void; onReset: (el: Element) => void;
  /** something asked of the picture that cannot be done: why */
  onRefuse: (why: 'move' | 'text', i?: number) => void;
  /** 让 AI 改: the box open on the selection, and what is said in it, sent */
  asking: Asking | null; onAsk: (text: string) => void; onAskOpen: () => void; onAskClose: () => void;
  /** the style's colours, the selection's own (its edit's, if all of it has one), and one chosen (null: as drawn) */
  palette: Swatch[]; colorOf: string | null; onColor: (name: string | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const k = Math.max(0, Math.min(w / stage.w, h / stage.h));
      setSize({ w: Math.floor(stage.w * k), h: Math.floor(stage.h * k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage.w, stage.h]);
  const k = size.w / stage.w || 1;

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const byI = useCallback((i: number) => elements.find((e) => e.i === i), [elements]);
  const at = useCallback((e: { clientX: number; clientY: number }) => {
    const r = screen.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }, [k]);
  const inside = (b: Box, p: { x: number; y: number }) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2;

  const begin = useCallback((e: { clientX: number; clientY: number }, els: Element[], corner?: Corner) => {
    const el = els[0], start = union(els.map((x) => x.box));
    const d: Drag = {
      el, els, corner, x0: e.clientX, y0: e.clientY, start, box: start,
      others: elements.filter((o) => !els.some((x) => x.i === o.i) && o.visible && o.kind !== 'scene').map((o) => o.box),
      delta: { dx: 0, dy: 0, scale: 1 }, guides: {}, moved: false,
    };
    dragRef.current = d;
    setDrag(d);
  }, [elements]);

  // the last click that picked (screen px): a click again there picks the next thing down
  const last = useRef<{ x: number; y: number } | null>(null);
  /** a press on the selection, not yet a drag: on release without moving, it is a click that picks */
  const pressed = useRef<{ stack: Promise<Picked[]>; x: number; y: number } | null>(null);
  const held = useRef(false);
  const down = useCallback(async (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setMenu(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e), pt = { clientX: e.clientX, clientY: e.clientY };
    // Shift: what is there joins the selection, or leaves it
    if (e.shiftKey) {
      pressed.current = null;
      const stack = await pick(p.x, p.y);
      if (stack.length) onToggle(stack[0].i);
      return;
    }
    const group = [selected, ...also].map((i) => (i == null ? undefined : byI(i))).filter((x): x is Element => !!x?.visible);
    const hit = group.find((x) => inside(x.box, p));
    if (hit) {
      held.current = true;
      pressed.current = { stack: pick(p.x, p.y), x: e.clientX, y: e.clientY };
      begin(pt, [hit, ...group.filter((x) => x !== hit)]);
      return;
    }
    pressed.current = null;
    held.current = true;
    const stack = await pick(p.x, p.y);
    const top = stack.length ? byI(stack[0].i) : undefined;
    last.current = top ? { x: pt.clientX, y: pt.clientY } : null;
    onSelect(top ? top.i : null);
    // still held once the answer came (a frame, usually): what it picked is dragged from where the press began
    if (top && held.current) begin(pt, [top]);
  }, [at, selected, also, byI, pick, begin, onSelect, onToggle]);

  const move = useCallback((e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    let dx = (e.clientX - d.x0) / k, dy = (e.clientY - d.y0) / k;
    if (!d.moved && Math.hypot(dx * k, dy * k) < 3) return;
    if (!d.els.some((x) => things.get(x.i)?.movable)) { dragRef.current = null; setDrag(null); pressed.current = null; onRefuse('move'); return; }
    const s0 = d.start;
    const cx = s0.x + s0.w / 2, cy = s0.y + s0.h / 2;
    const r = screen.current?.getBoundingClientRect();
    let next: Drag;
    if (d.corner && r) {
      // the ratio kept, around the centre: the pointer's distance from it, against where it started
      const p0 = Math.hypot(d.x0 - (r.left + cx * k), d.y0 - (r.top + cy * k));
      const p1 = Math.hypot(e.clientX - (r.left + cx * k), e.clientY - (r.top + cy * k));
      const scale = Math.max(0.1, Math.min(10, p0 > 0 ? p1 / p0 : 1));
      const w = s0.w * scale, h = s0.h * scale;
      next = { ...d, moved: true, delta: { dx: 0, dy: 0, scale }, box: { x: cx - w / 2, y: cy - h / 2, w, h }, guides: {} };
    } else {
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      const lockX = e.shiftKey && dx === 0, lockY = e.shiftKey && dy === 0;
      const raw = { ...s0, x: s0.x + dx, y: s0.y + dy };
      const sn = e.altKey ? { ax: 0, ay: 0, gx: undefined, gy: undefined } : snap(raw, d.others, stage, SNAP_PX / k, { x: !lockX, y: !lockY });
      dx += sn.ax; dy += sn.ay;
      next = { ...d, moved: true, delta: { dx, dy, scale: 1 }, box: { ...s0, x: s0.x + dx, y: s0.y + dy }, guides: { gx: sn.gx, gy: sn.gy } };
    }
    pressed.current = null;
    last.current = null;
    dragRef.current = next;
    setDrag(next);
    for (const x of d.els) if (things.get(x.i)?.movable) onNudge(x, next.delta);
  }, [k, stage, things, onNudge, onRefuse]);

  // the pointer resting on the picture: what a click would pick is lit (asked once a frame, the latest answer kept)
  const hoverAsk = useRef<{ x: number; y: number; raf: number } | null>(null);
  const hoverSeq = useRef(0);
  const over = useCallback((e: RPointerEvent) => {
    if (dragRef.current) { move(e); return; }
    if (e.buttons) return;
    const p = at(e);
    if (hoverAsk.current) { hoverAsk.current.x = p.x; hoverAsk.current.y = p.y; return; }
    hoverAsk.current = { ...p, raf: requestAnimationFrame(() => {
      const q = hoverAsk.current; hoverAsk.current = null;
      if (!q) return;
      const n = ++hoverSeq.current;
      void pick(q.x, q.y).then((stack) => { if (n === hoverSeq.current) onHover(stack[0]?.i ?? null); });
    }) };
  }, [at, move, pick, onHover]);
  useEffect(() => () => { if (hoverAsk.current) cancelAnimationFrame(hoverAsk.current.raf); }, []);
  const leave = useCallback(() => { hoverSeq.current++; onHover(null); }, [onHover]);

  const end = useCallback(async (e: RPointerEvent) => {
    held.current = false;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d?.moved) {
      const { dx, dy, scale } = d.delta;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5 || Math.abs(scale - 1) >= 0.002) onMove(d.els, d.delta);
      return;
    }
    // a click on the selection: what is there, or the next thing down when it is the same spot again
    const pr = pressed.current;
    pressed.current = null;
    if (!pr || e.type === 'pointercancel') return;
    const stack = await pr.stack;
    const again = last.current && Math.hypot(pr.x - last.current.x, pr.y - last.current.y) <= SAME_SPOT;
    last.current = { x: pr.x, y: pr.y };
    if (!stack.length) { onSelect(null); return; }
    const was = stack.findIndex((x) => x.i === selected);
    onSelect(again && was >= 0 ? stack[(was + 1) % stack.length].i : stack[0].i);
  }, [onMove, onSelect, selected]);

  // a drag given up (Esc): the element goes back to where it was drawn
  useEffect(() => {
    if (!drag) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      e.preventDefault(); e.stopPropagation();
      const d = dragRef.current;
      dragRef.current = null; setDrag(null);
      for (const x of d.els) onNudge(x, { dx: 0, dy: 0, scale: 1 });
    };
    addEventListener('keydown', esc, true);
    return () => removeEventListener('keydown', esc, true);
  }, [drag, onNudge]);

  /** type into the text under the pointer (stage px), or the element's only one */
  const typeAt = useCallback((el: Element, x?: number, y?: number) => {
    const t = x == null || y == null ? el.texts.find((x) => !x.live) : textAt(el, x, y);
    if (!t) return;
    if (t.live) { onRefuse('text', el.i); return; }
    onType(el, t);
  }, [onType, onRefuse]);
  // a double-click types into the very words under it, whatever is selected
  const dbl = useCallback(async (e: RMouseEvent) => {
    const p = at(e);
    const stack = await pick(p.x, p.y);
    const hit = stack.find((x) => x.text != null);
    const el = hit && byI(hit.i), t = el?.texts.find((x) => x.id === hit!.text);
    if (!el || !t) {
      // words that are not to be typed over (a counter that writes itself as the film plays): said so
      const top = stack.length ? byI(stack[0].i) : undefined;
      if (top?.wordy) { onSelect(top.i); onRefuse('text', top.i); }
      return;
    }
    onSelect(el.i);
    if (t.live) { onRefuse('text', el.i); return; }
    onType(el, t);
  }, [at, pick, byI, onSelect, onType, onRefuse]);

  // a right click: everything drawn there, the topmost first
  const [menu, setMenu] = useState<{ x: number; y: number; items: Element[] } | null>(null);
  const context = useCallback(async (e: RMouseEvent) => {
    e.preventDefault();
    const p = at(e);
    const items = (await pick(p.x, p.y)).map((x) => byI(x.i)).filter((x): x is Element => !!x);
    setMenu(items.length ? { x: p.x * k, y: p.y * k, items } : null);
  }, [at, pick, byI, k]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement)?.closest?.('.cs-ed-under')) setMenu(null); };
    addEventListener('keydown', close, true);
    addEventListener('pointerdown', close, true);
    return () => { removeEventListener('keydown', close, true); removeEventListener('pointerdown', close, true); };
  }, [menu]);
  useEffect(() => { if (playing || loading || typing) setMenu(null); }, [playing, loading, typing]);

  // the colours open on the selection: closed when the selection changes
  const [coloring, setColoring] = useState(false);
  useEffect(() => setColoring(false), [selected]);
  const sel = selected == null ? undefined : elements.find((e) => e.i === selected && e.visible);
  const others = elements.filter((e) => also.has(e.i) && e.visible);
  const many = !!sel && others.length > 0;
  // several: each keeps its own line and they move as one box (no corners: a group is moved, not scaled)
  // (from where each was when the drag began: the picture's own report follows the drag meanwhile)
  const dragged = (x: Element) => {
    const y = drag?.moved ? drag.els.find((z) => z.i === x.i) : undefined;
    return y ? { ...y.box, x: y.box.x + drag!.delta.dx, y: y.box.y + drag!.delta.dy } : x.box;
  };
  const selBox = many ? union([sel!, ...others].map(dragged)) : drag && drag.el.i === selected ? drag.box : sel?.box;
  const hov = hovered != null && hovered !== selected && !also.has(hovered) && !drag ? elements.find((e) => e.i === hovered && e.visible && e.kind !== 'scene') : undefined;
  const st = selected == null ? undefined : things.get(selected);
  const typable = !many && !!sel?.texts.some((t) => !t.live);
  const anyMovable = many ? [sel!, ...others].some((x) => things.get(x.i)?.movable) : !!st?.movable;

  return (
    <div className="cs-ed-canvas" ref={wrap}>
      <div className="cs-ed-screen" ref={screen} style={{ width: size.w, height: size.h }}>
        <iframe ref={frame} src={src} title={labels.frame} className={`cs-ed-frame${typing ? ' is-typing' : ''}`}
          sandbox="allow-scripts allow-same-origin" allow="autoplay" />
        {loading && <p className="cs-ed-loading" role="status"><i aria-hidden="true" />{loading}</p>}
        {typing && <i className="cs-ed-typing" style={boxStyle(pad(typing, 6 / k), k)} aria-hidden="true" />}
        {playing && !loading && <div className="cs-ed-overlay" aria-hidden="true" onPointerDown={(e) => { if (e.button === 0) onPause(); }} />}
        {!playing && !loading && !typing && (
          <div className={`cs-ed-overlay is-picking${drag?.moved ? ' is-dragging' : ''}`} role="group" aria-label={labels.stage}
            onPointerDown={(e) => void down(e)} onPointerMove={over} onPointerUp={(e) => void end(e)} onPointerCancel={(e) => void end(e)}
            onPointerLeave={leave} onDoubleClick={(e) => void dbl(e)} onContextMenu={(e) => void context(e)}>
            {hov && <i className="cs-ed-hover" style={boxStyle(pad(hov.box, 3 / k), k)} aria-hidden="true" />}
            {many && [sel!, ...others].map((x) => <i key={x.i} className="cs-ed-sel is-member" style={boxStyle(dragged(x), k)} aria-hidden="true" />)}
            {selBox && <i className={`cs-ed-sel${many ? ' is-group' : st?.movable ? '' : ' is-fixed'}`} style={boxStyle(many ? pad(selBox, 6 / k) : selBox, k)} aria-hidden="true" />}
            {selBox && !many && st?.movable && (
              <div className="cs-ed-handles" style={boxStyle(selBox, k)} aria-hidden="true">
                {CORNERS.map((c) => (
                  <i key={c} className={`cs-ed-handle is-${c}`} onPointerDown={(e) => {
                    const el = drag?.el ?? sel;
                    if (e.button !== 0 || !el) return;
                    e.stopPropagation();
                    pressed.current = null;
                    held.current = true;
                    (e.currentTarget.closest('.cs-ed-overlay') as HTMLElement).setPointerCapture(e.pointerId);
                    begin(e, [el], c);
                  }} />
                ))}
              </div>
            )}
            {sel && selBox && !drag?.moved && (
              <div className={`cs-ed-bar${selBox.y * k < 52 ? ' is-below' : ''}`}
                style={{ left: Math.min(Math.max(selBox.x * k, 0), size.w - 8), top: selBox.y < 52 / k ? (selBox.y + selBox.h) * k + 10 : selBox.y * k - 10 }}
                onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                {typable && (
                  <button type="button" onClick={() => typeAt(sel)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h14v2M12 5v14M9 19h6" /></svg>{labels.editText}
                  </button>
                )}
                {!many && st?.moved && (
                  <button type="button" onClick={() => onReset(sel)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>{labels.resetPlace}
                  </button>
                )}
                {anyMovable && (
                  <button type="button" className="is-danger" onClick={() => onHide(sel)} title={labels.removeKey}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>{labels.remove}
                  </button>
                )}
                {anyMovable && palette.length > 0 && (
                  <button type="button" className={coloring ? 'is-on' : undefined} aria-expanded={coloring} onClick={() => { setColoring((v) => !v); onAskClose(); }}>
                    <i className="cs-ed-dot" style={{ background: palette.find((p) => p.name === colorOf)?.hex }} aria-hidden="true" />{labels.color}
                  </button>
                )}
                <i className="cs-ed-bar-rule" aria-hidden="true" />
                <button type="button" className={`is-ai${asking ? ' is-on' : ''}`} aria-expanded={!!asking} onClick={() => { setColoring(false); if (asking) onAskClose(); else onAskOpen(); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></svg>{labels.ai}
                </button>
              </div>
            )}
            {sel && selBox && coloring && !asking && !drag?.moved && (
              <div className="cs-ed-swatches" role="radiogroup" aria-label={labels.color} onPointerDown={(e) => e.stopPropagation()}
                style={{ left: Math.min(Math.max(selBox.x * k, 0), size.w - 300), ...((selBox.y + selBox.h) * k + 70 < size.h ? { top: (selBox.y + selBox.h) * k + 12 } : { bottom: size.h - selBox.y * k + 48 }) }}>
                <button type="button" role="radio" aria-checked={colorOf == null} className="is-original" title={labels.colorOriginal} aria-label={labels.colorOriginal} onClick={() => onColor(null)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>
                </button>
                {palette.map((p) => (
                  <button key={p.name} type="button" role="radio" aria-checked={colorOf === p.name} title={labels.colorName(p.name)} aria-label={labels.colorName(p.name)}
                    style={{ background: p.hex }} onClick={() => onColor(p.name)} />
                ))}
              </div>
            )}
            {sel && selBox && asking && !drag?.moved && (
              <AskBox key={selected} labels={labels} asking={asking} onAsk={onAsk} onClose={onAskClose}
                style={{ left: Math.min(Math.max(selBox.x * k, 0), size.w - 340), ...((selBox.y + selBox.h) * k + 150 < size.h ? { top: (selBox.y + selBox.h) * k + 12 } : { bottom: size.h - selBox.y * k + 48 }) }} />
            )}
            {drag?.guides.gx != null && <i className="cs-ed-guide is-v" style={{ left: drag.guides.gx * k }} aria-hidden="true" />}
            {drag?.guides.gy != null && <i className="cs-ed-guide is-h" style={{ top: drag.guides.gy * k }} aria-hidden="true" />}
          </div>
        )}
        {menu && (
          <div className="cs-ed-under" role="menu" aria-label={labels.underHere}
            style={{ left: Math.min(menu.x, size.w - 236), top: Math.min(menu.y, Math.max(0, size.h - 40 - menu.items.length * 38)) }}
            onPointerLeave={() => onHover(null)}>
            <p>{labels.underHere}</p>
            {menu.items.map((el) => (
              <button key={el.i} type="button" role="menuitem" className={el.i === selected ? 'is-on' : undefined}
                onPointerEnter={() => onHover(el.i)} onClick={() => { onSelect(el.i); setMenu(null); onHover(null); }}>
                <Thumb el={el} paper={paper} />
                <span>{labels.element(el)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const boxStyle = (b: Box, k: number) => ({ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k });
const union = (bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const pad = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by });

/** 让 AI 改: one line said about what is selected, sent with it to the director (Enter sends, Shift+Enter a new line) */
function AskBox({ labels, asking, onAsk, onClose, style }: { labels: CanvasLabels; asking: Asking; onAsk: (text: string) => void; onClose: () => void; style: CSSProperties }) {
  const [v, setV] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const send = () => { const t = v.trim(); if (t && !asking.busy) onAsk(t); };
  return (
    <form className="cs-ed-ask" style={style} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea ref={box} rows={2} value={v} maxLength={1000} placeholder={asking.hint ?? labels.aiPlaceholder} disabled={asking.busy} aria-label={labels.ai}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      <div className="cs-ed-ask-row">
        <button type="button" className="cs-ed-btn is-quiet is-small" onClick={onClose} disabled={asking.busy}>{labels.aiClose}</button>
        <button type="submit" className="cs-ed-btn is-go is-small" disabled={asking.busy || !v.trim()}>{asking.busy ? labels.aiSending : labels.aiSend}</button>
      </div>
    </form>
  );
}
