// A film that stops (its box lost, a pause, out of credits) goes on from where it was: the storyboard in the planner's
// own conversation, the pages in the lanes that were drawing them, and nothing drawn already is drawn again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { askedPage } from './testing.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const PAGE = (id: string) => `ENGINE.visual('${id}', (P) => {\n  P.text('${id}', { x: 960, y: 540 });\n});\n`;
const SCRIPT = "(function (root) {\n  const META = {\n    style: '_test',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n";

type Send = (o: { name: string; text: string; cwd: string; signal?: AbortSignal }) => Promise<{ stopReason?: string } | void> | { stopReason?: string } | void;
/** a runtime like Pi as far as transcripts go: a session's ref is its file (the one it resumed, else its name's), and
 *  every message it is sent is written there before it is answered (Pi saves after each turn). `opened`: each session
 *  as `name` or `name<file it resumed>` */
function runtime(opened: string[], asked: Record<string, string[]>, act: Send): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(s, resume) {
      const ref = resume ?? path.join(s.cwd, `.studio/sessions/${s.name}.json`);
      opened.push(`${s.name}${resume ? `<${path.basename(resume)}` : ''}`);
      return { ref, close: async () => {}, send: async ({ text }: { text: string }) => {
        if (s.signal?.aborted) return { text: '', stopReason: 'aborted', usage: {}, answers: [] } as never;
        (asked[s.name] ??= []).push(text);
        const was = fs.existsSync(ref) ? JSON.parse(fs.readFileSync(ref, 'utf8')) as string[] : [];
        fs.mkdirSync(path.dirname(ref), { recursive: true });
        fs.writeFileSync(ref, JSON.stringify([...was, text]));
        const r = await act({ name: s.name, text, cwd: s.cwd, signal: s.signal });
        return { text: 'done', stopReason: r?.stopReason ?? 'done', usage: {}, answers: [] } as never;
      } };
    },
  };
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-resume-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), SCRIPT);
  return dir;
}
const storyboardOf = (n: number) => ({ title: 'T', summary: 'S', lang: 'zh', durationSec: 60, pages: Array.from({ length: n }, (_, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, section: 's', say: '…', beats: [] })) });
type Inside = { state: { stage: string; planner?: string; lanes?: unknown; pages: Record<string, { status: string }> } };

// ── the storyboard ─────────────────────────────────────────────────────────────────────────────

function planner(dir: string, act: Send, signal?: AbortSignal) {
  const opened: string[] = [], asked: Record<string, string[]> = {}, events: StudioEvent[] = [];
  const rt = runtime(opened, asked, act);
  const d = new Director({ dir, style: '_test', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: rt, emit: (e) => events.push(e), signal });
  const commits: string[] = [];
  Object.assign(d.project, { storyboardIssues: () => [], commit: async (m: string) => { commits.push(m); return null; } });
  Object.assign(d, { lookIssues: () => [], lengthIssues: () => [] });
  return { d: d as unknown as Pick<Director, 'storyboard'> & Inside, opened, asked, events, commits };
}

