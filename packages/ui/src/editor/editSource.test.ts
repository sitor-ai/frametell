import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { applyOp, EditRefused, instrument, pageInfo } from './editSource.ts';

const PAGE = `/* p02 Exploded pen */
ENGINE.visual('p02', (P) => {
  P.title('一支圆珠笔的五个零件');
  const y = 470;
  const parts = [{ n: 1, text: '笔帽' }, { n: 2, text: '弹簧' }];
  P.draft('M200 505H1720', { at: 0.05, line: 'center', color: 'soft', dur: 0.5 });
  P.explode(parts, { at: P.c(0, 0.1), apart: P.c(1, 0.1) });
  P.label(160, 830, 'EXPLODED VIEW', { at: P.c(0, 0.6) });
  P.hud.note(100, 100, '手感', { at: P.cw(2, '弹簧', -0.2), color: 'accent' });
  P.scene('assets/gen/p02-a.png', { at: 0.05, dur: 3.2 });
  for (const p of parts) P.mark(p.n, 0, 10, 10);
});
`;

test('a page as the editor sees it: each statement\'s call, when it appears, its colour and how long it draws; its words', () => {
  const info = pageInfo(PAGE, 'p02');
  assert.equal(info.statements.length, 9);
  const s = (i: number) => info.statements[i];
  assert.deepEqual(s(0), { i: 0, call: 'title', on: 'P', declares: null, movable: true, moved: null, hidden: false, at: null, color: null, dur: null });
  assert.equal(s(1).call, null);
  assert.equal(s(1).movable, false);
  assert.deepEqual(s(3).at, { form: 'seconds', t: 0.05 });
  assert.equal(s(3).color, 'soft');
  assert.equal(s(3).dur, 0.5);
  assert.deepEqual(s(4).at, { form: 'cue', cue: 0, dt: 0.1 });
  assert.deepEqual(s(6).at, { form: 'word', cue: 2, word: '弹簧', dt: -0.2 });
  assert.equal(s(6).movable, true);            // on P.hud
  assert.equal(s(7).movable, false);           // a scene fills the frame
  assert.equal(s(8).movable, true);            // a loop moves whole, in a layer
  assert.deepEqual(info.literals.map((l) => l.value), ['一支圆珠笔的五个零件', '笔帽', '弹簧', 'M200 505H1720', 'center', 'soft', 'EXPLODED VIEW', '手感', '弹簧', 'accent', 'assets/gen/p02-a.png']);
  assert.deepEqual(info.literals.slice(0, 3).map((l) => l.i), [0, 2, 2]);
  assert.deepEqual(info.literals.filter((l) => !l.display).map((l) => l.value), ['center', 'soft', 'accent']);
});

test('the instrumented copy runs as the page did, and tells the runtime each statement and each word', () => {
  const out = instrument(PAGE, 'p02');
  const seen: string[] = [];
  const calls: string[] = [];
  const P: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === 'c' || k === 'cw' ? () => 1 : k === 'hud' ? P : (...a: unknown[]) => { calls.push(`${String(k)}(${a.filter((x) => typeof x === 'string').join(',')})`); }) });
  const ctx = {
    ENGINE: { visual: (_id: string, fn: (p: unknown) => void) => fn(P) },
    __ED: { at: (_p: unknown, i: number) => seen.push(`at${i}`), end: () => seen.push('end'), s: (k: number, v: string) => { seen.push(`s${k}`); return v; } },
  };
  vm.runInNewContext(out, ctx);
  assert.deepEqual(seen.filter((x) => x.startsWith('at')), ['at0', 'at1', 'at2', 'at3', 'at4', 'at5', 'at6', 'at7', 'at8']);
  assert.equal(seen.at(-1), 'end');
  assert.ok(seen.includes('s0') && seen.includes('s10'));
  assert.ok(!seen.includes('s5'), 'an option\'s colour is not words');
  assert.equal(calls[0], 'title(一支圆珠笔的五个零件)');
});

