// System prompts for each stage, assembled from prompts/*.md and the chosen style's grammar card, and the per-stage
// user messages. Stable text first (system), changing text last (user), so provider prompt caches stay warm.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import { canvas, PORTRAIT_STAGE as PS } from '@frametell/engine/tools/canvas.mjs';
import { Type } from 'typebox';
import type { PageTiming, Storyboard, LintIssue } from './project.js';
import type { AnswerTool } from './runtime/types.js';

import { pagePack } from './pagepack.js';
import { designedFonts } from './look.js';
import { KIT_MAX, KIT_MIN_PAGES, kitPart, kitPartCheck, type KitItem } from './kit.js';
import { brandFilesOn, brandPageNote, cornerMark, brandReviewNote, brandSection, signsOff, type BrandBrief } from './brand.js';
import { assetPageNote, assetReviewNote, assetsSection, type UserAsset } from './assets.js';

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

/** `brand`: the brand the film is made for, after the style card and its notes. `assets`: the user's own pictures for
 *  the film, as its list is now */
export function plannerSystem(style: string, preferences?: string, styleNotes?: string, brand?: BrandBrief, assets?: UserAsset[]) {
  return [read('PLANNER.md'), '---\n# This film\'s style (the page agent draws to it, so the storyboard must be drawable in it)\n\n' + grammar(style), styleNotesSection(styleNotes), brandSection(brand), assetsSection(assets), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}
/** the page agent's system prompt: process, the style's grammar, the drawing API, the style's components with a worked
 *  example page, and the wider component library (the stable part of every page session, so it caches well) */
export function pageSystem(style: string, extras: string[] = [], preferences?: string, styleNotes?: string, card?: string, filmKit?: string) {
  return [read('PAGE.md'), '---\n# This film\'s style\n\n' + grammar(style), filmCardSection(card), styleNotesSection(styleNotes), '---\n' + read('API.md'), '---\n' + pagePack(style, extras, filmKit), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}

/**
 * A portrait film (9:16, 1080×1920, for phones): the last part of every system prompt that plans, draws or judges its
 * pages. Everything above (the drawing API, the style's card, its components and worked example, the page rules) speaks
 * of the 1920×1080 stage; this says what changes. Two variants of each prompt in all, so the caches stay warm.
 * `who`: whom it speaks to: the director (storyboard, script), an artist (pages, components) or the reviewer.
 */
export function canvasSection(portrait: boolean | undefined, who: 'planner' | 'artist' | 'reviewer'): string {
  if (!portrait) return '';
  const A = PS.area;
  const head = `---\n# This film is portrait (9:16)\n\nThis film is for phones: the stage is **${PS.w} wide × ${PS.h} tall**, not 1920×1080. Everything above that speaks of the wide stage (coordinates, the content area, the subtitle band, where the title sits, sizes in the style's card, its components and its worked example) is replaced by this. The style itself (its medium, palette, line, type and how it moves) holds as it is: only the layout changes.`;
  const layout = `- The page title starts at x ${PS.title.x}, y ${PS.title.y} (\`P.title\` puts it there; a style's own title component too, when it reads \`STAGE.title\`). Keep it to one line: about 12 Chinese characters or 24 letters.
- The content area is **x ${A.x0}–${A.x1}, y ${A.y0}–${A.y1}**. Below y ${PS.subs} is for subtitles only (and on a phone the app's own captions and buttons cover it): no content there. Keep text clear of the right edge (x > ${PS.w - 90}), where the apps put their buttons.
- \`STAGE.w\`, \`STAGE.h\`, \`STAGE.area\` and \`STAGE.subs\` hold these numbers in code.`;
  const compose = `- **Compose for a tall frame.** Stack, don't line up: a comparison is top against bottom, a sequence and a timeline run downwards, a cause sits above its effect. At most two things side by side, never a row of four or five.
- **One idea per screen, bigger, and the whole height used.** The main object fills most of the width (about 700–940 px wide); fewer, larger parts than on a wide page. Supporting things go above or below it, not beside it. By the page's end the drawing reaches from the top of the content area to near its bottom (y ${A.y0} to about ${A.y1 - 100}): a page that stops above y ${A.y1 - 300} leaves a third of the phone empty. Spread the parts down the frame, or draw them bigger.
- **Readable on a phone held in the hand:** body text at least 40px, labels at least 32px, numbers that matter 90px or more. Short lines: at most about 14 Chinese characters or 26 letters to a line.
- A background or ground that fills the frame spans x < 0 to x > ${PS.w} and the full height.`;
  if (who === 'planner') return `${head}\n\n- Plan every page for a tall frame: one idea per page, its parts stacked top to bottom, few words on screen. A beat that would put things side by side (a before and after, two options, a row of steps) puts them top and bottom, or one after the other on the same page.\n- On-screen text is short: titles of one line (about 12 Chinese characters or 24 letters), labels of a few words.`;
  if (who === 'reviewer') return `${head}\n\n${layout}\n\nJudge the page as a phone screen: fail a page whose drawing is a wide layout squeezed into the middle (a thin band with empty paper above and below), that leaves the lower third of the content area (y ${A.y1 - 350}–${A.y1}) empty at its end, whose text is too small to read on a phone (labels under about 32px), or whose content runs into the subtitle band or off the sides.`;
  return `${head}\n\n${layout}\n${compose}\n- The style's components and the worked example were written for the wide stage: give them positions and sizes that fit this one (pass a size or scale where they take one), and where one draws something wide (a long row, a wide chart), use fewer parts or stack two. Positions written for the wide stage (x 960 as the middle, y 540, x 1780) are wrong here: the middle is x ${PS.w / 2}, y ${Math.round((A.y0 + A.y1) / 2)}.`;
}

/** a language, as a tag ('zh', 'en', 'es', 'fr', 'fa', 'pt-BR'…): the film's (narration, on-screen text), or the one
 *  the director reports in (the user's). A film is in the language the user wrote their request in, whatever the
 *  interface's; Chinese and English have their own rules, any other language the general ones */
export type Lang = string;
/** `langAuto`: the film's language is not chosen: the planner takes the language of the user's request (their topic,
 *  notes, material), `lang` only when that can't be told */
export interface Brief { topic?: string; audience?: string; durationSec: number; notes?: string; lang?: Lang; langAuto?: boolean; replyLang?: Lang; voice?: 'volcengine' | 'elevenlabs'; preferences?: string; styleNotes?: string; brand?: BrandBrief; portrait?: boolean }

/** a language tag as a film may carry it: 'es', 'pt-BR', 'zh-Hant'; anything else (a name, a sentence) is not one */
export function langTag(v: unknown): Lang | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(t)) return undefined;
  try { const [c] = Intl.getCanonicalLocales(t); return c.toLowerCase() === 'zh-cn' || c.toLowerCase() === 'zh-hans' ? 'zh' : c.toLowerCase().startsWith('en-') ? 'en' : c; } catch { return undefined; }
}
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
/** the language's name in English, for the prompts ('Spanish', 'Persian') */
export function langName(l: Lang = 'zh'): string {
  if (l === 'zh') return 'Simplified Chinese';
  try { return NAMES.of(l) ?? l; } catch { return l; }
}
/** languages written right to left */
const RTL = /^(ar|fa|he|iw|ur|ps|yi|dv|ckb|sd|ug)(-|$)/i;
/** languages written without spaces between words: on-screen text is counted in characters */
const UNSPACED = /^(zh|ja|th|lo|km|my)(-|$)/i;

