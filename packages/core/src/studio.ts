// The application core as one object. Every client capability is a method here; transports (HTTP + SSE in the CLI,
// IPC in the desktop app) only translate calls and stream events, so behaviour is identical everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { cliDef, cliModelInfo, cliModels, createCatalog, detectClis, findCli, PROVIDERS, resolveCredentials, type DetectedCli, type ProviderSpec } from '@frametell/models';
import { bundledSample, ELEVENLABS_DEFAULT_VOICES, ElevenLabsError, elevenLabsTts, listElevenLabsVoices, volcengineTts, VoiceNotFound, VOLCENGINE_VOICES } from '@frametell/voice';
import { BRAND_DIR, Project, STYLES, cleanBrand, cleanLook, openProjectFile, writeIn, type OpenFile, type Renderer, type Timeline } from '@frametell/agent';
import { linkProject } from '@frametell/engine/tools/project.mjs';
import { DATA_DIR, configFile, patchConfig, publicConfig, type ConfigStore } from './config.js';
import { Projects } from './runner.js';
import { checkEnv } from './env.js';
import { applyProxy } from './net.js';
import { attach, cleanRefs } from './refs.js';
import type { UserRef, EnvCheck, LoggedEvent, ModelInfo, NewProjectInput, ProjectMeta, ProjectSummary, PublicSettings, SettingsPatch, StyleInfo, Voice, VoicesView } from './types.js';
import { resolveLocale, tr } from './i18n.js';

export interface MaterialFile { name: string; data: Uint8Array }

/**
 * An ElevenLabs account's voices, by key, for ELEVENLABS_TTL: the list takes seconds to fetch and was fetched every
 * time a voice list opened. Shared by every Studio in the process (on a hosted service, every account shares the
 * platform's key); requests that arrive together share one fetch; a failure is not kept, so a fixed key is tried again.
 */
const ELEVENLABS_TTL = 10 * 60_000;
const elevenLabsLists = new Map<string, { at: number; list: Promise<Voice[]> }>();
function elevenLabsVoices(key: string): Promise<Voice[]> {
  const hit = elevenLabsLists.get(key);
  if (hit && Date.now() - hit.at < ELEVENLABS_TTL) return hit.list;
  const list = listElevenLabsVoices(key);
  elevenLabsLists.set(key, { at: Date.now(), list });
  list.catch(() => { if (elevenLabsLists.get(key)?.list === list) elevenLabsLists.delete(key); });
  return list;
}

export interface StudioOptions {
  /** where projects (<dataDir>/projects) and voice samples live; by default ~/.frametell, or FRAMETELL_HOME */
  dataDir?: string;
  /**
   * where settings come from; by default <dataDir>/config.json. A host serving several people from one process gives
   * each Studio its own. The proxy setting is the exception: it applies to the whole process.
   */
  config?: ConfigStore;
  /** where exports are drawn (a hosted service's render containers); this process when absent */
  renderer?: Renderer;
  /** the whole-film check after the pages: 'full' (default) or only for real defects, briefly ('defects'); see DirectorOptions */
  review?: 'full' | 'defects';
  /**
   * every event of every run as it is logged (and each live one, which is not): for a host that keeps or forwards the
   * events itself. Called after the event is in the project's events.jsonl; what it throws is logged and stops nothing.
   */
  onEvent?: (project: string, e: LoggedEvent) => void;
  /**
   * point every project's engine links at this install when the Studio opens (default). A host that keeps projects as
   * data and never runs them here (a service whose runs happen in sandboxes) passes false, so nothing in a project
   * folder is touched
   */
  linkProjects?: boolean;
  /**
   * a folder or file on this machine named in a request may be read by the research (default true); a hosted service
   * turns it off, so nothing on its servers is ever read
   */
  localFiles?: boolean;
  /**
   * the research may reach the web: search it, read pages, clone repositories (default true). A host whose runs have no
   * network (a sandbox, whose box reaches only its gateway) passes false: links in a request are left to the director,
   * and nothing is searched
   */
  web?: boolean;
  /**
   * take a brand brief and its files with a new project (`NewProjectInput.brand`, createProject's `brandFiles`): for a
   * host that keeps brands for its users. Off by default: a new project then ignores both
   */
  brand?: boolean;
}

export class Studio {
  readonly dataDir: string;
  private config: ConfigStore;
  private store: Projects;
  private brands: boolean;

