// Folds the event stream into what the workbench shows. The director (storyboard, script, review) speaks in the
// conversation; page sessions run in parallel, so each page is summarized in one row instead of interleaving.
import type { LoggedEvent, UserRef } from './client';
import { t } from '../i18n';
import { actText, PAGE_ACTS, pageName, toolAct } from './describe';

type Ev<T extends LoggedEvent['type']> = Extract<LoggedEvent, { type: T }>;
export type Stage = Ev<'stage'>['stage'];
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stopped';
export type Storyboard = Ev<'approval'>['storyboard'];
export type PageStatus = Ev<'page'>['status'];
export type PageIssue = NonNullable<Ev<'page'>['issues']>[number];

export interface ToolCall { id: string; name: string; summary: string; ok?: boolean }
/** every item knows the stage it happened in, so the conversation reads as chapters */
type In = { stage?: Stage };
export type FeedItem = In & (
  | { kind: 'stage'; key: string; stage: Stage; status: StageStatus; detail?: string; at: number }
  | { kind: 'say'; key: string; session: string; text: string; at: number }
  | { kind: 'think'; key: string; session: string; text: string; at: number }
  | { kind: 'tools'; key: string; session: string; calls: ToolCall[]; at: number }
  | { kind: 'user'; key: string; text: string; refs?: UserRef[]; at: number }
  | { kind: 'note'; key: string; text: string; at: number }
  /** a change to the finished film, drawn: each page it redrew and what its agent says changed there */
  | { kind: 'revised'; key: string; pages: Ev<'revised'>['pages']; at: number }
  /** this film's own components being written (one line, shown as the run's `kit` stands now) */
  | { kind: 'kit'; key: string; at: number }
  /** the film's generated pictures after the storyboard (one line, shown as the run's `pictures` stand now); `ids`: a
   *  change's line, the pictures it drew again (shown where the change is, not only up in the first line) */
  | { kind: 'pictures'; key: string; at: number; ids?: string[] }
  /** the first page drawn alone, for the person to confirm the look before the rest (one per time it is shown: only the
   *  latest can be answered); `answer`: what they said, once the film moved on from it */
  | { kind: 'first_page'; key: string; page: string; answer?: 'go' | 'change'; at: number; /** when it goes on by itself */ goOnAt?: number; /** it did: nobody answered in time */ auto?: boolean }
  | { kind: 'paused'; key: string; reason: 'user' | 'interrupted' | 'error' | 'credits'; message?: string; code?: Ev<'paused'>['code']; at: number }
  | { kind: 'check'; key: string; round: number; reds: number; yellows: number; messages: string[]; at: number }
  | { kind: 'approval'; key: string; storyboard: Storyboard; at: number; /** when it goes on by itself */ goOnAt?: number; /** it did: nobody answered in time */ auto?: boolean }
  /** one round of drawing pages; `ids` on a change to a finished film: only the pages this round draws again (the
   *  others stay as they were and are not listed) */
  | { kind: 'pages'; key: string; at: number; ids?: string[] }
  | { kind: 'error'; key: string; message: string; at: number }
  /** the film is finished and plays in the preview (newer runs; older logs go straight to `done`) */
  | { kind: 'ready'; key: string; duration: number; at: number }
  /** an mp4 export: running, then done with the file, or failed */
  | { kind: 'export'; key: string; status: 'running' | 'done' | 'failed'; detail?: string; video?: string; noSubs?: string; saved?: string; at: number; endedAt?: number }
  | { kind: 'done'; key: string; video: string; duration: number; at: number });

export interface PageView {
  id: string;
  status: PageStatus;
  round: number;
  issues: PageIssue[];
  sheet?: string;
  thumb?: string;
  lastText?: string;
  tools: number;
  /** what it is writing right now, while the model streams it: “212 lines written” */
  progress?: string;
  /** what this page's agent is doing right now (pages are drawn side by side, each says its own) */
  activity?: RunView['activity'];
  startedAt?: number;
  endedAt?: number;
}

/** one of the film's generated pictures as it stands now: `file` the latest drawn (kept while it is drawn again, and when
 *  drawing it again failed); `note` what it was last asked to change */
