// Projects and their runs. A project is a directory (a git repo) under the data dir; its run is one Director. Every
// event is appended to .studio/events.jsonl with a sequence number, so the panel can reconnect and replay from where
// it left off, and a page reload shows the whole conversation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createProject, linkProject } from '@frametell/engine/tools/project.mjs';
import { createCatalog } from '@frametell/models';
import { edgeTts, elevenLabsTts, volcengineTts } from '@frametell/voice';
import { createWeb, Director, findSources, hasSources, offlineWeb, openProjectFile, piRuntime, Project, readFd, writeIn, type AgentRuntime, type DirectorOptions, type Renderer, type StudioEvent, type Storyboard, type UserRef } from '@frametell/agent';
import type { Config, ConfigStore } from './config.js';
import { prepareMaterials } from './materials.js';
import { applyProxy } from './net.js';
import { withRefs } from './refs.js';
import type { LoggedEvent, ProjectMeta, ProjectSummary, RunStatus } from './types.js';
import { resolveLocale, tr } from './i18n.js';

/** a picture the user gave as the film's cover, as the project keeps it (the engine's render.mjs reads the same names) */
export const COVER_IMAGE = /^cover-[0-9a-f]{12}\.(jpg|png|webp)$/;
const COVER_IMAGE_BYTES = 10 << 20;
/** jpg, png or webp by the file's first bytes (never by its name or what the browser said it was) */
function imageType(b: Uint8Array): 'jpg' | 'png' | 'webp' | undefined {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'webp';
  return undefined;
}

/** the language someone wrote in, if it can be told: Chinese as soon as there is a Chinese character, English from a
 * word of Latin letters; undefined for a link, numbers or nothing */
const langOf = (text: string): 'zh' | 'en' | undefined => (/[\u3400-\u9fff]/.test(text) ? 'zh' : /[a-z]{3}/i.test(text.replace(/https?:\/\/\S+/g, '')) ? 'en' : undefined);

export type Logged = LoggedEvent;

const studioFile = (dir: string, name: string) => path.join(dir, '.studio', name);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** the pid of another live process running this project (the CLI server and the desktop app can share a data dir) */
function heldElsewhere(dir: string): number | undefined {
  try { const pid = +fs.readFileSync(studioFile(dir, 'run.lock'), 'utf8'); return pid && pid !== process.pid && alive(pid) ? pid : undefined; } catch { return undefined; }
}
const readMetaAt = (dir: string): ProjectMeta => JSON.parse(fs.readFileSync(studioFile(dir, 'project.json'), 'utf8'));
function writeMeta(dir: string, m: ProjectMeta) { m.updatedAt = new Date().toISOString(); fs.writeFileSync(studioFile(dir, 'project.json'), JSON.stringify(m, null, 2)); }

/** The projects under one directory and the settings their runs use: one per Studio, so several can share a process. */
export class Projects {
  private runners = new Map<string, Runner>();
  /** `reach`: what the research may read beyond the project (see ResearchReach) */
  constructor(readonly root: string, readonly config: ConfigStore, private renderer?: Renderer, private review?: 'full' | 'defects', private onEvent?: (project: string, e: Logged) => void, private reach: ResearchReach = FULL_REACH) {}

  dir(id: string) { return path.join(this.root, id); }

