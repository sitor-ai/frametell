// The orchestrator's hands on a project: engine tools (lint, snap, timeline, render, film gate) and git history.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { ENGINE_DIR, linkProject } from '@frametell/engine/tools/project.mjs';
import { lintStoryboard, type StoryboardIssue } from '@frametell/engine/tools/storyboard-lint.mjs';
import type { FilmGateResult } from '@frametell/engine/tools/film-gate.mjs';
import type { ChildCmd, ProjectFiles } from '@frametell/voice';
import { ffmpegBin, ffmpegFailure } from '@frametell/engine/tools/bins.mjs';
import { confine } from './tools/sandbox.js';
import { gitAsync, gitSync, stageAll, stageAllSync } from './git.js';
import { openProjectFile, readIn, writeIn, type OpenFile } from './projectfs.js';

export interface Cue { i: number; at: number; abs: number; text: string }
export interface PageTiming { id: string; start: number; end: number; speechEnd: number; cues: Cue[] }
export interface Timeline { voiced: boolean; duration: number; pages: PageTiming[]; /** page id → a frame cut from the finished film */ posters?: Record<string, string> }
/** what a lint finding is about (engine/tools/checks.mjs) */
export type LintKind = 'runtime' | 'api' | 'empty-opening' | 'empty-ending' | 'sparse' | 'text-heavy' | 'nondeterministic' | 'raw-markup' | 'off-canvas' | 'subtitle-band' | 'small-text' | 'overlap' | 'palette';
/** `level`: 'error' is plainly wrong on screen or in the code, a page is not done while one is there; 'warn' is advice
 *  the pictures decide on. `msg` is for whoever reads it: code goes by `kind` and `level`. `data`: what the message
 *  quotes (percent, text, px…), for wording it in another language */
export interface LintIssue { page: string; t: number; t1: number; local: number; kind: LintKind; level: 'error' | 'warn'; msg: string; data?: Record<string, string | number> }
/** a page's check: its lint findings and a contact sheet (absolute path), or why the page could not be drawn */
export type PageCheck = { issues: LintIssue[]; sheet: string; crash?: undefined } | { issues: LintIssue[]; sheet?: undefined; crash: string };

export interface Beat { at: string; object: string; action: string; camera?: string; text?: string }
export interface StoryPage { id: string; section: string; say: string; core?: boolean; beats: Beat[] }
/** `look`: a designed style's film only, the look the director designed for it (look.ts designedLook) */
export interface Storyboard { title: string; summary: string; durationSec?: number; style: string; cast: string; lang?: 'zh' | 'en'; look?: unknown; pages: StoryPage[] }

/** what a child of the agent (its shell, the engine tools, git, ffmpeg) may see of this process's environment: what a
 *  shell, Node, Chrome and ffmpeg need, and nothing else. A list of what passes, not of what doesn't: an agent can print
 *  its environment, every word it reads goes to the model's provider, and on a hosted service the environment holds
 *  the service's own secrets under any name (a database URL carries its password). NODE_OPTIONS and NODE_PATH stay out:
 *  they make every Node the shell starts load other code. The user's proxy (core/src/net.ts applyProxy, any case) passes:
 *  on a network that only reaches out through it, the engine and the shell reach nothing without it. */
const PASSES = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z]+|TZ|TMPDIR|TEMP|TMP|TERM|CHROME_PATH|FFMPEG_PATH|PLAYWRIGHT_BROWSERS_PATH|NODE_EXTRA_CA_CERTS|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|NO_PROXY|RENDER_FRAME_TIMEOUT_MS|FRAMETELL_[A-Z_]+|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\))$/i;
const SECRET = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|URL/i;   // never, even under a name that passes (FRAMETELL_*)
export const childEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && PASSES.test(e[0]) && !SECRET.test(e[0])));