/** the language everything said to the user is written in: the user's own, never the prompts' */
export const replyNote = (replyLang?: Lang, lang?: Lang) => `Write everything you say to the user in ${langName(replyLang ?? lang ?? 'zh')}.`;

/** what wins over the film's language: the user asking for another (said where a stage can still change it) */
const ASKED = (name: string) => `If the user asks for the film in another language (in their request, their notes or a message since), that language wins over ${name}: write its code (ISO 639-1, such as "es" or "fr"; "zh" for Chinese) in storyboard.json's "lang" and write the film in it.`;

/** What a stage must know about the language: the film's (narration, on-screen text) and the user's (the reports). It goes
 *  in the user messages, never the system prompts, so every film shares the cached part whatever its language.
 *  `auto`: the storyboard decides the film's language from the user's own words (Brief.langAuto) */
export function langNote(stage: 'storyboard' | 'script' | 'page' | 'revise', lang: Lang = 'zh', replyLang?: Lang, auto = false) {
  if (stage === 'storyboard' && auto) {
    return `\nFilm language: **the language the user wrote their request in** (the topic and their notes; when they only gave material, the material's language), or the one they ask the film to be in. Only when that can't be told, ${langName(lang)}. Write its code in storyboard.json's "lang" (ISO 639-1, such as "en", "es", "fr", "fa"; "zh" for Chinese) and write title, summary, section, say and each beat's object / action / text in that language: on-screen text at most 8 characters per element in Chinese or Japanese, at most 5 words in any other language, and a beat tied to a word names the word as spoken (\`c2:三十年\`, \`c2:thirty\`).
Write everything you say to the user in the film's language, unless they wrote to you in another.`;
  }
  const name = langName(lang), reply = replyNote(replyLang, lang);
  const film = lang === 'zh' ? {
    storyboard: 'Film language: **Chinese**. In storyboard.json write `"lang": "zh"`; write title, summary, section, say and each beat\'s object / action / text in Simplified Chinese: on-screen text at most 8 characters per element, and a beat tied to a word names the Chinese word as spoken (`c2:三十年`).',
    script: 'Film language: **Chinese**. A cue is one short spoken sentence in Simplified Chinese, at most 16 characters, 4–10 per page; write numbers in Arabic digits and units as they are spoken (年, 元).',
    page: 'This is a Chinese film: all text on screen (titles, labels, units) is in Simplified Chinese, matching the narration.',
    revise: 'This is a Chinese film: rewrite narration in Simplified Chinese, keeping the number of cues; your notes to the page agent can be in English.',
  } : lang === 'en' ? {
    storyboard: 'Film language: **English**. In storyboard.json write `"lang": "en"`; write title, summary, section, say and each beat\'s object / action / text in English: on-screen text at most 5 English words per element, and a beat tied to a word names the English word (`c2:thirty`).',
    script: 'Film language: **English**. A cue is one short spoken English sentence, at most 12 words, 4–10 per page; write numbers in Arabic digits (1,000, 30%) and units as they are spoken (years, dollars).',
    page: 'This is an English film: all text on screen (titles, labels, units) is in English, matching the narration. English runs longer than Chinese, so leave enough width for text.',
    revise: 'This is an English film: rewrite narration in English, keeping the number of cues; your notes to the page agent can be in English.',
  } : {
    storyboard: `Film language: **${name}**. In storyboard.json write \`"lang": "${lang}"\`; write title, summary, section, say and each beat's object / action / text in ${name}: on-screen text at most ${UNSPACED.test(lang) ? '10 characters' : '5 words'} per element, and a beat tied to a word names the word as spoken.`,
    script: `Film language: **${name}**. A cue is one short spoken sentence in ${name}, at most ${UNSPACED.test(lang) ? '20 characters' : '12 words'}, 4–10 per page; write numbers in digits and units as they are spoken in ${name}.`,
    page: `This is a film in ${name}: all text on screen (titles, labels, units) is in ${name}, matching the narration, spelled with its own letters and accents.${RTL.test(lang) ? ` ${name} is written right to left: give each block of its text \`direction: rtl\` and align it to the right; a number or a Latin word inside it stays as it is.` : ' It often runs longer than English, so leave enough width for text.'}`,
    revise: `This is a film in ${name}: rewrite narration in ${name}, keeping the number of cues; your notes to the page agent can be in English.`,
  };
  const turn = {
    storyboard: ` ${ASKED(name)}`,
    script: ` ${ASKED(name)} Then the storyboard's own words (title, summary, sections, say, beats) change to it too.`,
    page: '',
    revise: ` Unless the user now asks for the film in another language: then the whole film changes to it. Set storyboard.json's "lang" to its code (ISO 639-1, such as "en" or "es"; "zh" for Chinese), rewrite the title, summary and every page's section and say there, rewrite every cue of script.js in it (keeping each page's number of cues), and put every page in the plan with the note "all on-screen text in <the language>", so every page is drawn again.`,
  }[stage];
  // the page agent's one sentence is shown to the user too
  return `\n${film[stage]}${turn}\n${reply}`;
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