  constructor(o: StudioOptions = {}) {
    this.dataDir = o.dataDir ?? DATA_DIR;
    this.config = o.config ?? configFile(this.dataDir);
    this.brands = o.brand === true;
    this.store = new Projects(path.join(this.dataDir, 'projects'), this.config, o.renderer, o.review, o.onEvent, { localFiles: o.localFiles ?? true, web: o.web ?? true });
    applyProxy(this.config.load().proxy);
    // every project reaches the engine through links; point them at this install (it may have moved, or been renamed)
    if (o.linkProjects !== false) try { for (const id of fs.readdirSync(this.store.root)) { try { linkProject(this.store.dir(id)); } catch {} } } catch {}
  }

  /** the directory holding this Studio's projects */
  get projectsDir() { return this.store.root; }
  /** the folder exports are also copied into, when the user chose one */
  get exportDir() { return this.config.load().exportDir; }

  // ── settings and environment ──
  settings(): PublicSettings { return publicConfig(this.config.load()); }
  updateSettings(patch: SettingsPatch): PublicSettings {
    const next = patchConfig(this.config.load(), patch);
    this.config.save(next);
    applyProxy(next.proxy);
    return publicConfig(next);
  }
  env(): EnvCheck[] { return checkEnv(); }
  styles(): StyleInfo[] { return STYLES; }

  /** the providers Studio offers: signed-in local CLIs first (no key needed), then the key providers, in the order it shows them */
  async providers(): Promise<ProviderSpec[]> {
    const found = await this.clis();
    return [
      ...found.map(({ def, bin, version, auth }): ProviderSpec => ({
        id: def.id, site: def.site, name: def.name, group: 'cli', blurb: def.blurb,
        cli: true, command: def.command, bin, version, auth,
        protocol: 'cli', baseUrl: '',
      })),
      ...PROVIDERS,
    ];
  }

  /** the installed CLIs, probed at most once a minute: version + auth probes take seconds */
  private cliCache: { at: number; found: Promise<DetectedCli[]> } | undefined;
  private clis(): Promise<DetectedCli[]> {
    if (this.cliCache && Date.now() - this.cliCache.at < 60_000) return this.cliCache.found;
    const found = detectClis();
    this.cliCache = { at: Date.now(), found };
    return found;
  }

  async models(): Promise<{ models: ModelInfo[]; default?: ModelInfo }> {
    const cfg = this.config.load();
    const cred = resolveCredentials(cfg);
    const catalog = await createCatalog({ keys: cred.keys, custom: cfg.custom, baseUrls: cred.baseUrls, models: cfg.models });
    // a signed-in CLI's models first: they need no key, so a fresh install still has something to run
    const cliRows = cliModels((await this.clis()).filter((c) => c.auth !== 'needed'), cfg.models);
    const models = [...cliRows, ...(await catalog.available())];
    return { models, default: (await catalog.defaultModel()) ?? cliRows[0] };
  }

  async voices(): Promise<VoicesView> {
    const cfg = this.config.load();
    // the user's own voices first, then the built-in ones, listed without a key: their samples ship with Studio, so
    // they can be heard before connecting
    const mine: Voice[] = (cfg.myVoices ?? []).map((v) => ({ provider: v.provider, id: v.id, name: v.name || v.id, mine: true }));
    const voices: Voice[] = [...mine, ...VOLCENGINE_VOICES.filter((v) => !mine.some((m) => m.id === v.id))];
    let problems: VoicesView['problems'];
    if (cfg.tts.elevenlabs) {
      try { voices.push(...(await elevenLabsVoices(cfg.tts.elevenlabs))); } catch (e) {
        // said in the voice list and in Settings; a key that may speak but not read voices still gets the default ones
        const problem = e instanceof ElevenLabsError ? e.problem : 'other';
        problems = { elevenlabs: { problem, detail: (e as Error).message } };
        if (problem === 'permission') voices.push(...ELEVENLABS_DEFAULT_VOICES);
      }
    }
    return { voices, configured: { volcengine: !!cfg.tts.volcengine, elevenlabs: !!cfg.tts.elevenlabs }, ...(problems && { problems }) };
  }

