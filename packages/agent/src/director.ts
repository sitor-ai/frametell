// The director: runs a project through its stages. The model writes; the orchestrator checks. Storyboard lint, page
// lint and contact sheets are produced here and handed to the agent, so the quality bar doesn't depend on the model
// remembering to look. Every change is committed; state is persisted so an interrupted run resumes where it stopped.
import fs from 'node:fs';
import path from 'node:path';
import { narrate, type TtsProvider } from '@frametell/voice';
import { Project, childCmd, projectFiles, type LintIssue, type LintKind, type PageTiming, type Storyboard, type Renderer } from './project.js';
import { FLAG, canvasSection, KIT_CHANGE, langTag, ROUTE, VERDICT, fixPrompt, laneNote, kitChangeAsk, kitChangePrompt, kitChangeSystem, kitFixPrompt, kitPrompt, kitReviewNote, kitReviewerPrompt, kitSystem, langNote, voiceNote, pagePrompt, pageSystem, plannerSystem, replyNote, reviewPrompt, reviewerPrompt, reviewerSystem, routeAsk, routeSystem, scriptPrompt, storyboardFixPrompt, storyboardPrompt, verdictAgain, type Brief, type CreditFacts, type FilmFacts, type Problem } from './prompts.js';
import { KIT_CHECK_FILE, KIT_FILE, KIT_KEPT, kitCell, kitCheckPage, kitIssues, kitLocate, kitPart, kitPartCheck, kitPlan, kitStage, kitTimes, kitWanted, type KitItem, type KitPart } from './kit.js';
import { drawingSession, sourceReading } from './anomaly.js';
import { addUsage, emptyUsage, type AgentRuntime, type AgentSession, type SessionOptions, type Thinking, type TokenUsage, type TurnResult } from './runtime/types.js';
import type { PageIssue, PageStatus, Stage, StudioEvent } from './events.js';
import { designedFonts, designedIssues, designedLook, type Look } from './look.js';
import { BRAND_DIR, SIGN_OFF_HOLD, cornerMark, signsOff } from './brand.js';
import { assetPath, assetsOn, userAssets } from './assets.js';
import { inkScript } from './ink.js';
import { choose, type Decider } from './decide.js';
import { CAST, PICTURES_DIR, PICTURES_MANIFEST, cutOut, inkPath, cutOutTrouble, lookPrefix, pictureFile, pictureIssues, pictureKey, ledPage, picturePageNote, picturePath, picturePlan, picturePlanNote, picturePrompt, pictureReviewNote, pictureSize, pictureStyle, picturesOn, readPictures, sniffPicture, type ImageProvider, type Picture, type PicturePlan, type Pictures, type RefMode } from './pictures.js';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { freeze, openIn, readIn, writeIn } from './projectfs.js';
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
   * each page's own checks: 'full' (the default) is lint and the reviewer, up to two rounds of fixes; 'hard' is lint
   * alone, and one round of fixes for what a viewer would see broken (HARD), never for advice. Measured 2026-10-25 on
   * production (2,138 pages): the rounds after the first draft were 53% of a page's time and 29% of its cost, and most
   * of them moved text a few pixels
   */
  pageChecks?: 'full' | 'hard';
  /**
   * research before the storyboard, on its own (cheaper) model: what the request points at is read, and the web
   * searched when `search`; the brief becomes materials/research.md. Absent: no research
   */
  research?: { runtime: AgentRuntime; prices?: Prices; web: Web; sources: Sources; search: boolean; limits?: Partial<ResearchLimits> };
  /** draws the film's generated pictures (pictures.ts), for a style that allows them. Absent: no pictures, and the
   *  storyboard is never told it may ask for any */
  images?: ImageProvider;
  /** sorts a change the user asks for into its route (decide.ts). Absent: every change is planned */
  decide?: Decider;
  /** false: the pages are drawn all at once. Otherwise the first page is drawn alone and the run waits at it (as at the
   *  storyboard) for the user to confirm the film's look, or say what to change, before the rest are drawn */
  firstPage?: boolean;
  /** how long the first page waits for the user before the rest is drawn in its look (said with the wait: goOnAt);
   *  whoever holds the run does the going on (a runner's timer, a host's sweep). Absent: it waits */
  firstPageWaitMs?: number;
  /** how long the storyboard waits for the user before a panel they left open on it goes ahead (said with the wait:
   *  goOnAt). Absent: no countdown */
  storyboardWaitMs?: number;
  /** the run's log ends at the first page's wait (a run picked up again there): it is not said a second time. Absent:
   *  a run picked up while the first page waits says so again, as the log has moved on (a pause, a new voice) */
  firstPageSaid?: boolean;
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
  /** this film's generated pictures (pictures.ts) were drawn after the go-ahead (those that could be), or none were asked */
  pictures?: 'done' | 'none';
  /** the first page waits for the user to confirm the look before the others are drawn, or they did */
  firstPage?: 'waiting' | 'done';
  /** the lanes drawing the pages now: each one's session name, its transcript (project-relative) and the pages it has
   *  to draw, so a run that stops (a pause, credits, a lost box) goes on in the same conversations, not new ones */
  lanes?: SavedLane[];
}
interface SavedLane { name: string; file: string; pages: string[] }

/** pieces of work side by side: all run to the end, and the first failure is thrown once all have */
async function both(...work: Promise<unknown>[]) {
  const r = await Promise.allSettled(work);
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
  const at = lines.filter((l) => l.includes(`pages/${id}.js`) || /engine\/(runtime|lib)\/|extras\/[\w./-]+\.js:\d/.test(l)).map((l) => l.replace(/^.*?((pages|engine|extras)\/[^\s)]+).*$/, '$1')).slice(0, 4);
  return [err.replace(/ at file:\/\/\S+/, ''), ...at.map((a) => `  at ${a}`)].join('\n').slice(0, 800);
}

const crashPrompt = (id: string, crash: string) => `pages/${id}.js throws when it runs, so it cannot be checked with screenshots yet:
${crash}
Fix this error first: it is most likely a call to a function that does not exist, or wrong arguments. Go by this film's components and worked example, never guess the engine's API. Fix it with edit, all edits in one reply, each with finish: true: the round ends once they apply, no reply needed.`;

/** the planner's conversation, carried on after its run was cut short (a lost box, a restart): it goes on from where it
 *  was, never from the top (2026-10-29: a storyboard begun again from nothing cost more than the first try) */
const storyboardResumed = (written: boolean) => `The run was interrupted while you worked and has now resumed: this conversation is where you left off, and the project's files are as you left them. ${written ? 'storyboard.json is on disk as you last wrote it.' : 'storyboard.json has not been written yet.'} Carry on from there: don't read again what you have already read and don't start the storyboard over; finish it, then stop and report.`;
/** an earlier planner's storyboard.json, found with no conversation to carry on (it did not travel): finished, not redone */
const storyboardFound = `

An earlier run was cut short after it began storyboard.json, which is on disk. Read it first and finish it: keep what is there and done well, complete what is missing and fix what is wrong, rather than writing it again from the start.`;
/** a lane going on in its own conversation after its run stopped, with the page it is on next */
const laneResumed = (id: string, begun: boolean) => `The run was stopped and has now resumed in this same conversation; the project's files are as they were. ${begun ? `pages/${id}.js is on disk as you left it: finish it rather than starting it over.` : ''}

`;

/**
 * A page that already works, changed: the current code is handed over, and the change is made with targeted edits.
 * Rewriting a 300-line page to change one thing is minutes of output (seen: 10k tokens, 3 minutes, for a title).
 */
const revisionNote = (id: string, fix: string, code: string, first = false) => `

This page is a **revision**: ${first ? 'it is the film\'s first page, drawn before the others for the user to see the look, and they' : 'the film is finished and the user'} asked for a change to this page. The change: ${fix}
Here is the current pages/${id}.js; it is already given, so don't read it again:
\`\`\`js
${code}
\`\`\`
Change only what needs changing, with edit; **never rewrite the whole file with write**. **Put all the edits in one reply** (one reply can call edit several times), each with finish: true, and **open that reply with one short sentence for the user**, in the language you reply in, saying what you change on screen (such as "标题放大到 72 号" or "The title is now twice as large"): it is shown to them as what this change did. You're done once the edits apply, no reply after them and no need to read the file again; the check screenshots will show the result.
If this page already shows the change, or the change says nothing this page can do, don't go looking for what was meant (other files, the film's history, other folders): change nothing and call flag with one sentence for the user, in the language you reply in, saying what you found.`;

/** the user's notes so far, which outrank the storyboard (Director.directions) */
const directionsNote = (all: string[]) => all.length ? `

The user's directions for this film, in the order given (where they differ from the storyboard, they win; follow those that concern this page):
${all.map((n) => `- ${n}`).join('\n')}` : '';

/** a page the change adds (the planner put it in the storyboard): it has no code yet, so it is drawn like any new page */
const addedNote = (fix: string) => `

This page is new: the film is finished and the user's change adds it. What it should be: ${fix}`;

// Pages are drawn at low thinking, drafts and check rounds alike; on a gateway's …-high model that means its …-low
// sibling. Most of a page's time and cost was the model thinking before writing: on the same pages a -high draft took
// 170–220 s and a -medium one 37–74 s, with no worse a page; at medium a page still wrote ~8k output tokens for ~1k of
// code, most of it thought, and low draws pages as good for a fraction of it.
/** the largest picture attached to a page's brief, as the read tool's limit */
const PICTURE_BYTES_SHOWN = 3_700_000;
const PAGE_THINKING: Thinking = 'low';
/** the storyboard, the narration and a change's plan, at medium: in a blind test of six films (2026-11-08) medium plans
 *  won five of six on content (a concrete hook, an ending that answers it, sharper examples) for ~$0.05 and ~15 s more a
 *  film; a 2026-10-29 note had medium storyboards at ~$1 and 5½ minutes, which the test didn't see again */
const PLAN_THINKING: Thinking = 'medium';
/** the film's components: a few small drawings every page is waiting on (at medium, one kettle took 44k tokens and
 *  7½ minutes of thought); the kit's check and reviewer catch what a quicker draft gets wrong */
const KIT_THINKING: Thinking = 'low';
/** pages one artist session draws, one after the other (a lane): it opens once (its prompt written to the cache once,
 *  read after that) and sees the pages it drew, so they match without a film kit. A film of up to this many pages is one
 *  lane, carrying on from the first page's session; a longer one is split into lanes side by side (a session per page wrote
 *  the same long prompt to the cache once a page, a large share of what a short film cost) */
const PAGES_PER_LANE = 6;
export const laneCount = (pages: number) => Math.max(1, Math.ceil(pages / PAGES_PER_LANE));
/** `items` cut into `n` runs in order, as even as they go (7 in 2 → 4 + 3) */
export function lanesOf<T>(items: T[], n: number): T[][] {
  const size = Math.ceil(items.length / Math.max(1, n));
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}
/** a session's turns over its whole life against what it may take (Director.allow; Infinity: no budget), and whether
 *  running out was said */
interface Budget { name: string; used: number; limit: number; said?: boolean }
/** a lane: its session (opened with its first page), the page it is on, and whether it has drawn one already.
 *  `again`: a lane of a run that stopped, going on in its own transcript (its next message says so, once) */
interface Lane { name: string; resume?: string; s?: AgentSession; cur: string; drawn: boolean; again?: boolean }

/** components one kit session writes, one after the other: a session's first turn writes its whole prompt to the cache
 *  (~9k tokens, 2026-10-28), so two to a session halve that, and the pages wait on two short components at most */
const KIT_PER_SESSION = 2;
/** `items` in groups of at most `n`, as even as they go (3 → 2 + 1, 5 → 2 + 2 + 1) */
export function kitGroups<T>(items: T[], n: number): T[][] {
  const count = Math.ceil(items.length / n);
  return Array.from({ length: count }, (_, g) => items.filter((_, i) => i % count === g));
}
/** a refusal of the run's credential by a hosted service's gateway (taskRoutes / gateway: "not a valid task credential",
 *  "stale"; the egress: "no credential for this box"): the service's own trouble, never the user's key */
const HOSTED_HICCUP = /not a valid task credential|no credential for this box|\b409\b[^\n]{0,40}"stale"/i;
const HICCUP = { zh: '这是云端工作区的一次临时连接问题，和你的设置无关：点继续，会接着画这几页。', en: 'This was a brief connection problem inside the studio, not anything in your settings. Continue, and these pages are drawn again.' };
/** a revised page whose code is as it was: the change never landed */
const NOT_MADE = { zh: '这次没有改上：页面和改之前一样', en: 'The change was not made: the page is as it was' };
/** a model service's trouble behind a failure, in words the user can act on (none: the trouble is the page's own) */
export function serviceTrouble(text: string): { zh: string; en: string } | undefined {
  // a hosted service's own credential for the run refused (its box's, not a key of the user's: they have none there),
  // seen 2026-10-28 during a redeploy of the boxes. Passing: the next try gets the box's current credential
  if (HOSTED_HICCUP.test(text)) return HICCUP;
  if (/\b402\b|insufficient|balance|quota|credit|billing|余额|额度|欠费/i.test(text)) return { zh: '模型账户的余额或额度用完了：充值，或在设置里换一个 key，再点继续。', en: 'The model account is out of balance or quota. Top it up or use another key in Settings, then continue.' };
  if (/\b40[13]\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?key|key|token)|authentication|forbidden/i.test(text)) return { zh: '模型的 key 无效或没有权限：在设置里检查 key，再点继续。', en: 'The model key is invalid or not allowed. Check it in Settings, then continue.' };
  if (/\b(429|529|503)\b|rate.?limit|too many requests|overloaded|capacity|限流/i.test(text)) return { zh: '模型服务这会儿太忙，限流了：等几分钟再点继续。', en: 'The model service is busy and limiting requests. Wait a few minutes, then continue.' };
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|terminated/i.test(text)) return { zh: '连不上模型服务：检查网络或代理，再点继续。', en: "Couldn't reach the model service. Check the network or proxy, then continue." };
  return undefined;
}

/** a stop (Pause), not a failure */
const stopped = (e: unknown) => (e as Error)?.name === 'AbortError';
/** `fn` over `items`, at most `n` at a time */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x); }));
}
/** pictures drawn at once: the image service takes ~30 s for each (the Cloud's gateway lets a film draw 10 at once) */
const PICTURES_AT_ONCE = 10;
// pageChecks: a drawn page is checked at most 3 times (2 rounds of fixes); a revision starts from a checked page, 2.
/** the length a film is held to: the user's choice, which they pay for by the minute. At most 4 pages a minute (one
 *  more for a short film), and a narration whose estimate runs at most a third over and at least the length (the
 *  estimate runs long; real narration comes out 15–25% shorter: estimates of 54 s gave 48 s films, 2026-10-28). A 10-minute film of three textbook chapters ran to 70 pages and 22 minutes
 *  when length was only a guide. Each page is a session of its own with a fixed cost (its prompt, its first look, its
 *  check), so pages of ~20 s cost less than pages of ~13 s for the same film. */