/** `pictures`: what generated pictures the style allows (picturePlanNote), '' when none */
export function storyboardPrompt(brief: Brief, style: string, materials: string[], pictures = '') {
  return [
    'Stage 1: storyboard.',
    `The request: ${materials.length ? 'turn the material into' : 'make'} an explainer film of about ${Math.round(brief.durationSec / 60 * 10) / 10} minutes.` + (brief.topic ? ` Topic: ${brief.topic}.` : '') + (brief.audience ? ` Audience: ${brief.audience}.` : ''),
    materials.length ? '' : 'There is no material: explain it from your own knowledge. Use only well-established, checkable facts and numbers; when unsure, leave the number out. Every number on screen must also appear in that page\'s say (the server checks where numbers come from against say).',
    brief.notes ? `Further notes from the user: ${brief.notes}` : '',
    materials.includes('research.md') ? 'materials/research.md is a research brief prepared for this film from what the request points at (and the web): use its facts, the code and quotes it gives for the screen, and heed its Careful section. It is your main source for facts; the user\'s own words and material come first where they differ.' : '',
    `Style: ${style} (write "${style}" as the style in storyboard.json).`,
    kitPlanNote(!!designedFonts(style)),
    pictures,
    `Material: ${materials.map((m) => 'materials/' + m).join(', ') || '(none; write from the topic)'}`,
    'Stop and report once storyboard.json is written.' + withVoice('storyboard', brief) + langNote('storyboard', brief.lang, brief.replyLang, brief.langAuto),
  ].filter(Boolean).join('\n');
}

