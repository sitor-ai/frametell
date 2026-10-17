// The director: runs a project through its stages. The model writes; the orchestrator checks. Storyboard lint, page
// lint and contact sheets are produced here and handed to the agent, so the quality bar doesn't depend on the model
// remembering to look. Every change is committed; state is persisted so an interrupted run resumes where it stopped.
import fs from 'node:fs';
import path from 'node:path';
import { narrate, type TtsProvider } from '@frametell/voice';
import { Project, childCmd, projectFiles, type LintIssue, type LintKind, type PageTiming, type Storyboard, type Renderer } from './project.js';
import { FLAG, VERDICT, fixPrompt, kitFixPrompt, kitPrompt, kitReviewNote, kitReviewerPrompt, kitSystem, langNote, voiceNote, pagePrompt, pageSystem, plannerSystem, replyNote, reviewPrompt, reviewerPrompt, reviewerSystem, scriptPrompt, storyboardFixPrompt, storyboardPrompt, verdictAgain, type Brief, type Problem } from './prompts.js';
import { KIT_CHECK_FILE, KIT_FILE, KIT_KEPT, keepComponents, kitIssues, kitPlan, kitStage, kitTimes, kitWanted, type KitItem } from './kit.js';
import { addUsage, emptyUsage, type AgentRuntime, type AgentSession, type SessionOptions, type Thinking, type TokenUsage, type TurnResult } from './runtime/types.js';
import type { PageIssue, PageStatus, Stage, StudioEvent } from './events.js';
import { designedFonts, designedIssues, designedLook, type Look } from './look.js';
import { SIGN_OFF_HOLD, signsOff } from './brand.js';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { freeze, openIn } from './projectfs.js';
import { briefFile, runResearch, type ResearchLimits } from './research/research.js';
import type { Sources } from './research/sources.js';
import type { Web } from './research/web.js';

export interface Prices { input: number; output: number; cacheRead: number; cacheWrite: number; currency: 'CNY' | 'USD' }

export interface DirectorOptions {
  dir: string;
  runtime: AgentRuntime;
  style: string;
  brief: Brief;
  tts?: TtsProvider;
  voice?: { speaker: string; rate?: number; instruction?: string };
  /** model price per million tokens, for the running cost */
  prices?: Prices;
  /**
   * the model that draws the pages and checks the whole film, when it is not the director's: the pages are ~90% of a
   * film's tokens, so this is where a faster, cheaper model pays; the director (storyboard, script, planning a
   * change) keeps the stronger one
   */
  pages?: { runtime: AgentRuntime; prices?: Prices };
  /**
   * the model that reviews each drawn page from its screenshots, in a session of its own: not the one that drew it, so
   * a page is not passed by the eyes that made it. Absent: the page model, in a fresh session
   */
  reviewer?: { runtime: AgentRuntime; prices?: Prices };
  /** this film's own colours and fonts (META.look), written into script.js with the other server-owned fields */
  look?: Look;
  /** page sessions running at once */
  concurrency?: number;
  emit?: (e: StudioEvent) => void;
  signal?: AbortSignal;
  /** where exports are drawn; this process when absent */
  renderer?: Renderer;
  /** a folder each export is also copied into (the user's 「导出位置」) */
  exportDir?: string;
  /**
   * the whole-film check after the pages: 'full' (the default) whenever the film's lint finds anything or a page is
   * still flagged after its own rounds; 'defects' only for what breaks a film (a frame that renders differently, page
   * code that fails), one round, at most MAX.reviewDefectsMs — a hosted service paying for every turn
   */
  review?: 'full' | 'defects';
  /**
   * research before the storyboard, on its own (cheaper) model: what the request points at is read, and the web
   * searched when `search`; the brief becomes materials/research.md. Absent: no research
   */
  research?: { runtime: AgentRuntime; prices?: Prices; web: Web; sources: Sources; search: boolean; limits?: Partial<ResearchLimits> };
}

interface PageState { status: PageStatus; rounds: number; issues: PageIssue[]; ref?: string; /** runs this page has failed in */ failures?: number }
interface State {
  stage: Stage | 'approval' | 'done';
  planner?: string;
  pages: Record<string, PageState>;
  usage: TokenUsage;
  video?: string;
  /** the mp4 shows the film as it is now (false once a revision changes a page, until the next export) */
  exported?: boolean;
  /** what the user told the director while it worked; each session picks up the notes it hasn't seen yet */
  notes?: string[];
  cursors?: Record<string, number>;
  /** per-page instructions of the revision in progress */
  revision?: Record<string, string>;
  /** the change to the finished film being made, until it is done: "Continue" after a failure picks it up again */
  change?: string;
  /** what the film has cost so far, in the director's currency: each turn at the price of the model that took it */
  spent?: number;
  /** research before the storyboard has run (its brief is in materials/research.md) or was given up */
  research?: 'done' | 'failed';
  /** this film's own components (kit.ts): written and checked (`components` the ones that passed), given up, or not
   *  wanted (a style with its own, a short film, nothing that recurs) */
  kit?: { status: 'done' | 'failed' | 'none'; components: string[] };
}

/** two pieces of work side by side: both run to the end, and the first failure is thrown once both have */
async function both(a: Promise<unknown>, b: Promise<unknown>) {
  const r = await Promise.allSettled([a, b]);
  const bad = r.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (bad) throw bad.reason;
}

/** a USD↔CNY rate for adding up a film whose two models are priced in different currencies (rare; an estimate) */
const CNY_PER_USD = 7.2;
/** what `u` costs at `p`, in `currency` */
function priced(u: TokenUsage, p: Prices | undefined, currency: Prices['currency']): number {
  if (!p) return 0;
  const a = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
  return p.currency === currency ? a : currency === 'CNY' ? a * CNY_PER_USD : a / CNY_PER_USD;
}

/** components every page of a style can use, registered before the page sessions start */
const STYLE_EXTRAS: Record<string, string[]> = { 'warm-story': ['engine/lib/warm.js'] };
/** a style's components: the ones listed above, or the style pack's own kit.js (a style installed beside the built-in
 *  ones brings its components with it) */
const styleExtras = (style: string): string[] =>
  STYLE_EXTRAS[style] ?? (fs.existsSync(path.join(ENGINE_DIR, 'styles', style, 'kit.js')) ? [`engine/styles/${style}/kit.js`] : []);

/** a style drawn in three.js (its kit.js builds on THREE): every film in it loads three and paints with WebGL */
const styleWebgl = (style: string): boolean => {
  try { return /\bTHREE\b/.test(fs.readFileSync(path.join(ENGINE_DIR, 'styles', style, 'kit.js'), 'utf8')); } catch { return false; }
};

