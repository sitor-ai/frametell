import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KIT_MAX, componentNames, keepComponents, kitCheckPage, kitIssues, kitLocate, kitPart, kitPlan, kitStage, kitTimes, kitWanted, reservedNames, styleNames } from './kit.js';

const ids = Array.from({ length: 10 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

test('the engine\'s own drawing calls are reserved: a film component may not replace them', () => {
  const r = reservedNames();
  for (const n of ['text', 'title', 'arrow', 'c', 'seed']) assert.ok(r.has(n), n);
  assert.ok(!r.has('chinaMap'));
});

test('the kit plan keeps well-formed components on two pages or more, once each, at most three', () => {
  const look = { kit: [
    { name: 'globe', what: 'a turning globe', pages: ['p01', 'p02', 'p09'] },
    { name: 'globe', what: 'again', pages: ['p01', 'p02', 'p03'] },
    { name: 'Bad-Name', what: 'x', pages: ['p01'] },
    { name: 'text', what: 'the engine already has this', pages: ['p01', 'p02', 'p03'] },
    { name: 'flag', what: '', pages: ['p01'] },
    { name: 'lonely', what: 'on one page only', pages: ['p04'] },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `thing${i}`, what: 'w', pages: ['p01', 'p02', 'p03'] })),
  ] };
  const plan = kitPlan(look);
  assert.equal(plan[0].name, 'globe');
  assert.equal(KIT_MAX, 3);
  assert.deepEqual(plan.map((x) => x.name), ['globe', 'thing0', 'thing1']);
  assert.deepEqual(kitPlan(undefined), []);
  assert.deepEqual(kitPlan({ kit: 'no' }), []);
});

test('the storyboard check says what is wrong with look.kit, and nothing when there is none', () => {
  assert.deepEqual(kitIssues({}, ids), []);
  assert.deepEqual(kitIssues({ kit: [{ name: 'globe', what: 'a globe', pages: ['p01', 'p02', 'p03'] }] }, ids), []);
  const issues = kitIssues({ kit: [
    { name: 'globe', what: 'a globe', pages: ['p01'] },
    { name: 'text', what: 'x', pages: ['p01', 'p02', 'p03'] },
    { name: 'map', what: 'x', pages: ['p01', 'p02', 'p99'] },
    { name: 'x y', what: 'x', pages: [] },
  ] }, ids).join('\n');
  assert.match(issues, /globe is on 1 page:/);
  assert.match(issues, /already one of the engine's P\.text/);
  assert.match(issues, /does not have: p99/);
  assert.match(issues, /"x y" is not a component name/);
});

test('a kit is written for any film of more than one page with one thing or more that recurs', () => {
  const one = kitPlan({ kit: [{ name: 'kettle', what: 'k', pages: ids.slice(0, 2) }] });
  assert.equal(kitWanted(5, one), true);
  assert.equal(kitWanted(1, one), false);
  assert.equal(kitWanted(40, []), false);
});

const KIT = `/* a film's kit */
(function () {
  const { col, Builder } = PV;
  const B = Builder.prototype;
  /** globe(x, y, r, o): a turning globe. o: { at } */
  B.globe = function (x, y, r, o = {}) {
    return this.circle(x, y, r, o);
  };
  /**
   * flag(x, y, label, o): a pin with a label.
   * o: { at, color }
   */
  B.flag = function (x, y, label, o = {}) {
    if (o.at) { return null; }
    return label;
  };
  /** slab(x, y, o): a terrain step */
  B.slab = function (x, y, o = {}) { return [x, y]; };
})();
`;

test('a kit keeps only the components that passed, each with its doc comment', () => {
  assert.deepEqual(componentNames(KIT), ['globe', 'flag', 'slab']);
  const kept = keepComponents(KIT, ['globe', 'slab']);
  assert.deepEqual(componentNames(kept), ['globe', 'slab']);
  assert.doesNotMatch(kept, /flag|pin with a label/);
  assert.match(kept, /\/\*\* slab\(x, y, o\)/);
  assert.match(kept, /^\}\)\(\);$/m);
  // what is left still runs
  const proto: Record<string, unknown> = {};
  new Function('PV', kept)({ col: {}, Builder: { prototype: proto } });
  assert.deepEqual(Object.keys(proto), ['globe', 'slab']);
  assert.equal(keepComponents(KIT, ['globe', 'flag', 'slab']), KIT);
});