/** every storyboard: the things that recur, listed so they are drawn once as this film's components (the pages are drawn
 *  side by side, each by its own session: without one, the same kettle came out red on one page and blue on the next) */
const kitPlanNote = (designed: boolean) => `Also list in \`look.kit\`${designed ? '' : ' (for this style that is all `look` holds: `"look": { "kit": [...] }`)'} the things the film draws on more than one page: its subject (the kettle, the engine, the cell), a map, a diagram, a character or its stand-in, a recurring mark. The pages are drawn at the same time, each by an artist who never sees the others, so anything not listed comes out differently on every page: another colour, another shape. Each thing listed is written once, in the film's look, as a component every page calls, so it is the same wherever it appears. At most ${KIT_MAX}, only things drawn on ${KIT_MIN_PAGES} or more pages, the ones that matter most (each costs as much as a page to write):
\`"kit": [{ "name": "kettle", "what": "the electric kettle: red body, steel lid, black handle and switch; the switch can be up or down, the lid can steam", "pages": ["p01", "p02", "p05"] }]\`
\`name\` is the component's name in camelCase (it becomes \`P.kettle(…)\`), \`what\` fixes how it looks (colours, parts) and what it must be able to show (states, parts lit, cut open), \`pages\` lists the pages it appears on. Leave out what appears on one page only, plain text, arrows and charts (the engine draws those)${designed ? '' : ', and what your style\'s own components already draw'}. A film whose pages share nothing has no \`kit\`.`;

export function storyboardFixPrompt(issues: { level: string; page?: string; beat?: number; msg: string }[], brief?: Brief) {
  return ['The server checked storyboard.json; fix the issues below (red must be fixed, yellow at your judgement):', ...issues.map((i) => `- [${i.level === 'red' ? 'red' : 'yellow'}] ${i.page ?? 'whole film'}${i.beat != null ? ` beat ${i.beat + 1}` : ''}: ${i.msg}`), 'Stop once fixed and say in one sentence what you changed. ' + replyNote(brief?.replyLang, brief?.lang)].join('\n');
}

export function scriptPrompt(feedback?: string, brief?: Brief) {
  return [feedback ? `The user's changes to the storyboard: ${feedback}\nFirst update storyboard.json to match, then write the narration.` : 'The user approved the storyboard without changes.', 'Stage 2: write script.js, run node engine/tools/script.mjs to see the estimated length, then stop and report.' + withVoice('script', brief) + langNote('script', brief?.lang, brief?.replyLang)].join('\n');
}

/** `brand`: the brand the film is made for; the files of it this page places are listed, with how to place them.
 *  `assets`: the user's pictures this page places (assetsOn), each with its call; `pictures`: the film's generated
 *  pictures on it (picturePageNote) */
