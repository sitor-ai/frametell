// System prompts for each stage, assembled from prompts/*.md and the chosen style's grammar card, and the per-stage
// user messages. Stable text first (system), changing text last (user), so provider prompt caches stay warm.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { Type } from 'typebox';
import type { PageTiming, Storyboard, LintIssue } from './project.js';
import type { AnswerTool } from './runtime/types.js';

import { pagePack } from './pagepack.js';
import { designedFonts } from './look.js';
import { KIT_CHECK_FILE, KIT_FILE, KIT_MAX, KIT_MIN_PAGES, type KitItem } from './kit.js';
import { brandFilesOn, brandPageNote, brandReviewNote, brandSection, signsOff, type BrandBrief } from './brand.js';

// found through the package itself, so it still resolves when the code is bundled (the desktop app)
const DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/agent/package.json')), 'prompts');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const grammar = (style: string) => {
  const f = path.join(ENGINE_DIR, 'styles', style, 'GRAMMAR.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : `Style: ${style}`;
};

/** fallback names; the panel shows its own translated names for these ids */
export const STYLES: { id: string; name: string; summary: string }[] = [
  { id: 'warm-story', name: 'Warm illustration', summary: 'Warm flat illustration with one metaphor object carried through the film; for investing, everyday life and psychology' },
  { id: 'study', name: 'Quiet study', summary: 'Hand-drawn on paper, ink lines and light washes; for books, history and methods' },
  { id: 'whiteboard', name: 'Whiteboard', summary: 'Marker on a whiteboard, drawn while explaining; for breaking down concepts, business models, methods and processes' },
  { id: 'chalkboard', name: 'Chalkboard', summary: 'Chalk on a dark green board; for maths, physics, history and other step-by-step classroom explanations' },
  { id: 'tech-dark', name: 'Dark technical', summary: 'Clean architecture diagrams and code on dark graphite; for software, AI and how systems work' },
];

/**
 * 「创作偏好」: what the user wrote once in Settings for every film. Last in the system prompt, so the stable part above
 * still caches across users; below the engine's rules, which it never overrides.
 */
export function preferencesSection(preferences?: string) {
  const p = preferences?.trim();
  return p ? `---\n# The user's standing preferences\n\nThe user wrote these in Settings, for every film they make. Follow them wherever they bear on your part of the work. This film's own request, and anything the user says while it is made, come first; the technical rules above always hold.\n\n<preferences>\n${p}\n</preferences>` : '';
}

/** A film's own look on top of its style: notes the user keeps with a style they shaped (in Frametell Cloud, from their
 *  own films). After the style card, so they are read as that style's details, not as a new style. */
export function styleNotesSection(notes?: string) {
  const n = notes?.trim();
  return n ? `---\n# This film's own look\n\nThe user shaped the style above for their films, and keeps these notes with it: how they like it drawn and told. Follow them wherever they bear on your part of the work, as long as the style's rules above still hold. This film's own request, and anything the user says while it is made, come first.\n\n<style-notes>\n${n}\n</style-notes>` : '';
}

/** A designed style's film (one whose style has no look of its own): the style card the director wrote for it in
 *  storyboard.json. After the style's own card, which says how to read it; binding on every page. */
export function filmCardSection(card?: string) {
  const c = card?.trim();
  return c ? `---\n# This film's style card\n\nThe director designed this film's look, and wrote it here. It is this film's style: hold every page to it, as you would a style's own card. The palette and the typeface it names are already set for the film (\`ink\`, \`paper\` and the other colour names, the hand and latin faces): use them by name, don't restate them as hex. This film's own request, and anything the user says while it is made, come first.\n\n<style-card>\n${c}\n</style-card>` : '';
}

