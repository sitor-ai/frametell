// Narration for a project: each page is synthesized as one utterance (the voice shapes intonation across the passage),
// then cut back into cues inside detected silences, so no sound is ever dropped. Writes audio/ and voice.js
// (SCRIPT.VOICE), including per-character onsets so pages can sync to words (P.cw). Pages are cached by text + voice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { ffmpegBin, ffmpegFailure } from '@frametell/engine/tools/bins.mjs';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import type { TtsProvider, WordTime } from './tts.js';

type Cue = string | { t: string; say?: string; hold?: number; solo?: { instruction?: string; pitch?: number; rate?: number } };
interface Page { id: string; cues: Cue[]; instruction?: string }
interface VoiceMeta { speaker: string; rate?: number; pitch?: number; instruction?: string; lexicon?: Record<string, string> }

export interface NarrateOptions {
  tts: TtsProvider;
  /** overrides META.voice */
  voice?: Partial<VoiceMeta>;
  onProgress?: (e: { page: string; index: number; total: number; cached: boolean }) => void;
  signal?: AbortSignal;
  /** how a child is started (Node reading script.js, ffmpeg): a host confines it to the project with no network
   *  (@frametell/agent's childCmd); directChild runs it as it is */
  child: ChildCmd;
  /** how a file of the project is written and read (@frametell/agent's projectFiles: never through a link the agent's
   *  shell planted, never outside the project) */
  files: ProjectFiles;
}
/** a project's files as the host writes and reads them: `rel` is relative to `dir` */
export interface ProjectFiles { write(dir: string, rel: string, data: string | Uint8Array): void; read(dir: string, rel: string): Buffer }
export interface NarrateResult { synthesized: number; duration: number; warnings: string[] }

const EDGE = 0.05, TAIL = 0.15, MAXPAUSE = 0.32, SIL_DB = -45;
const text = (c: Cue) => (typeof c === 'string' ? c : c.t);
const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '');
// a cue without its own closing mark gets a comma, so the voice pauses but does not end the sentence (English gets ',')
const withStop = (s: string) => (/[\p{P}]$/u.test(s.trim()) ? s.trim() : s.trim() + (/[A-Za-z0-9]$/.test(s.trim()) ? ',' : '，'));

/** how a child is started: the command and environment that run `cmd argv` for the project in `dir` */
export type ChildCmd = (dir: string, cmd: string, argv: string[]) => { cmd: string; argv: string[]; env: Record<string, string | undefined> };
/** a child run as it is (no sandbox asked for) */
export const directChild: ChildCmd = (_dir, cmd, argv) => ({ cmd, argv, env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } });

/** a child to its end; one that could not start, was stopped, ran too long or printed more than 64 MiB rejects */
function runChild(child: ChildCmd, dir: string, cmd: string, argv: string[], signal?: AbortSignal): Promise<{ code: number; out: Buffer; err: string; signal?: string }> {
  const c = child(dir, cmd, argv);
  return new Promise((ok, fail) => execFile(c.cmd, c.argv, { cwd: dir, env: c.env, encoding: 'buffer', maxBuffer: 64 << 20, timeout: 300_000, signal }, (e, out, err) => {
    if (e?.name === 'AbortError' || signal?.aborted) return fail(e?.name === 'AbortError' ? e : new DOMException('aborted', 'AbortError'));
    const stderr = Buffer.isBuffer(err) ? err.toString('utf8') : String(err || '');
    const stdout = Buffer.isBuffer(out) ? out : Buffer.from(out || '');
    const shown = c.cmd === cmd ? cmd : cmd + ' (via ' + c.cmd + ')';
    const failed = e as (Error & { code?: string | number; signal?: string }) | null;
    if (failed && typeof failed.code !== 'number') return fail(new Error(ffmpegFailure({ bin: shown, signal: failed.signal, stderr, stdout: stdout.toString('utf8'), spawnError: failed.message || String(failed.code || '') })));
    ok({ code: failed && typeof failed.code === 'number' ? failed.code : 0, out: stdout, err: stderr, signal: failed?.signal });
  }));
}

/** ffmpeg on a file of the project, local files only: a "sound" that is really a playlist of web addresses fetches
 *  nothing. `pre` goes before the input, `post` after it; resolves with what it printed */
async function ffmpeg(child: ChildCmd, dir: string, pre: string[], input: string, post: string[], signal?: AbortSignal): Promise<string> {
  const bin = ffmpegBin();
  const r = await runChild(child, dir, bin, ['-hide_banner', ...pre, '-protocol_whitelist', 'file,pipe', '-i', input, ...post], signal);
  if (r.code) throw new Error(ffmpegFailure({ bin, code: r.code, signal: r.signal, stderr: r.err, stdout: r.out.toString("utf8") }));
  return r.err;
}