export function pagePrompt(sb: Storyboard, id: string, t: PageTiming, lang: Lang | undefined = sb.lang, replyLang?: Lang, revising = false, brand?: BrandBrief, assets: UserAsset[] = [], pictures = '') {
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
${t.cues.map((c) => `- c${c.i}: at ${c.at}s in the page, "${c.text}"`).join('\n')}${sb.pages[sb.pages.length - 1]?.id === id ? endingNote(t, signsOff(brand, sb.pages)) : ''}${brandPageNote(brandFilesOn(brand, sb.pages, id), brand?.emphasis, cornerMark(brand) ? brand?.corner : undefined)}${assetPageNote(assets)}${pictures}

${revising ? `pages/${id}.js is already written; stop once the change below is made in it and say in one sentence what you changed.` : `Stop once pages/${id}.js is written and say in one sentence what you drew.`}${langNote('page', lang, replyLang)}`;
}

/** a lane's next page: the session drew the pages before it (or carries on from the first page's), and they are done */
export function laneNote(id: string) {
  return `The pages you drew before are done and checked: leave their files as they are. Now page **${id}**, drawn the same way: where a thing, a person, a colour or a label comes back, it looks as it did on your earlier pages (copy how you drew it).

`;
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
/** `assets`: the user's pictures this page places (assetsOn); `pictures`: the film's generated ones (pictureReviewNote) */
export function reviewerPrompt(sb: Storyboard, id: string, t: PageTiming, round: number, issues: LintIssue[], times: { local: number }[], change?: string, brand?: BrandBrief, assets: UserAsset[] = [], pictures = '', directions: string[] = []) {
  const p = sb.pages.find((x) => x.id === id);
  const must = issues.filter((i) => i.level === 'error'), advice = issues.filter((i) => i.level === 'warn');
  return `${round > 1 ? `Round ${round}: the artist has changed the page since you last saw it.\n\n` : ''}## The page (${id} of ${sb.pages.length}, in the film "${sb.title}")
- Section: ${p?.section ?? ''}
- What it says: ${p?.say ?? ''}
- Beats:
${(p?.beats || []).map((b, i) => `  ${i + 1}. [${b.at}] ${b.object} — ${b.action}${b.text ? `, on-screen text "${b.text}"` : ''}`).join('\n')}
- The page lasts ${(t.end - t.start).toFixed(1)}s. Narration:
${t.cues.map((c) => `  - c${c.i} at ${c.at.toFixed(1)}s: "${c.text}"`).join('\n')}
${sb.pages[sb.pages.length - 1]?.id === id ? `\nThis page ends the film: after its last line it holds ${(t.end - t.speechEnd).toFixed(1)}s, then the film fades out by itself (not shown in the sheet). Fail it if the film ends mid-move, on a half-drawn or unresolved picture, or on an emptied frame; a still hold after the last line is right.\n` : ''}${change ? `\nThe user asked for this change to the page: ${change}\nFail the page if the pictures don't show it.\n` : ''}${directions.length ? `\nThe user's directions for this film, in the order given (they outrank the storyboard: never fail the page for following them, or ask for a beat they ruled out; fail it if it goes against them):\n${directions.map((n) => `- ${n}`).join('\n')}\n` : ''}${brandReviewNote(brand, brandFilesOn(brand, sb.pages, id))}${assetReviewNote(assets)}${pictures}
## The checker
${must.length ? `Must-fix (already sent to the artist):\n${lintLines(must)}` : 'Nothing must be fixed.'}
${advice.length ? `Advice (a measurement; fail on it only if the picture shows a problem):\n${lintLines(advice)}` : ''}

${sheetLine(times)}
Call verdict.`;
}

/** the reviewer did not call verdict: asked once more */
export const verdictAgain = 'Answer by calling verdict, with nothing else.';

// ── the film kit: this film's own components, written once before its pages (kit.ts) ──

/** the kit session's system prompt: the film's look, the drawing API, how a component is written with it (KIT.md: what
 *  `this` is, what a call returns, time, colours), and the style's components. Without KIT.md the API was the pages'
 *  `P.xxx` alone, and a kit session spent ~15 turns grepping engine/runtime/core.js for Builder.prototype and reading
 *  the style's kit.js (2026-10-29) */
/** `extras`: the style's own components, which the film's may build on (they load first) */
export function kitSystem(style: string, extras: string[] = [], styleNotes?: string, card?: string) {
  return [read('PAGE.md'), '---\n# This film\'s style\n\n' + grammar(style), filmCardSection(card), styleNotesSection(styleNotes), '---\n' + read('API.md'), '---\n' + read('KIT.md'), '---\n' + pagePack(style, extras), '---\n' + read('LIB.md')].filter(Boolean).join('\n\n');
}

/** what one kit session is asked: its component (`it`), among the others the storyboard lists (written at the same
 *  time by other sessions), and where on the check page it is drawn (`cell`) */
export function kitPrompt(sb: Storyboard, items: KitItem[], it: KitItem, cell: { i: number; x: number; y: number; w: number; h: number }, lang: Lang | undefined = sb.lang, replyLang?: Lang, portrait = false) {
  const stage = canvas(portrait);
  const beatsOf = (x: KitItem) => sb.pages.filter((p) => x.pages.includes(p.id)).flatMap((p) => (p.beats || []).filter((b) => mentions(b, x)).map((b) => `    - ${p.id}: ${b.object} — ${b.action}`)).slice(0, 8);
  const others = items.filter((x) => x !== it);
  const file = kitPart(it.name), check = kitPartCheck(it.name);
  return `Before any page of this film is drawn, write **one of this film's own components**: \`P.${it.name}\`, a thing it draws on several pages, written once, in its look, so every page calls the same one.

The film: ${sb.title} — ${sb.summary} (${sb.pages.length} pages)

## Your component
- \`P.${it.name}\` — ${it.what} (on ${it.pages.join(', ')})${beatsOf(it).length ? `\n  What the pages do with it:\n${beatsOf(it).join('\n')}` : ''}
${others.length ? `\nThe film's other components, each written now by another artist: ${others.map((x) => `\`P.${x.name}\` (${x.what})`).join('; ')}. Where yours shows the same thing as one of them (a part of it, a close-up of it), draw it as described there: the same colours and parts.\n` : ''}
## Write ${file}
- One IIFE: \`(function () { const { col, clamp, lerp, ease, Builder } = PV; const B = Builder.prototype; … })();\`
- Your component as \`B.${it.name} = function (args) { … }\`, drawn with the drawing API (\`this.path\`, \`this.text\`, \`this.circle\`, … as \`P.\` in a page), in the film's look: its colours by name, its line, its type.
- Drawn the way this style draws (its grammar above). Where one of the style's own components already gives the look (a frame, a hatch, a figure), build on it with \`this.name(…)\`: it is loaded before yours.
- **Directly above it**, its doc comment, which is all the pages will see of it: \`/** ${it.name}(args): what it draws and when to use it. o: { at, dur, … } */\`. Say every option a page may pass: what it can highlight, label or move.
- **A pure function of time.** It draws through the API's timed calls (\`at\`, \`dur\`) and \`this.tick((lt) => …)\` only: the same moment gives the same picture. No \`Math.random()\` (use \`PV.rng(seed)\`), no state kept between frames.
- Take \`o.at\` for when it starts and give the pages handles to what they need to move or light later (return an object, or the group).
- Coordinates on the ${stage.w}×${stage.h} stage; keep it out of the subtitle band (y > ${stage.subs}) unless a page places it there.
- Only \`B.${it.name}\` (helpers inside the IIFE are fine). Nothing else in the file.
- **Short and plain**: about the size of what one page would draw for it (aim for 40–80 lines), drawn the way a page draws, not modelled. Fix what must match across pages (shape, proportions, colours, parts) and the states the pages need; leave the rest to the pages. The pages are waiting for this file: write it in one go, without exploring the project first (the style's components are listed above, already loaded). Once written, the file is changed with edit: writing it whole again is refused.

## Write ${check}
The lines that draw your component once on the check page, which shows every component of the film side by side: plain statements using \`P\` (no \`ENGINE.visual\` around them), e.g. \`P.${it.name}(…, { at: P.c(${cell.i}) });\`. It starts at \`P.c(${cell.i})\` (about 2.6 seconds before the next component's turn) and stays inside x ${cell.x}–${cell.x + cell.w}, y ${cell.y}–${cell.y + cell.h}; use the options the pages will use. A reviewer looks at it in pictures.

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

/** the director's answer at the first page: which of the film's components the user's change is about */
export const KIT_CHANGE: AnswerTool = {
  name: 'components',
  description: "The film's components this change must be made in: the ones whose look or parts it changes. [] when it changes none of them.",
  parameters: Type.Object({ names: Type.Array(Type.String({ description: "a component's name, as listed" })) }),
};
/** who decides which components a change at the first page reaches */
export const kitChangeSystem = "You look after a film's own components: the things it draws on several pages, written once so every page draws them alike. You answer only with the components tool.";
/** what the film's first page is shown with: the change, and the components to choose among */
export function kitChangeAsk(items: KitItem[], change: string) {
  return `The user looked at the film's first page and asked for this change: ${change}

The film's components (each is drawn the same on every page that shows it):
${items.map((it) => `- ${it.name}: ${it.what}`).join('\n')}

Which of them must change for this? A change to how one of these things looks (its colour, shape, parts, size, how it is drawn) is made in its component, or the other pages would still show it the old way. A change to the page alone (where things are, the camera, the background, a label, the pacing) changes none. Call components with their names, or [].`;
}
/** what a component's session is asked when the user wants it changed, at the first page */
export function kitChangePrompt(name: string, change: string, code: string, check: string) {
  return `The user looked at the film's first page, which draws with this film's components, and asked for a change that reaches your component \`P.${name}\`: ${change}

Your files as they are now (already given; don't read them again):
${kitPart(name)}:
\`\`\`js
${code}
\`\`\`
${kitPartCheck(name)}:
\`\`\`js
${check}
\`\`\`
Make the change in ${kitPart(name)} with edit. **Keep its name, arguments and options as they are**: every page already calls it, and those calls must still work. Change only what the user's words reach. Put all the edits in one reply, each with finish: true; the components are checked again once they apply.`;
}

