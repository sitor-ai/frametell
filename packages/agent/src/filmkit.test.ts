import { test } from 'node:test';
import { askedPage } from './testing.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { editIn, writeIn } from './projectfs.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

/** each component as its own session writes it, and its lines on the check page */
const PARTS: Record<string, { code: string; check: string }> = {
  globe: { code: "(function () {\n  const B = PV.Builder.prototype;\n  /** globe(x, y, r, o): a turning globe. o: { at } */\n  B.globe = function (x, y, r, o = {}) { return this.circle(x, y, r, o); };\n})();\n", check: 'P.globe(400, 400, 200, { at: P.c(0) });' },
  kettle: { code: "(function () {\n  const B = PV.Builder.prototype;\n  /** kettle(x, y, o): the red kettle. o: { at } */\n  B.kettle = function (x, y, o = {}) { return this.circle(x, y, 100, o); };\n})();\n", check: 'P.kettle(400, 400, { at: P.c(0) });' },
  flag: { code: "(function () {\n  const B = PV.Builder.prototype;\n  /** flag(x, y, label, o): a pin with a label. o: { at } */\n  B.flag = function (x, y, label, o = {}) { return this.text(label, { x, y, ...o }); };\n})();\n", check: "P.flag(1200, 400, 'A', { at: P.c(1) });" },
};
const PAGE = "ENGINE.visual('p01', (P) => {\n  P.globe(960, 500, 300);\n});\n";
const ids = Array.from({ length: 8 }, (_, i) => `p0${i + 1}`);
const KIT_PLAN = [{ name: 'globe', what: 'a turning globe', pages: ids.slice(0, 4) }, { name: 'flag', what: 'a pin with a label', pages: ids.slice(2, 6) }];

/** the page model: writes the kit and its check page when asked for the kit, the page otherwise; `systems` keeps what
 *  each session was told */
function artist(systems: Record<string, string>, o: { writesKit?: boolean } = {}): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'opus' },
    async open(s) {
      systems[s.name] = s.system;
      return { ref: s.name, close: async () => {}, send: async ({ text }: { text: string }) => {
        if (s.name === 'kit-route') return { text: '', stopReason: 'done', usage: {}, answers: [{ name: 'components', args: { names: /蓝/.test(text) ? ['globe', 'nope'] : [] } }] } as never;
        if (s.name.startsWith('kit-') && /^The user looked at the film's first page/.test(text)) { fs.appendFileSync(path.join(s.cwd, `extras/kit/${s.name.slice(4)}.js`), '// bluer\n'); return { text: 'done', stopReason: 'done', usage: {}, answers: [] } as never; }
        if (s.name.startsWith('kit-')) {
          // a session may hold more than one component: the one asked about is the file the message names
          const name = /extras\/kit\/(\w+)\.js/.exec(text)?.[1] ?? s.name.slice(4);
          if (/^Check round/.test(text)) { if (/They may not be yours/.test(text) && !/throws/.test(text)) return { text: 'not mine', stopReason: 'done', usage: {}, answers: [] } as never; fs.appendFileSync(path.join(s.cwd, `extras/kit/${name}.js`), '// changed\n'); }
          else if (o.writesKit !== false && /film's own components|Write both/.test(text)) {
            fs.mkdirSync(path.join(s.cwd, 'extras/kit'), { recursive: true });
            fs.writeFileSync(path.join(s.cwd, `extras/kit/${name}.js`), PARTS[name].code);
            fs.writeFileSync(path.join(s.cwd, `extras/kit/${name}.check.js`), PARTS[name].check);
          }
        } else if (s.name.startsWith('page-')) {
          const id = askedPage(text, s.name);
          fs.writeFileSync(path.join(s.cwd, `pages/${id}.js`), PAGE.replace('p01', id));
          // one page reaches into the film's components
          if (id === 'p02' && fs.existsSync(path.join(s.cwd, 'extras'))) fs.writeFileSync(path.join(s.cwd, 'extras/film-kit.js'), '/* gone */');
        }
        return { text: 'done', stopReason: 'done', usage: {}, answers: [] } as never;
      } };
    },
  };
}