test('edits are written where they belong: words, when, colour, how long', () => {
  let src = applyOp(PAGE, 'p02', { kind: 'text', k: 0, value: '圆珠笔的 "五" 个零件' });
  assert.match(src, /P\.title\("圆珠笔的 \\"五\\" 个零件"\);/);
  src = applyOp(src, 'p02', { kind: 'at', i: 4, cue: 1, dt: 0.25 });
  assert.match(src, /P\.explode\(parts, \{ at: P\.c\(1, 0\.25\), apart: P\.c\(1, 0\.1\) \}\);/);
  src = applyOp(src, 'p02', { kind: 'at', i: 6, cue: 9, dt: 0.1 });   // a word's time keeps its word and line
  assert.match(src, /at: P\.cw\(2, "弹簧", 0\.1\)/);
  src = applyOp(src, 'p02', { kind: 'at', i: 3, cue: 0, dt: 1.5 });
  assert.match(src, /P\.draft\('M200 505H1720', \{ at: 1\.5,/);
  src = applyOp(src, 'p02', { kind: 'color', i: 3, value: 'accent' });
  assert.match(src, /color: "accent", dur: 0\.5/);
  src = applyOp(src, 'p02', { kind: 'dur', i: 3, value: 1.2 });
  assert.match(src, /dur: 1\.2 \}/);
  // the rest of the page is untouched
  assert.ok(src.includes("const parts = [{ n: 1, text: '笔帽' }, { n: 2, text: '弹簧' }];"));
});

test('a move wraps the call in a layer the engine already has, on P or P.hud; moving it again rewrites its numbers', () => {
  let src = applyOp(PAGE, 'p02', { kind: 'move', i: 5, dx: 40, dy: -12, scale: 1.1, ox: 300, oy: 830 });
  assert.ok(src.includes(`{ const layer = P.layer(); layer.wrap.style.transformOrigin = "300px 830px"; layer.wrap.style.translate = "40px -12px"; layer.wrap.style.scale = "1.1";\n  layer.label(160, 830, 'EXPLODED VIEW', { at: P.c(0, 0.6) }); }`));
  let info = pageInfo(src, 'p02');
  assert.deepEqual(info.statements[5].moved, { dx: 40, dy: -12, scale: 1.1 });
  assert.equal(info.statements[5].call, 'label');
  assert.deepEqual(info.statements[5].at, { form: 'cue', cue: 0, dt: 0.6 });
  assert.equal(info.statements.length, 9);
  src = applyOp(src, 'p02', { kind: 'move', i: 5, dx: 0, dy: 5.5, scale: 1, ox: 300, oy: 830 });
  info = pageInfo(src, 'p02');
  assert.deepEqual(info.statements[5].moved, { dx: 0, dy: 5.5, scale: 1 });
  assert.equal((src.match(/P\.layer\(\)/g) ?? []).length, 1);
  // edits still reach a moved call
  src = applyOp(src, 'p02', { kind: 'at', i: 5, cue: 1, dt: 0 });
  assert.match(src, /layer\.label\(160, 830, 'EXPLODED VIEW', \{ at: P\.c\(1, 0\) \}\);/);
  src = applyOp(src, 'p02', { kind: 'move', i: 6, dx: 10, dy: 10, scale: 2, ox: 0, oy: 0 });
  assert.ok(src.includes('const layer = P.hud.layer();'));
  assert.ok(src.includes("layer.note(100, 100, '手感'"));
});

test('what is worked out rather than written, or is not a thing to move, is refused; a broken result never comes back', () => {
  const no = (op: Parameters<typeof applyOp>[2]) => assert.throws(() => applyOp(PAGE, 'p02', op), EditRefused);
  no({ kind: 'at', i: 0, cue: 1, dt: 0 });          // the title has no at
  no({ kind: 'color', i: 4, value: 'ink' });         // no colour written
  no({ kind: 'move', i: 7, dx: 1, dy: 1, scale: 1, ox: 0, oy: 0 });   // a scene
  no({ kind: 'move', i: 1, dx: 1, dy: 1, scale: 1, ox: 0, oy: 0 });   // a declaration
  no({ kind: 'move', i: 0, dx: Infinity, dy: 1, scale: 1, ox: 0, oy: 0 });
  no({ kind: 'text', k: 99, value: 'x' });
  no({ kind: 'color', i: 3, value: 'red; alert(1)' });
  assert.throws(() => pageInfo(PAGE, 'p03'), EditRefused);
  assert.throws(() => pageInfo('ENGINE.visual("p02", (P) => {', 'p02'), EditRefused);
});

test('a time worked out on the page plus a written offset: only the offset is edited', () => {
  const src = `ENGINE.visual('p02', (P) => {\n  const t0 = P.c(0);\n  P.text('one year', { x: 1420, y: 250, at: t0 + 1.0, cps: 10 });\n  P.text('start', { at: t0 - 0.5 });\n});\n`;
  const info = pageInfo(src, 'p02');
  assert.deepEqual(info.statements[1].at, { form: 'offset', from: 't0', dt: 1 });
  assert.deepEqual(info.statements[2].at, { form: 'offset', from: 't0', dt: -0.5 });
  let out = applyOp(src, 'p02', { kind: 'at', i: 1, cue: 0, dt: 2.25 });
  assert.match(out, /at: t0 \+ 2\.25, cps: 10/);
  out = applyOp(out, 'p02', { kind: 'at', i: 2, cue: 0, dt: 0.3 });
  assert.match(out, /at: t0 \+ 0\.3 \}/);
  out = applyOp(out, 'p02', { kind: 'at', i: 1, cue: 0, dt: -1 });
  assert.match(out, /at: t0 - 1, cps/);
});