/** what the kit session is asked to fix after its check */
/** `yours`: the crash was raised in this session's own files (kit.ts kitLocate), so it is sent to it alone */
export function kitFixPrompt(name: string, round: number, problems: { name?: string; what: string; fix: string }[], crash?: string, yours = false) {
  return `Check round ${round}: the components need changes.
${crash ? `\nThe check page throws when it runs, so nothing could be looked at${yours ? `; the error is raised in your ${kitPart(name)} or ${kitPartCheck(name)}` : ''}:\n${crash}\n` : ''}${problems.map((p) => `- ${p.name ? `${p.name}: ` : ''}${p.what} → ${p.fix}`).join('\n')}

${yours || problems.some((p) => p.name === name) ? '' : 'They may not be yours: the check runs every component together. Change your files only for what is yours; if nothing is, say so and stop.\n'}Fix them with edit in ${kitPart(name)} (and ${kitPartCheck(name)} if your lines on the check page are wrong). **Put all the edits in one reply**, each with finish: true: the round ends once they apply, and the components are checked again.`;
}

/** the page reviewer: the film's own components, so a page that drew one of them again is caught */
export function kitReviewNote(items: KitItem[]) {
  return items.length ? `\n---\n# This film's own components\n\nThis film has its own components for the things it draws on many pages: ${items.map((it) => `\`${it.name}\` (${it.what})`).join('; ')}. Every page draws these with the component. Fail a page that draws one of them by hand so it looks different from the other pages.` : '';
}

/** what the page agent is asked to fix after a check: the checker's must-fix findings and the reviewer's problems */
/** a page that throws: the error is often raised inside the engine (engine/…), by a call the page made wrongly */
const RUNTIME_NOTE = "A runtime error means the page's code throws, and the page is not drawn at all: fix it first. When the error is raised inside the engine (engine/… in the stack), the cause is still the page: the first pages/… line in the stack is the call that passed it something it does not take. Compare that call with the API reference above (each argument, in its order; options are the last argument) and fix the call itself, not the numbers around it.";

export function fixPrompt(round: number, errors: LintIssue[], problems: Problem[], times: { local: number }[], change?: string) {
  return `Check round ${round}: the page needs changes.