const RATE = 24000;
/** `input` decoded by ffmpeg (`post` filters it) to the narration's format, 24 kHz mono 16-bit, as a whole WAV file.
 *  ffmpeg hands the samples back on a pipe and the host writes the file (ProjectFiles), so no name in the project is
 *  ever opened for writing by ffmpeg: a link planted there would take its output anywhere */
async function toWav(child: ChildCmd, dir: string, input: string, post: string[], signal?: AbortSignal): Promise<Buffer> {
  const bin = ffmpegBin();
  const r = await runChild(child, dir, bin, ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', input, ...post, '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], signal);
  if (r.code) throw new Error(ffmpegFailure({ bin, code: r.code, signal: r.signal, stderr: r.err, stdout: r.out.toString("utf8") }));
  const pcm = r.out.subarray(0, r.out.length & ~1), head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** a media file's length in seconds, from what `ffmpeg -i` prints (it exits 1 there: no output is named) */
export async function mediaDuration(dir: string, file: string, child: ChildCmd, signal?: AbortSignal): Promise<number> {
  const bin = ffmpegBin();
  const r = await runChild(child, dir, bin, ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], signal);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.err);
  if (!d) throw new Error(ffmpegFailure({ bin, code: r.code, signal: r.signal, stderr: r.err, stdout: r.out.toString('utf8') }));
  return +d[1] * 3600 + +d[2] * 60 + +d[3];
}

export interface ScriptData { meta: Record<string, any>; pages: Page[]; duration: number | null }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const optStr = (x: unknown) => x === undefined || typeof x === 'string';
const optNum = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x));
/** a page id: it names files in audio/, so it must not name a path */
const PAGE_ID = /^[\w-]{1,80}$/;
const isCue = (c: unknown): c is Cue => typeof c === 'string' || (isObj(c) && typeof c.t === 'string' && optStr(c.say) && optNum(c.hold)
  && (c.solo === undefined || (isObj(c.solo) && optStr(c.solo.instruction) && optNum(c.solo.pitch) && optNum(c.solo.rate))));
const isPage = (p: unknown): p is Page => isObj(p) && typeof p.id === 'string' && PAGE_ID.test(p.id) && Array.isArray(p.cues) && p.cues.every(isCue) && optStr(p.instruction);
/** what script-data.mjs printed, if it has the shape of its answer: it ran the agent's code, so anything else is refused */
function scriptShape(x: unknown): ScriptData | undefined {
  if (!isObj(x) || !isObj(x.meta) || !Array.isArray(x.pages) || !x.pages.every(isPage)) return undefined;
  if (!(x.duration === null || (typeof x.duration === 'number' && Number.isFinite(x.duration)))) return undefined;
  return { meta: x.meta, pages: x.pages, duration: x.duration };
}
/** script.js (with `voice`: voice.js too, and the film's length) as data. The engine evaluates them in a child
 *  (script-data.mjs), never this process: they are code the agent wrote */
export async function scriptData(dir: string, child: ChildCmd, o: { voice?: boolean; signal?: AbortSignal } = {}): Promise<ScriptData> {
  const r = await runChild(child, dir, process.execPath, [path.join(ENGINE_DIR, 'tools', 'script-data.mjs'), ...(o.voice ? ['--voice'] : [])], o.signal);
  const out = r.out.toString('utf8');
  let data: ScriptData | undefined;
  try { data = scriptShape(JSON.parse(out.trim().split('\n').pop() || '')); } catch { /* said below */ }
  if (r.code || !data) throw new Error(`script.js cannot be read: ${(r.err || out).trim().slice(-1000)}`);
  return data;
}

/** Speech span of every cue, from the per-character timestamps. */
function spans(spoken: string[], words: WordTime[], warn: (m: string) => void) {
  const ends: number[] = [];
  let acc = 0;
  for (const s of spoken) ends.push((acc += norm(s).length));
  const sp: ({ s: number; e: number } | null)[] = spoken.map(() => null);
  let pos = 0;
  for (const w of words) {
    const n = norm(w.word).length;
    if (!n) continue;
    const i = ends.findIndex((e) => pos < e);
    const k = i < 0 ? spoken.length - 1 : i;
    sp[k] = sp[k] ? { s: sp[k]!.s, e: w.endTime } : { s: w.startTime, e: w.endTime };
    pos += n;
  }
  if (pos !== acc) warn(`timestamps cover ${pos} characters but the text has ${acc} (numbers or English were read differently); timing falls back to proportions`);
  return sp.map((x, i) => x || sp[i - 1] || { s: 0, e: 0.3 });
}