test('a loop moves whole: it runs in a layer with the layer in the builder\'s place; delete hides a layer and undoes', () => {
  const page = `ENGINE.visual('p01', (P) => {\n  ['S', 'M', 'T'].forEach((d, i) => {\n    P.text(d, { x: 100 + i * 50, y: 360 });\n  });\n  P.hud.note(1, 2, 'x');\n  for (const n of [1]) P.hud.note(n, 0, 'y');\n});\n`;
  const info = pageInfo(page, 'p01');
  assert.equal(info.statements[0].movable, true);
  assert.equal(info.statements[2].movable, false);   // a loop on the hud: a layer has no hud
  let src = applyOp(page, 'p01', { kind: 'move', i: 0, dx: 10, dy: 0, scale: 1, ox: 0, oy: 0 });
  assert.ok(src.includes('{ const layer = P.layer(); layer.wrap.style.transformOrigin = "0px 0px"; layer.wrap.style.translate = "10px 0px"; layer.wrap.style.scale = "1";\n  ((P) => { [\'S\', \'M\', \'T\'].forEach'));
  const drawn: string[] = [];
  const builder = (name: string): Record<string, unknown> => ({ layer: () => ({ ...builder('layer'), wrap: { style: {} } }), text: (d: string) => drawn.push(`${name}:${d}`) });
  vm.runInNewContext(src, { ENGINE: { visual: (_id: string, fn: (p: unknown) => void) => fn({ ...builder('P'), hud: { note: () => {} } }) } });
  assert.deepEqual(drawn, ['layer:S', 'layer:M', 'layer:T']);
  assert.deepEqual(pageInfo(src, 'p01').statements[0].moved, { dx: 10, dy: 0, scale: 1 });
  src = applyOp(src, 'p01', { kind: 'move', i: 0, dx: 20, dy: 5, scale: 1, ox: 0, oy: 0 });
  assert.deepEqual(pageInfo(src, 'p01').statements[0].moved, { dx: 20, dy: 5, scale: 1 });
  src = applyOp(src, 'p01', { kind: 'hide', i: 0, hidden: true });
  assert.equal(pageInfo(src, 'p01').statements[0].hidden, true);
  src = applyOp(src, 'p01', { kind: 'hide', i: 0, hidden: false });
  assert.equal(pageInfo(src, 'p01').statements[0].hidden, false);
  assert.ok(!src.includes('display'));
  // a plain call hidden without a move first
  const hid = applyOp(page, 'p01', { kind: 'hide', i: 1, hidden: true });
  assert.ok(hid.includes('{ const layer = P.hud.layer(); layer.wrap.style.display = "none";\n  layer.note(1, 2, \'x\'); }'));
  assert.equal(pageInfo(hid, 'p01').statements[1].hidden, true);
});

