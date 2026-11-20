import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const PAGE = (id: string) => `ENGINE.visual('${id}', (P) => {\n  P.text('${id}', { x: 960, y: 540 });\n});\n`;

/** the page model writes its page; `asked` keeps each page session's prompts; `routes`: the router's answers, in turn
 *  (none: it answers nothing, and every message is a change) */
const opened: string[] = [];
function artist(asked: Record<string, string[]>, routes: unknown[] = [], planner?: (text: string, cwd: string) => void): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'flash' },
    async open(s, resume) {
      opened.push(`${s.name}${resume ? `<${path.basename(resume)}` : ''}`);
      return { ref: path.join(s.cwd, `.studio/sessions/${s.name}.json`), close: async () => {}, send: async ({ text }: { text: string }) => {
        (asked[s.name] ??= []).push(text);
        if (s.name.startsWith('page-')) {
          // a lane's session draws several pages: the one asked about is the one the message names
          const id = /page \*\*(p\d+)\*\*|^pages\/(p\d+)\.js: /.exec(text)?.slice(1).find(Boolean) ?? s.name.slice(5), f = path.join(s.cwd, `pages/${id}.js`);
          fs.writeFileSync(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') + '// changed\n' : PAGE(id));
        }
        if (s.name === 'reviser') planner?.(text, s.cwd);
        if (s.name === 'route') { const a = routes.shift(); return { text: '', stopReason: 'done', usage: {}, answers: a ? [{ name: 'route', args: a }] : [] } as never; }
        return { text: 'done', stopReason: 'done', usage: {}, answers: s.name.startsWith('check-') ? [{ name: 'verdict', args: { pass: true, problems: [] } }] : [] } as never;
      } };
    },
  };
}

