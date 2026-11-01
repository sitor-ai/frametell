import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Pause, Play } from 'lucide-react';
import { client, type ProjectView } from '../lib/client';
import { useLoad, useRun } from '../lib/hooks';
import { finished, isWorking, money, STAGE_NAME, type RunView } from '../lib/run';
import { TopBar } from '../components/TopBar';
import { Conversation } from './Conversation';
import { Stage } from './Stage';
import { offerRef } from '../lib/refs';
import { useT } from '../i18n';
import { FilmCredits, orShort } from '../components/Credits';
import { hosted } from '../lib/client';
import { openedFilm, track } from '../lib/track';
import { ModeSwitch } from '../editor/ModeSwitch';
import type { EditInfo } from '../editor/types';

// the editor (editor/Editor.tsx) is loaded only when a film is opened in it
const Editor = lazy(() => import('../editor/Editor').then((m) => ({ default: m.Editor })));

const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));

/** what this film has cost; the details (model, tokens, cache) open on click instead of crowding the workbench */
function CostChip({ run, project }: { run: RunView; project: ProjectView }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', off); addEventListener('keydown', off);
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', off); };
  }, [open]);
  const u = run.cost?.usage;
  const seen = u ? u.input + u.cacheRead : 0;
  // a hosted service counts in credits alone: no money, models or tokens
  if (hosted) return <span className="px-2"><FilmCredits project={project.id} run={run} /></span>;
  return (
    <span ref={box} className="relative">
      <button className="fs-btn fs-btn-ghost fs-btn-sm font-mono tabular" aria-expanded={open} onClick={() => setOpen(!open)} title={t('workbench.spentTitle')}>{money(run.cost)}</button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[240px] rounded-xl border border-line bg-surface p-4 shadow-xl animate-fade" role="dialog" aria-label={t('workbench.costDetails')}>
          <p className="text-[12px] text-ink-3">{t('workbench.costHeading')}</p>
          <p className="mt-0.5 font-mono text-[22px] text-ink tabular">{money(run.cost)}</p>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
            <div className="flex justify-between gap-3"><dt className="text-ink-3">{t(project.pageModel ? 'workbench.director' : 'workbench.model')}</dt><dd className="truncate text-ink-2">{project.model.split('/').pop()}</dd></div>
            {project.pageModel && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t('workbench.pages')}</dt><dd className="truncate text-ink-2">{project.pageModel.split('/').pop()}</dd></div>}
            {u && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t('workbench.input')}</dt><dd className="font-mono text-ink-2 tabular">{fmtK(seen)} token</dd></div>}
            {u && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t('workbench.output')}</dt><dd className="font-mono text-ink-2 tabular">{fmtK(u.output)} token</dd></div>}
            {u && seen > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-3">{t('workbench.cacheHit')}</dt><dd className="font-mono text-ink-2 tabular">{Math.round((100 * u.cacheRead) / seen)}%</dd></div>}
          </dl>
        </div>
      )}
    </span>
  );
}

const LEFT_KEY = 'fs.workbench.left', LEFT_DEFAULT = 420, LEFT_MIN = 320;
const readLeft = () => { try { const n = Number(localStorage.getItem(LEFT_KEY)); return n > 0 ? n : LEFT_DEFAULT; } catch { return LEFT_DEFAULT; } };