  list(): ProjectSummary[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root)
      .filter((id) => fs.existsSync(studioFile(this.dir(id), 'project.json')))
      .map((id) => ({ ...this.read(id), ...this.runner(id).summary() }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  read(id: string): ProjectMeta { return readMetaAt(this.dir(id)); }

  create(input: Omit<ProjectMeta, 'id' | 'createdAt' | 'updatedAt' | 'materials'>, files: { name: string; data: Buffer }[]): ProjectMeta {
    const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(6).toString('hex')}`;
    const dir = this.dir(id);
    createProject(dir, { title: input.title, style: input.style, lang: input.lang });
    fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.studio'), { recursive: true });
    const materials: string[] = [];
    for (const f of files) {
      const name = path.basename(f.name).replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(path.join(dir, 'materials', name), f.data);
      materials.push(name);
    }
    const now = new Date().toISOString();
    const meta: ProjectMeta = { ...input, id, createdAt: now, updatedAt: now, materials };
    fs.writeFileSync(studioFile(dir, 'project.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  /** file a project under a group (empty: under none). Its updatedAt stays: filing a film is not working on it */
  setGroup(id: string, group: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error(tr('项目不存在', 'Project not found'));
    const dir = this.dir(id), m = this.read(id), g = group.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (g) m.group = g; else delete m.group;
    fs.writeFileSync(studioFile(dir, 'project.json'), JSON.stringify(m, null, 2));
  }

  /** delete a project and everything in it; refused while it is being made, here or in another process */
  remove(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error(tr('项目不存在', 'Project not found'));
    const dir = this.dir(id), r = this.runner(id);
    if (r.status === 'running' || heldElsewhere(dir)) throw new Error(tr('这条视频正在制作，先停下再删', 'This video is being made. Stop it before deleting.'));
    this.runners.delete(id);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  runner(id: string): Runner {
    if (!fs.existsSync(studioFile(this.dir(id), 'project.json'))) throw new Error(tr('项目不存在', 'Project not found'));
    let r = this.runners.get(id);
    if (!r) { r = new Runner(id, this.dir(id), this.config, this.renderer, this.review, this.onEvent, this.reach); this.runners.set(id, r); }
    return r;
  }
}

type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number; currency: 'CNY' | 'USD' };

/** a message that only says to go on */
const GO_ON = /^(继续|接着|继续制作|接着做|继续做|继续吧|go on|continue|resume|keep going)[\s.!。！~～]*$/i;

/**
 * What the research may read beyond the project. A host decides it, never a request: a hosted service reads no folder
 * or file on its own machine (`localFiles: false`), and a host whose runs have no network (a sandbox) reaches no web at
 * all (`web: false`): no search, no page, no repository clone.
 */
export interface ResearchReach {
  /** folders and files on this machine named in a request */
  localFiles: boolean;
  /** the web: searching it, reading pages, cloning repositories */
  web: boolean;
}
export const FULL_REACH: ResearchReach = { localFiles: true, web: true };

/**
 * What research the film gets before its storyboard, if any: links, repositories and (on this machine) folders named in
 * the request are always read; the web is searched when a search engine is set up and either the film has no material
 * or the user asked for it (`meta.research`). What the host's reach leaves out is not attempted: with no web, links and
 * repositories stay in the request's words for the director, and nothing is searched.
 */
export function researchPlan(meta: ProjectMeta, cfg: Config, reach: ResearchReach = FULL_REACH) {
  const found = findSources([meta.topic, meta.notes].filter(Boolean).join('\n'), { local: reach.localFiles });
  const sources = reach.web ? found : { ...found, urls: [], repos: [] };
  const web = reach.web ? createWeb(cfg.search) : offlineWeb;
  const search = !!web.provider && (meta.research ?? !meta.materials.length);
  return hasSources(sources) || search ? { sources, web, search } : undefined;
}

type Model = { runtime: AgentRuntime; prices: Prices };
/** the director's runtime, the pages' and the reviewer's when the film uses other models, and the research's when it has any */
async function buildRuntime(meta: ProjectMeta, cfg: Config, research?: boolean): Promise<Model & { pages?: Model; reviewer?: Model; research?: Model }> {
  applyProxy(cfg.proxy);
  // the user's own base URL per provider and the model ids they typed in are applied by the catalog
  // only the film's own providers' lists: every keyed provider's took seconds (12 s seen), and one that hangs held the
  // run from starting
  // research runs on the cheaper model: the one set for it, else the pages', else the director's
  const researchRef = research ? cfg.defaults.researchModel || meta.pageModel || meta.model : undefined;
  const only = [meta.model, meta.pageModel, meta.reviewModel, researchRef].filter((m): m is string => !!m).map((m) => m.split('/')[0]);
  const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom, baseUrls: cfg.baseUrls, models: cfg.models, only });
  const one = (ref: string) => {
    const [provider, ...rest] = ref.split('/');
    const model = catalog.get(provider, rest.join('/'));
    if (!model) throw new Error(tr(`模型 ${ref} 不可用：检查设置里的 key`, `Model ${ref} is not available: check its key in Settings`));
    const info = catalog.info(model);
    return { model, info, prices: { ...info.cost, currency: info.currency } as Prices };
  };
  const { model, prices } = one(meta.model);
  let pages: { runtime: AgentRuntime; prices: Prices } | undefined;
  if (meta.pageModel && meta.pageModel !== meta.model) {
    const p = one(meta.pageModel);
    // the page agents check their own frames: a model that cannot see would draw blind
    if (!p.info.vision) throw new Error(tr(`画页模型 ${meta.pageModel} 不能看图，换一个能看图的`, `The page model ${meta.pageModel} can't see images; choose one that can`));
    pages = { runtime: piRuntime(catalog.models, p.model), prices: p.prices };
  }
  let reviewer: { runtime: AgentRuntime; prices: Prices } | undefined;
  if (meta.reviewModel) {
    const r = one(meta.reviewModel);
    if (!r.info.vision) throw new Error(tr(`审阅模型 ${meta.reviewModel} 不能看图，换一个能看图的`, `The review model ${meta.reviewModel} can't see images; choose one that can`));
    reviewer = { runtime: piRuntime(catalog.models, r.model), prices: r.prices };
  }
  // Every project runs on Pi, which works with any provider. The Claude Agent SDK and Codex runtimes are parked: their
  // code stays in packages/agent (@frametell/agent/runtime/claude, /codex) but Studio does not offer them — two more agent loops to
  // keep in step was not worth it yet. To bring one back, branch on meta.runtime here, e.g.:
  //   if (meta.runtime === 'claude-agent-sdk') return { runtime: claudeRuntime({ apiKey, baseUrl, model: id }), prices };
  //   if (meta.runtime === 'codex') return { runtime: codexRuntime({ apiKey, baseUrl, model: id }), prices };
  let forResearch: Model | undefined;
  if (researchRef) {
    // a research model that is not available (its key removed) falls back to the film's own
    let r: ReturnType<typeof one> | undefined;
    for (const ref of [researchRef, meta.pageModel, meta.model]) { try { if (ref) { r = one(ref); break; } } catch {} }
    if (r) forResearch = { runtime: piRuntime(catalog.models, r.model), prices: r.prices };
  }
  return { runtime: piRuntime(catalog.models, model), prices, pages, reviewer, research: forResearch };
}

/** the film's narrator as the director takes it; no tts when the film has no voice, or its service has no key (Edge takes none) */
function voiceFor(meta: ProjectMeta, cfg: Config) {
  const p = meta.voice?.provider;
  const tts = !meta.voice ? undefined
    : p === 'edge' ? edgeTts()
    : p === 'elevenlabs' ? (cfg.tts.elevenlabs ? elevenLabsTts(cfg.tts.elevenlabs, undefined, { baseUrl: cfg.ttsBaseUrls?.elevenlabs }) : undefined)
    : (cfg.tts.volcengine ? volcengineTts(cfg.tts.volcengine, { baseUrl: cfg.ttsBaseUrls?.volcengine }) : undefined);
  const voice = meta.voice && tts ? { speaker: meta.voice.id, rate: 0, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然，有轻重缓急' } : undefined;
  return { tts, voice, provider: voice && meta.voice?.provider };
}

class Runner {
  private subs = new Set<(e: Logged) => void>();
  private seq = 0;
  private abort?: AbortController;
  /** why the run was stopped, when not by the user (the host: out of credits); said in its paused event */
  private stopWhy?: 'credits';
  /** this process is going away (a sandbox rolled out): what runs is stopped without a word in the log, and nothing
   *  starts again here. The next process to open the film finds it cut short and carries it on */
  private halted = false;
  /** the task now running, settled once it has wound down (its children stopped) */
  private task?: Promise<void>;
  private gate?: (feedback: string | undefined) => void;
  /** an approval that arrived before the run reached the gate (e.g. right after a server restart) */
  private pending?: { feedback?: string };
  /** notes the user left while nothing was running; handed to the director when the run continues */
  private parked: string[] = [];
  private director?: Director;
  /** an export is running; change requests that arrive meanwhile wait for it */
  private exporting = false;
  private afterExport: string[] = [];
  /** the voice was switched while a task ran: narrate the film again once it ends */
  private revoiceAfter = false;
  status: RunStatus = 'idle';
  private log: string;
  /** the language of the user's latest message, which the director answers in */
  private replyLang?: 'zh' | 'en';
  /** what this film says to the user is in their language: what they last wrote, else what they wrote the film's topic
   * in, else the interface language (a hosted service's is its own, not the user's) */
  private replyIn(meta?: ProjectMeta): 'zh' | 'en' {
    if (this.replyLang) return this.replyLang;
    try { meta ??= readMetaAt(this.dir); } catch {}
    return langOf(`${meta?.topic ?? ''} ${meta?.notes ?? ''}`) ?? resolveLocale(this.config.load().locale);
  }
  private tr(zh: string, en: string) { return this.replyIn() === 'zh' ? zh : en; }

  constructor(readonly id: string, private dir: string, private config: ConfigStore, private renderer?: Renderer, private review?: 'full' | 'defects', private onEvent?: (project: string, e: Logged) => void, private reach: ResearchReach = FULL_REACH) {
    this.log = studioFile(dir, 'events.jsonl');
    if (fs.existsSync(this.log)) {
      const lines = fs.readFileSync(this.log, 'utf8').trim().split('\n').filter(Boolean);
      // the next event follows the highest number logged, not the count of lines: a host that rebuilt this log from its
      // own store (a sandbox restored elsewhere) may have left out an event it could not keep, and a number a browser has
      // already seen must never be given again
      this.seq = lines.reduce((m, l) => { try { const s = (JSON.parse(l) as Logged).seq; return Number.isInteger(s) && s > m ? s : m; } catch { return m; } }, 0);
      // a line the process died in the middle of writing does not parse: skip it, and the last that does is the last event
      const events = lines.flatMap((l) => { try { return [JSON.parse(l) as Logged]; } catch { return []; } });
      const last = events.at(-1);
      this.status = last?.type === 'approval' ? 'awaiting_approval' : this.stateStage() === 'done' ? 'done' : lines.length ? 'stopped' : 'idle';
      // an export cut short by the app closing: the film is still there to preview, the export can simply run again
      // (the last export began and never ended: any render line may come after its start)
      const renders = events.filter((e) => e.type === 'stage' && e.stage === 'render');
      const cut = renders.at(-1)?.type === 'stage' && (renders.at(-1) as Extract<Logged, { type: 'stage' }>).status === 'start';
      if (this.status === 'done' && cut && !heldElsewhere(this.dir)) {
        this.emit({ type: 'stage', stage: 'render', status: 'failed', detail: this.tr('导出被打断了，可以重新导出', 'The export was interrupted. You can export again.') });
        this.interrupted = 'export';
      }
      // a run that was in progress when its process went away (app closed, crash): say so in the log, so every client
      // shows it as paused with a way to continue, instead of a stage that never ends. What tells is whether it was
      // paused since it last started, not the last line: pages that wound down after a pause wrote lines after it, and
      // a film the user had paused was taken for cut short and went on by itself after a restart
      const mark = events.findLast((e) => e.type === 'paused' || e.type === 'resumed');
      if (this.status === 'stopped' && last && mark?.type !== 'paused' && !heldElsewhere(this.dir)) {
        this.emit({ type: 'paused', reason: 'interrupted', stage: this.stateStage() });
        this.interrupted = 'run';
      }
    }
  }

  /** what this process found cut short when it opened the project: a run in progress, or an export */
  interrupted?: 'run' | 'export';

  private stateStage(): string | undefined {
    try { return JSON.parse(fs.readFileSync(studioFile(this.dir, 'state.json'), 'utf8')).stage; } catch { return undefined; }
  }

  summary() {
    const st = studioFile(this.dir, 'state.json');
    const s = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : {};
    const status: RunStatus = this.status !== 'running' && heldElsewhere(this.dir) ? 'running' : this.status;
    const cover = this.cover(), coverImage = this.coverImage();
    return { status, stage: s.stage as string | undefined, video: s.video ? path.relative(this.dir, s.video) : undefined, stale: s.video ? s.exported === false : undefined, ...(cover ? { cover } : {}), ...(coverImage ? { coverImage } : {}) };
  }

  /** cover.json, read through the project's own files only: { page } or { image } */
  private coverJson(): { page?: unknown; image?: unknown } {
    const f = openProjectFile(this.dir, 'cover.json');
    if (!f) return {};
    try { const j = JSON.parse(readFd(f.fd).toString('utf8')); return j && typeof j === 'object' ? j : {}; }
    catch { return {}; }
    finally { fs.closeSync(f.fd); }
  }

  /** the page chosen as the film's cover; absent: the first (or a picture of the user's own, coverImage) */
  cover(): string | undefined {
    const page = this.coverJson().page;
    return typeof page === 'string' && /^[\w-]{1,40}$/.test(page) ? page : undefined;
  }

  /** the picture the user gave as the film's cover (cover-<hash>.<ext> in the project), when it is there */
  coverImage(): string | undefined {
    const image = this.coverJson().image;
    if (typeof image !== 'string' || !COVER_IMAGE.test(image)) return undefined;
    const f = openProjectFile(this.dir, image);
    if (!f) return undefined;
    fs.closeSync(f.fd);
    return image;
  }

  /**
   * Choose the page the exported film opens on (its first frame, what a chat app or a file browser shows of it); null
   * goes back to the first page. An mp4 already made shows the old cover: it is marked out of date, and the next export
   * draws only the film's first segment again. False while the film is being made.
   */
  setCover(page: string | null, o: { log?: boolean } = {}): boolean {
    if (this.status === 'running' || heldElsewhere(this.dir)) return false;
    if (page !== null && !/^[\w-]{1,40}$/.test(page)) return false;
    if ((page ?? undefined) === this.cover() && !this.coverImage()) return true;
    this.dropCoverImages();
    if (page === null) fs.rmSync(path.join(this.dir, 'cover.json'), { force: true });
    else writeIn(this.dir, 'cover.json', JSON.stringify({ page }) + '\n');
    this.coverChanged();
    // a host that keeps the film's events itself (the run is elsewhere) logs it there instead
    if (o.log !== false) this.emit({ type: 'cover', page });
    return true;
  }

  /**
   * A picture of the user's own as the film's cover, drawn as its first frame in place of a page (JPEG, PNG or WebP, at
   * most 10 MB). Kept as cover-<hash>.<ext>, so a new one never shows an old one cached. Undefined while the film is
   * being made, or for a file that is no such picture; else the file's name in the project.
   */
  setCoverImage(data: Uint8Array, o: { log?: boolean } = {}): string | undefined {
    if (this.status === 'running' || heldElsewhere(this.dir)) return undefined;
    const ext = imageType(data);
    if (!ext || data.length > COVER_IMAGE_BYTES) return undefined;
    const image = `cover-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 12)}.${ext}`;
    if (image === this.coverImage()) return image;
    this.dropCoverImages();
    writeIn(this.dir, image, data);
    writeIn(this.dir, 'cover.json', JSON.stringify({ image }) + '\n');
    this.coverChanged();
    if (o.log !== false) this.emit({ type: 'cover', page: null, image });
    return image;
  }

  /** the pictures given as covers before (only regular files: a link the agent planted is never followed, only gone) */
  private dropCoverImages() {
    for (const f of fs.readdirSync(this.dir)) if (COVER_IMAGE.test(f)) fs.rmSync(path.join(this.dir, f), { force: true });
  }

  /** an mp4 already made opens on the old cover: out of date */
  private coverChanged() {
    const st = studioFile(this.dir, 'state.json');
    try {
      const s = JSON.parse(fs.readFileSync(st, 'utf8'));
      if (s.video && s.exported !== false) { s.exported = false; writeIn(this.dir, '.studio/state.json', JSON.stringify(s, null, 2), { record: true }); }
    } catch { /* no state yet */ }
  }

  private emit = (e: StudioEvent) => {
    // live progress of a response being written goes to whoever is watching, not into the log: it is only "now"
    if (e.type === 'agent' && e.event.type === 'progress') {
      const live = { ...e, seq: this.seq + ++this.tick / 1e4, at: Date.now() } as Logged;
      for (const fn of this.subs) fn(live);
      this.tell(live);
      return;
    }
    this.tick = 0;
    const logged = { ...e, seq: ++this.seq, at: Date.now() } as Logged;
    fs.appendFileSync(this.log, JSON.stringify(logged) + '\n');
    for (const fn of this.subs) fn(logged);
    this.tell(logged);
  };
  private tick = 0;

  /** the host hears it too (StudioOptions.onEvent): a host that fails must not stop the run */
  private tell(e: Logged) {
    try { this.onEvent?.(this.id, e); } catch (err) { console.error(`[studio] the host could not take an event of ${this.id}:`, err); }
  }

  /** events after `since` (replayed from disk), then live ones */
  subscribe(fn: (e: Logged) => void, since = 0) {
    let last = since;
    const replay = () => {
      if (!fs.existsSync(this.log)) return;
      for (const l of fs.readFileSync(this.log, 'utf8').split('\n')) {
        if (!l) continue;
        const e = JSON.parse(l) as Logged;
        if (e.seq > last) { last = e.seq; fn(e); }
      }
    };
    replay();
    const live = (e: Logged) => { if (e.seq > last) { last = e.seq; fn(e); } };
    this.subs.add(live);
    // a run in another process (the CLI server or another window) appends to the same log: follow the file
    const follow = () => { if (this.status !== 'running' && heldElsewhere(this.dir)) replay(); };
    fs.watchFile(this.log, { interval: 700 }, follow);
    return () => { this.subs.delete(live); fs.unwatchFile(this.log, follow); };
  }

  /** start or continue the run; it pauses at storyboard approval */
  start() {
    return this.launch((d) => d.run(async () => {
      if (this.pending) { const p = this.pending; this.pending = undefined; return p.feedback; }
      this.status = 'awaiting_approval';
      return new Promise<string | undefined>((resolve) => { this.gate = resolve; });
    }));
  }

  /** a change to a finished film, in the user's words */
  revise(request: string) { return this.launch((d) => d.revise(request)); }

  /** render the finished film to mp4 (only on request: the live preview is the film until then) */
  export(): boolean {
    if (this.halted || this.status === 'running' || this.stateStage() !== 'done') return false;
    void this.launch((d) => d.render(), { exporting: true });
    return true;
  }

  /** build the director and run `task` with it: one run at a time, across processes; the outcome is always logged */
  private async launch(task: (d: Director) => Promise<unknown>, o: { exporting?: boolean } = {}) {
    if (this.status === 'running' || this.halted) return;
    const other = heldElsewhere(this.dir);
    if (other) { this.emit({ type: 'error', message: this.tr(`这个项目正在另一个帧言窗口里制作（进程 ${other}），请在那里继续`, `This project is being made in another Frametell window (process ${other}). Continue there.`) }); return; }
    const lock = studioFile(this.dir, 'run.lock');
    fs.writeFileSync(lock, String(process.pid));
    const release = () => { try { if (+fs.readFileSync(lock, 'utf8') === process.pid) fs.rmSync(lock); } catch {} };
    const meta = readMetaAt(this.dir);
    const cfg = this.config.load({ project: this.id });
    const dir = this.dir;
    linkProject(dir);
    // the history exists before any agent's shell runs: else the shell could make .git itself, with a config of its own
    // that the studio's git would then follow
    if (!fs.existsSync(path.join(dir, '.git'))) new Project(dir).initHistory();
    this.abort = new AbortController();
    this.stopWhy = undefined;
    let finished!: () => void;
    this.task = new Promise<void>((r) => { finished = r; });
    // a paused run that continues says so at once: getting the director ready can take seconds (the model catalog), and
    // until its first step every client still showed it paused, with a Continue that seemed to do nothing
    if (this.status === 'stopped' || this.status === 'failed') this.emit({ type: 'resumed' });
    this.status = 'running';
    let director: Director;
    try {
      // PDF/Word/PPT/EPUB → Markdown the director can read (skipped when already done); a file that cannot be read is
      // reported but does not stop the run
      const { files } = await prepareMaterials(path.join(dir, 'materials'), meta.lang ?? 'zh');
      for (const f of files) if (f.kind === 'document' && !f.parsedTo) this.emit({ type: 'error', message: this.tr(`资料 ${f.name} 读不了：${f.warning}`, `Couldn't read ${f.name}: ${f.warning}`) });
      // an export reads nothing new
      const plan = o.exporting ? undefined : researchPlan(meta, cfg, this.reach);
      // an export draws the film the pages already are: it needs no model, so one that is gone (its provider removed, its
      // key deleted) must not hold it; a model that is asked for anyway says why it can't answer
      const { runtime, prices, pages, reviewer, research } = await buildRuntime(meta, cfg, !!plan).catch((e: Error) => {
        if (!o.exporting) throw e;
        const [provider, ...id] = meta.model.split('/');
        const none: AgentRuntime = { id: 'pi', model: { provider, id: id.join('/') }, open: async () => { throw e; } };
        return { runtime: none, prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: 'USD' } as Prices, pages: undefined, reviewer: undefined, research: undefined };
      });
      const { tts, voice, provider } = voiceFor(meta, cfg);
      director = new Director({
        dir, runtime, pages, reviewer, research: plan && research ? { ...research, ...plan } satisfies DirectorOptions['research'] : undefined,
        style: meta.style, look: meta.look, prices, tts, voice, concurrency: cfg.defaults.concurrency,
        brief: { durationSec: meta.durationSec, topic: meta.topic, notes: meta.notes, styleNotes: meta.styleNotes, brand: meta.brand, lang: meta.lang ?? 'zh', replyLang: this.replyIn(meta), voice: provider, preferences: cfg.preferences },
        emit: this.emit, signal: this.abort.signal, renderer: this.renderer, review: this.review, exportDir: this.renderer ? undefined : cfg.exportDir,
      });
    } catch (e) {
      this.status = 'failed';
      release();
      finished();
      if (this.halted) return;
      this.emit({ type: 'error', message: (e as Error).message });
      this.emit({ type: 'paused', reason: 'error', message: (e as Error).message });
      return;
    }
    this.director = director;
    this.exporting = !!o.exporting;
    for (const n of this.parked.splice(0)) director.message(n);
    // what waited for this task: a voice switched meanwhile (narrated again first), then changes asked during an export
    const next = () => {
      const w = o.exporting ? this.afterExport.splice(0) : [], revoice = this.revoiceAfter;
      this.revoiceAfter = false;
      if (revoice || w.length) void this.launch((d) => (revoice ? d.revoice() : Promise.resolve()).then(() => (w.length ? d.revise(w.join('\n')) : undefined)));
    };
    task(director).finally(() => { release(); this.director = undefined; this.exporting = false; })
      .then(() => { this.status = 'done'; writeMeta(this.dir, readMetaAt(this.dir)); next(); })
      .catch((e: Error) => {
        if (this.halted) { this.status = o.exporting ? 'done' : 'stopped'; return; }
        const stage = this.stateStage();
        // a failed or cancelled export leaves a finished film: say what happened to the export, nothing is paused
        if (o.exporting) {
          const aborted = e.name === 'AbortError' || !!this.abort?.signal.aborted;
          this.status = 'done';
          if (!aborted) this.emit({ type: 'error', message: e.message });
          this.emit({ type: 'stage', stage: 'render', status: 'failed', detail: aborted ? this.tr('已取消导出', 'Export canceled') : this.tr(`导出失败：${e.message}`, `Export failed: ${e.message}`) });
          next();
          return;
        }
        if (e.name === 'AbortError' || this.abort?.signal.aborted) { this.status = 'stopped'; this.emit({ type: 'paused', reason: this.stopWhy ?? 'user', stage }); }
        else { this.status = 'failed'; this.emit({ type: 'error', message: e.message }); this.emit({ type: 'paused', reason: 'error', stage, message: e.message }); }
      })
      .finally(finished);
  }

  /** the user confirmed the storyboard (optionally with change requests) */
  approve(feedback?: string) {
    if (this.gate) { const g = this.gate; this.gate = undefined; this.status = 'running'; g(feedback?.trim() || undefined); return true; }
    if (this.status === 'awaiting_approval' || this.status === 'stopped') { this.pending = { feedback: feedback?.trim() || undefined }; void this.start(); return true; }
    return false;
  }

  /** stop the run; `why`: the host stopped it because the account ran out of credits (said so, not as the user's pause) */
  stop(why?: 'credits') { this.stopWhy = why; this.abort?.abort(); }

  halt(): Promise<void> {
    this.halted = true;
    this.abort?.abort();
    return this.task ?? Promise.resolve();
  }

  /**
   * The user said something. At the storyboard it is the change request; while the director works it is a note the
   * next step picks up; after the film it starts a revision; while paused it is kept for when the run continues.
   */
  say(said: string, refs: UserRef[] = []): boolean {
    said = said.trim();
    if (!said && !refs.length) return false;
    this.emit({ type: 'user', text: said, ...(refs.length ? { refs } : {}) });
    // answer in the language the user writes in: the saved interface language can differ from the panel they type into
    this.replyLang = langOf(said) ?? this.replyLang;
    const text = withRefs(said, refs);   // what the director reads: the references, then the words
    const voice = refs.find((r): r is Extract<UserRef, { kind: 'voice' }> => r.kind === 'voice');
    if (voice) {
      const rest = !!said || refs.some((r) => r.kind !== 'voice');
      if (this.switchVoice(voice, rest ? text : undefined) || !rest) return true;
    }
    if (this.gate || this.status === 'awaiting_approval') return this.approve(text);
    if (this.status === 'running' && this.exporting) {
      this.afterExport.push(text);
      this.emit({ type: 'note', text: this.tr('记下了，导出完就接着改', 'Noted. I’ll make the change once the export finishes.') });
      return true;
    }
    if (this.status === 'running' && this.director) {
      this.director.message(text);
      this.emit({ type: 'note', text: this.tr('收到，接下来的步骤会照这个来', 'Got it. The next steps will follow this.') });
      return true;
    }
    if (this.status === 'done' || this.stateStage() === 'done') { void this.revise(text); return true; }
    // after an error, what the user writes is how to go on: they typed 「继续」 again and again, and nothing moved. A run
    // the user paused goes on when asked to; anything else waits for it, as a note.
    if (this.status === 'failed' || (this.status === 'stopped' && GO_ON.test(said))) {
      if (!GO_ON.test(said)) this.parked.push(text);
      void this.start();
      return true;
    }
    this.parked.push(text);
    this.emit({ type: 'note', text: this.tr('记下了，继续制作时会照这个来', 'Noted. I’ll follow this when work resumes.') });
    return true;
  }

  /**
   * The film's narrator, switched. Nothing is redrawn: the narration is spoken again in the new voice (now on a
   * finished film, after the current task while one runs, when narrating if it hasn't happened yet). Returns true when
   * it also took care of `then`, the rest of the message (a change to the finished film, made after the new voice).
   */
  private switchVoice(v: Extract<UserRef, { kind: 'voice' }>, then?: string): boolean {
    const meta = readMetaAt(this.dir), cfg = this.config.load({ project: this.id });
    const name = v.name || v.id;
    // the same voice again: nothing to do, unless the narration on disk is still another's (a switch cut short)
    let spoken: string | undefined;
    try { spoken = /"speaker":"([^"]*)"/.exec(fs.readFileSync(path.join(this.dir, 'voice.js'), 'utf8'))?.[1]; } catch { /* not narrated yet */ }
    if (meta.voice?.provider === v.provider && meta.voice.id === v.id && (!spoken || spoken === v.id || this.director)) {
      this.emit({ type: 'note', text: this.tr(`这部片子用的已经是「${name}」了`, `This film already uses ${name}.`) });
      return false;
    }
    if (v.provider !== 'edge' && !(v.provider === 'elevenlabs' ? cfg.tts.elevenlabs : cfg.tts.volcengine)) {
      this.emit({ type: 'error', message: this.tr(`「${name}」需要先在设置里连接${v.provider === 'elevenlabs' ? ' ElevenLabs' : '火山引擎'}`, `${name} needs ${v.provider === 'elevenlabs' ? 'ElevenLabs' : 'Volcengine'} connected in Settings first.`) });
      return false;
    }
    meta.voice = { provider: v.provider, id: v.id, name };
    writeMeta(this.dir, meta);
    this.emit({ type: 'voice', voice: meta.voice });
    const { tts, voice, provider } = voiceFor(meta, cfg);
    const stage = this.director?.stage ?? this.stateStage();
    const early = !stage || ['storyboard', 'approval', 'script'].includes(stage);
    if (this.director) {
      this.director.setVoice(tts, voice, provider);
      if (!early) this.revoiceAfter = true;
      this.emit({ type: 'note', text: early ? this.tr(`好，配音会用「${name}」`, `OK, the narration will use ${name}.`)
        : this.exporting ? this.tr(`好，导出完就用「${name}」重新配音`, `OK. Once the export is done, I’ll narrate it again with ${name}.`)
        : this.tr(`好，这一步做完就用「${name}」重新配音`, `OK. Once this step is done, I’ll narrate it again with ${name}.`) });
      return false;
    }
    if (this.status === 'done' || stage === 'done') {
      this.emit({ type: 'note', text: this.tr(`用「${name}」把整部片子重新配一遍，画面不用重画`, `Narrating the whole film again with ${name}; the pictures stay as they are.`) });
      void this.launch((d) => d.revoice().then(() => (then ? d.revise(then) : undefined)));
      return true;
    }
    this.emit({ type: 'note', text: early ? this.tr(`好，配音会用「${name}」`, `OK, the narration will use ${name}.`) : this.tr(`好，继续制作时先用「${name}」重新配音`, `OK. When work resumes, I’ll narrate it again with ${name} first.`) });
    return false;
  }
}