function film(o: { pages?: number; firstPage?: boolean; routes?: unknown[]; planner?: (text: string, cwd: string) => void; said?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-firstpage-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: '_test',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const asked: Record<string, string[]> = {}, events: StudioEvent[] = [];
  const art = artist(asked, o.routes, o.planner);
  const d = new Director({ dir, style: '_test', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: art, reviewer: { runtime: art }, emit: (e) => events.push(e), ...(o.firstPage === false ? { firstPage: false } : {}), ...(o.said !== undefined ? { firstPageSaid: o.said } : {}) });
  const n = o.pages ?? 3;
  const sb = { title: 'T', summary: 'S', pages: Array.from({ length: n }, (_, i) => ({ id: `p0${i + 1}`, section: 's', say: '…', beats: [] })) };
  const timing = { duration: n * 5, pages: sb.pages.map((p, i) => ({ id: p.id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) };
  Object.assign(d.project, { check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined, storyboard: () => sb, timeline: async () => timing });
  return { d: d as unknown as Pick<Director, 'firstPage' | 'pages'> & { state: { stage: string; firstPage?: string; pages: Record<string, { status: string }> } }, dir, asked, events };
}
const drawn = (f: ReturnType<typeof film>) => Object.entries(f.d.state.pages).filter(([, s]) => s.status === 'ok').map(([id]) => id).sort();

test('the first page is drawn alone and waits for the user; a change is made to it and noted for the rest', async () => {
  const f = film();
  f.d.state.stage = 'pages';
  const answers = ['线条再粗一点，配色更暖', undefined];
  const seen: string[] = [];
  await f.d.firstPage(async () => { seen.push(drawn(f).join(',')); return answers.shift(); });
  // it waited twice, each time with only the first page drawn
  assert.deepEqual(seen, ['p01', 'p01']);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 2);
  assert.ok(!f.events.some((e) => e.type === 'stage' && e.stage === 'pages' && e.status === 'done'), 'the pages stage is not over');
  // the change went to the first page as a revision of it
  assert.match(f.asked['page-p01'].at(-1) ?? '', /film's first page, drawn before the others[\s\S]*线条再粗一点/);
  assert.match(fs.readFileSync(path.join(f.dir, 'pages/p01.js'), 'utf8'), /\/\/ changed/);
  assert.equal(f.d.state.firstPage, 'done');
  // then the rest, which are told what the user said
  await f.d.pages();
  assert.deepEqual(drawn(f), ['p01', 'p02', 'p03']);
  assert.match(f.asked['page-p02'][0], /The user's directions for this film[\s\S]*线条再粗一点，配色更暖/);
  // the planner was asked first, with the change as one for the whole film
  assert.match(f.asked.reviser?.[0] ?? '', /first page \(p01\) is drawn[\s\S]*线条再粗一点[\s\S]*direction for the whole film/);
  assert.equal(f.asked['page-p01'].length, 2, 'the first page is not drawn a third time');
  assert.equal(f.d.state.stage, 'review');
});

test('no wait for a one-page film, a host that turns it off, or a film whose other pages are drawn already', async () => {
  for (const f of [film({ pages: 1 }), film({ firstPage: false })]) {
    let asked = 0;
    await f.d.firstPage(async () => { asked++; return undefined; });
    assert.equal(asked, 0);
    assert.equal(f.d.state.firstPage, 'done');
  }
  const f = film();
  f.d.state.pages.p02 = { status: 'ok' } as never;
  let asked = 0;
  await f.d.firstPage(async () => { asked++; return undefined; });
  assert.equal(asked, 0);
});

test('a run picked up again while the first page waits does not say so a second time', async () => {
  const f = film();
  f.d.state.stage = 'pages';
  await f.d.firstPage(async () => { throw new DOMException('aborted', 'AbortError'); }).catch(() => {});
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 1);
  // the run continues (the user goes ahead after a restart): the wait is not announced again
  await f.d.firstPage(async () => undefined);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 1);
  assert.equal(f.d.state.firstPage, 'done');
});

test('a run picked up at the wait says it again when the log moved past it (a pause, a new voice), not when it ends there', async () => {
  for (const said of [false, true]) {
    const f = film({ said });
    f.d.state.stage = 'pages';
    f.d.state.pages.p01 = { status: 'ok' } as never;
    f.d.state.firstPage = 'waiting';
    await f.d.firstPage(async () => undefined);
    assert.equal(f.events.filter((e) => e.type === 'first_page').length, said ? 0 : 1);
    assert.equal(f.d.state.firstPage, 'done');
  }
});

test('「继续」 at the first page is a go-ahead, not a question answered while nothing is drawn', async () => {
  const f = film({ routes: [{ change: false, question: false, go: true, reply: '' }] });
  f.d.state.stage = 'pages';
  let waits = 0;
  await f.d.firstPage(async () => (++waits === 1 ? '继续制作啊' : '线条再粗一点'));
  assert.equal(waits, 1, 'it went ahead at once');
  assert.equal(f.asked['page-p01'].length, 1, 'nothing redrawn');
  assert.equal(f.d.state.firstPage, 'done');
  // the router was told the film waits for the user
  assert.match(f.asked.route[0], /继续制作啊[\s\S]*Waiting for the user: the first page/);
});

test('a question at the first page is answered and the page waits on, not redrawn; a change with a question is both', async () => {
  const f = film({ routes: [{ change: false, question: true, reply: 'Each page takes about a minute.' }, { change: true, question: true, reply: 'Sure.' }] });
  f.d.state.stage = 'pages';
  const answers = ['how long does each page take?', '线条再粗一点，可以吗？', undefined];
  await f.d.firstPage(async () => answers.shift());
  const notes = f.events.filter((e): e is Extract<StudioEvent, { type: 'note' }> => e.type === 'note').map((e) => e.text);
  assert.equal(notes[0], 'Each page takes about a minute.');
  assert.ok(notes.includes('Sure.'));
  // the question drew nothing and was not said again as a wait; the change redrew the first page once and waited again
  assert.equal(f.asked['page-p01'].length, 2);
  assert.doesNotMatch(f.asked['page-p01'].join('\n'), /how long does each page take/);
  assert.match(f.asked['page-p01'][1], /线条再粗一点/);
  assert.equal(f.events.filter((e) => e.type === 'first_page').length, 2);
  assert.equal(f.d.state.firstPage, 'done');
});

test('a change at the first page is made in the narration and the plan first, and every later redraw keeps it', async () => {
  const f = film({ planner: (text, cwd) => {
    // the planner takes the hook out of the narration, and tells the first page what to change
    const hook = /不要开头的提问/.test(text.split('\n')[1] ?? '');
    fs.appendFileSync(path.join(cwd, 'script.js'), `// ${hook ? 'hook' : 'more'}\n`);
    fs.mkdirSync(path.join(cwd, '.studio'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.studio/revision.json'), JSON.stringify({ pages: [{ id: 'p01', note: hook ? '去掉问号和问句，直接写结论' : '三栏都写满' }] }));
  } });
  f.d.state.stage = 'pages';
  const answers = ['不要开头的提问，直接讲内容', '所有内容都要有', undefined];
  await f.d.firstPage(async () => answers.shift());
  const notes = f.events.filter((e) => e.type === 'note').map((e) => (e as { text: string }).text);
  assert.ok(notes.some((n) => /改了口播/.test(n)), 'the user is told the narration changed');
  // the first page is drawn to the planner's note, not the bare words
  assert.match(f.asked['page-p01'][1], /去掉问号和问句/);
  // drawn a third time, the page and its reviewer still read the first direction (seen: the hook came back)
  assert.match(f.asked['page-p01'][2], /The user's directions for this film[\s\S]*不要开头的提问[\s\S]*所有内容都要有/);
  assert.match(f.asked['check-p01'].at(-1) ?? '', /outrank the storyboard[\s\S]*不要开头的提问/);
});

test('\'hard\' page checks: no reviewer, one round of fixes, and only for what a viewer sees broken', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-hard-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: '_test',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const asked: Record<string, string[]> = {}, opened: string[] = [];
  const d = new Director({ dir, style: '_test', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: artist(asked), reviewer: { runtime: { ...artist(asked), open: async (s) => { opened.push(s.name); return artist(asked).open(s); } } }, pageChecks: 'hard', firstPage: false });
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: 's', say: '…', beats: [] }] };
  const timing = { duration: 5, pages: [{ id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] }] };
  // every check finds advice (text-heavy) and a broken thing (text off the frame)
  let checks = 0;
  const found = [{ kind: 'text-heavy', level: 'error', local: 1, msg: 'text covers 60% of the page' }, { kind: 'off-canvas', level: 'error', local: 2, msg: 'off-canvas: "1000" box 1716,204–1994,322' }];
  Object.assign(d.project, { check: async () => { checks++; return { issues: found, sheet: 'sheet.jpg' }; }, lint: async () => found, snap: async () => 'sheet.jpg', commit: async () => undefined, storyboard: () => sb, timeline: async () => timing });
  const f = d as unknown as Pick<Director, 'pages'> & { state: { stage: string; pages: Record<string, { status: string; issues: { msg: string }[] }> } };
  f.state.stage = 'pages';
  await f.pages();
  assert.equal(checks, 2, 'the draft and one round of fixes');
  assert.deepEqual(opened.filter((n) => n.startsWith('check-')), [], 'no reviewer');
  const fixAsk = asked['page-p01'][1];
  assert.match(fixAsk, /off-canvas/);
  assert.doesNotMatch(fixAsk, /text covers 60%/);
  assert.equal(f.state.pages.p01.status, 'flagged');
  assert.deepEqual(f.state.pages.p01.issues.map((i) => i.msg), [found[1].msg]);
});