  /**
   * A short sample of a narrator: the one shipped with Studio for a built-in voice (free), else synthesized once with
   * the user's key and kept on this machine (the same sentence for every voice, so they compare fairly). Returns the
   * mp3 path; ElevenLabs voices also carry a hosted previewUrl.
   */
  async voicePreview(provider: 'volcengine' | 'elevenlabs', id: string): Promise<string> {
    if (!/^[\w.-]+$/.test(id)) throw new Error(tr('音色 id 不合法', 'Invalid voice id'));
    const shipped = provider === 'volcengine' ? bundledSample(id) : undefined;
    if (shipped) return shipped;
    const dir = path.join(this.dataDir, 'voice-previews');
    const file = path.join(dir, `${provider}-${id}.mp3`);
    if (fs.existsSync(file)) return file;
    const cfg = this.config.load();
    const key = provider === 'elevenlabs' ? cfg.tts.elevenlabs : cfg.tts.volcengine;
    if (!key) throw new Error(tr('先在设置里连接配音服务', 'Connect a voice service in Settings first'));
    const tts = provider === 'elevenlabs' ? elevenLabsTts(key) : volcengineTts(key);
    const text = provider === 'elevenlabs' ? 'Hi, I will narrate your video, one clear idea at a time.' : '你好，我来给你的视频配音。我们一句一句，把道理讲清楚。';
    const { audio } = await tts.synth(text, { voice: id, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然' });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, audio);
    return file;
  }

  /**
   * Add a Volcengine voice by its id (「我的音色」): it is checked by speaking the preview sentence with the user's key,
   * which also finds the resource it belongs to (TTS 2.0, 1.0, a cloned voice) and leaves its sample ready to hear.
   */
  async addVoice(input: { id: string; name?: string }): Promise<Voice> {
    const id = input.id.trim();
    if (!/^[\w.-]{2,120}$/.test(id)) throw new Error(tr('音色 ID 只能包含字母、数字、下划线、点和短横线', 'A voice ID has only letters, digits, _ . and -'));
    const cfg = this.config.load();
    if (!cfg.tts.volcengine) throw new Error(tr('先填上火山引擎的 API Key，才能用音色 ID', 'Add your Volcengine API key first to use a voice ID'));
    const preset = VOLCENGINE_VOICES.find((v) => v.id === id);
    const name = input.name?.trim().slice(0, 40) || preset?.name || id;
    try { await this.voicePreview('volcengine', id); }
    catch (e) {
      if (e instanceof VoiceNotFound) throw new Error(tr(`没找到音色「${id}」：检查一下 ID 有没有抄错，以及这个音色在你的火山账号里开通了没有`, `Voice "${id}" wasn't found: check the ID, and that the voice is enabled for your Volcengine account`));
      if (/\b(401|403)\b|unauthori|invalid.*key|auth/i.test((e as Error).message)) throw new Error(tr('火山引擎的 API Key 不对，或者没有开通语音合成', 'The Volcengine API key was refused, or speech synthesis isn\'t enabled for it'));
      throw e;
    }
    const next = this.config.load();
    next.myVoices = [{ provider: 'volcengine', id, name }, ...(next.myVoices ?? []).filter((v) => v.id !== id)];
    this.config.save(next);
    return { provider: 'volcengine', id, name, mine: true };
  }

  // ── projects ──
  projects(): ProjectSummary[] { return this.store.list(); }
  project(id: string): ProjectSummary { return { ...this.store.read(id), ...this.store.runner(id).summary() }; }

  /** create a project from materials and start it right away (it pauses at the storyboard for approval), unless
   * `o.start === false`, which only creates it (a host that runs it elsewhere starts it there). `o.brandFiles`: the
   * files of `input.brand`, written into assets/brand/ (only those its assets name); both are ignored unless the
   * Studio was opened with `brand: true` */
  createProject(input: NewProjectInput, files: MaterialFile[], o: { start?: boolean; brandFiles?: MaterialFile[] } = {}): ProjectMeta {
    const cfg = this.config.load(), d = cfg.defaults;
    const model = input.model || d.model;
    const pages = input.pageModel ?? d.pageModel;
    const reviews = input.reviewModel ?? d.reviewModel;
    if (!model) throw new Error(tr('请先在设置里配置模型', 'Set up a model in Settings first'));
    const said = input.notes?.trim();
    const brand = this.brands ? cleanBrand(input.brand) : undefined;
    if (!files.length && !said && !input.topic) throw new Error(tr('说一句想讲什么，或者附上资料', 'Say what the video is about, or attach some material'));
    // without materials, the sentence the user wrote is the topic; it also names the project
    const topic = input.topic || (files.length ? undefined : said);
    const fromText = (t?: string) => {
      // a link is not a title: the repository or page it names is
      const link = /https?:\/\/\S+/.exec(t ?? '')?.[0];
      t = t?.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!t || /^(讲讲|讲一讲|介绍一下|介绍|聊聊|说说)?(这个|这篇|这个项目|这个仓库)?[。.!！]?$/.test(t)) t = link?.replace(/[/?#]+$/, '').split(/[/?#]/).filter(Boolean).pop() || t;
      const s = t?.replace(/^(讲讲|讲一讲|介绍一下|介绍|聊聊|说说|帮我做一条|做一条|(?:please )?(?:explain|tell me about|talk about|make a video about|a video about)\s+)/i, '').trim();
      if (!s) return undefined;
      if (/[㐀-鿿]/.test(s)) return s.replace(/[。！？!?，,].*$/, '').trim().slice(0, 24) || undefined;
      // English: the first clause, at most 40 characters, cut between words, capitalised
      let e = s.replace(/[.!?;:,].*$/, '').trim();
      if (e.length > 40) e = e.slice(0, 40).replace(/\s+\S*$/, '');
      return e ? e[0].toUpperCase() + e.slice(1) : undefined;
    };
    const meta = this.store.create({
      title: input.title?.trim() || fromText(topic) || fromText(said) || files[0]?.name.replace(/\.[^.]+$/, '') || tr('未命名视频', 'Untitled video'),
      style: input.style || d.style, durationSec: input.durationSec || d.durationSec, model, pageModel: pages && pages !== model ? pages : undefined,
      reviewModel: reviews && reviews !== (pages || model) ? reviews : undefined,
      runtime: input.runtime || (cliDef(model.split('/')[0]) ? 'cli' : d.runtime), voice: input.voice === null ? undefined : input.voice ?? d.voice, subtitles: input.subtitles ?? d.subtitles,
      lang: input.lang ?? resolveLocale(cfg.locale), topic, notes: topic ? undefined : input.notes,
      styleNotes: input.styleNotes?.trim().slice(0, 4000) || undefined, look: cleanLook(input.look), brand,
      ...(input.research !== undefined ? { research: input.research } : {}),
    }, files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })));
    // the brand's files, under the names its brief gives them (plain names, checked there), through the project's own
    // file rules like everything else written into it
    const named = new Set(brand?.assets.map((a) => a.file));
    for (const f of o.brandFiles ?? []) if (named.has(f.name)) writeIn(this.store.dir(meta.id), `${BRAND_DIR}/${f.name}`, f.data);
    if (o.start !== false) void this.store.runner(meta.id).start();
    return meta;
  }