/** a reviewer: fails the flag on the kit's sheet, passes every page */
function reviewer(prompts: string[], o: { failFlag?: boolean } = {}): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'y', id: 'haiku' },
    async open(s) {
      return { ref: 'v', close: async () => {}, send: async ({ text }: { text: string }) => {
        prompts.push(`${s.name}: ${text}`);
        const problems = s.name === 'check-kit' && o.failFlag ? [{ at: 4, what: 'flag: the pin is cut off', fix: 'move it in' }] : [];
        return { text: '', stopReason: 'done', usage: {}, answers: [{ name: 'verdict', args: { pass: !problems.length, problems } }] } as never;
      } };
    },
  };
}

function film(o: { pages?: number; kit?: unknown; designed?: boolean; writesKit?: boolean; failFlag?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-filmkit-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: '_test',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const systems: Record<string, string> = {}, prompts: string[] = [], events: StudioEvent[] = [];
  const art = artist(systems, { writesKit: o.writesKit });
  const d = new Director({ dir, style: '_test', brief: { durationSec: 180, lang: 'zh', replyLang: 'zh' }, runtime: art, pages: { runtime: art }, reviewer: { runtime: reviewer(prompts, { failFlag: o.failFlag }) }, emit: (e) => events.push(e) });
  const n = o.pages ?? 8;
  const sb = { title: 'T', summary: 'S', look: { card: 'card', kit: o.kit ?? KIT_PLAN }, pages: Array.from({ length: n }, (_, i) => ({ id: `p0${i + 1}`, section: 's', say: '…', beats: [] })) };
  const timing = { duration: n * 5, pages: sb.pages.map((p, i) => ({ id: p.id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) };
  const checked: string[] = [];
  Object.assign(d.project, {
    check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined,
    storyboard: () => sb, timeline: async () => timing,
  });
  Object.assign(d, {
    designed: () => (o.designed === false ? undefined : { card: 'card', look: { palette: { ink: '#111111' } } }),
    checkKit: async (items: { name: string }[]) => {
      checked.push(fs.readFileSync(path.join(dir, 'extras/film-kit.js'), 'utf8'));
      return { page: { start: 0, end: 5.2, cues: items.map((_, i) => ({ abs: i * 2.6 })) }, times: [2.3, 4.9], check: { issues: [], sheet: path.join(dir, 'kit.jpg') } };
    },
  });
  fs.writeFileSync(path.join(dir, 'kit.jpg'), 'jpg');
  return { d: d as unknown as { kit(): Promise<void>; pages(): Promise<void>; state: { kit?: { status: string; components: string[] }; pages: Record<string, { status: string; issues: { msg: string }[] }> } }, dir, systems, prompts, events, checked };
}

test('a designed style\'s film of eight pages writes its components first, and every page is shown them', async () => {
  const f = film();
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe', 'flag'] });
  assert.match(f.systems['kit-globe'], /This film's style card/);
  assert.ok(!f.systems['kit-flag'], 'two components share a session: its prompt is written to the cache once');
  assert.ok(f.events.some((e) => e.type === 'kit' && e.status === 'done'));
  await f.d.pages();
  // the pages load it (META.extras) and are told about it, first
  assert.match(fs.readFileSync(path.join(f.dir, 'script.js'), 'utf8'), /extras: \["extras\/film-kit\.js"\]/);
  assert.match(f.systems['page-p01'], /This film's own components \(film-kit\.js\)[\s\S]*P\.globe\(x, y, r, o = \{\}\)[\s\S]*P\.flag\(x, y, label, o = \{\}\)/);
  assert.ok(f.prompts.some((p) => p.startsWith('check-p01')));  // the pages see the kit's source too, so they need not read the file
  assert.match(f.systems['page-p01'], /no need to read the file[\s\S]*B\.globe/);
});

test('once checked, the components are fixed: the agents\' file tools refuse them, and a shell\'s change is put back', async () => {
  const f = film();
  await f.d.kit();
  // the write and edit tools go through writeIn without the studio's record: refused, with why
  assert.throws(() => writeIn(f.dir, 'extras/film-kit.js', 'x'), /every page of this film uses it/);
  assert.throws(() => editIn(f.dir, 'extras/film-kit.js', (src) => src + 'x'), /every page of this film uses it/);
  writeIn(f.dir, 'extras/other.js', 'fine');   // the rest of the film is not
  // p02's agent changes it through its shell (the fake writes it directly): put back before the pages are checked
  await f.d.pages();
  assert.equal(fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8'), fs.readFileSync(path.join(f.dir, '.studio/film-kit.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8'), /B\.globe/);
  assert.equal(f.d.state.pages.p02.status, 'ok');
});

test('a component the check fails is kept out; the others are given to the pages', async () => {
  const f = film({ failFlag: true });
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe'] });
  const kit = fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8');
  assert.match(kit, /B\.globe/);
  assert.doesNotMatch(kit, /B\.flag/);
  assert.equal(f.checked.length, 3);   // checked, fixed and checked again, up to three times
  // the flag kept failing, so the last kit is what the third check saw, less the flag
  assert.match(f.checked[2], /\/\/ changed\n\/\/ changed/);
});

test('a film in a style with its own look gets its kit when its pages are drawn in lanes apart; drawn in one, it needs none', async () => {
  const f = film({ pages: 8, designed: false, kit: [{ name: 'kettle', what: 'a red electric kettle', pages: ['p01', 'p02', 'p08'] }] });
  await f.d.kit();
  assert.equal(f.d.state.kit?.status, 'done');
  assert.doesNotMatch(f.systems['kit-kettle'], /This film's style card/);
  const g = film({ pages: 3, designed: false, kit: [{ name: 'kettle', what: 'a red electric kettle', pages: ['p01', 'p02', 'p03'] }] });
  await g.d.kit();
  assert.deepEqual(g.d.state.kit, { status: 'none', components: [] });
});

test('no kit for a one-page film or a storyboard that lists none', async () => {
  for (const o of [{ pages: 1, kit: [{ name: 'globe', what: 'g', pages: ['p01'] }] }, { kit: [] }]) {
    const f = film(o);
    await f.d.kit();
    assert.deepEqual(f.d.state.kit, { status: 'none', components: [] }, JSON.stringify(o));
    assert.ok(!Object.keys(f.systems).some((n) => n.startsWith('kit')));
  }
});

test('a kit that is never written leaves the pages to draw everything, as before', async () => {
  const f = film({ writesKit: false });
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'failed', components: [] });
  await f.d.pages();
  assert.doesNotMatch(f.systems['page-p01'], /This film's own components/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir, 'script.js'), 'utf8'), /film-kit/);
});

test('a kit that throws goes back to its session with the error, and is kept once it draws', async () => {
  const f = film();
  const asked: string[] = [];
  const runtime = (f.d as unknown as { o: { pages: { runtime: AgentRuntime } } }).o.pages.runtime;
  const open = runtime.open.bind(runtime);
  runtime.open = async (s, resume) => { const x = await open(s, resume); const send = x.send; return { ...x, send: async (m: { text: string }) => { if (s.name.startsWith('kit-')) asked.push(m.text); return send(m as never); } }; };
  let round = 0;
  Object.assign(f.d, {
    checkKit: async (items: { name: string }[]) => {
      round++;
      const issues = round === 1 ? [{ page: 'kit', t: 0, t1: 0, local: 0, kind: 'runtime', level: 'error', msg: 'runtime error (build): this.nope is not a function' }] : [];
      return { page: { start: 0, end: 5.2, cues: items.map((_, i) => ({ abs: i * 2.6 })) }, times: [2.3, 4.9], check: { issues, sheet: path.join(f.dir, 'kit.jpg') } };
    },
  });
  await f.d.kit();
  assert.equal(round, 2);
  assert.equal(asked.filter((t) => /throws when it runs[\s\S]*this\.nope is not a function/.test(t)).length, 2, 'a crash goes to every component');
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe', 'flag'] });
});

test('a change at the first page that reaches a component is made in it, checked, and fixed again for the pages', async () => {
  const f = film();
  await f.d.kit();
  const before = fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8');
  const d = f.d as unknown as { kitChange(change: string): Promise<void> };
  await d.kitChange('地球画得更蓝一点');
  const kit = fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8');
  assert.notEqual(kit, before);
  assert.match(kit, /B\.globe[\s\S]*\/\/ bluer/);
  assert.doesNotMatch(kit.split('B.flag')[1] ?? '', /bluer/, 'only the component the change reaches');
  assert.equal(fs.readFileSync(path.join(f.dir, '.studio/film-kit.js'), 'utf8'), kit, 'kept as checked');
  assert.throws(() => writeIn(f.dir, 'extras/film-kit.js', 'x'), /every page of this film uses it/);
  assert.ok(f.events.some((e) => e.type === 'kit' && e.status === 'start' && e.components?.join() === 'globe'));
  assert.ok(f.prompts.some((p) => /asked for this change to globe: 地球画得更蓝一点/.test(p)));
  // a change to the page alone reaches none: nothing is written
  const n = f.checked.length;
  await d.kitChange('镜头再推近一点');
  assert.equal(f.checked.length, n);
});

/** the page runtime's sessions, each send first running `turns(name, text)` model turns (as many as it may: the
 *  session's maxTurns and the send's own cap) and the tool calls `tools(name)` gives, as a model would */
function instrument(f: ReturnType<typeof film>, o: { turns?: (name: string, text: string) => number; tools?: (name: string) => { name: string; input: { path?: string; command?: string } }[] }) {
  const sent: { name: string; text: string; maxTurns?: number }[] = [];
  const runtime = (f.d as unknown as { o: { pages: { runtime: AgentRuntime } } }).o.pages.runtime;
  const open = runtime.open.bind(runtime);
  runtime.open = async (s, resume) => {
    const x = await open(s, resume);
    return { ...x, send: async (m: { text: string; maxTurns?: number }) => {
      sent.push({ name: s.name, text: m.text, maxTurns: m.maxTurns });
      for (const [i, t] of (o.tools?.(s.name) ?? []).entries()) s.onEvent?.({ type: 'tool_start', id: `t${i}`, name: t.name, summary: JSON.stringify(t.input), input: t.input });
      const n = Math.min(o.turns?.(s.name, m.text) ?? 0, s.maxTurns, m.maxTurns ?? Infinity);
      for (let i = 0; i < n; i++) s.onEvent?.({ type: 'turn', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
      return x.send(m as never);
    } };
  };
  return sent;
}

test('a kit session is told how a component is written, so it never needs the engine\'s source', async () => {
  const f = film();
  await f.d.kit();
  assert.match(f.systems['kit-globe'], /# Writing a component[\s\S]*don't read engine\/ to find more[\s\S]*What a call returns/);
  assert.doesNotMatch(f.systems['page-p01'] ?? '', /# Writing a component/);
});

test('a session reading the engine\'s source is reported once, and the call\'s command goes no further than the director', async () => {
  const f = film();
  instrument(f, { tools: (name) => (name.startsWith('kit-') ? [
    { name: 'read', input: { path: 'extras/kit/globe.js' } },
    { name: 'bash', input: { command: 'node engine/tools/lint.mjs --only kit' } },
    { name: 'bash', input: { command: 'grep -n "Builder.prototype" engine/runtime/*.js' } },
    { name: 'read', input: { path: 'engine/styles/midcentury/kit.js' } },
  ] : []) });
  await f.d.kit();
  const anomalies = f.events.filter((e) => e.type === 'anomaly');
  assert.deepEqual(anomalies, [{ type: 'anomaly', kind: 'source-reading', session: 'kit-globe', detail: 'grep -n "Builder.prototype" engine/runtime/*.js' }]);
  const calls = f.events.flatMap((e) => (e.type === 'agent' && e.event.type === 'tool_start' ? [e.event] : []));
  assert.ok(calls.length >= 4);
  assert.ok(calls.every((c) => !('input' in c)), 'logged without its input');
});

test('a crash raised in one component goes to its session alone; the others are not woken', async () => {
  const kettle = { name: 'kettle', what: 'the red kettle', pages: ids.slice(1, 5) };
  const f = film({ kit: [...KIT_PLAN, kettle] });
  const sent = instrument(f, {});
  let round = 0;
  Object.assign(f.d, {
    checkKit: async (items: { name: string }[]) => {
      round++;
      // the kit put together: globe on lines 1–5, flag on 7–11 (B.flag on 10)
      const issues = round === 1 ? [{ page: 'kit', t: 0, t1: 0, local: 0, kind: 'runtime', level: 'error', msg: 'runtime error (build): label.x is undefined — at extras/film-kit.js:10:7, engine/runtime/engine.js:130:9' }] : [];
      return { page: { start: 0, end: 7.8, cues: items.map((_, i) => ({ abs: i * 2.6 })) }, times: [2.3, 4.9, 7.5], check: { issues, sheet: path.join(f.dir, 'kit.jpg') } };
    },
  });
  await f.d.kit();
  assert.equal(fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8').split('\n')[9].trim().slice(0, 7), 'B.flag ');
  const fixes = sent.filter((x) => /^Check round/.test(x.text));
  assert.deepEqual(fixes.map((x) => x.name), ['kit-flag'], 'globe and kettle share the other session, which is not woken');
  assert.match(fixes[0].text, /raised in your extras\/kit\/flag\.js[\s\S]*at extras\/kit\/flag\.js:4:7/);
  assert.doesNotMatch(fixes[0].text, /may not be yours/);
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe', 'flag', 'kettle'] });
});

test('a kit session is held to its turns over its whole life: spent, it is sent nothing more, said once', async () => {
  const f = film({ failFlag: true });
  const sent = instrument(f, { turns: (name) => (name.startsWith('kit-') ? 20 : 0) });
  await f.d.kit();
  // one session holds both: globe's exchange takes its 16 (a send's cap), flag's the 8 left of 24
  const kit = sent.filter((x) => x.name === 'kit-globe');
  assert.deepEqual(kit.map((x) => x.maxTurns), [24, 8], 'no fix round reaches the model once the budget is spent');
  assert.deepEqual(f.events.filter((e) => e.type === 'anomaly'), [{ type: 'anomaly', kind: 'turn-budget', session: 'kit-globe', detail: '24 turns of 24' }]);
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe'] });   // the flag kept as it failed: out
});

test('a lane may take a page\'s worth of turns more for each page it draws', async () => {
  const f = film({ kit: [] });
  const sent = instrument(f, { turns: (name) => (name.startsWith('page-') ? 60 : 0) });
  await f.d.pages();
  const lane = sent.filter((x) => x.name === 'page-p01');
  assert.deepEqual(lane.map((x) => x.maxTurns), [40, 40, 40, 40], 'each page brings 40 more, each draft takes them all');
  assert.deepEqual(f.events.filter((e) => e.type === 'anomaly' && e.session === 'page-p01').length, 1);
  assert.ok(Object.values(f.d.state.pages).every((p) => p.status === 'ok'));
});