test('a layer the page names (const S = P.layer(), moved by a tick) is a builder too: what it draws moves inside it', () => {
  const page = `ENGINE.visual('p03', (P) => {
  const S = P.layer();
  S.icon('sun', 960, 655, 70, { at: P.c(3, -0.1) });
  ['a', 'b'].forEach((w, i) => S.text(w, { x: i * 100, y: 0 }));
  layers.forEach(({ L }) => L.text('x', { at: P.c(1) }));
  P.tick((lt) => { S.wrap.style.transform = 'translate(' + lt + 'px, 0px)'; });
});
`;
  const info = pageInfo(page, 'p03');
  assert.equal(info.statements[0].declares, 'S');
  assert.equal(info.statements[1].on, 'S');
  assert.equal(info.statements[1].movable, true);
  assert.equal(info.statements[2].on, 'S');
  assert.equal(info.statements[3].movable, false, 'draws with a builder the page did not name');
  assert.equal(info.statements[4].movable, false);
  const sun = applyOp(page, 'p03', { kind: 'move', i: 1, dx: 40, dy: -20, scale: 1, ox: 960, oy: 655 });
  assert.match(sun, /\{ const layer = S\.layer\(\);.*\n {2}layer\.icon\('sun'/);
  assert.deepEqual(pageInfo(sun, 'p03').statements[1].moved, { dx: 40, dy: -20, scale: 1 });
  const row = applyOp(page, 'p03', { kind: 'move', i: 2, dx: 10, dy: 0, scale: 1, ox: 0, oy: 0 });
  assert.match(row, /\{ const layer = S\.layer\(\);.*\n {2}\(\(S\) => \{ \['a', 'b'\]/);
  assert.equal(pageInfo(row, 'p03').statements[2].on, 'S');
  assert.deepEqual(pageInfo(row, 'p03').statements[2].moved, { dx: 10, dy: 0, scale: 1 });
});

test('hand edits: a thing\'s edit is written in the page\'s ENGINE.edits, one line a thing; its code is left as it is', () => {
  const page = `ENGINE.visual('p01', (P) => {\n  P.title('Hi');\n  P.box(1, 2, 3, 4);\n});\n`;
  const a = applyOp(page, 'p01', { kind: 'item', n: 2, edit: { dx: 40, dy: -12.04, scale: 1, ox: 100, oy: 50 }, what: 'move' });
  assert.ok(a.startsWith(page.trimEnd()), 'the code before is untouched');
  assert.match(a, /\nENGINE\.edits\("p01", \{\n {2}"2": \{"dx":40,"dy":-12,"ox":100,"oy":50\}\n\}\);/);
  assert.deepEqual(pageInfo(a, 'p01').edits, { 2: { dx: 40, dy: -12, ox: 100, oy: 50 } });
  const b = applyOp(a, 'p01', { kind: 'item', n: 1, edit: { text: { 0: 'Hello' }, hidden: false }, what: 'text', words: 'Hello' });
  assert.deepEqual(pageInfo(b, 'p01').edits, { 1: { text: { 0: 'Hello' } }, 2: { dx: 40, dy: -12, ox: 100, oy: 50 } });
  const c = applyOp(applyOp(b, 'p01', { kind: 'item', n: 1, edit: null, what: 'text' }), 'p01', { kind: 'item', n: 2, edit: {}, what: 'move' });
  assert.equal(c, page, 'nothing left: the statement goes too');
  // the marked copy still has it, after the visual: the preview runs it
  const ran: unknown[] = [];
  vm.runInNewContext(instrument(b, 'p01'), { ENGINE: { visual: () => {}, edits: (id: string, m: unknown) => ran.push([id, m]) }, __ED: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(ran)), [['p01', { 1: { text: { 0: 'Hello' } }, 2: { dx: 40, dy: -12, ox: 100, oy: 50 } }]]);
  assert.throws(() => applyOp(page.replace('});\n', '});\nENGINE.edits(\'p01\', { 1: foo() });\n'), 'p01', { kind: 'item', n: 1, edit: null, what: 'move' }), EditRefused);
});

test('hand edits: a thing\'s edit is kept under the number it has now; the one written under its old number goes', () => {
  const page = `ENGINE.visual('p01', (P) => {\n  P.title('Hi');\n});\nENGINE.edits("p01", {\n  "1": {"fp":"title|Hi|0","hidden":true}\n});\n`;
  const out = applyOp(page, 'p01', { kind: 'item', n: 2, edit: { fp: 'title|Hi|0', hidden: true, dx: 5, ox: 0, oy: 0 }, what: 'move' });
  assert.deepEqual(pageInfo(out, 'p01').edits, { 2: { fp: 'title|Hi|0', dx: 5, ox: 0, oy: 0, hidden: true } });
  // an edit that is only a name is no edit
  assert.deepEqual(pageInfo(applyOp(page, 'p01', { kind: 'item', n: 1, edit: { fp: 'title|Hi|0' }, what: 'move' }), 'p01').edits, {});
});