  /**
   * Pages with their narration lines and times (from script.js + voice.js), for the page canvas; null until the script
   * exists. Cached on the two files' mtimes, since computing it loads the engine.
   */
  async timeline(id: string): Promise<Timeline | null> {
    const dir = this.store.dir(id);
    const film = (() => { try { return fs.readdirSync(path.join(dir, 'out')).find((f) => /-(无字幕|no-subtitles)\.mp4$/.test(f)); } catch { return undefined; } })();
    const stamp = ['script.js', 'voice.js', film ? `out/${film}` : ''].map((f) => { try { return f ? fs.statSync(path.join(dir, f)).mtimeMs : 0; } catch { return 0; } }).join('|');
    if (stamp.startsWith('0|')) return null;
    const hit = this.timelines.get(id);
    if (hit?.stamp === stamp) return hit.value;
    let value: Timeline | null = null;
    try {
      const project = new Project(dir);
      value = await project.timeline();
      if (film) value.posters = await project.posters(path.join(dir, 'out', film), value.pages);
    } catch { value = null; }
    this.timelines.set(id, { stamp, value });
    return value;
  }
  private timelines = new Map<string, { stamp: string; value: Timeline | null }>();

  /** full-resolution frames of the film at `times` (project-relative): from the mp4 when it is current, else live */
  async frames(id: string, times: number[]): Promise<string[]> {
    const dir = this.store.dir(id);
    const ts = times.filter((t) => Number.isFinite(t) && t >= 0).slice(0, 40);
    if (!ts.length) return [];
    let st: { video?: string; exported?: boolean } = {};
    try { st = JSON.parse(fs.readFileSync(path.join(dir, '.studio', 'state.json'), 'utf8')); } catch {}
    const cut = st.video && st.exported !== false ? st.video.replace(/-有字幕\.mp4$/, '-无字幕.mp4').replace(/-with-subtitles\.mp4$/, '-no-subtitles.mp4') : undefined;
    // the film named there must be a file of this project's own (opened and checked): a link to another account's film
    // or a path elsewhere is ignored, and the frames are drawn live instead
    const film = cut ? openProjectFile(dir, cut) : null;
    if (film) fs.closeSync(film.fd);
    return new Project(dir).stills(ts, film ? cut : undefined);
  }

