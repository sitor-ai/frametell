// The layers list, on the editor's left: what is on the picture at this moment, the topmost first, each by its words or
// by what it is, with a small picture of it. Hovering a row lights the thing on the picture; a click selects it (then
// it is dragged, typed into or deleted on the picture as ever), Shift adds it to what is selected, a double-click types
// into its words. Things one line of the page's code drew together (a row of labels, a loop's) are a group: its row
// selects them all and opens into each. The eye takes a thing off the picture for a moment, to reach what is under it;
// nothing it does is saved, and the page shown next has all its things again.
import { memo, useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import type { Element } from './types';

export interface LayersCopy {
  title: string; empty: string; hide: string; show: string; open: string; close: string; background: string;
  /** a group's name: how many things, of what */
  group: (n: number, of: string) => string;
}

/** a thing's small picture: its lines on the film's paper, its picture, or the mark of words */
export const Thumb = memo(function Thumb({ el, paper }: { el: Element; paper: string | null }) {
  const src = el.thumb?.img ?? (el.thumb?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(el.thumb.svg)}` : undefined);
  return (
    <span className="cs-ly-thumb" style={paper ? { background: paper } : undefined} aria-hidden="true">
      {src ? <img src={src} alt="" decoding="async" draggable={false} />
        : el.kind === 'text' || el.texts.length
          ? <svg viewBox="0 0 24 24"><path d="M6 7V5.5h12V7M12 5.5v13M9.5 18.5h5" /></svg>
          : <svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>}
    </span>
  );
});

const Eye = ({ hid }: { hid: boolean }) => (hid
  ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.4 2.2-2.8 3.5M6.6 7.6C4.6 8.9 3.1 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
  : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12c1-1.8 4.5-6 9.5-6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z" /><circle cx="12" cy="12" r="3" /></svg>);

export function Layers({ elements, selected, also, hovered, peeked, paper, where, copy, name, onSelect, onSelectAll, onToggle, onHover, onPeek, onType }: {
  elements: Element[]; selected: number | null;
  /** picked along with `selected` (Shift); a Shift-click on a row adds or takes away */
  also: ReadonlySet<number>;
  hovered: number | null; peeked: ReadonlySet<number>; paper: string | null;
  /** the page and the moment the list is of */
  where: string;
  copy: LayersCopy;
  name: (el: Element) => string;
  onSelect: (i: number) => void; onSelectAll: (is: number[]) => void; onToggle: (i: number) => void;
  onHover: (i: number | null) => void; onPeek: (i: number) => void;
  onType: (el: Element, text: number) => void;
}) {
  // the topmost first: what a page draws later is drawn over what it drew before; a statement's things together
  const shown = elements.filter((e) => e.visible || peeked.has(e.i));
  const groups: Element[][] = [];
  for (const el of [...shown].sort((a, b) => b.i - a.i)) {
    const g = groups.find((x) => x[0].stmt === el.stmt && el.stmt >= 0);
    if (g) g.push(el); else groups.push([el]);
  }
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const list = useRef<HTMLUListElement>(null);
  const on = (i: number) => i === selected || also.has(i);
  // the selection brought into view (its group opened) when it was made on the picture
  useEffect(() => {
    if (selected == null) return;
    const g = groups.find((x) => x.length > 1 && x.some((y) => y.i === selected));
    if (g && !open.has(g[0].stmt)) setOpen((s) => new Set(s).add(g[0].stmt));
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-i="${selected}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (k: number) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const click = (el: Element) => (e: RMouseEvent) => (e.shiftKey ? onToggle(el.i) : onSelect(el.i));
  const typeIn = (el: Element) => () => { const t = el.texts.find((x) => !x.live); if (t) onType(el, t.id); };

  const row = (el: Element, child: boolean) => {
    const hid = peeked.has(el.i), bg = el.kind === 'scene';
    return (
      <li key={el.i} role="treeitem" aria-selected={on(el.i)} data-i={el.i}>
        <div className={`cs-ly-row${child ? ' is-child' : ''}${on(el.i) ? ' is-on' : ''}${el.i === hovered ? ' is-hover' : ''}${hid ? ' is-hidden' : ''}`}
          onPointerEnter={() => onHover(bg ? null : el.i)}>
          {!child && <span className="cs-ly-twist" aria-hidden="true" />}
          <button type="button" className="cs-ly-pick" disabled={bg} onClick={click(el)} onDoubleClick={typeIn(el)}>
            <Thumb el={el} paper={paper} />
            <span className="cs-ly-name">{bg ? copy.background : name(el)}</span>
          </button>
          <button type="button" className="cs-ly-eye" aria-pressed={hid} onClick={() => onPeek(el.i)} title={hid ? copy.show : copy.hide} aria-label={hid ? copy.show : copy.hide}>
            <Eye hid={hid} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <aside className="cs-ly" aria-label={copy.title} onPointerLeave={() => onHover(null)}>
      <header className="cs-ly-head">
        <b>{copy.title}</b>
        {shown.length > 0 && <span className="cs-ly-count tabular">{shown.length}</span>}
        <span className="cs-ly-where tabular">{where}</span>
      </header>
      {shown.length === 0 ? <p className="cs-ly-empty">{copy.empty}</p> : (
        <ul className="cs-ly-list" ref={list} role="tree" aria-multiselectable="true" aria-label={copy.title}>
          {groups.map((g) => {
            if (g.length === 1) return row(g[0], false);
            const k = g[0].stmt, isOpen = open.has(k), all = g.every((x) => on(x.i));
            const words = g.some((x) => x.texts.length > 0);
            return (
              <li key={`g${k}`} role="treeitem" aria-selected={all} aria-expanded={isOpen}>
                <div className={`cs-ly-row is-group${all ? ' is-on' : ''}${g.some((x) => x.i === hovered) ? ' is-hover' : ''}`} onPointerEnter={() => onHover(g[0].i)}>
                  <button type="button" className="cs-ly-twist" onClick={() => flip(k)} aria-label={isOpen ? copy.close : copy.open}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                  <button type="button" className="cs-ly-pick" onClick={() => onSelectAll(g.map((x) => x.i))}>
                    <span className="cs-ly-stack" aria-hidden="true">
                      {g.slice(0, 3).map((x) => <Thumb key={x.i} el={x} paper={paper} />)}
                    </span>
                    <span className="cs-ly-name">{words ? g.filter((x) => x.texts.length).map((x) => x.texts.map((t) => t.value).join(' ')).reverse().join(' · ') : copy.group(g.length, name(g[0]))}</span>
                  </button>
                </div>
                {isOpen && <ul role="group" className="cs-ly-kids">{[...g].reverse().map((x) => row(x, true))}</ul>}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
