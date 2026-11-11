import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { FFMPEG, probe } from '@frametell/engine/tools/bins.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepPictures, LEFT_OUT, PICTURE_BUDGET, picturesShown, SHOWN_AS_IS, SHOWN_EDGE, shownPicture } from './shown.js';

/** a transparent PNG of noise, w×h: as heavy as an image model's sticker (it hardly compresses) */
function noisePng(w: number, h: number): Buffer {
  const r = spawnSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', `nullsrc=s=${w}x${h},geq=random(1)*255:128:128,format=yuva420p,geq=lum='random(1)*255':cb=128:cr=128:a='if(lt(X,${w / 2}),0,255)'`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2', 'pipe:1'], { maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout;
}

test('a sticker-sized PNG is shown as a JPEG, much smaller, no larger than a model looks at', () => {
  const png = noisePng(1024, 1536);
  assert.ok(png.length > 2_000_000, `the test picture is heavy (${png.length} bytes)`);
  const shown = shownPicture(os.tmpdir(), 'assets/gen/mom.png', png);
  assert.equal(shown.file, 'assets/gen/mom.jpg');
  assert.equal(shown.data.subarray(0, 3).toString('hex'), 'ffd8ff', 'a JPEG');
  assert.ok(shown.data.length < png.length / 2, `${shown.data.length} vs ${png.length}`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shown-')), 'x.jpg');
  fs.writeFileSync(tmp, shown.data);
  const { width, height } = probe(tmp);
  assert.deepEqual([width, height], [1024, 1536], 'a picture within the edge keeps its size');
});

test('a picture larger than the edge is scaled down to it; a small one is shown as it is', () => {
  const big = shownPicture(os.tmpdir(), 'sheet.png', noisePng(2400, 1200));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shown-')), 'x.jpg');
  fs.writeFileSync(tmp, big.data);
  assert.equal(probe(tmp).width, SHOWN_EDGE);
  const small = Buffer.alloc(SHOWN_AS_IS - 1, 1);
  assert.equal(shownPicture(os.tmpdir(), 'a.png', small).data, small);
  // what ffmpeg cannot read is shown as it was (the model service says what it makes of it)
  const junk = Buffer.alloc(SHOWN_AS_IS + 10, 7);
  assert.deepEqual(shownPicture(os.tmpdir(), 'b.png', junk), { file: 'b.png', data: junk });
});

const img = (n: number) => ({ type: 'image', data: 'x'.repeat(n), mimeType: 'image/png' });
test('a conversation keeps its pictures under budget, leaving out the oldest first', () => {
  // a lane of four pages, three stickers each at ~5 MB of base64, as on 2026-11-11 before pictures were shrunk
  const msgs = Array.from({ length: 4 }, (_, p) => ({ role: 'user', content: [{ type: 'text', text: `page ${p + 1}` }, img(5e6), img(5e6), img(5e6)] }));
  const kept = keepPictures(msgs);
  const left = kept.flatMap((m) => m.content).filter((b: any) => b.type === 'image');
  const size = left.reduce((s, b: any) => s + b.data.length, 0);
  assert.ok(size <= PICTURE_BUDGET.low, `${size}`);
  assert.ok(size + 1e6 < 24 << 20, 'well under the gateway cap');
  // the newest are the ones kept, the oldest replaced by a line of text; the text of every message is kept
  assert.equal(kept[3].content.filter((b: any) => b.type === 'image').length, 1);
  assert.deepEqual(kept[0].content[1], { type: 'text', text: LEFT_OUT });
  assert.equal((kept[0].content[0] as any).text, 'page 1');
  assert.equal(msgs[0].content[1].type, 'image', 'the messages given are not changed');
});

test('under budget nothing changes (the same array: the cache is kept); a message about to be sent counts', () => {
  const msgs = [{ role: 'user', content: [img(1e6)] }, { role: 'toolResult', content: [img(1e6)] }, { role: 'assistant', content: 'text' }];
  assert.equal(keepPictures(msgs), msgs);
  const kept = keepPictures(msgs, undefined, { bytes: 13.5e6, count: 1 });
  assert.notEqual(kept, msgs);
  assert.equal((kept[0].content as any)[0].type, 'text');
  // too many pictures, however small
  const many = Array.from({ length: PICTURE_BUDGET.highCount + 1 }, () => ({ role: 'user', content: [img(10)] }));
  assert.equal(keepPictures(many).flatMap((m) => m.content).filter((b: any) => b.type === 'image').length, PICTURE_BUDGET.lowCount);
});

test('a page agent is shown its stickers small: four pages of three stickers come to a few MB, not past the gateway cap', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shown-project-')));
  try {
    fs.mkdirSync(path.join(root, 'assets/gen'), { recursive: true });
    const png = noisePng(1024, 1536);
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(root, `assets/gen/p${i}.png`), png);
    const shown = picturesShown(root, Array.from({ length: 12 }, (_, i) => `assets/gen/p${i}.png`));
    assert.equal(shown.length, 12);
    const base64 = shown.reduce((s, x) => s + Math.ceil(x.data.length / 3) * 4, 0);
    assert.ok(png.length * 12 * 4 / 3 > 24 << 20, 'as they were, the twelve pass the cap');
    assert.ok(base64 < PICTURE_BUDGET.high, `shown, they come to ${base64}`);
    assert.ok(shown.every((x) => x.file.endsWith('.jpg')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