export interface Picture {
  id: string;
  what: string;
  kind: string;
  status: Ev<'picture'>['status'];
  file?: string;
  w?: number;
  h?: number;
  note?: string;
  detail?: string;
}
/** a picture the storyboard asks for (look.pictures): read loosely, the look is the director's own JSON */
export interface PicturePlan { id: string; kind: string; what: string; shape: 'wide' | 'tall' | 'square' | 'film' | 'reel' }

export interface RunView {
  seq: number;
  stages: Record<Stage, { status: StageStatus; startedAt?: number; endedAt?: number; detail?: string }>;
  feed: FeedItem[];
  pages: Record<string, PageView>;
  pageOrder: string[];
  storyboard?: Storyboard;
  /** waiting for the person: at the storyboard, or at the first page (then `firstPage` is set too) */
  awaitingApproval: boolean;
  /** the first page is drawn and waits for the person to confirm the look (or say what to change) before the rest */
  firstPage?: { page: string };
  cost?: { amount: number; currency: 'CNY' | 'USD'; usage: Ev<'cost'>['usage'] };
  gate?: Ev<'gate'>;
  /** this film's own components (written before its pages, for a designed style's longer films) */
  kit?: { status: Ev<'kit'>['status']; components: string[]; round?: number; sheet?: string };
  /** the film's generated pictures, in the order they were first heard of */
  pictures: Picture[];
  video?: { path: string; noSubs: string; duration: number; /** the copies in the export folder */ saved?: { withSubs: string; noSubs: string } };
  /** the film is finished: drawn, checked, playable in the live preview */
  ready?: { duration: number; at: number };
  /** the exported mp4 is older than the film (a revision, or another cover, changed it since) */
  stale?: boolean;
  /** the page the exported film opens on, when one other than the first was chosen */
  cover?: string;
  /** a picture the user gave as that first frame instead (its file in the project) */
  coverImage?: string;
  /** an mp4 export in progress, since when */
  exporting?: number;
  error?: string;
  /** set while the run is stopped (paused by the user, interrupted, or failed); cleared when it continues */
  paused?: { reason: 'user' | 'interrupted' | 'error' | 'credits'; message?: string; at: number };
  /** continued after a pause and getting ready, since when; cleared when its first step starts (or it stops again) */
  resuming?: number;
  /** the stage that is running now */
  current?: Stage;
  /** set from a change request on a finished film until the redraw starts: the director is deciding which pages to redo */
  revising?: number;
  /** what the director (or a page agent) is doing right now, in plain words, and since when */
  /** `updated`: the latest streamed progress (a long silence after thinking means the answer is being written);
   *  `page`: the page session doing it; `thinking` / `writing`: thinking, or writing an answer that shows only when whole;
   *  `base`: the text without its line count, so a growing count keeps the same start time */
  activity?: { text: string; at: number; detail?: string; updated?: number; page?: string; thinking?: boolean; writing?: boolean; base?: string };
  /** the narrator the user switched to, after the one the film was made with (project.voice) */
  voice?: Ev<'voice'>['voice'];
  /** when the run (or its latest continuation) started, for elapsed time */
  startedAt?: number;
  /** the last moment anything happened (for "working…" indicators) */
  activeAt?: number;
}

export const STAGES: Stage[] = ['research', 'storyboard', 'script', 'narrate', 'pages', 'review', 'render'];
/** the stages this run shows, numbered in order: research only when it ran */
export const shownStages = (r: RunView) => STAGES.filter((s) => s !== 'research' || r.stages.research.status !== 'pending');
/** stage names in the interface language, read when used: STAGE_NAME[stage] */
export const STAGE_NAME = new Proxy({} as Record<Stage, string>, { get: (_, k) => t(`run.stage.${String(k) as Stage}`) });

export const emptyRun = (): RunView => ({
  seq: 0, feed: [], pages: {}, pageOrder: [], pictures: [], awaitingApproval: false,
  stages: Object.fromEntries(STAGES.map((s) => [s, { status: 'pending' }])) as RunView['stages'],
});

const isPage = (session: string) => session.startsWith('page-');