/** the part of a crash that says what broke: the error and the page's own lines, not Node's internals */
export function crashText(raw: string, id: string): string {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.find((l) => /(Error|error):/.test(l) && !/^node:internal/.test(l))?.replace(/^page\.evaluate:\s*/, '') ?? lines[0] ?? raw;
  const at = lines.filter((l) => l.includes(`pages/${id}.js`) || /engine\/(runtime|lib)\//.test(l)).map((l) => l.replace(/^.*?((pages|engine)\/[^\s)]+).*$/, '$1')).slice(0, 4);
  return [err.replace(/ at file:\/\/\S+/, ''), ...at.map((a) => `  at ${a}`)].join('\n').slice(0, 800);
}

const crashPrompt = (id: string, crash: string) => `pages/${id}.js throws when it runs, so it cannot be checked with screenshots yet:
${crash}
Fix this error first: it is most likely a call to a function that does not exist, or wrong arguments. Go by this film's components and worked example, never guess the engine's API. Fix it with edit, all edits in one reply, each with finish: true: the round ends once they apply, no reply needed.`;

/**
 * A page that already works, changed: the current code is handed over, and the change is made with targeted edits.
 * Rewriting a 300-line page to change one thing is minutes of output (seen: 10k tokens, 3 minutes, for a title).
 */
const revisionNote = (id: string, fix: string, code: string) => `

This page is a **revision**: the film is finished and the user asked for a change to this page. The change: ${fix}
Here is the current pages/${id}.js; it is already given, so don't read it again:
\`\`\`js
${code}
\`\`\`
Change only what needs changing, with edit; **never rewrite the whole file with write**. **Put all the edits in one reply** (one reply can call edit several times), each with finish: true: you're done once they apply, no reply needed and no need to read the file again; the check screenshots will show the result.
If this page already shows the change, or the change says nothing this page can do, don't go looking for what was meant (other files, the film's history, other folders): change nothing and call flag with one sentence for the user, in the language you reply in, saying what you found.`;

// Pages are drawn at medium thinking, drafts and check rounds alike; on a gateway's …-high model that means its …-medium
// sibling. Most of a page's time was the model thinking before writing: on the same pages a -high draft took 170–220 s
// and a -medium one 37–74 s, with no worse a page (one was cleaner, with no lint issues); a check round dropped from
// 26–153 s to about 6 s. The storyboard and the narration keep the model's own level.
const PAGE_THINKING: Thinking = 'medium';
/** a revised page whose code is as it was: the change never landed */
const NOT_MADE = { zh: '这次没有改上：页面和改之前一样', en: 'The change was not made: the page is as it was' };
/** a model service's trouble behind a failure, in words the user can act on (none: the trouble is the page's own) */
export function serviceTrouble(text: string): { zh: string; en: string } | undefined {
  if (/not logged in|please (log ?in|sign ?in)|login required|not authenticated|未登录/i.test(text)) return { zh: '这个本机命令行还没有登录：在终端里登录它，再点继续。', en: 'This local command line is not signed in. Sign in from a terminal, then continue.' };
  if (/\b402\b|insufficient|balance|quota|credit|billing|余额|额度|欠费/i.test(text)) return { zh: '模型账户的余额或额度用完了：充值，或在设置里换一个 key，再点继续。', en: 'The model account is out of balance or quota. Top it up or use another key in Settings, then continue.' };
  if (/\b40[13]\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?key|key|token)|authentication|forbidden/i.test(text)) return { zh: '模型的 key 无效或没有权限：在设置里检查 key，再点继续。', en: 'The model key is invalid or not allowed. Check it in Settings, then continue.' };
  if (/\b(429|529|503)\b|rate.?limit|too many requests|overloaded|capacity|限流/i.test(text)) return { zh: '模型服务这会儿太忙，限流了：等几分钟再点继续。', en: 'The model service is busy and limiting requests. Wait a few minutes, then continue.' };
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|terminated/i.test(text)) return { zh: '连不上模型服务：检查网络或代理，再点继续。', en: "Couldn't reach the model service. Check the network or proxy, then continue." };
  return undefined;
}

/** a stop (Pause), not a failure */
const stopped = (e: unknown) => (e as Error)?.name === 'AbortError';
// pageChecks: a drawn page is checked at most 3 times (2 rounds of fixes); a revision starts from a checked page, 2.
const MAX = { pageLintMs: 90_000, pagesAtOnce: 10, storyboardFix: 2, scriptFix: 2, planTurns: 30, pageTurns: 40, reviewerTurns: 3, pageChecks: 3, kitChecks: 3, kitTurns: 30, revisionChecks: 2, reviewRounds: 2, reviewDefectsMs: 180_000 };
/** the reviewer looks at one sheet and answers: little thinking, quickly */
const REVIEWER_THINKING: Thinking = 'low';
/** what breaks a film whatever it looks like: the whole-film check's 'defects' mode takes only these */
const DEFECTS: LintKind[] = ['runtime', 'api', 'nondeterministic', 'palette'];
/** findings that mean the page's code does not run as written: such a page is not drawn */
const BROKEN: LintKind[] = ['runtime', 'api'];
const errorsOf = (issues: LintIssue[]) => issues.filter((i) => i.level === 'error');
const fromLint = (i: LintIssue): PageIssue => ({ from: 'lint', kind: i.kind, at: i.local, msg: i.msg, data: i.data });
const fromReview = (p: Problem): PageIssue => ({ from: 'review', at: p.at, msg: p.what });
/** what the page agent said with its flag tool, if it used it */
const flagOf = (r: TurnResult) => r.answers.find((a) => a.name === FLAG.name)?.args.reason as string | undefined;

export class Director {
  readonly project: Project;
  private state: State;
  private commits: Promise<unknown> = Promise.resolve();

  constructor(private o: DirectorOptions) {
    this.project = new Project(o.dir, o.renderer, o.signal);
    const f = this.project.file('.studio/state.json');
    this.state = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { stage: 'storyboard', pages: {}, usage: emptyUsage() };
    // a film from before issues had fields kept them as lines of text: kept as notes, which no panel words
    for (const p of Object.values(this.state.pages ?? {})) p.issues = (p.issues ?? []).map((i: PageIssue | string) => (typeof i === 'string' ? { from: 'agent', msg: i } : i));
  }

  get stage() { return this.state.stage; }

  /** a new narrator, mid-run: whatever is narrated from now on uses it (what was narrated already: revoice) */
  setVoice(tts: TtsProvider | undefined, voice: DirectorOptions['voice'], provider?: Brief['voice']) {
    this.o.tts = tts; this.o.voice = voice; this.o.brief.voice = provider;
  }

  /** a note from the user mid-run: sessions read it the next time they are spoken to */
  message(text: string) {
    (this.state.notes ??= []).push(text.trim());
    this.save();
  }
  /** the notes a session hasn't seen yet, as a block to append to its next message */
  private unseen(key: string): string {
    const all = this.state.notes ?? [], cur = (this.state.cursors ??= {})[key] ?? 0;
    if (cur >= all.length) return '';
    this.state.cursors[key] = all.length; this.save();
    return `\n\nThe user just added (follow it if it concerns this page, otherwise ignore it):\n${all.slice(cur).map((n) => `- ${n}`).join('\n')}`;
  }
  get usage() { return this.state.usage; }
  /** what the user reads (notes, failures, the film's history), in the user's language */
  private say(zh: string, en: string) { return this.o.brief.replyLang === 'en' ? en : zh; }

  private emit(e: StudioEvent) { this.o.emit?.(e); }
  private save() {
    fs.mkdirSync(this.project.file('.studio'), { recursive: true });
    fs.writeFileSync(this.project.file('.studio/state.json'), JSON.stringify(this.state, null, 2));
  }
  /** commits are serialized: page sessions run in parallel but share one git index. → the commit, null when nothing changed */
  private commit(message: string): Promise<string | null> {
    const next = this.commits.then(async () => { const id = await this.project.commit(message); if (id) this.emit({ type: 'commit', id, message }); return id; });
    this.commits = next;
    return next;
  }
  cost() {
    const currency = this.o.prices?.currency ?? 'USD';
    // films from before per-model pricing kept only their tokens: priced at the director's model
    return { amount: this.state.spent ?? priced(this.state.usage, this.o.prices, currency), currency };
  }
  /** usage is counted per model turn as it happens, so the running cost is live even inside a long exchange */
  private countTurn(u: TokenUsage, prices: Prices | undefined, model: AgentRuntime['model']) {
    const { amount, currency } = this.cost();
    this.state.spent = amount + priced(u, prices, currency);
    this.state.usage = addUsage(this.state.usage, u);
    this.save();
    this.emit({ type: 'cost', usage: this.state.usage, ...this.cost(), turn: u, model: `${model.provider}/${model.id}` });
  }
  /** the page model draws the pages and checks the whole film; the director's takes everything else */
  private model(name: string) {
    if (name === 'research' && this.o.research) return this.o.research;
    // a page that failed before is drawn again by the film's own model: the same model, asked the same way, failed the
    // same pages again on every Continue
    if (name.startsWith('page-') && this.redraw.has(name.slice(5))) return { runtime: this.o.runtime, prices: this.o.prices };
    if (name.startsWith('check-')) return this.o.reviewer ?? this.o.pages ?? { runtime: this.o.runtime, prices: this.o.prices };
    return this.o.pages && (name.startsWith('page-') || name === 'review' || name === 'kit') ? this.o.pages : { runtime: this.o.runtime, prices: this.o.prices };
  }
  private async session(name: string, system: string, maxTurns: number, resume?: string, signal = this.o.signal, tools: Pick<SessionOptions, 'tools' | 'answers'> = {}): Promise<AgentSession> {
    const { runtime, prices } = this.model(name);
    // a reviewer's words are for the page agent, not the people watching: only its turns go out, to be counted
    const shown = !name.startsWith('check-');
    return runtime.open({ name, system, cwd: this.o.dir, maxTurns, signal, ...tools, onEvent: (event) => {
      if (shown || event.type === 'turn') this.emit({ type: 'agent', session: name, event });
      if (event.type === 'turn') { this.countTurn(event.usage, prices, runtime.model); if (name.startsWith('page-')) this.firstTurn?.(); }
    } }, resume);
  }
  private async send(s: AgentSession, text: string, images?: string[], thinking?: Thinking) {
    const r = await s.send({ text, images, thinking });
    if (r.stopReason === 'aborted') throw new DOMException('aborted', 'AbortError');
    if (r.error) this.lastError.set(s, r.error);
    return r;
  }
  private fail(stage: Stage, message: string): never {
    this.emit({ type: 'stage', stage, status: 'failed', detail: message });
    this.emit({ type: 'error', stage, message });
    throw new Error(message);
  }

