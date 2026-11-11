// META.music: the film's background music, one bed under the whole film (runtime/timing.js sfxTimes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../runtime/timing.js';

const { TIMING } = globalThis;
const pages = [{ id: 'p01', cues: ['第一句。', '第二句。'] }, { id: 'p02', cues: ['第三句。'] }];

test('META.music lays one looped, ducked bed from the first frame to the last', () => {
  const L = TIMING.layout(pages, { music: { f: 'music/bed.mp3', vol: -2 } });
  const s = TIMING.sfxTimes(L);
  assert.equal(s.length, 1);
  assert.equal(s[0].f, 'music/bed.mp3');
  assert.equal(s[0].t0, 0);
  assert.equal(s[0].t1, L.duration);
  assert.equal(s[0].vol, -2);
  assert.equal(s[0].duck, 5);
  assert.ok(s[0].loop && s[0].fin > 0 && s[0].fout > 0);
});

test('no META.music, or one with no file: no bed, and the layout is as before', () => {
  const plain = TIMING.layout(pages);
  assert.deepEqual(TIMING.sfxTimes(plain), []);
  assert.equal('music' in plain, false);
  assert.deepEqual(TIMING.sfxTimes(TIMING.layout(pages, { music: {} })), []);
});
