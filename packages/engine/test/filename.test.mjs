// A film's title becomes its export's file name (render.mjs): it must stay one file inside out/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileName } from '../tools/filename.mjs';

test('a title with a slash or a colon stays one file in out/', () => {
  const out = '/work/p/out';
  for (const title of ['【静帧1 / 0:00-0:12】 开场：基金到', 'Q3: costs/benefits', '../../etc/passwd', 'a\\b', 'C:\\x', 'tab\there', 'what? "why" <now> |*']) {
    const f = path.join(out, `${fileName(title)}-无字幕.mp4`);
    assert.equal(path.dirname(f), out, title);
    assert.doesNotMatch(path.basename(f), /[\/\\:*?"<>|\x00-\x1f]/, title);
  }
  assert.equal(fileName('【静帧1 / 0:00-0:12】 开场：基金到'), '【静帧1 - 0-00-0-12】 开场：基金到');
});

test('a plain title is kept; an empty or dotted one becomes video; a long one is cut', () => {
  assert.equal(fileName('光合作用'), '光合作用');
  assert.equal(fileName('The Count of Monte Cristo'), 'The Count of Monte Cristo');
  for (const t of ['', '...', ' / ', undefined]) assert.equal(fileName(t), 'video');
  assert.equal(fileName('a'.repeat(200)).length, 80);
  assert.doesNotMatch(fileName('x'.repeat(79) + ' .y'), /[\s.]$/);
});
