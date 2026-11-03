import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { writeIn } from './projectfs.js';
import { ledPage, lookPrefix, openaiImages, picturePageNote, picturePlanNote, pictureSize, picturePlan, pictureIssues, picturePrompt, pictureStyle, picturesOn, readPictures, sniffPicture, type ImageProvider, type PictureStyle } from './pictures.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const STYLE: PictureStyle = { kinds: ['object', 'character', 'scene'], max: 4, quality: 'medium', prefix: 'Flat vector, two-tone fills, no outlines', avoid: 'No text.' };
const ids = ['p01', 'p02', 'p03'];

/** a PNG's first bytes (signature and IHDR) with `seed` after them, so every picture drawn is a file of its own */
function png(w: number, h: number, seed: number, alpha = true) {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = alpha ? 6 : 2;
  b.writeUInt32BE(seed, 33);
  return new Uint8Array(b);
}

test('the storyboard\'s pictures: the well-formed ones, the sample first; a `like` only to one listed before it', () => {
  const look = { pictures: [
    { id: 'bird', kind: 'character', what: 'a small round bird', shape: 'square', pages: ['p01', 'p02'] },
    { id: 'chart', kind: 'texture', what: 'paper', pages: ['p01'] },               // a kind this style doesn't draw
    { id: 'bird-fly', kind: 'character', what: 'the bird flying', pages: ['p03'], like: 'bird' },
    { id: 'whale', kind: 'object', what: 'a whale', shape: 'oval', pages: ['p02'], like: 'bird-fly' },   // like a like: dropped
  ] };
  assert.deepEqual(picturePlan(look, STYLE).map((p) => [p.id, p.shape, p.like]), [['bird', 'square', undefined], ['bird-fly', 'wide', 'bird'], ['whale', 'wide', undefined]]);
  assert.deepEqual(picturePlan(look, undefined), []);
  const issues = pictureIssues(look, ids, STYLE).join('\n');
  assert.match(issues, /chart has kind "texture"; this style draws object, character, scene/);
  assert.match(issues, /chart needs `what`/);
  assert.match(issues, /whale has shape "oval"/);
  assert.match(issues, /whale is `like` bird-fly, which is itself `like` another/);
  assert.deepEqual(pictureIssues({}, ids, STYLE), []);
  const first = pictureIssues({ pictures: [{ id: 'a1', kind: 'object', what: 'a red kettle on its base', pages: ['p09'], like: 'b1' }] }, ids, STYLE).join('\n');
  assert.match(first, /names pages the storyboard does not have: p09/);
  assert.match(first, /a1 is the first picture, the film's sample/);
  assert.match(pictureIssues({ pictures: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, kind: 'object', what: 'a thing to draw', pages: ['p01'] })) }, ids, STYLE).join('\n'), /lists 5 pictures: this style allows 4/);
});

test('a picture\'s prompt: the style\'s words, the subject, what the reference is for, the user\'s adjustments', () => {
  const [p] = picturePlan({ pictures: [{ id: 'whale', kind: 'object', what: 'a humpback whale.', pages: ['p01'] }] }, STYLE);
  const prompt = picturePrompt(STYLE, p, ['brighter colours'], 'look', 'mouth open');
  assert.match(prompt, /^Flat vector, two-tone fills, no outlines\.\nOne object alone[^\n]*transparent background/);
  assert.match(prompt, /Subject: a humpback whale\.\n/);
  assert.match(prompt, /reference image shows the look of this film/);
  assert.match(prompt, /Adjustments to the look: brighter colours\.\nFor this picture: mouth open\.\nNo text\.$/);
});

test('a picture\'s type and size are read from its first bytes', () => {
  assert.deepEqual(sniffPicture(png(1536, 1024, 1)), { type: 'png', w: 1536, h: 1024, alpha: true });
  assert.deepEqual(sniffPicture(png(800, 600, 1, false)), { type: 'png', w: 800, h: 600, alpha: false });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sniffPicture(jpg), { type: 'jpg', w: 800, h: 600, alpha: false });
  assert.equal(sniffPicture(new TextEncoder().encode('{"error":"nope"}')), undefined);
});

/** an image service that draws a PNG for each call and keeps what it was asked */
function service(calls: { prompt: string; refs: number; transparent: boolean }[], o: { fail?: RegExp; shapes?: string[] } = {}): ImageProvider {
  let n = 0;
  return {
    model: 'test-image',
    async draw({ prompt, refs, transparent, size }) {
      calls.push({ prompt, refs: refs?.length ?? 0, transparent });
      if (o.fail?.test(prompt)) throw new Error('image service 500: busy');
      // at the size asked, or the next of `shapes` (an image service that answers another shape)
      const [w, h] = (o.shapes?.shift() ?? size).split('x').map(Number);
      return png(w, h, ++n, transparent);
    },
  };
}