/** pure reducer: (view, event) → view; events arrive in seq order */
/** with several pages drawn at once, a page's moment belongs on that page: the shared line would hop between them */
export function reduce(v: RunView, e: LoggedEvent): RunView {
  const r = step(v, e);
  const a = r.activity;
  if (a?.page && a !== v.activity && r.pages[a.page]) r.pages = { ...r.pages, [a.page]: { ...r.pages[a.page], activity: a } };
  return r;
}

function step(v: RunView, e: LoggedEvent): RunView {
  const at = e.at, key = String(e.seq);
  const r: RunView = { ...v, seq: e.seq, activeAt: at };
  const stage = v.current;
  const push = (item: FeedItem) => { r.feed = [...r.feed, { ...item, stage: item.stage ?? stage } as FeedItem]; };
  // the film moved on from its first page: the wait is over, and the card says what was decided when that is known
  const leaveFirst = (answer?: 'go' | 'change') => {
    if (!r.firstPage) return;
    r.firstPage = undefined; r.awaitingApproval = false;
    const i = r.feed.map((f) => f.kind === 'first_page').lastIndexOf(true);
    if (i >= 0 && answer) r.feed = r.feed.map((f, j) => (j === i ? { ...f, answer } as FeedItem : f));
  };
  switch (e.type) {
    case 'stage': {
      // after the film is finished, rendering is an export, not a step of making it: one line in the conversation
      if (e.stage === 'render' && r.ready) {
        if (e.status === 'start') { r.exporting = at; r.error = undefined; push({ kind: 'export', key, status: 'running', at }); }
        else {
          r.exporting = undefined;
          const i = r.feed.map((f) => f.kind === 'export' && f.status === 'running').lastIndexOf(true);
          if (i >= 0 && e.status === 'failed') r.feed = r.feed.map((f, j) => (j === i ? { ...f, status: 'failed', detail: e.detail, endedAt: at } as FeedItem : f));
        }
        return r;
      }
      r.resuming = undefined;
      // drawing the pages again after the first page says nothing yet: the next page drawn tells whether it went ahead
      if (e.status === 'start' && e.stage !== 'pages') leaveFirst(e.stage === 'review' ? 'go' : undefined);
      const s = { ...r.stages[e.stage] };
      if (e.status === 'start') { s.status = 'running'; s.startedAt = at; s.endedAt = undefined; r.current = e.stage; r.paused = undefined; r.revising = undefined; r.startedAt ??= at; }
      else { s.status = e.status; s.endedAt = at; s.detail = e.detail; if (r.current === e.stage) r.current = undefined; r.activity = undefined; }
      r.stages = { ...r.stages, [e.stage]: s };
      // one page list per round of drawing: a revision after the film gets its own
      const lastDone = r.feed.map((f) => f.kind === 'done' || f.kind === 'ready').lastIndexOf(true);
      if (e.stage === 'pages' && e.status === 'start' && !r.feed.slice(lastDone + 1).some((f) => f.kind === 'pages')) push({ kind: 'pages', key, at, stage: 'pages', ...(lastDone >= 0 ? { ids: [] } : {}) });
      else if (e.stage !== 'pages' || e.status !== 'start') push({ kind: 'stage', key, stage: e.stage, status: s.status, detail: e.detail, at });
      if (e.stage === 'script' && e.status === 'start') r.awaitingApproval = false;
      if (e.status === 'start') r.error = undefined;
      return r;
    }
    case 'agent': {
      const ev = e.event;
      // the film's components are written in the background while it is narrated: one line says how they stand (kit)
      if (e.session === 'kit' || e.session?.startsWith('kit-')) return r;
      const page = isPage(e.session) ? e.session.slice(5) : undefined;
      const who = (doing: string) => (page ? t('run.now.who', { page: pageName(page), doing }) : doing);
      if (ev.type === 'progress') {
        // a response still being written: say what, how far it has got, and show the line it is on
        const act = ev.what === 'tool' ? toolAct(ev.name ?? '', JSON.stringify({ path: ev.path ?? '' })) : undefined;
        const doing = ev.what === 'thinking' ? t('run.now.thinking')
          : ev.what === 'writing' ? t(page ? 'run.now.writingPicture' : 'run.now.writing')
          : ev.what === 'text' ? t('run.now.writingReply')
          : page && act && PAGE_ACTS.includes(act.id) ? t(ev.name === 'edit' ? 'run.now.editingPicture' : 'run.now.writingPicture')
          : act ? actText(act, 'doing') : ev.name ?? '';
        const base = who(doing);
        const text = ev.what === 'tool' && ev.lines ? who(t('run.now.withLines', { doing, n: ev.lines })) : base;
        r.activity = {
          text, base, page, at: r.activity?.base === base ? r.activity!.at : at, detail: ev.what === 'tool' ? ev.tail : undefined, updated: at,
          thinking: ev.what === 'thinking', writing: ev.what === 'writing' || (!!page && ev.what === 'tool' && !ev.lines && ev.name !== 'edit' && !!act && PAGE_ACTS.includes(act.id)),
        };
        if (page && ev.what === 'tool' && ev.lines) {
          if (r.pages[page]) r.pages = { ...r.pages, [page]: { ...r.pages[page], progress: t('run.now.lines', { n: ev.lines }) } };
        }
        return r;
      }
      if (ev.type === 'tool_start') {
        const act = toolAct(ev.name, ev.summary);
        // inside a page session, writing code is drawing the page whatever the path summary kept
        const drawing = page && act && PAGE_ACTS.includes(act.id) && act.id !== 'readFile' && act.id !== 'readPage';
        r.activity = { text: who(drawing ? t(act!.id === 'editFile' || act!.id === 'editPage' ? 'run.now.editingPicture' : 'run.now.drawingPicture') : act ? actText(act, 'start') : ev.name), at, page };
      }
      else if (ev.type === 'thinking') r.activity = { text: who(t('run.now.thinking')), at, page, thinking: true };
      else if (ev.type === 'text' && !page) r.activity = { text: t('run.now.writing'), at, writing: true };
      if (page) {
        const id = page;
        const p = r.pages[id] ? { ...r.pages[id] } : newPage(id, r);
        // what the agent says while drawing is the page's description; what it says while its page is checked is not
        if (ev.type === 'text' && p.status === 'drawing') p.lastText = ev.text;
        if (ev.type === 'tool_start') { p.tools += 1; p.progress = undefined; }
        r.pages = { ...r.pages, [id]: p };
        return r;
      }
      if (ev.type === 'text') { const text = ev.text.trim(); if (text) push({ kind: 'say', key, session: e.session, text, at }); }
      else if (ev.type === 'thinking') push({ kind: 'think', key, session: e.session, text: ev.text, at });
      else if (ev.type === 'tool_start' || ev.type === 'tool_end') {
        const last = r.feed[r.feed.length - 1];
        if (ev.type === 'tool_start') {
          const call: ToolCall = { id: ev.id, name: ev.name, summary: ev.summary };
          r.feed = last?.kind === 'tools' && last.session === e.session
            ? [...r.feed.slice(0, -1), { ...last, calls: [...last.calls, call] }]
            : [...r.feed, { kind: 'tools', key, session: e.session, calls: [call], at, stage }];
        } else {
          r.feed = r.feed.map((f) => (f.kind === 'tools' && f.session === e.session ? { ...f, calls: f.calls.map((c) => (c.id === ev.id ? { ...c, ok: ev.ok } : c)) } : f));
        }
      }
      return r;
    }
    case 'voice': r.voice = e.voice; return r;
    case 'storyboard_check': {
      const reds = e.issues.filter((i) => i.level === 'red').length;
      push({ kind: 'check', key, round: e.round, reds, yellows: e.issues.length - reds, messages: e.issues.map((i) => t('run.issue', { where: i.page ?? t('run.wholeFilm'), msg: i.msg })), at });
      return r;
    }
    case 'approval':
      r.storyboard = e.storyboard; r.awaitingApproval = true;
      push({ kind: 'approval', key, storyboard: e.storyboard, at, stage: 'storyboard', ...(e.goOnAt ? { goOnAt: e.goOnAt } : {}) });
      return r;
    // nobody answered the wait in time: the film went on by itself, and its card says so
    case 'went_on': {
      const kind = e.wait === 'storyboard' ? 'approval' : 'first_page';
      const i = r.feed.map((f) => f.kind === kind).lastIndexOf(true);
      if (i >= 0) r.feed = r.feed.map((f, j) => (j === i ? { ...f, auto: true } as FeedItem : f));
      if (e.wait === 'first_page') leaveFirst('go');
      else r.awaitingApproval = false;
      return r;
    }
    case 'page': {
      // after the first page: drawn again is a change to it, another page drawn is the go-ahead
      if (r.firstPage) leaveFirst(e.id === r.firstPage.page ? 'change' : 'go');
      const p = r.pages[e.id] ? { ...r.pages[e.id] } : newPage(e.id, r);
      // a film from before issues had fields logged them as lines of text: kept as notes, which the panel doesn't word.
      // A page its own check left with a note (flagged) is shown drawn like any other: the note asks nothing of the
      // person, and "one thing for you to look at" only puzzled them
      p.status = e.status === 'flagged' ? 'ok' : e.status; p.round = e.round ?? p.round; p.issues = e.issues?.map((i: PageIssue | string) => (typeof i === 'string' ? { from: 'agent', msg: i } : i)) ?? p.issues;
      // a paused film has nothing in progress: a page still winding down after the pause (older runs went on for
      // minutes) waits as queued until the film continues
      if (r.paused && (p.status === 'drawing' || p.status === 'checking')) p.status = 'queued';
      if (e.sheet) p.sheet = e.sheet;
      if (e.thumb) p.thumb = e.thumb;
      if (e.status === 'drawing' && !p.startedAt) p.startedAt = at;
      if (['ok', 'flagged', 'failed'].includes(e.status)) p.endedAt = at;
      // the check round: first the pictures are taken, then the page agent looks at them
      if (e.status === 'checking' && !r.paused) r.activity = { text: t('run.now.checking', { page: pageName(e.id), snaps: !!e.sheet, round: p.round }), at, page: e.id };
      p.progress = undefined;
      r.pages = { ...r.pages, [e.id]: p };
      if (!r.pageOrder.includes(e.id)) r.pageOrder = [...r.pageOrder, e.id].sort();
      // a change to the finished film lists the pages it draws again, as each is heard of
      const i = r.feed.map((f) => f.kind === 'pages').lastIndexOf(true), round = r.feed[i];
      if (round?.kind === 'pages' && round.ids && !round.ids.includes(e.id)) r.feed = r.feed.map((f, j) => (j === i ? { ...round, ids: [...round.ids!, e.id].sort() } : f));
      return r;
    }
    case 'cost': r.cost = { amount: e.amount, currency: e.currency, usage: e.usage }; return r;
    case 'gate': r.gate = e; return r;
    case 'error': r.error = e.message; push({ kind: 'error', key, message: e.message, at }); return r;
    case 'user':
      // at the storyboard or the first page, saying something is the change request
      if (r.firstPage) leaveFirst('change');
      else if (r.awaitingApproval) r.awaitingApproval = false;
      // after the film, a change request: its own round (a switch of voice alone is not planned: it narrates right away)
      else if ((r.ready || r.video) && !r.current && !r.exporting && (e.text || e.refs?.some((x) => x.kind !== 'voice'))) { r.revising = at; r.startedAt = at; }
      push({ kind: 'user', key, text: e.text, refs: e.refs, at }); return r;
    case 'note': push({ kind: 'note', key, text: e.text, at }); return r;
    case 'revised': push({ kind: 'revised', key, pages: e.pages, at }); return r;
    case 'kit':
      if (e.status === 'start') push({ kind: 'kit', key, at });
      r.kit = { status: e.status, components: e.components ?? r.kit?.components ?? [], round: e.round ?? r.kit?.round, sheet: e.sheet ?? r.kit?.sheet };
      return r;
    case 'picture': {
      const old = r.pictures.find((p) => p.id === e.id);
      const p: Picture = {
        id: e.id, what: e.what ?? old?.what ?? e.id, kind: e.kind ?? old?.kind ?? 'scene', status: e.status,
        // drawn again: the last file shows until the new one is there, and stays when the new one can't be had
        file: e.file ?? old?.file, w: e.file ? e.w : old?.w, h: e.file ? e.h : old?.h,
        note: e.status === 'drawing' ? e.note : old?.note, detail: e.status === 'failed' ? e.detail : undefined,
      };
      r.pictures = old ? r.pictures.map((x) => (x.id === e.id ? p : x)) : [...r.pictures, p];
      // one line for all of them, where the first is heard of; a picture drawn again after the person last spoke gets a
      // line of its own there (their change's), which the pictures that change draws join
      const line = r.feed.map((f) => f.kind === 'pictures').lastIndexOf(true), said = r.feed.map((f) => f.kind === 'user').lastIndexOf(true);
      if (line < 0) push({ kind: 'pictures', key, at });
      else if (old && e.status === 'drawing' && said > line) push({ kind: 'pictures', key, at, ids: [e.id] });
      else {
        const f = r.feed[line] as Extract<FeedItem, { kind: 'pictures' }>;
        if (f.ids && !f.ids.includes(e.id)) r.feed = r.feed.map((x, j) => (j === line ? { ...f, ids: [...f.ids!, e.id] } : x));
      }
      return r;
    }
    // the first page waits for the person, as the storyboard did; shown again after a change (or a picture drawn again)
    case 'first_page':
      r.firstPage = { page: e.page }; r.awaitingApproval = true;
      r.activity = undefined; r.resuming = undefined;
      // the same wait said again (a run picked up again at it, from before the engine stopped repeating it): one card
      if (r.feed.at(-1)?.kind === 'first_page' && (r.feed.at(-1) as { page: string }).page === e.page && !(r.feed.at(-1) as { answer?: string }).answer) return r;
      push({ kind: 'first_page', key, page: e.page, at, stage: 'pages', ...(e.goOnAt ? { goOnAt: e.goOnAt } : {}) });
      return r;
    case 'paused': {
      leaveFirst();
      // close whatever was running: its timer stops, and the chapter reads as stopped rather than in progress
      r.stages = Object.fromEntries(Object.entries(r.stages).map(([k, s]) => [k, s.status === 'running' ? { ...s, status: 'stopped' as StageStatus, endedAt: at } : s])) as RunView['stages'];
      r.current = undefined;
      r.activity = undefined;
      r.revising = undefined;
      r.paused = { reason: e.reason, message: e.message, at };
      r.resuming = undefined;
      r.pages = Object.fromEntries(Object.entries(r.pages).map(([k, p]) => [k, p.status === 'drawing' || p.status === 'checking' ? { ...p, status: 'queued' as PageStatus } : p]));
      if (e.reason === 'error' && r.feed.at(-1)?.kind === 'error') r.feed = r.feed.slice(0, -1);   // the paused card carries the message
      push({ kind: 'paused', key, reason: e.reason, message: e.message, ...(e.code ? { code: e.code } : {}), at });
      return r;
    }
    // continued: not paused any more, getting ready for the next step (the header reads "Preparing" until it starts)
    case 'resumed':
      r.paused = undefined;
      r.error = undefined;
      r.resuming = at;
      return r;
    case 'ready':
      leaveFirst('go');
      r.resuming = undefined;
      r.ready = { duration: e.duration, at };
      r.stale = !!r.video;
      r.paused = undefined;
      r.activity = undefined;
      r.revising = undefined;
      r.current = undefined;
      push({ kind: 'ready', key, duration: e.duration, at });
      return r;
    // another cover chosen: an mp4 made before opens on the old one
    case 'cover':
      r.cover = e.page ?? undefined;
      r.coverImage = e.image;
      if (r.video) r.stale = true;
      return r;
    case 'done': {
      r.resuming = undefined;
      r.video = { path: e.video, noSubs: e.videoNoSubs, duration: e.duration, saved: e.saved };
      r.stale = false;
      r.exporting = undefined;
      r.paused = undefined;
      r.activity = undefined;
      r.revising = undefined;
      const i = r.feed.map((f) => f.kind === 'export' && f.status === 'running').lastIndexOf(true);
      if (i >= 0) r.feed = r.feed.map((f, j) => (j === i ? { ...f, status: 'done', video: e.video, noSubs: e.videoNoSubs, saved: e.saved?.withSubs, endedAt: at } as FeedItem : f));
      else push({ kind: 'done', key, video: e.video, duration: e.duration, at });   // a run from before exports were separate
      return r;
    }
    default: return r;
  }
}