/** Cut points: always inside a detected silence; long silences keep MAXPAUSE on each side. */
async function cut(child: ChildCmd, dir: string, wav: string, sp: { s: number; e: number }[], signal?: AbortSignal) {
  const log = await ffmpeg(child, dir, [], wav, ['-af', `silencedetect=noise=${SIL_DB}dB:d=0.06`, '-f', 'null', '-'], signal);
  const sil: [number, number][] = [];
  let st: number | null = null;
  for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') st = +m[2]; else if (st != null) { sil.push([st, +m[2]]); st = null; }
  }
  const D = await mediaDuration(dir, wav, child, signal);
  if (st != null) sil.push([st, D]);
  const n = sp.length;
  const segs = sp.map(() => ({ a: 0, b: D, o: 0, fin: false, fout: false, join: false }));
  const head = sil.find(([a]) => a < 0.02), tail = sil.find(([, b]) => b > D - 0.02);
  segs[0].a = head ? Math.max(0, head[1] - EDGE) : 0;
  segs[0].fin = !!head;
  segs[n - 1].b = tail && tail[0] > segs[0].a ? Math.min(D, tail[0] + TAIL) : D;
  segs[n - 1].fout = true;
  const removed: [number, number][] = [];
  // the few ms before a leading silence (or after a trailing one) count as part of it, as when head/tail were found
  if (head && segs[0].a > head[0]) removed.push([head[0], segs[0].a]);
  if (segs[n - 1].b < D) removed.push([segs[n - 1].b, tail ? Math.max(segs[n - 1].b, tail[1]) : D]);
  for (let i = 0; i < n - 1; i++) {
    const lo = sp[i].e - 0.15, hi = sp[i + 1].s + 0.15;
    const cand = sil.filter(([a, b]) => b > lo && a < hi && a > 0.02 && b < D - 0.02).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
    if (cand) {
      const keep = Math.min(MAXPAUSE, (cand[1] - cand[0]) / 2);
      segs[i].b = cand[0] + keep; segs[i + 1].a = cand[1] - keep;
      segs[i].fout = true; segs[i + 1].fin = true;
      if (segs[i + 1].a > segs[i].b) removed.push([segs[i].b, segs[i + 1].a]);
    } else {
      const m = (sp[i].e + sp[i + 1].s) / 2;   // spoken straight through: the halves are placed back to back
      segs[i].b = m; segs[i + 1].a = m; segs[i].join = true;
    }
  }
  segs.forEach((g, i) => { g.o = Math.max(0, Math.min(sp[i].s - g.a, g.b - g.a - 0.1)); });
  // durations read from ffmpeg are rounded to 1/100 s, so a silence that runs to the end can look 5 ms short of it
  const inSil = ([a, b]: [number, number]) => sil.some(([x, y]) => a >= x - 0.01 && b <= y + 0.01);
  const bad = removed.filter((x) => !inSil(x));
  return { segs, bad };
}

/**
 * Per-character onsets for a cue, seconds from the start of its audio segment: one entry per character of the cue
 * text (Array.from order). Punctuation and characters the voice skipped take the previous onset.
 */
function charOnsets(cueText: string, spokenText: string, words: WordTime[], wordFrom: number, segStart: number): number[] | undefined {
  if (cueText !== spokenText) return undefined;   // a respelled cue (say / lexicon): positions no longer line up
  const chars = Array.from(cueText);
  const out: number[] = [];
  let wi = wordFrom, inWord = 0, last = 0;
  for (const ch of chars) {
    if (!norm(ch)) { out.push(last); continue; }
    while (wi < words.length && !norm(words[wi].word)) wi++;
    const w = words[wi];
    if (!w) { out.push(last); continue; }
    last = +Math.max(0, w.startTime - segStart).toFixed(3);
    out.push(last);
    if (++inWord >= norm(w.word).length) { wi++; inWord = 0; }
  }
  return out;
}