${errors.length ? `The checker, must fix:\n${lintLines(errors)}\n\n` : ''}${errors.some((i) => i.kind === 'runtime' || i.kind === 'api') ? `${RUNTIME_NOTE}\n\n` : ''}${problems.length ? `The reviewer, looking at the attached sheet:\n${problems.map((p) => `- ${p.at.toFixed(1)}s: ${p.what} → ${p.fix}`).join('\n')}\n\n` : ''}${change ? `The user asked for this change to the page: ${change}\nIf the pictures don't show it yet, make it now.\n\n` : ''}${sheetLine(times)}
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

// ── a message while the film is being made: a change to follow, a question to answer, or both ──

/**
 * What a hosted service knows about the account's credits, sent with a message (the engine itself knows only what the
 * model turns cost in money): the balance, what this film has spent, what a minute of film is quoted at, and what
 * exporting it would take.
 */
export interface CreditFacts { available: number; spent: number; perMinute: number; exportQuote?: number }
/** credit facts as they came over the wire, checked field by field: undefined unless the three numbers it needs are there */
export function cleanCredits(v: unknown): CreditFacts | undefined {
  const o = v as Record<string, unknown> | null | undefined;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const available = num(o?.available), spent = num(o?.spent), perMinute = num(o?.perMinute), exportQuote = num(o?.exportQuote);
  if (available === undefined || spent === undefined || perMinute === undefined) return undefined;
  return { available, spent, perMinute, ...(exportQuote !== undefined ? { exportQuote } : {}) };
}
/** what the director knows of the film when a message comes in: where it is, how far the pages are, how long it is */
export interface FilmFacts {
  stage: string;
  pagesDone: number;
  pagesTotal?: number;
  /** the narration's length once the script is written (`planned`), else the length asked for */
  durationSec?: number;
  planned?: boolean;
  /** what the film waits for the user on: 'first_page', its first page drawn alone for them to go ahead or ask for a change */
  waiting?: 'first_page';
  /** what the model turns have cost so far, in the director's currency */
  cost?: { amount: number; currency: string };
}

