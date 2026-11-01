// The pages as the editor sees them, and every change on its way to the draft. A page's text comes from the core; what
// is in it (statements, words) and every edit of it are worked out here (./editSource.ts: the core never parses a
// film's code). An edit is written into the text at once and the preview runs it at once (onLoad, optimistic); the new
// text goes to the server after 300 ms when typing (or at once), one request per page at a time, and the answer's
// base is the page's from then on. Undo / redo put a whole text back. A 409 (the page changed elsewhere) reads the page
// again, drops its steps, with a short notice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOp, instrument, pageInfo, type Op, type PageInfo } from './editSource';
import { edit, isStale } from './api';
import type { Did } from './types';

export interface Step { page: string; before: string; after: string; ops: Op[]; /** typing into the same field goes on in this step */ open: boolean }
export type Notice = 'stale' | 'failed' | 'load';
interface PageState { base: string; saved: string; source: string; info: PageInfo | null; did: Did[] }

const TYPING_MS = 300;
const sameTarget = (a: Op, b: Op) => a.kind === b.kind && (a.kind === 'text' ? a.k === (b as typeof a).k
  : a.kind === 'item' ? a.n === (b as typeof a).n && a.what === (b as typeof a).what : (a as { i: number }).i === (b as { i: number }).i);
const infoOf = (source: string, page: string) => { try { return pageInfo(source, page); } catch { return null; } };
/** the copy the preview runs, or nothing for a page that is not of the editable shape */
const marked = (source: string, page: string) => { try { return instrument(source, page); } catch { return undefined; } };
const didOf = (op: Op): Did => (op.kind === 'text' ? { kind: 'text', words: op.value }
  : op.kind === 'item' ? (op.what === 'text' ? { kind: 'text', words: op.words } : { kind: op.what === 'time' ? 'at' : op.what }) : { kind: op.kind });