/** The environment for a child that runs process.execPath as Node: inside Electron the executable is the app, which runs
 * as plain Node only with ELECTRON_RUN_AS_NODE (it must not be set for the app's own helper processes, so only here).
 * `extra` is what the caller hands this one child on purpose. */
export const nodeEnv = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({ ...childEnv(), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...extra });

/** run a program to completion without blocking the process */
const run = (cmd: string, args: string[], cwd?: string) => new Promise<void>((ok, fail) => execFile(cmd, args, { cwd, timeout: 120_000, env: nodeEnv() }, (e, _o, err) => (e ? fail(new Error(String(err || e.message).slice(0, 1000))) : ok())));

/**
 * One frame cut by ffmpeg from a file of the project that was opened and checked (`from`), installed at `out` in the
 * project. ffmpeg reads the opened descriptor (handed to it as fd 3), never the name, which the agent's shell could
 * swap for a link to another account's film. ffmpeg runs confined (confinedCmd: no network when it is taken away) and
 * only opens local files; the picture comes back on a pipe (the sandbox's /tmp is its own) and is installed with writeIn
 * (never through a link planted at `out`).
 */
export async function cutFrame(dir: string, from: OpenFile, before: string[], after: string[], out: string, max = 16 << 20) {
  const input = process.platform === 'win32' ? from.path : '/dev/fd/3';   // Windows has no /dev/fd: the checked real path
  // one frame, whatever the input holds (a "snapshot" can be a film), and no more than `max` bytes of answer
  const bin = ffmpegBin();
  const [cmd, argv] = confinedCmd(dir, bin, ['-loglevel', 'error', ...before, '-protocol_whitelist', 'file,pipe', '-i', input, ...after, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
  const jpg = await new Promise<Buffer>((ok, fail) => {
    const child = spawn(cmd, argv, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', from.fd], env: nodeEnv(), timeout: 120_000 });
    const parts: Buffer[] = [];
    let err = '', size = 0, over = false;
    child.stdout!.on('data', (d: Buffer) => {
      if (over) return;
      if ((size += d.length) > max) { over = true; parts.length = 0; child.kill('SIGKILL'); return; }
      parts.push(d);
    });
    child.stderr!.on('data', (d: Buffer) => { if (err.length < 4000) err += d.toString(); });
    child.on('error', fail);
    child.on('close', (code, signal) => (over ? fail(new Error('ffmpeg: the frame came back as more than ' + max + ' bytes'))
      : code === 0 && parts.length ? ok(Buffer.concat(parts)) : fail(new Error(ffmpegFailure({ bin, code, signal, stderr: err }).slice(0, 1000)))));
  });
  writeIn(dir, out, jpg, { record: true });
}

/** how a host runs a child that reads what the agent made (an engine tool, ffmpeg, a document parser): inside the
 *  shell's sandbox when the network is taken away (the hosted sandbox), with no network and only `dir` writable */
export const confinedCmd = (dir: string, cmd: string, args: string[]): [string, string[]] =>
  process.env.FRAMETELL_SANDBOX_NONET === '1' ? confine(dir, cmd, args) : [cmd, args];
export const engineCmd = (dir: string, args: string[]): [string, string[]] => confinedCmd(dir, process.execPath, args);
/** confinedCmd for a package that cannot import this one (voice's narrate), with the environment a child gets */
export const childCmd: ChildCmd = (dir, cmd, argv) => { const [c, a] = confinedCmd(dir, cmd, argv); return { cmd: c, argv: a, env: nodeEnv() }; };

/** a project's files for narrate (@frametell/voice): written and read only through projectfs, never through a link */
export const projectFiles: ProjectFiles = { write: (d, r, x) => writeIn(d, r, x), read: (d, r) => readIn(d, r) };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const optStr = (x: unknown) => x === undefined || typeof x === 'string';
/** what film-gate.mjs printed, if it has the shape of its answer (FilmGateResult); else it throws. The gate decoded a
 *  film the agent's pages drew, in a child: its answer is checked before the director reads it */
export function gateResult(x: unknown): FilmGateResult {
  const ok = isObj(x) && typeof x.file === 'string' && num(x.duration) && typeof x.red === 'boolean'
    && Array.isArray(x.gates) && x.gates.every((g) => isObj(g) && typeof g.key === 'string' && typeof g.name === 'string' && (g.level === 'red' || g.level === 'green')
      && Array.isArray(g.value) && g.value.every((v) => isObj(v) && num(v.at) && num(v.seconds)))
    && Array.isArray(x.report) && x.report.every((r) => isObj(r) && typeof r.key === 'string' && typeof r.name === 'string' && num(r.value) && optStr(r.unit) && optStr(r.note) && optStr(r.level));
  if (!ok) throw new Error('film gate: its answer has the wrong shape');
  return x as unknown as FilmGateResult;
}
/** run an engine tool and collect its output. Never synchronously: lint and snapshots drive Chrome for seconds, and in the
 *  desktop app this process is also the one answering the panel (ten pages checking themselves froze every click).
 *  A stop kills it at once and rejects with an AbortError: Pause used to wait for every screenshot in flight to end on
 *  its own (seen: ten 3D pages' screenshots hung for five minutes, and the click on Pause seemed to do nothing) */
function tool(dir: string, name: string, args: string[], opts: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Promise<{ code: number; out: string; err: string }>((ok, fail) => {
    if (opts.signal?.aborted) return fail(new DOMException('aborted', 'AbortError'));
    const [cmd, argv] = engineCmd(dir, [path.join(ENGINE_DIR, 'tools', name), ...args]);
    execFile(cmd, argv, {
      cwd: dir, encoding: 'utf8', timeout: opts.timeoutMs ?? 240_000, maxBuffer: 64 << 20, env: nodeEnv(opts.env), signal: opts.signal,
    }, (e, stdout, stderr) => {
      if (opts.signal?.aborted) return fail(new DOMException('aborted', 'AbortError'));
      ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

/**
 * Draws a project's film somewhere other than this process (a hosted service sends it to a render container). It must
 * leave the two mp4s in <dir>/out as engine/tools/render.mjs names them, pass progress lines to onLine, and stop on
 * signal. It may answer the final plan's segment names, the backend that drew them and why not the GPU; they go on the done event.
 * Without one, render.mjs runs here.
 */
export type Renderer = (dir: string, o: { fps: number; workers: number; onLine?: (l: string) => void; signal?: AbortSignal }) => Promise<void | { segments: string[]; backend?: string; fallback?: string }>;

export class Project {
  /** `signal` stops the engine tools it runs (lint, screenshots, the time line) */
  constructor(readonly dir: string, private renderer?: Renderer, private signal?: AbortSignal) { linkProject(dir); }

  file(rel: string) { return path.join(this.dir, rel); }
  /** a file of the project, read through a checked descriptor (never another account's file behind a planted link) */
  read(rel: string) { return readIn(this.dir, rel, { record: true }).toString('utf8'); }
  /** writes a file of the project, never through a planted link */
  write(rel: string, data: string) { writeIn(this.dir, rel, data, { record: true }); }
  /** a film (an absolute path) opened and checked to be a file of this project's own, or undefined */
  private film(video: string): OpenFile | undefined { return openProjectFile(this.dir, video) ?? undefined; }
  exists(rel: string) { return fs.existsSync(this.file(rel)); }

  storyboard(): Storyboard { return JSON.parse(this.read('storyboard.json')); }
  materialsText(): string {
    const dir = this.file('materials');
    if (!fs.existsSync(dir)) return '';
    return fs.readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f)).flatMap((f) => { try { return [this.read(path.join('materials', f))]; } catch { return []; } }).join('\n\n');
  }
  storyboardIssues(): StoryboardIssue[] {
    try { return lintStoryboard(this.storyboard(), { source: this.materialsText() }); }
    catch (e) { return [{ level: 'red', msg: `storyboard.json cannot be read: ${(e as Error).message}` }]; }
  }

  /** Script check (engine/tools/script.mjs): page and cue counts, estimated length; errors point at the cue. */
  scriptCheck() { return tool(this.dir, 'script.mjs', [], { signal: this.signal }); }

  /**
   * One settled frame per page (0.4 s before it ends), cut from the finished film and kept in out/thumbs; for pages
   * whose run predates per-page thumbnails. Returns project-relative paths by page id.
   */
  /**
   * Full-resolution frames at `times` (project-relative jpgs). From the exported mp4 when it is current, else drawn by
   * the live film itself in one headless pass — a frame of the preview never waits for an export. Both are cached.
   */
  async stills(times: number[], video?: string): Promise<string[]> {
    const ts = times.map((t) => Math.max(0, Math.round(t * 10) / 10));
    // a film that is not a file of this project (a link to another account's, an absolute path elsewhere) is ignored
    const film = video ? this.film(video) : undefined;
    if (film) {
      try {
        const vt = film.mtimeMs;
        // one at a time: they share the one opened film (and its offset)
        const out: string[] = [];
        for (const t of ts) {
          const rel = `out/frames/${Math.round(t * 10)}.jpg`, abs = path.join(this.dir, rel);
          if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < vt) await cutFrame(this.dir, film, ['-ss', t.toFixed(2)], ['-q:v', '2'], rel);
          out.push(rel);
        }
        return out;
      } finally { fs.closeSync(film.fd); }
    }
    // the film as it is now: its script, voice and pages; any change gives new names, so old frames are never shown
    const files = ['script.js', 'voice.js', ...fs.readdirSync(this.file('pages')).map((f) => `pages/${f}`)];
    const stamp = createHash('sha1').update(files.map((f) => { try { return `${f}:${fs.statSync(this.file(f)).mtimeMs}`; } catch { return f; } }).join('|')).digest('hex').slice(0, 10);
    const rel = (t: number) => `out/frames/live-${stamp}-${Math.round(t * 10)}.jpg`;
    const todo = [...new Set(ts.filter((t) => !fs.existsSync(path.join(this.dir, rel(t)))))];
    if (todo.length) {
      const [cmd, argv] = engineCmd(this.dir, [path.join(ENGINE_DIR, 'tools', 'snap.mjs'), ...todo.map((t) => t.toFixed(1))]);
      await run(cmd, argv, this.dir);
      await Promise.all(todo.map(async (t) => {
        const png = this.file(`out/snap/snap-${t}.png`);
        const shot = openProjectFile(this.dir, png);
        if (!shot) throw new Error(`screenshot failed: out/snap/snap-${t}.png is not a file of the project`);
        try { await cutFrame(this.dir, shot, [], ['-q:v', '2'], rel(t)); } finally { fs.closeSync(shot.fd); }
        fs.rmSync(png, { force: true });
      }));
    }
    return ts.map(rel);
  }

  async posters(video: string, pages: PageTiming[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    // a film that is not a file of this project (a link to another account's) gives no posters
    const film = this.film(video);
    if (!film) return out;
    try {
      const vt = film.mtimeMs;
      for (const p of pages) {
        const rel = `out/thumbs/${p.id}.jpg`, abs = path.join(this.dir, rel);
        try {
          if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < vt) await cutFrame(this.dir, film, ['-ss', Math.max(p.start, p.end - 0.4).toFixed(2)], ['-vf', 'scale=640:-2', '-q:v', '4'], rel);
          out[p.id] = rel;
        } catch { /* a frame that will not cut leaves that page on its check sheet */ }
      }
    } finally { fs.closeSync(film.fd); }
    return out;
  }

  async timeline(): Promise<Timeline> {
    const r = await tool(this.dir, 'pages.mjs', ['--json'], { signal: this.signal });
    if (r.code) throw new Error(`timeline failed: ${r.err || r.out}`);
    return JSON.parse(r.out);
  }

  /** `timeoutMs`: a lint that takes longer is given up and reports nothing (a page's own check must not hold the film) */
  async lint(only?: string[], extra: string[] = [], timeoutMs?: number): Promise<LintIssue[]> {
    const r = await tool(this.dir, 'lint.mjs', ['--json', ...(only ? ['--only', only.join(',')] : []), ...extra], { signal: this.signal, timeoutMs });
    const last = r.out.split('\n').pop() || '[]';
    try { return JSON.parse(last); } catch { throw new Error(`lint failed: ${r.err || r.out}`.slice(0, 2000)); }
  }

  /**
   * A page's check in one browser (engine/tools/check.mjs): lint, with `determinism` the cold/warm frame comparison, and
   * a contact sheet `name` of the page at the absolute `times`. `lintMs`: a lint that takes longer is given up (no
   * findings, the sheet still taken), so a page's own check never holds the film.
   */
  async check(id: string, name: string, times: number[], o: { determinism?: boolean; lintMs?: number } = {}): Promise<PageCheck> {
    const r = await tool(this.dir, 'check.mjs', ['--only', id, '--sheet', name, ...(o.determinism ? ['--determinism'] : []), ...(o.lintMs ? ['--lint-ms', String(o.lintMs)] : []), ...times.map((t) => t.toFixed(2))], { signal: this.signal });
    let out: { issues?: LintIssue[]; sheet?: string; crash?: string };
    try { out = JSON.parse(r.out.split('\n').pop() || ''); } catch { return { issues: [], crash: `check failed: ${r.err || r.out}`.slice(0, 2000) }; }
    // what the page logged before it broke (pageerror lines) says where; the crash alone often does not
    if (out.crash || !out.sheet) return { issues: out.issues ?? [], crash: [out.crash ?? 'no contact sheet', r.err].filter(Boolean).join('\n').slice(0, 2000) };
    return { issues: out.issues ?? [], sheet: this.file(out.sheet) };
  }

  /** A contact sheet of the given absolute times → path of the jpg. */
  async snap(name: string, times: number[], only?: string[], tile = 480, label = true): Promise<string> {
    const r = await tool(this.dir, 'snap.mjs', [...(only ? ['--only', only.join(',')] : []), '--sheet', name, ...times.map((t) => t.toFixed(2))], { env: { SNAP_TILE: String(tile), SNAP_LABEL: label ? '1' : '0' }, signal: this.signal });
    const f = this.file(`out/snap/${name}.jpg`);
    if (r.code || !fs.existsSync(f)) throw new Error(`screenshot failed: ${r.err || r.out}`.slice(0, 2000));
    return f;
  }

  /** Render the film; progress lines are passed through. Resolves with the output files. */
  async render(o: { fps?: number; workers?: number; onLine?: (l: string) => void; signal?: AbortSignal } = {}): Promise<{ withSubs: string; noSubs: string; segments?: string[]; backend?: string; fallback?: string }> {
    if (this.renderer) {
      const r = await this.renderer(this.dir, { fps: o.fps ?? 30, workers: o.workers ?? 4, onLine: o.onLine, signal: o.signal });
      return { ...this.films(), ...(r && Array.isArray(r.segments) ? { segments: r.segments } : {}),
        ...(r && typeof r.backend === 'string' ? { backend: r.backend } : {}), ...(r && typeof r.fallback === 'string' ? { fallback: r.fallback } : {}) };
    }
    return new Promise((resolve, reject) => {
      const [cmd, argv] = engineCmd(this.dir, [path.join(ENGINE_DIR, 'tools/render.mjs'), '--fps', String(o.fps ?? 30), '--workers', String(o.workers ?? 4)]);
      const child = spawn(cmd, argv, { cwd: this.dir, signal: o.signal, env: nodeEnv() });
      let tail = '';
      const onData = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) { tail = (tail + '\n' + l).slice(-4000); o.onLine?.(l); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code) return reject(new Error(`render failed (exit ${code}): ${tail.slice(-1500)}`));
        try { resolve(this.films()); } catch (e) { reject(e); }
      });
    });
  }

  /** the two exported films in out/ */
  private films(): { withSubs: string; noSubs: string } {
    const out = fs.readdirSync(this.file('out')).filter((f) => f.endsWith('.mp4'));
    const withSubs = out.find((f) => /-(有字幕|with-subtitles)\.mp4$/.test(f)), noSubs = out.find((f) => /-(无字幕|no-subtitles)\.mp4$/.test(f));
    if (!withSubs || !noSubs) throw new Error('render finished but no film was found');
    return { withSubs: this.file('out/' + withSubs), noSubs: this.file('out/' + noSubs) };
  }

  /** the film gate over a finished mp4 (engine/tools/film-gate.mjs) in a confined child: it decodes the whole film
   * (seconds), which the agent's pages drew, and in this process it held every other request of the host while it did.
   * Its answer is checked (gateResult) before the director reads it */
  async gate(file: string): Promise<FilmGateResult> {
    const r = await tool(this.dir, 'film-gate.mjs', [file, '--json'], { signal: this.signal });
    let x: unknown;
    try { x = JSON.parse(r.out.split('\n').pop() || ''); } catch { throw new Error(`film gate failed: ${r.err || r.out}`.slice(0, 2000)); }
    return gateResult(x);
  }

  /** a film's length in seconds: ffmpeg's reading of its header (quick), in a confined child like every other ffmpeg
   *  over what the agent made, never in this process */
  async duration(file: string): Promise<number> {
    const bin = ffmpegBin();
    const [cmd, argv] = confinedCmd(this.dir, bin, ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file]);
    const ran = await new Promise<{ err: string; out: string; code?: number; signal?: string; spawn?: string }>((ok) => execFile(cmd, argv, { cwd: this.dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 20, env: nodeEnv(), signal: this.signal },
      (e, stdout, stderr) => ok({ err: String(stderr || ''), out: String(stdout || ''), code: typeof e?.code === 'number' ? e.code : undefined, signal: e?.signal, spawn: e && typeof e.code !== 'number' ? e.message : undefined })));
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(ran.err);
    if (!d) throw new Error(ffmpegFailure({ bin, code: ran.code, signal: ran.signal, stderr: ran.err, stdout: ran.out, spawnError: ran.spawn }).slice(0, 1000));
    return +d[1] * 3600 + +d[2] * 60 + +d[3];
  }

  // ── history: every change the agent makes is a commit, so any step can be undone (git revert) ──
  private git(args: string[]) { return gitSync(this.dir, args, childEnv()); }
  private gitAsync(args: string[]) { return gitAsync(this.dir, args, childEnv()); }
  /** an empty history: the repository and its author, nothing committed */
  initRepo() {
    if (fs.existsSync(this.file('.git'))) return;
    this.git(['init', '-q', '-b', 'main']);
    this.git(['config', 'user.name', 'Frametell']);
    this.git(['config', 'user.email', 'studio@frametell.local']);
  }
  initHistory() {
    this.initRepo();
    this.commitSync('Project created');
  }
  /** Commit everything that changed; returns the commit id, or null when nothing changed. The repository is made first
   *  when there is none, so a shell can never make .git itself first (with a config of its own) */
  async commit(message: string): Promise<string | null> {
    this.initRepo();
    await stageAll(this.dir, childEnv());
    const r = await this.gitAsync(['commit', '-q', '-m', message]);
    if (r.status !== 0) return null;
    return (await this.gitAsync(['rev-parse', '--short', 'HEAD'])).stdout.trim();
  }
  private commitSync(message: string) {
    stageAllSync(this.dir, childEnv());
    this.git(['commit', '-q', '-m', message]);
  }
}