const PLAN = [
  { id: 'bird', kind: 'character', what: 'a small round bird with big eyes', shape: 'square', pages: ['p01', 'p02'] },
  { id: 'whale', kind: 'object', what: 'a humpback whale gliding left', pages: ['p02'] },
  { id: 'bird-fly', kind: 'character', what: 'the bird flying to the right', pages: ['p03'], like: 'bird' },
];

function film(o: { fail?: RegExp; shapes?: string[]; style?: PictureStyle; plan?: object[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pictures-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  const calls: { prompt: string; refs: number; transparent: boolean }[] = [], events: StudioEvent[] = [];
  const none: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'y' }, open: async () => { throw new Error('no model here'); } };
  const d = new Director({ dir, style: 'vector', brief: { durationSec: 60, lang: 'zh', replyLang: 'zh' }, runtime: none, images: service(calls, o), emit: (e) => events.push(e) });
  const sb: { title: string; summary: string; look: { pictures?: object[] }; pages: object[] } = { title: 'T', summary: 'S', look: { pictures: o.plan ?? PLAN }, pages: ids.map((id) => ({ id, section: 's', say: '…', beats: [] })) };
  Object.assign(d.project, { commit: async () => undefined, storyboard: () => sb, timeline: async () => ({ duration: 15, pages: [] }) });
  Object.assign(d, { pictureStyle: () => o.style ?? STYLE });
  return { d: d as unknown as Pick<Director, 'pictures' | 'redrawPicture'> & { state: { stage: string; exported?: boolean; pictures?: string } }, dir, calls, events, sb };
}
const pictureEvents = (events: StudioEvent[]) => events.filter((e): e is Extract<StudioEvent, { type: 'picture' }> => e.type === 'picture');

test('after the go-ahead the first picture is drawn from nothing, the rest from it, and a `like` from its own', async () => {
  const f = film();
  await f.d.pictures();
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].refs, 0);
  assert.ok(f.calls[0].transparent, 'a character is cut out');
  const whale = f.calls.find((c) => /humpback/.test(c.prompt))!, fly = f.calls.find((c) => /bird flying/.test(c.prompt))!;
  assert.equal(whale.refs, 1);
  assert.match(whale.prompt, /shows the look of this film/);
  assert.equal(fly.refs, 1);
  assert.match(fly.prompt, /shows this very subject: keep it exactly the same/);
  assert.equal(f.d.state.pictures, 'done');
  const items = readPictures(f.dir).items;
  assert.deepEqual(items.map((p) => p.id).sort(), ['bird', 'bird-fly', 'whale']);
  assert.match(items.find((p) => p.id === 'bird')!.file, /^bird-[0-9a-f]{10}\.png$/);
  assert.ok(pictureEvents(f.events).some((e) => e.id === 'bird' && e.status === 'done' && e.sample));
  // fixed for the pages: the agents' file tools refuse them
  assert.throws(() => writeIn(f.dir, `assets/gen/${items[0].file}`, 'x'), /every page of this film uses it/);
  // a resumed run draws nothing again
  f.d.state.pictures = undefined;
  await f.d.pictures();
  assert.equal(f.calls.length, 3);
});

test('a picture the image service draws at another shape than asked is drawn once more, and the second kept', async () => {
  const f = film({ plan: [PLAN[1]], shapes: ['1024x1536', '1024x1536'] });
  await f.d.pictures();
  assert.equal(f.calls.length, 2);
  assert.equal(readPictures(f.dir).items[0].h, 1536, 'the second answer is kept, whatever its shape');
  const g = film({ plan: [PLAN[1]], shapes: ['1024x1536'] });
  await g.d.pictures();
  assert.equal(g.calls.length, 2);
  assert.deepEqual([readPictures(g.dir).items[0].w, readPictures(g.dir).items[0].h], [1536, 1024]);
});

test('a sample that can\'t be had: the next picture drawn from nothing stands in for its look, and it is tried again at the end', async () => {
  const f = film({ fail: /small round bird/ });
  await f.d.pictures();
  const whale = f.calls.filter((c) => /humpback/.test(c.prompt)), fly = f.calls.find((c) => /bird flying/.test(c.prompt))!;
  assert.equal(whale.length, 1);
  assert.equal(whale[0].refs, 0, 'the stand-in is drawn from nothing');
  assert.equal(f.calls.findIndex((c) => /humpback/.test(c.prompt)), 3, 'drawn alone, after the sample\'s three tries');
  assert.equal(fly.refs, 1);
  assert.match(fly.prompt, /shows the look of this film/);
  const bird = f.calls.filter((c) => /small round bird/.test(c.prompt));
  assert.equal(bird.length, 6, 'three tries, then three more from the stand-in\'s look');
  assert.equal(bird[5].refs, 1);
  assert.deepEqual(readPictures(f.dir).items.map((p) => p.id).sort(), ['bird-fly', 'whale']);
  assert.equal(f.d.state.pictures, 'done');
});