  start(id: string) { return this.store.runner(id).start(); }

  /**
   * Picks up what a restart cut short: runs continue, exports start again. For a service that restarts on every deploy;
   * the desktop app and the CLI leave it to the person (the run shows as paused, with a way to continue).
   * Returns the projects it resumed.
   */
  resumeInterrupted(): string[] {
    const resumed: string[] = [];
    for (const p of this.store.list()) {
      const r = this.store.runner(p.id);
      if (r.interrupted === 'run') { void r.start(); resumed.push(p.id); }
      else if (r.interrupted === 'export' && r.export()) resumed.push(p.id);
      r.interrupted = undefined;
    }
    return resumed;
  }
  /** render the finished film to mp4; false when something is running or the film isn't finished */
  export(id: string) { return this.store.runner(id).export(); }
  /** the page the exported film opens on (its first frame); null: the first page. False while the film is being made.
   *  `log: false`: no `cover` event (a host that keeps the film's events itself logs it) */
  setCover(id: string, page: string | null, o?: { log?: boolean }) { this.store.read(id); return this.store.runner(id).setCover(page, o); }
  approve(id: string, feedback?: string) { return this.store.runner(id).approve(feedback); }
  /** `why`: the host stopped it for want of credits, so the film says that instead of "paused" */
  stop(id: string, why?: 'credits') { this.store.runner(id).stop(why); }
  /** a host going away (a sandbox rolled out) stops the film's task without logging a pause: the next host finds it cut
   *  short and carries it on. Settles once the task has wound down */
  halt(id: string): Promise<void> { return this.store.runner(id).halt(); }
  /** delete a project and its files; refused while it is being made */
  deleteProject(id: string) { this.store.remove(id); this.timelines.delete(id); }
  /** file a project under a group on the home page; '' takes it out of any */
  moveProject(id: string, group: string) { this.store.setGroup(id, String(group ?? '')); }
  /** talk to the director: storyboard feedback, a note mid-run, or a change to the finished film */
  say(id: string, text: string, refs?: unknown) { return this.store.runner(id).say(text, cleanRefs(refs)); }
  /** save a file the user attached to a message; returns the reference to send with it */
  attach(id: string, name: string, data: Uint8Array): Promise<UserRef> { const meta = this.store.read(id); return attach(this.store.dir(id), name, data, meta.lang ?? 'zh'); }

  /** replay events after `since`, then stream live ones; returns the unsubscribe function */
  subscribe(id: string, since: number, fn: (e: LoggedEvent) => void): () => void { return this.store.runner(id).subscribe(fn, since); }

  /** absolute path of a file inside a project (snapshots, audio, video), or null. Checked now and opened later by the
   *  caller, so a link swapped in between wins: anything served to a browser goes through openProjectFile instead */
  projectFile(id: string, rel: string): string | null {
    const f = this.openProjectFile(id, rel);
    if (!f) return null;
    fs.closeSync(f.fd);
    return f.name;
  }

  /**
   * A file inside a project, opened (the preview player, and every file the API serves from a project). Opened first
   * and checked after, on what was opened: the agent's shell writes the project, and a link it swaps between a check
   * and an open would serve another account's file. The descriptor's real path has to stay in the project, or in the
   * installed engine that engine/ and engine_modules/ legitimately link to (decided here, never by the project's links);
   * a file of the project with a second hard link is refused too (a hard link carries no path to check). The caller
   * owns `fd` and closes it (a read stream with autoClose does). Null, with nothing left open, for anything else.
   * `record: true` (the host's own reads only, never from a request) also allows the studio's record.
   */
  openProjectFile(id: string, rel: string, o: { record?: boolean } = {}): OpenFile | null {
    if (!/^[\w-]+$/.test(id)) return null;
    // the studio's record (.studio/: the agents' transcripts, the run's events) is for the host's own reads, which name
    // it with `record`; whatever a browser can ask for never reaches it, not even through a link into .studio
    return openProjectFile(this.store.dir(id), rel || 'index.html', { engine: true, record: o.record === true });
  }
}

export type { OpenFile };
