// Under the picture, as a video editor has it: a bar with the time, play / pause and the zoom; then the whole film on
// one timeline: a ruler, the selected element's clip (only while one is selected), the picture track (each page a clip
// of its own frames) and the voice track (each line a clip). A white playhead runs over all of them. Press anywhere
// that is not a clip and drag to scrub; a clip takes you to where it was pressed. ⌘/Ctrl + wheel (or a pinch) zooms
// around the pointer; while it plays, the view follows the playhead. Only the playhead and the time follow the clock.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { useShellCopy } from './copy';
import { client, type ProjectView } from '../lib/client';
const fileUrl = (p: ProjectView, rel: string) => client.fileUrl(p, rel);
import { edit } from './api';
import { useClock, type ClockStore } from './useFrame';
import type { FilmPageTimes } from './types';

const fmt = (t: number) => { const s = Math.max(0, t); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
/** a ruler's label: whole seconds as 00:05, halves as 00:05.5 */
const ruler = (t: number, step: number) => (step < 1 ? fmt(t) : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.round(t % 60)).padStart(2, '0')}`);
const EDGE = 16;          // room before 0 and after the end, px
const MAX_PPS = 240;      // the closest zoom, px a second
/** a ruler step that leaves ~90 px between labels */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const stepFor = (pps: number) => STEPS.find((s) => s * pps >= 90) ?? 600;

export function Transport({ clock, onToggle, disabled, zoom, onZoom }: {
  clock: ClockStore; onToggle: () => void; disabled: boolean;
  /** 0 = the whole film fits, 1 = closest */
  zoom: number; onZoom: (z: number | 'fit') => void;
}) {
  const e = useShellCopy().editor;
  const playing = useClock(clock, (c) => c.playing);
  const t = useClock(clock, (c) => Math.round(c.t * 10) / 10);
  const duration = useClock(clock, (c) => c.duration);
  return (
    <div className="cs-ed-transport">
      <span className="cs-ed-time tabular" aria-live="off"><b>{fmt(t)}</b> / {fmt(duration)}</span>
      <button type="button" className="cs-ed-play" onClick={onToggle} disabled={disabled} aria-label={playing ? e.pause : e.play} title={e.playKey}>
        {playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8v12.4a.6.6 0 0 0 .9.5l9.6-6.2a.6.6 0 0 0 0-1L8.9 5.3a.6.6 0 0 0-.9.5z" /></svg>}
      </button>
      <div className="cs-ed-zoom">
        <button type="button" className="cs-ed-icon is-small" onClick={() => onZoom(Math.max(0, zoom - 0.15))} aria-label={e.zoomOut} title={e.zoomOut}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
        </button>
        <input type="range" min={0} max={1} step={0.01} value={zoom} onChange={(x) => onZoom(+x.target.value)} aria-label={e.zoomIn} />
        <button type="button" className="cs-ed-icon is-small" onClick={() => onZoom(Math.min(1, zoom + 0.15))} aria-label={e.zoomIn} title={e.zoomIn}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
        </button>
        <button type="button" className="cs-ed-fit" onClick={() => onZoom('fit')} title={e.fitHint}>{e.fit}</button>
      </div>
    </div>
  );
}

export interface Clip { start: number; end: number; label: string }

export function Timeline({ pages, clock, project, current, touched, selected, zoom, onZoom, onSeek, onShift }: {
  pages: FilmPageTimes[]; clock: ClockStore; project?: ProjectView; current?: string; touched: ReadonlySet<string>;
  /** the selected element's time on the film */
  selected?: Clip;
  zoom: number; onZoom: (z: number) => void;
  onSeek: (t: number) => void;
  /** the selected element's clip dragged along: shown that many seconds later (or earlier, below 0) */
  onShift?: (dt: number) => void;
}) {
  const e = useShellCopy().editor;
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const duration = pages.length ? pages[pages.length - 1].end : 0;
  // zoom 0 fits the film, 1 is MAX_PPS; between them the scale is geometric, so each step feels the same
  const fitPps = duration > 0 && width > 0 ? (width - 2 * EDGE) / duration : 40;
  const pps = fitPps * Math.pow(Math.max(1, MAX_PPS / fitPps), zoom);
  const strip = useStrip(project, pages);
  const inner = Math.max(width, duration * pps + 2 * EDGE);
  const x = useCallback((t: number) => EDGE + t * pps, [pps]);

  // zooming keeps the moment under the pointer (or the playhead) where it is
  const anchor = useRef<{ t: number; at: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, x(a.t) - a.at);
  }, [pps, x]);
  const zoomTo = useCallback((z: number, clientX?: number) => {
    const el = scroller.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const at = clientX != null ? clientX - r.left : Math.max(0, Math.min(r.width, x(clock.now.t) - el.scrollLeft));
      anchor.current = { t: (el.scrollLeft + at - EDGE) / pps, at };
    }
    onZoom(Math.max(0, Math.min(1, z)));
  }, [clock, onZoom, pps, x]);
  // the zoom slider moves around the playhead
  const lastZoom = useRef(zoom);
  useLayoutEffect(() => {
    if (lastZoom.current !== zoom && !anchor.current && scroller.current) {
      const el = scroller.current, r = el.getBoundingClientRect();
      anchor.current = { t: clock.now.t, at: Math.max(0, Math.min(r.width, x(clock.now.t) - el.scrollLeft)) };
    }
    lastZoom.current = zoom;
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (w: WheelEvent) => {
      if (!(w.ctrlKey || w.metaKey)) return;
      w.preventDefault();
      zoomTo(zoom - w.deltaY * 0.004, w.clientX);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoom, zoomTo]);

  // press and drag: the picture follows, one seek a frame
  const scrub = useRef<{ raf: number; t: number } | null>(null);
  const tAt = useCallback((clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration - 0.01, (clientX - r.left + el.scrollLeft - EDGE) / pps));
  }, [duration, pps]);
  const seekAt = useCallback((clientX: number) => {
    const t = tAt(clientX);
    clock.set({ t });   // the playhead moves at once; the picture with the next frame
    if (scrub.current) { scrub.current.t = t; return; }
    scrub.current = { t, raf: requestAnimationFrame(() => { const s = scrub.current; scrub.current = null; if (s) onSeek(s.t); }) };
  }, [tAt, onSeek, clock]);
  const down = useCallback((ev: RPointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    seekAt(ev.clientX);
  }, [seekAt]);
  const move = useCallback((ev: RPointerEvent<HTMLDivElement>) => { if (ev.currentTarget.hasPointerCapture(ev.pointerId)) seekAt(ev.clientX); }, [seekAt]);
  useEffect(() => () => { if (scrub.current) cancelAnimationFrame(scrub.current.raf); }, []);

  // the selected clip dragged: by how much, while it is (seconds); one change when it is let go
  const [shift, setShift] = useState<{ x0: number; dt: number } | null>(null);
  const grab = (ev: RPointerEvent<HTMLSpanElement>) => {
    if (ev.button !== 0 || !onShift) return;
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setShift({ x0: ev.clientX, dt: 0 });
  };
  const slide = (ev: RPointerEvent<HTMLSpanElement>) => {
    if (!shift || !selected) return;
    ev.stopPropagation();
    // never before the film begins; a tenth of a second at a time
    const dt = Math.max(-selected.start, Math.round(((ev.clientX - shift.x0) / pps) * 10) / 10);
    if (dt !== shift.dt) setShift({ ...shift, dt });
  };
  const drop = (ev: RPointerEvent<HTMLSpanElement>) => {
    if (!shift) return;
    ev.stopPropagation();
    const dt = shift.dt;
    setShift(null);
    if (Math.abs(dt) >= 0.1) onShift?.(dt);
  };

  const step = stepFor(pps);
  const ticks = useMemo(() => {
    const out: { t: number; major: boolean }[] = [];
    const minor = step / 5;
    for (let i = 0; i * minor <= duration + 1e-6; i++) out.push({ t: i * minor, major: i % 5 === 0 });
    return out;
  }, [step, duration]);

  return (
    <div className="cs-ed-tl">
      <div className="cs-ed-tl-keys" aria-hidden="true">
        <span className="is-ruler" />
        <span className="is-el">{e.tracks.element}</span>
        <span className="is-pic">{e.tracks.picture}</span>
        <span className="is-voice">{e.tracks.voice}</span>
      </div>
      <div className="cs-ed-tl-scroll" ref={scroller}>
        <div className="cs-ed-tl-inner" style={{ width: inner }} onPointerDown={down} onPointerMove={move} role="slider"
          aria-label={e.timeline} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={0}>
          <div className="cs-ed-tl-ruler">
            {ticks.map(({ t, major }) => (
              <i key={t} className={major ? 'is-major' : undefined} style={{ left: x(t) }}>{major && <b>{ruler(t, step)}</b>}</i>
            ))}
          </div>
          {/* always there, so the picture above never jumps when something is selected; a clip too short for its name
              has the name after it */}
          <div className="cs-ed-tl-track is-el">
            {selected && (() => {
              const w = Math.max(6, (selected.end - selected.start) * pps), short = w < 72;
              const start = selected.start + (shift?.dt ?? 0);
              return (
                <>
                  <span className={`cs-ed-clip is-el${onShift ? ' is-movable' : ''}${shift ? ' is-sliding' : ''}`} style={{ left: x(start), width: w }}
                    onPointerDown={grab} onPointerMove={slide} onPointerUp={drop} onPointerCancel={() => setShift(null)} title={onShift ? e.shiftHint : undefined}>
                    {!short && <span>{selected.label}</span>}
                  </span>
                  {short && <span className="cs-ed-clip-name" style={{ left: x(start) + w + 6 }}>{selected.label}</span>}
                  {shift && <span className="cs-ed-clip-shift tabular" style={{ left: x(start) }}>{shift.dt > 0 ? '+' : ''}{shift.dt.toFixed(1)}s</span>}
                </>
              );
            })()}
          </div>
          <div className="cs-ed-tl-track is-pic">
            {pages.map((p, n) => (
              <PageClip key={p.id} id={p.id} n={n + 1} left={x(p.start)} width={(p.end - p.start) * pps} on={p.id === current}
                changed={touched.has(p.id)} project={project} frames={strip.get(p.id)} changedLabel={e.pageChanged} label={e.pageN(n + 1)} />
            ))}
          </div>
          <div className="cs-ed-tl-track is-voice">
            {pages.flatMap((p) => p.cues.map((c) => (
              <span key={`${p.id}:${c.i}`} className="cs-ed-clip is-voice" style={{ left: x(c.start), width: Math.max(4, (c.end - c.start) * pps - 2) }} title={c.text}>
                <Wave seed={c.start} /><span>{c.text}</span>
              </span>
            )))}
          </div>
          <Playhead clock={clock} x={x} scroller={scroller} />
        </div>
      </div>
    </div>
  );
}

/** frames of the film along each page, for the picture track: one per ~5 s of a page (2–6), asked of the server in
 *  one call when the editor opens, each made small here (a 1920 px key frame decoded for a 60 px track would be ~8 MB
 *  of bitmap; this keeps ~60 KB) */
const STRIP_H = 112;
function useStrip(project: ProjectView | undefined, pages: FilmPageTimes[]): Map<string, string[]> {
  const [strip, setStrip] = useState<Map<string, string[]>>(() => new Map());
  const key = pages.map((p) => `${p.id}@${p.start.toFixed(1)}-${p.end.toFixed(1)}`).join(',');
  useEffect(() => {
    if (!project || !pages.length) return;
    let gone = false;
    const made: string[] = [];
    const plan = pages.map((p) => {
      const d = p.end - p.start, n = Math.min(6, Math.max(2, Math.round(d / 5)));
      return { id: p.id, times: Array.from({ length: n }, (_, j) => Math.round((p.start + (d * (j + 0.5)) / n) * 10) / 10) };
    });
    const all = plan.flatMap((p) => p.times).slice(0, 40);
    void (async () => {
      const { paths } = await edit.frames(project.id, all).catch(() => ({ paths: [] as string[] }));
      // one path a time, in order; an answer short of that (a box that could not draw some) keeps the stills
      if (paths.length !== all.length) return;
      const byTime = new Map(all.map((t, j) => [t.toFixed(1), paths[j]]));
      const small = async (rel: string) => {
        const blob = await (await fetch(fileUrl(project, rel))).blob();
        const bmp = await createImageBitmap(blob, { resizeHeight: STRIP_H, resizeQuality: 'medium' });
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
        if (!out) throw new Error('no frame');
        const u = URL.createObjectURL(out);
        made.push(u);
        return u;
      };
      for (const p of plan) {
        const urls = (await Promise.all(p.times.map((t) => { const rel = byTime.get(t.toFixed(1)); return rel ? small(rel).catch(() => null) : null; }))).filter((u): u is string => !!u);
        if (gone) return;
        if (urls.length) setStrip((m) => new Map(m).set(p.id, urls));
      }
    })();
    return () => { gone = true; for (const u of made) URL.revokeObjectURL(u); };
  }, [project?.id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return strip;
}

/** a page: its frames side by side, as long as it lasts (the film drawn along the page; until they come, the film's
 *  still for the page repeated) */
const PageClip = memo(function PageClip({ id, n, left, width, on, changed, project, frames, label, changedLabel }: {
  id: string; n: number; left: number; width: number; on: boolean; changed: boolean; project?: ProjectView; frames?: string[]; label: string; changedLabel: string;
}) {
  const stills = !frames && project ? [fileUrl(project, `out/thumbs/${id}.jpg`), fileUrl(project, `out/snap/${id}-thumb.jpg`)] : [];
  return (
    <span className={`cs-ed-clip is-pic${on ? ' is-on' : ''}${frames ? ' has-strip' : ''}`} style={{ left, width: Math.max(4, width - 2), backgroundImage: stills.map((u) => `url("${u}")`).join(', ') || undefined }}
      aria-label={changed ? `${label}（${changedLabel}）` : label}>
      {frames && <span className="cs-ed-strip" aria-hidden="true">{frames.map((u) => <span key={u} style={{ backgroundImage: `url("${u}")` }} />)}</span>}
      <b className="tabular">{n}</b>
      {changed && <i aria-hidden="true" />}
    </span>
  );
});

/** a line's voice, drawn as a quiet wave (its shape is made up from where it starts: it says "voice", not the sound) */
const Wave = memo(function Wave({ seed }: { seed: number }) {
  const bars = useMemo(() => {
    let s = Math.floor(seed * 1000) % 2147483647 || 7;
    return Array.from({ length: 48 }, () => { s = (s * 16807) % 2147483647; return 0.25 + (s / 2147483647) * 0.75; });
  }, [seed]);
  return (
    <svg className="cs-ed-wave" viewBox="0 0 96 20" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((h, i) => <rect key={i} x={i * 2} y={10 - h * 8} width={1.1} height={h * 16} rx={0.5} />)}
    </svg>
  );
});

/** the playhead: follows the clock on its own; while playing, keeps itself in view */
function Playhead({ clock, x, scroller }: { clock: ClockStore; x: (t: number) => number; scroller: RefObject<HTMLDivElement | null> }) {
  const t = useClock(clock, (c) => c.t);
  const playing = useClock(clock, (c) => c.playing);
  const left = x(t);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    if (left < el.scrollLeft + 24 || left > el.scrollLeft + el.clientWidth - 48) el.scrollLeft = Math.max(0, left - el.clientWidth * 0.2);
  }, [left, playing, scroller]);
  return <i className="cs-ed-playhead" style={{ transform: `translateX(${left}px)` }} aria-hidden="true" />;
}
