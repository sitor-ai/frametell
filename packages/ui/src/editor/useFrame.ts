// The edit-mode preview's iframe and its messages (the runtime's, core editRuntime.ts). The player's clock
// (studio:time, every frame while it plays) goes into a small store of its own, so only what shows the time re-renders
// with it; what the runtime reports (the film's pages, the elements at this t) is React state.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Box, Element, FilmPageTimes, FromFrame, Picked, Swatch, ToFrame } from './types';
type Typed = Extract<FromFrame, { type: 'edit:typed' }>;

export interface Clock { t: number; playing: boolean; duration: number }

class ClockStore {
  now: Clock = { t: 0, playing: false, duration: 0 };
  private subs = new Set<() => void>();
  set(c: Partial<Clock>) {
    const n = { ...this.now, ...c };
    if (n.t === this.now.t && n.playing === this.now.playing && n.duration === this.now.duration) return;
    this.now = n;
    for (const f of this.subs) f();
  }
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
}

/** a value derived from the clock: the component re-renders only when the derived value changes */
export function useClock<T>(clock: ClockStore, pick: (c: Clock) => T): T {
  return useSyncExternalStore(clock.subscribe, () => pick(clock.now));
}
export type { ClockStore };

export interface FilmTimes { stage: { w: number; h: number }; pages: FilmPageTimes[]; palette: Swatch[] }
export interface Reported { t: number; page: string; elements: Element[]; paper: string | null; orphans: number[] }

export function useFrame(src: string | undefined) {
  const frame = useRef<HTMLIFrameElement>(null);
  const clock = useMemo(() => new ClockStore(), []);
  const [film, setFilm] = useState<FilmTimes>();
  const [reported, setReported] = useState<Reported>();
  const [error, setError] = useState<{ page: string; message: string }>();
  const [booted, setBooted] = useState(false);
  // words being typed in the preview: where they are now (the selection follows them); what was typed goes to onTyped
  const [typing, setTyping] = useState<Box | null>(null);
  const onTyped = useRef<(m: Typed) => void>(() => {});
  // what is under a point: each question answered by its seq (a frame later, usually)
  const picks = useRef(new Map<number, (s: Picked[]) => void>());
  const seq = useRef(0);
  const origin = useMemo(() => { try { return src ? new URL(src, location.href).origin : undefined; } catch { return undefined; } }, [src]);

  useEffect(() => {
    setFilm(undefined); setReported(undefined); setError(undefined); setBooted(false);
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromFrame;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      switch (m.type) {
        case 'studio:ready': clock.set({ duration: +m.duration || 0 }); setBooted(true); break;
        case 'studio:time': clock.set({ t: +m.t || 0, playing: !!m.playing }); break;
        case 'edit:ready': setFilm({ stage: m.stage, pages: m.pages, palette: m.palette ?? [] }); break;
        case 'edit:elements': setReported({ t: m.t, page: m.page, elements: m.elements ?? [], paper: m.paper ?? null, orphans: m.orphans ?? [] }); setError(undefined); break;
        case 'edit:picked': { const w = picks.current.get(m.seq); if (w) { picks.current.delete(m.seq); w(m.stack ?? []); } break; }
        case 'edit:error': setError({ page: m.page, message: m.message }); break;
        case 'edit:typing': setTyping(m.box ?? null); break;
        case 'edit:typed': setTyping(null); onTyped.current(m); break;
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [src, clock]);

  const post = useCallback((m: ToFrame) => { frame.current?.contentWindow?.postMessage(m, origin ?? '*'); }, [origin]);

  // a drag sends one nudge per thing per animation frame, the latest (things dragged together each have theirs)
  const nudging = useRef<{ ms: Map<string, ToFrame>; raf: number } | null>(null);
  const nudge = useCallback((m: Extract<ToFrame, { type: 'edit:nudge' }>) => {
    const key = `${m.page}:${m.i}`;
    if (nudging.current) { nudging.current.ms.set(key, m); return; }
    nudging.current = { ms: new Map([[key, m]]), raf: requestAnimationFrame(() => { const n = nudging.current; nudging.current = null; n?.ms.forEach((x) => post(x)); }) };
  }, [post]);
  useEffect(() => () => { if (nudging.current) cancelAnimationFrame(nudging.current.raf); }, []);

  const seek = useCallback((t: number, play = false) => { clock.set({ t }); post({ type: 'studio:seek', t, play }); }, [post, clock]);
  const pause = useCallback(() => post({ type: 'studio:pause' }), [post]);
  // pages' code to run: what is asked within one animation frame goes as one message (typing asks on every key)
  const loading = useRef<{ pages: Record<string, string>; raf: number } | null>(null);
  const load = useCallback((pages: Record<string, string>) => {
    if (loading.current) { Object.assign(loading.current.pages, pages); return; }
    loading.current = { pages: { ...pages }, raf: requestAnimationFrame(() => {
      const l = loading.current; loading.current = null;
      if (l) post({ type: 'edit:load', pages: l.pages, t: clock.now.t });
    }) };
  }, [post, clock]);
  useEffect(() => () => { if (loading.current) cancelAnimationFrame(loading.current.raf); }, []);
  const ask = useCallback(() => post({ type: 'edit:elements?' }), [post]);
  const pick = useCallback((x: number, y: number) => new Promise<Picked[]>((done) => {
    const n = ++seq.current;
    picks.current.set(n, done);
    post({ type: 'edit:pick', seq: n, x, y });
    setTimeout(() => { if (picks.current.delete(n)) done([]); }, 400);
  }), [post]);
  const peek = useCallback((page: string, ids: number[]) => post({ type: 'edit:peek', page, ids }), [post]);
  /** type into a text where it is: the preview takes the focus (a frame's own element can only be focused once the
   *  frame is) */
  const type = useCallback((page: string, id: number) => { frame.current?.focus(); post({ type: 'edit:type', page, id }); }, [post]);

  return { frame, clock, film, reported, error, booted, seek, pause, load, nudge, ask, type, typing, onTyped, pick, peek };
}
export type FrameApi = ReturnType<typeof useFrame>;