test('the kit\'s check is a project of its own: the film\'s look, the kit, and one page with a cue per component', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  const items = kitPlan({ kit: [{ name: 'globe', what: 'g', pages: ids.slice(0, 3) }, { name: 'flag', what: 'f', pages: ids.slice(0, 3) }] });
  const stage = kitStage(dir, { style: '_test', lang: 'zh', look: { palette: { ink: '#111111' } }, items, kit: KIT, check: "ENGINE.visual('check', (P) => { P.globe(400, 400, 100, { at: P.c(0) }); });" });
  assert.equal(stage, path.join(dir, '.studio/kit'));
  assert.equal(fs.readFileSync(path.join(stage, 'extras/film-kit.js'), 'utf8'), KIT);
  assert.match(fs.readFileSync(path.join(stage, 'pages/kit.js'), 'utf8'), /^ENGINE\.visual\('kit'/);
  const ctx: { SCRIPT?: { META: Record<string, unknown>; PAGES: { id: string; cues: { t: string }[] }[] } } = {};
  new Function('globalThis', 'window', fs.readFileSync(path.join(stage, 'script.js'), 'utf8'))(ctx, ctx);
  assert.deepEqual(ctx.SCRIPT!.META.extras, ['extras/film-kit.js']);
  assert.deepEqual(ctx.SCRIPT!.META.look, { palette: { ink: '#111111' } });
  assert.deepEqual(ctx.SCRIPT!.PAGES[0].cues.map((c) => c.t), ['globe', 'flag']);
  assert.ok(fs.existsSync(path.join(stage, 'index.html')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the check sheet looks at each component once it is drawn, at most six moments', () => {
  assert.deepEqual(kitTimes([{ abs: 0 }, { abs: 3 }], 6), [2.7, 4.8]);
  assert.equal(kitTimes(Array.from({ length: 8 }, (_, i) => ({ abs: i * 3 })), 24).length, 6);
});

test("the style's own components are reserved too: a film's `presenter` would replace the style's own on every page", () => {
  assert.ok(styleNames('_test-kit').has('presenter'));
  assert.equal(styleNames('no-such-style').size, 0);
  const look = { kit: [{ name: 'presenter', what: 'the host', pages: ['p01', 'p02'] }, { name: 'teacher', what: 'the host, our colours', pages: ['p01', 'p02'] }] };
  assert.deepEqual(kitPlan(look, '_test-kit').map((x) => x.name), ['teacher']);
  assert.deepEqual(kitPlan(look).map((x) => x.name), ['presenter', 'teacher']);   // another style has none of that name
  assert.match(kitIssues(look, ids, '_test-kit').join('\n'), /presenter is already the style's own P\.presenter/);
});

test('an error of the kit\'s check is found in the component it was raised in, its frames as that file\'s lines', () => {
  const parts = [
    { name: 'globe', code: '(function () {\n  B.globe = function () {};\n})();\n', check: 'P.globe(1, 2, 3);' },
    { name: 'rattrap', code: '(function () {\n  const a = 1;\n  B.rattrap = function () { a.b.c; };\n})();\n', check: 'P.rattrap();\nP.rattrap({ at: 2 });' },
  ];
  // the kit as the director puts it together: globe on lines 1–3, a blank line, rattrap on 5–8
  const kit = parts.map((p) => p.code.trim()).join('\n\n') + '\n';
  assert.equal(kit.split('\n')[6], '  B.rattrap = function () { a.b.c; };');
  const r = kitLocate("runtime error (build): Cannot read properties of undefined (reading 'c') — at extras/film-kit.js:7:31, engine/runtime/engine.js:130:9", parts);
  assert.equal(r.owner, 'rattrap');
  assert.match(r.text, /at extras\/kit\/rattrap\.js:3:31, engine\/runtime\/engine\.js:130:9/);
  // the check page: line 1 opens it, globe's block is lines 2–4 (its line on 3), rattrap's 5–8 (its lines on 6 and 7)
  const page = kitCheckPage(parts.map((p) => p.check));
  assert.equal(page.split('\n')[6].trim(), 'P.rattrap({ at: 2 });');
  assert.deepEqual(kitLocate('x is not a function — at pages/kit.js:7:5', parts), { owner: 'rattrap', text: 'x is not a function — at extras/kit/rattrap.check.js:2:5' });
  assert.equal(kitLocate('at pages/kit.js:3:1', parts).owner, 'globe');
  // a part's own file names it; a frame of the engine alone names none
  assert.equal(kitLocate(`SyntaxError in ${kitPart('globe')}`, parts).owner, 'globe');
  assert.equal(kitLocate('boom — at engine/runtime/core.js:12:3', parts).owner, undefined);
  assert.equal(kitLocate('at extras/kit/nobody.js:1', parts).owner, undefined);
});