export function Workbench({ id, openSettings }: { id: string; openSettings: (section?: string) => void }) {
  const { t, locale } = useT();
  const project = useLoad(() => client.project(id), [id]);
  const { run, conn } = useRun(project.data);
  const [selected, setSelected] = useState<string>();
  const [playKey, setPlayKey] = useState(0);
  const [pagePlay, setPagePlay] = useState(0);
  const [pane, setPane] = useState<'talk' | 'stage'>('talk');   // narrow windows show one pane at a time
  // 编辑: the editor over the whole window, the workbench kept behind it; a version saved or gone back to changes the
  // film's files, so the stage is built again on the way back
  const [editing, setEditing] = useState<EditInfo | null>(null);
  const [rev, setRev] = useState(0);
  const editBtn = useRef<HTMLButtonElement>(null);
  const exitEdit = (changed: boolean) => {
    setEditing(null);
    if (changed) { setRev((r) => r + 1); project.reload(); }
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const main = useRef<HTMLElement>(null);
  const [box, setBox] = useState(0);
  const [left, setLeft] = useState(readLeft);
  const [drag, setDrag] = useState(false);
  const hasMain = !!project.data;
  useEffect(() => {
    const el = main.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth)); ro.observe(el); setBox(el.clientWidth);
    return () => ro.disconnect();
  }, [hasMain]);
  const maxLeft = Math.max(LEFT_MIN, Math.min(720, box ? box * 0.6 : 720));
  const width = Math.round(Math.min(maxLeft, Math.max(LEFT_MIN, left)));
  const setWidth = (w: number, save = true) => {
    const v = Math.round(Math.min(maxLeft, Math.max(LEFT_MIN, w))); setLeft(v);
    if (save) try { localStorage.setItem(LEFT_KEY, String(v)); } catch { /* private mode */ }
  };
  const onSash = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !main.current) return;
    setWidth(e.clientX - main.current.getBoundingClientRect().left, false);
  };
  const endSash = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(false); e.currentTarget.releasePointerCapture?.(e.pointerId);
    try { localStorage.setItem(LEFT_KEY, String(width)); } catch { /* private mode */ }
  };
  useEffect(() => { document.title = project.data ? `${project.data.title} · ${t('workbench.brand')}` : t('workbench.brand'); }, [project.data?.title, locale]);

  const running = isWorking(run);
  // what is told to a hosted service (lib/track.ts), from refs: nothing here re-renders the workbench
  // the film opened, as it stood: still being made, ready, or exported
  const opened = project.data;
  useEffect(() => {
    if (!opened) return;
    openedFilm(opened.id);
    track('film-open', { project: opened.id, state: opened.video ? 'exported' : opened.status === 'done' ? 'ready' : 'running', status: opened.status });
  }, [opened?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the tab left while the film is being made (not ready yet), and how long until it came back: the stage it was at
  // when left (the run's log stops while the tab is hidden, so it says nothing newer on the way back)
  const making = useRef({ on: false, stage: '' });
  making.current = { on: running && !finished(run), stage: run.current ?? (run.resuming ? 'resuming' : run.revising ? 'revising' : 'preparing') };
  useEffect(() => {
    let away: { at: number; stage: string } | undefined;
    const on = () => {
      if (document.hidden) {
        if (!making.current.on || away) return;
        away = { at: Date.now(), stage: making.current.stage };
        track('wait-away', { project: id, stage: away.stage });
      } else if (away) {
        track('wait-back', { project: id, stage: away.stage, sec: Math.round((Date.now() - away.at) / 1000) });
        away = undefined;
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [id]);
  // Pause answers the click at once; the run says it has paused a moment later, once every page has stopped
  const [pausing, setPausing] = useState(false);
  useEffect(() => { if (!running) setPausing(false); }, [running]);
  const pause = (pid: string) => { setPausing(true); client.stop(pid).catch(() => setPausing(false)); };
  const status = pausing && running ? t('workbench.status.pausing') : run.revising ? t('workbench.status.revising') : run.exporting ? t('workbench.status.exporting') : run.resuming ? t('workbench.status.preparing') : finished(run) && !running ? t('workbench.status.done') : run.firstPage ? t('workbench.status.awaitingFirstPage') : run.awaitingApproval ? t('workbench.status.awaitingApproval') : run.paused ? t('workbench.status.paused') : run.current ? t('workbench.status.stageRunning', { stage: STAGE_NAME[run.current] }) : t('workbench.status.preparing');
  const play = () => { setSelected(undefined); setPane('stage'); setPlayKey((k) => k + 1); };
  // a page double-clicked in the conversation: its close-up, playing from the page's start
  const playPage = (pid: string) => { setSelected(pid); setPane('stage'); setPagePlay((k) => k + 1); };

  if (project.error) return (
    <div className="flex h-full flex-col"><TopBar onSettings={openSettings} /><main className="flex flex-1 items-center justify-center text-[13px] text-ink-3">{project.error} · <a className="ml-1 text-accent-ink" href="#/">{t('workbench.backHome')}</a></main></div>
  );
  const p = project.data as ProjectView | undefined;
  return (
    <div className="flex h-full flex-col">
      <TopBar onSettings={openSettings}>
        <a href="#/" className="fs-icon-btn -ml-1 shrink-0" aria-label={t('workbench.backHomeAria')}><ChevronLeft size={16} /></a>
        <h1 className="min-w-0 truncate text-[14px] font-medium">{p?.title ?? ''}</h1>
        <span className={`hidden shrink-0 text-[12.5px] sm:inline ${finished(run) && !running ? 'text-jade' : run.awaitingApproval ? 'text-accent-ink' : 'text-ink-3'}`} aria-live="polite">{status}</span>
        {conn === 'reconnecting' && <span className="shrink-0 rounded-full bg-seal-soft px-2 py-0.5 text-[12px] text-seal" role="status">{t('workbench.reconnecting')}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {p && client.edit && finished(run) && <ModeSwitch id={p.id} making={running} editing={!!editing} onOpen={setEditing} btn={editBtn} />}
          {p && <CostChip run={run} project={p} />}
          {p && running && <button className="fs-btn fs-btn-ghost fs-btn-sm" onClick={() => pause(p.id)} disabled={pausing} aria-busy={pausing} title={t('workbench.pauseTitle')}><Pause size={13} aria-hidden /> {pausing ? t('workbench.pausing') : t('workbench.pause')}</button>}
          {p && run.paused && <button className="fs-btn fs-btn-secondary fs-btn-sm" onClick={() => client.start(p.id).catch(orShort(p.id))}><Play size={13} aria-hidden /> {t('workbench.resume')}</button>}
        </span>
      </TopBar>
      {p && (
        <div className="flex border-b border-line lg:hidden" role="tablist" aria-label={t('workbench.views')}>
          {([['talk', t('workbench.talk')], ['stage', t('workbench.stage')]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)} className={`flex-1 py-2.5 text-[13px] font-medium ${pane === k ? 'text-ink shadow-[inset_0_-2px_0_rgb(var(--fs-ink))]' : 'text-ink-3'}`}>{l}</button>
          ))}
        </div>
      )}
      {!p ? <div className="flex-1" /> : (
        <main ref={main} style={{ '--fs-left': `${width}px` } as React.CSSProperties} className={`relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--fs-left)_minmax(0,1fr)] ${drag ? 'select-none [&_iframe]:pointer-events-none' : ''}`}>
          <aside className={`min-h-0 min-w-0 border-line bg-paper-2 lg:block lg:border-r ${pane === 'talk' ? 'block' : 'hidden'}`} aria-label={t('workbench.conversationAria')}>
            <Conversation run={run} project={p} onSelectPage={(pid) => { setSelected(pid); setPane('stage'); }} onPlayPage={playPage} selected={selected} onPlay={play} openSettings={openSettings} />
          </aside>
          <section className={`min-h-0 min-w-0 lg:block ${pane === 'stage' ? 'block' : 'hidden'}`} aria-label={t('workbench.workbenchAria')}>
            <Stage key={rev} run={run} project={p} selected={selected} onSelect={setSelected} playKey={playKey} pagePlay={pagePlay}
              onRef={(r) => { setPane('talk'); offerRef(r); }} />
          </section>
          <div role="separator" aria-orientation="vertical" aria-label={t('workbench.resize')} aria-valuenow={width} aria-valuemin={LEFT_MIN} aria-valuemax={Math.round(maxLeft)} tabIndex={0}
            style={{ left: width - 4 }}
            className={`group absolute inset-y-0 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block ${drag ? 'cursor-col-resize' : ''}`}
            onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); e.preventDefault(); }}
            onPointerMove={onSash} onPointerUp={endSash} onPointerCancel={endSash}
            onDoubleClick={() => setWidth(LEFT_DEFAULT)}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -16 : 16)); } }}>
            <span className={`absolute inset-y-0 left-[3px] transition-colors group-hover:w-[2px] group-hover:bg-accent group-focus-visible:w-[2px] group-focus-visible:bg-accent ${drag ? 'w-[2px] bg-accent' : 'w-px bg-transparent'}`} />
          </div>
        </main>
      )}
      {p && editing && (
        <Suspense fallback={null}>
          <Editor id={p.id} title={p.title} project={p} info={editing} onExit={exitEdit} />
        </Suspense>
      )}
    </div>
  );
}