/**
 * Credits still needed to finish the film, worked out here and not by the model: the film's minutes at the quoted rate,
 * less what it has spent already, plus the export. Undefined when the film's length is not known.
 */
export function creditsToFinish(durationSec: number | undefined, c: CreditFacts): { needed: number; covered: boolean } | undefined {
  if (!durationSec || durationSec <= 0 || !Number.isFinite(c.perMinute)) return undefined;
  const needed = Math.max(0, Math.ceil(durationSec / 60 * c.perMinute) - c.spent) + (c.exportQuote ?? 0);
  return { needed, covered: c.available >= needed };
}

/**
 * The director's answer to a message mid-run: whether it asks for a change to the film, needs a reply, or both. Two
 * booleans rather than one word to pick: a schema of plain types is one every model service takes.
 */
export const ROUTE: AnswerTool = {
  name: 'route',
  description: "What the user's message is: a change or instruction for the film, a question or remark that needs a reply, or both; and the reply to show them.",
  parameters: Type.Object({
    change: Type.Boolean({ description: 'true when the message asks for something in the film to be made or done differently' }),
    question: Type.Boolean({ description: 'true when the message asks something, or says something that needs an answer rather than a change' }),
    go: Type.Optional(Type.Boolean({ description: 'true when the film is waiting for the user and the message only tells it to go on (continue, start, go ahead, looks good), with nothing to change' })),
    reply: Type.String({ description: 'what to tell the user: the answer to their question, short (one to three sentences), in the language they wrote in. Empty when it is only a change' }),
  }),
};
/** who reads a message the user sends while the film is being made */
export const routeSystem = "You are the director of an explainer film that is being made right now, and you read what the user types into the film's message box. A change or instruction for the film is passed on to the artists drawing it; a question or a remark gets an answer from you. You answer only with the route tool. Answer from the facts you are given; never make up a figure you were not given.";

/** what the router is shown: the message, and what is known about the film (and the account, on a hosted service) */
export function routeAsk(text: string, film: FilmFacts, credits?: CreditFacts, replyLang?: Lang) {
  const min = (s: number) => `${Math.round(s / 6) / 10} min`;
  const known = [
    `- Stage: ${film.stage}`,
    `- Pages drawn: ${film.pagesDone}${film.pagesTotal ? ` of ${film.pagesTotal}` : ''}`,
    film.waiting === 'first_page' ? '- Waiting for the user: the first page is drawn alone for them to see the look; nothing else is drawn until they go ahead or ask for a change' : '',
    film.durationSec ? `- Length: ${min(film.durationSec)} (${film.planned ? 'the narration as written' : 'as asked for; the narration is not written yet'})` : '',
    // money is the open-source studio's measure; a hosted service's users pay in credits and are told those instead
    film.cost && !credits ? `- Spent on the model so far: ${film.cost.amount.toFixed(2)} ${film.cost.currency}` : '',
  ].filter(Boolean);
  const left = credits && creditsToFinish(film.durationSec, credits);
  const account = credits ? [
    `- Credits in the account: ${credits.available}`,
    `- Credits this film has spent: ${credits.spent}`,
    `- A minute of film is quoted at ${credits.perMinute} credits${credits.exportQuote ? `; exporting it, ${credits.exportQuote} credits` : ''}`,
    left
      ? `- Credits still needed to finish it${credits.exportQuote ? ' and export it' : ''}: about ${left.needed} (worked out from the above; quote this figure). The account ${left.covered ? 'has enough' : `is ${left.needed - credits.available} short`}.`
      : "- The credits still needed can't be worked out yet: the film's length is not known.",
  ] : [];
  return `The user wrote, while the film is being made:
"""
${text}
"""

The film now:
${known.join('\n')}
${account.length ? `\nThe account (credits pay for making the film):\n${account.join('\n')}\n` : ''}
Is this a change or instruction for the film (how it looks, what it says, what to add or leave out), a question or a remark that needs a reply, or both? A change is passed on to the artists as the user wrote it; don't repeat it. For a question, answer it in the reply from the facts above: short, plain, without internal terms (stage names, page ids); when the facts don't say, say so plainly. For a change alone, leave the reply empty.${film.waiting ? ' The film is waiting for the user: a message that only tells it to go on (continue, start, go ahead, fine as it is) is go, not a question; never tell them it is being made while it waits.' : ''} Reply in the language the user wrote in${replyLang ? ` (most likely ${langName(replyLang)})` : ''}. Call route.`;
}