export function useDraft(id: string, opts: {
  initialDraft: string[];
  /** pages' new code for the preview (instrumented); `why` says what changed them */
  onLoad: (pages: Record<string, string>, page: string, why: 'edit' | 'undo' | 'redo' | 'refetch') => void;
}) {
  const [, setTick] = useState(0);
  const render = useCallback(() => setTick((n) => n + 1), []);
  const pages = useRef<Record<string, PageState>>({});
  const sending = useRef<Record<string, Promise<void> | undefined>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const touched = useRef(new Set(opts.initialDraft));
  const [notice, setNotice] = useState<Notice>();
  const loadCb = useRef(opts.onLoad);
  loadCb.current = opts.onLoad;
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; for (const t of Object.values(timers.current)) clearTimeout(t); }; }, []);

  const show = (page: string, why: 'edit' | 'undo' | 'redo' | 'refetch') => {
    const st = pages.current[page];
    const m = st && marked(st.source, page);
    if (m) loadCb.current({ [page]: m }, page, why);
  };

  /** every page's text read (again), and the instrumented copies of those that can be edited, for one edit:load */
  const loadAll = useCallback(async (ids: string[]): Promise<Record<string, string>> => {
    const got = await Promise.all(ids.map((p) => edit.page(id, p).then((r) => [p, r] as const, () => [p, null] as const)));
    const out: Record<string, string> = {};
    if (!live.current) return out;
    let failed = false;
    for (const [p, r] of got) {
      if (!r) { failed = true; continue; }
      pages.current[p] = { base: r.base, saved: r.source, source: r.source, info: infoOf(r.source, p), did: [] };
      const m = marked(r.source, p);
      if (m) out[p] = m;
    }
    if (failed) setNotice('load');
    render();
    return out;
  }, [id, render]);

  const refetch = useCallback(async (page: string, why: Notice) => {
    clearTimeout(timers.current[page]);
    undoStack.current = undoStack.current.filter((s) => s.page !== page);
    redoStack.current = redoStack.current.filter((s) => s.page !== page);
    setNotice(why);
    try {
      const r = await edit.page(id, page);
      if (!live.current) return;
      pages.current[page] = { base: r.base, saved: r.source, source: r.source, info: infoOf(r.source, page), did: [] };
      render();
      show(page, 'refetch');
    } catch { if (live.current) setNotice('load'); }
  }, [id, render]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback((page: string): Promise<void> => {
    clearTimeout(timers.current[page]);
    if (sending.current[page]) return sending.current[page]!;   // its answer sends what is left
    const st = pages.current[page];
    if (!st || (st.source === st.saved && !st.did.length)) return Promise.resolve();
    const source = st.source, did = st.did;
    st.did = [];
    const go = (async () => {
      let failed: unknown;
      try {
        const r = await edit.put(id, page, { base: st.base, source, did: did.length ? did : [{ kind: 'undo' }] });
        if (live.current && pages.current[page] === st) {   // not read again meanwhile
          st.base = r.base; st.saved = r.source;
          if (st.source === source && r.source !== source) { st.source = r.source; st.info = infoOf(r.source, page); show(page, 'edit'); }
          touched.current.add(page);
        }
      } catch (e) { failed = e ?? new Error('failed'); } finally { sending.current[page] = undefined; }
      if (!live.current) return;
      render();
      if (failed !== undefined) { await refetch(page, isStale(failed) ? 'stale' : 'failed'); return; }
      const now = pages.current[page];
      if (now && (now.source !== now.saved || now.did.length)) await flush(page);
    })();
    sending.current[page] = go;
    render();
    return go;
  }, [id, render, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = (page: string, typing: boolean) => {
    clearTimeout(timers.current[page]);
    if (typing) timers.current[page] = setTimeout(() => void flush(page), TYPING_MS);
    else void flush(page);
  };
  const setSource = (page: string, source: string) => {
    const st = pages.current[page];
    st.source = source;
    st.info = infoOf(source, page);
  };

  /** an edit (or several made at once, as one step: things moved together): written into the page's text and shown at
   *  once; false when it does not apply */
  const apply = useCallback((page: string, edit: Op | Op[], typing = false): boolean => {
    const st = pages.current[page];
    const ops = Array.isArray(edit) ? edit : [edit];
    if (!st?.info || !ops.length) return false;
    const op = ops[ops.length - 1];
    let next: string;
    try { next = ops.reduce((src, o) => applyOp(src, page, o), st.source); } catch { setNotice('failed'); return false; }
    if (next === st.source) return true;
    const before = st.source;
    setSource(page, next);
    const last = undoStack.current[undoStack.current.length - 1];
    if (typing && ops.length === 1 && last?.open && last.page === page && sameTarget(last.ops[last.ops.length - 1], op)) last.after = next;
    else {
      if (last) last.open = false;
      undoStack.current.push({ page, before, after: next, ops, open: typing && ops.length === 1 });
    }
    redoStack.current = [];
    const d = didOf(op);
    const lastDid = st.did[st.did.length - 1];
    if (typing && ops.length === 1 && lastDid?.kind === d.kind && d.kind === 'text') st.did[st.did.length - 1] = d; else st.did.push(...ops.map(didOf));
    touched.current.add(page);
    show(page, 'edit');
    render();
    schedule(page, typing);
    return true;
  }, [render, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const putBack = useCallback((from: Step[], to: Step[], pick: (s: Step) => string, why: 'undo' | 'redo') => {
    const step = from.pop();
    if (!step) return;
    step.open = false;
    const st = pages.current[step.page];
    if (!st) return;
    setSource(step.page, pick(step));
    st.did.push({ kind: 'undo' });
    to.push(step);
    show(step.page, why);
    render();
    schedule(step.page, false);
  }, [render, flush]); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = useCallback(() => putBack(undoStack.current, redoStack.current, (s) => s.before, 'undo'), [putBack]);
  const redo = useCallback(() => putBack(redoStack.current, undoStack.current, (s) => s.after, 'redo'), [putBack]);

  /** everything waiting sent, and answered */
  const settle = useCallback(async () => {
    for (let round = 0; round < 6; round++) {
      const ids = Object.keys(pages.current).filter((p) => { const s = pages.current[p]; return sending.current[p] || s.source !== s.saved || s.did.length; });
      if (!ids.length) return;
      await Promise.all(ids.map((p) => flush(p)));
    }
  }, [flush]);

  /** after a save, a drop or a restore: nothing is a change any more */
  const reset = useCallback(() => {
    for (const t of Object.values(timers.current)) clearTimeout(t);
    undoStack.current = []; redoStack.current = [];
    touched.current = new Set();
    for (const st of Object.values(pages.current)) st.did = [];
    render();
  }, [render]);

  const waiting = Object.entries(pages.current).some(([p, s]) => !!sending.current[p] || s.source !== s.saved);
  return {
    /** the page as it is now, edits included; null: not of the shape the editor can change; undefined: not read yet */
    info: (p: string): PageInfo | null | undefined => pages.current[p]?.info,
    loadAll, apply, undo, redo, settle, reset,
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
    /** the changes made in this session (typing into one field is one) */
    count: undoStack.current.length,
    steps: undoStack.current,
    /** a draft on the server from before this session, or changes since */
    dirty: touched.current.size > 0 || undoStack.current.length > 0 || waiting,
    /** the pages the draft has changed */
    touched: touched.current as ReadonlySet<string>,
    waiting,
    notice, clearNotice: useCallback(() => setNotice(undefined), []),
  };
}
export type Draft = ReturnType<typeof useDraft>;