test('no picture is drawn again while the storyboard waits: there is nothing drawn yet', async () => {
  const f = film();
  f.d.state.stage = 'approval';
  await f.d.redrawPicture('bird', 'brighter');
  assert.equal(f.calls.length, 0);
});

test('a picture that can\'t be had is left out, said, and never holds the film up', async () => {
  const f = film({ fail: /humpback/ });
  await f.d.pictures();
  assert.equal(f.calls.filter((c) => /humpback/.test(c.prompt)).length, 3, 'tried twice more');
  assert.deepEqual(readPictures(f.dir).items.map((p) => p.id).sort(), ['bird', 'bird-fly']);
  const failed = pictureEvents(f.events).find((e) => e.status === 'failed');
  assert.equal(failed?.id, 'whale');
  assert.match(failed?.detail ?? '', /busy/);
  assert.equal(f.d.state.pictures, 'done');
});

test('each page is told the pictures the storyboard puts on it, with the call that places them', async () => {
  const f = film();
  await f.d.pictures();
  const on = picturesOn(picturePlan(f.sb.look, STYLE), readPictures(f.dir).items, 'p02');
  assert.deepEqual(on.map((p) => p.id), ['bird', 'whale']);
  const note = picturePageNote(on);
  assert.match(note, /`assets\/gen\/whale-[0-9a-f]{10}\.png` \(picture whale\): object, 1536×1024, transparent background/);
  assert.match(note, /P\.img\('assets\/gen\/whale-[0-9a-f]{10}\.png', x, y, w, w \* 1024 \/ 1536, \{ fit: 'contain'/);
  assert.equal(picturePageNote(picturesOn(picturePlan(f.sb.look, STYLE), readPictures(f.dir).items, 'p09')), '');
});

test('a page\'s agent is shown its pictures with its brief, not only told about them, and is told not to draw them again', async () => {
  const f = film();
  await f.d.pictures();
  const seen = (id: string) => (f.d as unknown as { picturesSeen: (sb: object, id: string) => string[] | undefined }).picturesSeen(f.sb, id);
  assert.deepEqual(seen('p02')?.map((x) => x.replace(/-[0-9a-f]{10}\.png$/, '')), ['assets/gen/bird', 'assets/gen/whale']);
  assert.equal(seen('p09'), undefined);
  // a picture too large to attach is left to read
  const whale = seen('p02')!.find((x) => x.includes('whale'))!;
  fs.writeFileSync(path.join(f.dir, whale), Buffer.alloc(3_800_000));
  assert.equal(seen('p02')?.length, 1);
  const note = picturePageNote(picturesOn(picturePlan(f.sb.look, STYLE), readPictures(f.dir).items, 'p02'));
  assert.match(note, /attached to this message/);
  assert.match(note, /never drawn again in code/);
});

test('a finished film\'s picture drawn again: from the picture as it is, and its pages point at the new file', async () => {
  const f = film();
  await f.d.pictures();
  const old = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  fs.writeFileSync(path.join(f.dir, 'pages/p02.js'), `ENGINE.visual('p02', (P) => { P.img('assets/gen/${old.file}', 0, 0, 800, 533); });\n`);
  f.d.state.stage = 'done';
  await f.d.redrawPicture('whale', '嘴巴张开');
  const call = f.calls.at(-1)!;
  assert.equal(call.refs, 1);
  assert.match(call.prompt, /shows this very subject[\s\S]*For this picture: 嘴巴张开/);
  const now = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  assert.notEqual(now.file, old.file);
  assert.equal(now.note, '嘴巴张开');
  assert.match(fs.readFileSync(path.join(f.dir, 'pages/p02.js'), 'utf8'), new RegExp(`assets/gen/${now.file}`));
  assert.equal(f.d.state.exported, false);
  assert.ok(f.events.some((e) => e.type === 'ready'));
  // a revision keeps it: drawn with the user's note, it is not drawn over from the plain prompt
  f.d.state.pictures = undefined;
  const n = f.calls.length;
  await f.d.pictures();
  assert.equal(f.calls.length, n);
});

test('a picture of the person\'s own subject is drawn from their file; an SVG of theirs needs no picture', () => {
  const own = ['assets/brand/buzz-1a2b3c.png', 'assets/user/logo-0123456789.svg'];
  const look = { pictures: [
    { id: 'buzz', kind: 'character', what: 'Buzz the horsefly, smiling, waving', pages: ['p01'], from: 'assets/brand/buzz-1a2b3c.png' },
    { id: 'buzz-cheer', kind: 'character', what: 'Buzz cheering', pages: ['p02'], like: 'buzz', from: 'assets/brand/buzz-1a2b3c.png' },
    { id: 'logo', kind: 'object', what: 'the company logo', pages: ['p02'], from: 'assets/user/logo-0123456789.svg' },
    { id: 'cat', kind: 'character', what: 'a grey cat sitting', pages: ['p03'], from: 'assets/brand/nope.png' },
  ] };
  assert.deepEqual(picturePlan(look, STYLE, own).map((p) => [p.id, p.from, p.like]), [['buzz', 'assets/brand/buzz-1a2b3c.png', undefined], ['buzz-cheer', undefined, 'buzz'], ['logo', undefined, undefined], ['cat', undefined, undefined]]);
  const issues = pictureIssues(look, ids, STYLE, own).join('\n');
  assert.match(issues, /buzz-cheer has both `like` and `from`/);
  assert.match(issues, /logo is `from` assets\/user\/logo-0123456789\.svg, an SVG: place the person's SVG itself/);
  assert.match(issues, /cat is `from` "assets\/brand\/nope\.png", which is not one of the person's pictures/);
  assert.doesNotMatch(issues, /buzz is/);
  const [p] = picturePlan(look, STYLE, own);
  assert.match(picturePrompt(STYLE, p, [], 'own'), /the person's own picture of this subject/);
});

test('the sample drawn from the person\'s own file, and the rest from the sample', async () => {
  const f = film();
  const brand = 'assets/brand/buzz-1a2b3c.png';
  fs.mkdirSync(path.join(f.dir, 'assets/brand'), { recursive: true });
  fs.writeFileSync(path.join(f.dir, brand), png(400, 400, 99));
  f.sb.look = { pictures: [{ ...PLAN[0], from: brand }, ...PLAN.slice(1)] };
  Object.assign(f.d, { own: () => [brand] });
  await f.d.pictures();
  const bird = f.calls.find((c) => /round bird/.test(c.prompt))!;
  assert.equal(bird.refs, 1);
  assert.match(bird.prompt, /the person's own picture of this subject/);
  assert.match(f.calls.find((c) => /humpback/.test(c.prompt))!.prompt, /shows the look of this film/);
});

test('a change that adds pictures has them drawn before its pages', async () => {
  const f = film();
  f.sb.look = {};
  fs.writeFileSync(path.join(f.dir, 'script.js'), '');
  fs.writeFileSync(path.join(f.dir, 'storyboard.json'), '{}');
  const order: string[] = [];
  // each read is the storyboard as it is on disk now, as the real one is
  Object.assign((f.d as unknown as Director).project, { storyboard: () => structuredClone(f.sb) });
  Object.assign(f.d, {
    planRevision: async () => { f.sb.look = { pictures: PLAN }; order.push('plan'); return { plan: [{ id: 'p01', note: 'picture bird: the seller as a person' }] }; },
    pictures: async () => { order.push('pictures'); },
    pages: async () => { order.push('pages'); },
    review: async () => {},
    serverMeta: () => {},
  });
  await (f.d as unknown as Director).revise('make the people look like people');
  assert.deepEqual(order, ['plan', 'pictures', 'pages']);
  // a change that leaves the pictures as they are draws none
  order.length = 0;
  await (f.d as unknown as Director).revise('make the title bigger');
  assert.deepEqual(order, ['plan', 'pages']);
});

test('a designed style\'s pictures are drawn in the look the director designed for the film', () => {
  const free = pictureStyle('free')!;
  assert.equal(free.fromLook, true);
  assert.equal(free.prefix, '');
  assert.ok(free.kinds.includes('character'));
  const prefix = lookPrefix('A risograph zine in pink and teal.\n\n**Picture**: flat ink shapes, halftone shading.', { paper: '#F4EFE6', ink: '#1A1A1A', red: '#E4407B', redF: '#EFA0BB' });
  assert.match(prefix, /<style-card>\nA risograph zine in pink and teal\.[\s\S]*halftone shading\.\n<\/style-card>/);
  assert.match(prefix, /The film's colours: paper #F4EFE6, ink #1A1A1A, red #E4407B$/);
  // the director's: the card of the film's look, once it is designed
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-free-'));
  const none: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'y' }, open: async () => { throw new Error('no model here'); } };
  const d = new Director({ dir, style: 'free', brief: { durationSec: 60 }, runtime: none, images: service([]) });
  const style = () => (d as unknown as { pictureStyle(): { prefix: string } | undefined }).pictureStyle();
  Object.assign(d.project, { storyboard: () => ({ title: 'T', summary: 'S', pages: [] }) });
  assert.equal(style()!.prefix, '', 'nothing designed yet: the storyboard is being planned');
  Object.assign(d.project, { storyboard: () => ({ title: 'T', summary: 'S', pages: [], look: { card: 'A linocut print in two inks.', palette: { paper: '#EFE6D2', ink: '#222222' }, font: 'serif', line: 'pen' } }) });
  assert.match(style()!.prefix, /A linocut print in two inks\.[\s\S]*paper #EFE6D2, ink #222222/);
});

test('a change that names a picture to draw again has it drawn again, from itself, before its pages', async () => {
  const f = film();
  await f.d.pictures();
  const before = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  fs.writeFileSync(path.join(f.dir, 'pages/p02.js'), `P.img('assets/gen/${before.file}', 0, 0, 100, 100)`);
  fs.writeFileSync(path.join(f.dir, 'script.js'), '');
  fs.writeFileSync(path.join(f.dir, 'storyboard.json'), '{}');
  Object.assign((f.d as unknown as Director).project, { storyboard: () => structuredClone(f.sb) });
  const order: string[] = [];
  Object.assign(f.d, {
    planRevision: async () => {
      fs.mkdirSync(path.join(f.dir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(f.dir, '.studio/revision.json'), JSON.stringify({ pages: [{ id: 'p02', note: 'the whale sits on the page' }], pictures: [{ id: 'whale', note: 'no white border around it' }, { id: 'nope' }] }));
      order.push('plan'); return { plan: [{ id: 'p02', note: 'the whale sits on the page' }] };
    },
    pages: async () => { order.push('pages'); },
    review: async () => {},
    serverMeta: () => {},
  });
  const calls = f.calls.length;
  await (f.d as unknown as Director).revise('the whale looks stuck on with a white box');
  assert.deepEqual(order, ['plan', 'pages']);
  assert.equal(f.calls.length, calls + 1, 'the whale alone, drawn once');
  const again = f.calls.at(-1)!;
  assert.equal(again.refs, 1);
  assert.match(again.prompt, /For this picture: no white border around it\./);
  const after = readPictures(f.dir).items.find((p) => p.id === 'whale')!;
  assert.notEqual(after.file, before.file);
  assert.match(fs.readFileSync(path.join(f.dir, 'pages/p02.js'), 'utf8'), new RegExp(after.file));
});

test('a cut-out with a ground behind it, or a sticker\'s white rim, is told apart from a clean one', async () => {
  const { deflateSync } = await import('node:zlib');
  /** an RGBA PNG of w×h drawn by `at` */
  const encode = (w: number, h: number, at: (x: number, y: number) => [number, number, number, number]) => {
    const raw = Buffer.alloc(h * (w * 4 + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(at(x, y)).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
    const chunk = (type: string, data: Buffer) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  };
  const r = (x: number, y: number) => Math.hypot(x - 100, y - 100);
  const clean = encode(200, 200, (x, y) => (r(x, y) < 60 ? [200, 120, 40, 255] : [0, 0, 0, 0]));
  const rimmed = encode(200, 200, (x, y) => (r(x, y) < 50 ? [200, 120, 40, 255] : r(x, y) < 62 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const paper = encode(200, 200, (x, y) => (r(x, y) < 60 ? [200, 120, 40, 255] : [244, 238, 226, 255]));
  const snowman = encode(200, 200, (x, y) => (r(x, y) < 60 ? [250, 250, 250, 255] : [0, 0, 0, 0]));
  const { cutOutTrouble } = await import('./pictures.js');
  assert.equal(cutOutTrouble(clean), undefined);
  assert.match(cutOutTrouble(rimmed) ?? '', /white sticker outline/);
  assert.match(cutOutTrouble(paper) ?? '', /background or paper behind the subject/);
  assert.equal(cutOutTrouble(snowman), undefined, 'a white subject is not a rim');
});

const LED: PictureStyle = { kinds: ['scene', 'character'], max: 30, quality: 'medium', prefix: 'Flat vector office comedy', avoid: '', led: true, cast: true };

test('a style drawn in pictures: its designs at the storyboard, its scenes once the narration is written, line by line', () => {
  // the storyboard: the designs only
  const note = picturePlanNote(LED);
  assert.match(note, /drawn in pictures/);
  assert.match(note, /planned after the narration is written, line by line/);
  assert.match(note, /First come the film's designs \(`base`\), on no page/);
  assert.match(note, /one design for each look/);
  assert.match(note, /has no `kit`/);
  assert.doesNotMatch(note, /3–6 pictures usually/);
  // after the narration: its real lines, numbered, one scene for every line or two
  const lines = [{ page: 'p01', lines: ['Meet Sam.', 'Sam has forty-seven slides ready.'] }];
  const scenes = picturePlanNote(LED, [], lines);
  assert.match(scenes, /p01:\n  0\. Meet Sam\.\n  1\. Sam has forty-seven slides ready\./);
  assert.match(scenes, /One scene for every two or three lines above/);
  assert.match(scenes, /At most 30 in all/);
  assert.match(scenes, /Lettering inside a scene only for a short sign/);
  const words = picturePlanNote({ ...LED, words: true }, [], lines);
  assert.match(words, /Never the narration's sentences and never the scene's description/);
  assert.match(scenes, /`uses`: the ids of the designs the scene shows/);
  assert.match(picturePlanNote(LED, [], 'script'), /a page's lines are its cues in script\.js/);
  // a long film: its lines are shared out over the room its max leaves after the designs, evenly to the end
  const long = Array.from({ length: 20 }, (_, i) => ({ page: `p${String(i + 1).padStart(2, '0')}`, lines: Array.from({ length: 8 }, (_, j) => `Line ${j}.`) }));
  const spread = picturePlanNote({ ...LED, max: 40 }, [], long, 5);
  assert.match(spread, /its 160 lines leave room for 35 scenes \(40 pictures in all, the designs included\), so one scene for every 5 lines/);
  assert.match(spread, /never crowded at the start and thin at the end/);
  assert.match(spread, /Every page has at least one, on its line 0/);
  assert.doesNotMatch(spread, /One scene for every two or three lines/);
  assert.match(picturePlanNote({ ...LED, max: 40 }, [], long.slice(0, 4), 5), /One scene for every two or three lines above.*the designs included \(room for 35 scenes\)/);
  // a film from before designs, with one cast sheet, is still well formed
  const ok = { pictures: [{ id: 'cast', kind: 'scene', what: 'Sam, a salesman with curly hair; Priya, a CHRO', pages: [] }, { id: 'p01-a', kind: 'scene', what: 'Sam at his desk, wide shot', pages: ['p01'], cue: 0, focus: [0.4, 0.3] }] };
  assert.deepEqual(pictureIssues(ok, ['p01'], LED, [], { p01: 2 }), []);
  // at the storyboard a scene is not held to lines it doesn't have yet
  assert.deepEqual(pictureIssues({ pictures: [ok.pictures[0]] }, ids, LED), []);
  const loose = pictureIssues({ pictures: [ok.pictures[0], { id: 'p01-a', kind: 'scene', what: 'Sam at his desk, wide shot', pages: ['p01', 'p02'] }] }, ids, LED, [], { p01: 2, p02: 2, p03: 2 }).join('\n');
  assert.match(loose, /p01-a is on 2 pages/);
  assert.match(loose, /p01-a needs `cue`/);
  assert.match(loose, /p01-a needs `focus`/);
  assert.match(loose, /p03 has no scene/);
  assert.match(pictureIssues({ pictures: [ok.pictures[0], { ...ok.pictures[1], cue: 2 }] }, ['p01'], LED, [], { p01: 2 }).join('\n'), /p01-a is on line 2 of p01, which has 2 lines \(0–1\)/);
  assert.match(pictureIssues({ pictures: [ok.pictures[1]] }, ids, LED).join('\n'), /the first pictures are the film's designs/);
  assert.match(pictureIssues({ pictures: [{ ...ok.pictures[0], pages: ['p01'] }] }, ids, LED).join('\n'), /cast is a design, on no page/);
  const [sheet, scene] = picturePlan(ok, LED);
  assert.match(picturePrompt(LED, sheet, [], 'none'), /character model sheet: every character the subject names standing side by side/);
  assert.match(picturePrompt(LED, scene, [], 'cast'), /A full-frame illustration[\s\S]*reference image is this film's cast sheet/);
  // a style says what its scene is: its words replace the full-frame line
  const vignette = picturePrompt({ ...LED, scene: 'A vignette on bare paper.' }, scene, [], 'cast');
  assert.match(vignette, /A vignette on bare paper\./);
  assert.doesNotMatch(vignette, /full-frame/);
  assert.deepEqual([sheet.shape, scene.shape, pictureSize(scene)], ['film', 'film', '1536x864'], 'a scene drawn in is the frame\'s own 16:9');
});

test('in a style with a cast sheet every scene is drawn from the sheet', async () => {
  const f = film({ style: LED, plan: [
    { id: 'cast', kind: 'scene', what: 'Sam, a salesman with curly hair; Buzz, a horsefly', pages: [] },
    { id: 'p01-a', kind: 'scene', what: 'Sam at his desk, wide shot', pages: ['p01'] },
    { id: 'p02-a', kind: 'scene', what: 'Buzz lands on the deck of slides', pages: ['p02'] },
  ] });
  await f.d.pictures();
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].refs, 0);
  assert.match(f.calls[0].prompt, /character model sheet/);
  for (const c of f.calls.slice(1)) { assert.equal(c.refs, 1); assert.match(c.prompt, /this film's cast sheet/); }
});

test('a picture refused for too many at once is asked for again after the wait it is given, not failed', async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (++calls < 3
    ? new Response('{"error":"too many pictures at once for this film"}', { status: 429, headers: { 'retry-after': '0.01' } })
    : Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }))) as typeof fetch;
  try {
    const got = await openaiImages('k').draw({ prompt: 'a cat', size: '1536x1024', quality: 'medium', transparent: false });
    assert.equal(Buffer.from(got).toString(), 'png');
    assert.equal(calls, 3);
  } finally { globalThis.fetch = real; }
});

test('a page of a style drawn in pictures is written from its scenes\' cues and focus, with no model', () => {
  const scene = (id: string, cue: number, focus: [number, number]) => ({ id, kind: 'scene' as const, what: id, shape: 'film' as const, pages: ['p02'], cue, focus, file: `${id}-0123456789.png`, prompt: '', w: 1672, h: 941, alpha: false, at: '' });
  // lines at 0, 2.5, 6 and 9 s of a 12 s page; the second scene put on line 2, listed first. Each draws over the first
  // 45% of its time (2–3.5 s), then stands whole
  const js = ledPage('p02', [scene('p02-b', 2, [0.6, 0.2]), scene('p02-a', 0, [0.3, 0.4])], [0, 2.5, 6, 9], 12);
  assert.match(js, /^\/\/ drawn from the storyboard[^\n]*\nENGINE\.visual\('p02', \(P\) => \{/);
  const calls = js.split('\n').filter((l) => l.includes('P.scene'));
  assert.deepEqual(calls, [
    "  P.scene('assets/gen/p02-a-0123456789.png', { at: 0.05, dur: 2.7, focus: [0.3, 0.4] });",
    "  P.scene('assets/gen/p02-b-0123456789.png', { at: P.c(2), dur: 2.7, focus: [0.6, 0.2] });",
  ]);
  // a second scene on a line the first is still drawing on waits for it
  const close = ledPage('p02', [scene('p02-a', 0, [0.5, 0.5]), scene('p02-b', 1, [0.5, 0.5])], [0, 1, 4], 8).split('\n').filter((l) => l.includes('P.scene'));
  assert.match(close[0], /at: 0\.05, dur: 2\.0,/);
  assert.match(close[1], /at: P\.c\(1, 1\.3\d\), dur: 2\.5,/);
  // a page with no scene of its own holds the last one before it
  assert.match(ledPage('p03', [], [0, 3], 6, scene('p02-b', 2, [0.6, 0.2])), /P\.scene\('assets\/gen\/p02-b-0123456789\.png', \{ at: 0, dur: 0\.3/);
});

const DESIGNS = [
  { id: 'liu-bang', kind: 'scene', base: 'character', what: 'Liu Bang, a lord in his 50s, long black beard, a dark red robe', pages: [] },
  { id: 'xiang-yu', kind: 'scene', base: 'character', what: 'Xiang Yu, a general in his 20s, black armour, a crimson cloak', pages: [] },
  { id: 'tent', kind: 'scene', base: 'place', what: 'the great tent at Hongmen, red pillars, a low table, lamps', pages: [] },
];

test('a film with designs: each person, place and prop drawn on its own first, each scene from the ones it shows', () => {
  const note0 = () => picturePlanNote(LED);
  const plan = [...DESIGNS,
    { id: 'p01-a', kind: 'scene', what: 'Liu Bang bows before Xiang Yu in the tent', pages: ['p01'], cue: 0, focus: [0.4, 0.3], uses: ['liu-bang', 'xiang-yu', 'tent', 'nobody'] },
    { id: 'p02-a', kind: 'scene', what: 'an empty road at dawn', pages: ['p02'], cue: 0, focus: [0.5, 0.5] },
  ];
  assert.deepEqual(pictureIssues({ pictures: plan.map((p) => (p.id === 'p01-a' ? { ...p, uses: ['liu-bang', 'xiang-yu', 'tent'] } : p)) }, ['p01', 'p02'], LED, [], { p01: 2, p02: 2 }), []);
  const [hero, , tent, scene, road] = picturePlan({ pictures: plan }, LED);
  assert.equal(hero.base, 'character');
  assert.deepEqual(scene.uses, ['liu-bang', 'xiang-yu', 'tent'], 'only designs listed before it');
  assert.equal(road.uses, undefined);
  assert.match(picturePrompt(LED, hero, [], 'none'), /character design sheet of this one character alone[\s\S]*large head-and-shoulders close-up/);
  assert.match(picturePrompt(LED, tent, [], 'look'), /establishing view of this place alone, empty of people/);
  assert.match(picturePrompt(LED, tent, [], 'look'), /a design to draw scenes from, not a scene: nothing in it is lettered/);
  assert.match(note0(), /written in English whatever the film's language/);
  // a style whose words are in its pictures: a scene that quotes none has none
  assert.match(picturePrompt({ ...LED, words: true }, road, [], 'look'), /a subject that quotes none is a picture with no words at all/);
  assert.doesNotMatch(picturePrompt({ ...LED, words: true }, tent, [], 'look'), /a subject that quotes none/);
  assert.match(picturePrompt(LED, scene, [], 'uses', undefined, [hero, tent]), /reference images are this film's own designs, in this order: 1\. the design of Liu Bang[^;]*; 2\. the place the great tent/);
  // what goes wrong
  const issues = (list: object[]) => pictureIssues({ pictures: list }, ['p01', 'p02'], LED, [], { p01: 2, p02: 2 }).join('\n');
  assert.match(issues([plan[3], ...DESIGNS]), /the first pictures are the film's designs/);
  assert.match(issues([...DESIGNS, plan[4], { ...DESIGNS[0], id: 'fan-zeng' }]), /fan-zeng is a design listed after a scene/);
  assert.match(issues([...DESIGNS, plan[3], plan[4]]), /p01-a uses nobody, which is not a design listed before it \(liu-bang, xiang-yu, tent\)/);
  assert.match(issues([...DESIGNS, { ...DESIGNS[0], id: 'a1' }, { ...DESIGNS[0], id: 'a2' }, { ...plan[3], uses: ['liu-bang', 'xiang-yu', 'tent', 'a1', 'a2'] }, plan[4]]), /p01-a uses 5 designs: at most 4/);
  assert.match(issues([{ ...DESIGNS[0], base: 'hero' }]), /liu-bang has base "hero"/);
  assert.match(issues([...DESIGNS, { ...DESIGNS[2], id: 'cup', base: 'prop', pages: ['p01'] }]), /cup is a design, on no page/);
  assert.match(issues([...DESIGNS, ...Array.from({ length: 6 }, (_, i) => ({ ...DESIGNS[0], id: `d${i}` }))]), /more than 8 designs/);
});

test('the designs are drawn from the first one\'s look, each scene from the designs it uses, and a design drawn again draws its scenes again', async () => {
  const f = film({ style: LED, plan: [...DESIGNS,
    { id: 'p01-a', kind: 'scene', what: 'Liu Bang bows before Xiang Yu in the tent', pages: ['p01'], uses: ['liu-bang', 'xiang-yu', 'tent'] },
    { id: 'p02-a', kind: 'scene', what: 'Xiang Yu alone, drinking', pages: ['p02'], uses: ['xiang-yu'] },
    { id: 'p03-a', kind: 'scene', what: 'an empty road at dawn', pages: ['p03'] },
  ] });
  await f.d.pictures();
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls[0].refs, 0);
  assert.match(f.calls[0].prompt, /character design sheet/);
  const designs = f.calls.slice(1).filter((c) => /character design sheet|establishing view/.test(c.prompt));
  assert.equal(designs.length, 2);
  for (const c of designs) { assert.equal(c.refs, 1); assert.match(c.prompt, /shows the look of this film/); }
  const bow = f.calls.find((c) => /Subject: Liu Bang bows/.test(c.prompt))!, alone = f.calls.find((c) => /Subject: Xiang Yu alone/.test(c.prompt))!, road = f.calls.find((c) => /empty road/.test(c.prompt))!;
  assert.equal(bow.refs, 3);
  assert.match(bow.prompt, /1\. the design of Liu Bang[^;]*; 2\. the design of Xiang Yu[^;]*; 3\. the place the great tent/);
  assert.equal(alone.refs, 1);
  assert.equal(road.refs, 1);
  assert.match(road.prompt, /shows the look of this film/);
  // a resumed run draws nothing again
  f.d.state.pictures = undefined;
  await f.d.pictures();
  assert.equal(f.calls.length, 6);
  // the film is done; Xiang Yu's design is drawn again: so are the two scenes he is in, page 1 is pointed at its new
  // scene and the export is stale; the road is not drawn again
  const before = readPictures(f.dir).items;
  const old = before.find((p) => p.id === 'p01-a')!;
  fs.writeFileSync(path.join(f.dir, 'pages/p01.js'), `P.scene('assets/gen/${old.file}', { at: 0 });\n`);
  Object.assign(f.d.state, { stage: 'done', exported: true });
  await f.d.redrawPicture('xiang-yu', 'a scar on his left cheek');
  const again = f.calls.slice(6).map((c) => /Subject: ([^,.]*)/.exec(c.prompt)![1]).sort();
  assert.deepEqual(again, ['Liu Bang bows before Xiang Yu in the tent', 'Xiang Yu alone', 'Xiang Yu'].sort());
  const now = readPictures(f.dir).items;
  assert.equal(now.find((p) => p.id === 'p03-a')!.file, before.find((p) => p.id === 'p03-a')!.file);
  assert.equal(fs.readFileSync(path.join(f.dir, 'pages/p01.js'), 'utf8'), `P.scene('assets/gen/${now.find((p) => p.id === 'p01-a')!.file}', { at: 0 });\n`);
  assert.equal(f.d.state.exported, false);
});