/** `brand`: the brand the film is made for, after the style card and its notes */
export function plannerSystem(style: string, preferences?: string, styleNotes?: string, brand?: BrandBrief) {
  return [read('PLANNER.md'), '---\n# This film\'s style (the page agent draws to it, so the storyboard must be drawable in it)\n\n' + grammar(style), styleNotesSection(styleNotes), brandSection(brand), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}
/** the page agent's system prompt: process, the style's grammar, the drawing API, the style's components with a worked
 *  example page, and the wider component library (the stable part of every page session, so it caches well) */
export function pageSystem(style: string, extras: string[] = [], preferences?: string, styleNotes?: string, card?: string, filmKit?: string) {
  return [read('PAGE.md'), '---\n# This film\'s style\n\n' + grammar(style), filmCardSection(card), styleNotesSection(styleNotes), '---\n' + read('API.md'), '---\n' + pagePack(style, extras, filmKit), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}

/** the film's language (narration, on-screen text) and the language the director reports in (the user's) */
export type Lang = 'zh' | 'en';
/** `voice`: the service that voices the narration; absent when the film has no voice. `preferences`: what the user
 *  wants in every film (Settings), read by every session. `styleNotes`: the user's notes for the style this film is
 *  drawn in (a style they shaped), read after the style card. `brand`: the brand the film is made for */
export interface Brief { topic?: string; audience?: string; durationSec: number; notes?: string; lang?: Lang; replyLang?: Lang; voice?: 'volcengine' | 'elevenlabs' | 'edge'; preferences?: string; styleNotes?: string; brand?: BrandBrief }

const LANG_NAME: Record<Lang, string> = { zh: 'Simplified Chinese', en: 'English' };
/** the language everything said to the user is written in: the user's own, never the prompts' */
export const replyNote = (replyLang?: Lang, lang?: Lang) => `Write everything you say to the user in ${LANG_NAME[replyLang ?? lang ?? 'zh']}.`;

/** What a stage must know about the language: the film's (narration, on-screen text) and the user's (the reports). It goes
 *  in the user messages, never the system prompts, so every film shares the cached part whatever its language. */
export function langNote(stage: 'storyboard' | 'script' | 'page' | 'revise', lang: Lang = 'zh', replyLang?: Lang) {
  const film = {
    zh: {
      storyboard: 'Film language: **Chinese**. In storyboard.json write `"lang": "zh"`; write title, summary, section, say and each beat\'s object / action / text in Simplified Chinese: on-screen text at most 8 characters per element, and a beat tied to a word names the Chinese word as spoken (`c2:三十年`).',
      script: 'Film language: **Chinese**. A cue is one short spoken sentence in Simplified Chinese, at most 16 characters, 3–8 per page; write numbers in Arabic digits and units as they are spoken (年, 元).',
      page: 'This is a Chinese film: all text on screen (titles, labels, units) is in Simplified Chinese, matching the narration.',
      revise: 'This is a Chinese film: rewrite narration in Simplified Chinese, keeping the number of cues; your notes to the page agent can be in English.',
    },
    en: {
      storyboard: 'Film language: **English**. In storyboard.json write `"lang": "en"`; write title, summary, section, say and each beat\'s object / action / text in English: on-screen text at most 5 English words per element, and a beat tied to a word names the English word (`c2:thirty`).',
      script: 'Film language: **English**. A cue is one short spoken English sentence, at most 12 words, 3–8 per page; write numbers in Arabic digits (1,000, 30%) and units as they are spoken (years, dollars).',
      page: 'This is an English film: all text on screen (titles, labels, units) is in English, matching the narration. English runs longer than Chinese, so leave enough width for text.',
      revise: 'This is an English film: rewrite narration in English, keeping the number of cues; your notes to the page agent can be in English.',
    },
  }[lang][stage];
  // the page agent's one sentence is shown to the user too
  return `\n${film}\n${replyNote(replyLang, lang)}`;
}

/** What a stage must know about the voice. Volcengine reads a tone instruction with each take (ElevenLabs ignores one);
 *  a film with no voice is timed by its cues and may be watched without subtitles, so its picture carries the meaning.
 *  In the user messages, like langNote, so the system prompts stay shared. */
export function voiceNote(stage: 'storyboard' | 'script' | 'revise', voice?: Brief['voice']) {
  if (!voice) return {
    storyboard: 'This film has no voice, and may be watched without subtitles: the picture alone must tell the story, so key words and numbers go on screen as text.',
    script: 'This film has no voice: nobody hears the cues. They time the picture, and become the subtitles if the user turns them on, so write each as a short caption that reads well on its own.',
    revise: 'This film has no voice: the cues only time the picture and serve as subtitles.',
  }[stage];
  if (voice !== 'volcengine') return '';
  return {
    storyboard: '',
    script: [
      "The narrator takes a tone instruction with each page. Give every page an `instruction`: one Chinese sentence on how that page is said (pace, warmth, where the weight falls). It replaces the film's default tone, so write it as a whole direction, e.g. `instruction: '放慢一点，像在揭晓答案，最后一句加重'`. Follow the film's arc: the hook curious and quick, the intuition relaxed, the key page slower and firmer, the close calm.",
      "When one line turns sharply from the rest of its page (a question to the viewer, a punchline, someone else's words quoted), give that cue its own: `{ t: '你猜结果是多少？', solo: { instruction: '真诚地发问，尾音上扬' } }`. A solo line is voiced as a separate take and loses the flow of its page, so use at most one per page and only where the tone really turns; most pages need none.",
    ].join('\n'),
    revise: "When you change a page's cues, keep its `instruction` (and any cue's `solo`) in step with the new lines.",
  }[stage];
}
const withVoice = (stage: 'storyboard' | 'script' | 'revise', brief?: Brief) => { const n = voiceNote(stage, brief?.voice); return n ? `\n${n}` : ''; };

export function storyboardPrompt(brief: Brief, style: string, materials: string[]) {
  return [
    'Stage 1: storyboard.',
    `The request: ${materials.length ? 'turn the material into' : 'make'} an explainer film of about ${Math.round(brief.durationSec / 60 * 10) / 10} minutes.` + (brief.topic ? ` Topic: ${brief.topic}.` : '') + (brief.audience ? ` Audience: ${brief.audience}.` : ''),
    materials.length ? '' : 'There is no material: explain it from your own knowledge. Use only well-established, checkable facts and numbers; when unsure, leave the number out. Every number on screen must also appear in that page\'s say (the server checks where numbers come from against say).',
    brief.notes ? `Further notes from the user: ${brief.notes}` : '',
    materials.includes('research.md') ? 'materials/research.md is a research brief prepared for this film from what the request points at (and the web): use its facts, the code and quotes it gives for the screen, and heed its Careful section. It is your main source for facts; the user\'s own words and material come first where they differ.' : '',
    `Style: ${style} (write "${style}" as the style in storyboard.json).`,
    designedFonts(style) ? kitPlanNote : '',
    `Material: ${materials.map((m) => 'materials/' + m).join(', ') || '(none; write from the topic)'}`,
    'Stop and report once storyboard.json is written.' + withVoice('storyboard', brief) + langNote('storyboard', brief.lang, brief.replyLang),
  ].filter(Boolean).join('\n');
}

/** a designed style's storyboard: the things that recur, listed so they are drawn once as this film's components */
const kitPlanNote = `When the film has ${KIT_MIN_PAGES} pages or more, also list in \`look.kit\` the things it draws again and again: an object, a map, a diagram, a character's stand-in, a recurring mark, anything that appears on 3 pages or more. Each is written once, in this film's look, as a component every page calls, so it looks the same wherever it appears and no page draws it from nothing. At most ${KIT_MAX}, the ones that recur most:
\`"kit": [{ "name": "chinaMap", "what": "China's outline in three terrain steps, one region can be lit", "pages": ["p03", "p04", "p05", "p12"] }]\`
\`name\` is the component's name in camelCase (it becomes \`P.chinaMap(…)\`), \`what\` says what it draws and what it must be able to show, \`pages\` lists the pages it appears on. Leave out what appears on fewer than 3 pages, and plain text, arrows and charts (the engine draws those). A shorter film has no \`kit\`.`;

export function storyboardFixPrompt(issues: { level: string; page?: string; beat?: number; msg: string }[], brief?: Brief) {
  return ['The server checked storyboard.json; fix the issues below (red must be fixed, yellow at your judgement):', ...issues.map((i) => `- [${i.level === 'red' ? 'red' : 'yellow'}] ${i.page ?? 'whole film'}${i.beat != null ? ` beat ${i.beat + 1}` : ''}: ${i.msg}`), 'Stop once fixed and say in one sentence what you changed. ' + replyNote(brief?.replyLang, brief?.lang)].join('\n');
}

export function scriptPrompt(feedback?: string, brief?: Brief) {
  return [feedback ? `The user's changes to the storyboard: ${feedback}\nFirst update storyboard.json to match, then write the narration.` : 'The user approved the storyboard without changes.', 'Stage 2: write script.js, run node engine/tools/script.mjs to see the estimated length, then stop and report.' + withVoice('script', brief) + langNote('script', brief?.lang, brief?.replyLang)].join('\n');
}

/** `brand`: the brand the film is made for; the files of it this page places are listed, with how to place them */
export function pagePrompt(sb: Storyboard, id: string, t: PageTiming, lang: Lang | undefined = sb.lang, replyLang?: Lang, revising = false, brand?: BrandBrief) {
  const p = sb.pages.find((x) => x.id === id);
  const outline = sb.pages.map((x) => `- ${x.id} ${x.section}`).join('\n');
  return `You own page **${id}**.

The film: ${sb.title} — ${sb.summary}
Its structure:
${outline}

## This page's storyboard
- Section: ${p?.section ?? ''}
- What it says: ${p?.say ?? ''}
- Key page: ${p?.core ? 'yes' : 'no'}
- Beats:
${(p?.beats || []).map((b, i) => `  ${i + 1}. [${b.at}] ${b.object} — ${b.action}${b.camera ? ` (camera: ${b.camera})` : ''}${b.text ? `, on-screen text "${b.text}"` : ''}`).join('\n')}

## This page's narration and timing (real voice)
The page lasts ${(t.end - t.start).toFixed(2)}s; its narration ends at ${(t.speechEnd - t.start).toFixed(2)}s (P.endT).
${t.cues.map((c) => `- c${c.i}: at ${c.at}s in the page, "${c.text}"`).join('\n')}${sb.pages[sb.pages.length - 1]?.id === id ? endingNote(t, signsOff(brand, sb.pages)) : ''}${brandPageNote(brandFilesOn(brand, sb.pages, id), brand?.emphasis)}

${revising ? `pages/${id}.js is already written; stop once the change below is made in it and say in one sentence what you changed.` : `Stop once pages/${id}.js is written and say in one sentence what you drew.`}${langNote('page', lang, replyLang)}`;
}

/** For the film's last page: the film ends on it, so it closes rather than turns */
function endingNote(t: PageTiming, signOff: boolean) {
  return `

## The film ends on this page
Nothing comes after it: after its last line the film holds ${(t.end - t.speechEnd).toFixed(1)}s on this page, then fades out by itself in its final second.
- Land the close with the last line: the last change arrives as it is spoken, and the main object ends resolved and whole in the frame (the hook's question answered), not mid-move.
- After \`P.endT\` the picture holds still: no new element, no text, no camera move${signOff ? ', except the brand\'s sign-off, which happens in this hold' : ''}. Never clear, fade or empty the picture yourself, and add no "the end" card or summary caption.`;
}

const lintLines = (issues: LintIssue[]) => issues.map((i) => `- ${i.local}s: ${i.msg}`).join('\n');
const sheetLine = (times: { local: number }[]) => `The attached sheet shows the page at these moments within it (left to right, top to bottom): ${times.map((x) => x.local.toFixed(1) + 's').join(', ')}.`;

/** the reviewer's system prompt: how to judge a page, and the film's style (the stable part, shared by every page) */
export function reviewerSystem(style: string, styleNotes?: string, card?: string) {
  return [read('REVIEW.md'), '---\n# This film\'s style\n\n' + grammar(style), filmCardSection(card), styleNotesSection(styleNotes)].filter(Boolean).join('\n\n');
}

/** a problem the reviewer sees on the page, and the change it asks for */
export interface Problem { at: number; what: string; fix: string }
/** the reviewer's answer tool */
export const VERDICT: AnswerTool = {
  name: 'verdict',
  description: 'Your verdict on the page: pass, or fail with the problems a viewer would see.',
  parameters: Type.Object({
    pass: Type.Boolean(),
    problems: Type.Array(Type.Object({
      at: Type.Number({ description: 'the still\'s time within the page, in seconds' }),
      what: Type.String({ description: 'what is wrong, as the viewer sees it' }),
      fix: Type.String({ description: 'the change that fixes it' }),
    }), { maxItems: 5 }),
  }),
};
/** the page agent's answer tool: a problem it leaves as it is */
export const FLAG: AnswerTool = {
  name: 'flag',
  description: 'Leave the page as it is: the problems reported are intended or a false alarm (or, for a change the user asked for, the page already shows it or cannot do it). Give the reason in one sentence. The page is settled as it is.',
  parameters: Type.Object({ reason: Type.String() }),
};

/** what the reviewer is shown each round: the page's storyboard and timing, the checker's findings, the sheet */
export function reviewerPrompt(sb: Storyboard, id: string, t: PageTiming, round: number, issues: LintIssue[], times: { local: number }[], change?: string, brand?: BrandBrief) {
  const p = sb.pages.find((x) => x.id === id);
  const must = issues.filter((i) => i.level === 'error'), advice = issues.filter((i) => i.level === 'warn');
  return `${round > 1 ? `Round ${round}: the artist has changed the page since you last saw it.\n\n` : ''}## The page (${id} of ${sb.pages.length}, in the film "${sb.title}")
- Section: ${p?.section ?? ''}
- What it says: ${p?.say ?? ''}
- Beats:
${(p?.beats || []).map((b, i) => `  ${i + 1}. [${b.at}] ${b.object} — ${b.action}${b.text ? `, on-screen text "${b.text}"` : ''}`).join('\n')}
- The page lasts ${(t.end - t.start).toFixed(1)}s. Narration:
${t.cues.map((c) => `  - c${c.i} at ${c.at.toFixed(1)}s: "${c.text}"`).join('\n')}
${sb.pages[sb.pages.length - 1]?.id === id ? `\nThis page ends the film: after its last line it holds ${(t.end - t.speechEnd).toFixed(1)}s, then the film fades out by itself (not shown in the sheet). Fail it if the film ends mid-move, on a half-drawn or unresolved picture, or on an emptied frame; a still hold after the last line is right.\n` : ''}${change ? `\nThe user asked for this change to the page: ${change}\nFail the page if the pictures don't show it.\n` : ''}${brandReviewNote(brand, brandFilesOn(brand, sb.pages, id))}
## The checker
${must.length ? `Must-fix (already sent to the artist):\n${lintLines(must)}` : 'Nothing must be fixed.'}
${advice.length ? `Advice (a measurement; fail on it only if the picture shows a problem):\n${lintLines(advice)}` : ''}

${sheetLine(times)}
Call verdict.`;
}

/** the reviewer did not call verdict: asked once more */
export const verdictAgain = 'Answer by calling verdict, with nothing else.';

// ── the film kit: this film's own components, written once before its pages (kit.ts) ──

/** the kit session's system prompt: the film's look, the drawing API and the component library, and how a kit is
 *  written (the rules a style pack's kit.js follows) */
export function kitSystem(style: string, styleNotes?: string, card?: string) {
  return [read('PAGE.md'), '---\n# This film\'s style\n\n' + grammar(style), filmCardSection(card), styleNotesSection(styleNotes), '---\n' + read('API.md'), '---\n' + read('LIB.md')].filter(Boolean).join('\n\n');
}

/** what the kit session is asked: the components the storyboard lists, where each appears, and how to write them */
export function kitPrompt(sb: Storyboard, items: KitItem[], lang: Lang | undefined = sb.lang, replyLang?: Lang) {
  const beatsOf = (it: KitItem) => sb.pages.filter((p) => it.pages.includes(p.id)).flatMap((p) => (p.beats || []).filter((b) => mentions(b, it)).map((b) => `    - ${p.id}: ${b.object} — ${b.action}`)).slice(0, 8);
  return `Before any page of this film is drawn, write **this film's own components**: the things it draws on many pages, written once, in its look, so every page calls the same one.

The film: ${sb.title} — ${sb.summary} (${sb.pages.length} pages)

## The components the storyboard lists
${items.map((it) => `- \`P.${it.name}\` — ${it.what} (on ${it.pages.join(', ')})${beatsOf(it).length ? `\n  What the pages do with it:\n${beatsOf(it).join('\n')}` : ''}`).join('\n')}

## Write ${KIT_FILE}
- One IIFE: \`(function () { const { col, clamp, lerp, ease, Builder } = PV; const B = Builder.prototype; … })();\`
- Each component as \`B.name = function (args) { … }\`, drawn with the drawing API (\`this.path\`, \`this.text\`, \`this.circle\`, … as \`P.\` in a page), in the film's look: its colours by name, its line, its type.
- **Directly above each one**, its doc comment, which is all the pages will see of it: \`/** name(args): what it draws and when to use it. o: { at, dur, … } */\`. Say every option a page may pass: what it can highlight, label or move.
- **A pure function of time.** It draws through the API's timed calls (\`at\`, \`dur\`) and \`this.tick((lt) => …)\` only: the same moment gives the same picture. No \`Math.random()\` (use \`PV.rng(seed)\`), no state kept between frames.
- Take \`o.at\` for when it starts and give the pages handles to what they need to move or light later (return an object, or the group).
- Coordinates on the 1920×1080 stage; keep it out of the subtitle band (y > 900) unless a page places it there.
- Only the listed components, named as listed. Nothing else in the file.

## Write ${KIT_CHECK_FILE}
One page that calls every component once, in the order listed: \`ENGINE.visual('kit', (P) => { … })\`. Component *i* starts at \`P.c(i)\` (the page has one cue per component, about 2.6 seconds each) and gets its own area of the frame, laid out in a grid so none overlaps another; use the options the pages will use. It is only for checking the components: a reviewer looks at it in pictures.

Stop once both files are written and say in one sentence what you made.${langNote('page', lang, replyLang)}`;
}
const mentions = (b: { object: string; action: string }, it: KitItem) => {
  const words = it.what.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const text = `${b.object} ${b.action}`.toLowerCase();
  return words.some((w) => text.includes(w)) || text.includes(it.name.toLowerCase());
};

/** what the kit's reviewer is shown: each component's frame, what it should draw */
export function kitReviewerPrompt(items: KitItem[], times: number[], round: number) {
  return `${round > 1 ? `Round ${round}: the components have been changed since you last saw them.\n\n` : ''}These are not a page of the film: they are **this film's own components**, which every page will call. The attached sheet shows each one drawn in its own area of the frame, at these moments: ${times.map((t, i) => `${t.toFixed(1)}s (${items[i]?.name ?? 'all'})`).join(', ')}.

The components:
${items.map((it) => `- ${it.name}: ${it.what}`).join('\n')}

Fail a component when it does not read as what it should be, breaks the film's style card, is cut off or unfinished, or is drawn so badly a page could not use it. Name the component in \`what\`, and use its moment as \`at\`. Pass when every component is usable. Call verdict.`;
}

/** what the kit session is asked to fix after its check */
export function kitFixPrompt(round: number, problems: { name?: string; what: string; fix: string }[], crash?: string) {
  return `Check round ${round}: the components need changes.
${crash ? `\nThe check page throws when it runs, so nothing could be looked at:\n${crash}\n` : ''}${problems.map((p) => `- ${p.name ? `${p.name}: ` : ''}${p.what} → ${p.fix}`).join('\n')}

Fix them with edit in ${KIT_FILE} (and ${KIT_CHECK_FILE} if the check page itself is wrong). **Put all the edits in one reply**, each with finish: true: the round ends once they apply, and the components are checked again.`;
}

/** the page reviewer: the film's own components, so a page that drew one of them again is caught */
export function kitReviewNote(items: KitItem[]) {
  return items.length ? `\n---\n# This film's own components\n\nThis film has its own components for the things it draws on many pages: ${items.map((it) => `\`${it.name}\` (${it.what})`).join('; ')}. Every page draws these with the component. Fail a page that draws one of them by hand so it looks different from the other pages.` : '';
}

/** what the page agent is asked to fix after a check: the checker's must-fix findings and the reviewer's problems */
export function fixPrompt(round: number, errors: LintIssue[], problems: Problem[], times: { local: number }[], change?: string) {
  return `Check round ${round}: the page needs changes.

${errors.length ? `The checker, must fix:\n${lintLines(errors)}\n\n` : ''}${problems.length ? `The reviewer, looking at the attached sheet:\n${problems.map((p) => `- ${p.at.toFixed(1)}s: ${p.what} → ${p.fix}`).join('\n')}\n\n` : ''}${change ? `The user asked for this change to the page: ${change}\nIf the pictures don't show it yet, make it now.\n\n` : ''}${sheetLine(times)}
Fix each problem with edit, only where it is (a size, a position, a moment). **Never rewrite the whole file with write**: a full rewrite takes minutes, one edit takes seconds. No need to read the file again afterwards.
**Put all of this round's edits in one reply** (one reply can call edit several times), each with finish: true: the round ends once they apply, no reply needed, and the page is checked again.
If the problems should stay as they are (intended, or a false alarm), call flag with the reason instead of changing the page.`;
}

export function reviewPrompt(issues: LintIssue[], flagged: string[], replyLang?: Lang) {
  return `All pages are done. Now check the **whole film** (not one page). The attached sheet shows each page in the middle and at the end, in page order.
${issues.length ? 'Lint for the whole film:\n' + issues.map((i) => `- ${i.page} ${i.local}s: ${i.msg}`).join('\n') : 'Lint found nothing.'}
${flagged.length ? '\nThese pages still had problems after their own checks: ' + flagged.join('; ') : ''}

Fix locally with edit; never rewrite a whole page file. Fix only problems across pages and obvious defects (styles that don't match, a page that is clearly empty, text off the page or overlapping), at most 2 pages; leave small blemishes. When done, stop and tell the user in one plain sentence which page you changed and how it looks different (e.g. "The timer on page 5 flickered in its second half; that's fixed"), without terms like lint, determinism or p05. If nothing needs changing, change nothing and stop. ${replyNote(replyLang)}`;
}
