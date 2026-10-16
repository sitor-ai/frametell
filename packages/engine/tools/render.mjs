// Parallel render → out/<name>-no-subtitles.mp4, then burn subtitles → out/<name>-with-subtitles.mp4 (a Chinese film keeps Chinese file names). Run from a project dir:
// node engine/tools/render.mjs [--portrait] [--hw] [--fps 60] [--watermark]
//   split across machines: --plan prints the segments as JSON (PLAN {…}) and exits; --segments 0,3,7 draws only those, each
//   also with its subtitles (seg-….subs.mp4), into the segment cache and exits; a whole run then finds every segment
//   cached and only joins them, voices the film and joins the subtitled segments
//   --hw: hardware H.264 (the Mac's media engine, or NVENC on a machine with an NVIDIA card) for chunks and the subtitle
//   pass — frees the CPU for the browsers; slightly larger files. --jpeg-quality 85: frames out of Chrome at that JPEG
//   quality (92 by default; lower is quicker to capture) [--workers 12] [--from 0] [--to <end>] [--name <file name>] [--skip-video] [--skip-subs]
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadEpisode, OUT, PORTRAIT, EP } from './lib.mjs';
import { mixTrack } from './mix.mjs';
import { FFMPEG, HW_ENCODE, ffmpegFailure, probe } from './bins.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const { META, L, TIMING } = loadEpisode();
// a voiced episode must have audio for every cue (stale voice.js after editing cues → those cues would be silent)
if (META.voice) {
  const missing = L.pages.flatMap((p) => p.cues.filter((c) => !c.audio).map((c) => `${p.id}「${c.text}」`));
  if (missing.length) { console.error(`✗ these lines have no narration yet; voice them first:\n${missing.join('\n')}`); process.exit(1); }
}
// --portrait: 1080×1920 from pages-portrait/, files get a portrait tag; children inherit PORTRAIT=1
if (PORTRAIT) process.env.PORTRAIT = '1';
if (has('hw')) process.env.HW = '1';
const JPEG = +arg('jpeg-quality', 92);
process.env.JPEG_QUALITY = String(JPEG);
// --watermark: a small Frametell mark in a corner of every frame, drawn with the page (a free plan's films on a hosted
// service); children inherit WATERMARK=1, and marked segments are cached apart from unmarked ones
const WATERMARK = has('watermark');
if (WATERMARK) process.env.WATERMARK = '1';
const FPS = +arg('fps', 60), W = +arg('workers', 12), name = arg('name', META.name || 'video') + (PORTRAIT ? (META.lang === 'en' ? '-portrait' : '-竖版') : '');
const from = +arg('from', 0), to = +arg('to', L.duration);
const F0 = Math.round(from * FPS), F1 = Math.round(to * FPS);
const chunkDir = path.join(OUT, PORTRAIT ? 'chunks-portrait' : 'chunks');
fs.mkdirSync(chunkDir, { recursive: true });