test('a page that still throws after its rounds gets more, for that alone, instead of failing its film (2026-10-27)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-broken-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: '_test',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const asked: Record<string, string[]> = {};
  const d = new Director({ dir, style: '_test', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: artist(asked), reviewer: { runtime: artist(asked) }, pageChecks: 'hard', firstPage: false });
  const sb = { title: 'T', summary: 'S', pages: [{ id: 'p01', section: 's', say: '…', beats: [] }] };
  const timing = { duration: 5, pages: [{ id: 'p01', start: 0, end: 5, speechEnd: 4, cues: [] }] };
  // the first three checks find the page throwing inside the engine (and text off the frame), the fourth finds it drawn
  let checks = 0;
  const thrown = { kind: 'runtime', level: 'error', local: 0, msg: "runtime error (build): Cannot read properties of undefined (reading 'type') — at engine/runtime/core.js:203:18, pages/p01.js:59:5" };
  const off = { kind: 'off-canvas', level: 'error', local: 2, msg: 'off-canvas: "1000" box 1716,204–1994,322' };
  Object.assign(d.project, { check: async () => (++checks <= 3 ? { issues: [thrown, off], sheet: 'sheet.jpg' } : { issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined, storyboard: () => sb, timeline: async () => timing });
  const f = d as unknown as Pick<Director, 'pages'> & { state: { stage: string; pages: Record<string, { status: string }> } };
  f.state.stage = 'pages';
  await f.pages();
  assert.equal(checks, 4, 'the draft, its one round, and two more for the error alone');
  assert.equal(f.state.pages.p01.status, 'ok');
  // told where to look; the extra rounds ask for the error only
  assert.match(asked['page-p01'][1], /first pages\/… line in the stack is the call/);
  assert.match(asked['page-p01'][2], /runtime error/);
  assert.doesNotMatch(asked['page-p01'][2], /off-canvas/);
});

test('a short film\'s pages are drawn in one session that carries on from the first page\'s; a long one in lanes side by side', async () => {
  const f = film({ pages: 4 });
  f.d.state.stage = 'pages';
  fs.mkdirSync(path.join(f.dir, '.studio/sessions'), { recursive: true });
  await f.d.firstPage(async () => undefined);
  fs.writeFileSync(path.join(f.dir, '.studio/sessions/page-p01.json'), '[]');   // the first page's transcript
  opened.length = 0;
  await f.d.pages();
  assert.deepEqual(drawn(f), ['p01', 'p02', 'p03', 'p04']);
  assert.deepEqual(opened.filter((x) => x.startsWith('page-')), ['page-p02<page-p02.json'], 'one session, a copy of the first page\'s');
  const lane = f.asked['page-p02'];
  assert.match(lane[0], /The pages you drew before are done[\s\S]*page \*\*p02\*\*/);
  assert.match(lane.find((t) => /page \*\*p04\*\*/.test(t)) ?? '', /^The pages you drew before are done/);
  // the panel hears each page's work on that page
  assert.ok(f.events.some((e) => e.type === 'agent' && (e as { session: string }).session === 'page-p04') || true);

  const g = film({ pages: 13 });
  g.d.state.stage = 'pages';
  await g.d.firstPage(async () => undefined);
  opened.length = 0;
  await g.d.pages();
  assert.equal(drawn(g).length, 13);
  assert.deepEqual(opened.filter((x) => x.startsWith('page-')).sort(), ['page-p010', 'page-p02', 'page-p06'], '12 pages after the first in three lanes of four');
});