function newPage(id: string, r: RunView): PageView {
  if (!r.pageOrder.includes(id)) r.pageOrder = [...r.pageOrder, id].sort();
  return { id, status: 'queued', round: 0, issues: [], tools: 0 };
}

/** the pictures the storyboard asks for, in its order; [] when it asks for none */
export const plannedPictures = (sb?: Storyboard): PicturePlan[] => {
  const list = (sb?.look as { pictures?: unknown } | undefined)?.pictures;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string').map((p) => ({
    id: p.id as string, kind: typeof p.kind === 'string' ? p.kind : 'scene', what: typeof p.what === 'string' ? p.what : '',
    shape: p.shape === 'tall' || p.shape === 'square' || p.shape === 'film' || p.shape === 'reel' ? p.shape : 'wide',
  }));
};
/** a picture's width over its height: as drawn, else as its shape is drawn (1536×1024, 1024×1536, 1024², a film's
 *  1536×864, a portrait film's 864×1536) */
export const pictureRatio = (p: Pick<Picture, 'w' | 'h'> | undefined, shape?: PicturePlan['shape']) =>
  p?.w && p.h ? p.w / p.h : shape === 'tall' ? 2 / 3 : shape === 'square' ? 1 : shape === 'film' ? 16 / 9 : shape === 'reel' ? 9 / 16 : 3 / 2;