export const PAGES_PER_MINUTE = 4;
export const lengthBudget = (durationSec: number) => ({ pages: Math.ceil((durationSec / 60) * PAGES_PER_MINUTE) + 1, estimateSec: Math.round(durationSec * 4 / 3), leastSec: durationSec });
// pageTurns / kitTurns cap one exchange (a send) of a session; pageBudget / kitBudget the whole session (Director.allow):
// a kit session took 46 turns over its exchanges, its context past 150k tokens a turn (2026-10-29). A lane's budget
// grows by pageBudget with each page it takes; a kit session's is kitBudget, whatever it holds.
const MAX = { pageLintMs: 90_000, pagesAtOnce: 10, storyboardFix: 2, scriptFix: 2, planTurns: 30, pageTurns: 40, pageBudget: 40, reviewerTurns: 3, pageChecks: 3, kitChecks: 3, kitTurns: 16, kitBudget: 24, revisionChecks: 2, brokenChecks: 2, reviewRounds: 2, reviewDefectsMs: 180_000 };
/** the reviewer looks at one sheet and answers: little thinking, quickly */
const REVIEWER_THINKING: Thinking = 'low';
/** what breaks a film whatever it looks like: the whole-film check's 'defects' mode takes only these */
const DEFECTS: LintKind[] = ['runtime', 'api', 'nondeterministic', 'palette'];
/** what a viewer sees broken on a page: its 'hard' checks fix only these (not advice such as text-heavy or sparse) */
const HARD: LintKind[] = ['runtime', 'api', 'nondeterministic', 'empty-opening', 'empty-ending', 'off-canvas', 'subtitle-band', 'overlap', 'small-text', 'off-word'];
/** findings that mean the page's code does not run as written: such a page is not drawn */
const BROKEN: LintKind[] = ['runtime', 'api'];
const errorsOf = (issues: LintIssue[]) => issues.filter((i) => i.level === 'error');
const fromLint = (i: LintIssue): PageIssue => ({ from: 'lint', kind: i.kind, at: i.local, msg: i.msg, data: i.data });
const fromReview = (p: Problem): PageIssue => ({ from: 'review', at: p.at, msg: p.what });
/** the session that reads a message the user sends mid-run (route) */
const ROUTE_SESSION = 'route';
/** the kinds of change a finished film is asked for (changeKind): only `look` goes straight to its pages' agents */
const CHANGE_QUESTION = 'A user asks for a change to their finished narrated explainer video (pages drawn in code, some with AI-generated pictures). What kind of change is it?';
const CHANGE_KINDS = {
  look: 'how something on the page(s) they point at looks or moves on screen: layout, position, size, colour, on-screen text or titles, what is drawn there, motion or when things appear',
  picture: 'something inside a generated picture or illustration: a person or character (face, eyes, hands, pose, expression), redrawing or removing a character, an object drawn in the picture',
  words: 'what is heard: the narration text, how a word is pronounced, a pause, the voice or audio missing, the subtitles',
  film: 'beyond the pages pointed at: the whole film, adding pages, its length, pace, language, style or overall story',
  talk: 'no change to the video: a question, thanks, asking for text such as a title or caption, or saying not to change anything',
};
/** what a message the user sends mid-run is (route): only a change or a go-ahead it is sure of skips the model's reading */
const MESSAGE_QUESTION = 'A user typed this into the message box of their explainer video while it is being made. What is it?';
const MESSAGE_KINDS: Record<string, string> = {
  change: 'an instruction for the film: something to make, add, leave out or do differently (how it looks, what is said, its length, voice or style), material or a script to use, or a correction',
  question: 'needs an answer and changes nothing: a question about the film, its progress, time, credits or cost, or a remark or complaint that names nothing to change',
  both: 'asks for a change and also asks a question',
  go: 'only tells the film, which is waiting for them, to go on: continue, start, go ahead, looks good, fine as it is',
};
const MESSAGE_SURE = 0.85;
/** what reaching a component means (kitReached): its own look, not where a page puts it */
const KIT_CRITERIA = { true: 'the change is to how this thing itself looks or is drawn: its colour, shape, parts, size, style', false: 'the change is to the page alone (where things are, the camera, the background, a label, the pacing), or to something else' };
const KIT_SURE = 0.85;
/** how sure the decision model must be of a kind to act on it (on 40 real changes: the clear ones 0.8–1, the vague below 0.6) */
const CHANGE_SURE = 0.7;
/** what a message mid-run is: a change for the film (noted for the sessions), a question (answered with `reply`), or both */
export type MessageRoute = { kind: 'change' | 'question' | 'both' | 'go'; reply?: string };
/** what the page agent said with its flag tool, if it used it */
const flagOf = (r: TurnResult) => r.answers.find((a) => a.name === FLAG.name)?.args.reason as string | undefined;

/** where the planner writes a change's plan */
const PLAN_FILE = '.studio/revision.json';
/** a change's plan: the pages to redraw (ids of the storyboard), each with what to change on it */
export type RevisionPlan = { id: string; note?: string }[];
/**
 * The page a plan's id names. The planner may write an id its own way ("P03", "p3", "3", 3) for the storyboard's "p03",
 * so the id is matched exactly, then by the page number it carries (the storyboard's own numbering, else its position).
 */
export function planPageId(raw: unknown, ids: string[]): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const s = String(raw).trim();
  const exact = ids.find((id) => id === s) ?? ids.find((id) => id.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const m = /^(?:p|page)?[\s_-]*0*(\d+)$/i.exec(s);
  if (!m) return undefined;
  const n = +m[1];
  return ids.find((id) => +(/^p0*(\d+)$/i.exec(id)?.[1] ?? NaN) === n) ?? (n >= 1 && n <= ids.length ? ids[n - 1] : undefined);
}
/** the plan in the planner's file (undefined: no file), or what is wrong with it, in words for the planner to fix it */
export function readRevisionPlan(text: string | undefined, ids: string[]): { plan: RevisionPlan } | { problem: string } {
  if (text === undefined) return { problem: `${PLAN_FILE} was not written` };
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { return { problem: `${PLAN_FILE} is not valid JSON (${(e as Error).message})` }; }
  const pages = (v as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) return { problem: `${PLAN_FILE} has no "pages" list` };
  const plan: RevisionPlan = [];
  for (const p of pages) {
    const raw = (p as { id?: unknown } | null)?.id;
    const id = planPageId(raw, ids);
    if (!id) return { problem: `${PLAN_FILE} names a page that is not in storyboard.json (${JSON.stringify(raw ?? p)}); the pages are ${ids.join(', ')}` };
    const note = typeof (p as { note?: unknown }).note === 'string' && (p as { note: string }).note.trim() ? (p as { note: string }).note : undefined;
    const same = plan.find((x) => x.id === id);
    if (same) same.note = [same.note, note].filter(Boolean).join('\n') || undefined;
    else plan.push({ id, note });
  }
  return { plan };
}

export class Director {
  readonly project: Project;
  private state: State;
  private commits: Promise<unknown> = Promise.resolve();