export async function narrate(dir: string, opts: NarrateOptions): Promise<NarrateResult> {
  const S = await scriptData(dir, opts.child, { signal: opts.signal });
  const SCRIPT = { META: S.meta, PAGES: S.pages };
  const V: VoiceMeta = { ...(SCRIPT.META.voice || {}), ...(opts.voice || {}) } as VoiceMeta;
  if (!V.speaker) throw new Error('no voice set (META.voice.speaker)');
  const warnings: string[] = [];
  const en = SCRIPT.META.lang === 'en';
  const LEXICON: Record<string, string> = { ...(en ? { 'CLAUDE.md': 'claude dot md', 'AGENTS.md': 'agents dot md', 'README.md': 'readme dot md' } : { 'CLAUDE.md': 'claude 点 md', 'AGENTS.md': 'agents 点 md', 'README.md': 'readme 点 md' }), ...(V.lexicon || {}) };
  const respell = (s: string) => Object.entries(LEXICON).reduce((a, [k, v]) => a.split(k).join(v), s);
  const spokenOf = (c: Cue) => respell((typeof c === 'object' && c.say) || text(c));
  const pages: Record<string, unknown>[][] = [];
  let made = 0;
  for (const [pi, pg] of SCRIPT.PAGES.entries()) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    // a page is one utterance, except cues with { solo } which get their own take (their tone shouldn't leak)
    const runs: { solo: NonNullable<Exclude<Cue, string>['solo']> | null; cues: Cue[]; idx: number[] }[] = [];
    pg.cues.forEach((c, ci) => {
      const solo = typeof c === 'object' && c.solo ? c.solo : null;
      if (solo || !runs.length || runs.at(-1)!.solo) runs.push({ solo, cues: [], idx: [] });
      runs.at(-1)!.cues.push(c); runs.at(-1)!.idx.push(ci);
      if (solo) runs.push({ solo: null, cues: [], idx: [] });
    });
    const out: Record<string, unknown>[] = [];
    let cachedPage = true;
    for (const [ri, run] of runs.filter((r) => r.cues.length).entries()) {
      const spoken = run.cues.map(spokenOf);
      // English sentences need a space between them; Chinese ones are joined as they are (the same text as before, so
      // the same cached audio)
      const utter = spoken.map(withStop).reduce((a, x) => a + (a && /[,.;:!?]$/.test(a) && /^[A-Za-z0-9"'“‘(]/.test(x) ? ' ' : '') + x, '');
      const instruction = run.solo?.instruction ?? pg.instruction ?? V.instruction;
      const extra = { pitch: run.solo?.pitch ?? V.pitch, rate: run.solo?.rate ?? V.rate ?? 0 };
      const whole = !run.solo && run.cues.length === pg.cues.length;
      const id = crypto.createHash('md5').update(JSON.stringify([opts.tts.id, utter, V.speaker, extra, instruction ?? ''])).digest('hex').slice(0, 12);
      // relative to the project; the page id was checked (scriptData) to name no path
      const base = `audio/${whole ? `${pg.id}-${id}` : `${pg.id}-${ri}-${id}`}`;
      const mp3 = base + '.mp3', wj = base + '.json', wav = base + '.wav';
      const has = (rel: string) => fs.existsSync(path.join(dir, rel));
      if (!has(wj)) {
        const { audio, words } = await opts.tts.synth(utter, { voice: V.speaker, rate: extra.rate, pitch: extra.pitch, instruction, signal: opts.signal });
        opts.files.write(dir, mp3, audio);
        opts.files.write(dir, wj, JSON.stringify(words));
        made++; cachedPage = false;
      }
      if (!has(wav)) opts.files.write(dir, wav, await toWav(opts.child, dir, mp3, [], opts.signal));
      const words = JSON.parse(opts.files.read(dir, wj).toString('utf8')) as WordTime[];
      const sp = spans(spoken, words, (m) => warnings.push(`${pg.id}：${m}`));
      const { segs, bad } = await cut(opts.child, dir, wav, sp, opts.signal);
      if (bad.length) throw new Error(`${pg.id}: cutting the take into lines would drop audible sound at ${bad.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}s`).join(' ')}`);
      // which word starts each cue (for per-character onsets)
      const firstWord: number[] = [];
      { let acc = 0, wi = 0, pos = 0; for (const s of spoken) { while (wi < words.length && pos < acc) { pos += norm(words[wi].word).length; wi++; } firstWord.push(wi); acc += norm(s).length; } }
      for (const [k, c] of run.cues.entries()) {
        const g = segs[k], f = `${base}-${k}.wav`;
        const af = `atrim=start=${g.a.toFixed(3)}:end=${g.b.toFixed(3)},asetpts=N/SR/TB` + (g.fin ? ',afade=t=in:d=0.01' : '') + (g.fout ? ',areverse,afade=t=in:d=0.02,areverse' : '');
        opts.files.write(dir, f, await toWav(opts.child, dir, wav, ['-af', af], opts.signal));
        const v: Record<string, unknown> = { t: text(c), f, d: +(g.b - g.a).toFixed(3), o: +g.o.toFixed(3) };
        const kk = charOnsets(text(c), spoken[k], words, firstWord[k], g.a);
        if (kk) v.k = kk;
        if (g.join) v.join = 1;
        out[run.idx[k]] = v;
      }
    }
    pages.push(out);
    opts.onProgress?.({ page: pg.id, index: pi, total: SCRIPT.PAGES.length, cached: cachedPage });
  }
  opts.files.write(dir, 'voice.js', `/* Generated by Frametell — real narration timing. Do not edit; narrate again after changing cues. */\nSCRIPT.VOICE = ${JSON.stringify({ speaker: V.speaker, provider: opts.tts.id, pages })};\n`);
  const { duration } = await scriptData(dir, opts.child, { voice: true, signal: opts.signal });
  return { synthesized: made, duration: duration ?? 0, warnings };
}