// one render per episode at a time: two runs share out/chunks (the segment cache)
const lock = path.join(OUT, '.render.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (fs.existsSync(lock) && alive(+fs.readFileSync(lock, 'utf8'))) {
  console.error(`a render is already running (pid ${fs.readFileSync(lock, 'utf8')}); wait for it to finish.`);
  process.exit(1);
}
fs.writeFileSync(lock, String(process.pid));
const unlock = () => fs.rmSync(lock, { force: true });
process.on('exit', unlock);
// stopped (an export cancelled in the app is a SIGTERM): the browsers and encoders it started stop with it, instead of
// drawing on in the background and slowing every export after it
const kids = new Set();
process.on('exit', () => { for (const k of kids) k.kill('SIGTERM'); });
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const spawned = (cmd, args) => new Promise((res) => {
  const k = spawn(cmd, args, { stdio: 'inherit' });
  kids.add(k);
  k.on('close', (c) => { kids.delete(k); res(c); });
});
const run = (cmd, args) => new Promise((res, rej) => {
  const k = spawn(cmd, args, { stdio: ['inherit', 'inherit', 'pipe'] });
  let err = '';
  k.stderr?.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-1500); process.stderr.write(s); });
  kids.add(k);
  k.on('error', (e) => { kids.delete(k); rej(new Error(ffmpegFailure({ bin: cmd, spawnError: e.message, stderr: err }))); });
  k.on('close', (c, signal) => { kids.delete(k); if (c) rej(new Error(ffmpegFailure({ bin: cmd, code: c, signal, stderr: err }))); else res(); });
});
const [NO, WITH] = META.lang === 'en' ? ['no-subtitles', 'with-subtitles'] : ['无字幕', '有字幕'];
const nosub = path.join(OUT, `${name}-${NO}.mp4`), withsub = path.join(OUT, `${name}-${WITH}.mp4`);
const subsDir = path.join(OUT, PORTRAIT ? 'subs-portrait' : 'subs');
const subbed = (g) => g.out.replace(/\.mp4$/, '.subs.mp4');
/** a segment with the subtitles over it (re-encoded): its part of the subtitle track, trimmed to its frames */
const subtitle = (g) => run(FFMPEG, ['-y', '-loglevel', 'error', '-i', g.out, '-f', 'concat', '-safe', '0', '-i', path.join(subsDir, 'list.txt'),
  '-filter_complex', `[1:v]fps=${FPS},trim=start=${(g.a / FPS - from).toFixed(4)}:end=${(g.b / FPS - from).toFixed(4)},setpts=PTS-STARTPTS,format=rgba[s];[0:v][s]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]`,
  '-map', '[v]', ...(has('hw') ? HW_ENCODE : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16']), '-r', String(FPS), subbed(g) + '.part.mp4'])
  .then(() => fs.renameSync(subbed(g) + '.part.mp4', subbed(g)));
// The film's sound as one AAC track, cached in out/sound under everything it is made of (each cue's clip and where it
// starts, the sound effects, the mixing code): an export after a picture-only change, or one whose sound was made while
// its frames were drawn elsewhere (--audio-only), only muxes it in.
const voiced = L.pages.flatMap((p) => p.cues).filter((c) => c.audio);
const hasSfx = L.pages.some((p) => p.sfx && p.sfx.length);
async function soundtrack() {
  if (!voiced.length && !hasSfx) return null;
  const sha = (b) => createHash('sha1').update(b).digest('hex');
  const bytes = (f) => { try { return fs.readFileSync(f); } catch { return Buffer.alloc(0); } };
  const key = sha(JSON.stringify(['sound-1', from, to, hasSfx,
    voiced.map((c) => [c.audio, c.audioAt ?? c.start, sha(bytes(path.join(EP, c.audio)))]),
    hasSfx ? TIMING.sfxTimes(L).map((x) => [x, sha(bytes(path.join(EP, x.f)))]) : [],
    sha(bytes(path.join(dir, 'mix.mjs'))),
  ])).slice(0, 16);
  const soundDir = path.join(OUT, 'sound'), file = path.join(soundDir, `sound-${key}.m4a`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(soundDir, { recursive: true });
  const part = file.replace(/\.m4a$/, '.part.m4a');
  if (hasSfx) {
    // narration + sound effects / music beds (page.sfx) → stereo mix
    const raw = path.join(OUT, 'mix.f32');
    mixTrack(TIMING, L, from, to, raw, EP);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=14', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', part]);
  } else {
    // narration (voice.js): every cue's clip placed at its start → one loudness-normalized track
    const SR = 24000, pcm = new Int16Array(Math.ceil((to - from) * SR));
    for (const c of voiced) {
      const b = execFileSync(FFMPEG, ['-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', path.join(EP, c.audio), '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
      const clip = new Int16Array(b.buffer, b.byteOffset, b.length >> 1), at = Math.round(((c.audioAt ?? c.start) - from) * SR);
      for (let i = 0; i < clip.length; i++) { const j = at + i; if (j >= 0 && j < pcm.length) pcm[j] = Math.max(-32768, Math.min(32767, pcm[j] + clip[i])); }
    }
    const wav = path.join(OUT, 'voice.wav'), head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length * 2, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
    head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length * 2, 40);
    fs.writeFileSync(wav, Buffer.concat([head, Buffer.from(pcm.buffer)]));
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', part]);
  }
  // only the current track is kept
  for (const f of fs.readdirSync(soundDir)) if (f !== path.basename(part)) fs.rmSync(path.join(soundDir, f), { force: true });
  fs.renameSync(part, file);
  return file;
}
// --audio-only: make (or find) the film's sound and stop; a host does it while the frames are drawn elsewhere
if (has('audio-only')) {
  console.time('audio');
  await soundtrack();
  console.timeEnd('audio');
  process.exit(0);
}

let segs = [];

if (!has('skip-video')) {
  console.time('video');
  // Segments that follow the pages (none longer than SEG seconds), each cached under a key of everything that draws it:
  // the pages on screen in it (code and timing, with a margin for the cross-fades), the episode's settings, the engine.
  // An export after a one-page change renders only that page's segments; the rest are reused as they are.
  const SEG = 6, MARGIN = 1;
  // files of a folder (recursive only where asked: a style folder holds its example episode, which links back here)
  const files = (d, deep = true) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: deep }).map((f) => path.join(d, String(f))).filter((f) => fs.lstatSync(f).isFile()).sort() : []);
  const digest = (...parts) => createHash('sha1').update(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\0')).digest('hex').slice(0, 16);
  const read = (f) => { try { return fs.readFileSync(f); } catch { return ''; } };
  const kitDir = path.join(dir, '..');
  const shared = digest(
    ...[...files(path.join(kitDir, 'runtime')), ...files(path.join(kitDir, 'lib')), ...files(path.join(kitDir, 'styles', META.style || 'warm-story'), false)].map((f) => read(f).toString('base64')),
    ...files(path.join(EP, 'extras')).map((f) => read(f).toString('base64')), read(path.join(EP, 'index.html')).toString(),
    { ...META, publish: undefined, voice: undefined }, L.pages.map((p) => [p.id, p.section, p.title]), FPS, PORTRAIT, has('hw'), ...(WATERMARK ? ['watermark'] : []), ...(JPEG !== 92 ? [`jpeg-${JPEG}`] : []),
    // how frames are captured: bumped when that changes, so segments drawn the old way are drawn again (2: the window
    // at the stage's size, where it was short and the bottom rows came out black)
    'capture-2',
  );
  const pageKey = Object.fromEntries(L.pages.map((p) => [p.id, digest(p, read(path.join(EP, PORTRAIT ? 'pages-portrait' : 'pages', p.id + '.js')).toString())]));
  // each page: a short piece at either end (where a neighbour's cross-fade reaches), the middle in pieces of ≤ SEG s;
  // so a changed page costs its neighbours only those short end pieces
  const EDGE = MARGIN + 0.2;
  for (const p of L.pages) {
    const s0 = Math.max(from, p.start), s1 = Math.min(to, p.end);
    const cuts = s1 - s0 > 2 * EDGE + 1 ? [s0, s0 + EDGE, s1 - EDGE, s1] : [s0, s1];
    const bounds = [cuts[0]];
    for (let k = 1; k < cuts.length; k++) {
      const n = k === 2 ? Math.max(1, Math.ceil((cuts[2] - cuts[1]) / SEG)) : 1;
      for (let j = 1; j <= n; j++) bounds.push(cuts[k - 1] + ((cuts[k] - cuts[k - 1]) * j) / n);
    }
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = Math.round(bounds[k] * FPS), b = Math.round(bounds[k + 1] * FPS);
      if (a >= b) continue;
      const near = L.pages.filter((q) => q.start < b / FPS + MARGIN && q.end > a / FPS - MARGIN).map((q) => pageKey[q.id]);
      segs.push({ a, b, out: path.join(chunkDir, `seg-${digest(shared, a, b, near)}.mp4`) });
    }
  }
  if (has('plan')) {
    console.log('PLAN ' + JSON.stringify({ fps: FPS, segments: segs.map((g, i) => ({ i, a: g.a, b: g.b, file: path.basename(g.out), cached: fs.existsSync(g.out) })) }));
    process.exit(0);
  }
  const only = arg('segments') ? new Set(arg('segments').split(',').map(Number)) : null;
  const todo = segs.filter((g, i) => (!only || only.has(i)) && !fs.existsSync(g.out));
  const keep = new Set(segs.flatMap((g) => [path.basename(g.out), path.basename(subbed(g))]));
  for (const f of fs.readdirSync(chunkDir)) if (!keep.has(f)) fs.rmSync(path.join(chunkDir, f), { force: true });
  console.log(`segments: ${(only ? only.size : segs.length) - todo.length}/${only ? only.size : segs.length} reused`);
  // the segments to draw, spread over the workers by frame count; each worker draws its list in one browser
  const groups = Array.from({ length: Math.min(W, todo.length) }, () => ({ frames: 0, jobs: [] }));
  for (const g of [...todo].sort((x, y) => (y.b - y.a) - (x.b - x.a))) { const w = groups.reduce((m, x) => (x.frames < m.frames ? x : m)); w.jobs.push(g); w.frames += g.b - g.a; }
  await Promise.all(groups.map((w, i) => {
    const list = path.join(chunkDir, `.jobs-${i}.json`);
    fs.writeFileSync(list, JSON.stringify(w.jobs.map((j) => ({ ...j, out: j.out + '.part.mp4' }))));
    // a browser that stopped answering (render-chunk's exit 3) is closed and the share drawn again in a new one, once
    const draw = (tries) => spawned(process.execPath, [path.join(dir, 'render-chunk.mjs'), '--jobs', list, FPS]).then((c) => {
      if (c === 3 && tries > 1) { console.log(`a browser stopped answering; drawing its ${w.jobs.length} segment(s) again`); return draw(tries - 1); }
      if (c) throw new Error(c === 3 ? 'the browser stopped answering twice while drawing the film' : `render-chunk ${c}`);
    });
    return draw(2).then(() => {
      for (const j of w.jobs) fs.renameSync(j.out + '.part.mp4', j.out);   // only a finished segment enters the cache
      fs.rmSync(list, { force: true });
    });
  }));
  if (only) {
    // a share of a film split across machines: its segments, and each with its subtitles; the joining happens elsewhere
    if (!has('skip-subs')) {
      console.time('subs');
      await run(process.execPath, [path.join(dir, 'subs.mjs'), String(from), String(to)]);
      // two at a time: each is an x264 encode, next to the browsers that may still be drawing on a small machine
      const queue = segs.filter((g, i) => only.has(i) && !fs.existsSync(subbed(g)));
      await Promise.all([0, 1].map(async () => { for (let g; (g = queue.shift());) await subtitle(g); }));
      console.timeEnd('subs');
    }
    console.timeEnd('video');
    process.exit(0);
  }
  fs.writeFileSync(path.join(chunkDir, 'list.txt'), segs.map((g) => `file '${g.out}'`).join('\n'));
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(chunkDir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', nosub]);
  console.timeEnd('video');
}
if (fs.existsSync(nosub)) {
  console.time('audio');
  const sound = await soundtrack();
  if (sound) {
    // the track is made already (and loudness-normalized): only muxed in, the video copied as it is
    const tmp = nosub.replace(/\.mp4$/, '.tmp.mp4');
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', nosub, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, nosub);
  }
  console.timeEnd('audio');
}
if (!has('skip-subs') && segs.length && segs.every((g) => fs.existsSync(subbed(g)))) {
  // every segment was subtitled where it was drawn: join those, with the film's sound
  console.time('subs');
  const list = path.join(path.dirname(segs[0].out), 'list-subs.txt');
  fs.writeFileSync(list, segs.map((g) => `file '${subbed(g)}'`).join('\n'));
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', nosub, '-map', '0:v', '-map', '1:a?', '-c', 'copy', '-movflags', '+faststart', withsub]);
  console.timeEnd('subs');
} else if (!has('skip-subs')) {
  console.time('subs');
  await run(process.execPath, [path.join(dir, 'subs.mjs'), String(from), String(to)]);
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', nosub, '-f', 'concat', '-safe', '0', '-i', path.join(OUT, (PORTRAIT ? 'subs-portrait' : 'subs') + '/list.txt'),
    '-filter_complex', `[1:v]fps=${FPS},format=rgba[s];[0:v][s]overlay=0:0:format=auto:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-map', '0:a?', '-c:a', 'copy', ...(has('hw') ? HW_ENCODE : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16']), '-r', String(FPS), '-movflags', '+faststart', withsub]);
  console.timeEnd('subs');
}
const dur = async (f) => probe(f).duration;
for (const f of [nosub, withsub]) {
  if (!fs.existsSync(f)) continue;
  const d = await dur(f);
  const ok = Math.abs(d - (to - from)) < 1;
  console.log(`${ok ? '✓' : '✗ wrong length'} ${path.basename(f)}  ${d.toFixed(1)}s (expected ${(to - from).toFixed(1)}s)`);
  if (!ok) process.exitCode = 1;
}