  constructor(private o: DirectorOptions) {
    this.project = new Project(o.dir, o.renderer, o.signal);
    this.waitSaid = o.firstPageSaid ?? false;
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
  /**
   * What a message the user sends mid-run is, as the model's route call says: a change for the film, a question that
   * needs only a reply, or both (with the reply). One short session on the reviewer's model, with no tools. Anything
   * that goes wrong (no call, a failed turn, a stop, a question with no reply) reads it as a change, as every message
   * was before: an instruction is never lost. `credits`: what a hosted service knows of the account, for a question
   * about what is left to pay.
   */
  async route(text: string, credits?: CreditFacts): Promise<MessageRoute> {
    // what the decision model is sure of needs no session: a change is passed on as it is, and a go-ahead at the
    // first page's wait goes ahead. Only a message that needs words back (a question, a remark), or one it isn't sure
    // of, is read by the model below, which writes the reply
    const waiting = this.state.stage === 'pages' && this.state.firstPage === 'waiting';
    const kind = await choose(this.o.decide, { message: text.trim(), filmWaitingForTheUser: waiting }, MESSAGE_QUESTION, waiting ? MESSAGE_KINDS : Object.fromEntries(Object.entries(MESSAGE_KINDS).filter(([k]) => k !== 'go')), this.o.signal).catch((e) => { if (stopped(e)) throw e; return undefined; });
    if (kind && kind.p >= MESSAGE_SURE && (kind.choice === 'change' || kind.choice === 'go')) return { kind: kind.choice };
    let s: AgentSession | undefined;
    try {
      s = await this.session(ROUTE_SESSION, routeSystem, MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [ROUTE] });
      const r = await this.send(s, routeAsk(text, await this.facts(), credits, this.replyLang()), undefined, REVIEWER_THINKING);
      const a = r.answers.find((x) => x.name === ROUTE.name)?.args as { change?: unknown; question?: unknown; go?: unknown; reply?: unknown } | undefined;
      const reply = typeof a?.reply === 'string' && a.reply.trim() ? a.reply.trim() : undefined;
      // only telling the film to go on (「继续」 at the first page's wait): a go-ahead, with nothing to change
      if (a?.go === true && a.change !== true) return { kind: 'go', ...(reply ? { reply } : {}) };
      if (a?.question === true && reply) return { kind: a.change === true ? 'both' : 'question', reply };
    } catch { /* read as a change */ } finally { await s?.close().catch(() => {}); }
    return { kind: 'change' };
  }
  /** what the director knows of the film right now, for a question about it: never throws, says what it can */
  private async facts(): Promise<FilmFacts> {
    let pagesTotal: number | undefined, durationSec: number | undefined;
    try { pagesTotal = this.project.storyboard().pages.length; } catch { /* no storyboard yet */ }
    // the narration's length once the script is written (one run of the engine's timeline tool), else the length asked for
    if (!['research', 'storyboard', 'approval', 'script'].includes(this.state.stage)) {
      try { durationSec = (await this.project.timeline()).duration || undefined; } catch { /* the asked-for length below */ }
    }
    const cost = this.cost();
    return {
      stage: this.state.stage,
      pagesDone: Object.values(this.state.pages ?? {}).filter((p) => p.status === 'ok' || p.status === 'flagged').length,
      pagesTotal,
      durationSec: durationSec ?? (this.o.brief.durationSec || undefined),
      planned: durationSec !== undefined,
      ...(this.state.stage === 'pages' && this.state.firstPage === 'waiting' ? { waiting: 'first_page' as const } : {}),
      ...(cost.amount > 0 ? { cost } : {}),
    };
  }
  /**
   * Every note the user gave, as the film's standing directions: a page's first message and its reviewer read all of
   * them. Handed out only once each (unseen), a page drawn again in a fresh session saw none of them: seen, a first page
   * whose user asked for no hook was drawn a third time with the hook back, its reviewer judging it by the storyboard.
   */
  private directions(key?: string): string[] {
    const all = this.state.notes ?? [];
    if (key) { (this.state.cursors ??= {})[key] = all.length; this.save(); }
    return all;
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
  /** a line the server writes to the user: in Chinese for a Chinese speaker, else in English */
  private say(zh: string, en: string) { return this.replyLang() === 'zh' ? zh : en; }
  /** the film's language: what storyboard.json says once it is written (the planner's, from the user's own words, and
   *  changed when the user asks for another), else the brief's */
  filmLang(): string {
    try { const l = langTag(this.project.storyboard().lang); if (l) return l; } catch {}
    return this.o.brief.lang ?? 'zh';
  }
  /** the language the director writes to the user in: theirs (what they last wrote in, told only as Chinese or not); a
   *  film in another language than those two that took the language of their request most likely has theirs */
  private replyLang(): string {
    const film = this.filmLang(), r = this.o.brief.replyLang;
    return this.o.brief.langAuto && r !== 'zh' && film !== 'zh' && film !== 'en' ? film : (r ?? film);
  }

  private emit(e: StudioEvent) {
    // whether the log ends at the first page's wait: a step after it (a page, a stage, a pause) moves it on, and a run
    // picked up there says the wait again, else the panel shows no card and nothing goes on by itself; a picture drawn
    // again or a note leaves it where it was
    if (e.type === 'first_page') this.waitSaid = true;
    else if (['stage', 'page', 'paused', 'resumed', 'ready', 'approval'].includes(e.type)) this.waitSaid = false;
    this.o.emit?.(e);
  }
  private waitSaid: boolean;
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
    // reading a message mid-run is one short answer, like a verdict: the reviewer's (cheapest) model
    if (name.startsWith('check-') || name === ROUTE_SESSION) return this.o.reviewer ?? this.o.pages ?? { runtime: this.o.runtime, prices: this.o.prices };
    return this.o.pages && (name.startsWith('page-') || name === 'review' || name.startsWith('kit-')) ? this.o.pages : { runtime: this.o.runtime, prices: this.o.prices };
  }
  private async session(name: string, system: string, maxTurns: number, resume?: string, signal = this.o.signal, tools: Pick<SessionOptions, 'tools' | 'answers'> = {}, shownAs?: () => string): Promise<AgentSession> {
    const { runtime, prices } = this.model(name);
    // a reviewer's words are for the page agent, not the people watching: only its turns go out, to be counted (the
    // router's too: its reply goes out as a note, from the runner)
    const shown = !name.startsWith('check-') && name !== ROUTE_SESSION;
    // its turns over its whole life (held to a budget once allow() gives it one), and whether it was seen reading the
    // engine's source (reported once)
    const budget: Budget = { name, used: 0, limit: Infinity };
    let read = false;
    const s = await runtime.open({ name, system, cwd: this.o.dir, maxTurns, signal, ...tools, onEvent: (event) => {
      // a call's path or command is for the director alone: the event goes on without it
      if (event.type === 'tool_start' && event.input) {
        const { input, ...rest } = event;
        if (!read && drawingSession(name)) {
          const detail = sourceReading(event.name, input, this.o.dir);
          if (detail) { read = true; this.emit({ type: 'anomaly', kind: 'source-reading', session: shownAs?.() ?? name, detail }); }
        }
        event = rest;
      }
      // a lane's session speaks for the page it is on, so the panel shows each page's work on that page
      if (shown || event.type === 'turn') this.emit({ type: 'agent', session: shownAs?.() ?? name, event });
      if (event.type === 'turn') { budget.used++; this.countTurn(event.usage, prices, runtime.model); if (name.startsWith('page-')) this.firstTurn?.(); this.afterTurn?.(name); }
    } }, resume);
    this.budgets.set(s, budget);
    return s;
  }
  /** `turns` more for session `s` over its life: until it is given some, a session is held only to its maxTurns per
   *  exchange; once given, every exchange gets what is left, and a session with none left is sent nothing more */
  private allow(s: AgentSession, turns: number) {
    const b = this.budgets.get(s);
    if (b) b.limit = (b.limit === Infinity ? 0 : b.limit) + turns;
  }
  /** called after each model turn of any session, with its name (the storyboard keeps its draft as it goes) */
  private afterTurn?: (session: string) => void;
  /**
   * A transcript saved by a run before this one, where this process finds it: a host may restore the project elsewhere
   * (another box, another folder), and a session's file is always `.studio/sessions/<name>.json` of its project. A ref
   * that is no file path (a runtime that keeps its sessions itself) is as it was.
   */
  private here(ref: string | undefined) {
    if (!ref || !path.isAbsolute(ref) || fs.existsSync(ref)) return ref;
    const local = this.project.file(`.studio/sessions/${path.basename(ref)}`);
    return fs.existsSync(local) ? local : ref;
  }
  /** a saved transcript there is to carry on: a file on disk, or a ref of a runtime that keeps its own */
  private resumable(ref: string | undefined): ref is string { return !!ref && (!path.isAbsolute(ref) || fs.existsSync(ref)); }
  private async send(s: AgentSession, text: string, images?: string[], thinking?: Thinking) {
    const b = this.budgets.get(s);
    const left = b && b.limit !== Infinity ? b.limit - b.used : undefined;
    // spent: the exchange ends as one that ran out of turns would, so its page or component is left as it is
    if (left !== undefined && left <= 0) return this.spent(s, b!);
    const r = await s.send({ text, images, thinking, ...(left !== undefined ? { maxTurns: left } : {}) });
    if (r.stopReason === 'aborted') throw new DOMException('aborted', 'AbortError');
    if (r.error) this.lastError.set(s, r.error);
    if (b && b.used >= b.limit) this.spent(s, b);
    return r;
  }
  /** a session that took its whole budget: said once, and every later exchange is answered as out of turns */
  private spent(s: AgentSession, b: Budget): TurnResult {
    const error = `this session has taken all ${b.limit} turns it may`;
    if (!b.said) { b.said = true; this.lastError.set(s, error); this.emit({ type: 'anomaly', kind: 'turn-budget', session: b.name, detail: `${b.used} turns of ${b.limit}` }); }
    return { ok: false, text: '', turns: 0, usage: emptyUsage(), error, stopReason: 'max_turns', answers: [] };
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
      // committed: a host carries the project to another box from what was committed last, and research read again is
      // paid again
      await this.commit(this.say('调研', 'Research'));
      const { searches, pages, folders } = out.read;
      const detail = this.replyLang() !== 'zh'
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
    // a storyboard cut short (its box lost, the app closed) goes on from where it was: in the planner's own conversation
    // when its transcript is here (saved every turn), else from the storyboard.json it left. Never from the top: the
    // takeover of 2026-10-29 planned the whole film again (36 turns) and paid for it twice
    const ref = this.here(this.state.planner), carry = this.resumable(ref), begun = this.project.exists('storyboard.json');
    this.emit({ type: 'stage', stage: 'storyboard', status: 'start', ...(carry || begun ? { detail: carry ? `resumed: the planner's conversation carries on${begun ? ', storyboard.json begun' : ''}` : 'resumed: storyboard.json begun, finished in a new conversation' } : {}) });
    if (!fs.existsSync(this.project.file('.git'))) this.project.initHistory();
    // only what the agent can read: md/txt/images. PDF/Word/PPT/EPUB are parsed beforehand into x.md (or x.pdf.md)
    const all = fs.existsSync(this.project.file('materials')) ? fs.readdirSync(this.project.file('materials')).filter((f) => !f.startsWith('.')) : [];
    const materials = all.filter((f) => /\.(md|markdown|txt|png|jpe?g|webp|gif)$/i.test(f));
    const s = await this.session('planner', plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand, userAssets(this.project.dir)) + this.canvas('planner'), MAX.planTurns, carry ? ref : undefined);
    // the transcript is named before the first turn, not once the exchange is over (it was: a run lost mid-exchange had
    // nothing to carry on from)
    this.state.planner = s.ref; this.save();
    // the draft is committed whenever the planner changed it: a host takes its checkpoint after each commit, so a box
    // lost later carries the draft and the conversation that wrote it to the next one
    let draft = begun ? this.project.read('storyboard.json') : undefined;
    this.afterTurn = (name) => {
      if (name !== 'planner' || !this.project.exists('storyboard.json')) return;
      const now = this.project.read('storyboard.json');
      if (now !== draft) { draft = now; void this.commit(this.say('分镜（进行中）', 'Storyboard (in progress)')).catch(() => {}); }
    };
    let r = await this.send(s, carry
      ? storyboardResumed(begun) + ' ' + replyNote(this.replyLang(), this.filmLang())
      : storyboardPrompt(this.o.brief, this.o.style, materials, picturePlanNote(this.pictureStyle(), this.own())) + (begun ? storyboardFound : ''), undefined, PLAN_THINKING);
    this.state.planner = s.ref; this.save();
    // a turn can end without the file (seen: a gateway answering a one-token "." mid-turn); ask once more, as for pages
    if (!this.project.exists('storyboard.json') && r.stopReason !== 'max_turns') r = await this.send(s, 'storyboard.json does not exist yet; write it, then stop and report. ' + replyNote(this.replyLang(), this.filmLang()), undefined, PLAN_THINKING);
    if (!this.project.exists('storyboard.json')) this.fail('storyboard', this.say(`没有写出分镜：${r.error || r.text}`, `No storyboard was written: ${r.error || r.text}`));
    // the film's length is the server's to say (the page agents and the checks read it from here): a planner once raised
    // its own target from 1 minute to 2. Its language is the planner's, from the user's own words (langNote): a tag it
    // can't be read as falls back to the brief's
    const target = this.o.brief.durationSec;
    try {
      const j = this.project.storyboard(), lang = this.filmLang();
      if (j.lang !== lang || (target && j.durationSec !== target)) this.project.write('storyboard.json', JSON.stringify({ ...j, lang, ...(target ? { durationSec: target } : {}) }, null, 2));
    } catch {}
    for (let round = 1; ; round++) {
      const issues = [...this.project.storyboardIssues(), ...this.lookIssues(), ...this.lengthIssues()];
      this.emit({ type: 'storyboard_check', round, issues });
      const reds = issues.filter((i) => i.level === 'red');
      if (!reds.length || round > MAX.storyboardFix) break;
      r = await this.send(s, storyboardFixPrompt(issues, this.o.brief), undefined, PLAN_THINKING);
    }
    this.afterTurn = undefined;
    await this.commit(this.say('分镜', 'Storyboard'));
    await s.close();
    const sb = this.project.storyboard();
    this.state.stage = 'approval'; this.save();
    this.emit({ type: 'stage', stage: 'storyboard', status: 'done' });
    this.emit({ type: 'approval', storyboard: sb, ...(this.o.storyboardWaitMs ? { goOnAt: Date.now() + this.o.storyboardWaitMs } : {}) });
    return sb;
  }

  // ── ② narration script ───────────────────────────────────────────────────────────────────────
  async script(feedback?: string) {
    this.emit({ type: 'stage', stage: 'script', status: 'start' });
    this.state.stage = 'script'; this.save();
    this.serverMeta();
    const s = await this.session('planner', plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand, userAssets(this.project.dir)) + this.canvas('planner'), MAX.planTurns, this.here(this.state.planner));
    let r = await this.send(s, scriptPrompt(feedback, this.o.brief) + this.unseen('planner'), undefined, PLAN_THINKING);
    this.state.planner = s.ref; this.save();
    let check: Awaited<ReturnType<Project['scriptCheck']>>;
    for (let ask = 0; ; ask++) {
      // the planner rewrites script.js: put the server-owned fields back (a lost META.voice once rendered a silent film)
      this.serverMeta();
      check = await this.project.scriptCheck();
      if (check.code) this.fail('script', this.say(`口播脚本有错：`, `The narration script has an error: `) + `${check.err || check.out} ${r.error ?? ''}`);
      // the pages drawn are the narration's: a turn that ended before every storyboard page had its words made a
      // one-page film of an eight-page storyboard, green all the way. Ask for the rest; stop if they still don't come.
      const timeline = await this.project.timeline();
      const narrated = new Set(timeline.pages.map((p) => p.id));
      const missing = this.project.storyboard().pages.map((p) => p.id).filter((id) => !narrated.has(id));
      // the narration is never sent back for its length: the planner fits it as it writes (the storyboard's pages are
      // held to the length), and a rewrite to trim or fill it cost more than the film's own words (2026-10-29: ten
      // rounds of trimming a pasted script, ~100 credits)
      if (!missing.length) break;
      if (ask === MAX.scriptFix) this.fail('script', this.say(`口播没有写完：分镜里的 ${missing.join('、')} 没有口播`, `The narration is unfinished: ${missing.join(', ')} of the storyboard ha${missing.length > 1 ? 've' : 's'} no narration`) + (r.error ? ` (${r.error})` : ''));
      r = await this.send(s, `script.js has no narration for ${missing.join(', ')}: every page of storyboard.json needs its entry in PAGES, in the storyboard's order, with the same id. Add the missing pages and keep the ones already written, then run node engine/tools/script.mjs and stop. ` + replyNote(this.replyLang(), this.filmLang()), undefined, PLAN_THINKING);
    }
    await this.commit(this.say('口播', 'Narration'));
    // a style drawn in pictures plans its scenes now, against the narration's real lines
    if (this.pictureStyle()?.led) await this.planScenes(s);
    await s.close();
    this.state.stage = 'narrate'; this.save();
    this.emit({ type: 'stage', stage: 'script', status: 'done', detail: check.out.split('\n').pop() });
  }

  /** A style drawn in pictures: its scenes, one for every line or two of the narration just written, each with the line
   *  it starts on and where its drawing starts (pictures.ts ledPlanNote); the pages are drawn from them by rule */
  private async planScenes(s: AgentSession) {
    const style = this.pictureStyle()!, tl = await this.project.timeline();
    const lines = tl.pages.map((p) => ({ page: p.id, lines: p.cues.map((c) => c.text) }));
    const cues = Object.fromEntries(tl.pages.map((p) => [p.id, p.cues.length])), ids = tl.pages.map((p) => p.id);
    const designs = picturePlan(this.project.storyboard().look, style, this.own()).filter((p) => p.base).length;
    await this.send(s, picturePlanNote(style, this.own(), lines, designs) + replyNote(this.replyLang(), this.filmLang()), undefined, PLAN_THINKING);
    for (let ask = 0; ; ask++) {
      let issues: string[];
      try { issues = pictureIssues(this.project.storyboard().look, ids, style, this.own(), cues); } catch (e) { issues = [`storyboard.json can't be read: ${(e as Error).message}`]; }
      if (!issues.length) break;
      if (ask === 2) this.fail('script', this.say('画面没有排好：', 'The scenes were not planned: ') + issues.join('; '));
      await this.send(s, `The scenes in look.pictures still need fixing:\n- ${issues.join('\n- ')}\nFix them in storyboard.json and stop.`, undefined, PLAN_THINKING);
    }
    await this.commit(this.say('按口播排好画面', 'Scenes planned from the narration'));
  }

  /** a storyboard with more pages than the length the user chose holds (lengthBudget) */
  private lengthIssues(): { level: 'red'; msg: string }[] {
    const target = this.o.brief.durationSec;
    let pages = 0;
    try { pages = this.project.storyboard().pages.length; } catch { return []; }   // an unreadable storyboard is reported already
    const most = target > 0 ? lengthBudget(target).pages : Infinity;
    if (pages <= most) return [];
    return [{ level: 'red', msg: `${pages} pages for a ${Math.round(target / 6) / 10}-minute film: at most ${most}. The length is the user's choice and they pay for it: condense (every section and main point kept, secondary detail, extra examples and repetition given way, related items taken together) rather than run long, and say in your report what was condensed.` }];
  }

  /** what the storyboard's `look` still lacks: the film's components (any style), and for a designed style's film (its
   *  style has no look of its own) the look itself */
  private lookIssues(): { level: 'red'; msg: string }[] {
    const fonts = designedFonts(this.o.style);
    let look: unknown;
    try { look = this.project.storyboard().look; } catch { return []; }   // an unreadable storyboard is reported already
    let ids: string[] = [];
    try { ids = this.project.storyboard().pages.map((p) => p.id); } catch {}
    const pictures = this.pictureStyle();
    return [...(fonts ? designedIssues(look, fonts) : []), ...kitIssues(look, ids, this.o.style), ...(pictures ? pictureIssues(look, ids, pictures, this.own()) : [])].map((msg) => ({ level: 'red' as const, msg }));
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
    const gl = this.webgl();
    // a film that ends on its brand's sign-off holds longer after its last line, so the logo is seen in silence
    const signOff = (() => { try { return signsOff(this.o.brief.brand, this.project.storyboard().pages); } catch { return false; } })();
    this.setMeta({ style: this.o.style, lang: this.filmLang(), portrait: this.o.brief.portrait || undefined, voice: this.o.voice, gap: 0.8, pace: { maxHold: 1.0, gap: 0.8, ...(signOff ? { tail: SIGN_OFF_HOLD } : {}) }, extras: list, look: this.o.look ?? this.designed()?.look, mark: cornerMark(this.o.brief.brand, signOff) ?? false, ...gl });
  }

  /** a style drawn in three.js: the vendors its films load (three, and any the page agents added) */
  private webgl(): { vendor?: string[]; webgl?: boolean } {
    if (!styleWebgl(this.o.style)) return {};
    const vendor = new Set<string>(['three']);
    try {   // keep vendors the page agents added
      const m = /vendor:\s*(\[[^\]\n]*\])/.exec(this.project.read('script.js'));
      if (m) for (const v of JSON.parse(m[1].replace(/'/g, '"'))) vendor.add(v);
    } catch {}
    return { vendor: [...vendor], webgl: true };
  }

  // ── this film's own components (kit.ts) ─────────────────────────────────────────────────────
  /** the components this film's pages get, as the storyboard listed them */
  private kitItems(): KitItem[] {
    if (this.state.kit?.status !== 'done') return [];
    try { return kitPlan(this.project.storyboard().look, this.o.style).filter((x) => this.state.kit!.components.includes(x.name)); } catch { return []; }
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
    const stage = new Project(kitStage(this.o.dir, { style: this.o.style, lang: this.filmLang(), portrait: this.o.brief.portrait, look, items, kit: this.project.read(KIT_FILE), check: this.project.read(KIT_CHECK_FILE), extras: styleExtras(this.o.style), gl: this.webgl() }), undefined, this.o.signal);
    const page = (await stage.timeline()).pages[0];
    const times = kitTimes(page.cues, page.end);
    return { page, times, check: await stage.check('kit', `kit-r${round}`, times, { determinism: true, lintMs: MAX.pageLintMs }) };
  }

  /**
   * The things a film's storyboard lists in `look.kit` (what it draws on more than one page), written once as components
   * (extras/film-kit.js), checked on a sheet of their own (a project of its own in .studio/kit, so the film's pages and
   * timing are untouched), and kept to the ones that pass. It never holds the film up: a kit that cannot be had leaves
   * the pages to draw everything themselves, as before.
   */
  async kit() {
    // settled already (written, given up, or not wanted): a run that continues after something else stopped it (seen:
    // the narration failing three times wrote the kit three times) does not pay for it again
    if (this.state.kit) return;
    const sb = this.project.storyboard();
    const designed = this.designed();
    const items = kitPlan(sb.look, this.o.style);
    // a film drawn in one lane needs none: one session draws every page and sees what it drew; nor does a film drawn in
    // pictures (its pages only draw its pictures in)
    if (!kitWanted(sb.pages.length, items) || (this.lanesOn() && laneCount(sb.pages.length) === 1) || this.pictureStyle()?.led) { this.state.kit = { status: 'none', components: [] }; this.save(); return; }
    this.emit({ type: 'kit', status: 'start', components: items.map((x) => x.name) });
    // sessions side by side, each writing up to KIT_PER_SESSION components one after the other: the pages wait on the
    // slowest session, not on the sum (one session writing a 6-page film's two components took 10 minutes, at medium)
    const sessions = new Map<string, AgentSession>();
    let reviewer: AgentSession | undefined;
    let passed: string[] = [], sheet: string | undefined;
    const written = (x: KitItem) => this.project.exists(kitPart(x.name)) && this.project.exists(kitPartCheck(x.name));
    const files = () => items.map((x) => (written(x) ? this.project.read(kitPart(x.name)) + this.project.read(kitPartCheck(x.name)) : '')).join('\0');
    // the kit and its check page, from the components that were written; → the parts, to tell where an error is
    const assemble = (ready: KitItem[]): KitPart[] => {
      const parts = ready.map((x) => ({ name: x.name, code: this.project.read(kitPart(x.name)), check: this.project.read(kitPartCheck(x.name)) }));
      this.project.write(KIT_FILE, parts.map((p) => p.code.trim()).join('\n\n') + '\n');
      this.project.write(KIT_CHECK_FILE, kitCheckPage(parts.map((p) => p.check)));
      return parts;
    };
    try {
      const system = kitSystem(this.o.style, styleExtras(this.o.style), this.o.brief.styleNotes, designed?.card) + this.canvas('artist');
      await Promise.all(kitGroups(items, KIT_PER_SESSION).map(async (group) => {
        let s: AgentSession | undefined;
        for (const [k, it] of group.entries()) {
          const i = items.indexOf(it);
          try {
            if (!s) { s = await this.session(`kit-${it.name}`, system, MAX.kitTurns); this.allow(s, MAX.kitBudget); }
            sessions.set(it.name, s);
            const next = k ? `Next, another of this film's components, in the same session: ${group.slice(0, k).map((x) => `\`P.${x.name}\``).join(', ')} ${k > 1 ? 'are' : 'is'} yours and written.\n\n` : '';
            const r = await this.send(s, next + kitPrompt(sb, items, it, kitCell(i, items.length, !!this.o.brief.portrait), this.filmLang(), this.replyLang(), !!this.o.brief.portrait), undefined, KIT_THINKING);
            if (!written(it)) await this.send(s, `Write both ${kitPart(it.name)} and ${kitPartCheck(it.name)}, then stop.`, undefined, KIT_THINKING);
            if (!written(it)) this.emit({ type: 'kit', status: 'failed', detail: `${it.name}: ${r.error || 'not written'}`.slice(0, 400) });
          } catch (e) { if (stopped(e)) throw e; this.emit({ type: 'kit', status: 'failed', detail: `${it.name}: ${(e as Error).message}`.slice(0, 400) }); }
        }
      }));
      // a component that was never written is left out; the check page is laid out for those that were
      let ready = items.filter(written);
      if (!ready.length) throw new Error('the components were not written');
      for (let round = 1; round <= MAX.kitChecks; round++) {
        const parts = assemble(ready);
        this.emit({ type: 'kit', status: 'checking', round });
        const { page, times, check: c } = await this.checkKit(ready, this.o.look ?? designed?.look, round);
        // which component a moment shows: the one whose cue it falls in
        const at = (t: number) => ready[Math.max(0, page.cues.filter((q) => q.abs <= t + page.start + 0.01).length - 1)]?.name;
        let problems: { name?: string; what: string; fix: string }[] = [], crash: string | undefined, culprit: string | undefined;
        // a kit that throws, or calls what the engine does not have, draws nothing at all: every component fails. The
        // error goes to the session whose file it is raised in, its frames named as that file's lines; to all of them
        // only when nothing says whose it is
        const broken = c.issues.filter((i) => BROKEN.includes(i.kind));
        if (c.crash !== undefined || broken.length) {
          const where = kitLocate(c.crash ?? broken.map((i) => i.msg).join('\n'), parts);
          crash = c.crash !== undefined ? crashText(where.text, 'kit') : where.text;
          culprit = where.owner; passed = [];
        }
        else {
          sheet = c.sheet;
          // the sheet is kept with the film's, so the panel can show it
          try { fs.mkdirSync(this.project.file('out/snap'), { recursive: true }); fs.copyFileSync(c.sheet, this.project.file(`out/snap/kit-r${round}.jpg`)); sheet = this.project.file(`out/snap/kit-r${round}.jpg`); } catch {}
          reviewer ??= await this.session('check-kit', reviewerSystem(this.o.style, this.o.brief.styleNotes, designed?.card) + this.canvas('reviewer'), MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [VERDICT] });
          const v = await this.verdict(reviewer, kitReviewerPrompt(ready, times, round), c.sheet);
          const lint = errorsOf(c.issues).map((i) => ({ name: at(i.local), what: i.msg, fix: 'fix it in the component' }));
          const seen = (v?.pass === false ? v.problems : []).map((p) => ({ name: ready.find((x) => p.what.includes(x.name))?.name ?? at(p.at), what: p.what, fix: p.fix }));
          problems = [...lint, ...seen];
          // a problem that names no component (or the whole sheet) holds them all back
          const failing = new Set(problems.map((p) => p.name));
          passed = failing.has(undefined) ? [] : ready.map((x) => x.name).filter((n) => !failing.has(n));
          if (!problems.length) break;
        }
        if (round === MAX.kitChecks) break;
        // each component's session fixes its own problems, all at once; a crash goes to the one it is raised in (to all
        // when nothing says whose), a problem that names none to all; a session with nothing of its own is not woken
        const before = files();
        const mine = (n: string) => problems.filter((p) => p.name === n || p.name === undefined);
        const crashFor = (n: string) => crash !== undefined && (culprit === undefined || culprit === n);
        // a session that holds two components fixes them one after the other
        const owed = new Map<AgentSession, KitItem[]>();
        for (const x of ready) {
          const s = sessions.get(x.name);
          if (s && (crashFor(x.name) || mine(x.name).length)) owed.set(s, [...(owed.get(s) ?? []), x]);
        }
        await Promise.all([...owed].map(async ([s, xs]) => {
          for (const x of xs) await this.send(s, kitFixPrompt(x.name, round, mine(x.name), crashFor(x.name) ? crash : undefined, culprit === x.name), sheet ? [sheet] : undefined, KIT_THINKING);
        }));
        if (files() === before) break;
        ready = items.filter(written);
      }
    } catch (e) {
      if (stopped(e)) throw e;
      passed = [];
      this.emit({ type: 'kit', status: 'failed', detail: (e as Error).message.slice(0, 400) });
    } finally {
      await reviewer?.close();
      await Promise.all([...new Set(sessions.values())].map((s) => s.close()));
    }
    if (passed.length) {
      // the components that passed, each its own IIFE as its session wrote it
      const kept = passed.map((n) => this.project.read(kitPart(n)).trim()).join('\n\n') + '\n';
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

  // ── this film's generated pictures (pictures.ts) ─────────────────────────────────────────────
  /** the style's words for the image model, when the style allows pictures and there is a service to draw them */
  private pictureStyle() {
    const found = this.o.images ? pictureStyle(this.o.style) : undefined;
    const s = found && this.o.brief.portrait ? { ...found, portrait: true } : found;
    if (!s?.fromLook) return s;
    // a designed style's film: its pictures are drawn in the look the director designed (none yet while it is planned)
    const d = this.designed();
    return { ...s, prefix: d ? lookPrefix(d.card, d.look?.palette) : '' };
  }
  private planned(): PicturePlan[] { try { return picturePlan(this.project.storyboard().look, this.pictureStyle(), this.own()); } catch { return []; } }
  /** the person's own files in the film, which a picture may be drawn from (pictures.ts `from`): the brand's and the uploads */
  private own() { return [...(this.o.brief.brand?.assets ?? []).map((a) => `${BRAND_DIR}/${a.file}`), ...userAssets(this.project.dir).map(assetPath)]; }
  /** the pictures are drawn for every page: the agents' file tools may not change them */
  private freezePictures() { for (const p of readPictures(this.o.dir).items) freeze(this.o.dir, picturePath(p)); }

  /** one picture drawn and its file written (not yet listed). Throws when none can be had */
  private async drawPicture(p: PicturePlan, prompt: string, refs: (Picture | string)[], key: string, note?: string): Promise<Picture> {
    const style = this.pictureStyle()!;
    // a reference is a picture of the film's, or a file of the person's (a picture's `from`)
    const from = refs.flatMap((r) => { try { return [new Uint8Array(readIn(this.o.dir, typeof r === 'string' ? r : picturePath(r), { record: true }))]; } catch { return []; } });
    let data: Uint8Array | undefined, last: unknown, ask = prompt, again = false, reshaped = false;
    const [ww, wh] = pictureSize(p).split('x').map(Number);
    // asked for up to 3 times: a request stuck upstream (timed out) or refused is asked for afresh
    for (let i = 0; i < 3; i++) {
      try {
        const got = await this.o.images!.draw({ prompt: ask, size: pictureSize(p), quality: style.quality, transparent: cutOut(p.kind), refs: from.length ? from : undefined, signal: this.o.signal });
        data = got;
        // a picture drawn at another shape than asked (some image services answer 3:2 to a 16:9 request now and then)
        // would lose an edge to fill its frame: drawn once more, and the second kept whatever its shape
        const shape = sniffPicture(got);
        if (shape && !reshaped && Math.abs(shape.w / shape.h - ww / wh) > 0.04) {
          console.warn(`[pictures] ${p.id}: drawn ${shape.w}x${shape.h}, asked ${pictureSize(p)}: drawn again`);
          reshaped = true; i--; continue;
        }
        // a cut-out that would look stuck on the page (a ground behind it, a sticker's rim) is drawn once more, told why;
        // a second one like it is kept, as better than none
        const trouble = cutOut(p.kind) && sniffPicture(got) ? cutOutTrouble(got) : undefined;
        if (!trouble) break;
        console.warn(`[pictures] ${p.id}: ${trouble}${again ? ', kept' : ', drawn again'}`);
        if (again) break;
        again = true;
        ask = `${prompt}\nThe last attempt was wrong: ${trouble}. Draw the subject alone on full transparency, its own outline the outermost thing in the picture.`;
      } catch (e) { if (stopped(e) || this.o.signal?.aborted) throw e; last = e; if (data) break; }
    }
    const got = data && sniffPicture(data);
    if (!data || !got) throw new Error(data ? 'the image service answered with something that is not a picture' : (last as Error)?.message ?? 'no picture');
    const file = pictureFile(p.id, data, got.type);
    fs.mkdirSync(this.project.file(PICTURES_DIR), { recursive: true });
    writeIn(this.o.dir, `${PICTURES_DIR}/${file}`, data, { record: true });
    return { id: p.id, file, prompt, w: got.w, h: got.h, alpha: got.alpha, at: new Date().toISOString(), key, ...(note ? { note } : {}) };
  }
  /** a picture put in the film's list in place of the one it replaces (whose file goes); `notes`: the look's adjustments
   *  as they are now. → the picture it replaced */
  private keepPicture(pic: Picture, notes?: string[]): Picture | undefined {
    const now = readPictures(this.o.dir);
    const old = now.items.find((x) => x.id === pic.id);
    now.items = [...now.items.filter((x) => x.id !== pic.id), pic];
    if (notes) now.notes = notes;
    this.project.write(PICTURES_MANIFEST, JSON.stringify(now, null, 2) + '\n');
    if (old && old.file !== pic.file) for (const f of [picturePath(old), inkPath(old)]) { try { fs.rmSync(this.project.file(f)); } catch { /* gone */ } }
    // a style that draws its pictures in on the page reads where each one's ink is (ink.ts)
    const ps = this.pictureStyle();
    if (ps?.led || ps?.ink) {
      try { const js = inkScript(pic.file, new Uint8Array(readIn(this.o.dir, picturePath(pic), { record: true }))); if (js) writeIn(this.o.dir, inkPath(pic), js, { record: true }); } catch (e) { console.warn(`[pictures] ${pic.id}: no ink map: ${(e as Error).message}`); }
    }
    freeze(this.o.dir, picturePath(pic));
    return old;
  }
  private pictureEvent(p: PicturePlan, status: 'drawing' | 'done' | 'failed', o: { sample?: boolean; pic?: Picture; note?: string; detail?: string } = {}) {
    this.emit({ type: 'picture', id: p.id, status, what: p.what, kind: p.kind, ...(o.sample ? { sample: true } : {}), ...(o.pic ? { file: picturePath(o.pic), w: o.pic.w, h: o.pic.h } : {}), ...(o.note ? { note: o.note } : {}), ...(o.detail ? { detail: o.detail.slice(0, 400) } : {}) });
  }

  /**
   * Every picture the storyboard asks for, once the user has gone ahead: the first from nothing, then the rest side by
   * side, each drawn from the first so they share its look, and a
   * picture `like` another drawn from that one. A picture drawn already from the same prompt is kept (a resumed run, a
   * revision pays nothing again). One that can't be had is left out: its pages draw that part in code.
   */
  async pictures(): Promise<number> {
    const style = this.pictureStyle(), plan = this.planned();
    if (!style || !plan.length) { this.state.pictures = 'none'; this.save(); return 0; }
    const pics = readPictures(this.o.dir);
    const drawn = new Map<string, Picture>();
    let moved = 0;
    const one = async (p: PicturePlan, refs: (Picture | string)[], mode: RefMode, uses: PicturePlan[] = []) => {
      // a picture of the person's own subject is drawn from their file, whatever else it would be drawn from
      if (p.from) { refs = [p.from]; mode = 'own'; }
      // a scene drawn from designs is drawn again when one of them is
      const deps = mode === 'uses' ? refs.map((r) => (typeof r === 'string' ? r : r.file)) : [];
      const prompt = picturePrompt(style, p, pics.notes, mode, undefined, uses), key = pictureKey(p, pics.notes, deps);
      // drawn already for the same ask (a resumed run, a revision), or drawn again by the user's own word: kept
      const had = pics.items.find((x) => x.id === p.id);
      if (had && (had.key === key || (had.note && !deps.length)) && this.project.exists(picturePath(had))) { drawn.set(p.id, had); return; }
      this.pictureEvent(p, 'drawing', { sample: p === plan[0] });
      try {
        const pic = await this.drawPicture(p, prompt, refs, key);
        const old = this.keepPicture(pic);
        // pages written already (a design drawn again once they were) are pointed at the new file
        if (old && old.file !== pic.file) moved += this.repoint(old, pic);
        drawn.set(p.id, pic);
        this.pictureEvent(p, 'done', { sample: p === plan[0], pic });
      } catch (e) {
        if (stopped(e) || this.o.signal?.aborted) throw e;
        this.pictureEvent(p, 'failed', { sample: p === plan[0], detail: (e as Error).message });
      }
    };
    const [first, ...rest] = plan;
    await one(first, [], 'none');
    let sample = drawn.get(first.id);
    // the sample not had: the next picture drawn from nothing stands in for it, drawn alone first, so the others still
    // share one look; the sample is drawn again from it at the end
    if (!sample) {
      const stand = rest.find((p) => !p.like && !p.from && !p.uses?.length);
      if (stand) { await one(stand, [], 'none'); sample = drawn.get(stand.id); }
    }
    // a film from before designs has one cast sheet, the sample: every scene is drawn from it, its people as they are
    // there. A film with designs draws them from the first one's look, then each scene from the designs it shows
    const sheet = style.cast && first.id === CAST && !first.base && sample?.id === first.id;
    const look = (): [Picture[], RefMode] => (sample ? [[sample], sheet ? 'cast' : 'look'] : [[], 'none']);
    const from = (p: PicturePlan): [Picture[], RefMode, PicturePlan[]] => {
      const uses = (p.uses ?? []).flatMap((id) => { const b = plan.find((q) => q.id === id), d = drawn.get(id); return b && d ? [[b, d] as const] : []; });
      return uses.length ? [uses.map(([, d]) => d), 'uses', uses.map(([b]) => b)] : [...look(), []];
    };
    const many = PICTURES_AT_ONCE;
    const todo = rest.filter((p) => !drawn.has(p.id));
    await pool(todo.filter((p) => p.base && !p.like), many, (p) => one(p, ...look()));
    await pool(todo.filter((p) => !p.base && !p.like), many, (p) => one(p, ...from(p)));
    await pool(todo.filter((p) => p.like), many, (p) => { const base = drawn.get(p.like!); return base ? one(p, [base], 'same') : one(p, ...from(p)); });
    if (!drawn.has(first.id) && sample) await one(first, ...look());
    // pictures the storyboard no longer asks for are let go
    const now = readPictures(this.o.dir);
    const gone = now.items.filter((x) => !plan.some((p) => p.id === x.id));
    if (gone.length) {
      now.items = now.items.filter((x) => !gone.includes(x));
      this.project.write(PICTURES_MANIFEST, JSON.stringify(now, null, 2) + '\n');
      for (const g of gone) for (const f of [picturePath(g), inkPath(g)]) { try { fs.rmSync(this.project.file(f)); } catch { /* gone */ } }
    }
    this.state.pictures = 'done'; this.save();
    this.freezePictures();
    await this.commit(this.say('本片配图', "This film's pictures"));
    return moved;
  }

  /** the pages that place `old` pointed at `pic`, its new file (a file's name carries its content's hash). → how many */
  private repoint(old: Picture, pic: Picture): number {
    if (!fs.existsSync(this.project.file('pages'))) return 0;
    let moved = 0;
    for (const f of fs.readdirSync(this.project.file('pages')).filter((n) => n.endsWith('.js'))) {
      const src = this.project.read(`pages/${f}`);
      if (src.includes(picturePath(old))) { this.project.write(`pages/${f}`, src.split(picturePath(old)).join(picturePath(pic))); moved++; }
    }
    return moved;
  }

  /**
   * One picture drawn again at the user's word, while the first page waits for them or once the film is finished: the
   * pages that place it are pointed at the new file. `note`: what to change in it; drawn from
   * the picture as it is when there is one, else from the sample's look. A picture that can't be had leaves the old one.
   */
  async redrawPicture(id: string, note?: string) {
    if (this.state.stage !== 'done' && this.state.firstPage !== 'waiting') return;
    const style = this.pictureStyle(), plan = this.planned();
    const p = plan.find((x) => x.id === id);
    if (!style || !p) { this.emit({ type: 'note', text: this.say('这张配图已经不在分镜里了', 'That picture is no longer in the storyboard') }); return; }
    let moved = await this.drawAgain(p, plan, note);
    if (moved === undefined) return;
    // a design drawn again: the scenes drawn from it are drawn again too
    if (p.base) moved += await this.pictures();
    await this.commit(this.say(`重画配图 ${id}`, `Picture ${id} drawn again`));
    if (this.state.stage === 'done') {
      if (moved) { this.state.exported = false; this.save(); }
      this.emit({ type: 'ready', duration: (await this.project.timeline()).duration });
    } else if (this.state.firstPage === 'waiting') this.emit({ type: 'first_page', page: (await this.project.timeline()).pages[0].id });
  }

  /** one picture drawn again (`note`: what to change in it) and the pages that place it pointed at the new file. → how
   *  many pages it moved, undefined when no picture could be had (the old one stays) */
  private async drawAgain(p: PicturePlan, plan: PicturePlan[], note?: string): Promise<number | undefined> {
    const style = this.pictureStyle()!, id = p.id;
    const pics = readPictures(this.o.dir);
    const old = pics.items.find((x) => x.id === id), change = note?.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined;
    // a picture drawn from is copied, faults and all: a cut-out with a ground or a rim (cutOutTrouble) is never one.
    // The same subject comes from a clean picture of it (its base, or another pose of it), the look from a clean other
    const clean = (x: Picture | undefined) => {
      if (!x) return undefined;
      const k = plan.find((q) => q.id === x.id)?.kind;
      if (!k || !cutOut(k)) return x;
      try { return cutOutTrouble(new Uint8Array(readIn(this.o.dir, picturePath(x), { record: true }))) ? undefined : x; } catch { return undefined; }
    };
    const itself = clean(old && change ? old : undefined);
    const kin = itself ? undefined : clean(p.like ? pics.items.find((x) => x.id === p.like) : undefined)
      ?? pics.items.map((x) => (plan.find((q) => q.id === x.id)?.like === id ? clean(x) : undefined)).find(Boolean);
    const look = [plan[0].id, ...plan.map((q) => q.id)].map((pid) => (pid === id ? undefined : clean(pics.items.find((x) => x.id === pid)))).find(Boolean);
    // a scene of a film with designs: drawn from the designs it shows, as it was the first time
    const uses = itself || kin || p.from ? [] : (p.uses ?? []).flatMap((u) => { const b = plan.find((q) => q.id === u), d = pics.items.find((x) => x.id === u); return b && d ? [[b, d] as const] : []; });
    // another pose of it is drawn from as the same one, not copied: its hat and props stay with it ('kin')
    const [refs, mode]: [(Picture | string)[], RefMode] = itself ? [[itself], 'same'] : kin ? [[kin], p.like ? 'same' : 'kin'] : p.from ? [[p.from], 'own'] : uses.length ? [uses.map(([, d]) => d), 'uses'] : look ? [[look], style.cast && look.id === plan[0].id && plan[0].id === CAST && !plan[0].base ? 'cast' : 'look'] : [[], 'none'];
    this.pictureEvent(p, 'drawing', { note: change });
    let pic: Picture;
    // drawn from another pose of it: what that one adds (a hat, a prop) is named, or the image model copies it
    const other = mode === 'kin' && kin ? plan.find((q) => q.id === kin.id)?.what : undefined;
    const ask = other ? [change, `the reference picture shows "${other}": draw none of what that adds to the subject above (its hat, props, pose)`].filter(Boolean).join('; ') : change;
    try { pic = await this.drawPicture(p, picturePrompt(style, p, pics.notes, mode, ask, uses.map(([b]) => b)), refs, pictureKey(p, pics.notes, mode === 'uses' ? uses.map(([, d]) => d.file) : []), change); }
    catch (e) {
      if (stopped(e) || this.o.signal?.aborted) throw e;
      this.pictureEvent(p, 'failed', { detail: (e as Error).message });
      return undefined;
    }
    this.keepPicture(pic);
    // the pages that place it, pointed at the new file (its name carries its content's hash)
    const moved = old ? this.repoint(old, pic) : 0;
    this.pictureEvent(p, 'done', { pic });
    return moved;
  }

  /**
   * The pictures a change reaches, before its pages are drawn: those it added to or changed in the storyboard, and
   * those the planner named in its plan to draw again (`"pictures": [{ "id", "note" }]`, when the user's words are about
   * a picture itself: its look, a box around it, its pose). Code can't change a picture; drawing it again can.
   */
  private async changePictures(before: unknown): Promise<number> {
    if (!this.pictureStyle()) return 0;
    const asked = (look: unknown) => JSON.stringify(look && typeof look === 'object' ? (look as Record<string, unknown>).pictures ?? null : null);
    let named: { id: string; note?: string }[] = [];
    try {
      const raw = JSON.parse(this.project.read(PLAN_FILE)).pictures;
      if (Array.isArray(raw)) named = raw.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, note: typeof x.note === 'string' ? x.note : undefined }));
    } catch { /* no plan file, or none named */ }
    const added = asked(this.project.storyboard().look) !== asked(before);
    if (!added && !named.length) return 0;
    this.emit({ type: 'note', text: this.say('先画这次要用的配图', 'Drawing the pictures this change needs first') });
    if (added) await this.pictures();
    const plan = this.planned();
    let redrawn = 0;
    let design = false;
    for (const n of named) { const p = plan.find((x) => x.id === n.id); if (p && await this.drawAgain(p, plan, n.note) !== undefined) { redrawn++; design ||= !!p.base; } }
    // a design drawn again: the scenes drawn from it are drawn again too
    if (design) await this.pictures();
    this.freezePictures();
    await this.commit(this.say('照用户的意见重画配图', 'Pictures drawn again as the user asked'));
    return redrawn;
  }

  /** a portrait film: what its planners, artists and reviewers are told of the tall stage ('' for a landscape film) */
  private canvas(who: 'planner' | 'artist' | 'reviewer') { return canvasSection(this.o.brief.portrait, who); }

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
   * The film's narration spoken again in its (new) voice, or (`lines`) because its lines were changed by hand. Pages
   * keep their pictures: they follow the lines' times, which the new takes give them. Takes are cached by text and
   * voice, so only pages whose lines changed are spoken again, and going back to a voice used before costs nothing.
   */
  async revoice(lines = false) {
    if (!lines && !this.voiceStale()) return;
    this.emit({ type: 'stage', stage: 'narrate', status: 'start' });
    this.serverMeta();
    const r = await narrate(this.o.dir, { tts: this.o.tts!, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles, onProgress: (e) => this.emit({ type: 'narrate', ...e }) });
    await this.commit(lines ? this.say('改了台词，重新配音', 'Lines changed, narrated again') : this.say('换配音', 'New voice'));
    this.state.exported = false; this.save();
    this.emit({ type: 'stage', stage: 'narrate', status: 'done', detail: `${r.duration.toFixed(1)}s${r.warnings.length ? '；' + r.warnings.join('；') : ''}` });
    if (this.state.stage === 'done') this.emit({ type: 'ready', duration: (await this.project.timeline()).duration });
    // narrated again while the first page waits: the wait is said again, with its card (and its time to go on)
    else if (this.state.firstPage === 'waiting') this.sayWait((await this.project.timeline()).pages[0].id);
  }

  // ── ④ pages ──────────────────────────────────────────────────────────────────────────────────
  /** the first page's wait, said (its card in the panel, and when it goes on by itself) */
  private sayWait(page: string) { this.emit({ type: 'first_page', page, ...(this.o.firstPageWaitMs ? { goOnAt: Date.now() + this.o.firstPageWaitMs } : {}) }); }

  /**
   * The film's first page, drawn and checked alone, and shown to the user before the rest: they confirm the look (the
   * style, the pictures, how the page is built), or say what to change. A change is made to the first page and noted
   * for every page after it, and the first page waits again; once they go ahead, the others are drawn side by side. A
   * film of one page, or one whose other pages are drawn already (a run from before this), has nothing to wait for.
   */
  async firstPage(approve: (sb: Storyboard) => Promise<string | undefined>) {
    if (this.state.firstPage === 'done') return;
    const tl = await this.project.timeline();
    const drawn = (id: string) => ['ok', 'flagged'].includes(this.state.pages[id]?.status ?? '');
    // only a film whose look is designed for it (a style with no look of its own) waits: a style pack's look is known
    // before anything is drawn, so its pages are drawn straight on, in one session from the first page (few films ever
    // stopped at the wait, and it kept the first page's session from carrying on)
    if (this.o.firstPage === false || !designedFonts(this.o.style) || tl.pages.length < 2 || tl.pages.slice(1).some((p) => drawn(p.id))) { this.state.firstPage = 'done'; this.save(); return; }
    // a run picked up again while it waits (the app restarted) has said so already, unless the log has moved on since
    // (a pause, a new voice: seen 2026-10-26, a film narrated again at its wait then sat silent, the user's 「继续」
    // answered as a question): the wait is said once, and again for a first page drawn anew or a log moved past it
    let said = this.state.firstPage === 'waiting' && this.waitSaid;
    for (;;) {
      // the first page as the storyboard has it now (a change may have rewritten the film's plan)
      const id = (await this.project.timeline()).pages[0].id;
      if (!drawn(id)) { await this.pages([id], { hold: true }); said = false; }
      this.state.firstPage = 'waiting'; this.save();
      if (!said) this.sayWait(id);
      said = false;
      const change = (await approve(this.project.storyboard()))?.trim();
      if (!change) break;
      // a question about the film is answered and the first page waits on, as it was (its wait running on, not said
      // again); a change, or a message that can't be read, is made as before, and with a question in it, answered too
      const heard = await this.route(change);
      if (heard.reply) this.emit({ type: 'note', text: heard.reply });
      if (heard.kind === 'question') { said = true; continue; }
      // 「继续」「开始吧」: the user goes ahead, as from the card
      if (heard.kind === 'go') break;
      await this.firstPageChange(id, change);
    }
    this.state.revision = undefined; this.state.firstPage = 'done'; this.save();
  }

  /**
   * A change the user asked for at the first page. What people ask for here is most often about the whole film: what it
   * says and how (no opening hook, keep the chapters apart, leave nothing out). Only the first page is drawn, so the
   * planner makes the change in the storyboard and the narration first, on every page it reaches, and the narration is
   * voiced again where it changed; then the first page is drawn to it. Handed to the first page alone, with the words
   * fixed, the change never reached what was said, and the next redraw put back what the user had ruled out (seen).
   * The change stays one of the film's directions, read by every page and its reviewer.
   */
  private async firstPageChange(id: string, change: string) {
    this.message(change);
    // a change to a thing the film draws with its own components is made in them first, or the other pages would still
    // draw it the old way (they are fixed for the pages' file tools)
    await this.kitChange(change);
    const file = (f: string) => (this.project.exists(f) ? this.project.read(f) : '');
    const script = file('script.js'), storyboard = file('storyboard.json'), look = this.project.storyboard().look;
    this.emit({ type: 'note', text: this.say('收到，我先看看这条要改到哪些地方', 'Got it. Let me see what this changes in the film') });
    const got = await this.planRevision(change, [id], id);
    await this.changePictures(look);
    const words = file('script.js') !== script, plan = file('storyboard.json') !== storyboard;
    // the first page as the plan has it now: when the planner wrote no note for it, the change itself is its brief
    const first = (await this.project.timeline()).pages[0].id;
    const note = 'plan' in got ? got.plan.find((p) => p.id === first)?.note : undefined;
    this.wordsChanged = words;
    if (words) {
      this.serverMeta();
      if (this.o.tts && this.o.voice) await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles });   // unchanged lines cost nothing
      await this.commit(this.say('照用户的意见改口播', 'Narration changed as the user asked'));
    } else if (plan) await this.commit(this.say('照用户的意见改分镜', 'Storyboard changed as the user asked'));
    this.state.revision = { [first]: note ?? change };
    this.state.pages[first] = { ...this.state.pages[first], status: 'queued', rounds: 0, issues: [] }; this.save();
    this.emit({ type: 'note', text: words
      ? this.say('改了口播和后面各页的安排，第一页照这个重画，后面的页也会照这个来', 'I changed the narration and the plan for the pages after it; redrawing the first page to match, and the rest will follow')
      : plan
      ? this.say('改了后面各页的安排，第一页照这个重画，后面的页也会照这个来', 'I changed the plan for the pages after it; redrawing the first page to match, and the rest will follow')
      : this.say('照这个改第一页，后面的页也会照这个来', 'Changing the first page as you said; the pages after it will follow it too') });
  }

  /** the components a change at the first page reaches, as the decision model answers for each (one question each, in
   *  one round trip); undefined when it isn't sure of every one, for the model's session to decide */
  private async kitReached(items: KitItem[], change: string): Promise<string[] | undefined> {
    const questions = Object.fromEntries(items.map((it, i) => [`c${i}`, { type: 'boolean' as const, instructions: `Must the film's component "${it.name}" (${it.what}) itself change for this? It is drawn the same on every page that shows it.`, criteria: KIT_CRITERIA }]));
    const a = await this.o.decide?.ask({ change, components: items.map((it) => `${it.name}: ${it.what}`) }, questions, this.o.signal).catch((e) => { if (stopped(e)) throw e; return undefined; });
    if (!a) return undefined;
    const p = items.map((_, i) => (a[`c${i}`] as { probability: number }).probability);
    if (p.some((x) => x > 1 - KIT_SURE && x < KIT_SURE)) return undefined;
    return items.filter((_, i) => p[i] >= KIT_SURE).map((it) => it.name);
  }

  /**
   * A change the user asked for at the first page, made in the film's components it reaches: the director names them
   * (none, most often), each one's session makes the change keeping its interface, and they are checked again as at
   * first. A change that doesn't pass its check is undone: the first page then makes it in the page itself.
   */
  private async kitChange(change: string) {
    const items = this.kitItems();
    if (!items.length) return;
    let names = await this.kitReached(items, change);
    if (!names) {
      const router = await this.session('kit-route', kitChangeSystem, MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [KIT_CHANGE] });
      try {
        const r = await this.send(router, kitChangeAsk(items, change));
        const said = (r.answers.find((a) => a.name === KIT_CHANGE.name)?.args as { names?: unknown } | undefined)?.names;
        names = Array.isArray(said) ? items.map((x) => x.name).filter((n) => said.includes(n)) : [];
      } catch (e) { if (stopped(e)) throw e; } finally { await router.close(); }
    }
    if (!names?.length) return;
    this.emit({ type: 'kit', status: 'start', components: names });
    const was = new Map(names.map((n) => [n, [this.project.read(kitPart(n)), this.project.read(kitPartCheck(n))] as const]));
    const undo = () => { for (const [n, [code, check]] of was) { this.project.write(kitPart(n), code); this.project.write(kitPartCheck(n), check); } };
    const designed = this.designed();
    const sessions = new Map<string, AgentSession>();
    let reviewer: AgentSession | undefined, ok = false, sheet: string | undefined, why = '';
    try {
      const system = kitSystem(this.o.style, styleExtras(this.o.style), this.o.brief.styleNotes, designed?.card) + this.canvas('artist');
      await Promise.all(names.map(async (n) => {
        const s = await this.session(`kit-${n}`, system, MAX.kitTurns);
        this.allow(s, MAX.kitBudget);
        sessions.set(n, s);
        await this.send(s, kitChangePrompt(n, change, was.get(n)![0], was.get(n)![1]) + this.unseen(`kit-${n}`), undefined, KIT_THINKING);
      }));
      for (let round = 1; round <= 2; round++) {
        const parts = items.map((x) => ({ name: x.name, code: this.project.read(kitPart(x.name)), check: this.project.read(kitPartCheck(x.name)) }));
        this.project.write(KIT_FILE, parts.map((p) => p.code.trim()).join('\n\n') + '\n');
        this.project.write(KIT_CHECK_FILE, kitCheckPage(parts.map((p) => p.check)));
        this.emit({ type: 'kit', status: 'checking', round });
        const { page, times, check: c } = await this.checkKit(items, this.o.look ?? designed?.look, round + 10);
        const broken = c.issues.filter((i) => BROKEN.includes(i.kind));
        let problems: { name?: string; what: string; fix: string }[];
        // an error goes to the component it is raised in (kitLocate), to every one changed when nothing says whose
        if (c.crash !== undefined || broken.length) {
          const where = kitLocate(c.crash ?? broken.map((i) => i.msg).join('\n'), parts);
          problems = [{ name: where.owner, what: c.crash !== undefined ? crashText(where.text, 'kit') : where.text, fix: 'fix the error' }];
        }
        else {
          sheet = c.sheet;
          try { fs.copyFileSync(c.sheet, this.project.file(`out/snap/kit-change-r${round}.jpg`)); sheet = this.project.file(`out/snap/kit-change-r${round}.jpg`); } catch {}
          reviewer ??= await this.session('check-kit', reviewerSystem(this.o.style, this.o.brief.styleNotes, designed?.card) + this.canvas('reviewer'), MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [VERDICT] });
          const v = await this.verdict(reviewer, kitReviewerPrompt(items, times, round) + `\n\nThe user asked for this change to ${names.join(', ')}: ${change}\nFail those if they don't show it.`, c.sheet);
          const at = (t: number) => items[Math.max(0, page.cues.filter((q) => q.abs <= t + page.start + 0.01).length - 1)]?.name;
          problems = [...errorsOf(c.issues).map((i) => ({ name: at(i.local), what: i.msg, fix: 'fix it in the component' })),
            ...(v?.pass === false ? v.problems : []).map((p) => ({ name: items.find((x) => p.what.includes(x.name))?.name ?? at(p.at), what: p.what, fix: p.fix }))];
        }
        if (!problems.length) { ok = true; break; }
        why = problems.map((p) => p.what).join('; ');
        if (round === 2) break;
        // a session with no problem of its own is not woken
        await Promise.all(names.filter((n) => problems.some((p) => !p.name || p.name === n)).map((n) => this.send(sessions.get(n)!, kitFixPrompt(n, round, problems.filter((p) => !p.name || p.name === n), undefined), sheet ? [sheet] : undefined, KIT_THINKING)));
      }
    } catch (e) {
      if (stopped(e)) { undo(); throw e; }
      why = (e as Error).message;
    } finally {
      await reviewer?.close();
      await Promise.all([...sessions.values()].map((s) => s.close()));
    }
    if (!ok) undo();
    // the kit as it stands now (changed, or put back), fixed again for the pages
    const kept = this.state.kit!.components.map((n) => this.project.read(kitPart(n)).trim()).join('\n\n') + '\n';
    this.project.write(KIT_FILE, kept);
    fs.writeFileSync(this.project.file(KIT_KEPT), kept);
    freeze(this.o.dir, KIT_FILE);
    if (ok) this.emit({ type: 'kit', status: 'done', components: this.state.kit!.components, sheet });
    else {
      this.emit({ type: 'kit', status: 'done', components: this.state.kit!.components, detail: why.slice(0, 400) });
      this.emit({ type: 'note', text: this.say(`组件没改成（${names.join('、')}），第一页会在页面里照你说的画`, `The components could not be changed (${names.join(', ')}); the first page makes the change itself`) });
    }
    await this.commit(this.say(`按你说的改组件：${names.join('、')}`, `Components changed as asked: ${names.join(', ')}`));
  }

  /** `hold`: only these pages, and the film stays at its pages after them (the first page, waiting for the user) */
  async pages(only?: string[], o: { hold?: boolean } = {}) {
    // the lanes of a run that stopped (a pause, credits, a lost box) whose conversations are here: each goes on in its own
    // with the pages it has left. Drawn in new lanes instead (2026-10-29: six, after a stop for credits), every one paid
    // to read its whole prompt and the film's first page again
    const kept = !only && !this.state.revision && this.lanesOn() ? this.keptLanes() : [];
    const done = Object.values(this.state.pages).filter((p) => p.status === 'ok' || p.status === 'flagged').length;
    // said in the stage's detail (kept in the run's events, not shown), so a resumed run's reuse can be seen
    this.emit({ type: 'stage', stage: 'pages', status: 'start', ...(!only && this.state.lanes ? { detail: `resumed: ${done} page${done === 1 ? '' : 's'} drawn already; ${kept.length ? `lanes carried on: ${kept.map((l) => `${l.name} (${l.pages.join(' ')})`).join(', ')}` : 'no lane conversation to carry on'}` } : {}) });
    this.state.stage = 'pages'; this.save();
    // this film's own components, when it has them: loaded before every page (META.extras), and no page's file tools
    // may change them
    if (this.state.kit?.status === 'done') { this.serverMeta(); freeze(this.o.dir, KIT_FILE); }
    this.freezePictures();
    const sb = this.project.storyboard();
    const tl = await this.project.timeline();
    const todo = tl.pages.filter((p) => (!only || only.includes(p.id)) && !['ok', 'flagged'].includes(this.state.pages[p.id]?.status ?? ''));
    const failures = (id: string) => this.state.pages[id]?.failures ?? 0;
    this.redraw = new Set(this.o.pages ? todo.filter((p) => failures(p.id) > 0).map((p) => p.id) : []);
    // A run that stopped while pages were in their checks (seen: the server restarted for a deploy): their drafts and
    // conversations are kept, so each picks up at the check it was in. Drawn again from nothing, they were paid twice
    this.inChecks = new Map(todo.flatMap((p) => {
      const was = this.state.pages[p.id];
      return was?.status === 'checking' && was.ref && was.rounds > 0 && !this.state.revision?.[p.id] && this.project.exists(`pages/${p.id}.js`) ? [[p.id, { ref: this.here(was.ref)!, rounds: was.rounds }]] : [];
    }));
    // a style drawn in pictures: its pages are written from the storyboard, no model draws them
    if (this.pictureStyle()?.led) {
      for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map((p) => this.ledPage(sb, p, tl)));
      await this.commit(this.say('按分镜画好各页', 'Pages drawn from the storyboard'));
      return this.pagesDone(only, o);
    }
    // a page that failed is drawn again on its own terms (redraw), never in the lane it failed in
    const failed = new Set(todo.filter((p) => this.state.pages[p.id]?.status === 'failed').map((p) => p.id));
    for (const p of todo) this.setPage(p.id, { status: 'queued', rounds: 0, issues: [], failures: failures(p.id) });
    // the film's drawing (not a redraw of some pages, not a change): in lanes, carrying on from the first page's session
    const opener = tl.pages[0]?.id, seed = opener && !todo.some((p) => p.id === opener) ? this.here(this.state.pages[opener]?.ref) : undefined;
    const left = new Set(todo.map((p) => p.id));
    const goOn = kept.map((l) => ({ ...l, pages: l.pages.filter((id) => left.has(id) && !failed.has(id)) })).filter((l) => l.pages.length);
    if (!only && !this.state.revision && this.lanesOn() && (todo.length > 1 || goOn.length)) {
      const taken = new Set(goOn.flatMap((l) => l.pages));
      const fresh = todo.filter((p) => !this.inChecks.has(p.id) && !taken.has(p.id));
      // a new lane's transcript never takes the name of one going on (a lane named for a page that failed in it, say)
      const used = new Set(goOn.map((l) => l.file));
      const fileFor = (name: string) => { let f = `.studio/sessions/${name}.json`; for (let i = 2; used.has(f); i++) f = `.studio/sessions/${name}-${i}.json`; used.add(f); return f; };
      const planned = [
        // a lane going on: its own conversation, the page it was on first (in its checks if it got there: page() picks
        // that up from inChecks), told once that it was stopped
        ...goOn.map((l) => ({ saved: l, pages: todo.filter((p) => l.pages.includes(p.id)), lane: { name: l.name, cur: l.name, drawn: true, again: true, resume: this.project.file(l.file) } as Lane })),
        ...lanesOf(fresh, laneCount(tl.pages.length)).map((pages) => {
          const name = `page-${pages[0].id}`, file = fileFor(name);
          const forked = seed && fs.existsSync(seed) ? this.fork(seed, name, file) : undefined;
          if (!forked) fs.rmSync(this.project.file(file), { force: true });   // an earlier run's, whose pages are all drawn
          // (a transcript under the lane's own name is where the runtime keeps it anyway)
          const lane: Lane = { name, cur: name, drawn: !!seed, resume: forked ?? (file === `.studio/sessions/${name}.json` ? undefined : this.project.file(file)) };
          return { saved: { name, file, pages: pages.map((p) => p.id) }, pages, lane };
        }),
      ];
      this.state.lanes = planned.map((x) => x.saved); this.save();
      const runs = planned.map(({ pages, lane }) => async () => { try { for (const p of pages) { if (this.o.signal?.aborted) break; await this.page(sb, p, lane); } } finally { await lane.s?.close(); if (lane.s) this.drewAll = lane.s.ref; } });
      // pages picked up in their checks outside any lane going on: in sessions of their own, as before
      const picked = todo.filter((p) => this.inChecks.has(p.id) && !taken.has(p.id)).map((p) => () => this.page(sb, p));
      const m = this.model('page-').runtime.model;
      const paysToCache = m.provider === 'anthropic' || /claude/i.test(m.id);
      const warm = new Promise<void>((ok) => { this.firstTurn = ok; setTimeout(ok, 90_000); });
      this.drewAll = undefined;
      const [lead, ...rest] = [...runs, ...picked];
      const led = lead();
      if (rest.length && paysToCache) await Promise.race([warm, led]);
      const settled = await Promise.allSettled([led, ...rest.map((go) => go())]);
      const thrown = settled.find((x): x is PromiseRejectedResult => x.status === 'rejected');
      if (thrown) throw thrown.reason;
      this.firstTurn = undefined;
      // the whole-film check carries on from the session that drew every page (one lane): its prompt is cached already
      if (runs.length !== 1 || picked.length) this.drewAll = undefined;
      return this.pagesDone(only, o);
    }
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
    return this.pagesDone(only, o);
  }

  /** the pages are all drawn or given up: failed ones stop the film with why; otherwise it goes on to its review */
  private pagesDone(only: string[] | undefined, o: { hold?: boolean }) {
    const bad = Object.entries(this.state.pages).filter(([id, s]) => s.status === 'failed' && (!o.hold || only?.includes(id)));
    const ids = bad.map(([id]) => id);
    if (o.hold && !bad.length) return;
    this.emit({ type: 'stage', stage: 'pages', status: bad.length ? 'failed' : 'done', detail: bad.length ? this.say(`失败：${ids.join('、')}`, `Failed: ${ids.join(', ')}`) : undefined });
    if (bad.length) throw new Error(this.notDrawn(bad));
    this.state.stage = 'review'; this.state.lanes = undefined; this.save();
  }

  /**
   * Why pages were not drawn, and what to do: the reasons pages share said once, a model service's trouble (key,
   * balance, limits, network) in words the user can act on, and the way forward when the pages themselves defeat it.
   */
  private notDrawn(bad: [string, PageState][]): string {
    const ids = bad.map(([id]) => id), byReason = new Map<string, string[]>();
    for (const [id, s] of bad) { const r = (s.issues[0]?.msg ?? '').split('\n')[0].slice(0, 240); byReason.set(r, [...(byReason.get(r) ?? []), id]); }
    // a hosted service's credential refused is said in words, not as its JSON
    const reasons = [...byReason].map(([r, of]) => (byReason.size > 1 ? `${of.join(this.say('、', ', '))}: ` : '') + (HOSTED_HICCUP.test(r) ? this.say('连接中断', 'the connection dropped') : r || this.say('原因不明', 'no reason given')));
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

  /** whether pages are drawn in lanes: a runtime whose session can be resumed from a copy of another's transcript */
  private lanesOn() { return this.model('page-').runtime.id === 'pi'; }
  /** the saved lanes whose transcripts are here, with the pages each has not drawn yet (one that failed included: the
   *  caller leaves those out) */
  private keptLanes(): SavedLane[] {
    const open = (id: string) => !['ok', 'flagged'].includes(this.state.pages[id]?.status ?? '');
    return (this.state.lanes ?? []).filter((l) => fs.existsSync(this.project.file(l.file))).map((l) => ({ ...l, pages: l.pages.filter(open) })).filter((l) => l.pages.length);
  }
  /** a copy of a session's transcript under `name` (at `file`, project-relative), to resume as a session of its own (the
   *  first page's for a lane) */
  private fork(ref: string, name: string, file = `.studio/sessions/${name}.json`) {
    if (!fs.existsSync(ref)) return ref;   // nothing on disk to copy (a runtime that keeps it elsewhere): resumed as it is
    const to = this.project.file(file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (path.resolve(ref) !== path.resolve(to)) fs.copyFileSync(ref, to);
    return to;
  }

  /** a page of a style drawn in pictures, written from its scenes' cues and focus (pictures.ts ledPage) */
  private async ledPage(sb: Storyboard, t: PageTiming, tl: { pages: PageTiming[] }) {
    const plan = picturePlan(sb.look, this.pictureStyle(), this.own()), drawn = readPictures(this.o.dir).items;
    const scenes = picturesOn(plan, drawn, t.id).filter((p) => p.kind === 'scene');
    // a page with no scene of its own holds the last one before it
    const earlier = tl.pages.slice(0, tl.pages.findIndex((p) => p.id === t.id)).reverse();
    const before = earlier.map((p) => picturesOn(plan, drawn, p.id).filter((x) => x.kind === 'scene').pop()).find(Boolean);
    this.project.write(`pages/${t.id}.js`, ledPage(t.id, scenes, t.cues.map((c) => c.at), t.end - t.start, before));
    // its film-strip thumbnail, as a drawn page gets one after its check: the last scene, drawn in whole
    let thumb: string | undefined;
    try { thumb = await this.project.snap(`${t.id}-thumb`, [Math.max(t.start + 0.5, t.end - 0.4)], [t.id], 480, false); } catch (e) { if (stopped(e)) throw e; }
    this.setPage(t.id, { status: 'ok', rounds: 0, issues: [], failures: this.state.pages[t.id]?.failures }, { thumb });
  }

  private async page(sb: Storyboard, t: PageTiming, lane?: Lane) {
    const id = t.id;
    if (this.pictureStyle()?.led) return this.ledPage(sb, t, await this.project.timeline());
    const was = this.inChecks.get(id);
    const st: PageState = { status: 'drawing', rounds: 0, issues: [], failures: this.state.pages[id]?.failures };
    this.setPage(id, st);
    let s: AgentSession | undefined;
    try {
      const system = pageSystem(this.o.style, styleExtras(this.o.style), this.o.brief.preferences, this.o.brief.styleNotes, this.designed()?.card, this.filmKit()) + this.canvas('artist');
      if (lane) { lane.cur = `page-${id}`; s = lane.s ??= await this.session(lane.name, system, MAX.pageTurns, lane.resume, undefined, { answers: [FLAG] }, () => lane.cur); }
      // a page picked up in its checks resumes its conversation; a lane's is shared, so it goes on in a copy
      else s = await this.session(`page-${id}`, system, MAX.pageTurns, was?.ref && this.lanesOn() ? this.fork(was.ref, `page-${id}`) : was?.ref, undefined, { answers: [FLAG] });
      // its turns over its life: a page's worth more for each page it takes (a lane's grows as it goes)
      this.allow(s, MAX.pageBudget);
      // in a lane the session has drawn pages before this one: it says which page it is on now in every message
      const next = (lane?.again ? laneResumed(id, this.project.exists(`pages/${id}.js`)) : '') + (lane?.drawn ? laneNote(id) : '');
      if (lane) lane.again = false;
      const on = lane ? `pages/${id}.js: ` : '';
      // a page the change adds has no code yet (seen: an end card added to the storyboard; reading its code failed the
      // page on every Continue): it is drawn from nothing, with the change as its brief
      const added = this.state.revision?.[id] !== undefined && !was && !this.project.exists(`pages/${id}.js`);
      const fix = added ? undefined : this.state.revision?.[id];
      // a revision's page already exists, so "is there a file" says nothing: what tells is whether the code changed
      // (seen: a revision whose edits never landed was checked, passed and shown as done, on the old page)
      const before = fix && !this.wordsChanged ? this.project.read(`pages/${id}.js`) : undefined;
      const unchanged = () => before !== undefined && this.project.read(`pages/${id}.js`) === before;
      let r: TurnResult | undefined, declined: string | undefined;
      if (!was) {
        r = await this.send(s, next + pagePrompt(sb, id, t, this.filmLang(), this.replyLang(), !!fix, this.o.brief.brand, this.assetsOn(sb, id), picturePageNote(this.picturesOn(sb, id), this.pictureStyle())) + (fix ? revisionNote(id, fix, this.project.read(`pages/${id}.js`), this.state.firstPage === 'waiting') : added ? addedNote(this.state.revision![id]) : '') + directionsNote(this.directions(`page-${id}`)), this.picturesSeen(sb, id), PAGE_THINKING);
        if (!this.project.exists(`pages/${id}.js`)) r = await this.send(s, `pages/${id}.js does not exist yet; write it, then stop.`, undefined, PAGE_THINKING);
        if (!this.project.exists(`pages/${id}.js`)) throw new Error(r.error || this.say('没有写出页面文件', 'No page file was written'));
        // the agent found nothing to change (already so, or nothing this page can do): it says why instead of searching
        declined = unchanged() && flagOf(r) !== undefined ? flagOf(r)!.trim() || this.say(NOT_MADE.zh, NOT_MADE.en) : undefined;
        if (declined) { st.status = 'flagged'; st.issues = [{ from: 'agent', msg: declined }]; }
        else if (unchanged()) r = await this.send(s, `pages/${id}.js is exactly as it was: the change was not made${r.error ? ` (${r.error})` : ''}. Make it now with edit. If an edit failed, its old_string must be copied exactly from the current file; read the file first if unsure.`, undefined, PAGE_THINKING);
        // a revision's page: the agent's one sentence on what it changed, told to the user when the change is drawn
        if (fix && !declined && r.text.trim()) this.changed.set(id, r.text.trim());
      }
      st.ref = s.ref;
      if (lane) lane.drawn = true;
      if (!was) await this.commit(this.say(`${id}：初稿`, `${id}: first draft`));
      // Each round: the page is checked (lint and a contact sheet, one browser) and a reviewer that did not draw it looks
      // at the sheet. The page is done when the reviewer passes it and lint has no error; otherwise the problems go back
      // to its agent, and the page is checked again. `checked`: the page's code as it was at the last check, and
      // `issues` / `verdict` what that check found
      const code = () => this.project.read(`pages/${id}.js`);
      let issues: LintIssue[] = [], verdict: { pass: boolean; problems: Problem[] } | undefined, checked: string | undefined;
      let reviewer: AgentSession | undefined;
      const hard = this.o.pageChecks === 'hard';
      // 'hard': the draft and one round of fixes, of what a viewer would see broken
      const checks = hard ? 2 : fix ? MAX.revisionChecks : MAX.pageChecks;
      const mustFix = (all: LintIssue[]) => errorsOf(all).filter((i) => !hard || HARD.includes(i.kind));
      // a page whose code still throws (or calls what the engine does not have) after its rounds is not drawn, and its
      // film pauses with an error: it gets up to brokenChecks more, for that alone (2026-10-27: two films paused so in a
      // morning, each page's one fix round spent on an error raised deep in the engine by a call with its options third)
      const brokenNow = () => issues.some((i) => BROKEN.includes(i.kind));
      const last = (round: number) => round >= checks && !(brokenNow() && round < checks + MAX.brokenChecks);
      try {
        for (let round = was?.rounds ?? 1; !declined && round <= checks + MAX.brokenChecks; round++) {
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
          if (!hard) {
            reviewer ??= await this.session(`check-${id}`, reviewerSystem(this.o.style, this.o.brief.styleNotes, this.designed()?.card) + kitReviewNote(this.kitItems()) + this.canvas('reviewer'), MAX.reviewerTurns, undefined, undefined, { tools: 'none', answers: [VERDICT] });
            verdict = await this.verdict(reviewer, reviewerPrompt(sb, id, t, round, issues, times, change, this.o.brief.brand, this.assetsOn(sb, id), pictureReviewNote(this.picturesOn(sb, id)), this.directions()), c.sheet);
          }
          const errors = mustFix(issues), problems = verdict?.pass === false ? verdict.problems : [];
          if (!errors.length && !problems.length) { st.status = 'ok'; st.issues = []; break; }
          if (last(round)) break;
          // past its own rounds, only what keeps the page from being drawn is asked for
          const extra = round >= checks;
          r = await this.send(s, on + fixPrompt(round, extra ? errors.filter((i) => BROKEN.includes(i.kind)) : errors, extra ? [] : problems, times, change) + this.unseen(`page-${id}`), [c.sheet], PAGE_THINKING);
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
        const errors = mustFix(issues), problems = verdict?.pass === false ? verdict.problems : [];
        st.status = errors.length || problems.length ? 'flagged' : 'ok';
        st.issues = [...errors.map(fromLint), ...problems.map(fromReview)];
      }
      // the change never landed: the page is as it was, which is not what the user asked for, whatever the checks said
      if (unchanged()) {
        if (!declined) { st.status = 'flagged'; st.issues = [{ from: 'run', kind: 'not-made', msg: NOT_MADE.en }]; }
        this.unchanged.set(id, declined);
      }
      if (!lane) await s.close();
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
    // a style drawn in pictures: its pages are written by rule, nothing for a reviewer to fix
    if (this.pictureStyle()?.led) {
      this.emit({ type: 'stage', stage: 'review', status: 'skipped', detail: this.say('各页按分镜生成，无需检查', 'Pages are drawn from the storyboard: nothing to check') });
      return this.ready();
    }
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
    const s = await this.session('review', pageSystem(this.o.style, styleExtras(this.o.style), this.o.brief.preferences, this.o.brief.styleNotes, this.designed()?.card, this.filmKit()) + this.canvas('artist'), MAX.pageTurns, this.drewAll ? this.fork(this.drewAll, 'review') : undefined, signal, this.drewAll ? { answers: [FLAG] } : {});
    // (carrying on from the pages' conversation, it keeps their tools: a transcript that used flag is refused without it)
    let timedOut = false;
    try {
      for (let round = 1; round <= (defectsOnly ? 1 : MAX.reviewRounds); round++) {
        await this.send(s, reviewPrompt(round === 1 ? issues : errorsOf(await this.project.lint()), flagged, this.replyLang()), [sheet]);
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
    // the film is made: a length ffmpeg can't read here (it couldn't start in this process) is the time line's, not a failed export
    const duration = await this.project.duration(out.withSubs).catch(async () => (await this.project.timeline()).duration);
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

  /** what kind of change the user asks of a finished film, when the decision model is sure of it (CHANGE_KINDS) */
  private async changeKind(request: string): Promise<keyof typeof CHANGE_KINDS | undefined> {
    if (!this.o.decide) return undefined;
    const [said, refs] = [request.replace(/<references>[\s\S]*?<\/references>/, '').trim(), /<references>([\s\S]*?)<\/references>/.exec(request)?.[1]?.trim()];
    const a = await choose(this.o.decide, { request: said, ...(refs ? { pointsAt: refs } : {}) }, CHANGE_QUESTION, CHANGE_KINDS, this.o.signal);
    return a && a.p >= CHANGE_SURE ? a.choice as keyof typeof CHANGE_KINDS : undefined;
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
    // a change to how the page(s) it names look needs no planning: it goes straight to those pages' agents. Anything
    // else (the words, a generated picture, more than those pages, no change at all), or a kind the decision model isn't
    // sure of, is planned first. A style drawn in pictures has no page agent (its pages are written from the scenes):
    // always planned (seen: four asks to fix a face went straight to their page and changed nothing)
    const kind = await this.changeKind(request);
    const direct = !this.pictureStyle()?.led && named.length > 0 && named.length <= 2 && kind === 'look';
    const storyboard = this.project.read('storyboard.json');
    let plan: RevisionPlan | undefined = direct ? named.map((id) => ({ id, note: request })) : undefined;
    if (!plan) {
      // a question or thanks is answered, not looked into as a change
      if (kind !== 'talk') this.emit({ type: 'note', text: this.say('收到，我先看看要改哪几页', 'Got it. Let me see which pages this touches') });
      const got = await this.planRevision(request, named);
      if ('why' in got) this.fail('pages', got.why);
      plan = got.plan;
    }
    // pictures the change added, changed or names to draw again are drawn before the pages that place them
    // (a direct change has no plan file of its own; a plan with no pages may still name a picture to draw again)
    const redrawn = direct ? 0 : await this.changePictures(sb.look);
    const tPlan = Date.now();
    // a change to the narration can leave a page's code as it is (its timing follows the script): only a change to the
    // picture must show in the page's code
    this.wordsChanged = this.project.read('script.js') !== script;
    // the storyboard as the planner left it: a page it added is in the plan too
    const pagesNow = this.project.storyboard().pages;
    const num = (id: string) => pagesNow.findIndex((p) => p.id === id) + 1;
    const ids = plan.map((p) => p.id);
    if (!ids.length) {
      // nothing on screen changes: the planner has told the user why (a question answered, thanks, or a whole-film
      // setting such as the style or the voice's speed, which a change can't make). A change to the words alone (the
      // narration, how a word is read) is voiced again and checked; anything else leaves the film as it was
      const touched = this.wordsChanged || this.project.read('storyboard.json') !== storyboard;
      if (!touched && redrawn) {
        // a picture drawn again, its pages already pointed at the new file: nothing else to draw
        this.state.exported = false; this.state.change = undefined; this.save();
        return this.ready();
      }
      if (!touched) {
        this.state.change = undefined;
        return this.ready();
      }
      this.emit({ type: 'note', text: this.say('只改了文字，画面不用重画', 'Only the words change; no page is redrawn') });
      this.serverMeta();
      if (this.o.tts && this.o.voice) await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles });
      this.state.exported = false; this.save();
      await this.review();
      this.state.change = undefined; this.save();
      return;
    }
    const nums = ids.map(num);
    const which = this.say(nums.map((n) => `第 ${n} 页`).join('、'), (nums.length > 1 ? 'pages ' : 'page ') + nums.join(', '));
    this.emit({ type: 'note', text: direct ? this.say(`直接改${which}的画面，其余的保持不变`, `Changing the picture on ${which}; everything else stays as it is`) : this.say(`要重画${which}，其余的保持不变`, `Redrawing ${which}; everything else stays as it is`) });
    this.serverMeta();
    if (this.o.tts && this.o.voice) await narrate(this.o.dir, { tts: this.o.tts, voice: this.o.voice, signal: this.o.signal, child: childCmd, files: projectFiles });   // cached pages cost nothing
    // a page whose plan says no more than its id is changed as the user asked
    this.state.revision = Object.fromEntries(plan.map((p) => [p.id, p.note ?? request]));
    this.state.exported = false;
    for (const id of ids) this.state.pages[id] = { status: 'queued', rounds: 0, issues: [] };
    this.state.stage = 'pages'; this.save();
    const tDraw = Date.now();
    this.changed.clear();
    await this.pages(ids);
    this.state.revision = undefined; this.save();
    const tPages = Date.now();
    // pages the change never reached are said plainly, not left to a film that looks done: why, when the agent said
    for (const [id, why] of this.unchanged) if (why) this.emit({ type: 'note', text: this.say(`第 ${num(id)} 页没有改：${why}`, `Page ${num(id)} was not changed: ${why}`) });
    const missed = [...this.unchanged].filter(([, why]) => !why).map(([id]) => num(id));
    if (missed.length) this.emit({ type: 'note', text: this.say(`${missed.map((n) => `第 ${n} 页`).join('、')}没有改上，画面还是原来的。换个说法再告诉我一次？`, `${missed.length > 1 ? 'Pages' : 'Page'} ${missed.join(', ')} did not change; the picture is as it was. Could you ask again in other words?`) });
    // where the time went, in one line, so a slow step is seen (and can be fixed) instead of only felt
    // what each redrawn page now shows differently, said once the film plays again: a change that looks alike at a
    // glance (a beat's timing, a label) is otherwise taken for no change at all
    const revised = ids.filter((id) => !this.unchanged.has(id)).map((id) => {
      const what = this.changed.get(id), section = pagesNow.find((p) => p.id === id)?.section;
      return { id, n: num(id), ...(section ? { section } : {}), ...(what ? { what } : {}) };
    });
    this.changed.clear();
    const sec = (ms: number) => this.say(`${Math.max(1, Math.round(ms / 1000))} 秒`, `${Math.max(1, Math.round(ms / 1000))} s`);
    this.beforeReady = () => { if (revised.length) this.emit({ type: 'revised', pages: revised }); this.emit({ type: 'note', text: this.say(
      `这次改了 ${sec(Date.now() - t0)}：${direct ? '' : `想怎么改 ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `配音 ${sec(tDraw - tPlan)} · ` : ''}画和自检 ${sec(tPages - tDraw)} · 全片检查 ${sec(Date.now() - tPages)}`,
      `This change took ${sec(Date.now() - t0)}: ${direct ? '' : `planning ${sec(tPlan - t0)} · `}${tDraw - tPlan > 1500 ? `voice ${sec(tDraw - tPlan)} · ` : ''}drawing and checks ${sec(tPages - tDraw)} · whole-film check ${sec(Date.now() - tPages)}`) }); };
    await this.review();
    this.unchanged.clear();
    this.state.change = undefined; this.save();
  }
  /** the user's pictures a page places: named by its storyboard, or by the change asked of it. Read from the film's list
   *  now, so a picture added while the film is made is placed by the pages drawn after it */
  private assetsOn(sb: Storyboard, id: string) { return assetsOn(userAssets(this.project.dir), sb.pages, id, this.state.revision?.[id]); }
  /** the page's pictures as its agent is shown them with its brief, in picturePageNote's order (seen: an agent that only
   *  read the description drew a second sun beside the one in its scene): a file too large to attach is left to read */
  private picturesSeen(sb: Storyboard, id: string): string[] | undefined {
    const files = this.picturesOn(sb, id).map(picturePath).filter((f) => { try { return fs.statSync(this.project.file(f)).size <= PICTURE_BYTES_SHOWN; } catch { return false; } });
    return files.length ? files : undefined;
  }
  private picturesOn(sb: Storyboard, id: string) { return picturesOn(picturePlan(sb.look, this.pictureStyle(), this.own()), readPictures(this.o.dir).items, id); }
  /** what each page of a revision changed, in its agent's words */
  private changed = new Map<string, string>();
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
  /** the transcript of the one lane that drew every page of this run, for the whole-film check to carry on from */
  private drewAll?: string;
  /** each session's last error from its model service */
  private lastError = new WeakMap<AgentSession, string>();
  /** each session's turns over its life, and its budget (allow) */
  private budgets = new WeakMap<AgentSession, Budget>();

  /**
   * The planner's half of a revision: which pages, and what to change on each (written to .studio/revision.json). A
   * planner that leaves no usable plan (seen: it edited the script and stopped; its model failed before a word; it wrote
   * a file that would not parse) is asked once more, told what was wrong; a second miss is said to the user in words
   * they can act on.
   */
  private async planRevision(request: string, named: string[], first?: string): Promise<{ plan: RevisionPlan } | { why: string }> {
    const system = plannerSystem(this.o.style, this.o.brief.preferences, this.o.brief.styleNotes, this.o.brief.brand, userAssets(this.project.dir)) + this.canvas('planner');
    // a fresh, small session per change: resuming the planner would carry the whole making of the film (slow, and every
    // token of it re-read); the files hold everything this decision needs
    let s = await this.session('reviser', system, MAX.planTurns);
    fs.rmSync(this.project.file(PLAN_FILE), { force: true });   // last change's plan is not this one's
    const read = () => readRevisionPlan(this.project.exists(PLAN_FILE) ? this.project.read(PLAN_FILE) : undefined, this.project.storyboard().pages.map((p) => p.id));
    try {
      let r = await this.send(s, first ? this.firstPagePlanPrompt(request, first) : this.planPrompt(request, named), undefined, PLAN_THINKING);
      let got = read();
      if ('plan' in got) return got;
      if (r.stopReason === 'error') {
        // the model gave no answer (its service failed): the same question again, in a session of its own
        await s.close();
        s = await this.session('reviser', system, MAX.planTurns);
        r = await this.send(s, first ? this.firstPagePlanPrompt(request, first) : this.planPrompt(request, named), undefined, PLAN_THINKING);
      } else {
        r = await this.send(s, `${got.problem}, so the change can't go ahead. Write ${PLAN_FILE} now, as { "pages": [{ "id": "p03", "note": "…" }] } with the storyboard's page ids, or { "pages": [] } when no page's picture changes. Keep what you already changed in the files; don't do it again.`, undefined, PLAN_THINKING);
      }
      got = read();
      if ('plan' in got) return got;
      const service = r.error ? serviceTrouble(r.error) : undefined;
      return { why: service ? this.say(service.zh, service.en) : this.say(
        '这次没能定下要怎么改，片子还是原来的样子。换个说法再说一次，最好说明是第几页、要改成什么样。',
        "I couldn't work out how to make this change, so the film is as it was. Could you ask again in other words, saying which page and what it should become?") };
    } finally {
      await s.close();
    }
  }
  /** what the planner is told of a change: the request, the storyboard and script as they are now, the pages it names */
  private planPrompt(request: string, named: string[]) {
    const sb = this.project.storyboard();
    // hand over what the decision needs up front (the script, and the code of the pages the request names) — reading
    // them file by file costs a model round trip each
    const code = named.map((id) => `pages/${id}.js:\n\`\`\`js\n${this.project.read(`pages/${id}.js`)}\n\`\`\``).join('\n\n');
    return `The film is finished. The user's change to it:
${request}

Decide which pages to change and how: change only the pages that need it (usually 1–2, and every page the user's words reach when they ask for more). Touch script.js only when the user asks to change the narration; then change the matching cues and keep their number the same.
When the user asks for more than a page can hold (everything, more detail, a full review, more examples), add pages instead of packing one: each new page gets an id after the last one, its entry in storyboard.json and its cues in script.js (3–8 short lines, like the others), and goes in the plan with a note of what it shows. Add as many as the request needs; one page per topic is a good measure.
${[voiceNote('revise', this.o.brief.voice), langNote('revise', this.filmLang(), this.replyLang()).trim()].filter(Boolean).join('\n')}${this.revisionPictureNote()}
Write the decision to ${PLAN_FILE}: { "pages": [{ "id": "p03", "note": "the change for the page agent, down to objects and actions" }] }, with the page ids exactly as in the storyboard, then tell the user in one sentence what you will change.
Always write the file. When no page's picture changes, write { "pages": [] }: for a change to the narration alone (in script.js), a question, thanks, or something a change can't do here (another style, the voice's speed), which you then tell the user in a sentence or two.
The storyboard and script.js${named.length ? ' and the code of the pages mentioned' : ''} are given below; don't read them again. Read pages/<id>.js for other pages only if you need to.
You decide only which pages change and what they should become; the page agent writes the code. Don't look into the engine, take screenshots or run tools. When the user points at a page (a page in <references>), that is usually the page to change.

Storyboard: ${sb.pages.map((p) => `${p.id} ${p.section}: ${p.say}`).join('\n')}

script.js:
\`\`\`js
${this.project.read('script.js')}
\`\`\`${code ? `\n\n${code}` : ''}`;
  }

  /** for a style with generated pictures: a change may add or change them (they are drawn before its pages) */
  private revisionPictureNote() {
    const style = this.pictureStyle();
    if (!style) return '';
    const drawn = this.planned().filter((p) => readPictures(this.o.dir).items.some((x) => x.id === p.id));
    return `\nThis film may use generated pictures, listed in storyboard.json's \`look.pictures\` (read storyboard.json to change it). When the change asks for what code draws poorly (people who look like people, a character or creature, the person's own mascot or product, a real thing, a place), add or change pictures there and say \`picture <id>\` in the note of each page that shows one: they are drawn before the pages. Leave every picture that stays exactly as it is (same id and words), or it is drawn and paid for again.${drawn.length ? `
The pictures drawn so far: ${drawn.map((p) => `${p.id}${style.led && p.pages.length ? ` (${p.pages.join(', ')}${p.cue !== undefined ? `, from the page's line ${p.cue + 1}` : ''})` : ''} (${p.what})`).join('; ')}. A page's code can't change what is inside a picture. When the user's words are about a picture itself (how a person or thing in it looks, a box, border, rim or paper around it, its pose or expression), add \`"pictures": [{ "id": "<its id>", "note": "what to change in it" }]\` to ${PLAN_FILE} beside "pages": it is drawn again before the pages, and the pages that show it keep their places for it.` : ''}${style.led ? `
This film's pages are written from its scenes, with no page agent: a page in "pages" changes nothing on screen by itself. Whatever the user sees wrong inside a scene (a face, eyes, hands, a pose, a word lettered in it) is changed only by drawing that scene again in "pictures", with a note of what to change; the scene shown at a moment is the last one that starts at or before that line of its page (the user's <references> give the page and the line). Name every scene the user's words reach ("this one and the next": both).` : ''}\n${picturePlanNote(style, this.own(), style?.led ? 'script' : undefined)}`;
  }

  /** what the planner is told of a change asked at the first page: it is about the whole film, whose other pages are not
   *  drawn yet, so the storyboard and the narration are its to change (firstPageChange) */
  private firstPagePlanPrompt(request: string, id: string) {
    return `The film's first page (${id}) is drawn so the user can see the look before the rest; no other page is drawn yet, and the narration is voiced. The user looked at it and said:
${request}

Take this as a direction for the whole film, not only its first page, and make the film follow it:
- When it is about what is said or how (an opening hook, a framing, what is linked or kept apart, what is left out or must be in, the order), change script.js and storyboard.json to match, on every page it reaches. The pages after the first are not drawn yet, so change their storyboard entries and their narration freely; a page's cues may be added or removed. Add pages (ids after the last one, each with its storyboard entry and its cues) only when the request needs more than the pages hold. Keep the ids of the pages that stay.
- When it is about the picture alone, leave both files as they are.
${[voiceNote('revise', this.o.brief.voice), langNote('revise', this.filmLang(), this.replyLang()).trim()].filter(Boolean).join('\n')}${this.revisionPictureNote()}
Then write ${PLAN_FILE} with what the first page's agent must change, down to objects and actions: { "pages": [{ "id": "<the first page's id>", "note": "…" }] }. Then tell the user in one or two sentences what you changed: the narration, the plan of the pages, the first page.
The storyboard and script.js are given below; don't read them again. Don't look into the engine, take screenshots or run tools other than to edit the files.

Storyboard (storyboard.json):
\`\`\`json
${this.project.exists('storyboard.json') ? this.project.read('storyboard.json') : JSON.stringify(this.project.storyboard(), null, 2)}
\`\`\`

script.js:
\`\`\`js
${this.project.read('script.js')}
\`\`\`

The first page's code (pages/${id}.js), for what it shows now:
\`\`\`js
${this.project.exists(`pages/${id}.js`) ? this.project.read(`pages/${id}.js`) : ''}
\`\`\``;
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
    // and so are its pictures, from the sample the user confirmed
    if (this.state.stage === 'narrate') await both(this.narrate(), this.kit(), this.pictures());
    if (this.state.stage === 'pages' && !this.state.kit) await this.kit();   // a run that stopped before its kit was done
    if (this.state.stage === 'pages' && !this.state.pictures) await this.pictures();
    // the voice was changed after the narration was made (while paused): narrate again before going on
    if ((this.state.stage === 'pages' || this.state.stage === 'review') && this.voiceStale()) await this.revoice();
    if (this.state.stage === 'pages') { await this.firstPage(approve); await this.pages(); }
    if (this.state.stage === 'review') await this.review();
    if (this.state.stage === 'render') await this.ready();   // a run saved before exports were separate: it is ready to preview
    if (this.state.change) { this.state.change = undefined; this.save(); }
  }

  /** the exported mp4 if it shows the film as it is now */
  get exported(): string | undefined { return this.state.exported !== false && this.state.video ? this.state.video : undefined; }
}

export const projectFile = (dir: string, rel: string) => path.join(dir, rel);
