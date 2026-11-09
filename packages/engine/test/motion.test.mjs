// The engine's rhythm in time: a chapter card holds a page's first seconds, a page's turn is laid out, and a dealt batch
// speeds up (runtime/timing.js, runtime/core.js deal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../runtime/timing.js';

const { TIMING } = globalThis;
const pages = () => [
  { id: 'p01', cues: ['第一句话。', '第二句话。'] },
  { id: 'p02', turn: 'travel', chapter: '第二部分', cues: ['第三句话。'] },
  { id: 'p03', turn: 'spin', cues: ['第四句话。'] },
];

test('a chapter card delays the page\'s narration by TIMING.CARD, and only past the first page', () => {
  const plain = TIMING.layout(pages().map(({ chapter, ...p }) => p), { gap: 0.5 });
  const L = TIMING.layout(pages(), { gap: 0.5 });
  assert.equal(L.pages[1].card, TIMING.CARD);
  assert.ok(Math.abs(L.pages[1].cues[0].start - L.pages[1].start - (plain.pages[1].cues[0].start - plain.pages[1].start) - TIMING.CARD) < 1e-9);
  assert.ok(Math.abs(L.duration - plain.duration - TIMING.CARD) < 1e-9);
  const first = TIMING.layout([{ id: 'p01', chapter: '开场', cues: ['一句。'] }]);
  assert.equal(first.pages[0].card, 0);
});

test('a page\'s turn is one the engine knows, fade otherwise, and the first page has none', () => {
  const L = TIMING.layout([{ ...pages()[0], turn: 'cut' }, ...pages().slice(1)]);
  assert.deepEqual(L.pages.map((p) => p.turn), ['fade', 'travel', 'fade']);
});

test('deal: n times over the span, each gap shorter than the last', async () => {
  // core.js is a browser script; its deal() is plain arithmetic, evaluated here on its own
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../runtime/core.js', import.meta.url), 'utf8');
  const body = /function deal\(n, t0, span, k = 0\.72\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const deal = new Function(`${body}; return deal;`)();
  const t = deal(6, 1, 4, 0.7);
  assert.equal(t.length, 6);
  assert.equal(t[0], 1);
  assert.ok(Math.abs(t[5] - 5) < 1e-9);
  for (let i = 2; i < t.length; i++) assert.ok(t[i] - t[i - 1] < t[i - 1] - t[i - 2]);
  assert.deepEqual(deal(1, 2, 3), [2]);
  assert.deepEqual(deal(0, 2, 3), []);
});