test('a storyboard cut short (its box lost mid-exchange) carries on in the planner\'s conversation, not from the top', async () => {
  const dir = project();
  const sb = storyboardOf(4);
  // the first box: the planner writes half the storyboard, then the box is gone (its exchange never ends)
  const first = planner(dir, ({ name, cwd }) => {
    if (name !== 'planner') return;
    fs.writeFileSync(path.join(cwd, 'storyboard.json'), JSON.stringify({ ...sb, pages: sb.pages.slice(0, 2) }));
    return new Promise(() => {});
  });
  void first.d.storyboard();
  for (let i = 0; i < 50 && !first.asked.planner; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
  // what the next box gets: the state, with the planner's transcript named before its first turn ended
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.studio/state.json'), 'utf8'));
  assert.ok(saved.planner, 'the planner\'s transcript is in the state before its exchange ends');
  assert.match(first.asked.planner[0], /storyboard/i);

  // the box that takes the film over
  const next = planner(dir, ({ name, cwd }) => { if (name === 'planner') fs.writeFileSync(path.join(cwd, 'storyboard.json'), JSON.stringify(sb)); });
  await next.d.storyboard();
  assert.deepEqual(next.opened, ['planner<planner.json'], 'the planner resumed its own transcript');
  assert.equal(next.asked.planner.length, 1);
  assert.match(next.asked.planner[0], /interrupted[\s\S]*storyboard\.json is on disk as you last wrote it[\s\S]*don't start the storyboard over/);
  assert.notEqual(next.asked.planner[0], first.asked.planner[0], 'the storyboard prompt is not sent again');
  // the transcript holds both boxes' messages: one conversation
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.studio/sessions/planner.json'), 'utf8')).length, 2);
  const start = next.events.find((e) => e.type === 'stage' && e.stage === 'storyboard' && e.status === 'start');
  assert.match((start as { detail?: string }).detail ?? '', /resumed: the planner's conversation carries on, storyboard\.json begun/);
  assert.equal(next.d.state.stage, 'approval');
});

test('a storyboard draft is committed as the planner writes it, so a host checkpoints it before the stage ends', async () => {
  const dir = project();
  const sb = storyboardOf(3);
  const f = planner(dir, ({ name, cwd }) => { if (name === 'planner') fs.writeFileSync(path.join(cwd, 'storyboard.json'), JSON.stringify(sb)); });
  // the runtime reports each turn; this one's single turn wrote the storyboard
  const rt = (f.d as unknown as { o: { runtime: AgentRuntime } }).o.runtime;
  const open = rt.open.bind(rt);
  rt.open = async (o, resume) => {
    const s = await open(o, resume);
    return { ...s, ref: s.ref, send: async (i) => { const r = await s.send(i); o.onEvent?.({ type: 'turn', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }); return r; } };
  };
  await f.d.storyboard();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(f.commits, ['分镜（进行中）', '分镜']);
});

test('a storyboard begun with no conversation to carry on is finished in a new one, not written again', async () => {
  const dir = project();
  const sb = storyboardOf(4);
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ ...sb, pages: sb.pages.slice(0, 2) }));
  // the state names a transcript that did not travel
  fs.mkdirSync(path.join(dir, '.studio'));
  fs.writeFileSync(path.join(dir, '.studio/state.json'), JSON.stringify({ stage: 'storyboard', planner: '/elsewhere/.studio/sessions/planner.json', pages: {}, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
  const f = planner(dir, ({ name, cwd }) => { if (name === 'planner') fs.writeFileSync(path.join(cwd, 'storyboard.json'), JSON.stringify(sb)); });
  await f.d.storyboard();
  assert.deepEqual(f.opened, ['planner'], 'a new conversation');
  assert.match(f.asked.planner[0], /cut short after it began storyboard\.json[\s\S]*finish it/);
  assert.ok(!fs.existsSync('/elsewhere'));
});

// ── the pages ──────────────────────────────────────────────────────────────────────────────────

function drawing(dir: string, act: Send, signal?: AbortSignal) {
  const opened: string[] = [], asked: Record<string, string[]> = {}, events: StudioEvent[] = [];
  const rt = runtime(opened, asked, act);
  const d = new Director({ dir, style: '_test', brief: { durationSec: 180, lang: 'zh', replyLang: 'zh' }, runtime: rt, pageChecks: 'hard', emit: (e) => events.push(e), signal });
  const sb = storyboardOf(12);
  const timing = { duration: 60, pages: sb.pages.map((p, i) => ({ id: p.id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) };
  Object.assign(d.project, { check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => null, storyboard: () => sb, timeline: async () => timing });
  const inside = d as unknown as Pick<Director, 'pages'> & Inside;
  inside.state.stage = 'pages';
  return { d: inside, opened, asked, events };
}
const okPages = (d: Inside) => Object.entries(d.state.pages).filter(([, s]) => s.status === 'ok').map(([id]) => id).sort();
/** the page a message asks for, any message to a page session */
const pageOf = (name: string, text: string) => askedPage(text, name);

test('pages stopped mid-film go on in the lanes that drew them, and no page drawn already is drawn again', async () => {
  const dir = project();
  const stop = new AbortController();
  let sawP08!: () => void;
  const p08 = new Promise<void>((ok) => { sawP08 = ok; });
  // the first run: two lanes (p01–p06, p07–p12). The run is stopped (out of credits) while the first lane is half way
  // through p04, once the second has begun p08
  const first = drawing(dir, async ({ name, text, cwd }) => {
    if (!name.startsWith('page-')) return;
    const id = pageOf(name, text);
    if (id === 'p08') sawP08();
    if (id === 'p04') {
      await p08;
      fs.writeFileSync(path.join(cwd, 'pages/p04.js'), '// half a page\n');
      stop.abort();
      return { stopReason: 'aborted' };
    }
    fs.writeFileSync(path.join(cwd, `pages/${id}.js`), PAGE(id));
  }, stop.signal);
  await assert.rejects(first.d.pages(), (e: Error) => e.name === 'AbortError');
  assert.deepEqual([...new Set(first.opened)].sort(), ['page-p01', 'page-p07']);
  const drawnFirst = okPages(first.d);
  for (const id of ['p01', 'p02', 'p03', 'p07']) assert.ok(drawnFirst.includes(id), `${id} was drawn in the first run`);
  assert.deepEqual((first.d.state.lanes as { name: string }[]).map((l) => l.name), ['page-p01', 'page-p07'], 'the lanes are in the state');

  // Continue: a new run (a new director, as after a restart)
  const next = drawing(dir, ({ name, text, cwd }) => {
    if (!name.startsWith('page-')) return;
    const id = pageOf(name, text);
    fs.writeFileSync(path.join(cwd, `pages/${id}.js`), PAGE(id));
  });
  await next.d.pages();
  assert.deepEqual(next.opened.sort(), ['page-p01<page-p01.json', 'page-p07<page-p07.json'], 'only the two lanes, each in its own transcript');
  const askedAgain = Object.entries(next.asked).flatMap(([name, texts]) => texts.map((t) => pageOf(name, t)));
  for (const id of drawnFirst) assert.ok(!askedAgain.includes(id), `${id} was drawn again`);
  // each lane is told once that it was stopped; the half-drawn page is to be finished
  assert.match(next.asked['page-p01'][0], /stopped and has now resumed[\s\S]*pages\/p04\.js is on disk as you left it/);
  assert.match(next.asked['page-p01'][0], /page \*\*p04\*\*/);
  assert.ok(next.asked['page-p01'].slice(1).every((t) => !/has now resumed/.test(t)));
  assert.deepEqual(okPages(next.d), storyboardOf(12).pages.map((p) => p.id));
  // the transcripts go on: the first run's messages, then this one's
  const lane1 = JSON.parse(fs.readFileSync(path.join(dir, '.studio/sessions/page-p01.json'), 'utf8')) as string[];
  assert.equal(lane1.length, first.asked['page-p01'].length + next.asked['page-p01'].length);
  // the reuse is in the run's events
  const start = next.events.find((e) => e.type === 'stage' && e.stage === 'pages' && e.status === 'start') as { detail?: string };
  assert.match(start.detail ?? '', /^resumed: \d+ pages drawn already; lanes carried on: page-p01 \(p04 p05 p06\), page-p07 \(/);
  assert.equal(next.d.state.stage, 'review');
  assert.equal(next.d.state.lanes, undefined);
});

test('a lane whose transcript is gone gives its pages to a new lane; a page that failed is drawn on its own terms', async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.studio/sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.studio/sessions/page-p07.json'), JSON.stringify(['earlier']));
  const pages: Record<string, { status: string; rounds: number; issues: unknown[]; failures?: number }> = {};
  for (const id of ['p01', 'p02', 'p03', 'p07', 'p08']) pages[id] = { status: 'ok', rounds: 1, issues: [] };
  pages.p09 = { status: 'failed', rounds: 1, issues: [], failures: 1 };
  fs.writeFileSync(path.join(dir, '.studio/state.json'), JSON.stringify({
    stage: 'pages', pages, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    lanes: [{ name: 'page-p01', file: '.studio/sessions/page-p01.json', pages: ['p01', 'p02', 'p03', 'p04', 'p05', 'p06'] }, { name: 'page-p07', file: '.studio/sessions/page-p07.json', pages: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12'] }],
  }));
  const f = drawing(dir, ({ name, text, cwd }) => { if (name.startsWith('page-')) { const id = pageOf(name, text); fs.writeFileSync(path.join(cwd, `pages/${id}.js`), PAGE(id)); } });
  await f.d.pages();
  // page-p07 goes on with p10–p12; p09 (failed) and p04–p06 (their lane's transcript is gone) are drawn in new lanes,
  // none of which takes page-p07's file
  assert.ok(f.opened.includes('page-p07<page-p07.json'));
  assert.ok(!f.asked['page-p07'].some((t) => pageOf('page-p07', t) === 'p09'), 'the failed page is not drawn again in the lane it failed in');
  const p07 = JSON.parse(fs.readFileSync(path.join(dir, '.studio/sessions/page-p07.json'), 'utf8')) as string[];
  assert.equal(p07[0], 'earlier');
  assert.deepEqual(okPages(f.d), storyboardOf(12).pages.map((p) => p.id));
});