  // ── ⓪ research ───────────────────────────────────────────────────────────────────────────────
  /**
   * Reads what the request points at and, when it may, searches the web, then leaves a brief for the storyboard.
   * Never holds the film up: if it fails, the film is made from what there is, as it would have been without it.
   */
  async research() {
    const r = this.o.research;
    if (!r || this.state.research) return;
    this.emit({ type: 'stage', stage: 'research', status: 'start' });
    const { prices } = this.model('research');
    try {
      const out = await runResearch({
        dir: this.o.dir, runtime: r.runtime, web: r.web, sources: r.sources, search: r.search, brief: this.o.brief, limits: r.limits, signal: this.o.signal,
        onEvent: (event) => { this.emit({ type: 'agent', session: 'research', event }); if (event.type === 'turn') this.countTurn(event.usage, prices, r.runtime.model); },
        onNote: (repo) => this.emit({ type: 'note', text: this.say(`正在下载代码仓库 ${repo}`, `Downloading the repository ${repo}`) }),
      });
      fs.mkdirSync(this.project.file('materials'), { recursive: true });
      fs.writeFileSync(this.project.file('materials/research.md'), briefFile(out));
      this.state.research = 'done'; this.save();
      const { searches, pages, folders } = out.read;
      const detail = this.o.brief.replyLang === 'en'
        ? [searches && `${searches} searches`, pages && `${pages} pages read`, folders && `${folders} folder${folders > 1 ? 's' : ''} read`, `${out.sources.length} sources`].filter(Boolean).join(', ')
        : [searches && `搜索 ${searches} 次`, pages && `读了 ${pages} 个网页`, folders && `看了 ${folders} 个文件夹`, `引用 ${out.sources.length} 处来源`].filter(Boolean).join('，');
      this.emit({ type: 'stage', stage: 'research', status: 'done', detail });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || this.o.signal?.aborted) throw e;
      this.state.research = 'failed'; this.save();
      this.emit({ type: 'stage', stage: 'research', status: 'failed', detail: (e as Error).message });
      this.emit({ type: 'note', text: this.say('调研没有完成，先按现有的材料来做', 'The research did not finish; going ahead with what there is') });
    }
  }

  // ── ① storyboard ──────────────────────────────────────────────────────────────────────────────
  async storyboard(): Promise<Storyboard> {
    this.emit({ type: 'stage', stage: 'storyboard', status: 'start' });
    if (!fs.existsSync(this.project.file('.git'))) this.project.initHistory();
    // only what the agent can read: md/txt/images. PDF/Word/PPT/EPUB are parsed beforehand into x.md (or x.pdf.md)
    const all = fs.existsSync(this.project.file('materials')) ? fs.readdirSync(this.project.file('materials')).filter((f) => !f.startsWith('.')) : [];
    const materials = all.filter((f) => /\.(md|markdown|txt|png|jpe?g|webp|gif)$/i.test(f));
    const s = await this.session('planner', plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand), MAX.planTurns, this.state.planner);
    let r = await this.send(s, storyboardPrompt(this.o.brief, this.o.style, materials));
    this.state.planner = s.ref; this.save();
    // a turn can end without the file (seen: a gateway answering a one-token "." mid-turn); ask once more, as for pages
    if (!this.project.exists('storyboard.json') && r.stopReason !== 'max_turns') r = await this.send(s, 'storyboard.json does not exist yet; write it, then stop and report. ' + replyNote(this.o.brief.replyLang, this.o.brief.lang));
    if (!this.project.exists('storyboard.json')) this.fail('storyboard', this.say(`没有写出分镜：${r.error || r.text}`, `No storyboard was written: ${r.error || r.text}`));
    // the film's language is the server's to say (the page agents and the checks read it from here)
    try {
      const j = this.project.storyboard();
      if (j.lang !== (this.o.brief.lang ?? 'zh')) this.project.write('storyboard.json', JSON.stringify({ ...j, lang: this.o.brief.lang ?? 'zh' }, null, 2));
    } catch {}
    for (let round = 1; ; round++) {
      const issues = [...this.project.storyboardIssues(), ...this.lookIssues()];
      this.emit({ type: 'storyboard_check', round, issues });
      const reds = issues.filter((i) => i.level === 'red');
      if (!reds.length || round > MAX.storyboardFix) break;
      r = await this.send(s, storyboardFixPrompt(issues, this.o.brief));
    }
    await this.commit(this.say('分镜', 'Storyboard'));
    await s.close();
    const sb = this.project.storyboard();
    this.state.stage = 'approval'; this.save();
    this.emit({ type: 'stage', stage: 'storyboard', status: 'done' });
    this.emit({ type: 'approval', storyboard: sb });
    return sb;
  }

  // ── ② narration script ───────────────────────────────────────────────────────────────────────
  async script(feedback?: string) {
    this.emit({ type: 'stage', stage: 'script', status: 'start' });
    this.state.stage = 'script'; this.save();
    this.serverMeta();
    const s = await this.session('planner', plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand), MAX.planTurns, this.state.planner);
    let r = await this.send(s, scriptPrompt(feedback, this.o.brief) + this.unseen('planner'));
    this.state.planner = s.ref; this.save();
    let check: Awaited<ReturnType<Project['scriptCheck']>>;
    for (let ask = 0; ; ask++) {
      // the planner rewrites script.js: put the server-owned fields back (a lost META.voice once rendered a silent film)
      this.serverMeta();
      check = await this.project.scriptCheck();
      if (check.code) this.fail('script', this.say(`口播脚本有错：`, `The narration script has an error: `) + `${check.err || check.out} ${r.error ?? ''}`);
      // the pages drawn are the narration's: a turn that ended before every storyboard page had its words made a
      // one-page film of an eight-page storyboard, green all the way. Ask for the rest; stop if they still don't come.
      const narrated = new Set((await this.project.timeline()).pages.map((p) => p.id));
      const missing = this.project.storyboard().pages.map((p) => p.id).filter((id) => !narrated.has(id));
      if (!missing.length) break;
      if (ask === MAX.scriptFix) this.fail('script', this.say(`口播没有写完：分镜里的 ${missing.join('、')} 没有口播`, `The narration is unfinished: ${missing.join(', ')} of the storyboard ha${missing.length > 1 ? 've' : 's'} no narration`) + (r.error ? ` (${r.error})` : ''));
      r = await this.send(s, `script.js has no narration for ${missing.join(', ')}: every page of storyboard.json needs its entry in PAGES, in the storyboard's order, with the same id. Add the missing pages and keep the ones already written, then run node engine/tools/script.mjs and stop. ` + replyNote(this.o.brief.replyLang, this.o.brief.lang));
    }
    await this.commit(this.say('口播', 'Narration'));
    await s.close();
    this.state.stage = 'narrate'; this.save();
    this.emit({ type: 'stage', stage: 'script', status: 'done', detail: check.out.split('\n').pop() });
  }

  /** a designed style's film (its style has no look of its own): what its storyboard still lacks of the look */
  private lookIssues(): { level: 'red'; msg: string }[] {
    const fonts = designedFonts(this.o.style);
    if (!fonts) return [];
    let look: unknown;
    try { look = this.project.storyboard().look; } catch { return []; }   // an unreadable storyboard is reported already
    let ids: string[] = [];
    try { ids = this.project.storyboard().pages.map((p) => p.id); } catch {}
    return [...designedIssues(look, fonts), ...kitIssues(look, ids)].map((msg) => ({ level: 'red' as const, msg }));
  }

  /** a designed style's film: the look the director wrote in storyboard.json (its card and what it comes to) */
  private designed() {
    const fonts = designedFonts(this.o.style);
    if (!fonts) return undefined;
    try { return designedLook(this.project.storyboard().look, fonts); } catch { return undefined; }
  }

  /** Style, voice, pacing and the style's components: owned by the server, re-applied after every agent edit. */
  private serverMeta() {
    const extras = new Set<string>(styleExtras(this.o.style));
    if (this.state.kit?.status === 'done') extras.add(KIT_FILE);
    try {   // keep components the page agents registered (use-extra.mjs appends to META.extras)
      const m = /extras:\s*(\[[^\]\n]*\])/.exec(this.project.read('script.js'));
      if (m) for (const e of JSON.parse(m[1].replace(/'/g, '"'))) extras.add(e);
    } catch {}
    // a style component copied into extras/ by use-extra is the same file: load it once, from the engine
    const base = new Set(styleExtras(this.o.style).map((e) => path.basename(e)));
    const list = [...extras].filter((e) => !(e.startsWith('extras/') && base.has(path.basename(e))));
    const gl = styleWebgl(this.o.style) ? (() => {
      const vendor = new Set<string>(['three']);
      try {   // keep vendors the page agents added
        const m = /vendor:\s*(\[[^\]\n]*\])/.exec(this.project.read('script.js'));
        if (m) for (const v of JSON.parse(m[1].replace(/'/g, '"'))) vendor.add(v);
      } catch {}
      return { vendor: [...vendor], webgl: true };
    })() : {};
    // a film that ends on its brand's sign-off holds longer after its last line, so the logo is seen in silence
    const signOff = (() => { try { return signsOff(this.o.brief.brand, this.project.storyboard().pages); } catch { return false; } })();
    this.setMeta({ style: this.o.style, lang: this.o.brief.lang ?? 'zh', voice: this.o.voice, gap: 0.8, pace: { maxHold: 1.0, gap: 0.8, ...(signOff ? { tail: SIGN_OFF_HOLD } : {}) }, extras: list, look: this.o.look ?? this.designed()?.look, ...gl });
  }

  // ── this film's own components (kit.ts) ─────────────────────────────────────────────────────
  /** the components this film's pages get, as the storyboard listed them */
  private kitItems(): KitItem[] {
    if (this.state.kit?.status !== 'done') return [];
    try { return kitPlan(this.project.storyboard().look).filter((x) => this.state.kit!.components.includes(x.name)); } catch { return []; }
  }
  /** the kit file the pages are shown, when this film has one */
  private filmKit() { return this.state.kit?.status === 'done' ? this.project.file(KIT_FILE) : undefined; }
  /** the kit as it was checked, put back before a page's check if anything changed it (the agents' file tools cannot:
   *  it is frozen; a shell can). Pages are drawn side by side, so who changed it can't be told: it is only put back */
  private keepKit(): boolean {
    if (this.state.kit?.status !== 'done' || !this.project.exists(KIT_KEPT)) return false;
    const kept = this.project.read(KIT_KEPT);
    let now: string | undefined;
    try { now = this.project.read(KIT_FILE); } catch {}
    if (now === kept) return false;
    this.project.write(KIT_FILE, kept);
    return true;
  }

  /** the kit's check: its own project (.studio/kit), the check page's timing, and the engine's check of it (lint with
   *  determinism, and a contact sheet of each component once drawn) */
  private async checkKit(items: KitItem[], look: unknown, round: number) {
    const stage = new Project(kitStage(this.o.dir, { style: this.o.style, lang: this.o.brief.lang ?? 'zh', look, items, kit: this.project.read(KIT_FILE), check: this.project.read(KIT_CHECK_FILE) }), undefined, this.o.signal);
    const page = (await stage.timeline()).pages[0];
    const times = kitTimes(page.cues, page.end);
    return { page, times, check: await stage.check('kit', `kit-r${round}`, times, { determinism: true, lintMs: MAX.pageLintMs }) };
  }

  /**
   * A designed style's film of many pages: the things its storyboard lists in `look.kit` written once as components
   * (extras/film-kit.js), checked on a sheet of their own (a project of its own in .studio/kit, so the film's pages and
   * timing are untouched), and kept to the ones that pass. It never holds the film up: a kit that cannot be had leaves
   * the pages to draw everything themselves, as before.
   */
  async kit() {
    const sb = this.project.storyboard();
    const designed = this.designed();
    const items = kitPlan(sb.look);
    if (!kitWanted(!!designed, sb.pages.length, items)) { this.state.kit = { status: 'none', components: [] }; this.save(); return; }
    this.emit({ type: 'kit', status: 'start', components: items.map((x) => x.name) });
    let s: AgentSession | undefined, reviewer: AgentSession | undefined;
    let passed: string[] = [], sheet: string | undefined;
    try {
      s = await this.session('kit', kitSystem(this.o.style, this.o.brief.styleNotes, designed?.card), MAX.kitTurns);
      let r = await this.send(s, kitPrompt(sb, items, this.o.brief.lang, this.o.brief.replyLang), undefined, PAGE_THINKING);
      if (!this.project.exists(KIT_FILE) || !this.project.exists(KIT_CHECK_FILE)) r = await this.send(s, `Write both ${KIT_FILE} and ${KIT_CHECK_FILE}, then stop.`, undefined, PAGE_THINKING);
      if (!this.project.exists(KIT_FILE) || !this.project.exists(KIT_CHECK_FILE)) throw new Error(r.error || 'the components were not written');
      for (let round = 1; round <= MAX.kitChecks; round++) {
        this.emit({ type: 'kit', status: 'checking', round });
        const { page, times, check: c } = await this.checkKit(items, designed?.look, round);
        // which component a moment shows: the one whose cue it falls in
        const at = (t: number) => items[Math.max(0, page.cues.filter((q) => q.abs <= t + page.start + 0.01).length - 1)]?.name;
        let problems: { name?: string; what: string; fix: string }[] = [], crash: string | undefined;
        // a kit that throws, or calls what the engine does not have, draws nothing at all: every component fails
        const broken = c.issues.filter((i) => BROKEN.includes(i.kind));
        if (c.crash !== undefined || broken.length) { crash = c.crash !== undefined ? crashText(c.crash, 'kit') : broken.map((i) => i.msg).join('\n'); passed = []; }
        else {
          sheet = c.sheet;
          // the sheet is kept with the film's, so the panel can show it
          try { fs.mkdirSync(this.project.file('out/snap'), { recursive: true }); fs.copyFileSync(c.sheet, this.project.file(`out/snap/kit-r${round}.jpg`)); sheet = this.project.file(`out/snap/kit-r${round}.jpg`); } catch {}
          reviewer ??= await this.session('check-kit', reviewerSystem(this.o.style, this.o.brief.styleNotes, designed?.card), MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [VERDICT] });
          const v = await this.verdict(reviewer, kitReviewerPrompt(items, times, round), c.sheet);
          const lint = errorsOf(c.issues).map((i) => ({ name: at(i.local), what: i.msg, fix: 'fix it in the component' }));
          const seen = (v?.pass === false ? v.problems : []).map((p) => ({ name: items.find((x) => p.what.includes(x.name))?.name ?? at(p.at), what: p.what, fix: p.fix }));
          problems = [...lint, ...seen];
          // a problem that names no component (or the whole sheet) holds them all back
          const failing = new Set(problems.map((p) => p.name));
          passed = failing.has(undefined) ? [] : items.map((x) => x.name).filter((n) => !failing.has(n));
          if (!problems.length) break;
        }
        if (round === MAX.kitChecks) break;
        const before = this.project.read(KIT_FILE) + this.project.read(KIT_CHECK_FILE);
        r = await this.send(s, kitFixPrompt(round, problems, crash), sheet ? [sheet] : undefined, PAGE_THINKING);
        if (this.project.read(KIT_FILE) + this.project.read(KIT_CHECK_FILE) === before || r.stopReason === 'max_turns') break;
      }
    } catch (e) {
      if (stopped(e)) throw e;
      passed = [];
      this.emit({ type: 'kit', status: 'failed', detail: (e as Error).message.slice(0, 400) });
    } finally {
      await reviewer?.close();
      await s?.close();
    }
    if (passed.length) {
      const kept = keepComponents(this.project.read(KIT_FILE), passed);
      this.project.write(KIT_FILE, kept);
      fs.mkdirSync(this.project.file('.studio'), { recursive: true });
      fs.writeFileSync(this.project.file(KIT_KEPT), kept);
      this.state.kit = { status: 'done', components: passed };
      freeze(this.o.dir, KIT_FILE);
      this.emit({ type: 'kit', status: 'done', components: passed, sheet });
    } else {
      this.state.kit = { status: 'failed', components: [] };
      this.emit({ type: 'kit', status: 'failed' });
    }
    this.save();
    await this.commit(this.say('本片组件', "This film's components"));
  }

  /** Server-owned META fields, rewritten in place in script.js (the planner must not change them). */
  private setMeta(fields: Record<string, unknown>) {
    let src = this.project.read('script.js');
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const json = JSON.stringify(v);
      const re = new RegExp(`(\\n\\s*)${k}:\\s*(\\{[^\\n]*\\}|\\[[^\\n]*\\]|'[^'\\n]*'|"[^"\\n]*"|[\\d.]+|true|false)\\s*,`);
      src = re.test(src) ? src.replace(re, `$1${k}: ${json},`) : src.replace(/const META = \{/, `const META = {\n    ${k}: ${json},`);
    }
    this.project.write('script.js', src);
  }

  // ── ③ narration ──────────────────────────────────────────────────────────────────────────────
  async narrate() {
    this.emit({ type: 'stage', stage: 'narrate', status: 'start' });
    this.state.stage = 'narrate'; this.save();
    if (!this.o.tts || !this.o.voice) {
      this.state.stage = 'pages'; this.save();
      this.emit({ type: 'stage', stage: 'narrate', status: 'skipped', detail: this.say('这条视频不配音，按估算时长', 'No voice for this film; using estimated timing') });
      return;
    }
    this.serverMeta();
    const r = await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles, onProgress: (e) => this.emit({ type: 'narrate', ...e }) });
    await this.commit(this.say('配音', 'Voice'));
    this.state.stage = 'pages'; this.save();
    this.emit({ type: 'stage', stage: 'narrate', status: 'done', detail: `${r.duration.toFixed(1)}s${r.warnings.length ? '；' + r.warnings.join('；') : ''}` });
  }

  /** the narration on disk was spoken by another voice than the film's (or the film had none until now) */
  voiceStale(): boolean {
    if (!this.o.tts || !this.o.voice) return false;
    let spoken: string | undefined;
    try { spoken = /"speaker":"([^"]*)"/.exec(this.project.read('voice.js'))?.[1]; } catch { /* never narrated */ }
    return spoken !== this.o.voice.speaker;
  }

  /**
   * The film's narration spoken again in its (new) voice. Pages keep their pictures: they follow the lines' times,
   * which the new takes give them. Takes are cached by voice, so going back to a voice used before costs nothing.
   */
  async revoice() {
    if (!this.voiceStale()) return;
    this.emit({ type: 'stage', stage: 'narrate', status: 'start' });
    this.serverMeta();
    const r = await narrate(this.o.dir, { tts: this.o.tts!, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles, onProgress: (e) => this.emit({ type: 'narrate', ...e }) });
    await this.commit(this.say('换配音', 'New voice'));
    this.state.exported = false; this.save();
    this.emit({ type: 'stage', stage: 'narrate', status: 'done', detail: `${r.duration.toFixed(1)}s${r.warnings.length ? '；' + r.warnings.join('；') : ''}` });
    if (this.state.stage === 'done') this.emit({ type: 'ready', duration: (await this.project.timeline()).duration });
  }

  // ── ④ pages ──────────────────────────────────────────────────────────────────────────────────
  async pages(only?: string[]) {
    this.emit({ type: 'stage', stage: 'pages', status: 'start' });
    this.state.stage = 'pages'; this.save();
    // this film's own components, when it has them: loaded before every page (META.extras), and no page's file tools
    // may change them
    if (this.state.kit?.status === 'done') { this.serverMeta(); freeze(this.o.dir, KIT_FILE); }
    const sb = this.project.storyboard();
    const tl = await this.project.timeline();
    const todo = tl.pages.filter((p) => (!only || only.includes(p.id)) && !['ok', 'flagged'].includes(this.state.pages[p.id]?.status ?? ''));
    const failures = (id: string) => this.state.pages[id]?.failures ?? 0;
    this.redraw = new Set(this.o.pages ? todo.filter((p) => failures(p.id) > 0).map((p) => p.id) : []);
    // A run that stopped while pages were in their checks (seen: the server restarted for a deploy): their drafts and
    // conversations are kept, so each picks up at the check it was in. Drawn again from nothing, they were paid twice
    this.inChecks = new Map(todo.flatMap((p) => {
      const was = this.state.pages[p.id];
      return was?.status === 'checking' && was.ref && was.rounds > 0 && !this.state.revision?.[p.id] && this.project.exists(`pages/${p.id}.js`) ? [[p.id, { ref: was.ref, rounds: was.rounds }]] : [];
    }));
    for (const p of todo) this.setPage(p.id, { status: 'queued', rounds: 0, issues: [], failures: failures(p.id) });
    const queue = [...todo];
    const worker = async () => { for (let p = queue.shift(); p && !this.o.signal?.aborted; p = queue.shift()) await this.page(sb, p); };
    // Up to 10 pages at once. Every page session opens with the same long system prompt (the style's component pack).
    // Claude bills writing that prompt to its cache: there the first page goes alone until its first answer is back, so
    // the others find it cached instead of each paying to write it. Providers whose caching costs nothing to fill
    // (Gemini, OpenAI) start every page at once.
    const n = Math.min(this.o.concurrency ?? MAX.pagesAtOnce, MAX.pagesAtOnce, todo.length);
    const m = this.model('page-').runtime.model;
    const paysToCache = m.provider === 'anthropic' || /claude/i.test(m.id);
    const warm = new Promise<void>((ok) => { this.firstTurn = ok; setTimeout(ok, 90_000); });
    const first = worker();
    if (n > 1 && paysToCache) await Promise.race([warm, first]);   // a first page that fails early does not hold the rest back
    // every page is let finish before this ends, a stop included: the run said "paused" when the first page stopped,
    // while the others went on in the background (seen: a paused film with one page still checking itself)
    const settled = await Promise.allSettled([first, ...Array.from({ length: n - 1 }, worker)]);
    const thrown = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    if (thrown) throw thrown.reason;
    this.firstTurn = undefined;
    const bad = Object.entries(this.state.pages).filter(([, s]) => s.status === 'failed');
    const ids = bad.map(([id]) => id);
    this.emit({ type: 'stage', stage: 'pages', status: bad.length ? 'failed' : 'done', detail: bad.length ? this.say(`失败：${ids.join('、')}`, `Failed: ${ids.join(', ')}`) : undefined });
    if (bad.length) throw new Error(this.notDrawn(bad));
    this.state.stage = 'review'; this.save();
  }

  /**
   * Why pages were not drawn, and what to do: the reasons pages share said once, a model service's trouble (key,
   * balance, limits, network) in words the user can act on, and the way forward when the pages themselves defeat it.
   */
  private notDrawn(bad: [string, PageState][]): string {
    const ids = bad.map(([id]) => id), byReason = new Map<string, string[]>();
    for (const [id, s] of bad) { const r = (s.issues[0]?.msg ?? '').split('\n')[0].slice(0, 240); byReason.set(r, [...(byReason.get(r) ?? []), id]); }
    const reasons = [...byReason].map(([r, of]) => (byReason.size > 1 ? `${of.join(this.say('、', ', '))}: ` : '') + (r || this.say('原因不明', 'no reason given')));
    const all = bad.map(([, s]) => s.issues.map((i) => i.msg).join(' ')).join(' ');
    const service = serviceTrouble(all);
    const again = bad.every(([, s]) => (s.failures ?? 0) >= 2);
    const next = service ? this.say(service.zh, service.en)
      : again ? this.say('这几页试了几次都没画成。可以在下面说说这几页想怎么画（比如“p16 画得简单些”），再点继续。', 'These pages failed more than once. Say below how they should look (say, "keep p16 simple"), then continue.')
      : this.o.pages ? this.say('点继续，会换用更强的模型重画这几页。', 'Continue, and a stronger model draws these pages again.')
      : this.say('点继续，会重画这几页。', 'Continue, and these pages are drawn again.');
    return this.say(`这些页没有画出来：${ids.join('、')}。原因：${reasons.join('；')}\n${next}`, `These pages were not drawn: ${ids.join(', ')}. Why: ${reasons.join('; ')}\n${next}`);
  }

  private setPage(id: string, s: PageState, extra: { sheet?: string; thumb?: string; note?: string } = {}) {
    this.state.pages[id] = s; this.save();
    this.emit({ type: 'page', id, status: s.status, round: s.rounds, issues: s.issues, ...extra });
  }

  /** moments worth looking at: right after the page turns, each beat in progress, and the settled end (on the film's
   *  last page, the hold after its last line, before the film fades out) */
  private sheetTimes(sb: Storyboard, t: PageTiming) {
    const beats = sb.pages.find((p) => p.id === t.id)?.beats || [];
    const cueAt = (at: string) => { const m = /^c(\d+)/.exec(at); const c = t.cues[Math.min(+(m?.[1] ?? 0), t.cues.length - 1)]; return c ? t.start + c.at : t.start; };
    const last = sb.pages[sb.pages.length - 1]?.id === t.id;
    const settled = last ? Math.max(t.speechEnd, t.end - 1.2) : t.end - 0.35;
    const raw = [t.start + 0.6, ...beats.map((b) => cueAt(b.at) + 1.0), settled].map((x) => Math.min(last ? settled : t.end - 0.2, Math.max(t.start + 0.4, x))).sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of raw) if (!out.length || x - out[out.length - 1] > 0.6) out.push(x);
    while (out.length > 6) out.splice(Math.floor(out.length / 2), 1);
    return out.map((abs) => ({ t: abs, local: abs - t.start }));
  }

  /**
   * The reviewer's verdict on a page's sheet; undefined when it gives none (asked twice) or its model fails: the page
   * then stands on its lint alone, as a review that cannot be had must not hold the film.
   */
  private async verdict(reviewer: AgentSession, prompt: string, sheet: string): Promise<{ pass: boolean; problems: Problem[] } | undefined> {
    try {
      let r = await this.send(reviewer, prompt, [sheet], REVIEWER_THINKING);
      if (!r.answers.length && r.stopReason === 'done') r = await this.send(reviewer, verdictAgain, undefined, REVIEWER_THINKING);
      const a = r.answers.find((x) => x.name === VERDICT.name)?.args as { pass: boolean; problems: Problem[] } | undefined;
      return a && { pass: a.pass, problems: a.pass ? [] : a.problems };
    } catch (e) {
      if (stopped(e)) throw e;
      return undefined;
    }
  }

  private async page(sb: Storyboard, t: PageTiming) {
    const id = t.id;
    const was = this.inChecks.get(id);
    const st: PageState = { status: 'drawing', rounds: 0, issues: [], failures: this.state.pages[id]?.failures };
    this.setPage(id, st);
    let s: AgentSession | undefined;
    try {
      s = await this.session(`page-${id}`, pageSystem(this.o.style, styleExtras(this.o.style), this.o.brief.preferences, this.o.brief.styleNotes, this.designed()?.card, this.filmKit()), MAX.pageTurns, was?.ref, undefined, { answers: [FLAG] });
      const fix = this.state.revision?.[id];
      // a revision's page already exists, so "is there a file" says nothing: what tells is whether the code changed
      // (seen: a revision whose edits never landed was checked, passed and shown as done, on the old page)
      const before = fix && !this.wordsChanged ? this.project.read(`pages/${id}.js`) : undefined;
      const unchanged = () => before !== undefined && this.project.read(`pages/${id}.js`) === before;
      let r: TurnResult | undefined, declined: string | undefined;
      if (!was) {
        r = await this.send(s, pagePrompt(sb, id, t, this.o.brief.lang, this.o.brief.replyLang, !!fix, this.o.brief.brand) + (fix ? revisionNote(id, fix, this.project.read(`pages/${id}.js`)) : '') + this.unseen(`page-${id}`), undefined, PAGE_THINKING);
        if (!this.project.exists(`pages/${id}.js`)) r = await this.send(s, `pages/${id}.js does not exist yet; write it, then stop.`, undefined, PAGE_THINKING);
        if (!this.project.exists(`pages/${id}.js`)) throw new Error(r.error || this.say('没有写出页面文件', 'No page file was written'));
        // the agent found nothing to change (already so, or nothing this page can do): it says why instead of searching
        declined = unchanged() && flagOf(r) !== undefined ? flagOf(r)!.trim() || this.say(NOT_MADE.zh, NOT_MADE.en) : undefined;
        if (declined) { st.status = 'flagged'; st.issues = [{ from: 'agent', msg: declined }]; }
        else if (unchanged()) r = await this.send(s, `pages/${id}.js is exactly as it was: the change was not made${r.error ? ` (${r.error})` : ''}. Make it now with edit. If an edit failed, its old_string must be copied exactly from the current file; read the file first if unsure.`, undefined, PAGE_THINKING);
      }
      st.ref = s.ref;
      if (!was) await this.commit(this.say(`${id}：初稿`, `${id}: first draft`));
      // Each round: the page is checked (lint and a contact sheet, one browser) and a reviewer that did not draw it looks
      // at the sheet. The page is done when the reviewer passes it and lint has no error; otherwise the problems go back
      // to its agent, and the page is checked again. `checked`: the page's code as it was at the last check, and
      // `issues` / `verdict` what that check found
      const code = () => this.project.read(`pages/${id}.js`);
      let issues: LintIssue[] = [], verdict: { pass: boolean; problems: Problem[] } | undefined, checked: string | undefined;
      let reviewer: AgentSession | undefined;
      const checks = fix ? MAX.revisionChecks : MAX.pageChecks;
      try {
        for (let round = was?.rounds ?? 1; !declined && round <= checks; round++) {
          st.status = 'checking'; st.rounds = round; this.setPage(id, st);
          this.keepKit();
          const times = this.sheetTimes(sb, t);
          const c = await this.project.check(id, `${id}-r${round}`, times.map((x) => x.t), { determinism: true, lintMs: MAX.pageLintMs });
          checked = code(); issues = c.issues; verdict = undefined;
          // a page that throws, or will not draw in the browser (seen: "h1.hide is not a function" logged, then the
          // screenshot timed out), cannot be looked at: that is the first thing to fix, so it goes back to its agent
          // instead of failing the page (on the last round too: the settling check below decides)
          if (c.crash !== undefined) {
            const crash = crashText(c.crash, id);
            this.setPage(id, { ...st, issues: [{ from: 'run', kind: 'crash', msg: crash }] });
            r = await this.send(s, crashPrompt(id, crash) + this.unseen(`page-${id}`), undefined, PAGE_THINKING);
            await this.commit(this.say(`${id}：修运行错误`, `${id}: fix a runtime error`));
            continue;
          }
          this.setPage(id, { ...st, issues: issues.map(fromLint) }, { sheet: c.sheet });
          const change = unchanged() ? fix : undefined;
          reviewer ??= await this.session(`check-${id}`, reviewerSystem(this.o.style, this.o.brief.styleNotes, this.designed()?.card) + kitReviewNote(this.kitItems()), MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [VERDICT] });
          verdict = await this.verdict(reviewer, reviewerPrompt(sb, id, t, round, issues, times, change, this.o.brief.brand), c.sheet);
          const errors = errorsOf(issues), problems = verdict?.pass === false ? verdict.problems : [];
          if (!errors.length && !problems.length) { st.status = 'ok'; st.issues = []; break; }
          if (round === checks) break;
          r = await this.send(s, fixPrompt(round, errors, problems, times, change) + this.unseen(`page-${id}`), [c.sheet], PAGE_THINKING);
          await this.commit(this.say(`${id}：第 ${round} 轮修改`, `${id}: check round ${round}`));
          const reason = flagOf(r);
          if (reason !== undefined) { st.status = 'flagged'; st.issues = [{ from: 'agent', msg: reason }]; break; }
          // nothing changed this round: checking it again would show the same thing
          if (code() === checked || r.stopReason === 'max_turns') break;
        }
      } finally {
        await reviewer?.close();
      }
      // settled on the last check: what it found stands, unless the code changed after it (a fix of a crash, or a
      // page left with a flag after an edit), which is linted once more without pictures
      if (code() !== checked && !declined) {
        issues = await this.project.lint([id], [], MAX.pageLintMs).catch((e) => { throw stopped(e) ? e : new Error(crashText((e as Error).message, id)); });
        verdict = undefined;
      }
      // still throwing, or calling what the engine does not have: the page is not drawn, whatever else it shows
      const broken = issues.filter((i) => BROKEN.includes(i.kind));
      if (broken.length) throw new Error(broken.map((i) => i.msg).join('\n'));
      if (st.status !== 'ok' && st.status !== 'flagged') {
        const errors = errorsOf(issues), problems = verdict?.pass === false ? verdict.problems : [];
        st.status = errors.length || problems.length ? 'flagged' : 'ok';
        st.issues = [...errors.map(fromLint), ...problems.map(fromReview)];
      }
      // the change never landed: the page is as it was, which is not what the user asked for, whatever the checks said
      if (unchanged()) {
        if (!declined) { st.status = 'flagged'; st.issues = [{ from: 'run', kind: 'not-made', msg: NOT_MADE.en }]; }
        this.unchanged.set(id, declined);
      }
      await s.close();
      // one settled frame as the film-strip thumbnail (the check sheets are 4-up and read as noise at tile size)
      let thumb: string | undefined;
      try { thumb = await this.project.snap(`${id}-thumb`, [Math.max(t.start + 0.5, t.end - 0.4)], [id], 480, false); } catch (e) { if (stopped(e)) throw e; }
      this.setPage(id, st, { thumb });
    } catch (e) {
      if (stopped(e)) throw e;
      // what the model service said last, when the page then failed for want of an answer
      const said = s && this.lastError.get(s), msg = (e as Error).message;
      this.setPage(id, { ...st, status: 'failed', issues: [{ from: 'run', kind: 'failed', msg: said && !msg.includes(said) ? `${msg} (${said})` : msg }], failures: (st.failures ?? 0) + 1 });
    }
  }

  // ── ⑤ review ─────────────────────────────────────────────────────────────────────────────────
  async review() {
    this.emit({ type: 'stage', stage: 'review', status: 'start' });
    this.state.stage = 'review'; this.save();
    const defectsOnly = this.o.review === 'defects';
    const all = await this.project.lint(undefined, ['--determinism']);
    // defects: a frame that differs by where playback came from (it flickers), or page code that fails; a full review
    // also takes what is plainly wrong on screen, never lint's advice (a sparse or wordy page is the pages' own call)
    const issues = all.filter((i) => DEFECTS.includes(i.kind) || (!defectsOnly && i.level === 'error'));
    // a page a change left as it was, with the agent's reason (already so, nothing to do there), is no defect to chase
    const flagged = defectsOnly ? [] : Object.entries(this.state.pages).filter(([id, s]) => s.status === 'flagged' && !this.unchanged.get(id)).map(([id, s]) => `${id} (${s.issues.map((i) => ('at' in i ? `${i.at.toFixed(1)}s: ` : '') + i.msg).join('; ')})`);
    if (!issues.length && !flagged.length) {
      this.emit({ type: 'stage', stage: 'review', status: 'skipped', detail: this.say('全片检查通过，各页自检通过', 'The whole film passed its checks, and every page passed its own') });
      return this.ready();
    }
    const tl = await this.project.timeline();
    const sheet = await this.project.snap('review', tl.pages.flatMap((p) => [(p.start + p.end) / 2, p.end - 0.35]), undefined, 400);
    // defects mode stops on a timer of its own, keeping what it fixed so far; a stop by the user still stops the run
    const limit = defectsOnly ? new AbortController() : undefined;
    const timer = limit && setTimeout(() => limit.abort(), MAX.reviewDefectsMs);
    const signal = limit ? AbortSignal.any([limit.signal, ...(this.o.signal ? [this.o.signal] : [])]) : this.o.signal;
    const s = await this.session('review', pageSystem(this.o.style, styleExtras(this.o.style), this.o.brief.preferences, this.o.brief.styleNotes, this.designed()?.card, this.filmKit()), MAX.pageTurns, undefined, signal);
    let timedOut = false;
    try {
      for (let round = 1; round <= (defectsOnly ? 1 : MAX.reviewRounds); round++) {
        await this.send(s, reviewPrompt(round === 1 ? issues : errorsOf(await this.project.lint()), flagged, this.o.brief.replyLang), [sheet]);
        // a round that changed nothing found nothing to change: another would see the same
        if (!(await this.commit(this.say(`全片检查：第 ${round} 轮`, `Whole-film check: round ${round}`)))) break;
      }
    } catch (e) {
      if (!limit?.signal.aborted || this.o.signal?.aborted) throw e;
      timedOut = true;
      await this.commit(this.say('全片检查：到时间了', 'Whole-film check: time limit'));
    } finally {
      clearTimeout(timer);
      await s.close();
    }
    this.emit({ type: 'stage', stage: 'review', status: 'done', ...(timedOut ? { detail: this.say('全片检查到了时间上限，已保留改好的部分', 'The whole-film check reached its time limit; what it fixed is kept') } : {}) });
    return this.ready();
  }

  /** drawn and checked: the live preview is the film. Rendering an mp4 waits for an export */
  private async ready() {
    this.beforeReady?.(); this.beforeReady = undefined;
    this.state.stage = 'done'; this.save();
    this.emit({ type: 'ready', duration: (await this.project.timeline()).duration });
  }

  // ── ⑥ render (export) ────────────────────────────────────────────────────────────────────────
  /** the film as mp4, on export. The stage is left as it was: exporting is not a step of making the film */
  async render(o: { workers?: number } = {}) {
    this.emit({ type: 'stage', stage: 'render', status: 'start' });
    this.serverMeta();
    // a narrated film must carry its narration: check before spending minutes on frames
    if (this.o.voice && !/\bvoice:\s*\{/.test(this.project.read('script.js'))) this.fail('render', this.say('口播脚本里丢了配音设置，已停止渲染', 'The narration script lost its voice settings; rendering stopped'));
    const out = await this.project.render({ workers: o.workers, signal: this.o.signal, onLine: (line) => { if (!/^\[(chunk|seg)-/.test(line)) this.emit({ type: 'render', line }); } })
      .catch((e: Error) => {
        // render.mjs draws a share again when its browser stops answering; a second stall ends the export, in words
        if (/stopped answering twice/.test(e.message)) throw new Error(this.say('浏览器两次没有响应，导出停下了。再导出一次通常就好，已经画好的片段会直接用上', 'The browser stopped responding twice, so the export stopped. Exporting again usually works, and the parts already drawn are reused'));
        throw e;
      });
    const duration = await this.project.duration(out.withSubs);
    this.state.video = out.withSubs; this.state.exported = true; this.save();
    const saved = this.saveCopies(out);
    this.emit({ type: 'stage', stage: 'render', status: 'done' });
    this.emit({ type: 'done', video: out.withSubs, videoNoSubs: out.noSubs, duration, saved,
      ...(out.segments ? { segments: out.segments } : {}), ...(out.backend ? { backend: out.backend } : {}), ...(out.fallback ? { fallback: out.fallback } : {}) });
    // the film gate reads the whole mp4 (several seconds): it is reported once the film is handed over, never holding it
    this.project.gate(out.withSubs).then((g) => this.emit({ type: 'gate', red: g.red, blank: g.gates.find((x) => x.key === 'blank')?.value ?? [], report: g.report.map((r) => ({ name: r.name, value: r.value, unit: r.unit })) }), () => {});
    return out;
  }

  /** both films copied into the export folder, replacing an earlier export of the same name; a folder that can't be
   * written is said, and the export still stands (the films are in the project) */
  private saveCopies(out: { withSubs: string; noSubs: string }) {
    const dir = this.o.exportDir;
    if (!dir) return undefined;
    try {
      fs.mkdirSync(dir, { recursive: true });
      // the film is read through a checked descriptor (never through a link the agent's shell planted in out/)
      const copy = (f: string) => {
        const to = path.join(dir, path.basename(f));
        const src = openIn(this.o.dir, f);
        try {
          const dst = fs.openSync(to, 'w');
          try {
            const b = Buffer.allocUnsafe(1 << 20);
            for (let pos = 0, n; (n = fs.readSync(src.fd, b, 0, b.length, pos)); pos += n) for (let off = 0; off < n;) off += fs.writeSync(dst, b, off, n - off);
          } finally { fs.closeSync(dst); }
        } finally { fs.closeSync(src.fd); }
        return to;
      };
      return { withSubs: copy(out.withSubs), noSubs: copy(out.noSubs) };
    } catch (e) {
      this.emit({ type: 'error', message: this.say(`没能存到导出位置 ${dir}：${(e as Error).message}。片子还在项目里，可以直接下载`, `Couldn't save to the export folder ${dir}: ${(e as Error).message}. The film is still in the project and can be downloaded`) });
      return undefined;
    }
  }

  /**
   * A change to a finished film: the planner decides which pages it touches and how, those pages are redrawn from their
   * current code, then the film is checked again and plays in the preview. Everything else is kept as it is; the mp4
   * waits for the next export.
   */
  async revise(request: string) {
    const t0 = Date.now();
    const script = this.project.read('script.js');
    this.state.change = request; this.save();
    const sb = this.project.storyboard();
    const named = sb.pages.filter((p, i) => new RegExp(`\\b${p.id}\\b|第\\s*${i + 1}\\s*页|\\bpage\\s*${i + 1}\\b`, 'i').test(request)).map((p) => p.id);
    // a change to the picture of the page(s) it names needs no planning: it goes straight to those pages' agents.
    // Anything that may touch the words (narration, subtitles, timing), or names no page, is planned first
    // (not 讲 or 说: 「讲 ABC 的那部分」 points at a picture, and sent a centering fix through a minute of planning)
    // the user's own words, in either language
    const words = /口播|文案|台词|配音|字幕|旁白|这句|句子|念|时长|节奏|\b(narrat\w*|script|voice\w*|subtitles?|captions?|wording|sentences?|timing|pac(e|ing))\b/i;
    const direct = named.length > 0 && named.length <= 2 && !words.test(request.replace(/<references>[\s\S]*?<\/references>/, ''));
    let plan: { pages: { id: string; note: string }[] } | undefined = direct ? { pages: named.map((id) => ({ id, note: request })) } : undefined;
    if (!plan) {
      this.emit({ type: 'note', text: this.say('收到，我先看看要改哪几页', 'Got it. Let me see which pages this touches') });
      await this.planRevision(request, sb, named);
      try { plan = JSON.parse(this.project.read('.studio/revision.json')); } catch { this.fail('pages', this.say('导演没有写出修改计划', 'The director did not write a plan for the change')); }
    }
    const tPlan = Date.now();
    // a change to the narration can leave a page's code as it is (its timing follows the script): only a change to the
    // picture must show in the page's code
    this.wordsChanged = this.project.read('script.js') !== script;
    const ids = plan!.pages.map((p) => p.id).filter((id) => sb.pages.some((p) => p.id === id));
    if (!ids.length) this.fail('pages', this.say('修改计划里没有可以改的页', 'The plan for the change names no page to change'));
    const nums = ids.map((id) => sb.pages.findIndex((p) => p.id === id) + 1);
    const which = this.say(nums.map((n) => `第 ${n} 页`).join('、'), (nums.length > 1 ? 'pages ' : 'page ') + nums.join(', '));
    this.emit({ type: 'note', text: direct ? this.say(`直接改${which}的画面，其余的保持不变`, `Changing the picture on ${which}; everything else stays as it is`) : this.say(`要重画${which}，其余的保持不变`, `Redrawing ${which}; everything else stays as it is`) });
    this.serverMeta();
    if (this.o.tts && this.o.voice) await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles });   // cached pages cost nothing
    this.state.revision = Object.fromEntries(plan!.pages.map((p) => [p.id, p.note]));
    this.state.exported = false;
    for (const id of ids) this.state.pages[id] = { status: 'queued', rounds: 0, issues: [] };
    this.state.stage = 'pages'; this.save();
    const tDraw = Date.now();
    await this.pages(ids);
    this.state.revision = undefined; this.save();
    const tPages = Date.now();
    // pages the change never reached are said plainly, not left to a film that looks done: why, when the agent said
    const num = (id: string) => sb.pages.findIndex((p) => p.id === id) + 1;
    for (const [id, why] of this.unchanged) if (why) this.emit({ type: 'note', text: this.say(`第 ${num(id)} 页没有改：${why}`, `Page ${num(id)} was not changed: ${why}`) });
    const missed = [...this.unchanged].filter(([, why]) => !why).map(([id]) => num(id));
    if (missed.length) this.emit({ type: 'note', text: this.say(`${missed.map((n) => `第 ${n} 页`).join('、')}没有改上，画面还是原来的。换个说法再告诉我一次？`, `${missed.length > 1 ? 'Pages' : 'Page'} ${missed.join(', ')} did not change; the picture is as it was. Could you ask again in other words?`) });
    // where the time went, in one line, so a slow step is seen (and can be fixed) instead of only felt
    const sec = (ms: number) => this.say(`${Math.max(1, Math.round(ms / 1000))} 秒`, `${Math.max(1, Math.round(ms / 1000))} s`);
    this.beforeReady = () => this.emit({ type: 'note', text: this.say(
      `这次改了 ${sec(Date.now() - t0)}：${direct ? '' : `想怎么改 ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `配音 ${sec(tDraw - tPlan)} · ` : ''}画和自检 ${sec(tPages - tDraw)} · 全片检查 ${sec(Date.now() - tPages)}`,
      `This change took ${sec(Date.now() - t0)}: ${direct ? '' : `planning ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `voice ${sec(tDraw - tPlan)} · ` : ''}drawing and checks ${sec(tPages - tDraw)} · whole-film check ${sec(Date.now() - tPages)}`) });
    await this.review();
    this.unchanged.clear();
    this.state.change = undefined; this.save();
  }
  /** pages a revision left as they were, with the agent's reason when it gave one */
  private unchanged = new Map<string, string | undefined>();
  /** the revision in progress changed script.js */
  private wordsChanged = false;
  /** said just before the film is ready again (a revision's time line) */
  private beforeReady?: () => void;
  /** resolves the wait for the first page's first answer (the shared prompt is cached by then) */
  private firstTurn?: () => void;
  /** pages drawn again after failing, by the film's own model */
  private redraw = new Set<string>();
  /** pages the last run left in their checks: the conversation to resume, and the check round it was in */
  private inChecks = new Map<string, { ref: string; rounds: number }>();
  /** each session's last error from its model service */
  private lastError = new WeakMap<AgentSession, string>();

  /** the planner's half of a revision: which pages, and what to change on each (written to .studio/revision.json) */
  private async planRevision(request: string, sb: Storyboard, named: string[]) {
    // a fresh, small session per change: resuming the planner would carry the whole making of the film (slow, and every
    // token of it re-read); the files hold everything this decision needs
    const s = await this.session('reviser', plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand), MAX.planTurns);
    fs.rmSync(this.project.file('.studio/revision.json'), { force: true });   // last change's plan is not this one's
    // hand over what the decision needs up front (the script, and the code of the pages the request names) — reading
    // them file by file costs a model round trip each
    const code = named.map((id) => `pages/${id}.js:\n\`\`\`js\n${this.project.read(`pages/${id}.js`)}\n\`\`\``).join('\n\n');
    await this.send(s, `The film is finished. The user's change to it:
${request}

Decide which pages to change and how: change only the pages that need it (usually 1–2). Touch script.js only when the user asks to change the narration; then change the matching cues and keep their number the same.
${[voiceNote('revise', this.o.brief.voice), langNote('revise', this.o.brief.lang, this.o.brief.replyLang).trim()].filter(Boolean).join('\n')}
Write the decision to .studio/revision.json: { "pages": [{ "id": "p03", "note": "the change for the page agent, down to objects and actions" }] }, then tell the user in one sentence what you will change.
The storyboard and script.js${named.length ? ' and the code of the pages mentioned' : ''} are given below; don't read them again. Read pages/<id>.js for other pages only if you need to.
You decide only which pages change and what they should become; the page agent writes the code. Don't look into the engine, take screenshots or run tools. When the user points at a page (a page in <references>), that is usually the page to change.

Storyboard: ${sb.pages.map((p) => `${p.id} ${p.section}: ${p.say}`).join('\n')}

script.js:
\`\`\`js
${this.project.read('script.js')}
\`\`\`${code ? `\n\n${code}` : ''}`);
    await s.close();
  }

  /** Whole run. `approve` is called with the storyboard and resolves with optional feedback (the user's edits). */
  async run(approve: (sb: Storyboard) => Promise<string | undefined> = async () => undefined) {
    // a change that stopped while it was still being planned: the film is done, so only the change has anything left to do
    if (this.state.stage === 'done' && this.state.change) return this.revise(this.state.change);
    // a switch of voice that stopped before the film was narrated again: finish it
    if (this.state.stage === 'done' && this.voiceStale()) return this.revoice();
    if (this.state.stage === 'storyboard') { await this.research(); await this.storyboard(); }
    if (this.state.stage === 'approval') await this.script(await approve(this.project.storyboard()));
    if (this.state.stage === 'script') await this.script();
    // this film's own components are written while it is narrated (they need the storyboard, not the timing)
    if (this.state.stage === 'narrate') await both(this.narrate(), this.kit());
    if (this.state.stage === 'pages' && !this.state.kit) await this.kit();   // a run that stopped before its kit was done
    // the voice was changed after the narration was made (while paused): narrate again before going on
    if ((this.state.stage === 'pages' || this.state.stage === 'review') && this.voiceStale()) await this.revoice();
    if (this.state.stage === 'pages') await this.pages();
    if (this.state.stage === 'review') await this.review();
    if (this.state.stage === 'render') await this.ready();   // a run saved before exports were separate: it is ready to preview
    if (this.state.change) { this.state.change = undefined; this.save(); }
  }

  /** the exported mp4 if it shows the film as it is now */
  get exported(): string | undefined { return this.state.exported !== false && this.state.video ? this.state.video : undefined; }
}

export const projectFile = (dir: string, rel: string) => path.join(dir, rel);