/** a project-relative path from an absolute one the core reported (snapshots, video) */
export const relPath = (abs: string, projectId: string) => { const i = abs.indexOf(projectId + '/'); return i >= 0 ? abs.slice(i + projectId.length + 1) : abs.split('/').slice(-2).join('/'); };

const CNY_PER_USD = 7.2;
/** what a film cost, always in US dollars: every model is priced in them now, and a film from when one was priced in
 * yuan (its log says CNY) is turned into dollars at the director's rate, so the figure never switches between ¥ and $ */
export const money = (c?: { amount: number; currency: 'CNY' | 'USD' }) => { const a = c ? (c.currency === 'CNY' ? c.amount / CNY_PER_USD : c.amount) : 0; return `$${a < 10 ? a.toFixed(2) : a.toFixed(1)}`; };
export const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? t('run.sec', { s }) : t('run.minSec', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }); };

/** something is being made right now (a stage, or the director planning a change to the finished film) */
export const isWorking = (r: RunView) => (!!r.current && !r.awaitingApproval) || !!r.revising || !!r.exporting || !!r.resuming;
/** the film is finished (whether or not an mp4 of it exists) */
export const finished = (r: RunView) => !!r.ready || !!r.video;
/**
 * Each page as a player can show it: what it was the last time it was drawn (or given up on), unchanged while it is
 * being drawn or checked again; a page that settles again after that is a new version even when its round is the same
 * (a later change starts its rounds again). `seen` is kept by the caller between calls. A player keyed on every status
 * and round reloaded the whole film each time any page started, finished or went round its check again: dozens of
 * engine boots while a film was made, and the page playing was cut off each time.
 */
export type DrawnSeen = Record<string, { v: string; n: number; away?: boolean }>;
export const drawnPages = (r: RunView, ids: string[], seen: DrawnSeen = {}) => ids.map((id) => {
  const p = r.pages[id], s = (seen[id] ??= { v: '', n: 0 });
  if (p && (p.status === 'ok' || p.status === 'flagged' || p.status === 'failed')) {
    if (s.away) { s.n++; s.away = false; }
    s.v = `${p.status}${p.round}#${s.n}`;
  } else if (s.v) s.away = true;
  return s.v;
}).join('|');
/** where to show an exported file: its copy in the export folder when there is one */
export const savedAt = (v: NonNullable<RunView['video']>, file: string) => (file === v.path ? v.saved?.withSubs : file === v.noSubs ? v.saved?.noSubs : undefined) ?? file;
/** the exported mp4, when it shows the film as it is now */
export const film = (r: RunView) => (r.video && !r.stale ? r.video : undefined);
